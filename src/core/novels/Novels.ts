import {
  Clock,
  Context,
  Crypto,
  DateTime,
  type Duration,
  Effect,
  Fiber,
  Match,
  Option,
  Predicate,
  Queue,
  Schedule,
  Scope,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect'
import { Chat } from 'effect/ai'
import { KeyValueStore } from 'effect/persistence'
import {
  AskAnswer,
  AskStep,
  type ChapterRow,
  type ChapterView,
  defaultNovelSettings,
  type DigestProgress,
  type NovelAnswer,
  type NovelAskEvent,
  type GlossaryTerm,
  type NewChapter,
  NovelSettings,
  NovelsError,
  NovelsRpc,
  type NovelSummary,
  type GlossaryEdit,
  type GlossaryRef,
  type ReaderParagraph,
  type TermHit,
  type ScanProgress,
  type SearchResult,
  type SiteEntry,
  SiteFailed,
  SiteResults,
  TermKind,
  type TermSpan,
  type TranslationState,
} from '#contract/Novels'
import { fold, makeMatcher } from '../glossary/GlossaryMatcher'
import { GlossaryStore } from '../glossary/GlossaryStore'
import { findCandidates } from '../glossary/TermScan'
import { checkCandidates } from '../glossary/TermShortlist'
import { LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as SettingsStore from '../platform/SettingsStore'
import { matchChapters, sameBook } from './ChapterMatch'
import { cleanTitle, splitChapters, looksLikeChapter } from './ChapterText'
import { TranslateEvent, translateChapter } from './ChapterTranslator'
import {
  chatPrompt,
  citationsOf,
  coverageOf,
  insightOf,
  type NovelBook,
  novelHandlers,
  NovelToolkit,
  novelToolLabels,
} from './NovelChat'
import {
  contentFlags,
  type DigestChapter,
  digestBatches,
  digestPrompt,
  parseDigests,
} from './NovelDigests'
import { NovelInsightStore } from './NovelInsightStore'
import { NovelStore, type StoredChapter, type StoredNovel } from './NovelStore'
import { Interactive, PageFetcher } from './PageFetcher'
import {
  bookIdOf,
  builtInSites,
  detectSite,
  isOfficial,
  parseBook,
  parseChapterList,
  parseChapterText,
  parseSearch,
  siteFor,
  siteUrl,
} from './SitePages'

const settingsKey = 'novels'

const isTermKind = Schema.is(TermKind)

const checkEvery = 3 * 60 * 60 * 1000

const waitingEvery = 30 * 60 * 1000

interface Progress {
  readonly state: TranslationState
  readonly title: string | null
  readonly paragraphs: ReadonlyArray<string | null>
  readonly message: string | null
  readonly costUsd: number
}

interface Job {
  readonly progress: SubscriptionRef.SubscriptionRef<Progress>
  readonly fiber: Fiber.Fiber<void>
  readonly ahead: boolean
}

const finished = (state: TranslationState) => state !== 'waiting' && state !== 'translating'

const notFound = (what: string) =>
  new NovelsError({ reason: 'not-found', message: `${what} is gone.` })

const invalid = (message: string) => new NovelsError({ reason: 'invalid', message })

const isScrambled = (text: string) => {
  const privateUse = text.match(/[-]/g)?.length ?? 0

  return text.length > 0 && privateUse / text.length > 0.01
}

const spansOf = (text: string, terms: ReadonlyArray<GlossaryTerm>): ReadonlyArray<TermSpan> => {
  const spans: Array<TermSpan> = []
  const lower = text.toLowerCase()

  for (const term of terms) {
    const needle = term.translation.toLowerCase()

    if (needle === '') {
      continue
    }

    for (
      let at = lower.indexOf(needle);
      at !== -1;
      at = lower.indexOf(needle, at + needle.length)
    ) {
      spans.push({ termId: term.id, start: at, end: at + needle.length })
    }
  }

  return spans.toSorted((left, right) => left.start - right.start)
}

export const ScanPause = Context.Reference<Duration.Input>('wenbu/core/novels/ScanPause', {
  defaultValue: () => '1 second',
})

const digestStart: DigestProgress = {
  stage: 'reading',
  done: 0,
  total: 0,
  costUsd: 0,
  message: null,
}

const MAX_CHAT_STEPS = 8

const HISTORY_ANSWERS = 4

const scanStart: ScanProgress = {
  stage: 'reading',
  done: 0,
  total: 0,
  found: 0,
  costUsd: 0,
  message: null,
}

export const NovelsRpcLive = NovelsRpc.toLayer(
  Effect.gen(function* () {
    const store = yield* NovelStore
    const glossaries = yield* GlossaryStore
    const insights = yield* NovelInsightStore
    const pages = yield* PageFetcher
    const llm = yield* LlmClient
    const crypto = yield* Crypto.Crypto
    const scope = yield* Scope.Scope

    const settingsStore = SettingsStore.make(
      yield* KeyValueStore.KeyValueStore,
      NovelSettings,
      defaultNovelSettings,
    )

    const settings = Effect.orDie(settingsStore.get(settingsKey))

    yield* (yield* PresetReferences).register({
      area: 'Novels',
      uses: (presetIds) => Effect.map(settings, (current) => presetIds.has(current.presetId)),
      clear: (presetIds) =>
        Effect.flatMap(settings, (current) =>
          presetIds.has(current.presetId)
            ? Effect.orDie(settingsStore.set(settingsKey, { ...current, presetId: '' }))
            : Effect.void,
        ),
    })

    const newId = Effect.orDie(crypto.randomUUIDv7())

    const termsFor = Effect.fn('Novels.termsFor')(function* (novelId: string) {
      const own = yield* store.terms(novelId)
      const taken = new Set(own.map((term) => fold(term.original)))
      const shared: Array<GlossaryTerm> = []

      for (const glossaryId of yield* glossaries.picks(novelId)) {
        for (const term of yield* glossaries.terms(glossaryId)) {
          const key = fold(term.original)

          if (!taken.has(key)) {
            taken.add(key)
            shared.push(term)
          }
        }
      }

      return [...own, ...shared]
    })

    const scanPause = yield* ScanPause
    const scans = new Map<string, SubscriptionRef.SubscriptionRef<ScanProgress>>()
    const digestRuns = new Map<string, SubscriptionRef.SubscriptionRef<DigestProgress>>()
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso)

    const glossaryOf = (glossaryId: string) =>
      Effect.flatMap(glossaries.glossary(glossaryId), (found) =>
        Option.match(found, {
          onNone: () => Effect.fail(notFound('This glossary')),
          onSome: Effect.succeed,
        }),
      )

    const checkTerm = (term: { readonly original: string; readonly translation: string }) =>
      term.original.trim() === '' || term.translation.trim() === ''
        ? Effect.fail(invalid('A term needs its original and its translation.'))
        : Effect.void

    const glossaryShelf = Effect.gen(function* () {
      const counts = new Map((yield* store.counts).map((row) => [row.novel_id, row]))

      return {
        general: (yield* glossaries.glossaries).map((glossary) => ({
          id: glossary.id,
          name: glossary.name,
          terms: glossary.terms,
          novels: glossary.novels,
          updatedAt: glossary.updated_at,
        })),
        novels: (yield* store.novels).map((novel) => ({
          novelId: novel.id,
          title: novel.title_translated ?? novel.title,
          originalTitle: novel.title,
          terms: counts.get(novel.id)?.terms ?? 0,
          toReview: counts.get(novel.id)?.suggested ?? 0,
          updatedAt: novel.updated_at,
        })),
      }
    })

    const glossaryPage = Effect.fn('Novels.glossaryPage')(function* (ref: GlossaryRef) {
      if (ref.kind === 'novel') {
        const novel = yield* novelOf(ref.id)
        const picked = yield* glossaries.picks(ref.id)
        const all = yield* glossaries.glossaries

        const picks = [
          ...picked.flatMap((id) => all.filter((glossary) => glossary.id === id)),
          ...all.filter((glossary) => !picked.includes(glossary.id)),
        ].map((glossary) => ({
          id: glossary.id,
          name: glossary.name,
          terms: glossary.terms,
          picked: picked.includes(glossary.id),
        }))

        return {
          ref,
          name: novel.title_translated ?? novel.title,
          originalName: novel.title,
          terms: yield* store.terms(ref.id),
          picks,
          novels: 0,
        }
      }

      const glossary = yield* glossaryOf(ref.id)

      return {
        ref,
        name: glossary.name,
        originalName: null,
        terms: yield* glossaries.terms(ref.id),
        picks: [],
        novels: glossary.novels,
      }
    })

    const findTerms = Effect.fn('Novels.findTerms')(function* (query: string) {
      const text = query.trim()

      if (text === '') {
        return []
      }

      const folded = fold(text)
      const lower = text.toLowerCase()

      const matches = (term: GlossaryTerm) =>
        fold(term.original).includes(folded) || term.translation.toLowerCase().includes(lower)

      const hits: Array<TermHit> = []

      for (const novel of yield* store.novels) {
        for (const term of yield* store.terms(novel.id)) {
          if (matches(term)) {
            hits.push({
              ref: { kind: 'novel', id: novel.id },
              glossaryName: novel.title_translated ?? novel.title,
              term,
            })
          }
        }
      }

      for (const { glossaryId, term } of yield* glossaries.allTerms) {
        if (matches(term)) {
          hits.push({ ref: { kind: 'general', id: glossaryId }, glossaryName: term.glossary, term })
        }
      }

      return hits.slice(0, 50)
    })

    const editGlossary = (edit: GlossaryEdit) =>
      Match.valueTags(edit, {
        CreateGlossary: ({ name }) =>
          Effect.gen(function* () {
            if (name.trim() === '') {
              return yield* invalid('Give the glossary a name.')
            }

            const id = yield* newId

            yield* glossaries.create(id, name.trim())

            return id
          }),
        RenameGlossary: ({ glossaryId, name }) =>
          Effect.gen(function* () {
            yield* glossaryOf(glossaryId)

            if (name.trim() === '') {
              return yield* invalid('Give the glossary a name.')
            }

            yield* glossaries.rename(glossaryId, name.trim())

            return null
          }),
        RemoveGlossary: ({ glossaryId }) => Effect.as(glossaries.remove(glossaryId), null),
        AddTerm: ({ glossaryId, original, translation, kind, gender, note, reading }) =>
          Effect.gen(function* () {
            yield* glossaryOf(glossaryId)
            yield* checkTerm({ original, translation })

            const id = yield* newId

            yield* glossaries.saveTerm(glossaryId, id, {
              original: original.trim(),
              translation: translation.trim(),
              kind,
              gender,
              note,
              reading: reading ?? null,
            })

            return id
          }),
        UpdateTerm: ({ glossaryId, termId, original, translation, kind, gender, note, reading }) =>
          Effect.gen(function* () {
            yield* checkTerm({ original, translation })

            const before = (yield* glossaries.terms(glossaryId)).find(
              (found) => found.id === termId,
            )

            if (before === undefined) {
              return yield* notFound('This term')
            }

            yield* glossaries.updateTerm(glossaryId, termId, {
              original,
              translation,
              kind,
              gender,
              note,
              ...(reading === undefined ? {} : { reading }),
            })

            for (const novelId of yield* glossaries.novelsUsing(glossaryId)) {
              yield* store.renameInTranslations(novelId, before.translation, translation)
            }

            return null
          }),
        RemoveTerm: ({ glossaryId, termId }) =>
          Effect.as(glossaries.removeTerm(glossaryId, termId), null),
        AddNovelTerm: ({ novelId, original, translation, kind, gender, note, reading }) =>
          Effect.gen(function* () {
            yield* checkTerm({ original, translation })

            const id = yield* newId

            yield* store.saveTerm(
              novelId,
              id,
              {
                original: original.trim(),
                translation: translation.trim(),
                kind,
                gender,
                note,
                reading: reading ?? null,
              },
              null,
            )

            const saved = (yield* store.terms(novelId)).find(
              (term) => term.original === original.trim(),
            )

            return saved?.id ?? id
          }),
        UpdateNovelTerm: ({
          novelId,
          termId,
          original,
          translation,
          kind,
          gender,
          note,
          reading,
        }) =>
          Effect.gen(function* () {
            const before = (yield* store.terms(novelId)).find((found) => found.id === termId)

            if (before === undefined) {
              return yield* notFound('This term')
            }

            yield* store.updateTerm(novelId, termId, {
              original,
              translation,
              kind,
              gender,
              note,
              ...(reading === undefined ? {} : { reading }),
            })

            const renamed = yield* store.renameInTranslations(
              novelId,
              before.translation,
              translation,
            )

            if (renamed.length > 0) {
              yield* Effect.logInfo('Term renamed in translations').pipe(
                Effect.annotateLogs({ feature: 'novels', chapters: renamed.length }),
              )
            }

            return null
          }),
        AcceptTerms: ({ novelId, termIds }) => Effect.as(store.acceptTerms(novelId, termIds), null),
        DismissTerm: ({ novelId, termId }) => Effect.as(store.removeTerm(novelId, termId), null),
        PickGlossaries: ({ novelId, glossaryIds }) =>
          Effect.gen(function* () {
            yield* novelOf(novelId)
            yield* glossaries.setPicks(novelId, glossaryIds)

            return null
          }),
      })

    const csvField = (value: string | null) =>
      value === null ? '' : /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

    const exportGlossary = Effect.fn('Novels.exportGlossary')(function* (ref: GlossaryRef) {
      const page = yield* glossaryPage(ref)

      return [
        'original,translation,kind,gender,reading,note',
        ...page.terms
          .filter((term) => !term.suggested)
          .map((term) =>
            [term.original, term.translation, term.kind, term.gender, term.reading, term.note]
              .map((value) => csvField(value))
              .join(','),
          ),
      ].join('\n')
    })

    const jobs = new Map<string, Job>()
    const aheadSlots = yield* Semaphore.make(1)
    const keyOf = (novelId: string, number: number) => `${novelId}:${number}`

    const sites = Effect.map(store.sites, (stored) => [
      ...builtInSites,
      ...stored.filter((site) => !builtInSites.some((builtIn) => builtIn.id === site.id)),
    ])

    const siteOf = (id: string | null) =>
      Effect.map(sites, (all) => Option.fromNullishOr(all.find((site) => site.id === id)))

    const fetchPage = Effect.fn('Novels.fetchPage')(function* (url: string) {
      const page = yield* pages.get(url)

      if (page.status >= 400) {
        return yield* new NovelsError({
          reason: 'site',
          message: `${new URL(url).hostname} answered ${page.status}.`,
        })
      }

      return page
    })

    const novelOf = (novelId: string) =>
      Effect.flatMap(store.novel(novelId), (found) =>
        Option.match(found, {
          onNone: () => Effect.fail(notFound('This novel')),
          onSome: Effect.succeed,
        }),
      )

    const chapterOf = (novelId: string, number: number) =>
      Effect.flatMap(store.chapter(novelId, number), (found) =>
        Option.match(found, {
          onNone: () => Effect.fail(notFound(`Chapter ${number}`)),
          onSome: Effect.succeed,
        }),
      )

    const textOf = Effect.fn('Novels.textOf')(function* (novelId: string, chapter: StoredChapter) {
      const stored = yield* store.text(novelId, chapter.number)
      const url = chapter.text_url ?? (chapter.locked ? null : chapter.url)

      if (Option.isSome(stored) || url === null) {
        return stored
      }

      const site = yield* siteOf(chapter.text_url === null ? chapter.site : chapter.text_site)

      if (Option.isNone(site)) {
        return Option.none()
      }

      const started = yield* Clock.currentTimeMillis
      const page = yield* fetchPage(url)
      const text = parseChapterText(site.value, page.body, chapter.title)

      if (text.paragraphs.length === 0) {
        yield* Effect.logWarning('A chapter page had no text').pipe(
          Effect.annotateLogs({ site: site.value.id, chapter: chapter.number }),
        )

        return Option.none()
      }

      yield* store.saveText(novelId, chapter.number, text)

      yield* Effect.logDebug('Chapter fetched').pipe(
        Effect.annotateLogs({
          site: site.value.id,
          chapter: chapter.number,
          paragraphs: text.paragraphs.length,
          ms: (yield* Clock.currentTimeMillis) - started,
        }),
      )

      return Option.some(text)
    })

    const runTranslation = Effect.fn('Novels.translateChapter')(function* (
      novelId: string,
      number: number,
      progress: SubscriptionRef.SubscriptionRef<Progress>,
    ) {
      const current = yield* settings
      const novel = yield* novelOf(novelId)
      const chapter = yield* chapterOf(novelId, number)
      const text = yield* textOf(novelId, chapter)

      if (Option.isNone(text)) {
        return yield* SubscriptionRef.update(progress, (state) => ({
          ...state,
          state: 'failed' as const,
          message: 'No source has this chapter’s text yet. Paste it to read it.',
        }))
      }

      const terms = yield* termsFor(novelId)
      const model = yield* llm.model(current.presetId, { feature: 'novels' })
      const started = yield* Clock.currentTimeMillis

      yield* SubscriptionRef.update(progress, (state) => ({
        ...state,
        state: 'translating' as const,
        paragraphs: text.value.paragraphs.map(() => null),
      }))

      yield* translateChapter(model, {
        title: chapter.title,
        paragraphs: text.value.paragraphs,
        terms,
        language: novel.language,
        targetLanguage: current.targetLanguage,
      }).pipe(
        Stream.runForEach((event) =>
          TranslateEvent.$match(event, {
            Title: ({ text: title }) =>
              SubscriptionRef.update(progress, (state) => ({ ...state, title })),
            Paragraph: ({ index, text: translated }) =>
              SubscriptionRef.update(progress, (state) => ({
                ...state,
                paragraphs: state.paragraphs.map((paragraph, at) =>
                  at === index ? translated : paragraph,
                ),
              })),
            Spent: ({ costUsd }) =>
              SubscriptionRef.update(progress, (state) => ({
                ...state,
                costUsd: state.costUsd + costUsd,
              })),
            NewTerm: (found) =>
              Effect.flatMap(newId, (id) =>
                store.saveTerm(
                  novelId,
                  id,
                  {
                    original: found.original,
                    translation: found.translation,
                    kind: found.kind,
                    gender: found.gender,
                    note: null,
                  },
                  { origin: 'translation', chapters: [number], count: 0 },
                ),
              ),
          }),
        ),
      )

      const done = yield* SubscriptionRef.get(progress)

      yield* store.saveTranslation(novelId, number, current.targetLanguage, {
        presetId: current.presetId,
        glossaryKey: terms.map((term) => `${term.id}:${term.translation}`).join('|'),
        paragraphs: done.paragraphs,
        title: done.title,
        costUsd: done.costUsd,
      })

      yield* SubscriptionRef.update(progress, (state) => ({
        ...state,
        state: 'translated' as const,
      }))

      yield* Effect.logInfo('Chapter translated').pipe(
        Effect.annotateLogs({
          chapter: number,
          paragraphs: done.paragraphs.length,
          missing: done.paragraphs.filter((paragraph) => paragraph === null).length,
          costUsd: done.costUsd,
          ms: (yield* Clock.currentTimeMillis) - started,
        }),
      )
    })

    const startJob = Effect.fn('Novels.startJob')(function* (
      novelId: string,
      number: number,
      ahead: boolean,
    ) {
      const key = keyOf(novelId, number)
      const running = jobs.get(key)

      if (running !== undefined) {
        return running
      }

      const current = yield* settings
      const cached = yield* store.translation(novelId, number, current.targetLanguage)

      if (Option.isSome(cached) || current.presetId === '') {
        return undefined
      }

      const progress = yield* SubscriptionRef.make<Progress>({
        state: 'waiting',
        title: null,
        paragraphs: [],
        message: null,
        costUsd: 0,
      })

      const work = runTranslation(novelId, number, progress).pipe(
        Effect.catchTag('NovelsError', (error) =>
          Effect.logWarning('Chapter translation failed', error.message).pipe(
            Effect.andThen(
              SubscriptionRef.update(progress, (state) => ({
                ...state,
                state: 'failed' as const,
                message: error.message,
              })),
            ),
          ),
        ),
        Effect.catchTag('LlmSettingsError', (error) =>
          SubscriptionRef.update(progress, (state) => ({
            ...state,
            state: 'failed' as const,
            message: error.message,
          })),
        ),
        Effect.onInterrupt(() =>
          SubscriptionRef.update(progress, (state) => ({ ...state, state: 'stopped' as const })),
        ),
        ahead ? aheadSlots.withPermits(1) : (effect) => effect,
        Effect.ensuring(Effect.sync(() => jobs.delete(key))),
        Effect.annotateLogs({ feature: 'novels', novelId }),
      )

      const fiber = yield* Effect.forkIn(work, scope)
      const job = { progress, fiber, ahead }

      jobs.set(key, job)

      return job
    })

    const planAhead = Effect.fn('Novels.planAhead')(function* (novelId: string, number: number) {
      const current = yield* settings
      const chapters = yield* store.chapters(novelId)

      const wanted = chapters
        .filter((chapter) => chapter.number > number && !chapter.extra)
        .slice(0, current.readAhead)
        .map((chapter) => keyOf(novelId, chapter.number))

      for (const [key, job] of jobs) {
        if (job.ahead && key.startsWith(`${novelId}:`) && !wanted.includes(key)) {
          yield* Effect.forkIn(Fiber.interrupt(job.fiber), scope)
        }
      }

      for (const key of wanted) {
        yield* startJob(novelId, Number(key.slice(novelId.length + 1)), true)
      }
    })

    const viewOf = Effect.fn('Novels.viewOf')(function* (
      novelId: string,
      number: number,
      progress: Option.Option<Progress>,
    ) {
      const current = yield* settings
      const novel = yield* novelOf(novelId)
      const chapter = yield* chapterOf(novelId, number)

      const chapters = (yield* store.chapters(novelId)).filter(
        (row) => !row.extra || row.number === number,
      )

      const text = yield* store.text(novelId, number)
      const cached = yield* store.translation(novelId, number, current.targetLanguage)
      const terms = yield* termsFor(novelId)
      const accepted = terms.filter((term) => !term.suggested)

      const matcher = makeMatcher(
        accepted.map((term) => ({ id: term.id, patterns: [term.original] })),
      )

      const termsById = new Map(accepted.map((term) => [term.id, term]))
      const original = Option.match(text, { onNone: () => [], onSome: (found) => found.paragraphs })

      const translated = Option.match(progress, {
        onSome: (live) => live.paragraphs,
        onNone: () =>
          Option.match(cached, { onNone: () => [], onSome: (found) => found.paragraphs }),
      })

      const paragraphs = original.map((paragraph, index): ReaderParagraph => {
        const found = matcher.find(paragraph)

        const inParagraph = found.flatMap((match) =>
          Option.toArray(Option.fromNullishOr(termsById.get(match.id))),
        )

        const translation = translated[index] ?? null

        return {
          original: paragraph,
          translated: translation,
          originalTerms: found.map((match) => ({
            termId: match.id,
            start: match.start,
            end: match.end,
          })),
          translatedTerms: translation === null ? [] : spansOf(translation, inParagraph),
        }
      })

      const position = chapters.findIndex((row) => row.number === number)
      const readings = yield* store.readings
      const reading = readings.find((row) => row.novel_id === novelId)

      const readyAhead = chapters.filter(
        (row) => row.number > (reading?.chapter ?? number) && row.translated,
      ).length

      const state = ((): TranslationState => {
        if (Option.isSome(progress)) {
          return progress.value.state
        }

        if (Option.isSome(cached)) {
          return 'translated'
        }

        return current.presetId === '' ? 'no-preset' : 'waiting'
      })()

      return {
        novelId,
        novelTitle: novel.title_translated ?? novel.title,
        chapters: chapters.length,
        number,
        title: chapter.title,
        titleTranslated: Option.match(progress, {
          onSome: (live) => live.title ?? chapter.title_translated,
          onNone: () => chapter.title_translated,
        }),
        hasText: Option.isSome(text),
        paragraphs,
        note: Option.match(text, { onNone: () => null, onSome: (found) => found.note }),
        terms: accepted.filter((term) =>
          paragraphs.some((paragraph) =>
            paragraph.originalTerms.some((span) => span.termId === term.id),
          ),
        ),
        state,
        message: Option.match(progress, { onNone: () => null, onSome: (live) => live.message }),
        readyAhead,
        costUsd: Option.match(progress, {
          onSome: (live) => live.costUsd,
          onNone: () =>
            Option.match(cached, { onNone: () => null, onSome: (found) => found.cost_usd }),
        }),
        previous: chapters[position - 1]?.number ?? null,
        next: chapters[position + 1]?.number ?? null,
      } satisfies ChapterView
    })

    const openChapter = Effect.fn('Novels.openChapter')(function* (
      novelId: string,
      number: number,
    ) {
      const chapter = yield* chapterOf(novelId, number)

      yield* textOf(novelId, chapter).pipe(
        Effect.catchTag('NovelsError', (error) =>
          Effect.logWarning('Chapter text could not be fetched', error.message).pipe(
            Effect.as(Option.none()),
          ),
        ),
      )

      const job = yield* startJob(novelId, number, false)

      yield* planAhead(novelId, number).pipe(Effect.forkIn(scope))

      return yield* viewOf(
        novelId,
        number,
        job === undefined ? Option.none() : Option.some(yield* SubscriptionRef.get(job.progress)),
      )
    })

    const watchChapter = (novelId: string, number: number) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const job = jobs.get(keyOf(novelId, number))

          if (job === undefined) {
            return Stream.fromEffect(viewOf(novelId, number, Option.none()))
          }

          return SubscriptionRef.changes(job.progress).pipe(
            Stream.takeUntil((progress) => finished(progress.state)),
            Stream.mapEffect((progress) => viewOf(novelId, number, Option.some(progress))),
          )
        }),
      )

    const hasSource = (chapter: StoredChapter) =>
      chapter.text_url !== null || (!chapter.locked && chapter.url !== null)

    const chapterRow = (
      chapter: StoredChapter,
      siteNames: ReadonlyMap<string, string>,
    ): ChapterRow => {
      const textFrom = (() => {
        if (chapter.origin === 'manual') {
          return 'Pasted'
        }

        const site = chapter.text_url === null ? chapter.site : chapter.text_site

        return chapter.has_text || hasSource(chapter) ? (siteNames.get(site ?? '') ?? site) : null
      })()

      const status = (() => {
        if (chapter.translated) {
          return 'translated' as const
        }

        if (chapter.has_text) {
          return 'original' as const
        }

        return hasSource(chapter) ? ('on-site' as const) : ('no-text' as const)
      })()

      return {
        number: chapter.number,
        locked: chapter.locked,
        title: chapter.title,
        titleTranslated: chapter.title_translated,
        textFrom,
        releasedAt: chapter.released_at,
        status,
        extra: chapter.extra,
      }
    }

    const sourceLabel = (novel: StoredNovel, siteNames: ReadonlyMap<string, string>) =>
      novel.site === null ? 'Pasted' : (siteNames.get(novel.site) ?? novel.site)

    const summaries = Effect.gen(function* () {
      const novels = yield* store.novels
      const counts = new Map((yield* store.counts).map((row) => [row.novel_id, row]))
      const readings = new Map((yield* store.readings).map((row) => [row.novel_id, row]))
      const siteNames = new Map((yield* sites).map((site) => [site.id, site.name]))

      return yield* Effect.forEach(novels, (novel) =>
        Effect.gen(function* () {
          const reading = readings.get(novel.id)

          const readingTitle =
            reading === undefined
              ? null
              : Option.match(yield* store.chapter(novel.id, reading.chapter), {
                  onNone: () => null,
                  onSome: (chapter) => chapter.title_translated ?? chapter.title,
                })

          return {
            id: novel.id,
            title: novel.title,
            titleTranslated: novel.title_translated,
            author: novel.author,
            coverUrl: novel.cover_url,
            language: novel.language,
            sourceLabel: sourceLabel(novel, siteNames),
            chapters: counts.get(novel.id)?.chapters ?? 0,
            newChapters: counts.get(novel.id)?.new_chapters ?? 0,
            reading:
              reading === undefined
                ? null
                : {
                    chapter: reading.chapter,
                    paragraph: reading.paragraph,
                    readAt: reading.read_at,
                  },
            readingTitle,
            addedAt: novel.added_at,
            updatedAt: novel.updated_at,
          } satisfies NovelSummary
        }),
      )
    })

    const translateBlurb = Effect.fn('Novels.translateBlurb')(function* (novelId: string) {
      const current = yield* settings
      const novel = yield* novelOf(novelId)

      if (current.presetId === '' || novel.title_translated !== null) {
        return
      }

      const reply = yield* llm.complete({
        presetId: current.presetId,
        feature: 'novels',
        system: `You translate web novel titles and blurbs into ${current.targetLanguage}.`,
        prompt: [
          'Translate the title on the first line, then the blurb. Answer with the translated title on the first line and the translated blurb after it, nothing else.',
          novel.title,
          novel.synopsis ?? '',
        ].join('\n'),
      })

      const [title = '', ...blurb] = reply.text.split('\n')

      yield* store.updateNovel(novelId, {
        title_translated: title.trim(),
        ...(novel.synopsis === null ? {} : { synopsis_translated: blurb.join('\n').trim() }),
      })
    })

    const inBackground = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catch((error) => Effect.logWarning('Novels background work failed', error)),
        Effect.annotateLogs({ feature: 'novels' }),
        Effect.forkIn(scope),
        Effect.asVoid,
      )

    const listChapters = Effect.fn('Novels.listChapters')(function* (
      site: SiteEntry,
      bookId: string,
    ) {
      const listUrl = siteUrl(site, site.selectors.chapterList ?? site.selectors.book, {
        id: bookId,
      })

      return parseChapterList(site, (yield* fetchPage(listUrl)).body)
    })

    const crossCheck = Effect.fn('Novels.crossCheck')(function* (
      novelId: string,
      host: SiteEntry,
      bookUrl: string,
    ) {
      const bookId = Option.getOrUndefined(bookIdOf(host, new URL(bookUrl)))

      if (bookId === undefined) {
        return 0
      }

      const offered = yield* listChapters(host, bookId)

      const wanted = (yield* store.chapters(novelId)).filter(
        (chapter) =>
          chapter.origin === 'site' &&
          !chapter.has_text &&
          chapter.text_url === null &&
          (chapter.locked || chapter.url === null),
      )

      const changed = yield* store.setTextUrls(novelId, host.id, matchChapters(wanted, offered))

      yield* store.saveTextSource(novelId, host.id, bookUrl)

      if (changed > 0) {
        yield* Effect.logInfo('Chapter text found on a host').pipe(
          Effect.annotateLogs({ site: host.id, chapters: changed }),
        )
      }

      return changed
    })

    const findTextSources = Effect.fn('Novels.findTextSources')(function* (novelId: string) {
      const novel = yield* novelOf(novelId)

      const hosts = (yield* sites).filter(
        (site) => !isOfficial(site) && site.selectors.search !== null,
      )

      yield* Effect.forEach(
        hosts,
        (host) =>
          searchSite(host, novel.title, new Map()).pipe(
            Effect.flatMap((hits) => {
              const match = hits.find((hit) => sameBook(hit, novel))

              return match === undefined
                ? Effect.void
                : Effect.asVoid(crossCheck(novelId, host, match.url))
            }),
            Effect.catchTag('NovelsError', (error) =>
              Effect.logWarning('A host could not be searched', error.message).pipe(
                Effect.annotateLogs({ site: host.id }),
              ),
            ),
          ),
        { concurrency: 3, discard: true },
      )
    })

    const addNovelFromUrl = Effect.fn('Novels.addNovelFromUrl')(function* (address: string) {
      const url = URL.parse(address.trim())

      if (url === null) {
        return yield* invalid('That is not a link.')
      }

      const site = Option.getOrUndefined(siteFor(yield* sites, url))

      if (site === undefined) {
        return yield* invalid(
          `Wenbu does not know ${url.hostname} yet. Add it in Settings › Reader › Sites.`,
        )
      }

      const bookId = Option.getOrUndefined(bookIdOf(site, url))

      if (bookId === undefined) {
        return yield* invalid(`That is not a book page on ${site.name}.`)
      }

      const bookUrl = siteUrl(site, site.selectors.book, { id: bookId })
      const existing = yield* store.novelByUrl(bookUrl)

      if (Option.isSome(existing)) {
        return existing.value.id
      }

      const book = parseBook((yield* fetchPage(bookUrl)).body)
      const chapters = yield* listChapters(site, bookId)

      if (book.title === null || chapters.length === 0) {
        return yield* new NovelsError({
          reason: 'site',
          message: site.name + ' sent a page Wenbu could not read. Try again in a minute.',
        })
      }

      const id = yield* newId

      yield* store.insertNovel({
        id,
        title: book.title ?? bookId,
        author: book.author,
        coverUrl: book.coverUrl,
        synopsis: book.synopsis,
        tags: book.tags,
        status: book.status,
        language: site.language,
        site: site.id,
        bookUrl,
      })

      yield* store.mergeChapters(
        id,
        chapters.map((chapter) => ({ ...chapter, site: site.id })),
        false,
      )

      yield* Effect.logInfo('Novel added').pipe(
        Effect.annotateLogs({ site: site.id, chapters: chapters.length }),
      )

      yield* inBackground(translateBlurb(id))

      if (isOfficial(site)) {
        yield* inBackground(findTextSources(id))
      }

      return id
    })

    const refreshNovel = Effect.fn('Novels.refreshNovel')(function* (novelId: string) {
      const novel = yield* novelOf(novelId)
      const site = Option.getOrUndefined(yield* siteOf(novel.site))

      const bookId =
        site === undefined || novel.book_url === null
          ? undefined
          : Option.getOrUndefined(bookIdOf(site, new URL(novel.book_url)))

      if (site === undefined || bookId === undefined) {
        return
      }

      const chapters = yield* listChapters(site, bookId)

      const added = yield* store.mergeChapters(
        novelId,
        chapters.map((chapter) => ({ ...chapter, site: site.id })),
        true,
      )

      const sources = yield* store.textSources(novelId)

      if (isOfficial(site) && sources.length === 0) {
        yield* findTextSources(novelId)
      }

      for (const source of sources) {
        const host = Option.getOrUndefined(yield* siteOf(source.site))

        if (host !== undefined) {
          yield* crossCheck(novelId, host, source.book_url).pipe(
            Effect.catchTag('NovelsError', (error) =>
              Effect.logWarning('A host could not be checked', error.message).pipe(
                Effect.annotateLogs({ site: host.id }),
                Effect.as(0),
              ),
            ),
          )
        }
      }

      yield* store.updateNovel(novelId, {
        checked_at: yield* nowIso,
      })

      if (added.length > 0) {
        yield* Effect.logInfo('New chapters found').pipe(
          Effect.annotateLogs({ site: site.id, added: added.length }),
        )
      }
    })

    const searchSite = (site: SiteEntry, query: string, known: ReadonlyMap<string, string>) =>
      Effect.gen(function* () {
        const search = site.selectors.search

        if (search === null) {
          return []
        }

        const page = yield* fetchPage(siteUrl(site, search.url, { query }))
        const book = parseBook(page.body)
        // A redirect is not always reported, so a book page also says where it is.
        const landed = URL.parse(book.url ?? '', page.url) ?? URL.parse(page.url)

        const hits =
          landed !== null && Option.isSome(bookIdOf(site, landed))
            ? [
                {
                  url: landed.href,
                  title: book.title ?? query,
                  author: book.author,
                  coverUrl: book.coverUrl,
                  latestChapter:
                    book.latestChapter === null ? null : cleanTitle(book.latestChapter),
                },
              ]
            : parseSearch(site, page.body)

        return hits.map((hit): SearchResult => ({
          site: site.id,
          siteName: site.name,
          url: hit.url,
          title: hit.title,
          author: hit.author,
          coverUrl: hit.coverUrl,
          latestChapter: hit.latestChapter,
          novelId: known.get(hit.url) ?? null,
          official: isOfficial(site),
        }))
      })

    const originalQuery = Effect.fn('Novels.originalQuery')(function* (query: string) {
      const current = yield* settings

      if (/[぀-ヿ㐀-鿿가-힯]/.test(query) || current.presetId === '') {
        return Option.none<string>()
      }

      const reply = yield* llm.complete({
        presetId: current.presetId,
        feature: 'novels',
        prompt: `A reader is looking for a Chinese web novel known in English as "${query}". Answer with its most likely original Chinese title only.`,
      })

      return Option.some(reply.text.split('\n')[0]?.trim() ?? '').pipe(
        Option.filter((title) => title !== ''),
      )
    })

    const searchNovels = (query: string) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const all = (yield* sites)
            .filter((site) => site.selectors.search !== null)
            .toSorted((left, right) => Number(isOfficial(right)) - Number(isOfficial(left)))

          const known = new Map(
            (yield* store.novels).flatMap((novel) =>
              novel.book_url === null ? [] : [[novel.book_url, novel.id] as const],
            ),
          )

          const original = yield* originalQuery(query).pipe(
            Effect.catch(() => Effect.succeed(Option.none<string>())),
          )

          const queries = [...Option.toArray(original), query]

          return Stream.fromIterable(all).pipe(
            Stream.mapEffect(
              (site) =>
                Effect.forEach(queries, (text) => searchSite(site, text, known)).pipe(
                  Effect.map((found) => {
                    const seen = new Set<string>()

                    return SiteResults.make({
                      site: site.id,
                      results: found
                        .flat()
                        .filter((hit) => !seen.has(hit.url) && seen.add(hit.url) !== undefined),
                    })
                  }),
                  Effect.timeout('20 seconds'),
                  Effect.catch((error) =>
                    Effect.succeed(
                      SiteFailed.make({
                        site: site.id,
                        message: Predicate.hasProperty(error, 'message')
                          ? String(error.message)
                          : 'The site did not answer in time.',
                      }),
                    ),
                  ),
                ),
              { concurrency: 'unbounded' },
            ),
          )
        }),
      )

    const explainText = Effect.fn('Novels.explainText')(function* (
      novelId: string,
      number: number,
      text: string,
    ) {
      const current = yield* settings

      if (current.presetId === '') {
        return yield* new NovelsError({
          reason: 'no-preset',
          message: 'Choose a model for Novels in Settings › Reader › Novels.',
        })
      }

      const paragraphs = Option.match(yield* store.text(novelId, number), {
        onNone: () => [],
        onSome: (found) => found.paragraphs,
      })

      const context = paragraphs.find((paragraph) => paragraph.includes(text)) ?? ''

      const reply = yield* llm
        .complete({
          presetId: current.presetId,
          feature: 'novels',
          system: `You explain words and phrases from web novels to a reader of ${current.targetLanguage}.`,
          prompt: [
            `Explain "${text}" as it is used in this line: ${context}`,
            'Answer in exactly this form, each on its own line:',
            'Reading: its pronunciation (pinyin, romaji or romanization)',
            `Translation: a short ${current.targetLanguage} rendering for a glossary`,
            'Kind: one of character, place, sect, technique, item, concept, other',
            'Explanation: two or three sentences',
          ].join('\n'),
        })
        .pipe(
          Effect.mapError((error) => new NovelsError({ reason: 'llm', message: error.message })),
        )

      const field = (name: string) => {
        const line = reply.text.split('\n').find((row) => row.toLowerCase().startsWith(`${name}:`))

        return line === undefined ? null : line.slice(name.length + 1).trim()
      }

      const kind = field('kind')?.toLowerCase() ?? null

      return {
        text: field('explanation') ?? reply.text,
        reading: field('reading'),
        translation: field('translation'),
        kind: kind !== null && isTermKind(kind) ? kind : null,
        chapters: (yield* store.chaptersContaining(novelId, text))
          .filter((chapter) => chapter !== number)
          .slice(0, 5),
        costUsd: reply.costUsd ?? null,
      }
    })

    const detect = Effect.fn('Novels.detectSite')(function* (address: string) {
      const url = URL.parse(address.trim())

      if (url === null) {
        return yield* invalid('That is not a link.')
      }

      const book = yield* fetchPage(url.href)
      const bookRoot = book.body

      const listLink =
        /<a[^>]+href="([^"]+)"[^>]*>[^<]*(?:目錄|目录|章節列表|章节列表|全部章節|全部章节|完整目錄|完整目录|目次)[^<]*<\/a>/.exec(
          bookRoot,
        )?.[1]

      const listUrl = listLink === undefined ? undefined : URL.parse(listLink, url.href)?.href

      const list =
        listUrl === undefined ? null : { url: listUrl, html: (yield* fetchPage(listUrl)).body }

      const chapterLink = [
        ...(list?.html ?? bookRoot).matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g),
      ].find((match) => looksLikeChapter(cleanTitle((match[2] ?? '').trim())))?.[1]

      const chapterUrl =
        chapterLink === undefined ? undefined : URL.parse(chapterLink, url.href)?.href

      if (chapterUrl === undefined) {
        return yield* invalid('Wenbu could not find a chapter list on that page.')
      }

      const entry = detectSite(url, {
        book: bookRoot,
        chapterList: list,
        chapter: (yield* fetchPage(chapterUrl)).body,
      })

      const chapters = parseChapterList(entry, list?.html ?? bookRoot)
      const sample = parseChapterText(entry, (yield* fetchPage(chapterUrl)).body)
      const details = parseBook(bookRoot)

      return {
        entry,
        title: details.title,
        author: details.author,
        chapters: chapters.length,
        firstChapters: chapters.slice(0, 5).map((chapter) => chapter.title),
        lastChapters: chapters.slice(-5).map((chapter) => chapter.title),
        sample: sample.paragraphs.slice(0, 6),
      }
    })

    const runScan = Effect.fn('Novels.scanTerms')(function* (
      novelId: string,
      count: number,
      progress: SubscriptionRef.SubscriptionRef<ScanProgress>,
    ) {
      const current = yield* settings
      const novel = yield* novelOf(novelId)

      if (current.presetId === '') {
        return yield* new NovelsError({
          reason: 'no-preset',
          message: 'Choose a model for Novels in Settings › Novels.',
        })
      }

      const chapters = (yield* store.chapters(novelId))
        .filter((chapter) => !chapter.extra)
        .slice(0, Math.max(1, count))

      const update = (fields: Partial<ScanProgress>) =>
        SubscriptionRef.update(progress, (state) => ({ ...state, ...fields }))

      yield* update({ stage: 'reading', total: chapters.length })

      const texts: Array<ReadonlyArray<string>> = []
      const numbers: Array<number> = []

      for (const [index, chapter] of chapters.entries()) {
        const text = yield* textOf(novelId, chapter).pipe(
          Effect.catchTag('NovelsError', (error) =>
            Effect.logWarning('A chapter could not be read for the scan', error.message).pipe(
              Effect.as(Option.none()),
            ),
          ),
        )

        if (Option.isSome(text)) {
          texts.push(text.value.paragraphs)
          numbers.push(chapter.number)
        }

        yield* update({ done: index + 1 })

        if (!chapter.has_text && Option.isSome(text) && index < chapters.length - 1) {
          yield* Effect.sleep(scanPause)
        }
      }

      yield* update({ stage: 'finding', done: 0, total: 0 })

      const known = (yield* store.terms(novelId)).map((term) => term.original)
      const candidates = findCandidates(novel.language, texts, known)

      yield* update({ stage: 'checking', done: 0, total: candidates.length })

      const checked = yield* checkCandidates(
        (prompt) =>
          llm
            .complete({
              presetId: current.presetId,
              feature: 'novels',
              prompt,
              timeout: '3 minutes',
            })
            .pipe(
              Effect.map((reply) => ({ text: reply.text, costUsd: reply.costUsd ?? null })),
              Effect.mapError(
                (error) => new NovelsError({ reason: 'llm', message: error.message }),
              ),
            ),
        candidates,
        current.targetLanguage,
        100,
        (done) => update({ done }),
      )

      for (const term of checked.terms) {
        yield* store.saveTerm(
          novelId,
          yield* newId,
          {
            original: term.candidate.text,
            translation: term.translation,
            kind: term.kind,
            gender: term.gender,
            note: null,
            reading: term.reading,
          },
          {
            origin: 'scan',
            chapters: term.candidate.chapters.flatMap((at) =>
              Option.toArray(Option.fromNullishOr(numbers[at - 1])),
            ),
            count: term.candidate.count,
          },
        )
      }

      yield* update({ stage: 'done', found: checked.terms.length, costUsd: checked.costUsd })

      yield* Effect.logInfo('Term scan finished').pipe(
        Effect.annotateLogs({
          chapters: texts.length,
          candidates: candidates.length,
          kept: checked.terms.length,
          costUsd: checked.costUsd,
        }),
      )
    })

    const startScan = Effect.fn('Novels.startScan')(function* (novelId: string, count: number) {
      const started = yield* SubscriptionRef.make<ScanProgress>(scanStart)

      scans.set(novelId, started)

      yield* runScan(novelId, count, started).pipe(
        Effect.catchTag('NovelsError', (error) =>
          SubscriptionRef.update(started, (state) => ({
            ...state,
            stage: 'failed' as const,
            message: error.message,
          })),
        ),
        Effect.ensuring(Effect.sync(() => scans.delete(novelId))),
        Effect.annotateLogs({ feature: 'novels', novelId }),
        Effect.forkIn(scope),
      )

      return started
    })

    const canRead = (chapter: StoredChapter) =>
      chapter.has_text || chapter.text_url !== null || (!chapter.locked && chapter.url !== null)

    const bookOf = Effect.fn('Novels.bookOf')(function* (novelId: string) {
      const novel = yield* novelOf(novelId)
      const current = yield* settings
      const chapters = (yield* store.chapters(novelId)).filter((chapter) => !chapter.extra)
      const reading = (yield* store.readings).find((row) => row.novel_id === novelId)

      const search = (words: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const hits = yield* insights.search(novelId, words, 30)
          const translated = new Map<number, ReadonlyArray<string | null>>()

          for (const number of new Set(hits.map((hit) => hit.number))) {
            const translation = yield* store.translation(novelId, number, current.targetLanguage)

            if (Option.isSome(translation)) {
              translated.set(number, translation.value.paragraphs)
            }
          }

          return hits.map((hit) => ({
            ...hit,
            translation: translated.get(hit.number)?.[hit.paragraph] ?? null,
          }))
        })

      const book: NovelBook = {
        title: novel.title_translated ?? novel.title,
        originalTitle: novel.title,
        ongoing: novel.status !== 'finished',
        chapters: chapters.map((chapter) => ({
          number: chapter.number,
          title: chapter.title,
          titleTranslated: chapter.title_translated,
        })),
        digests: yield* insights.digests(novelId),
        terms: yield* termsFor(novelId),
        flags: contentFlags(current.contentFlags),
        fetched: chapters.filter((chapter) => chapter.has_text).length,
        readingChapter: reading?.chapter ?? null,
        search,
      }

      return { book, chapters, current }
    })

    const novelInsight = Effect.fn('Novels.novelInsight')(function* (novelId: string) {
      const { book, chapters } = yield* bookOf(novelId)

      return insightOf(
        book,
        chapters.filter((chapter) => canRead(chapter)).length,
        yield* insights.answers(novelId, 5),
      )
    })

    const noPreset = new NovelsError({
      reason: 'no-preset',
      message: 'Choose a model for Novels in Settings › Novels.',
    })

    const readForDigest = Effect.fnUntraced(function* (
      novelId: string,
      group: ReadonlyArray<StoredChapter>,
    ) {
      const texts: Array<DigestChapter> = []

      for (const chapter of group) {
        const text = yield* textOf(novelId, chapter).pipe(
          Effect.catchTag('NovelsError', (error) =>
            Effect.logWarning('A chapter could not be read for its digest', error.message).pipe(
              Effect.as(Option.none()),
            ),
          ),
        )

        if (Option.isSome(text)) {
          texts.push({
            number: chapter.number,
            title: chapter.title,
            paragraphs: text.value.paragraphs,
          })
        }

        if (!chapter.has_text && Option.isSome(text)) {
          yield* Effect.sleep(scanPause)
        }
      }

      return texts
    })

    const runDigests = Effect.fn('Novels.digestNovel')(function* (
      novelId: string,
      upTo: number,
      progress: SubscriptionRef.SubscriptionRef<DigestProgress>,
    ) {
      const { book, chapters, current } = yield* bookOf(novelId)

      if (current.presetId === '') {
        return yield* noPreset
      }

      const made = new Set(book.digests.map((digest) => digest.number))

      const targets = chapters.filter(
        (chapter) => chapter.number <= upTo && !made.has(chapter.number) && canRead(chapter),
      )

      const update = (fields: Partial<DigestProgress>) =>
        SubscriptionRef.update(progress, (state) => ({ ...state, ...fields }))

      yield* update({ stage: 'reading', total: targets.length })

      let done = 0
      let spent = 0
      let missing = 0

      for (let start = 0; start < targets.length; start += 10) {
        const group = targets.slice(start, start + 10)

        yield* update({ stage: 'reading' })

        const texts = yield* readForDigest(novelId, group)

        yield* update({ stage: 'digesting' })

        for (const batch of digestBatches(texts)) {
          const reply = yield* llm
            .complete({
              presetId: current.presetId,
              feature: 'novels',
              prompt: digestPrompt(batch, book.flags, current.targetLanguage),
              timeout: '3 minutes',
            })
            .pipe(
              Effect.mapError(
                (error) => new NovelsError({ reason: 'llm', message: error.message }),
              ),
            )

          const numbers = batch.map((chapter) => chapter.number)
          const digests = parseDigests(reply.text, numbers, book.flags)
          const costUsd = reply.costUsd ?? 0

          for (const digest of digests) {
            yield* insights.saveDigest(novelId, {
              ...digest,
              costUsd: costUsd / Math.max(1, digests.length),
            })
          }

          missing += batch.length - digests.length
          spent += costUsd
          done += batch.length

          yield* update({ done, costUsd: spent })
        }

        done += group.length - texts.length

        yield* update({ done })
      }

      yield* update({ stage: 'done', done: targets.length })

      yield* Effect.logInfo('Chapter digests made').pipe(
        Effect.annotateLogs({ chapters: targets.length, missing, costUsd: spent }),
      )
    })

    const startDigests = Effect.fn('Novels.startDigests')(function* (
      novelId: string,
      upTo: number,
    ) {
      const started = yield* SubscriptionRef.make<DigestProgress>(digestStart)

      digestRuns.set(novelId, started)

      yield* runDigests(novelId, upTo, started).pipe(
        Effect.catchTag('NovelsError', (error) =>
          SubscriptionRef.update(started, (state) => ({
            ...state,
            stage: 'failed' as const,
            message: error.message,
          })),
        ),
        Effect.ensuring(Effect.sync(() => digestRuns.delete(novelId))),
        Effect.annotateLogs({ feature: 'novels', novelId }),
        Effect.forkIn(scope),
      )

      return started
    })

    const digestNovel = (novelId: string, upTo: number) =>
      Stream.unwrap(
        Effect.map(
          Effect.suspend(() => {
            const running = digestRuns.get(novelId)

            return running === undefined ? startDigests(novelId, upTo) : Effect.succeed(running)
          }),
          (progress) =>
            SubscriptionRef.changes(progress).pipe(
              Stream.takeUntil((state) => state.stage === 'done' || state.stage === 'failed'),
            ),
        ),
      )

    const chatHistory = Effect.fnUntraced(function* (novelId: string, kind: NovelAnswer['kind']) {
      if (kind === 'recap') {
        return []
      }

      return (yield* insights.answers(novelId, HISTORY_ANSWERS))
        .filter((answer) => answer.kind === 'question')
        .toReversed()
        .flatMap((answer) => [
          { role: 'user' as const, content: answer.question },
          { role: 'assistant' as const, content: answer.text },
        ])
    })

    const answerQuestion = Effect.fn('Novels.askNovel')(function* (
      novelId: string,
      question: string,
      spoilers: boolean,
      kind: NovelAnswer['kind'],
      step: (label: string) => Effect.Effect<void>,
    ) {
      const { book, current } = yield* bookOf(novelId)

      if (current.presetId === '') {
        return yield* noPreset
      }

      if (kind === 'question' && question.trim() === '') {
        return yield* new NovelsError({ reason: 'invalid', message: 'Ask a question first.' })
      }

      const model = yield* llm
        .model(current.presetId, { feature: 'novels' })
        .pipe(
          Effect.mapError(
            (error) => new NovelsError({ reason: 'no-preset', message: error.message }),
          ),
        )

      const toolkit = yield* NovelToolkit.pipe(Effect.provide(novelHandlers(book)))

      const chat = yield* Chat.fromPrompt([
        { role: 'system', content: chatPrompt(book, current.targetLanguage, spoilers, kind) },
        ...(yield* chatHistory(novelId, kind)),
      ])

      const asked =
        kind === 'recap' ? `Recap up to chapter ${book.readingChapter ?? 0}.` : question.trim()

      let inputTokens = 0
      let outputTokens = 0
      let cachedTokens = 0
      let reply = ''

      for (let index = 0; index < MAX_CHAT_STEPS && reply === ''; index++) {
        const last = index === MAX_CHAT_STEPS - 1

        const response = yield* chat
          .generateText({
            prompt: index === 0 ? asked : [],
            toolkit,
            ...(last ? { toolChoice: 'none' as const } : {}),
          })
          .pipe(
            Effect.provide(model.layer),
            Effect.mapError((error) => new NovelsError({ reason: 'llm', message: error.message })),
            Effect.timeoutOrElse({
              duration: '90 seconds',
              orElse: () =>
                Effect.fail(
                  new NovelsError({
                    reason: 'llm',
                    message: `${model.modelName} didn't answer in time.`,
                  }),
                ),
            }),
          )

        inputTokens += response.usage.inputTokens.total ?? 0
        outputTokens += response.usage.outputTokens.total ?? 0
        cachedTokens += response.usage.inputTokens.cacheRead ?? 0

        for (const call of response.toolCalls) {
          yield* step(novelToolLabels[call.name] ?? 'Looking things up')
        }

        if (response.toolCalls.length === 0) {
          reply = response.text.trim()
        }
      }

      const cited = citationsOf(reply, book.chapters)
      const costUsd = yield* model.spend({ inputTokens, outputTokens }, cachedTokens)

      const answer: NovelAnswer = {
        id: yield* newId,
        kind,
        question: kind === 'recap' ? `Up to chapter ${book.readingChapter ?? 0}` : question.trim(),
        text:
          cited.text === ''
            ? 'Wenbu looked through the novel but got no answer. Try asking in other words.'
            : cited.text,
        chapters: cited.chapters,
        coverage: coverageOf(book),
        spoilers,
        modelName: model.modelName,
        costUsd: costUsd ?? null,
        askedAt: DateTime.formatIso(yield* DateTime.now),
      }

      yield* insights.saveAnswer(novelId, answer)

      yield* Effect.logInfo('Novel Chat answered').pipe(
        Effect.annotateLogs({ kind, inputTokens, outputTokens, chapters: cited.chapters.length }),
      )

      return answer
    })

    const askNovel = (
      novelId: string,
      question: string,
      spoilers: boolean,
      kind: NovelAnswer['kind'],
    ) =>
      Stream.callback<NovelAskEvent, NovelsError>((queue) =>
        answerQuestion(novelId, question, spoilers, kind, (label) =>
          Effect.asVoid(Queue.offer(queue, AskStep.make({ label }))),
        ).pipe(
          Effect.flatMap((answer) => Queue.offer(queue, AskAnswer.make({ answer }))),
          Effect.annotateLogs({ feature: 'novels', novelId }),
          Effect.matchEffect({
            onFailure: (error) => Queue.fail(queue, error),
            onSuccess: () => Queue.end(queue),
          }),
        ),
      )

    const scanTerms = (novelId: string, count: number) =>
      Stream.unwrap(
        Effect.map(
          Effect.suspend(() => {
            const running = scans.get(novelId)

            return running === undefined ? startScan(novelId, count) : Effect.succeed(running)
          }),
          (progress) =>
            SubscriptionRef.changes(progress).pipe(
              Stream.takeUntil((state) => state.stage === 'done' || state.stage === 'failed'),
            ),
        ),
      )

    const checkForUpdates = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis

      for (const novel of yield* store.novels) {
        if (novel.site === null) {
          continue
        }

        const chapters = yield* store.chapters(novel.id)

        const waiting = chapters.some(
          (chapter) => chapter.is_new && !chapter.has_text && !hasSource(chapter),
        )

        const checkedAt =
          novel.checked_at === null
            ? 0
            : DateTime.toEpochMillis(DateTime.makeUnsafe(novel.checked_at))

        if (now - checkedAt >= (waiting ? waitingEvery : checkEvery)) {
          yield* refreshNovel(novel.id).pipe(
            Effect.catchTag('NovelsError', (error) =>
              Effect.logWarning('Checking a novel for new chapters failed', error.message),
            ),
          )
        }
      }
    })

    yield* checkForUpdates.pipe(
      Effect.delay('2 minutes'),
      Effect.repeat(Schedule.spaced('15 minutes')),
      Effect.provideService(Interactive, false),
      Effect.annotateLogs({ feature: 'novels' }),
      Effect.forkIn(scope),
    )

    return NovelsRpc.of({
      novelShelf: () =>
        Effect.gen(function* () {
          const novels = yield* summaries

          const titles = new Map(
            novels.map((novel) => [novel.id, novel.titleTranslated ?? novel.title]),
          )

          const newChapters = yield* Effect.forEach(
            novels.filter((novel) => novel.newChapters > 0),
            (novel) =>
              Effect.map(store.chapters(novel.id), (chapters) =>
                chapters
                  .filter((chapter) => chapter.is_new)
                  .map((chapter): NewChapter => ({
                    novelId: novel.id,
                    novelTitle: titles.get(novel.id) ?? novel.title,
                    number: chapter.number,
                    title: chapter.title_translated ?? chapter.title,
                    hasText: chapter.has_text || chapter.url !== null,
                    translated: chapter.translated,
                    releasedAt: chapter.released_at ?? novel.updatedAt,
                  })),
              ),
          )

          return {
            novels,
            newChapters: newChapters
              .flat()
              .toSorted(
                (left, right) =>
                  right.releasedAt.localeCompare(left.releasedAt) || right.number - left.number,
              )
              .slice(0, 8),
          }
        }).pipe(Effect.annotateLogs({ feature: 'novels' })),
      novelDetails: ({ novelId }) =>
        Effect.gen(function* () {
          const novel = yield* novelOf(novelId)
          const summary = (yield* summaries).find((row) => row.id === novelId)
          const counts = (yield* store.counts).find((row) => row.novel_id === novelId)
          const chapters = yield* store.chapters(novelId)
          const site = Option.getOrUndefined(yield* siteOf(novel.site))
          const siteNames = new Map((yield* sites).map((entry) => [entry.id, entry.name]))
          const after = summary?.reading?.chapter ?? 0

          if (summary === undefined) {
            return yield* notFound('This novel')
          }

          return {
            ...summary,
            synopsis: novel.synopsis,
            synopsisTranslated: novel.synopsis_translated,
            tags: novel.tags,
            status: novel.status,
            url: novel.book_url,
            officialSource:
              site === undefined || novel.book_url === null || !isOfficial(site)
                ? null
                : { site: site.id, siteName: site.name, url: novel.book_url },
            textSources: [
              ...(site === undefined || novel.book_url === null || isOfficial(site)
                ? []
                : [
                    {
                      site: site.id,
                      siteName: site.name,
                      url: novel.book_url,
                      chapters: chapters.filter((chapter) => chapter.site === site.id).length,
                      checkedAt: novel.checked_at,
                    },
                  ]),
              ...(yield* store.textSources(novelId)).map((source) => ({
                site: source.site,
                siteName: siteNames.get(source.site) ?? source.site,
                url: source.book_url,
                chapters: chapters.filter((chapter) => chapter.text_site === source.site).length,
                checkedAt: source.checked_at,
              })),
            ],
            translatedChapters: counts?.translated ?? 0,
            readyAhead: chapters.filter((chapter) => chapter.number > after && chapter.translated)
              .length,
            glossaryTerms: counts?.terms ?? 0,
            suggestedTerms: counts?.suggested ?? 0,
            spentUsd: counts?.spent ?? 0,
          }
        }),
      novelChapters: ({ novelId, page, pageSize, newestFirst }) =>
        Effect.gen(function* () {
          yield* novelOf(novelId)

          const siteNames = new Map((yield* sites).map((site) => [site.id, site.name]))
          const chapters = yield* store.chapters(novelId)
          const ordered = newestFirst ? chapters.toReversed() : chapters
          const size = Math.max(1, pageSize)

          return {
            rows: ordered
              .slice(page * size, (page + 1) * size)
              .map((chapter) => chapterRow(chapter, siteNames)),
            total: chapters.length,
          }
        }),
      createNovel: ({ title, language }) =>
        Effect.gen(function* () {
          if (title.trim() === '') {
            return yield* invalid('Give the novel a title.')
          }

          const id = yield* newId

          yield* store.insertNovel({
            id,
            title: title.trim(),
            author: null,
            coverUrl: null,
            synopsis: null,
            tags: [],
            status: null,
            language,
            site: null,
            bookUrl: null,
          })

          yield* inBackground(translateBlurb(id))

          return id
        }),
      addNovelFromUrl: ({ url }) =>
        addNovelFromUrl(url).pipe(Effect.annotateLogs({ feature: 'novels' })),
      removeNovel: ({ novelId }) =>
        Effect.gen(function* () {
          for (const [key, job] of jobs) {
            if (key.startsWith(`${novelId}:`)) {
              yield* Effect.forkIn(Fiber.interrupt(job.fiber), scope)
            }
          }

          yield* store.removeNovel(novelId)
        }),
      previewPaste: ({ text }) =>
        Effect.succeed(
          splitChapters(text).map((chapter) => ({
            title: chapter.title === null ? null : cleanTitle(chapter.title),
            paragraphs: chapter.paragraphs.length,
            characters: chapter.paragraphs.reduce(
              (total, paragraph) => total + paragraph.length,
              0,
            ),
            scrambled: isScrambled(chapter.paragraphs.join('')),
          })),
        ),
      pasteChapters: ({ novelId, text, startAt }) =>
        Effect.gen(function* () {
          yield* novelOf(novelId)

          const split = splitChapters(text).filter((chapter) => chapter.paragraphs.length > 0)

          if (split.length === 0) {
            return yield* invalid('There is no text to add.')
          }

          if (split.some((chapter) => isScrambled(chapter.paragraphs.join('')))) {
            return yield* invalid(
              'This text looks scrambled, as protected pages copy. Wenbu cannot translate it.',
            )
          }

          const last = (yield* store.chapters(novelId)).reduce(
            (max, chapter) => Math.max(max, chapter.number),
            0,
          )

          const first = startAt ?? last + 1

          const numbers = yield* Effect.forEach(split, (chapter, index) =>
            Effect.gen(function* () {
              const number = first + index

              yield* store.putManualChapter(
                novelId,
                number,
                cleanTitle(chapter.title ?? `Chapter ${number}`),
                {
                  paragraphs: chapter.paragraphs,
                  note: null,
                },
              )

              return number
            }),
          )

          yield* Effect.logInfo('Chapters pasted').pipe(
            Effect.annotateLogs({ feature: 'novels', chapters: numbers.length }),
          )

          return numbers
        }),
      refreshNovel: ({ novelId }) =>
        refreshNovel(novelId).pipe(Effect.annotateLogs({ feature: 'novels' })),
      openChapter: ({ novelId, number }) =>
        openChapter(novelId, number).pipe(Effect.annotateLogs({ feature: 'novels' })),
      watchChapter: ({ novelId, number }) => watchChapter(novelId, number),
      retranslateChapter: ({ novelId, number }) =>
        Effect.gen(function* () {
          yield* store.forgetTranslation(novelId, [number])
          yield* startJob(novelId, number, false)
        }),
      saveNovelReading: ({ novelId, number, paragraph }) =>
        store.saveReading(novelId, number, paragraph),
      searchNovels: ({ query }) => searchNovels(query),
      novelTerms: ({ novelId }) => store.terms(novelId),
      scanTerms: ({ novelId, chapters }) => scanTerms(novelId, chapters),
      novelInsight: ({ novelId }) => novelInsight(novelId),
      digestNovel: ({ novelId, upTo }) => digestNovel(novelId, upTo),
      askNovel: ({ novelId, question, spoilers, kind }) =>
        askNovel(novelId, question, spoilers, kind),
      explainText: ({ novelId, number, text }) =>
        explainText(novelId, number, text).pipe(Effect.annotateLogs({ feature: 'novels' })),
      glossaryShelf: () => glossaryShelf,
      glossaryPage: ({ ref }) => glossaryPage(ref),
      editGlossary: ({ edit }) => editGlossary(edit),
      findTerms: ({ query }) => findTerms(query),
      exportGlossary: ({ ref }) => exportGlossary(ref),
      novelSettings: () => settings,
      saveNovelSettings: (next) => Effect.orDie(settingsStore.set(settingsKey, next)),
      novelSites: () => sites,
      detectSite: ({ url }) => detect(url).pipe(Effect.annotateLogs({ feature: 'novels' })),
      editSite: ({ edit }) =>
        Match.valueTags(edit, {
          SaveSite: ({ entry }) =>
            entry.hosts.length === 0 || entry.id.trim() === ''
              ? Effect.fail(invalid('A site needs an address.'))
              : store.saveSite({ ...entry, builtIn: false }),
          RemoveSite: ({ id }) => store.removeSite(id),
        }),
    })
  }),
)
