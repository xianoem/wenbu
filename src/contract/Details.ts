import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const WorkCode = Schema.String.check(Schema.isPattern(/^(RJ|VJ|BJ)(\d{6}|\d{8})$/))

export type WorkCode = typeof WorkCode.Type

export const AgeRating = Schema.Literals(['all', 'r15', 'adult'])

export type AgeRating = typeof AgeRating.Type

export const Genre = Schema.Struct({ id: Schema.Int, name: Schema.String })

export type Genre = typeof Genre.Type

export const EditableField = Schema.Literals(['title', 'circle', 'description', 'releasedOn'])

export type EditableField = typeof EditableField.Type

export const LinkedBy = Schema.Literals(['code', 'search', 'user'])

export type LinkedBy = typeof LinkedBy.Type

export const WorkLink = Schema.Struct({
  code: WorkCode,
  linkedBy: LinkedBy,
  confidence: Schema.Int,
  linkedAt: Schema.String,
})

export type WorkLink = typeof WorkLink.Type

export const GameDetails = Schema.Struct({
  gameId: Schema.String,
  link: WorkLink,
  title: Schema.String,
  circle: Schema.String,
  creators: Schema.Array(Schema.String),
  genres: Schema.Array(Genre),
  /** `YYYY-MM-DD`. */
  releasedOn: Schema.String,
  workType: Schema.String,
  description: Schema.String,
  translatedTitle: Schema.NullOr(Schema.String),
  translatedDescription: Schema.NullOr(Schema.String),
  ageRating: AgeRating,
  rating: Schema.NullOr(Schema.Number),
  ratingCount: Schema.NullOr(Schema.Int),
  url: Schema.String,
  cover: Schema.NullOr(Schema.String),
  samples: Schema.Array(Schema.String),
  locked: Schema.Array(EditableField),
  restricted: Schema.Boolean,
  fetchedAt: Schema.String,
})

export type GameDetails = typeof GameDetails.Type

export const GameSummary = Schema.Struct({
  gameId: Schema.String,
  title: Schema.String,
  circle: Schema.String,
  cover: Schema.NullOr(Schema.String),
  genres: Schema.Array(Schema.String),
})

export type GameSummary = typeof GameSummary.Type

export const Reason = Schema.Struct({ text: Schema.String, agrees: Schema.Boolean })

export type Reason = typeof Reason.Type

export const MatchCandidate = Schema.Struct({
  code: WorkCode,
  title: Schema.String,
  circle: Schema.String,
  releasedOn: Schema.NullOr(Schema.String),
  workType: Schema.String,
  coverUrl: Schema.NullOr(Schema.String),
  score: Schema.Int,
  reasons: Schema.Array(Reason),
})

export type MatchCandidate = typeof MatchCandidate.Type

export const FindState = Schema.Literals([
  'waiting',
  'linked',
  'needs-review',
  'no-match',
  'no-details',
  'failed',
])

export type FindState = typeof FindState.Type

export const ReviewItem = Schema.Struct({
  gameId: Schema.String,
  title: Schema.String,
  folderPath: Schema.String,
  engine: Schema.String,
  state: FindState,
  error: Schema.NullOr(Schema.String),
  candidates: Schema.Array(MatchCandidate),
})

export type ReviewItem = typeof ReviewItem.Type

export const FindingProgress = Schema.Struct({
  running: Schema.Boolean,
  paused: Schema.Boolean,
  total: Schema.Int,
  waiting: Schema.Int,
  linked: Schema.Int,
  needsReview: Schema.Int,
  noMatch: Schema.Int,
  failed: Schema.Int,
  linkedByCode: Schema.Int,
  linkedBySearch: Schema.Int,
})

export type FindingProgress = typeof FindingProgress.Type

export const RankingPeriod = Schema.Literals(['day', 'week', 'month'])

export type RankingPeriod = typeof RankingPeriod.Type

export const ListedWork = Schema.Struct({
  code: WorkCode,
  title: Schema.String,
  circle: Schema.String,
  circleId: Schema.String,
  coverUrl: Schema.NullOr(Schema.String),
  workType: Schema.String,
  genres: Schema.Array(Genre),
  /** Yen, after any discount. */
  price: Schema.NullOr(Schema.Int),
  releasedOn: Schema.NullOr(Schema.String),
  expected: Schema.NullOr(Schema.String),
  rank: Schema.NullOr(Schema.Int),
  gameId: Schema.NullOr(Schema.String),
  watched: Schema.Boolean,
})

export type ListedWork = typeof ListedWork.Type

export const DLsiteWorkPage = Schema.Struct({
  code: WorkCode,
  title: Schema.String,
  circle: Schema.String,
  circleId: Schema.String,
  description: Schema.String,
  genres: Schema.Array(Genre),
  releasedOn: Schema.NullOr(Schema.String),
  workType: Schema.String,
  coverUrl: Schema.NullOr(Schema.String),
  samples: Schema.Array(Schema.String),
  /** Yen. */
  price: Schema.NullOr(Schema.Number),
  officialPrice: Schema.NullOr(Schema.Number),
  discountRate: Schema.NullOr(Schema.Number),
  saleEndsOn: Schema.NullOr(Schema.String),
  rating: Schema.NullOr(Schema.Number),
  ratingCount: Schema.NullOr(Schema.Number),
  sold: Schema.NullOr(Schema.Number),
  wishlist: Schema.NullOr(Schema.Number),
  fileSize: Schema.NullOr(Schema.Number),
  languages: Schema.Array(Schema.String),
  roles: Schema.Array(Schema.Struct({ role: Schema.String, names: Schema.Array(Schema.String) })),
  url: Schema.String,
  restricted: Schema.Boolean,
  announced: Schema.Boolean,
  expected: Schema.NullOr(Schema.String),
  gameId: Schema.NullOr(Schema.String),
  watched: Schema.Boolean,
})

export type DLsiteWorkPage = typeof DLsiteWorkPage.Type

export const DLsiteList = Schema.Literals(['top', 'new', 'upcoming'])

export type DLsiteList = typeof DLsiteList.Type

export const GameType = Schema.Literals([
  'RPG',
  'ACN',
  'ADV',
  'SLN',
  'STG',
  'PZL',
  'QIZ',
  'TBL',
  'DNV',
  'TYP',
  'ETC',
])

export type GameType = typeof GameType.Type

export const DLsiteFilters = Schema.Struct({
  tags: Schema.Array(Genre),
  gameTypes: Schema.Array(GameType),
})

export type DLsiteFilters = typeof DLsiteFilters.Type

export const FilterTarget = Schema.Union([
  Schema.Struct({ tag: Genre }),
  Schema.Struct({ gameType: GameType }),
])

export type FilterTarget = typeof FilterTarget.Type

export const DLsiteListing = Schema.Struct({
  works: Schema.Array(ListedWork),
  fetchedAt: Schema.NullOr(Schema.String),
  problem: Schema.NullOr(Schema.String),
})

export type DLsiteListing = typeof DLsiteListing.Type

export const DetailsSettings = Schema.Struct({
  autoLink: Schema.Boolean,
  translatePresetId: Schema.NullOr(Schema.String),
  blurAdultCovers: Schema.Boolean,
})

export type DetailsSettings = typeof DetailsSettings.Type

export const defaultDetailsSettings: DetailsSettings = {
  autoLink: true,
  translatePresetId: null,
  blurAdultCovers: false,
}

export class DetailsError extends Schema.TaggedError<DetailsError>()('DetailsError', {
  reason: Schema.Literals(['not-found', 'invalid', 'unreachable', 'changed']),
  message: Schema.String,
}) {}

const ByGame = { gameId: Schema.String }

export class DetailsRpc extends RpcGroup.make(
  Rpc.make('gameDetails', { payload: ByGame, success: Schema.NullOr(GameDetails) }),
  Rpc.make('gameSummaries', { success: Schema.Array(GameSummary) }),
  Rpc.make('findMatches', {
    payload: { ...ByGame, query: Schema.optional(Schema.String) },
    success: Schema.Array(MatchCandidate),
    error: DetailsError,
  }),
  Rpc.make('linkWork', {
    payload: { ...ByGame, input: Schema.String },
    success: GameDetails,
    error: DetailsError,
  }),
  Rpc.make('unlinkWork', { payload: ByGame }),
  Rpc.make('markNoDetails', { payload: ByGame }),
  Rpc.make('refreshDetails', { payload: ByGame, success: GameDetails, error: DetailsError }),
  Rpc.make('editDetails', {
    payload: {
      ...ByGame,
      edits: Schema.Array(Schema.Struct({ field: EditableField, value: Schema.String })),
    },
    success: GameDetails,
    error: DetailsError,
  }),
  Rpc.make('unlockDetails', {
    payload: { ...ByGame, field: EditableField },
    success: GameDetails,
    error: DetailsError,
  }),
  Rpc.make('startFinding', { error: DetailsError }),
  Rpc.make('pauseFinding'),
  Rpc.make('watchFinding', { success: FindingProgress, stream: true }),
  Rpc.make('reviewList', { success: Schema.Array(ReviewItem) }),
  Rpc.make('dlsiteList', {
    payload: { list: DLsiteList, period: RankingPeriod },
    success: DLsiteListing,
    error: DetailsError,
  }),
  Rpc.make('dlsiteGenres', { success: Schema.Array(Genre), error: DetailsError }),
  Rpc.make('dlsiteWork', {
    payload: { code: WorkCode },
    success: DLsiteWorkPage,
    error: DetailsError,
  }),
  Rpc.make('circleWorks', {
    payload: { circleId: Schema.String },
    success: Schema.Array(ListedWork),
    error: DetailsError,
  }),
  Rpc.make('dlsiteFilters', { success: DLsiteFilters }),
  Rpc.make('setFilter', { payload: { target: FilterTarget, chosen: Schema.Boolean } }),
  Rpc.make('watchWork', { payload: { code: WorkCode, watched: Schema.Boolean } }),
  Rpc.make('detailsSettings', { success: DetailsSettings }),
  Rpc.make('saveDetailsSettings', { payload: DetailsSettings, success: DetailsSettings }),
  Rpc.make('translateDetails', { payload: ByGame, success: GameDetails, error: DetailsError }),
) {}
