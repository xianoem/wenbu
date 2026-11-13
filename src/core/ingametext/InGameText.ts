import {
  Duration,
  Effect,
  FiberMap,
  Option,
  Ref,
  Schedule,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { defaultTranslationSettings, TranslationSettings } from '#contract/GameTranslation'
import {
  defaultInGameTextSettings,
  type ImageScanProgress,
  type InGameTextEntry,
  InGameTextError,
  type InGameTextOrigin,
  InGameTextRpc,
  InGameTextSettings,
  type InGameTextSummary,
  TextFit,
} from '#contract/InGameText'
import type { Game } from '#contract/Library'
import { Games } from '../library/Games'
import type { ConnectedGame } from '../livecontrols/LiveControls'
import { LiveControls } from '../livecontrols/LiveControls'
import { LlmClient } from '../llm/LlmClient'
import * as SettingsStore from '../platform/SettingsStore'
import { parseReply, systemPrompt } from '../translation/Batches'
import { decodeRgba, listGameImages } from './GameImages'
import { ImageOcr, textBoxes } from './ImageOcr'
import { type EntryKey, InGameTextStore, type StoredEntry } from './InGameTextStore'

const Report = Schema.Struct({
  key: Schema.String,
  fit: Schema.Literals(['missing', ...TextFit.literals]),
  width: Schema.Number,
  size: Schema.Number,
  scene: Schema.String,
})

type Report = typeof Report.Type

const decodeReports = Schema.decodeUnknownEffect(Schema.Array(Report))

const isTextFit = Schema.is(TextFit)

const sceneNames: Readonly<Record<string, string>> = {
  Scene_Title: 'Title screen',
  Scene_Map: 'Map',
  Scene_Menu: 'Menu',
  Scene_Item: 'Items',
  Scene_Skill: 'Skills',
  Scene_Equip: 'Equipment',
  Scene_Status: 'Status',
  Scene_Options: 'Options',
  Scene_Config: 'Options',
  Scene_Save: 'Save',
  Scene_Load: 'Load',
  Scene_File: 'Save files',
  Scene_Shop: 'Shop',
  Scene_Name: 'Name input',
  Scene_Battle: 'Battle',
  Scene_End: 'Game end',
  Scene_GameEnd: 'Game end',
  Scene_Gameover: 'Game over',
  Scene_Debug: 'Debug',
}

export const sceneName = (raw: string) => {
  const known = sceneNames[raw]

  if (known !== undefined) {
    return known
  }

  const name = raw.replace(/^Scene_/, '').replace(/([a-z])([A-Z])/g, '$1 $2')

  return name.trim() === '' ? 'Game' : name
}

export const budgetOf = (width: number, fontSize: number) =>
  width > 0 && fontSize > 0 ? Math.max(3, Math.floor(width / (fontSize * 0.55))) : undefined

interface Wanted {
  readonly key: string
  readonly budget: number | undefined
}

interface ImageWanted extends Wanted {
  readonly scene: string
  readonly width: number
  readonly size: number
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const uiPrompt = Effect.fnUntraced(function* (
  targetLanguage: string,
  batch: ReadonlyArray<Wanted>,
) {
  const items = Object.fromEntries(
    batch.map((item, index) => [
      String(index + 1),
      item.budget === undefined ? { text: item.key } : { text: item.key, max: item.budget },
    ]),
  )

  return [
    `Translate these RPG Maker menu and interface strings into ${targetLanguage}.`,
    'Each item has its text and, when known, "max": the most characters that fit where the game draws it. Prefer the short wording a game menu uses, and stay within max.',
    'Keep placeholders like {0} and {1}, and RPG Maker control codes like \\C[2].',
    'Return only a JSON object whose keys are the given numbers and whose values are the translated strings.',
    yield* Effect.orDie(encodeJson(items)),
  ].join('\n\n')
})

const shortenPrompt = (targetLanguage: string, entry: StoredEntry, budget: number | undefined) =>
  [
    `This ${targetLanguage} text from a game menu is too wide for the space the game gives it.`,
    `Original: ${entry.key}`,
    `Translation: ${entry.translatedText}`,
    budget === undefined
      ? 'Write a shorter translation with the same meaning.'
      : `Write a translation of at most ${budget} characters with the same meaning.`,
    'Keep placeholders like {0}. Reply with the shorter translation only.',
  ].join('\n')

const toEntry = ({ shortened: _shortened, ...entry }: StoredEntry): InGameTextEntry => entry

const BATCH_SIZE = 40

const PUSH_SIZE = 500

const IMAGE_PUSH_SIZE = 50

const sameSummary = (left: InGameTextSummary, right: InGameTextSummary) =>
  left.strings === right.strings &&
  left.tooLong === right.tooLong &&
  left.images.withText === right.images.withText &&
  left.images.total === right.images.total &&
  left.scan?.done === right.scan?.done &&
  left.scan?.total === right.scan?.total &&
  left.notice === right.notice

const notFound = () =>
  new InGameTextError({ reason: 'not-found', message: 'This string is no longer in the list.' })

export interface InGameTextTiming {
  readonly poll: Duration.Input
}

export const makeInGameTextRpc = (timing: InGameTextTiming) =>
  InGameTextRpc.toLayer(
    Effect.gen(function* () {
      const live = yield* LiveControls
      const layerScope = yield* Scope.Scope
      const store = yield* InGameTextStore
      const llm = yield* LlmClient
      const games = yield* Games
      const ocr = yield* ImageOcr
      const scans = yield* FiberMap.make<string>()
      const progress = yield* Ref.make(new Map<string, ImageScanProgress>())
      const kv = yield* KeyValueStore.KeyValueStore
      const settingsStore = SettingsStore.make(kv, InGameTextSettings, defaultInGameTextSettings)

      const translationStore = SettingsStore.make(
        kv,
        TranslationSettings,
        defaultTranslationSettings,
      )

      const cache = yield* Ref.make(new Map<string, InGameTextSettings>())
      const inFlight = yield* Ref.make(new Set<string>())
      const notices = yield* Ref.make(new Map<string, string>())
      const revision = yield* SubscriptionRef.make(0)

      const changed = SubscriptionRef.update(revision, (n) => n + 1)

      const settingsKey = (gameId: string) => `in-game-text:${gameId}`

      const settingsOf = (gameId: string) =>
        Effect.flatMap(Ref.get(cache), (all) => {
          const cached = all.get(gameId)

          if (cached !== undefined) {
            return Effect.succeed(cached)
          }

          return settingsStore.get(settingsKey(gameId)).pipe(
            Effect.orElseSucceed(() => defaultInGameTextSettings),
            Effect.tap((loaded) => Ref.update(cache, (map) => new Map(map).set(gameId, loaded))),
          )
        })

      const translation = Effect.orElseSucceed(
        translationStore.get('game-translation'),
        () => defaultTranslationSettings,
      )

      const notify = (gameId: string, message: string | undefined) =>
        Ref.update(notices, (map) => {
          const next = new Map(map)

          if (message === undefined) {
            next.delete(gameId)
          } else {
            next.set(gameId, message)
          }

          return next
        }).pipe(Effect.andThen(changed))

      const sessionFor = (gameId: string) =>
        Effect.map(
          live.session,
          Option.filter((session) => session.game.id === gameId),
        )

      const logFailure = (game: string, action: string) => (error: { readonly message: string }) =>
        Effect.logWarning('In-game text failed').pipe(
          Effect.annotateLogs({ feature: 'ingametext', game, action, detail: error.message }),
        )

      const pushTexts = (session: ConnectedGame, pairs: ReadonlyArray<readonly [string, string]>) =>
        Effect.forEach(
          Array.from({ length: Math.ceil(pairs.length / PUSH_SIZE) }, (_, index) =>
            pairs.slice(index * PUSH_SIZE, (index + 1) * PUSH_SIZE),
          ),
          (chunk) => session.runtime.call('addTexts', [chunk.map(([key, text]) => [key, text])]),
          { discard: true },
        ).pipe(Effect.catch(logFailure(session.game.id, 'sending translations')))

      const pushTextsTo = (gameId: string, pairs: ReadonlyArray<readonly [string, string]>) =>
        Effect.flatMap(sessionFor(gameId), (session) =>
          Option.isSome(session) ? pushTexts(session.value, pairs) : Effect.void,
        )

      const applyOptions = (session: ConnectedGame, settings: InGameTextSettings) =>
        session.runtime
          .call('setTextOptions', [
            settings.uiText,
            settings.imageText,
            settings.wordWrap,
            settings.reflow,
            settings.imageStyle,
            settings.originalKey,
          ])
          .pipe(Effect.catch(logFailure(session.game.id, 'applying settings')))

      const pushDictionary = Effect.fnUntraced(function* (session: ConnectedGame) {
        const { targetLanguage } = yield* translation

        yield* pushTexts(session, yield* store.dictionary(session.game.id, targetLanguage, 'ui'))
      })

      const setProgress = (gameId: string, value: ImageScanProgress | undefined) =>
        Ref.update(progress, (map) => {
          const next = new Map(map)

          if (value === undefined) {
            next.delete(gameId)
          } else {
            next.set(gameId, value)
          }

          return next
        }).pipe(Effect.andThen(changed))

      const imagePayload = Effect.fnUntraced(function* (gameId: string) {
        const { targetLanguage } = yield* translation
        const translated = new Map(yield* store.dictionary(gameId, targetLanguage, 'image'))
        const images = yield* store.images(gameId)

        return images.flatMap((image) => {
          const boxes = image.boxes.flatMap((box) => {
            const text = translated.get(box.key)

            return text === undefined ? [] : [[box.x, box.y, box.w, box.h, text]]
          })

          return boxes.length === 0 ? [] : [[image.imagePath, boxes]]
        })
      })

      const pushImages = (session: ConnectedGame) =>
        Effect.gen(function* () {
          const payload = yield* imagePayload(session.game.id)

          for (let start = 0; start < payload.length; start += IMAGE_PUSH_SIZE) {
            yield* session.runtime.call('addImages', [
              payload.slice(start, start + IMAGE_PUSH_SIZE),
            ])
          }
        }).pipe(Effect.catch(logFailure(session.game.id, 'sending images')))

      const pushImagesTo = (gameId: string) =>
        Effect.gen(function* () {
          const session = yield* sessionFor(gameId)

          if (Option.isSome(session) && (yield* settingsOf(gameId)).imageText) {
            yield* pushImages(session.value)
          }
        })

      const noPreset = () =>
        new InGameTextError({
          reason: 'not-ready',
          message: 'Choose an LLM preset under Translation to translate in-game text.',
        })

      const requestTranslations = Effect.fnUntraced(function* (
        gameId: string,
        settings: TranslationSettings,
        batch: ReadonlyArray<Wanted>,
      ) {
        if (settings.presetId === '') {
          return yield* noPreset()
        }

        const reply = yield* llm
          .complete({
            presetId: settings.presetId,
            feature: 'in-game-text',
            gameId,
            system: systemPrompt,
            prompt: yield* uiPrompt(settings.targetLanguage, batch),
            timeout: Duration.seconds(Math.max(10, settings.timeoutSeconds)),
          })
          .pipe(
            Effect.mapError(
              (error) => new InGameTextError({ reason: 'failed', message: error.message }),
            ),
          )

        const items = batch.map((item) => ({
          id: item.key,
          src: item.key,
          context: '',
          entryIds: [],
        }))

        return yield* parseReply(reply.text, items, settings).pipe(
          Effect.mapError(
            () =>
              new InGameTextError({
                reason: 'failed',
                message: 'The model answered with something other than the translations.',
              }),
          ),
        )
      })

      const translateBatch = Effect.fnUntraced(function* (
        session: ConnectedGame,
        batch: ReadonlyArray<Wanted & { readonly scene: string; readonly report: Report }>,
      ) {
        const settings = yield* translation
        const gameId = session.game.id
        const translations = yield* requestTranslations(gameId, settings, batch)

        yield* Effect.forEach(
          batch,
          (item) => {
            const text = translations.get(item.key)

            return text === undefined
              ? Effect.void
              : store.saveTranslation({
                  gameId,
                  targetLanguage: settings.targetLanguage,
                  origin: 'ui',
                  key: item.key,
                  translatedText: text,
                  scene: item.scene,
                  allowedWidth: item.report.width > 0 ? Math.round(item.report.width) : undefined,
                  fontSize: item.report.size > 0 ? Math.round(item.report.size) : undefined,
                })
          },
          { discard: true },
        )

        yield* notify(gameId, undefined)
        yield* pushTexts(session, [...translations.entries()])
      })

      const shortenEntry = Effect.fnUntraced(function* (gameId: string, entry: StoredEntry) {
        const settings = yield* translation

        if (settings.presetId === '') {
          return yield* noPreset()
        }

        const budget =
          entry.allowedWidth === undefined || entry.fontSize === undefined
            ? undefined
            : budgetOf(entry.allowedWidth, entry.fontSize)

        const reply = yield* llm
          .complete({
            presetId: settings.presetId,
            feature: 'in-game-text',
            gameId,
            system: systemPrompt,
            prompt: shortenPrompt(settings.targetLanguage, entry, budget),
            timeout: Duration.seconds(Math.max(10, settings.timeoutSeconds)),
          })
          .pipe(
            Effect.mapError(
              (error) => new InGameTextError({ reason: 'failed', message: error.message }),
            ),
          )

        return reply.text.trim().replace(/^["']|["']$/g, '')
      })

      const autoShorten = Effect.fnUntraced(function* (key: EntryKey) {
        const entry = yield* store.entry(key)

        if (Option.isNone(entry) || entry.value.shortened || entry.value.edited) {
          return
        }

        if (entry.value.locked) {
          return
        }

        const shorter = yield* shortenEntry(key.gameId, entry.value)

        yield* store.saveShortened(key, shorter)
        yield* changed
        yield* pushTextsTo(key.gameId, [[key.key, shorter]])
      })

      const handleReports = Effect.fnUntraced(function* (
        session: ConnectedGame,
        settings: InGameTextSettings,
        reports: ReadonlyArray<Report>,
      ) {
        const gameId = session.game.id
        const { targetLanguage } = yield* translation
        const known: Array<readonly [string, string]> = []
        const wanted: Array<Wanted & { readonly scene: string; readonly report: Report }> = []
        const busy = yield* Ref.get(inFlight)

        for (const report of reports) {
          const key: EntryKey = { gameId, targetLanguage, origin: 'ui', key: report.key }

          if (isTextFit(report.fit)) {
            yield* store.recordFit(
              key,
              report.fit,
              report.width > 0 ? Math.round(report.width) : undefined,
            )

            if (report.fit === 'too-long' && settings.whenTooLong === 'shorten') {
              yield* Effect.forkIn(
                autoShorten(key).pipe(Effect.catch(logFailure(gameId, 'shortening'))),
                layerScope,
              )
            }

            continue
          }

          const stored = yield* store.entry(key)

          if (Option.isSome(stored)) {
            known.push([report.key, stored.value.translatedText])
          } else if (!busy.has(`${gameId}\u0000${report.key}`)) {
            wanted.push({
              key: report.key,
              budget: budgetOf(report.width, report.size),
              scene: sceneName(report.scene),
              report,
            })
          }
        }

        if (reports.some((report) => isTextFit(report.fit))) {
          yield* changed
        }

        if (known.length > 0) {
          yield* pushTexts(session, known)
        }

        for (let start = 0; start < wanted.length; start += BATCH_SIZE) {
          const batch = wanted.slice(start, start + BATCH_SIZE)
          const ids = batch.map((item) => `${gameId}\u0000${item.key}`)

          yield* Ref.update(inFlight, (set) => new Set([...set, ...ids]))

          yield* Effect.forkIn(
            translateBatch(session, batch).pipe(
              Effect.catch((error) =>
                Effect.andThen(
                  logFailure(gameId, 'translating')(error),
                  notify(gameId, `Wenbu could not translate in-game text: ${error.message}`),
                ),
              ),
              Effect.andThen(changed),
              Effect.ensuring(
                Ref.update(inFlight, (set) => {
                  const next = new Set(set)

                  for (const id of ids) {
                    next.delete(id)
                  }

                  return next
                }),
              ),
            ),
            layerScope,
          )
        }
      })

      const poll = (session: ConnectedGame) =>
        Effect.gen(function* () {
          const settings = yield* settingsOf(session.game.id)

          if (!settings.uiText) {
            return
          }

          const reports = yield* session.runtime
            .call('takeText')
            .pipe(Effect.flatMap((value) => decodeReports(value)))

          if (reports.length > 0) {
            yield* handleReports(session, settings, reports)
          }
        }).pipe(Effect.catch(logFailure(session.game.id, 'reading the game')))

      const runSession = Effect.fnUntraced(function* (session: ConnectedGame) {
        const settings = yield* settingsOf(session.game.id)

        yield* applyOptions(session, settings)

        if (settings.uiText) {
          yield* pushDictionary(session)
        }

        if (settings.imageText) {
          yield* pushImages(session)
        }

        yield* poll(session).pipe(Effect.repeat(Schedule.spaced(timing.poll)))
      })

      yield* live.sessions.pipe(
        Stream.switchMap((session) =>
          Option.isSome(session) ? Stream.fromEffect(runSession(session.value)) : Stream.empty,
        ),
        Stream.runDrain,
        Effect.forkScoped,
      )

      const scanImages = Effect.fnUntraced(function* (game: Game) {
        const images = yield* listGameImages(game)

        const known = new Map(
          (yield* store.images(game.id)).map((image) => [image.imagePath, image]),
        )

        let done = 0

        yield* setProgress(game.id, { done, total: images.length })

        for (const image of images) {
          const before = known.get(image.path)

          const unchanged =
            before !== undefined &&
            before.fileSize === image.fileSize &&
            before.modifiedAt === image.modifiedAt

          if (!unchanged) {
            const rgba = yield* image.read.pipe(
              Effect.flatMap((bytes) => decodeRgba(bytes)),
              Effect.option,
            )

            const readable = Option.filter(
              rgba,
              (decoded) => decoded.width >= 24 && decoded.height >= 12,
            )

            const boxes = Option.isSome(readable)
              ? textBoxes(yield* ocr.recognize(readable.value))
              : []

            yield* store.saveImage(game.id, {
              imagePath: image.path,
              fileSize: image.fileSize,
              modifiedAt: image.modifiedAt,
              boxes,
            })
          }

          done++
          yield* setProgress(game.id, { done, total: images.length })
        }

        const settings = yield* translation

        const translated = new Set(
          (yield* store.dictionary(game.id, settings.targetLanguage, 'image')).map(([key]) => key),
        )

        const wanted = new Map<string, ImageWanted>()

        for (const image of yield* store.images(game.id)) {
          for (const box of image.boxes) {
            if (!translated.has(box.key) && !wanted.has(box.key)) {
              const size = Math.max(8, Math.round(box.h * 0.8))

              wanted.set(box.key, {
                key: box.key,
                budget: budgetOf(box.w, size),
                scene: image.imagePath,
                width: box.w,
                size,
              })
            }
          }
        }

        const all = [...wanted.values()]

        for (let start = 0; start < all.length; start += BATCH_SIZE) {
          const batch = all.slice(start, start + BATCH_SIZE)
          const translations = yield* requestTranslations(game.id, settings, batch)

          yield* Effect.forEach(
            batch,
            (item) => {
              const text = translations.get(item.key)

              return text === undefined
                ? Effect.void
                : store.saveTranslation({
                    gameId: game.id,
                    targetLanguage: settings.targetLanguage,
                    origin: 'image',
                    key: item.key,
                    translatedText: text,
                    scene: item.scene,
                    allowedWidth: item.width,
                    fontSize: item.size,
                  })
            },
            { discard: true },
          )

          yield* changed
        }

        yield* pushImagesTo(game.id)
      })

      const saveSettings = Effect.fn('InGameText.saveSettings')(function* (
        gameId: string,
        settings: InGameTextSettings,
      ) {
        const before = yield* settingsOf(gameId)

        yield* Effect.orDie(settingsStore.set(settingsKey(gameId), settings))
        yield* Ref.update(cache, (map) => new Map(map).set(gameId, settings))

        const session = yield* sessionFor(gameId)

        if (Option.isSome(session)) {
          yield* applyOptions(session.value, settings)

          if (settings.uiText && !before.uiText) {
            yield* pushDictionary(session.value)
          }

          if (settings.imageText && !before.imageText) {
            yield* pushImages(session.value)
          }
        }

        yield* changed

        return settings
      })

      const summaryOf = Effect.fnUntraced(function* (gameId: string) {
        const { targetLanguage } = yield* translation
        const counts = yield* store.counts(gameId, targetLanguage)
        const notice = (yield* Ref.get(notices)).get(gameId)
        const scan = (yield* Ref.get(progress)).get(gameId)

        return {
          ...counts,
          ...(scan === undefined ? {} : { scan }),
          ...(notice === undefined ? {} : { notice }),
        } satisfies InGameTextSummary
      })

      const entryKey = Effect.fnUntraced(function* (
        gameId: string,
        origin: InGameTextOrigin,
        key: string,
      ) {
        const { targetLanguage } = yield* translation

        return { gameId, targetLanguage, origin, key } satisfies EntryKey
      })

      const afterChange = Effect.fnUntraced(function* (
        key: EntryKey,
        entry: Option.Option<StoredEntry>,
      ) {
        if (Option.isNone(entry)) {
          return yield* notFound()
        }

        yield* changed

        if (key.origin === 'ui') {
          yield* pushTextsTo(key.gameId, [[key.key, entry.value.translatedText]])
        } else {
          yield* pushImagesTo(key.gameId)
        }

        return toEntry(entry.value)
      })

      return InGameTextRpc.of({
        getInGameTextSettings: ({ gameId }) => settingsOf(gameId),
        saveInGameTextSettings: ({ gameId, settings }) => saveSettings(gameId, settings),
        watchInGameTextSummary: ({ gameId }) =>
          SubscriptionRef.changes(revision).pipe(
            Stream.mapEffect(() => summaryOf(gameId)),
            Stream.changesWith(sameSummary),
          ),
        listInGameTexts: ({ gameId, filter, search }) =>
          Effect.flatMap(translation, ({ targetLanguage }) =>
            store.entries(gameId, targetLanguage, filter, search),
          ).pipe(Effect.map((entries) => entries.map((entry) => toEntry(entry)))),
        saveInGameText: ({ gameId, origin, key, translatedText }) =>
          Effect.gen(function* () {
            const entry = yield* entryKey(gameId, origin, key)

            return yield* afterChange(entry, yield* store.edit(entry, translatedText.trim()))
          }),
        setInGameTextLocked: ({ gameId, origin, key, locked }) =>
          Effect.gen(function* () {
            const entry = yield* entryKey(gameId, origin, key)

            return yield* afterChange(entry, yield* store.setLocked(entry, locked))
          }),
        shortenInGameText: ({ gameId, origin, key }) =>
          Effect.gen(function* () {
            const entry = yield* entryKey(gameId, origin, key)
            const stored = yield* store.entry(entry)

            if (Option.isNone(stored)) {
              return yield* notFound()
            }

            const shorter = yield* shortenEntry(gameId, stored.value)

            return yield* afterChange(entry, yield* store.edit(entry, shorter))
          }),
        scanGameImages: ({ gameId }) =>
          Effect.gen(function* () {
            const game = yield* games
              .get(gameId)
              .pipe(
                Effect.mapError(
                  (error) => new InGameTextError({ reason: 'not-found', message: error.message }),
                ),
              )

            yield* notify(gameId, undefined)

            yield* FiberMap.run(
              scans,
              gameId,
              scanImages(game).pipe(
                Effect.catch((error) =>
                  Effect.andThen(
                    logFailure(gameId, 'scanning images')(error),
                    notify(gameId, error.message),
                  ),
                ),
                Effect.ensuring(setProgress(gameId, undefined)),
              ),
            )
          }),
        cancelImageScan: ({ gameId }) => FiberMap.remove(scans, gameId),
      })
    }),
  )

export const InGameTextRpcLive = makeInGameTextRpc({ poll: '300 millis' })
