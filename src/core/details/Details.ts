import {
  Config,
  DateTime,
  Duration,
  Effect,
  FiberHandle,
  FileSystem,
  Option,
  Path,
  Ref,
  Result,
  Schema,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  defaultDetailsSettings,
  DetailsError,
  DetailsRpc,
  DetailsSettings,
  type DLsiteList,
  type EditableField,
  type FindingProgress,
  GameType,
  type GameDetails,
  type Genre,
  type LinkedBy,
  type ListedWork,
  type RankingPeriod,
  type ReviewItem,
} from '#contract/Details'
import type { Game } from '#contract/Library'
import { defaultTranslationSettings, TranslationSettings } from '#contract/GameTranslation'
import { Games } from '../library/Games'
import { LlmClient } from '../llm/LlmClient'
import * as SettingsStore from '../platform/SettingsStore'
import { DetailsStore, type StoredWork } from './DetailsStore'
import { DLsite, type ListedHit, mergeRankings } from './DLsite'
import { hintsFor, matchGame, Outcome, searchCandidates } from './GameMatcher'
import { applyListFilters } from './ListFilters'
import { codeInInput } from './NameHints'

const settingsKey = 'details'

const listLifetime = Duration.hours(1)

const unreachableLimit = 3

const idle: FindingProgress = {
  running: false,
  paused: false,
  total: 0,
  waiting: 0,
  linked: 0,
  needsReview: 0,
  noMatch: 0,
  failed: 0,
  linkedByCode: 0,
  linkedBySearch: 0,
}

const notLinked = new DetailsError({
  reason: 'not-found',
  message: 'This game has no details from DLsite.',
})

const TranslatedDetails = Schema.fromJsonString(
  Schema.Struct({ title: Schema.String, description: Schema.String }),
)

const decodeTranslated = Schema.decodeUnknownOption(TranslatedDetails)

const unfenced = (text: string) =>
  text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')

const listKey = (
  list: DLsiteList,
  period: RankingPeriod,
  tagIds: ReadonlyArray<number>,
  types: ReadonlyArray<string>,
) => {
  if (list === 'top') {
    return `top-${period}-${tagIds.length === 0 ? 'all' : 'deep'}-${types.join(',')}`
  }

  if (list === 'upcoming') {
    return 'upcoming'
  }

  return `new-${tagIds.join(',')}-${types.join(',')}`
}

export const DetailsRpcLive = DetailsRpc.toLayer(
  Effect.gen(function* () {
    const store = yield* DetailsStore
    const site = yield* DLsite
    const games = yield* Games
    const llm = yield* LlmClient
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dataDir = yield* Config.String('WENBU_DATA_DIR')
    const keyValues = yield* KeyValueStore.KeyValueStore
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path | DLsite>()
    const settingsStore = SettingsStore.make(keyValues, DetailsSettings, defaultDetailsSettings)

    const translationStore = SettingsStore.make(
      keyValues,
      TranslationSettings,
      defaultTranslationSettings,
    )

    const progress = yield* SubscriptionRef.make(idle)
    const run = yield* FiberHandle.make()
    const genreCache = yield* Ref.make(Option.none<ReadonlyArray<Genre>>())

    const settings = Effect.orDie(settingsStore.get(settingsKey))

    const saveCover = Effect.fnUntraced(function* (code: string, url: string) {
      const folder = path.join(dataDir, 'details', 'dlsite', code)
      const file = path.join(folder, 'cover.jpg')
      const bytes = yield* site.image(url)

      yield* Effect.orDie(fs.makeDirectory(folder, { recursive: true }))
      yield* Effect.orDie(fs.writeFile(file, bytes))

      return file
    })

    const fetchWork = Effect.fn('Details.fetchWork')(function* (code: string) {
      const work = yield* site.work(code)

      if (Option.isNone(work)) {
        return Option.none<StoredWork>()
      }

      const sales = yield* site.sales(code)

      const cover = yield* Option.match(work.value.coverUrl, {
        onNone: () => Effect.succeedNone,
        onSome: (url) =>
          saveCover(code, url).pipe(
            Effect.map(Option.some),
            Effect.catchTag('DetailsError', (error) =>
              Effect.logWarning('The cover could not be saved', error).pipe(
                Effect.as(Option.none()),
              ),
            ),
          ),
      })

      yield* store.saveWork(work.value, sales, { cover, samples: [] })

      return yield* store.work(code)
    })

    const detailsOf = Effect.fnUntraced(function* (gameId: string) {
      const link = yield* store.link(gameId)

      if (Option.isNone(link)) {
        return Option.none<GameDetails>()
      }

      const stored = yield* store.work(link.value.code)

      if (Option.isNone(stored)) {
        return Option.none<GameDetails>()
      }

      const edits = yield* store.edits(gameId)
      const { work } = stored.value
      const edited = (field: EditableField, value: string) => edits.get(field) ?? value

      return Option.some<GameDetails>({
        gameId,
        link: {
          code: link.value.code,
          linkedBy: link.value.linkedBy,
          confidence: link.value.confidence,
          linkedAt: link.value.linkedAt,
        },
        title: edited('title', work.title),
        circle: edited('circle', work.circle),
        creators: work.creators,
        genres: work.genres,
        releasedOn: edited('releasedOn', work.releasedOn),
        workType: work.workType,
        description: edited('description', work.description),
        translatedTitle: edits.has('title') ? null : Option.getOrNull(stored.value.translatedTitle),
        translatedDescription: edits.has('description')
          ? null
          : Option.getOrNull(stored.value.translatedDescription),
        ageRating: work.ageRating,
        rating: Option.getOrNull(stored.value.rating),
        ratingCount: Option.getOrNull(stored.value.ratingCount),
        url: work.url,
        cover: Option.getOrNull(stored.value.coverFile),
        samples: work.sampleUrls,
        locked: [...edits.keys()],
        fetchedAt: stored.value.fetchedAt,
        restricted: work.restricted,
      })
    })

    const requireDetails = Effect.fnUntraced(function* (gameId: string) {
      const details = yield* detailsOf(gameId)

      if (Option.isNone(details)) {
        return yield* notLinked
      }

      return details.value
    })

    const linkCode = Effect.fnUntraced(function* (
      gameId: string,
      code: string,
      linkedBy: LinkedBy,
      confidence: number,
    ) {
      const kept = yield* store.work(code)
      const stored = Option.isSome(kept) ? kept : yield* fetchWork(code)

      if (Option.isNone(stored)) {
        return yield* new DetailsError({
          reason: 'not-found',
          message: `DLsite has no work ${code}. It may not be released yet, or it was removed.`,
        })
      }

      yield* store.setLink(gameId, code, linkedBy, confidence)

      return yield* requireDetails(gameId)
    })

    const findOne = Effect.fnUntraced(function* (game: Game, autoLink: boolean) {
      const knows = (code: string) => Effect.map(fetchWork(code), Option.isSome)
      const outcome = yield* matchGame(game, knows, autoLink).pipe(Effect.provideContext(services))

      yield* Outcome.$match(outcome, {
        Code: ({ code }) => store.setLink(game.id, code, 'code', 100),
        Confident: ({ candidate, candidates }) =>
          fetchWork(candidate.code).pipe(
            Effect.flatMap((stored) =>
              Option.isSome(stored)
                ? store.setLink(game.id, candidate.code, 'search', candidate.score)
                : store.setFind(game.id, 'needs-review', candidates, Option.none()),
            ),
          ),
        Review: ({ candidates }) =>
          store.setFind(game.id, 'needs-review', candidates, Option.none()),
        NoMatch: () => store.setFind(game.id, 'no-match', [], Option.none()),
      })
    })

    const tally = Effect.fnUntraced(function* (running: boolean, waiting: number) {
      const all = yield* games.list
      const links = yield* store.links
      const finds = yield* store.finds
      const count = (state: string) => finds.filter((find) => find.state === state).length
      const previous = yield* SubscriptionRef.get(progress)

      yield* SubscriptionRef.set(progress, {
        running,
        paused: running ? false : previous.paused,
        total: all.length,
        waiting,
        linked: links.length,
        needsReview: count('needs-review'),
        noMatch: count('no-match'),
        failed: count('failed'),
        linkedByCode: links.filter((link) => link.linkedBy === 'code').length,
        linkedBySearch: links.filter((link) => link.linkedBy !== 'code').length,
      })
    })

    const targets = Effect.gen(function* () {
      const linked = new Set((yield* store.links).map((link) => link.gameId))

      const settled = new Set(
        (yield* store.finds)
          .filter((find) => find.state === 'no-details' || find.state === 'needs-review')
          .map((find) => find.gameId),
      )

      return (yield* games.list).filter((game) => !linked.has(game.id) && !settled.has(game.id))
    })

    const refetchRestricted = Effect.gen(function* () {
      const codes = new Set((yield* store.links).map((link) => link.code))

      for (const code of codes) {
        const stored = yield* store.work(code)

        if (Option.exists(stored, (found) => found.work.restricted)) {
          yield* fetchWork(code).pipe(Effect.catchTag('DetailsError', () => Effect.void))
        }
      }
    })

    const runAll = Effect.gen(function* () {
      const autoLink = (yield* settings).autoLink
      const queue = yield* targets
      let unreachable = 0

      yield* refetchRestricted

      yield* tally(true, queue.length)

      for (const [index, game] of queue.entries()) {
        const failure = yield* findOne(game, autoLink).pipe(
          Effect.as(Option.none<DetailsError>()),
          Effect.catchTag('DetailsError', (error) => Effect.succeed(Option.some(error))),
        )

        if (Option.isSome(failure)) {
          yield* store.setFind(game.id, 'failed', [], Option.some(failure.value.message))
        }

        unreachable = Option.exists(failure, (error) => error.reason === 'unreachable')
          ? unreachable + 1
          : 0

        if (unreachable >= unreachableLimit) {
          yield* Effect.logWarning('DLsite stopped answering; finding details paused')
          yield* SubscriptionRef.update(progress, (current) => ({ ...current, paused: true }))

          return yield* tally(false, queue.length - index - 1)
        }

        yield* tally(true, queue.length - index - 1)
      }

      yield* tally(false, 0)
    }).pipe(
      Effect.onError((cause) =>
        Effect.logError('Finding details stopped', cause).pipe(Effect.andThen(tally(false, 0))),
      ),
      Effect.withSpan('Details.findAll'),
      Effect.annotateLogs({ feature: 'details' }),
    )

    const linksByCode = Effect.map(
      store.links,
      (links) => new Map(links.map((link) => [link.code, link.gameId])),
    )

    const toListed = (
      hit: ListedHit,
      gameIds: ReadonlyMap<string, string>,
      watched: ReadonlySet<string>,
    ): ListedWork => ({
      code: hit.code,
      title: hit.title,
      circle: hit.circle,
      circleId: hit.circleId,
      coverUrl: Option.getOrNull(hit.coverUrl),
      workType: hit.workType,
      genres: hit.genres,
      price: Option.getOrNull(hit.price),
      releasedOn: Option.getOrNull(hit.releasedOn),
      expected: Option.getOrNull(hit.expected),
      rank: Option.getOrNull(hit.rank),
      gameId: gameIds.get(hit.code) ?? null,
      watched: watched.has(hit.code),
    })

    const allTags = Effect.gen(function* () {
      const cached = yield* Ref.get(genreCache)

      if (Option.isSome(cached)) {
        return cached.value
      }

      const genres = yield* site.genres

      yield* Ref.set(genreCache, Option.some(genres))

      return genres
    })

    const inEnglish = Effect.fnUntraced(function* (tags: ReadonlyArray<Genre>) {
      const names = yield* allTags.pipe(
        Effect.map((all) => new Map(all.map((tag) => [tag.id, tag.name]))),
        Effect.catchTag('DetailsError', () => Effect.succeed(new Map<number, string>())),
      )

      return tags.map((tag) => ({ id: tag.id, name: names.get(tag.id) ?? tag.name }))
    })

    const listFilters = Effect.all({ tags: store.filterTags, gameTypes: store.filterGameTypes })

    const deepRanking = Effect.fnUntraced(function* (
      period: RankingPeriod,
      types: ReadonlyArray<GameType>,
    ) {
      if (types.length === 1) {
        return yield* site.ranking(period, types)
      }

      const [combined, perType] = yield* Effect.all(
        [
          site.ranking(period, types),
          Effect.forEach(
            types.length === 0 ? GameType.literals : types,
            (type) => site.ranking(period, [type]),
            { concurrency: 'unbounded' },
          ),
        ],
        { concurrency: 'unbounded' },
      )

      return mergeRankings(combined, perType)
    })

    const fetchList = (
      list: DLsiteList,
      period: RankingPeriod,
      tagIds: ReadonlyArray<number>,
      types: ReadonlyArray<GameType>,
    ) => {
      if (list === 'top') {
        return tagIds.length === 0 ? site.ranking(period, types) : deepRanking(period, types)
      }

      if (list === 'new') {
        return site.newest(tagIds, types)
      }

      return Effect.flatMap(DateTime.now, (now) =>
        site.upcoming(DateTime.formatIso(now).slice(0, 7)),
      )
    }

    const checkReleases = Effect.fnUntraced(function* (upcoming: ReadonlyArray<ListedHit>) {
      const announced = new Set(upcoming.map((hit) => hit.code))

      const pending = (yield* store.watched).filter(
        (work) => Option.isNone(work.releasedOn) && !announced.has(work.code),
      )

      for (const work of pending) {
        const released = yield* site.work(work.code)

        if (Option.isSome(released)) {
          yield* store.markReleased(work.code, released.value.releasedOn)
        }
      }
    })

    const cachedList = Effect.fnUntraced(function* (list: DLsiteList, period: RankingPeriod) {
      const filters = yield* listFilters
      const tagIds = filters.tags.map((tag) => tag.id).toSorted((a, b) => a - b)
      const key = listKey(list, period, tagIds, filters.gameTypes)
      const cached = yield* store.list(key)
      const now = yield* DateTime.now

      const fresh = Option.exists(cached, (found) =>
        Option.exists(DateTime.make(found.fetchedAt), (at) =>
          DateTime.isLessThan(now, DateTime.addDuration(at, listLifetime)),
        ),
      )

      if (fresh && Option.isSome(cached)) {
        return {
          hits: cached.value.hits,
          fetchedAt: cached.value.fetchedAt,
          problem: null,
          filters,
        }
      }

      const fetched = yield* fetchList(list, period, tagIds, filters.gameTypes).pipe(Effect.result)

      if (Result.isFailure(fetched)) {
        if (Option.isNone(cached)) {
          return yield* fetched.failure
        }

        return {
          hits: cached.value.hits,
          fetchedAt: cached.value.fetchedAt,
          problem: fetched.failure.message,
          filters,
        }
      }

      yield* store.saveList(key, fetched.success)

      if (list === 'upcoming') {
        yield* checkReleases(fetched.success).pipe(
          Effect.catchTag('DetailsError', () => Effect.void),
        )
      }

      return {
        hits: fetched.success,
        fetchedAt: DateTime.formatIso(now),
        problem: null,
        filters,
      }
    })

    return DetailsRpc.of({
      gameDetails: ({ gameId }) => Effect.map(detailsOf(gameId), Option.getOrNull),
      gameSummaries: () =>
        Effect.gen(function* () {
          const links = yield* store.links

          const summaries = yield* Effect.forEach(links, (link) => detailsOf(link.gameId))

          return summaries.flatMap((found) =>
            Option.toArray(
              Option.map(found, (details) => ({
                gameId: details.gameId,
                title: details.title,
                circle: details.circle,
                cover: details.cover,
                genres: details.genres.map((genre) => genre.name),
              })),
            ),
          )
        }),
      findMatches: Effect.fn('Details.findMatches')(function* ({ gameId, query }) {
        const game = yield* games
          .get(gameId)
          .pipe(
            Effect.mapError(
              (error) => new DetailsError({ reason: 'not-found', message: error.message }),
            ),
          )

        const hints = hintsFor(game, Option.none())

        const queries =
          query === undefined || query.trim() === '' ? hints.titles.slice(0, 2) : [query.trim()]

        return yield* searchCandidates(hints, queries).pipe(Effect.provideContext(services))
      }),
      linkWork: Effect.fn('Details.linkWork')(function* ({ gameId, input }) {
        const code = codeInInput(input)

        if (Option.isNone(code)) {
          return yield* new DetailsError({
            reason: 'invalid',
            message: 'Enter a DLsite code such as RJ01009019, or a link to its DLsite page.',
          })
        }

        return yield* linkCode(gameId, code.value, 'user', 100)
      }),
      unlinkWork: ({ gameId }) => store.removeLink(gameId),
      markNoDetails: Effect.fn('Details.markNoDetails')(function* ({ gameId }) {
        yield* store.removeLink(gameId)
        yield* store.setFind(gameId, 'no-details', [], Option.none())
      }),
      refreshDetails: Effect.fn('Details.refreshDetails')(function* ({ gameId }) {
        const link = yield* store.link(gameId)

        if (Option.isNone(link)) {
          return yield* notLinked
        }

        yield* fetchWork(link.value.code)

        return yield* requireDetails(gameId)
      }),
      editDetails: Effect.fn('Details.editDetails')(function* ({ gameId, edits }) {
        yield* requireDetails(gameId)

        for (const { field, value } of edits) {
          yield* store.setEdit(gameId, field, Option.some(value.trim()))
        }

        return yield* requireDetails(gameId)
      }),
      unlockDetails: Effect.fn('Details.unlockDetails')(function* ({ gameId, field }) {
        yield* store.setEdit(gameId, field, Option.none())

        return yield* requireDetails(gameId)
      }),
      startFinding: Effect.fn('Details.startFinding')(function* () {
        // Running from the call on, so a watcher never mistakes the last run's end for this one's.
        yield* SubscriptionRef.update(progress, (current) => ({
          ...current,
          running: true,
          paused: false,
        }))

        yield* FiberHandle.run(run, runAll, { onlyIfMissing: true })
      }),
      pauseFinding: Effect.fn('Details.pauseFinding')(function* () {
        yield* FiberHandle.clear(run)
        yield* SubscriptionRef.update(progress, (current) => ({ ...current, paused: true }))
        yield* tally(false, 0)
      }),
      watchFinding: () => SubscriptionRef.changes(progress),
      reviewList: () =>
        Effect.gen(function* () {
          yield* tally(
            (yield* SubscriptionRef.get(progress)).running,
            (yield* SubscriptionRef.get(progress)).waiting,
          )

          const finds = (yield* store.finds).filter((find) => find.state !== 'no-details')
          const byId = new Map((yield* games.list).map((game) => [game.id, game]))

          return finds.flatMap((find): Array<ReviewItem> => {
            const game = byId.get(find.gameId)

            return game === undefined
              ? []
              : [
                  {
                    gameId: game.id,
                    title: game.title,
                    folderPath: game.folderPath,
                    engine: game.engine,
                    state: find.state,
                    error: Option.getOrNull(find.error),
                    candidates: find.candidates,
                  },
                ]
          })
        }),
      dlsiteList: Effect.fn('Details.dlsiteList')(function* ({ list, period }) {
        const listed = yield* cachedList(list, period)
        const gameIds = yield* linksByCode
        const watched = new Set((yield* store.watched).map((work) => work.code))

        const shown = applyListFilters(listed.hits, listed.filters)

        const merged = list === 'top' && listed.filters.tags.length > 0

        return {
          works: shown.map((hit, at) => ({
            ...toListed(hit, gameIds, watched),
            ...(merged ? { rank: at + 1 } : {}),
          })),
          fetchedAt: listed.fetchedAt,
          problem: listed.problem,
        }
      }),
      dlsiteWork: Effect.fn('Details.dlsiteWork')(function* ({ code }) {
        const gameIds = yield* linksByCode
        const watched = new Set((yield* store.watched).map((work) => work.code))
        const found = yield* site.work(code)

        const known = {
          gameId: gameIds.get(code) ?? null,
          watched: watched.has(code),
          url: `https://www.dlsite.com/maniax/work/=/product_id/${code}.html`,
        }

        if (Option.isSome(found)) {
          const work = found.value
          const sales = yield* site.sales(code)

          return {
            ...known,
            code,
            title: work.title,
            circle: work.circle,
            circleId: work.circleId,
            description: work.description,
            genres: work.genres,
            releasedOn: work.releasedOn === '' ? null : work.releasedOn,
            workType: work.workType,
            coverUrl: Option.getOrNull(work.coverUrl),
            samples: work.sampleUrls,
            price: Option.getOrNull(work.price),
            officialPrice: Option.getOrNull(work.officialPrice),
            discountRate: Option.getOrNull(work.discountRate),
            saleEndsOn: Option.getOrNull(work.saleEndsOn),
            rating: Option.getOrNull(sales.rating),
            ratingCount: Option.getOrNull(sales.ratingCount),
            sold: Option.getOrNull(sales.sold),
            wishlist: Option.getOrNull(sales.wishlist),
            fileSize: Option.getOrNull(work.fileSize),
            languages: work.languages,
            roles: work.roles,
            restricted: work.restricted,
            announced: false,
            expected: null,
          }
        }

        const upcoming = yield* store.list('upcoming')

        const announced = Option.flatMap(upcoming, (list) =>
          Option.fromNullishOr(list.hits.find((hit) => hit.code === code)),
        )

        if (Option.isNone(announced)) {
          return yield* new DetailsError({
            reason: 'not-found',
            message: `DLsite has no work ${code}.`,
          })
        }

        const hit = announced.value
        const sales = yield* site.sales(code)

        return {
          ...known,
          url: `https://www.dlsite.com/maniax/announce/=/product_id/${code}.html`,
          code,
          title: hit.title,
          circle: hit.circle,
          circleId: hit.circleId,
          description: '',
          genres: yield* inEnglish(hit.genres),
          releasedOn: null,
          workType: hit.workType,
          coverUrl: Option.getOrNull(hit.coverUrl),
          samples: [],
          price: null,
          officialPrice: null,
          discountRate: null,
          saleEndsOn: null,
          rating: null,
          ratingCount: null,
          sold: null,
          wishlist: Option.getOrNull(sales.wishlist),
          fileSize: null,
          languages: [],
          roles: [],
          restricted: false,
          announced: true,
          expected: Option.getOrNull(hit.expected),
        }
      }),
      circleWorks: Effect.fn('Details.circleWorks')(function* ({ circleId }) {
        const hits = yield* site.search(circleId)
        const gameIds = yield* linksByCode
        const watched = new Set((yield* store.watched).map((work) => work.code))

        return hits
          .filter((hit) => hit.circleId === circleId)
          .map((hit) => toListed(hit, gameIds, watched))
      }),
      dlsiteGenres: () => allTags,
      dlsiteFilters: () => listFilters,
      setFilter: ({ target, chosen }) =>
        'tag' in target
          ? store.setFilterTag(target.tag, chosen)
          : store.setFilterGameType(target.gameType, chosen),
      watchWork: Effect.fn('Details.watchWork')(function* ({ code, watched }) {
        const upcoming = yield* store.list('upcoming')

        const title = Option.flatMap(upcoming, (found) =>
          Option.fromNullishOr(found.hits.find((hit) => hit.code === code)?.title),
        )

        yield* store.setWatched(
          code,
          Option.getOrElse(title, () => code),
          watched,
        )
      }),
      detailsSettings: () => settings,
      saveDetailsSettings: Effect.fn('Details.saveDetailsSettings')(function* (next) {
        yield* Effect.orDie(settingsStore.set(settingsKey, next))

        return next
      }),
      translateDetails: Effect.fn('Details.translateDetails')(function* ({ gameId }) {
        const details = yield* requireDetails(gameId)
        const chosen = (yield* settings).translatePresetId
        const translation = yield* Effect.orDie(translationStore.get('game-translation'))
        const presetId = chosen ?? translation.presetId

        if (presetId === '') {
          return yield* new DetailsError({
            reason: 'invalid',
            message: 'Choose an LLM preset for game translation first.',
          })
        }

        const completion = yield* llm
          .complete({
            feature: 'details',
            gameId,
            presetId,
            system:
              'You translate the store page of a Japanese game. Keep names as they are romanised in the title. Answer with JSON only.',
            prompt: [
              `Translate this game's title and description into ${translation.targetLanguage}.`,
              'Answer as {"title": "...", "description": "..."}.',
              '',
              `Title: ${details.title}`,
              `Description: ${details.description}`,
            ].join('\n'),
          })
          .pipe(
            Effect.mapError(
              (error) => new DetailsError({ reason: 'unreachable', message: error.message }),
            ),
          )

        const translated = decodeTranslated(unfenced(completion.text))

        if (Option.isNone(translated)) {
          return yield* new DetailsError({
            reason: 'changed',
            message: 'The model did not answer with a title and description.',
          })
        }

        yield* store.saveTranslation(
          details.link.code,
          translated.value.title,
          translated.value.description,
        )

        return yield* requireDetails(gameId)
      }),
    })
  }),
)
