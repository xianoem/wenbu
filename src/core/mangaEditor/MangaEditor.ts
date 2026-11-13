import {
  Config,
  Crypto,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import type { OcrResult } from '#contract/Detections'
import { bundledFonts, defaultMangaSettings, languageName, MangaSettings } from '#contract/Manga'
import {
  BreakCandidate,
  type BubbleLayout,
  type ChatMessage,
  type EditorPage,
  type Lettering,
  linesOf,
  MangaEditorError,
  MangaEditorRpc,
  type MangaEditorSettings,
  type MangaEditorState,
  type PageBox,
  type PageStep,
  passageSeparator,
  type TextBlock,
  defaultLettering,
} from '#contract/MangaEditor'
import { ScreenAiOcr } from '../detections/ScreenAiOcr'
import { cleanLine } from '../ingametext/ImageOcr'
import { type Completion, LlmClient } from '../llm/LlmClient'
import { mangaSettingsKey, readableError } from '../manga/Manga'
import { workerOptions } from '../manga/MangaOptions'
import { editorOutputFolder, listPages, type MangaPage } from '../manga/MangaPages'
import { cleanSource } from '../manga/MangaPrompt'
import { EditorBlock, EditorOptions, MangaRuntime } from '../manga/MangaRuntime'
import * as SettingsStore from '../platform/SettingsStore'
import { Plugins } from '../plugins/Plugins'
import {
  alternativesPrompt,
  chatContext,
  chatSystemPrompt,
  type ContextLine,
  linesPrompt,
  parseAlternatives,
  parseChat,
  parseLines,
  type PromptLine,
  splitParts,
  systemPrompt,
} from './MangaEditorPrompt'
import { type ImageSize, imageSizeOf } from './ImageHeader'
import * as MangaEditorStore from './MangaEditorStore'
import { insertionIndex } from './ReadingOrder'

const ScanResult = Schema.Struct({
  blocks: Schema.Array(
    Schema.Struct({
      box: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
      area: Schema.optional(
        Schema.NullOr(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])),
      ),
      text: Schema.String,
      fg: Schema.Array(Schema.Int),
      bg: Schema.Array(Schema.Int),
      fontSize: Schema.Int,
      vertical: Schema.Boolean,
    }),
  ),
})

const decodeScan = Schema.decodeUnknownEffect(ScanResult)

const decodeBreaks = Schema.decodeUnknownEffect(
  Schema.Struct({ candidates: Schema.Array(BreakCandidate) }),
)

const contextLines = 12

const formatOf = (file: string) => {
  const extension = file.slice(file.lastIndexOf('.')).toLowerCase()

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'jpeg'
  }

  return extension === '.webp' ? 'webp' : 'png'
}

const headerBytes = 256 * 1024

const undoLimit = 50

type StoredBlock = MangaEditorStore.StoredBlock

interface Snapshot {
  readonly blocks: ReadonlyArray<StoredBlock>
  readonly cleaned?: string
}

interface History {
  readonly undo: ReadonlyArray<Snapshot>
  readonly redo: ReadonlyArray<Snapshot>
}

interface Gallery {
  readonly folder: string
  readonly outputFolder: string
  readonly exportFolder: string
  readonly pages: ReadonlyArray<MangaPage>
  readonly state: SubscriptionRef.SubscriptionRef<MangaEditorState>
  readonly running: Ref.Ref<ReadonlyMap<string, PageStep>>
  readonly errors: Ref.Ref<ReadonlyMap<string, string>>
  readonly history: Ref.Ref<ReadonlyMap<string, History>>
  readonly sizes: ReadonlyMap<string, ImageSize>
  readonly copies: Ref.Ref<number>
  readonly scope: Scope.Closeable
}

const notOpen = new MangaEditorError({
  reason: 'not-found',
  message: 'This gallery is not open in the editor.',
})

const missingPage = new MangaEditorError({
  reason: 'not-found',
  message: 'The page is not part of this gallery.',
})

const missingLine = new MangaEditorError({
  reason: 'not-found',
  message: 'The line is no longer on this page.',
})

export const fitParts = (parts: ReadonlyArray<string>, count: number) => {
  if (parts.length <= count) {
    return [...parts, ...Array.from({ length: count - parts.length }, () => '')]
  }

  return [...parts.slice(0, count - 1), parts.slice(count - 1).join(' ')]
}

const joinParts = (parts: ReadonlyArray<string>) => parts.join(` ${passageSeparator} `)

const edges = (box: PageBox): readonly [number, number, number, number] => [
  box.x,
  box.y,
  box.x + box.width,
  box.y + box.height,
]

export const ocrText = (ocr: OcrResult) => {
  const lines = ocr.paragraphs.flatMap((paragraph) => paragraph.lines)

  const vertical =
    lines.filter(
      (line) =>
        line.box !== undefined &&
        line.box.height * ocr.image.height > line.box.width * ocr.image.width,
    ).length >
    lines.length / 2

  const ordered = vertical
    ? lines.toSorted((left, right) => (right.box?.centerX ?? 0) - (left.box?.centerX ?? 0))
    : lines

  return ordered.map((line) => cleanLine(line.text)).join('')
}

const toPublic = (block: StoredBlock): TextBlock => {
  const { page: _page, fg, bg: _bg, fontSize: _fontSize, vertical: _vertical, ...rest } = block
  const [red, green, blue] = fg ?? []

  return red === undefined || green === undefined || blue === undefined
    ? rest
    : { ...rest, ink: [red, green, blue] }
}

const laidOut = <B extends { readonly translation?: string; readonly lettering?: object }>(
  block: StoredBlock,
  worker: B,
  layout: BubbleLayout | undefined,
) =>
  layout === undefined || block.translation.trim() === ''
    ? worker
    : {
        ...worker,
        translation: layout.lines.join('\n'),
        lettering: { ...worker.lettering, breakMode: 'manual' as const, size: layout.size },
      }

export const doneSteps = (
  page: MangaEditorStore.StoredPage | undefined,
  blocks: ReadonlyArray<{ readonly translation: string }>,
): ReadonlyArray<PageStep> => {
  const steps: Array<PageStep> = []

  if (page?.scannedAt !== undefined || blocks.length > 0) {
    steps.push('scan')
  }

  if (blocks.length > 0 && blocks.every((block) => block.translation.trim() !== '')) {
    steps.push('translate')
  }

  if ((page?.cleanVersion ?? 0) > 0) {
    steps.push('clean')
  }

  if ((page?.renderVersion ?? 0) > 0) {
    steps.push('letter')
  }

  return steps
}

const RenderInput = Schema.Struct({
  clean: Schema.Int,
  blocks: Schema.Array(EditorBlock),
  options: EditorOptions,
})

const encodeRenderInput = Schema.encodeEffect(Schema.fromJsonString(RenderInput))

const statusAfter = (
  block: StoredBlock,
  approved: boolean | undefined,
  typed: boolean,
): MangaEditorStore.BlockPatch => {
  if (approved !== undefined) {
    return { status: approved ? 'approved' : 'draft', error: null }
  }

  if (!typed) {
    return {}
  }

  return { status: block.status === 'approved' ? 'approved' : 'draft', error: null }
}

const fontOf = (font: string | undefined, fontFolder: (font: string) => string) => {
  if (font === undefined) {
    return {}
  }

  return bundledFonts.some((bundled) => bundled === font)
    ? { fontDir: fontFolder(font) }
    : { fontFamily: font }
}

const workerLettering = (
  lettering: Lettering,
  settings: MangaEditorSettings,
  fontFolder: (font: string) => string,
) => ({
  breakMode: lettering.breakMode,
  avoidOrphans: lettering.avoidOrphans,
  hyphenate: lettering.hyphenate,
  uppercase: settings.uppercase,
  ...fontOf(lettering.font, fontFolder),
  ...(lettering.size === undefined ? {} : { size: lettering.size }),
  ...(lettering.leading === undefined ? {} : { leading: lettering.leading }),
  ...(lettering.textBox === undefined ? {} : { textBox: edges(lettering.textBox) }),
})

const workerBlock = (
  block: StoredBlock,
  settings: MangaEditorSettings,
  fontFolder: (font: string) => string,
) => ({
  box: edges(block.box),
  text: block.source,
  translation: block.translation,
  vertical: block.vertical,
  lettering: workerLettering(block.lettering, settings, fontFolder),
  ...(block.fg === undefined ? {} : { fg: block.fg }),
  ...(block.bg === undefined ? {} : { bg: block.bg }),
  ...(block.fontSize === undefined ? {} : { fontSize: block.fontSize }),
})

const settingsFrom = (manga: MangaSettings): MangaEditorSettings => ({
  presetId: manga.presetId,
  targetLanguage: manga.targetLanguage,
  seriesNotes: '',
  font: manga.font,
  minFontSize: manga.minFontSize,
  maxFontSize: manga.maxFontSize,
  kindSizes: {},
  outline: manga.textBorder,
  outlineColor: manga.borderColor,
  uppercase: manga.uppercase,
  cleanMethod: 'fill',
})

const isHexColor = (value: string) => /^#[\da-f]{6}$/i.test(value)

const invalid = (message: string) => new MangaEditorError({ reason: 'invalid', message })

const checkSettings = (settings: MangaEditorSettings) =>
  Effect.gen(function* () {
    if (settings.font.trim() === '') {
      return yield* invalid('Choose a font.')
    }

    if (
      settings.minFontSize < 6 ||
      settings.maxFontSize < settings.minFontSize ||
      settings.maxFontSize > 300
    ) {
      return yield* invalid(
        'The largest size must be at least the smallest, and both between 6 and 300.',
      )
    }

    const sizes = Object.values(settings.kindSizes).filter((size) => size !== undefined)

    if (sizes.some((size) => size < 4 || size > 400)) {
      return yield* invalid('Text sizes must be between 4 and 400.')
    }

    if (settings.sizeReference !== undefined && settings.sizeReference < 100) {
      return yield* invalid('The page height sizes are measured at must be at least 100 pixels.')
    }

    if (!isHexColor(settings.outlineColor)) {
      return yield* invalid('Choose an outline colour.')
    }

    return { ...settings, font: settings.font.trim(), presetId: settings.presetId.trim() }
  })

export const MangaEditorRpcLive = MangaEditorRpc.toLayer(
  Effect.gen(function* () {
    const store = yield* MangaEditorStore.make
    const llm = yield* LlmClient
    const plugins = yield* Plugins
    const runtime = yield* MangaRuntime
    const screenAi = yield* ScreenAiOcr
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const resources = yield* Config.String('WENBU_RESOURCES_DIR')
    const fontFolder = (font: string) => path.join(resources, 'fonts', font)

    const fontFile = Effect.fn('MangaEditor.fontFile')(function* (font: string) {
      if (!bundledFonts.some((bundled) => bundled === font)) {
        return undefined
      }

      const files = yield* fs.readDirectory(fontFolder(font)).pipe(Effect.orElseSucceed(() => []))
      const file = files.find((name) => /\.(ttf|otf)$/iu.test(name))

      return file === undefined ? undefined : path.join(fontFolder(font), file)
    })

    const dataDir = yield* Config.String('WENBU_DATA_DIR')
    const files = yield* Effect.context<Path.Path | FileSystem.FileSystem>()

    const mangaSettings = SettingsStore.make(
      yield* KeyValueStore.KeyValueStore,
      MangaSettings,
      defaultMangaSettings,
    )

    const getMangaSettings = Effect.orDie(mangaSettings.get(mangaSettingsKey))
    const galleries = yield* Ref.make<ReadonlyMap<string, Gallery>>(new Map())

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.get(galleries), (open) =>
        Effect.forEach(open.values(), (gallery) => Scope.close(gallery.scope, Exit.void), {
          discard: true,
        }),
      ),
    )

    const normalize = (folder: string) => path.resolve(folder.trim())

    const galleryOf = (folder: string) =>
      Effect.flatMap(Ref.get(galleries), (open) =>
        Option.match(Option.fromUndefinedOr(open.get(normalize(folder))), {
          onNone: () => Effect.fail(notOpen),
          onSome: Effect.succeed,
        }),
      )

    const pageOf = (gallery: Gallery, name: string) =>
      Option.match(Option.fromUndefinedOr(gallery.pages.find((page) => page.name === name)), {
        onNone: () => Effect.fail(missingPage),
        onSome: Effect.succeed,
      })

    const pathsOf = (gallery: Gallery, page: MangaPage) => {
      const stem = page.name.slice(0, page.name.length - path.extname(page.name).length)

      return {
        source: page.source,
        rendered: page.output,
        mask: path.join(gallery.outputFolder, 'masks', `${stem}.png`),
        brush: path.join(gallery.outputFolder, 'brush', `${stem}.png`),
        cleaned: path.join(gallery.outputFolder, 'cleaned', `${stem}.png`),
      }
    }

    const settingsOf = (folder: string) =>
      Effect.flatMap(store.settings(folder), (saved) =>
        Option.match(saved, {
          onSome: Effect.succeed,
          onNone: () => Effect.map(getMangaSettings, settingsFrom),
        }),
      )

    const pluginFolder = Effect.flatMap(
      plugins.installedFolder('manga-image-translator'),
      (folder) =>
        Option.match(folder, {
          onNone: () =>
            Effect.fail(
              new MangaEditorError({
                reason: 'not-ready',
                message: 'Install manga-image-translator on the Plugins page first.',
              }),
            ),
          onSome: Effect.succeed,
        }),
    )

    const optionsFor = (plugin: string, settings: MangaEditorSettings) =>
      Effect.flatMap(getMangaSettings, (manga) =>
        workerOptions(
          {
            ...manga,
            targetLanguage: settings.targetLanguage,
            font: settings.font,
            minFontSize: settings.minFontSize,
            maxFontSize: settings.maxFontSize,
            textBorder: settings.outline,
            borderColor: settings.outlineColor,
            uppercase: settings.uppercase,
          },
          plugin,
          { resources, dataDir },
        ).pipe(
          Effect.provideContext(files),
          Effect.map((options) => ({ ...options, output_format: 'png' })),
        ),
      )

    const fromManga = (error: { readonly message: string }) =>
      new MangaEditorError({ reason: 'failed', message: error.message })

    const blocksOf = (gallery: Gallery, page: string) =>
      Effect.map(store.blocks(gallery.folder), (blocks) =>
        blocks.filter((block) => block.page === page),
      )

    const storedPage = (gallery: Gallery, page: string) =>
      Effect.map(store.pages(gallery.folder), (pages) => pages.find((info) => info.page === page))

    const publish = Effect.fnUntraced(function* (gallery: Gallery) {
      const blocks = yield* store.blocks(gallery.folder)
      const stored = new Map((yield* store.pages(gallery.folder)).map((page) => [page.page, page]))
      const usage = yield* store.usage(gallery.folder)
      const running = yield* Ref.get(gallery.running)
      const errors = yield* Ref.get(gallery.errors)
      const history = yield* Ref.get(gallery.history)

      const pages = gallery.pages.map((page): EditorPage => {
        const own = blocks.filter((block) => block.page === page.name)
        const info = stored.get(page.name)
        const step = running.get(page.name)
        const error = errors.get(page.name) ?? info?.scanError

        const size = gallery.sizes.get(page.name)

        return {
          name: page.name,
          ...(size === undefined ? {} : { width: size.width, height: size.height }),
          blocks: own.map(toPublic),
          done: doneSteps(info, own),
          ...(step === undefined ? {} : { running: step }),
          ...(error === undefined ? {} : { error }),
          cleanVersion: info?.cleanVersion ?? 0,
          renderVersion: info?.renderVersion ?? 0,
          brushVersion: info?.brushVersion ?? 0,
          canUndo: (history.get(page.name)?.undo.length ?? 0) > 0,
          canRedo: (history.get(page.name)?.redo.length ?? 0) > 0,
        }
      })

      yield* SubscriptionRef.set(gallery.state, {
        folder: gallery.folder,
        outputFolder: gallery.outputFolder,
        pages,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
        },
      })
    })

    const setIn = <A>(ref: Ref.Ref<ReadonlyMap<string, A>>, key: string, value: A | undefined) =>
      Ref.update(ref, (all) => {
        const next = new Map(all)

        if (value === undefined) {
          next.delete(key)
        } else {
          next.set(key, value)
        }

        return next
      })

    const runStep = <A, R>(
      gallery: Gallery,
      page: string,
      step: PageStep,
      work: Effect.Effect<A, MangaEditorError, R>,
    ) =>
      Effect.gen(function* () {
        yield* setIn(gallery.running, page, step)
        yield* setIn(gallery.errors, page, undefined)
        yield* publish(gallery)

        return yield* work.pipe(
          Effect.tapError((error) => setIn(gallery.errors, page, error.message)),
          Effect.ensuring(
            Effect.andThen(setIn(gallery.running, page, undefined), publish(gallery)),
          ),
        )
      })

    const copyCleaned = Effect.fnUntraced(function* (gallery: Gallery, name: string) {
      const paths = pathsOf(gallery, yield* pageOf(gallery, name))
      const cleaned = yield* fs.exists(paths.cleaned).pipe(Effect.orElseSucceed(() => false))
      const number = yield* Ref.updateAndGet(gallery.copies, (count) => count + 1)
      const copy = path.join(gallery.outputFolder, 'history', `${number}.png`)

      yield* fs.makeDirectory(path.dirname(copy), { recursive: true }).pipe(Effect.orDie)
      yield* fs.copyFile(cleaned ? paths.cleaned : paths.source, copy).pipe(Effect.orDie)

      return copy
    })

    const snapshotOf = Effect.fnUntraced(function* (
      gallery: Gallery,
      page: string,
      withCleaned: boolean,
    ) {
      const blocks = yield* blocksOf(gallery, page)

      return withCleaned ? { blocks, cleaned: yield* copyCleaned(gallery, page) } : { blocks }
    })

    const remember = Effect.fnUntraced(function* (
      gallery: Gallery,
      page: string,
      withCleaned = false,
    ) {
      const now = yield* snapshotOf(gallery, page, withCleaned)
      const history = (yield* Ref.get(gallery.history)).get(page)

      yield* setIn(gallery.history, page, {
        undo: [...(history?.undo ?? []), now].slice(-undoLimit),
        redo: [],
      })
    })

    const recordUsage = (gallery: Gallery, completion: Completion) =>
      store.addUsage(gallery.folder, {
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        costUsd: completion.costUsd,
      })

    const ask = <A>(
      gallery: Gallery,
      request: {
        readonly system: string
        readonly prompt: string
        readonly history?: ReadonlyArray<ChatMessage>
      },
      parse: (reply: string) => Option.Option<A>,
    ) =>
      Effect.gen(function* () {
        const settings = yield* settingsOf(gallery.folder)
        const timeouts = yield* getMangaSettings

        if (settings.presetId === '') {
          return yield* new MangaEditorError({
            reason: 'not-ready',
            message: 'Choose an LLM preset in the gallery settings.',
          })
        }

        let lastError = 'The reply could not be read.'

        for (let attempt = 0; attempt < timeouts.retryAttempts; attempt++) {
          const completion = yield* llm
            .complete({
              presetId: settings.presetId,
              feature: 'manga-editor',
              system: request.system,
              prompt: request.prompt,
              ...(request.history === undefined ? {} : { history: request.history }),
              timeout: `${timeouts.timeoutSeconds} seconds`,
            })
            .pipe(
              Effect.map(Option.some),
              Effect.catch((error) => {
                lastError = readableError(error.message)

                return Effect.succeedNone
              }),
            )

          if (Option.isNone(completion)) {
            continue
          }

          yield* recordUsage(gallery, completion.value)

          const parsed = parse(completion.value.text)

          if (Option.isSome(parsed)) {
            return parsed.value
          }

          lastError = 'The reply could not be read.'
        }

        return yield* new MangaEditorError({ reason: 'failed', message: lastError })
      })

    const promptLine = (line: ReadonlyArray<StoredBlock>): PromptLine => ({
      kind: line[0]?.kind ?? 'dialogue',
      parts: line.map((block) => cleanSource(block.source)),
    })

    const contextFor = Effect.fnUntraced(function* (
      gallery: Gallery,
      page: string,
      excluded: ReadonlySet<string>,
    ) {
      const index = gallery.pages.findIndex((candidate) => candidate.name === page)
      const previous = gallery.pages[index - 1]?.name
      const blocks = yield* store.blocks(gallery.folder)

      const linesFrom = (name: string | undefined) =>
        linesOf(blocks.filter((block) => block.page === name)).filter(
          (line) =>
            line.every((block) => block.translation.trim() !== '') &&
            !line.some((block) => excluded.has(block.id)),
        )

      return [...linesFrom(previous), ...linesFrom(page)]
        .slice(-contextLines)
        .map((line): ContextLine => ({
          source: line.map((block) => cleanSource(block.source)).join(passageSeparator),
          translation: line.map((block) => block.translation).join(` ${passageSeparator} `),
        }))
    })

    const renderPage = Effect.fnUntraced(function* (
      gallery: Gallery,
      name: string,
      layouts: Readonly<Record<string, BubbleLayout>> = {},
    ) {
      const page = yield* pageOf(gallery, name)
      const settings = yield* settingsOf(gallery.folder)
      const plugin = yield* pluginFolder
      const paths = pathsOf(gallery, page)

      const options = {
        ...(yield* optionsFor(plugin, settings)),
        output_format: formatOf(paths.rendered),
      }

      if (path.resolve(paths.rendered) === path.resolve(paths.source)) {
        return yield* invalid('Pages are never exported over the originals.')
      }

      const info = yield* storedPage(gallery, name)
      const cleanVersion = info?.cleanVersion ?? 0

      const lettered = (yield* blocksOf(gallery, name))
        .filter((block) => block.status !== 'reading' && block.translation.trim() !== '')
        .map((block) => laidOut(block, workerBlock(block, settings, fontFolder), layouts[block.id]))

      const renderKey = yield* Effect.orDie(
        encodeRenderInput({ clean: cleanVersion, blocks: lettered, options }),
      )

      if (info?.renderKey === renderKey && (yield* fs.exists(paths.rendered).pipe(Effect.orDie))) {
        return
      }

      yield* runtime
        .editor(plugin, {
          op: 'render',
          options,
          source: paths.source,
          output: paths.rendered,
          blocks: lettered,
          ...(cleanVersion > 0 ? { cleaned: paths.cleaned } : {}),
        })
        .pipe(Effect.mapError(fromManga))

      yield* store.setPage(gallery.folder, name, { renderKey, rendered: true })
    })

    const translateWaiting = Effect.fnUntraced(function* (gallery: Gallery, page: string) {
      const waiting = linesOf(yield* blocksOf(gallery, page)).filter((line) =>
        line.some((block) => block.status === 'translating'),
      )

      if (waiting.length === 0) {
        return
      }

      const settings = yield* settingsOf(gallery.folder)
      const ids = new Set(waiting.flat().map((block) => block.id))
      const context = yield* contextFor(gallery, page, ids)
      const lines = waiting.map(promptLine)

      const outcome = yield* ask(
        gallery,
        {
          system: systemPrompt(languageName(settings.targetLanguage), settings.seriesNotes),
          prompt: linesPrompt(lines, context),
        },
        (reply) => parseLines(reply, lines),
      ).pipe(Effect.result)

      const current = new Map((yield* blocksOf(gallery, page)).map((block) => [block.id, block]))

      for (const [index, line] of waiting.entries()) {
        for (const [part, block] of line.entries()) {
          if (current.get(block.id)?.status !== 'translating') {
            continue
          }

          if (Result.isFailure(outcome)) {
            yield* store.update(block.id, { status: 'failed', error: outcome.failure.message })
            continue
          }

          const reply = outcome.success[index]

          yield* store.update(block.id, {
            romaji: reply?.romaji[part] ?? '',
            translation: reply?.translation[part] ?? '',
            status: 'draft',
            error: null,
          })
        }
      }

      yield* publish(gallery)

      if (Result.isFailure(outcome)) {
        return yield* outcome.failure
      }
    })

    const markForTranslation = Effect.fnUntraced(function* (
      gallery: Gallery,
      page: string,
      wanted: (line: ReadonlyArray<StoredBlock>) => boolean,
    ) {
      for (const line of linesOf(yield* blocksOf(gallery, page))) {
        if (
          wanted(line) &&
          line.every((block) => block.status !== 'approved' && block.source !== '')
        ) {
          for (const block of line) {
            yield* store.update(block.id, { status: 'translating', error: null })
          }
        }
      }
    })

    const translateInBackground = (gallery: Gallery, page: string) =>
      runStep(gallery, page, 'translate', translateWaiting(gallery, page)).pipe(
        Effect.ignore,
        Effect.forkIn(gallery.scope),
        Effect.asVoid,
      )

    const scanPage = Effect.fnUntraced(function* (gallery: Gallery, page: MangaPage) {
      const settings = yield* settingsOf(gallery.folder)
      const plugin = yield* pluginFolder
      const options = yield* optionsFor(plugin, settings)
      const paths = pathsOf(gallery, page)

      const result = yield* runtime
        .editor(plugin, { op: 'scan', options, source: paths.source, mask: paths.mask })
        .pipe(
          Effect.flatMap((raw) => Effect.mapError(decodeScan(raw), fromManga)),
          Effect.mapError(fromManga),
          Effect.tapError((error) =>
            store.recordScan(gallery.folder, page.name, { error: error.message }),
          ),
        )

      yield* remember(gallery, page.name)

      const kept = yield* blocksOf(gallery, page.name)

      for (const block of kept) {
        if (block.origin === 'scan') {
          yield* store.remove(block.id)
        }
      }

      for (const [position, found] of result.blocks.entries()) {
        const id = yield* Effect.orDie(crypto.randomUUIDv7())

        yield* store.insert(
          gallery.folder,
          {
            id,
            page: page.name,
            box: MangaEditorStore.boxOf(found.box),
            origin: 'scan',
            kind: 'dialogue',
            source: found.text,
            romaji: '',
            translation: '',
            status: 'draft',
            joined: false,
            clean: true,
            cleanMethod: settings.cleanMethod,
            lettering:
              found.area === null || found.area === undefined
                ? defaultLettering
                : { ...defaultLettering, textBox: MangaEditorStore.boxOf(found.area) },
            fg: found.fg,
            bg: found.bg,
            fontSize: found.fontSize,
            vertical: found.vertical,
          },
          position,
        )
      }

      const drawn = kept.filter((block) => block.origin === 'drawn')

      if (drawn.length > 0) {
        const ordered = (yield* blocksOf(gallery, page.name)).filter(
          (block) => block.origin === 'scan',
        )

        for (const block of drawn) {
          ordered.splice(
            insertionIndex(
              ordered.map((existing) => existing.box),
              block.box,
            ),
            0,
            block,
          )
        }

        yield* store.reorder(ordered.map((block) => block.id))
      }

      yield* store.recordScan(gallery.folder, page.name, {
        scannedAt: DateTime.formatIso(yield* DateTime.now),
      })
    })

    const inpaint = Effect.fnUntraced(function* (
      gallery: Gallery,
      name: string,
      request: {
        readonly source: string
        readonly blocks: ReadonlyArray<typeof EditorBlock.Type>
        readonly brush?: string
      },
    ) {
      const page = yield* pageOf(gallery, name)
      const plugin = yield* pluginFolder
      const options = yield* optionsFor(plugin, yield* settingsOf(gallery.folder))
      const paths = pathsOf(gallery, page)

      yield* runtime
        .editor(plugin, {
          op: 'clean',
          options,
          mask: paths.mask,
          output: paths.cleaned,
          ...request,
        })
        .pipe(Effect.mapError(fromManga))

      yield* store.setPage(gallery.folder, name, { cleaned: true })
    })

    const cleanPage = Effect.fnUntraced(function* (gallery: Gallery, name: string) {
      const page = yield* pageOf(gallery, name)
      const blocks = (yield* blocksOf(gallery, name)).filter((block) => block.status !== 'reading')

      yield* remember(gallery, name, true)

      yield* inpaint(gallery, name, {
        source: pathsOf(gallery, page).source,
        blocks: blocks.map((block) => ({
          box: edges(block.box),
          drawn: block.origin === 'drawn',
          method: 'inpaint' as const,
          ...(block.fg === undefined ? {} : { fg: block.fg }),
          ...(block.bg === undefined ? {} : { bg: block.bg }),
        })),
      })
    })

    const brushPage = Effect.fnUntraced(function* (
      gallery: Gallery,
      name: string,
      stroke: Uint8Array,
    ) {
      const paths = pathsOf(gallery, yield* pageOf(gallery, name))
      const cleaned = yield* fs.exists(paths.cleaned).pipe(Effect.orElseSucceed(() => false))

      yield* remember(gallery, name, true)
      yield* fs.makeDirectory(path.dirname(paths.brush), { recursive: true }).pipe(Effect.orDie)
      yield* fs.writeFile(paths.brush, stroke).pipe(Effect.orDie)

      yield* inpaint(gallery, name, {
        source: cleaned ? paths.cleaned : paths.source,
        blocks: [],
        brush: paths.brush,
      })
    })

    const sizeOfFile = (file: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* fs.open(file, { flag: 'r' })
          const start = new Uint8Array(headerBytes)
          const read = yield* handle.read(start)

          return imageSizeOf(start.subarray(0, Number(read)))
        }),
      ).pipe(Effect.orElseSucceed(() => Option.none<ImageSize>()))

    const pageSizes = Effect.fnUntraced(function* (pages: ReadonlyArray<MangaPage>) {
      const sizes = new Map<string, ImageSize>()

      for (const page of pages) {
        const size = yield* sizeOfFile(page.source)

        if (Option.isSome(size)) {
          sizes.set(page.name, size.value)
        }
      }

      return sizes
    })

    const open = Effect.fn('MangaEditor.open')(function* (input: string) {
      const folder = normalize(input)
      const existing = (yield* Ref.get(galleries)).get(folder)

      if (existing !== undefined) {
        return folder
      }

      const manga = yield* getMangaSettings

      const { outputFolder: exportFolder, pages } = yield* listPages(folder, manga).pipe(
        Effect.provideContext(files),
        Effect.mapError(
          (error) =>
            new MangaEditorError({
              reason: error.reason === 'not-found' ? 'not-found' : 'invalid',
              message: error.message,
            }),
        ),
      )

      if (pages.length === 0) {
        return yield* invalid('The folder has no pages.')
      }

      yield* store.open(
        folder,
        pages.map((page) => page.name),
        DateTime.formatIso(yield* DateTime.now),
      )

      const scope = yield* Scope.make()

      const gallery: Gallery = {
        folder,
        outputFolder: path.join(folder, editorOutputFolder),
        exportFolder,
        pages,
        state: yield* SubscriptionRef.make<MangaEditorState>({
          folder,
          outputFolder: path.join(folder, editorOutputFolder),
          pages: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
        running: yield* Ref.make<ReadonlyMap<string, PageStep>>(new Map()),
        errors: yield* Ref.make<ReadonlyMap<string, string>>(new Map()),
        history: yield* Ref.make<ReadonlyMap<string, History>>(new Map()),
        sizes: yield* pageSizes(pages),
        copies: yield* Ref.make(0),
        scope,
      }

      yield* Ref.update(galleries, (open) => new Map(open).set(folder, gallery))
      yield* publish(gallery)

      return folder
    })

    const close = Effect.fn('MangaEditor.close')(function* (input: string) {
      const folder = normalize(input)
      const gallery = (yield* Ref.get(galleries)).get(folder)

      if (gallery === undefined) {
        return
      }

      yield* Ref.update(galleries, (open) => {
        const rest = new Map(open)

        rest.delete(folder)

        return rest
      })

      yield* Scope.close(gallery.scope, Exit.void)
    })

    const lineOf = (blocks: ReadonlyArray<StoredBlock>, id: string) =>
      Option.match(
        Option.fromUndefinedOr(
          linesOf(blocks).find((line) => line.some((block) => block.id === id)),
        ),
        { onNone: () => Effect.fail(missingLine), onSome: Effect.succeed },
      )

    const readDrawn = Effect.fnUntraced(function* (
      gallery: Gallery,
      page: string,
      id: string,
      image: Parameters<typeof screenAi.recognize>[1],
    ) {
      const folder = yield* plugins.installedFolder('screen-ai')

      if (Option.isNone(folder)) {
        return yield* new MangaEditorError({
          reason: 'not-ready',
          message: 'Install Chrome Screen AI on the Plugins page to read boxes you draw.',
        })
      }

      const ocr = yield* screenAi
        .recognize(folder.value, image)
        .pipe(
          Effect.mapError(
            (error) => new MangaEditorError({ reason: 'failed', message: error.message }),
          ),
        )

      const text = ocrText(ocr)

      if (text === '') {
        return yield* new MangaEditorError({
          reason: 'failed',
          message: 'No text was found in the box. Draw it again around the text.',
        })
      }

      const translated = linesOf(yield* blocksOf(gallery, page)).some((line) =>
        line.every((block) => block.translation.trim() !== ''),
      )

      yield* store.update(id, {
        source: text,
        status: translated ? 'translating' : 'draft',
        error: null,
      })

      yield* publish(gallery)

      if (translated) {
        yield* translateInBackground(gallery, page)
      }
    })

    const addBlock = Effect.fn('MangaEditor.addBlock')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly box: PageBox
      readonly image: Parameters<typeof screenAi.recognize>[1]
    }) {
      const gallery = yield* galleryOf(payload.folder)

      yield* pageOf(gallery, payload.page)

      if (payload.box.width < 4 || payload.box.height < 4) {
        return yield* invalid('Draw a larger box around the text.')
      }

      const settings = yield* settingsOf(gallery.folder)
      const blocks = yield* blocksOf(gallery, payload.page)

      let index = insertionIndex(
        blocks.map((block) => block.box),
        payload.box,
      )

      while (blocks[index]?.joined === true) {
        index += 1
      }

      yield* remember(gallery, payload.page)

      const id = yield* Effect.orDie(crypto.randomUUIDv7())

      yield* store.insert(
        gallery.folder,
        {
          id,
          page: payload.page,
          box: payload.box,
          origin: 'drawn',
          kind: 'dialogue',
          source: '',
          romaji: '',
          translation: '',
          status: 'reading',
          joined: false,
          clean: true,
          cleanMethod: settings.cleanMethod,
          lettering: defaultLettering,
          fg: undefined,
          bg: undefined,
          fontSize: undefined,
          vertical: payload.box.height > payload.box.width,
        },
        blocks.length,
      )

      const ids = blocks.map((block) => block.id)

      ids.splice(index, 0, id)
      yield* store.reorder(ids)
      yield* publish(gallery)

      yield* readDrawn(gallery, payload.page, id, payload.image).pipe(
        Effect.catchTag('MangaEditorError', (error) =>
          Effect.andThen(
            store.update(id, { status: 'failed', error: error.message }),
            publish(gallery),
          ),
        ),
        Effect.forkIn(gallery.scope),
      )

      return id
    })

    const updateLine = Effect.fn('MangaEditor.updateLine')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly id: string
      readonly translation?: string | undefined
      readonly approved?: boolean | undefined
      readonly kind?: TextBlock['kind'] | undefined
      readonly clean?: boolean | undefined
      readonly cleanMethod?: TextBlock['cleanMethod'] | undefined
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const line = yield* lineOf(yield* blocksOf(gallery, payload.page), payload.id)

      const parts =
        payload.translation === undefined
          ? undefined
          : fitParts(splitParts(payload.translation), line.length)

      yield* remember(gallery, payload.page)

      for (const [index, block] of line.entries()) {
        yield* store.update(block.id, {
          ...(parts === undefined ? {} : { translation: parts[index] ?? '' }),
          ...statusAfter(block, payload.approved, parts !== undefined),
          ...(payload.kind === undefined ? {} : { kind: payload.kind }),
          ...(payload.clean === undefined ? {} : { clean: payload.clean }),
          ...(payload.cleanMethod === undefined ? {} : { cleanMethod: payload.cleanMethod }),
        })
      }

      yield* publish(gallery)
    })

    const letterBlock = Effect.fn('MangaEditor.letterBlock')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly id: string
      readonly lettering: Lettering
      readonly everyBubble: boolean
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const blocks = yield* blocksOf(gallery, payload.page)

      if (!blocks.some((block) => block.id === payload.id)) {
        return yield* missingLine
      }

      yield* remember(gallery, payload.page)

      const { textBox: _textBox, ...shared } = payload.lettering

      for (const block of blocks) {
        if (block.id === payload.id) {
          yield* store.update(block.id, { lettering: payload.lettering })
        } else if (payload.everyBubble) {
          yield* store.update(block.id, {
            lettering: {
              ...shared,
              ...(block.lettering.textBox === undefined
                ? {}
                : { textBox: block.lettering.textBox }),
            },
          })
        }
      }

      yield* publish(gallery)
    })

    const removeBlock = Effect.fn('MangaEditor.removeBlock')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly id: string
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const blocks = yield* blocksOf(gallery, payload.page)
      const index = blocks.findIndex((block) => block.id === payload.id)
      const removed = blocks[index]

      if (removed === undefined) {
        return yield* missingLine
      }

      yield* remember(gallery, payload.page)

      const next = blocks[index + 1]

      if (!removed.joined && next?.joined === true) {
        yield* store.update(next.id, { joined: false })
      }

      yield* store.remove(removed.id)

      yield* store.reorder(
        blocks.filter((block) => block.id !== removed.id).map((block) => block.id),
      )

      yield* publish(gallery)
    })

    const orderLines = Effect.fn('MangaEditor.orderLines')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly ids: ReadonlyArray<string>
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const blocks = yield* blocksOf(gallery, payload.page)
      const known = new Set(blocks.map((block) => block.id))

      if (payload.ids.length !== known.size || !payload.ids.every((id) => known.has(id))) {
        return yield* invalid('The order must list every line on the page once.')
      }

      yield* remember(gallery, payload.page)

      const before = new Map(blocks.map((block, index) => [block.id, blocks[index - 1]?.id]))

      for (const [index, id] of payload.ids.entries()) {
        const block = blocks.find((candidate) => candidate.id === id)

        if (block?.joined === true && before.get(id) !== payload.ids[index - 1]) {
          yield* store.update(id, { joined: false })
        }
      }

      yield* store.reorder(payload.ids)
      yield* publish(gallery)
    })

    const retranslateIfTranslated = Effect.fnUntraced(function* (
      gallery: Gallery,
      page: string,
      changed: ReadonlySet<string>,
    ) {
      const blocks = yield* blocksOf(gallery, page)
      const touched = blocks.filter((block) => changed.has(block.id))

      if (!touched.some((block) => block.translation.trim() !== '')) {
        return
      }

      yield* markForTranslation(gallery, page, (line) =>
        line.some((block) => changed.has(block.id)),
      )

      yield* translateInBackground(gallery, page)
    })

    const mergeLines = Effect.fn('MangaEditor.mergeLines')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly ids: ReadonlyArray<string>
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const blocks = yield* blocksOf(gallery, payload.page)
      const lines = linesOf(blocks)

      const chosen = lines.filter((line) => line.some((block) => payload.ids.includes(block.id)))

      if (chosen.length < 2) {
        return yield* invalid('Choose at least two lines to merge.')
      }

      yield* remember(gallery, payload.page)

      const merged = chosen.flat()
      const first = lines.indexOf(chosen[0] ?? [])
      const rest = lines.filter((line) => !chosen.includes(line))

      const ordered = [...rest.slice(0, first).flat(), ...merged, ...rest.slice(first).flat()]

      for (const [index, block] of merged.entries()) {
        yield* store.update(block.id, { joined: index > 0 })
      }

      yield* store.reorder(ordered.map((block) => block.id))
      yield* publish(gallery)

      yield* retranslateIfTranslated(
        gallery,
        payload.page,
        new Set(merged.map((block) => block.id)),
      )
    })

    const splitLine = Effect.fn('MangaEditor.splitLine')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly id: string
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const line = yield* lineOf(yield* blocksOf(gallery, payload.page), payload.id)

      if (line.length < 2) {
        return
      }

      yield* remember(gallery, payload.page)

      for (const block of line) {
        yield* store.update(block.id, { joined: false })
      }

      yield* publish(gallery)
      yield* retranslateIfTranslated(gallery, payload.page, new Set(line.map((block) => block.id)))
    })

    const travel = Effect.fnUntraced(function* (
      payload: { readonly folder: string; readonly page: string },
      direction: 'undo' | 'redo',
    ) {
      const gallery = yield* galleryOf(payload.folder)
      const history = (yield* Ref.get(gallery.history)).get(payload.page)
      const from = direction === 'undo' ? history?.undo : history?.redo
      const saved = from?.at(-1)

      if (history === undefined || from === undefined || saved === undefined) {
        return
      }

      const now = yield* snapshotOf(gallery, payload.page, saved.cleaned !== undefined)

      yield* setIn(
        gallery.history,
        payload.page,
        direction === 'undo'
          ? { undo: history.undo.slice(0, -1), redo: [...history.redo, now] }
          : { undo: [...history.undo, now], redo: history.redo.slice(0, -1) },
      )

      yield* store.replacePage(gallery.folder, payload.page, saved.blocks)

      if (saved.cleaned !== undefined) {
        const paths = pathsOf(gallery, yield* pageOf(gallery, payload.page))

        yield* fs.makeDirectory(path.dirname(paths.cleaned), { recursive: true }).pipe(Effect.orDie)
        yield* fs.copyFile(saved.cleaned, paths.cleaned).pipe(Effect.orDie)
        yield* store.setPage(gallery.folder, payload.page, { cleaned: true })
      }

      yield* publish(gallery)
    })

    const breaks = Effect.fn('MangaEditor.breaks')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly id: string
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const page = yield* pageOf(gallery, payload.page)
      const block = (yield* blocksOf(gallery, payload.page)).find((one) => one.id === payload.id)

      if (block === undefined) {
        return yield* missingLine
      }

      if (block.translation.trim() === '') {
        return []
      }

      const settings = yield* settingsOf(gallery.folder)
      const plugin = yield* pluginFolder
      const options = yield* optionsFor(plugin, settings)

      const reply = yield* runtime
        .editor(plugin, {
          op: 'breaks',
          options,
          source: pathsOf(gallery, page).source,
          blocks: [workerBlock(block, settings, fontFolder)],
        })
        .pipe(
          Effect.flatMap((raw) => Effect.mapError(decodeBreaks(raw), fromManga)),
          Effect.mapError(fromManga),
        )

      return reply.candidates
    })

    const aboutLine = Effect.fnUntraced(function* (folder: string, page: string, id: string) {
      const gallery = yield* galleryOf(folder)
      const lines = linesOf(yield* blocksOf(gallery, page))
      const index = lines.findIndex((line) => line.some((block) => block.id === id))
      const line = lines[index]

      if (line === undefined) {
        return yield* missingLine
      }

      return {
        gallery,
        lines: lines.map(promptLine),
        index,
        count: line.length,
        current: joinParts(line.map((block) => block.translation)),
      }
    })

    const suggest = Effect.fn('MangaEditor.suggest')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly id: string
    }) {
      const { gallery, lines, index, count, current } = yield* aboutLine(
        payload.folder,
        payload.page,
        payload.id,
      )

      const settings = yield* settingsOf(gallery.folder)

      const alternatives = yield* ask(
        gallery,
        {
          system: systemPrompt(languageName(settings.targetLanguage), settings.seriesNotes),
          prompt: alternativesPrompt(lines, index, current),
        },
        (reply) => parseAlternatives(reply, count),
      )

      yield* publish(gallery)

      return alternatives
    })

    const chat = Effect.fn('MangaEditor.chat')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly id?: string | undefined
      readonly messages: ReadonlyArray<ChatMessage>
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const last = payload.messages.at(-1)

      if (last === undefined || last.role !== 'user' || last.text.trim() === '') {
        return yield* invalid('Type a message first.')
      }

      const settings = yield* settingsOf(gallery.folder)
      const lines = linesOf(yield* blocksOf(gallery, payload.page))
      const attached = lines.findIndex((line) => line.some((block) => block.id === payload.id))

      const context = chatContext(
        lines.map(promptLine),
        lines.map((line) => joinParts(line.map((block) => block.translation)).trim()),
        attached === -1 ? undefined : attached,
      )

      const answer = yield* ask(
        gallery,
        {
          system: `${chatSystemPrompt(languageName(settings.targetLanguage), settings.seriesNotes)}\n\n${context}`,
          prompt: last.text,
          history: payload.messages.slice(0, -1),
        },
        (reply) =>
          Option.some(
            parseChat(
              reply,
              lines.map((line) => line.length),
            ),
          ),
      )

      yield* publish(gallery)

      const line = answer.suggestion === undefined ? undefined : lines[answer.suggestion.index]
      const head = line?.[0]

      return answer.suggestion === undefined || head === undefined
        ? { text: answer.text }
        : {
            text: answer.text,
            suggestion: {
              id: head.id,
              number: answer.suggestion.index + 1,
              translation: answer.suggestion.translation,
            },
          }
    })

    const notFound = () =>
      new MangaEditorError({ reason: 'not-found', message: 'The page could not be read.' })

    const imageFile = Effect.fnUntraced(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly kind: 'original' | 'result' | 'cleaned' | 'brush'
    }) {
      const gallery = yield* galleryOf(payload.folder)
      const page = yield* pageOf(gallery, payload.page)
      const paths = pathsOf(gallery, page)
      const info = yield* storedPage(gallery, payload.page)

      const lettered = (info?.renderVersion ?? 0) > 0 ? [paths.rendered] : []
      const cleaned = (info?.cleanVersion ?? 0) > 0 ? [paths.cleaned] : []

      const candidates = {
        original: [paths.source],
        brush: [paths.brush],
        result: [...lettered, ...cleaned, paths.source],
        cleaned: [...cleaned, paths.source],
      }[payload.kind]

      for (const file of candidates) {
        if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) {
          return file
        }
      }

      return yield* notFound()
    })

    const readImage = Effect.fn('MangaEditor.readImage')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly kind: 'original' | 'result' | 'cleaned' | 'brush'
    }) {
      return yield* fs.readFile(yield* imageFile(payload)).pipe(Effect.mapError(notFound))
    })

    const findImage = Effect.fn('MangaEditor.findImage')(function* (payload: {
      readonly folder: string
      readonly page: string
      readonly kind: 'original' | 'result' | 'cleaned' | 'brush'
    }) {
      return yield* imageFile(payload)
    })

    const exportGallery = Effect.fn('MangaEditor.export')(function* (
      folder: string,
      layouts: Readonly<Record<string, BubbleLayout>>,
    ) {
      const gallery = yield* galleryOf(folder)

      for (const page of gallery.pages) {
        yield* runStep(gallery, page.name, 'letter', renderPage(gallery, page.name, layouts))
      }

      return gallery.exportFolder
    })

    const getSettings = Effect.fn('MangaEditor.getSettings')(function* (folder: string) {
      const gallery = yield* galleryOf(folder)

      return yield* settingsOf(gallery.folder)
    })

    const saveSettings = Effect.fn('MangaEditor.saveSettings')(function* (
      folder: string,
      settings: MangaEditorSettings,
    ) {
      const gallery = yield* galleryOf(folder)
      const clean = yield* checkSettings(settings)

      yield* store.saveSettings(gallery.folder, clean)

      return clean
    })

    const step = <A>(
      payload: { readonly folder: string; readonly page: string },
      name: PageStep,
      work: (gallery: Gallery) => Effect.Effect<A, MangaEditorError>,
    ) =>
      Effect.flatMap(galleryOf(payload.folder), (gallery) =>
        Effect.andThen(
          pageOf(gallery, payload.page),
          runStep(gallery, payload.page, name, work(gallery)),
        ),
      )

    return MangaEditorRpc.of({
      openMangaEditor: ({ folder }) => open(folder),
      closeMangaEditor: ({ folder }) => close(folder),
      watchMangaEditor: ({ folder }) =>
        Stream.unwrap(
          Effect.map(galleryOf(folder), (gallery) => SubscriptionRef.changes(gallery.state)),
        ),
      getMangaEditorSettings: ({ folder }) => getSettings(folder),
      saveMangaEditorSettings: ({ folder, settings }) => saveSettings(folder, settings),
      readMangaEditorImage: readImage,
      findMangaEditorImage: findImage,
      scanMangaEditorPage: (payload) =>
        Effect.gen(function* () {
          const gallery = yield* galleryOf(payload.folder)
          const page = yield* pageOf(gallery, payload.page)

          yield* runStep(gallery, page.name, 'scan', scanPage(gallery, page))

          if (payload.translate) {
            yield* markForTranslation(gallery, page.name, () => true)
            yield* runStep(gallery, page.name, 'translate', translateWaiting(gallery, page.name))
          }
        }),
      translateMangaEditorPage: (payload) =>
        step(payload, 'translate', (gallery) =>
          Effect.andThen(
            markForTranslation(gallery, payload.page, () => true),
            translateWaiting(gallery, payload.page),
          ),
        ),
      cleanMangaEditorPage: (payload) =>
        step(payload, 'clean', (gallery) => cleanPage(gallery, payload.page)),
      letterMangaEditorPage: (payload) =>
        step(payload, 'letter', (gallery) => renderPage(gallery, payload.page)),
      brushMangaEditorPage: (payload) =>
        step(payload, 'clean', (gallery) => brushPage(gallery, payload.page, payload.image)),
      addMangaEditorBlock: addBlock,
      updateMangaEditorLine: updateLine,
      letterMangaEditorBlock: letterBlock,
      removeMangaEditorBlock: removeBlock,
      orderMangaEditorLines: orderLines,
      mergeMangaEditorLines: mergeLines,
      splitMangaEditorLine: splitLine,
      undoMangaEditor: (payload) => travel(payload, 'undo'),
      redoMangaEditor: (payload) => travel(payload, 'redo'),
      breaksMangaEditorBlock: breaks,
      suggestMangaEditorAlternatives: suggest,
      chatMangaEditor: chat,
      exportMangaEditor: ({ folder, layouts }) => exportGallery(folder, layouts),
      findMangaEditorFont: ({ font }) => fontFile(font),
    })
  }),
)
