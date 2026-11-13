import { Data, Effect, FileSystem, Option, Path } from 'effect'
import type { MatchCandidate } from '#contract/Details'
import type { Game } from '#contract/Library'
import { DLsite, type ListedHit } from './DLsite'
import { confidentPick, type FolderHints, scoreCandidate } from './Matching'
import { codesIn, type FoundCode, pathNames, shortcutUrl, titlesFor } from './NameHints'

const childLimit = 40

const nested = Effect.fnUntraced(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const names = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => []))

  const entries = yield* Effect.forEach(names.slice(0, childLimit), (name) =>
    fs.stat(path.join(folder, name)).pipe(
      Effect.map((info) => ({
        name,
        file: path.join(folder, name),
        folder: info.type === 'Directory',
      })),
      Effect.orElseSucceed(() => ({ name, file: path.join(folder, name), folder: false })),
    ),
  )

  return entries
})

const shortcutCodes = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ''))

  return Option.match(shortcutUrl(text), { onNone: () => [], onSome: (url) => codesIn(url) })
})

export const codesForGame = Effect.fnUntraced(function* (game: Game) {
  const children = yield* nested(game.folderPath)

  const grandchildren = yield* Effect.forEach(
    children.filter((child) => child.folder),
    (child) => nested(child.file),
  )

  const near = [...children, ...grandchildren.flat()]

  const shortcuts = yield* Effect.forEach(
    near.filter((entry) => !entry.folder && entry.name.toLowerCase().endsWith('.url')),
    (entry) => shortcutCodes(entry.file),
  )

  const [own, ...above] = pathNames(game.folderPath)

  return [
    ...codesIn(own ?? ''),
    ...near.flatMap((entry) => codesIn(entry.name)),
    ...shortcuts.flat(),
    ...above.flatMap((name) => codesIn(name)),
  ] satisfies ReadonlyArray<FoundCode>
})

export const hintsFor = (game: Game, releasedOn: Option.Option<string>): FolderHints => ({
  titles: titlesFor(game.folderPath),
  pathNames: pathNames(game.folderPath),
  releasedOn,
  rpgMaker: game.engine.startsWith('rpg-maker'),
})

const candidateLimit = 6

const toCandidate = (hints: FolderHints, hit: ListedHit): MatchCandidate => {
  const scored = scoreCandidate(hints, {
    titles: [hit.title],
    circle: hit.circle,
    releasedOn: hit.releasedOn,
    workType: hit.workType,
    genreIds: hit.genres.map((genre) => genre.id),
  })

  return {
    code: hit.code,
    title: hit.title,
    circle: hit.circle,
    releasedOn: Option.getOrNull(hit.releasedOn),
    workType: hit.workType,
    coverUrl: Option.getOrNull(hit.coverUrl),
    score: scored.score,
    reasons: scored.reasons,
  }
}

export const searchCandidates = Effect.fnUntraced(function* (
  hints: FolderHints,
  queries: ReadonlyArray<string>,
) {
  const site = yield* DLsite
  const found = new Map<string, MatchCandidate>()

  for (const query of queries) {
    const hits = yield* site.search(query)

    for (const hit of hits) {
      const candidate = toCandidate(hints, hit)
      const seen = found.get(hit.code)

      if (seen === undefined || seen.score < candidate.score) {
        found.set(hit.code, candidate)
      }
    }
  }

  return [...found.values()].toSorted((a, b) => b.score - a.score).slice(0, candidateLimit)
})

export type Outcome = Data.TaggedEnum<{
  Code: { readonly code: string }
  Confident: {
    readonly candidate: MatchCandidate
    readonly candidates: ReadonlyArray<MatchCandidate>
  }
  Review: { readonly candidates: ReadonlyArray<MatchCandidate> }
  NoMatch: {}
}>

export const Outcome = Data.taggedEnum<Outcome>()

const worthShowing = 40

export const matchGame = Effect.fnUntraced(function* <E, R>(
  game: Game,
  knows: (code: string) => Effect.Effect<boolean, E, R>,
  autoLink: boolean,
) {
  const codes = yield* codesForGame(game)
  const tried = new Set<string>()
  let releasedOn = Option.none<string>()

  for (const found of codes) {
    if (tried.has(found.code)) {
      continue
    }

    tried.add(found.code)
    releasedOn = Option.orElse(releasedOn, () => found.releasedOn)

    if (yield* knows(found.code)) {
      return Outcome.Code({ code: found.code })
    }
  }

  const hints = hintsFor(game, releasedOn)

  const candidates = (yield* searchCandidates(hints, hints.titles.slice(0, 2))).filter(
    (candidate) => candidate.score >= worthShowing,
  )

  if (candidates.length === 0) {
    return Outcome.NoMatch()
  }

  const pick = autoLink ? confidentPick(candidates) : Option.none()

  return Option.match(pick, {
    onNone: () => Outcome.Review({ candidates }),
    onSome: (candidate) => Outcome.Confident({ candidate, candidates }),
  })
})
