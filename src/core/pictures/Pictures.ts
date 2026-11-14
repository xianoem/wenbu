import {
  Clock,
  Config,
  Duration,
  Effect,
  FiberMap,
  FileSystem,
  Option,
  Path,
  Ref,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import type { RgbaImage } from '#contract/Detections'
import { defaultTranslationSettings, TranslationSettings } from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import {
  cleanKeyOf,
  defaultPictureStyle,
  type GamePicture,
  type PictureLine,
  type PictureScan,
  PicturesError,
  type PicturesSummary,
  PicturesRpc,
  PictureStyle,
} from '#contract/Pictures'
import { encodePng, fitWithin } from '../detections/RgbaImages'
import { InGameTextStore } from '../ingametext/InGameTextStore'
import { Games } from '../library/Games'
import type { ConnectedGame } from '../livecontrols/LiveControls'
import { LiveControls } from '../livecontrols/LiveControls'
import { LlmClient } from '../llm/LlmClient'
import * as SettingsStore from '../platform/SettingsStore'
import { decodeRgba, listGameImages } from './GameImages'
import { cleanLine, ImageOcr, textBoxes } from './ImageOcr'
import { PictureCleaner } from './PictureCleaner'
import { fontSizeOf, parsePictureReply, picturePrompt, pictureSystemPrompt } from './PicturePrompt'
import { type PictureChange, PictureStore, type StoredPicture } from './PictureStore'

const MIN_WIDTH = 24

const MIN_HEIGHT = 12

/** Long enough for the model to read a 1280×720 picture, small enough to keep requests cheap. */
const PICTURE_FOR_MODEL = 1280

const TRANSLATING_AT_ONCE = 3

/** Progress is reported this many times per scan instead of once per picture. */
const PROGRESS_STEPS = 100

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

type Busy = NonNullable<GamePicture['busy']>

const failed = (message: string) => new PicturesError({ reason: 'failed', message })

const notFound = () =>
  new PicturesError({ reason: 'not-found', message: 'This picture is no longer in the game.' })

const groupOf = (lines: ReadonlyArray<PictureLine>) =>
  lines
    .map((line) => line.ocr)
    .toSorted()
    .join('\n')

export interface LineEdit {
  readonly source?: string | undefined
  readonly translation?: string | undefined
  readonly keep?: boolean | undefined
  readonly size?: number | null | undefined
  readonly fillBox?: boolean | undefined
}

/** A line with the user's changes: a chosen size and filling the box replace each other. */
export const edited = (line: PictureLine, edit: LineEdit): PictureLine => {
  const { size: _size, fillBox: _fillBox, ...rest } = line
  const size = edit.size === undefined ? line.size : (edit.size ?? undefined)

  const fillBox =
    edit.size !== undefined && edit.size !== null ? false : (edit.fillBox ?? line.fillBox)

  return {
    ...rest,
    source: edit.source ?? line.source,
    keep: edit.keep ?? line.keep,
    ...(size === undefined || fillBox === true ? {} : { size }),
    ...(fillBox === true ? { fillBox } : {}),
  }
}

const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)

export const PicturesRpcLive = PicturesRpc.toLayer(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dataDir = yield* Config.String('WENBU_DATA_DIR')
    const store = yield* PictureStore
    const texts = yield* InGameTextStore
    const games = yield* Games
    const ocr = yield* ImageOcr
    const cleaner = yield* PictureCleaner
    const llm = yield* LlmClient
    const live = yield* LiveControls
    const kv = yield* KeyValueStore.KeyValueStore
    const scans = yield* FiberMap.make<string>()
    const translations = yield* FiberMap.make<string>()
    const progress = yield* Ref.make(new Map<string, PictureScan>())
    const notices = yield* Ref.make(new Map<string, string>())
    const busy = yield* Ref.make(new Map<string, Busy>())
    const revision = yield* SubscriptionRef.make(0)
    const styles = SettingsStore.make(kv, PictureStyle, defaultPictureStyle)
    const translationStore = SettingsStore.make(kv, TranslationSettings, defaultTranslationSettings)

    const changed = SubscriptionRef.update(revision, (n) => n + 1)

    const translation = Effect.orElseSucceed(
      translationStore.get('game-translation'),
      () => defaultTranslationSettings,
    )

    const setIn = <V>(ref: Ref.Ref<Map<string, V>>, key: string, value: V | undefined) =>
      Ref.update(ref, (map) => {
        const next = new Map(map)

        if (value === undefined) {
          next.delete(key)
        } else {
          next.set(key, value)
        }

        return next
      }).pipe(Effect.andThen(changed))

    const busyKey = (gameId: string, picture: string) => `${gameId}\u0000${picture}`

    const fileOf = (gameId: string, kind: 'original' | 'cleaned', picture: string) =>
      `${path.join(dataDir, 'pictures', gameId, kind, ...picture.split('/'))}.png`

    const translatedFileOf = (gameId: string, picture: string, stamp: number) =>
      `${path.join(dataDir, 'pictures', gameId, 'translated', ...picture.split('/'))}.${stamp}.png`

    const writeFile = (file: string, bytes: Uint8Array) =>
      fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
        Effect.andThen(fs.writeFile(file, bytes)),
        Effect.mapError(() => failed('Wenbu could not save the picture.')),
      )

    const removeFile = (file: string | undefined) =>
      file === undefined ? Effect.void : Effect.ignore(fs.remove(file, { force: true }))

    const gameOf = (gameId: string) =>
      games
        .get(gameId)
        .pipe(
          Effect.mapError(
            (error) => new PicturesError({ reason: 'not-found', message: error.message }),
          ),
        )

    const storedOf = (gameId: string, picture: string) =>
      Effect.flatMap(store.picture(gameId, picture), (found) =>
        Option.match(found, {
          onNone: () => Effect.fail(notFound()),
          onSome: (picture) => Effect.succeed(picture),
        }),
      )

    const shown = Effect.fnUntraced(function* (gameId: string) {
      const { targetLanguage } = yield* translation
      const dictionary = new Map(yield* texts.dictionary(gameId, targetLanguage, 'image'))
      const all = (yield* store.pictures(gameId)).filter((picture) => picture.lines.length > 0)
      const inFlight = yield* Ref.get(busy)
      const groups = new Map<string, number>()

      for (const picture of all) {
        groups.set(picture.group, (groups.get(picture.group) ?? 0) + 1)
      }

      return all.map((picture): GamePicture => {
        const cleaned = fileOf(gameId, 'cleaned', picture.picture)
        const state = inFlight.get(busyKey(gameId, picture.picture))

        return {
          picture: picture.picture,
          width: picture.width,
          height: picture.height,
          lines: picture.lines.map((line) => {
            const translated = dictionary.get(line.source)

            return translated === undefined ? line : { ...line, translation: translated }
          }),
          status: picture.status,
          group: picture.group,
          variants: groups.get(picture.group) ?? 1,
          original: fileOf(gameId, 'original', picture.picture),
          ...(picture.cleanedKey === cleanKeyOf(picture.lines) ? { cleaned } : {}),
          ...(picture.status === 'approved' && picture.translatedFile !== undefined
            ? { translated: picture.translatedFile }
            : {}),
          ...(state === undefined ? {} : { busy: state }),
        }
      })
    })

    const shownOne = Effect.fnUntraced(function* (gameId: string, picture: string) {
      const found = (yield* shown(gameId)).find((candidate) => candidate.picture === picture)

      return found === undefined ? yield* notFound() : found
    })

    const logFailure = (game: string, action: string) => (error: { readonly message: string }) =>
      Effect.logWarning('Picture Review failed').pipe(
        Effect.annotateLogs({ feature: 'pictures', game, action, detail: error.message }),
      )

    const pushTo = (session: ConnectedGame) =>
      Effect.gen(function* () {
        const approved = (yield* store.pictures(session.game.id)).flatMap((picture) =>
          picture.status === 'approved' && picture.translatedFile !== undefined
            ? [[picture.picture, picture.translatedFile]]
            : [],
        )

        yield* session.runtime.call('setPictures', [approved])
      }).pipe(Effect.catch(logFailure(session.game.id, 'sending pictures')))

    const push = (gameId: string) =>
      Effect.flatMap(live.session, (session) =>
        Option.isSome(session) && session.value.game.id === gameId
          ? pushTo(session.value)
          : Effect.void,
      )

    yield* live.sessions.pipe(
      Stream.runForEach((session) =>
        Option.isSome(session) ? pushTo(session.value) : Effect.void,
      ),
      Effect.forkScoped,
    )

    const change = Effect.fnUntraced(function* (
      gameId: string,
      picture: string,
      next: PictureChange,
    ) {
      const updated = yield* store.update(gameId, picture, next)

      return Option.isNone(updated) ? yield* notFound() : updated.value
    })

    /** Takes a picture out of the game until it is approved again. */
    const reopen = Effect.fnUntraced(function* (gameId: string, stored: StoredPicture) {
      if (stored.status !== 'approved') {
        return stored
      }

      yield* removeFile(stored.translatedFile)

      return yield* change(gameId, stored.picture, {
        status: 'to-review',
        translatedFile: undefined,
      })
    })

    const scan = Effect.fnUntraced(function* (game: Game) {
      const images = yield* listGameImages(game)

      const known = new Map(
        (yield* store.pictures(game.id)).map((picture) => [picture.picture, picture]),
      )

      const step = Math.max(1, Math.floor(images.length / PROGRESS_STEPS))
      let done = 0

      yield* setIn(progress, game.id, { done, total: images.length })

      for (const image of images) {
        const before = known.get(image.path)

        known.delete(image.path)

        const unchanged =
          before !== undefined &&
          before.fileSize === image.fileSize &&
          before.modifiedAt === image.modifiedAt

        if (!unchanged) {
          const bytes = yield* image.read.pipe(Effect.option)

          const rgba = yield* Option.match(bytes, {
            onNone: () => Effect.succeedNone,
            onSome: (read) => Effect.option(decodeRgba(read)),
          })

          const readable = Option.filter(
            rgba,
            (decoded) => decoded.width >= MIN_WIDTH && decoded.height >= MIN_HEIGHT,
          )

          const lines = Option.isSome(readable)
            ? textBoxes(yield* ocr.recognize(readable.value)).map((box, index): PictureLine => ({
                id: index + 1,
                x: box.x,
                y: box.y,
                w: box.w,
                h: box.h,
                ocr: box.key,
                source: box.key,
                keep: false,
              }))
            : []

          if (lines.length > 0 && Option.isSome(bytes)) {
            yield* writeFile(fileOf(game.id, 'original', image.path), bytes.value)
          }

          yield* removeFile(before?.translatedFile)

          yield* store.save(game.id, {
            picture: image.path,
            fileSize: image.fileSize,
            modifiedAt: image.modifiedAt,
            width: Option.match(rgba, { onNone: () => 0, onSome: (decoded) => decoded.width }),
            height: Option.match(rgba, { onNone: () => 0, onSome: (decoded) => decoded.height }),
            lines,
            group: groupOf(lines),
            status: 'to-review',
            cleanedKey: undefined,
            translatedFile: undefined,
          })
        }

        done++

        if (done === images.length || done % step === 0) {
          yield* setIn(progress, game.id, { done, total: images.length })
        }
      }

      yield* store.remove(game.id, [...known.keys()])
      yield* push(game.id)
    })

    const pictureForModel = Effect.fnUntraced(function* (gameId: string, picture: StoredPicture) {
      const bytes = yield* fs
        .readFile(fileOf(gameId, 'original', picture.picture))
        .pipe(Effect.mapError(() => failed('Wenbu could not read the picture. Find text again.')))

      if (Math.max(picture.width, picture.height) <= PICTURE_FOR_MODEL) {
        return bytes
      }

      const rgba = yield* decodeRgba(bytes).pipe(Effect.mapError((error) => failed(error.message)))

      return encodePng(fitWithin(rgba, PICTURE_FOR_MODEL))
    })

    const translateOne = Effect.fnUntraced(function* (gameId: string, picture: StoredPicture) {
      const settings = yield* translation
      const { targetLanguage } = settings

      if (settings.presetId === '') {
        return yield* new PicturesError({
          reason: 'not-ready',
          message: 'Choose an LLM preset under Translation to translate pictures.',
        })
      }

      const wanted = picture.lines.filter((line) => !line.keep)

      if (wanted.length === 0) {
        return
      }

      const model = yield* llm
        .describe(settings.presetId)
        .pipe(Effect.mapError((error) => failed(error.message)))

      const seesPicture = model.images === true

      const images = seesPicture
        ? [{ mediaType: 'image/png', data: yield* pictureForModel(gameId, picture) }]
        : []

      const reply = yield* llm
        .complete({
          presetId: settings.presetId,
          feature: 'in-game-text',
          gameId,
          system: pictureSystemPrompt,
          prompt: yield* picturePrompt(targetLanguage, wanted, seesPicture),
          images,
          timeout: Duration.seconds(Math.max(30, settings.timeoutSeconds)),
        })
        .pipe(Effect.mapError((error) => failed(error.message)))

      const answers = yield* parsePictureReply(reply.text, wanted).pipe(
        Effect.mapError(() =>
          failed('The model answered with something other than the translations.'),
        ),
      )

      const before = new Map(yield* texts.dictionary(gameId, targetLanguage, 'image'))
      const corrected = new Map<string, string>()

      for (const answer of answers) {
        const line = wanted.find((candidate) => candidate.id === answer.line)

        if (line === undefined) {
          continue
        }

        const current = yield* texts.entry({
          gameId,
          targetLanguage,
          origin: 'image',
          key: line.source,
        })

        if (Option.isSome(current) && (current.value.edited || current.value.locked)) {
          continue
        }

        corrected.set(line.ocr, answer.source)

        yield* texts.saveTranslation({
          gameId,
          targetLanguage,
          origin: 'image',
          key: answer.source,
          translatedText: answer.translation,
          scene: picture.picture,
          allowedWidth: line.w,
          fontSize: fontSizeOf(line),
        })
      }

      for (const variant of yield* store.pictures(gameId)) {
        if (variant.group !== picture.group) {
          continue
        }

        const lines = variant.lines.map((line) => {
          const source = corrected.get(line.ocr)

          return source === undefined || line.source !== line.ocr ? line : { ...line, source }
        })

        yield* store.update(gameId, variant.picture, { lines })
      }

      const after = new Map(yield* texts.dictionary(gameId, targetLanguage, 'image'))

      for (const shown of yield* store.pictures(gameId)) {
        if (shown.lines.some((line) => before.get(line.source) !== after.get(line.source))) {
          yield* reopen(gameId, shown)
        }
      }

      yield* push(gameId)
    })

    /** One picture per group, since variants share their translations. */
    const toTranslate = Effect.fnUntraced(function* (gameId: string, keys: ReadonlyArray<string>) {
      const all = yield* store.pictures(gameId)
      const seen = new Set<string>()

      return keys.flatMap((key) => {
        const picture = all.find((candidate) => candidate.picture === key)

        if (picture === undefined || picture.lines.length === 0 || seen.has(picture.group)) {
          return []
        }

        seen.add(picture.group)

        return [picture]
      })
    })

    const translateAll = Effect.fnUntraced(function* (
      gameId: string,
      chosen: ReadonlyArray<StoredPicture>,
    ) {
      yield* setIn(notices, gameId, undefined)

      yield* Effect.forEach(
        chosen,
        (picture) =>
          translateOne(gameId, picture).pipe(
            Effect.catch((error) =>
              Effect.andThen(
                logFailure(gameId, 'translating')(error),
                setIn(
                  notices,
                  gameId,
                  `Wenbu could not translate ${picture.picture}: ${error.message}`,
                ),
              ),
            ),
            Effect.ensuring(setIn(busy, busyKey(gameId, picture.picture), undefined)),
            Effect.andThen(changed),
          ),
        { concurrency: TRANSLATING_AT_ONCE, discard: true },
      )
    })

    const summaryOf = Effect.fnUntraced(function* (gameId: string, current: number) {
      const all = yield* store.pictures(gameId)
      const withText = all.filter((picture) => picture.lines.length > 0)
      const scanned = (yield* Ref.get(progress)).get(gameId)
      const notice = (yield* Ref.get(notices)).get(gameId)
      const prefix = `${gameId}\u0000`

      const translating = [...(yield* Ref.get(busy)).entries()].filter(
        ([key, state]) => key.startsWith(prefix) && state === 'translating',
      ).length

      return {
        revision: current,
        scanned: all.length,
        withText: withText.length,
        approved: withText.filter((picture) => picture.status === 'approved').length,
        kept: withText.filter((picture) => picture.status === 'kept').length,
        translating,
        canClean: yield* cleaner.ready,
        ...(scanned === undefined ? {} : { scan: scanned }),
        ...(notice === undefined ? {} : { notice }),
      } satisfies PicturesSummary
    })

    const saveLine = Effect.fn('Pictures.saveLine')(function* (
      gameId: string,
      key: string,
      lineId: number,
      edit: LineEdit,
    ) {
      const stored = yield* storedOf(gameId, key)
      const line = stored.lines.find((candidate) => candidate.id === lineId)

      if (line === undefined) {
        return yield* notFound()
      }

      const source = edit.source?.trim() || line.source

      for (const picture of yield* store.pictures(gameId)) {
        const same = picture.picture === key

        if (!same && (picture.group !== stored.group || stored.group === '')) {
          continue
        }

        const lines = picture.lines.map((candidate) =>
          (same ? candidate.id === lineId : candidate.ocr === line.ocr)
            ? edited(candidate, { ...edit, source })
            : candidate,
        )

        yield* reopen(gameId, picture)
        yield* change(gameId, picture.picture, { lines })
      }

      const translated = edit.translation?.trim() ?? ''

      if (translated !== '') {
        const { targetLanguage } = yield* translation
        const entry = { gameId, targetLanguage, origin: 'image' as const, key: source }

        yield* texts.saveTranslation({ ...entry, translatedText: translated, scene: key })
        yield* texts.edit(entry, translated)

        for (const other of yield* store.pictures(gameId)) {
          if (
            other.picture !== key &&
            other.lines.some((candidate) => candidate.source === source)
          ) {
            yield* reopen(gameId, other)
          }
        }
      }

      yield* push(gameId)
      yield* changed

      return yield* shownOne(gameId, key)
    })

    const addLine = Effect.fn('Pictures.addLine')(function* (
      gameId: string,
      key: string,
      box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
      image: RgbaImage,
    ) {
      const stored = yield* storedOf(gameId, key)
      const read = yield* ocr.recognize(image)

      const text = cleanLine(
        read.paragraphs
          .flatMap((paragraph) => paragraph.lines.map((line) => cleanLine(line.text)))
          .join(' '),
      )

      const id = Math.max(0, ...stored.lines.map((line) => line.id)) + 1
      const line: PictureLine = { id, ...box, ocr: text, source: text, keep: false }

      yield* reopen(gameId, stored)
      yield* change(gameId, key, { lines: [...stored.lines, line] })
      yield* push(gameId)
      yield* changed

      return yield* shownOne(gameId, key)
    })

    const removeLine = Effect.fn('Pictures.removeLine')(function* (
      gameId: string,
      key: string,
      lineId: number,
    ) {
      const stored = yield* storedOf(gameId, key)

      yield* reopen(gameId, stored)

      yield* change(gameId, key, {
        lines: stored.lines.filter((line) => line.id !== lineId),
      })

      yield* push(gameId)
      yield* changed

      return yield* shownOne(gameId, key)
    })

    const clean = Effect.fn('Pictures.clean')(function* (gameId: string, key: string) {
      const stored = yield* storedOf(gameId, key)
      const wanted = cleanKeyOf(stored.lines)
      const output = fileOf(gameId, 'cleaned', key)
      const exists = yield* fs.exists(output).pipe(Effect.orElseSucceed(() => false))

      if (stored.cleanedKey === wanted && exists) {
        return yield* shownOne(gameId, key)
      }

      const cleaning = stored.lines.filter((line) => !line.keep)
      const source = fileOf(gameId, 'original', key)

      yield* setIn(busy, busyKey(gameId, key), 'cleaning')

      const colours = yield* Effect.ensuring(
        cleaner.clean(
          source,
          output,
          cleaning.map((line) => [line.x, line.y, line.x + line.w, line.y + line.h] as const),
        ),
        setIn(busy, busyKey(gameId, key), undefined),
      )

      const lines = stored.lines.map((line) => {
        const index = cleaning.findIndex((candidate) => candidate.id === line.id)
        const found = colours[index]

        if (found === undefined) {
          return line
        }

        const { outline: _outline, ...rest } = line

        return found.outline === undefined
          ? { ...rest, fill: found.fill }
          : { ...rest, fill: found.fill, outline: found.outline }
      })

      yield* change(gameId, key, { lines, cleanedKey: wanted })
      yield* changed

      return yield* shownOne(gameId, key)
    })

    const approve = Effect.fn('Pictures.approve')(function* (
      gameId: string,
      key: string,
      image: Uint8Array,
    ) {
      const stored = yield* storedOf(gameId, key)

      if (!isPng(image)) {
        return yield* failed('The translated picture is not a PNG.')
      }

      const file = translatedFileOf(gameId, key, yield* Clock.currentTimeMillis)

      yield* writeFile(file, image)
      yield* removeFile(stored.translatedFile)
      yield* change(gameId, key, { status: 'approved', translatedFile: file })
      yield* push(gameId)
      yield* changed

      return yield* shownOne(gameId, key)
    })

    const setStatus = Effect.fn('Pictures.setStatus')(function* (
      gameId: string,
      key: string,
      status: 'to-review' | 'kept',
    ) {
      const stored = yield* storedOf(gameId, key)

      yield* removeFile(stored.translatedFile)
      yield* change(gameId, key, { status, translatedFile: undefined })
      yield* push(gameId)
      yield* changed

      return yield* shownOne(gameId, key)
    })

    const styleKey = (gameId: string) => `picture-style:${gameId}`

    return PicturesRpc.of({
      watchPictures: ({ gameId }) =>
        SubscriptionRef.changes(revision).pipe(
          Stream.mapEffect((current) => summaryOf(gameId, current)),
        ),
      listPictures: ({ gameId }) => shown(gameId),
      findPictureText: ({ gameId }) =>
        Effect.gen(function* () {
          const game = yield* gameOf(gameId)

          yield* setIn(notices, gameId, undefined)

          yield* FiberMap.run(
            scans,
            gameId,
            scan(game).pipe(
              Effect.catch((error) =>
                Effect.andThen(
                  logFailure(gameId, 'finding text')(error),
                  setIn(notices, gameId, error.message),
                ),
              ),
              Effect.ensuring(setIn(progress, gameId, undefined)),
            ),
          )
        }),
      cancelPictureScan: ({ gameId }) => FiberMap.remove(scans, gameId),
      translatePictures: ({ gameId, pictures }) =>
        Effect.gen(function* () {
          yield* gameOf(gameId)

          const chosen = yield* toTranslate(gameId, pictures)

          for (const picture of chosen) {
            yield* setIn(busy, busyKey(gameId, picture.picture), 'translating')
          }

          yield* FiberMap.run(
            translations,
            `${gameId}\u0000${chosen.map((picture) => picture.picture).join('\u0000')}`,
            translateAll(gameId, chosen),
          )
        }),
      savePictureLine: ({ gameId, picture, line, ...edit }) =>
        saveLine(gameId, picture, line, edit),
      addPictureLine: ({ gameId, picture, box, image }) => addLine(gameId, picture, box, image),
      removePictureLine: ({ gameId, picture, line }) => removeLine(gameId, picture, line),
      cleanPicture: ({ gameId, picture }) => clean(gameId, picture),
      approvePicture: ({ gameId, picture, image }) => approve(gameId, picture, image),
      setPictureStatus: ({ gameId, picture, status }) => setStatus(gameId, picture, status),
      getPictureStyle: ({ gameId }) =>
        Effect.orElseSucceed(styles.get(styleKey(gameId)), () => defaultPictureStyle),
      savePictureStyle: ({ gameId, style }) =>
        Effect.orDie(styles.set(styleKey(gameId), style)).pipe(Effect.as(style)),
    })
  }),
)
