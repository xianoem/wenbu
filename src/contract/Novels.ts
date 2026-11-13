import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const NovelLanguage = Schema.Literals(['zh', 'ja', 'ko'])

export type NovelLanguage = typeof NovelLanguage.Type

export const NovelSettings = Schema.Struct({
  presetId: Schema.String,
  targetLanguage: Schema.String,
  readAhead: Schema.Int,
  contentFlags: Schema.Array(Schema.String),
})

export type NovelSettings = typeof NovelSettings.Type

export const defaultNovelSettings: NovelSettings = {
  presetId: '',
  targetLanguage: 'English',
  readAhead: 2,
  contentFlags: [],
}

export const NovelReading = Schema.Struct({
  chapter: Schema.Int,
  paragraph: Schema.Int,
  readAt: Schema.String,
})

export type NovelReading = typeof NovelReading.Type

export const NovelSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  titleTranslated: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  coverUrl: Schema.NullOr(Schema.String),
  language: NovelLanguage,
  sourceLabel: Schema.String,
  chapters: Schema.Int,
  newChapters: Schema.Int,
  reading: Schema.NullOr(NovelReading),
  readingTitle: Schema.NullOr(Schema.String),
  addedAt: Schema.String,
  updatedAt: Schema.String,
})

export type NovelSummary = typeof NovelSummary.Type

export const NewChapter = Schema.Struct({
  novelId: Schema.String,
  novelTitle: Schema.String,
  number: Schema.Int,
  title: Schema.String,
  hasText: Schema.Boolean,
  translated: Schema.Boolean,
  releasedAt: Schema.String,
})

export type NewChapter = typeof NewChapter.Type

export const NovelShelf = Schema.Struct({
  novels: Schema.Array(NovelSummary),
  newChapters: Schema.Array(NewChapter),
})

export type NovelShelf = typeof NovelShelf.Type

export const TextSource = Schema.Struct({
  site: Schema.String,
  siteName: Schema.String,
  url: Schema.String,
  chapters: Schema.Int,
  checkedAt: Schema.NullOr(Schema.String),
})

export type TextSource = typeof TextSource.Type

export const NovelDetails = Schema.Struct({
  ...NovelSummary.fields,
  synopsis: Schema.NullOr(Schema.String),
  synopsisTranslated: Schema.NullOr(Schema.String),
  tags: Schema.Array(Schema.String),
  status: Schema.NullOr(Schema.Literals(['ongoing', 'finished'])),
  url: Schema.NullOr(Schema.String),
  officialSource: Schema.NullOr(
    Schema.Struct({ site: Schema.String, siteName: Schema.String, url: Schema.String }),
  ),
  textSources: Schema.Array(TextSource),
  translatedChapters: Schema.Int,
  readyAhead: Schema.Int,
  glossaryTerms: Schema.Int,
  suggestedTerms: Schema.Int,
  spentUsd: Schema.Number,
})

export type NovelDetails = typeof NovelDetails.Type

export const ChapterStatus = Schema.Literals(['no-text', 'on-site', 'original', 'translated'])

export type ChapterStatus = typeof ChapterStatus.Type

export const ChapterRow = Schema.Struct({
  number: Schema.Int,
  locked: Schema.Boolean,
  title: Schema.String,
  titleTranslated: Schema.NullOr(Schema.String),
  textFrom: Schema.NullOr(Schema.String),
  releasedAt: Schema.NullOr(Schema.String),
  status: ChapterStatus,
  extra: Schema.Boolean,
})

export type ChapterRow = typeof ChapterRow.Type

export const ChapterPage = Schema.Struct({
  rows: Schema.Array(ChapterRow),
  total: Schema.Int,
})

export type ChapterPage = typeof ChapterPage.Type

export const ListChapters = Schema.Struct({
  novelId: Schema.String,
  page: Schema.Int,
  pageSize: Schema.Int,
  newestFirst: Schema.Boolean,
})

export const TermKind = Schema.Literals([
  'character',
  'place',
  'sect',
  'technique',
  'item',
  'concept',
  'other',
])

export type TermKind = typeof TermKind.Type

export const TermGender = Schema.Literals(['m', 'f'])

export const TermOrigin = Schema.Literals(['manual', 'translation', 'scan'])

export type TermOrigin = typeof TermOrigin.Type

export const GlossaryTerm = Schema.Struct({
  id: Schema.String,
  original: Schema.String,
  translation: Schema.String,
  kind: TermKind,
  gender: Schema.NullOr(TermGender),
  note: Schema.NullOr(Schema.String),
  suggested: Schema.Boolean,
  glossary: Schema.String,
  chapters: Schema.Array(Schema.Int),
  origin: TermOrigin,
  count: Schema.Int,
  reading: Schema.NullOr(Schema.String),
})

export type GlossaryTerm = typeof GlossaryTerm.Type

export const GlossaryRef = Schema.Struct({
  kind: Schema.Literals(['novel', 'general']),
  id: Schema.String,
})

export type GlossaryRef = typeof GlossaryRef.Type

export const GeneralGlossarySummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  terms: Schema.Int,
  novels: Schema.Int,
  updatedAt: Schema.String,
})

export type GeneralGlossarySummary = typeof GeneralGlossarySummary.Type

export const NovelGlossarySummary = Schema.Struct({
  novelId: Schema.String,
  title: Schema.String,
  originalTitle: Schema.String,
  terms: Schema.Int,
  toReview: Schema.Int,
  updatedAt: Schema.String,
})

export type NovelGlossarySummary = typeof NovelGlossarySummary.Type

export const GlossaryShelf = Schema.Struct({
  general: Schema.Array(GeneralGlossarySummary),
  novels: Schema.Array(NovelGlossarySummary),
})

export type GlossaryShelf = typeof GlossaryShelf.Type

export const GlossaryPick = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  terms: Schema.Int,
  picked: Schema.Boolean,
})

export type GlossaryPick = typeof GlossaryPick.Type

export const GlossaryPage = Schema.Struct({
  ref: GlossaryRef,
  name: Schema.String,
  originalName: Schema.NullOr(Schema.String),
  terms: Schema.Array(GlossaryTerm),
  picks: Schema.Array(GlossaryPick),
  novels: Schema.Int,
})

export type GlossaryPage = typeof GlossaryPage.Type

export const TermHit = Schema.Struct({
  ref: GlossaryRef,
  glossaryName: Schema.String,
  term: GlossaryTerm,
})

export type TermHit = typeof TermHit.Type

/** UTF-16 offsets. */
export const TermSpan = Schema.Struct({
  termId: Schema.String,
  start: Schema.Int,
  end: Schema.Int,
})

export type TermSpan = typeof TermSpan.Type

export const ReaderParagraph = Schema.Struct({
  original: Schema.String,
  translated: Schema.NullOr(Schema.String),
  originalTerms: Schema.Array(TermSpan),
  translatedTerms: Schema.Array(TermSpan),
})

export type ReaderParagraph = typeof ReaderParagraph.Type

export const TranslationState = Schema.Literals([
  'no-preset',
  'waiting',
  'translating',
  'translated',
  'failed',
  'stopped',
])

export type TranslationState = typeof TranslationState.Type

export const ChapterView = Schema.Struct({
  novelId: Schema.String,
  novelTitle: Schema.String,
  chapters: Schema.Int,
  number: Schema.Int,
  title: Schema.String,
  titleTranslated: Schema.NullOr(Schema.String),
  hasText: Schema.Boolean,
  paragraphs: Schema.Array(ReaderParagraph),
  note: Schema.NullOr(Schema.String),
  terms: Schema.Array(GlossaryTerm),
  state: TranslationState,
  message: Schema.NullOr(Schema.String),
  readyAhead: Schema.Int,
  costUsd: Schema.NullOr(Schema.Number),
  previous: Schema.NullOr(Schema.Int),
  next: Schema.NullOr(Schema.Int),
})

export type ChapterView = typeof ChapterView.Type

export const PastedChapter = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  paragraphs: Schema.Int,
  characters: Schema.Int,
  scrambled: Schema.Boolean,
})

export type PastedChapter = typeof PastedChapter.Type

export const SearchResult = Schema.Struct({
  site: Schema.String,
  siteName: Schema.String,
  url: Schema.String,
  title: Schema.String,
  author: Schema.NullOr(Schema.String),
  coverUrl: Schema.NullOr(Schema.String),
  latestChapter: Schema.NullOr(Schema.String),
  novelId: Schema.NullOr(Schema.String),
  official: Schema.Boolean,
})

export type SearchResult = typeof SearchResult.Type

export const SiteResults = Schema.TaggedStruct('Results', {
  site: Schema.String,
  results: Schema.Array(SearchResult),
})

export const SiteFailed = Schema.TaggedStruct('SiteFailed', {
  site: Schema.String,
  message: Schema.String,
})

export const SearchUpdate = Schema.Union([SiteResults, SiteFailed])

export type SearchUpdate = typeof SearchUpdate.Type

export const SiteSelectors = Schema.Struct({
  /** With `{id}` for the book. */
  book: Schema.String,
  /** With `{id}` for the book. */
  chapterList: Schema.NullOr(Schema.String),
  chapterLink: Schema.String,
  chapterText: Schema.String,
  drop: Schema.Array(Schema.String),
  locked: Schema.optionalKey(Schema.String),
  /** `url` takes `{query}`. */
  search: Schema.NullOr(Schema.Struct({ url: Schema.String, item: Schema.String })),
})

export type SiteSelectors = typeof SiteSelectors.Type

export const SiteRole = Schema.Literals(['official', 'host'])

export type SiteRole = typeof SiteRole.Type

export const SiteEntry = Schema.Struct({
  id: Schema.String,
  role: Schema.optionalKey(SiteRole),
  name: Schema.String,
  hosts: Schema.Array(Schema.String),
  language: NovelLanguage,
  selectors: SiteSelectors,
  builtIn: Schema.Boolean,
})

export type SiteEntry = typeof SiteEntry.Type

export const SitePreview = Schema.Struct({
  entry: SiteEntry,
  title: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  chapters: Schema.Int,
  firstChapters: Schema.Array(Schema.String),
  lastChapters: Schema.Array(Schema.String),
  sample: Schema.Array(Schema.String),
})

export type SitePreview = typeof SitePreview.Type

export const Explanation = Schema.Struct({
  text: Schema.String,
  reading: Schema.NullOr(Schema.String),
  translation: Schema.NullOr(Schema.String),
  kind: Schema.NullOr(TermKind),
  chapters: Schema.Array(Schema.Int),
  costUsd: Schema.NullOr(Schema.Number),
})

export type Explanation = typeof Explanation.Type

export const ScanStage = Schema.Literals(['reading', 'finding', 'checking', 'done', 'failed'])

export type ScanStage = typeof ScanStage.Type

export const ScanProgress = Schema.Struct({
  stage: ScanStage,
  done: Schema.Int,
  total: Schema.Int,
  found: Schema.Int,
  costUsd: Schema.Number,
  message: Schema.NullOr(Schema.String),
})

export type ScanProgress = typeof ScanProgress.Type

export const builtInFlags: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 'betrayal', label: 'Partner betrayal' },
  { id: 'ntr', label: 'NTR' },
  { id: 'harem', label: 'Harem' },
  { id: 'sexual-violence', label: 'Sexual violence' },
  { id: 'love-death', label: 'Love interest dies' },
  { id: 'character-death', label: 'Character death' },
  { id: 'gore', label: 'Torture or gore' },
  { id: 'slavery', label: 'Slavery' },
  { id: 'incest', label: 'Incest' },
  { id: 'child-abuse', label: 'Child abuse' },
  { id: 'misogyny', label: 'Misogynistic protagonist' },
  { id: 'tragic-ending', label: 'Tragic ending' },
]

export const FlagFinding = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  chapters: Schema.Array(Schema.Int),
  note: Schema.NullOr(Schema.String),
})

export type FlagFinding = typeof FlagFinding.Type

export const NovelCharacter = Schema.Struct({
  original: Schema.String,
  translation: Schema.String,
  gender: Schema.NullOr(TermGender),
  note: Schema.NullOr(Schema.String),
  firstChapter: Schema.NullOr(Schema.Int),
  mentions: Schema.Int,
})

export type NovelCharacter = typeof NovelCharacter.Type

export const NovelAnswer = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['question', 'recap']),
  question: Schema.String,
  text: Schema.String,
  chapters: Schema.Array(Schema.Int),
  coverage: Schema.String,
  spoilers: Schema.Boolean,
  modelName: Schema.String,
  costUsd: Schema.NullOr(Schema.Number),
  askedAt: Schema.String,
})

export type NovelAnswer = typeof NovelAnswer.Type

export const NovelInsight = Schema.Struct({
  chapters: Schema.Int,
  digested: Schema.Int,
  knownUpTo: Schema.Int,
  readable: Schema.Int,
  readingChapter: Schema.NullOr(Schema.Int),
  ongoing: Schema.Boolean,
  flags: Schema.Array(FlagFinding),
  characters: Schema.Array(NovelCharacter),
  answers: Schema.Array(NovelAnswer),
  digestCostUsd: Schema.Number,
})

export type NovelInsight = typeof NovelInsight.Type

export const DigestStage = Schema.Literals(['reading', 'digesting', 'done', 'failed'])

export type DigestStage = typeof DigestStage.Type

export const DigestProgress = Schema.Struct({
  stage: DigestStage,
  done: Schema.Int,
  total: Schema.Int,
  costUsd: Schema.Number,
  message: Schema.NullOr(Schema.String),
})

export type DigestProgress = typeof DigestProgress.Type

export const AskStep = Schema.TaggedStruct('AskStep', { label: Schema.String })

export const AskAnswer = Schema.TaggedStruct('AskAnswer', { answer: NovelAnswer })

export const NovelAskEvent = Schema.Union([AskStep, AskAnswer])

export type NovelAskEvent = typeof NovelAskEvent.Type

export class NovelsError extends Schema.TaggedError<NovelsError>()('NovelsError', {
  reason: Schema.Literals(['not-found', 'invalid', 'site', 'no-preset', 'llm']),
  message: Schema.String,
}) {}

const ByNovel = { novelId: Schema.String }

const ByChapter = { novelId: Schema.String, number: Schema.Int }

const TermFields = {
  original: Schema.String,
  translation: Schema.String,
  kind: TermKind,
  gender: Schema.NullOr(TermGender),
  note: Schema.NullOr(Schema.String),
  reading: Schema.optionalKey(Schema.NullOr(Schema.String)),
}

const ByGlossary = { glossaryId: Schema.String }

export const CreateGlossary = Schema.TaggedStruct('CreateGlossary', { name: Schema.String })

export const RenameGlossary = Schema.TaggedStruct('RenameGlossary', {
  ...ByGlossary,
  name: Schema.String,
})

export const RemoveGlossary = Schema.TaggedStruct('RemoveGlossary', ByGlossary)

export const AddTerm = Schema.TaggedStruct('AddTerm', { ...ByGlossary, ...TermFields })

export const UpdateTerm = Schema.TaggedStruct('UpdateTerm', {
  ...ByGlossary,
  termId: Schema.String,
  ...TermFields,
})

export const RemoveTerm = Schema.TaggedStruct('RemoveTerm', {
  ...ByGlossary,
  termId: Schema.String,
})

export const PickGlossaries = Schema.TaggedStruct('PickGlossaries', {
  ...ByNovel,
  glossaryIds: Schema.Array(Schema.String),
})

export const AddNovelTerm = Schema.TaggedStruct('AddNovelTerm', { ...ByNovel, ...TermFields })

export const UpdateNovelTerm = Schema.TaggedStruct('UpdateNovelTerm', {
  ...ByNovel,
  termId: Schema.String,
  ...TermFields,
})

export const AcceptTerms = Schema.TaggedStruct('AcceptTerms', {
  ...ByNovel,
  termIds: Schema.Array(Schema.String),
})

export const DismissTerm = Schema.TaggedStruct('DismissTerm', { ...ByNovel, termId: Schema.String })

export const GlossaryEdit = Schema.Union([
  CreateGlossary,
  RenameGlossary,
  RemoveGlossary,
  AddTerm,
  UpdateTerm,
  RemoveTerm,
  PickGlossaries,
  AddNovelTerm,
  UpdateNovelTerm,
  AcceptTerms,
  DismissTerm,
])

export type GlossaryEdit = typeof GlossaryEdit.Type

export const SaveSite = Schema.TaggedStruct('SaveSite', { entry: SiteEntry })

export const RemoveSite = Schema.TaggedStruct('RemoveSite', { id: Schema.String })

export const SiteEdit = Schema.Union([SaveSite, RemoveSite])

export type SiteEdit = typeof SiteEdit.Type

export class NovelsRpc extends RpcGroup.make(
  Rpc.make('novelShelf', { success: NovelShelf }),
  Rpc.make('novelDetails', { payload: ByNovel, success: NovelDetails, error: NovelsError }),
  Rpc.make('novelChapters', { payload: ListChapters, success: ChapterPage, error: NovelsError }),
  Rpc.make('createNovel', {
    payload: { title: Schema.String, language: NovelLanguage },
    success: Schema.String,
    error: NovelsError,
  }),
  Rpc.make('addNovelFromUrl', {
    payload: { url: Schema.String },
    success: Schema.String,
    error: NovelsError,
  }),
  Rpc.make('removeNovel', { payload: ByNovel, error: NovelsError }),
  Rpc.make('previewPaste', {
    payload: { text: Schema.String },
    success: Schema.Array(PastedChapter),
  }),
  Rpc.make('pasteChapters', {
    payload: {
      ...ByNovel,
      text: Schema.String,
      startAt: Schema.NullOr(Schema.Int),
    },
    success: Schema.Array(Schema.Int),
    error: NovelsError,
  }),
  Rpc.make('refreshNovel', { payload: ByNovel, error: NovelsError }),
  Rpc.make('openChapter', { payload: ByChapter, success: ChapterView, error: NovelsError }),
  Rpc.make('watchChapter', {
    payload: ByChapter,
    success: ChapterView,
    error: NovelsError,
    stream: true,
  }),
  Rpc.make('retranslateChapter', { payload: ByChapter, error: NovelsError }),
  Rpc.make('saveNovelReading', {
    payload: { ...ByChapter, paragraph: Schema.Int },
    error: NovelsError,
  }),
  Rpc.make('searchNovels', {
    payload: { query: Schema.String },
    success: SearchUpdate,
    stream: true,
  }),
  Rpc.make('novelTerms', {
    payload: ByNovel,
    success: Schema.Array(GlossaryTerm),
    error: NovelsError,
  }),
  Rpc.make('glossaryShelf', { success: GlossaryShelf }),
  Rpc.make('glossaryPage', {
    payload: { ref: GlossaryRef },
    success: GlossaryPage,
    error: NovelsError,
  }),
  Rpc.make('editGlossary', {
    payload: { edit: GlossaryEdit },
    success: Schema.NullOr(Schema.String),
    error: NovelsError,
  }),
  Rpc.make('findTerms', { payload: { query: Schema.String }, success: Schema.Array(TermHit) }),
  Rpc.make('exportGlossary', {
    payload: { ref: GlossaryRef },
    success: Schema.String,
    error: NovelsError,
  }),
  Rpc.make('scanTerms', {
    payload: { ...ByNovel, chapters: Schema.Int },
    success: ScanProgress,
    error: NovelsError,
    stream: true,
  }),
  Rpc.make('novelInsight', { payload: ByNovel, success: NovelInsight, error: NovelsError }),
  Rpc.make('digestNovel', {
    payload: { ...ByNovel, upTo: Schema.Int },
    success: DigestProgress,
    error: NovelsError,
    stream: true,
  }),
  Rpc.make('askNovel', {
    payload: {
      ...ByNovel,
      question: Schema.String,
      spoilers: Schema.Boolean,
      kind: Schema.Literals(['question', 'recap']),
    },
    success: NovelAskEvent,
    error: NovelsError,
    stream: true,
  }),
  Rpc.make('explainText', {
    payload: { ...ByChapter, text: Schema.String },
    success: Explanation,
    error: NovelsError,
  }),
  Rpc.make('novelSettings', { success: NovelSettings }),
  Rpc.make('saveNovelSettings', { payload: NovelSettings }),
  Rpc.make('novelSites', { success: Schema.Array(SiteEntry) }),
  Rpc.make('detectSite', {
    payload: { url: Schema.String },
    success: SitePreview,
    error: NovelsError,
  }),
  Rpc.make('editSite', { payload: { edit: SiteEdit }, error: NovelsError }),
) {}
