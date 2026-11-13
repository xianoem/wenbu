import { Effect, Predicate, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import type { GameFact } from '#contract/GameGuide'
import type { GuideBook } from './GuideBook'

const ModelFact = Schema.Struct({
  id: Schema.String,
  what: Schema.String,
  where: Schema.optional(Schema.String),
  needs: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.String,
  text: Schema.optional(Schema.String),
})

const Facts = Schema.Array(ModelFact)

const Lines = Schema.Array(Schema.String)

/** Models on OpenAI-compatible APIs send null for a parameter they leave out. */
const OptionalParameter = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.NullOr(schema))

const IdParameter = Schema.Union([Schema.Number, Schema.NumberFromString])

const ItemKindParameter = Schema.Literals(['item', 'weapon', 'armor'])

const WordsParameter = Schema.Union([Schema.Array(Schema.String), Schema.String])

const failureMode = 'return' as const

const GameOverview = Tool.make('game_overview', {
  failureMode,
  description:
    'The game title, its characters with their profiles, and its maps. Use it for questions about the game as a whole.',
  success: Schema.Struct({ title: Schema.String, characters: Lines, maps: Lines }),
})

const Find = Tool.make('find', {
  failureMode,
  description:
    "Search the game by words in any language. Finds items, weapons, armour and enemies (with where to get them), people, places, dialogue, and the names of states, skills, characters, switches, variables and common events, which often say what a game contains. Search with words in the game's own language too: Japanese or Chinese games name things in Japanese or Chinese.",
  parameters: Schema.Struct({ words: WordsParameter }),
  success: Schema.Struct({
    subjects: Schema.Array(
      Schema.Struct({
        kind: Schema.String,
        id: Schema.Number,
        name: Schema.String,
        description: Schema.String,
        held: Schema.optional(Schema.Number),
        facts: Facts,
      }),
    ),
    people: Facts,
    places: Facts,
    dialogue: Facts,
    states: Lines,
    skills: Lines,
    characters: Lines,
    switches: Lines,
    variables: Lines,
    commonEvents: Lines,
  }),
})

const SearchDialogue = Tool.make('search_dialogue', {
  failureMode,
  description:
    "Lines of the game's dialogue that contain any of the words, in the original language or the translation, in the order the game has them, with who says them and where. Give several words at once, in both languages.",
  parameters: Schema.Struct({ words: WordsParameter }),
  success: Facts,
})

const WhereToGet = Tool.make('where_to_get', {
  failureMode,
  description:
    'Every event that gives or sells an item, weapon or armour, and every enemy that drops it, nearest and available first.',
  parameters: Schema.Struct({ kind: ItemKindParameter, id: IdParameter }),
  success: Facts,
})

const WhatNeeds = Tool.make('what_needs', {
  failureMode,
  description: 'People and events that want an item, weapon or armour, or take it.',
  parameters: Schema.Struct({ kind: ItemKindParameter, id: IdParameter }),
  success: Facts,
})

const SwitchFacts = Tool.make('switch_facts', {
  failureMode,
  description:
    'For a switch id: the events that turn it on, and the people whose behaviour changes once it is on. Use it to explain what unlocks something.',
  parameters: Schema.Struct({ id: IdParameter }),
  success: Schema.Struct({ setBy: Facts, opens: Facts }),
})

const MapContents = Tool.make('map_contents', {
  failureMode,
  description:
    'What the people, chests, shops and exits on a map do now. Leave mapId out for the current map; otherwise give a place id such as "m12" from another tool, or the name of the map.',
  parameters: Schema.Struct({
    mapId: OptionalParameter(Schema.Union([Schema.Number, Schema.String])),
  }),
  success: Facts,
})

const NextSteps = Tool.make('next_steps', {
  failureMode,
  description:
    "Wenbu's ranked guesses at what the player can do next, from the game's switches, variables and items.",
  success: Facts,
})

const RecentDialogue = Tool.make('recent_dialogue', {
  failureMode,
  description: 'The last lines of dialogue the player saw, oldest first.',
  success: Facts,
})

const Enemy = Tool.make('enemy', {
  failureMode,
  description: 'An enemy: HP, weaknesses, resistances, drops and where it is found.',
  parameters: Schema.Struct({ id: IdParameter }),
  success: Facts,
})

export const GuideToolkit = Toolkit.make(
  GameOverview,
  Find,
  SearchDialogue,
  WhereToGet,
  WhatNeeds,
  SwitchFacts,
  MapContents,
  NextSteps,
  RecentDialogue,
  Enemy,
)

export const toolLabels: Record<string, string> = {
  game_overview: 'Reading about the game',
  find: 'Searching the game',
  search_dialogue: 'Searching the dialogue',
  where_to_get: 'Finding where to get it',
  what_needs: 'Checking who needs it',
  switch_facts: 'Following the story switches',
  map_contents: 'Looking around the map',
  next_steps: 'Checking your progress',
  recent_dialogue: 'Reading the recent dialogue',
  enemy: 'Looking up the enemy',
}

const placeText = (fact: GameFact) => {
  const place = fact.place

  if (place === undefined) {
    return undefined
  }

  const at = place.x === undefined ? '' : ` at ${place.x},${place.y}`

  return place.eventName === undefined ? place.mapName : `${place.mapName}, ${place.eventName}${at}`
}

const holdsText = (holds: boolean | undefined) => {
  if (holds === undefined) {
    return ''
  }

  return holds ? ' (yes)' : ' (no)'
}

const toModel = (fact: GameFact): typeof ModelFact.Type => {
  const where = placeText(fact)
  const needs = fact.gate.map((item) => `${item.text}${holdsText(item.holds)}`)

  return {
    id: fact.id,
    what: fact.summary,
    ...(where === undefined ? {} : { where }),
    ...(needs.length === 0 ? {} : { needs }),
    status: fact.status,
    ...(fact.text === undefined ? {} : { text: fact.text.slice(0, 240) }),
  }
}

const TOOL_LIMIT = 10

const DIALOGUE_LIMIT = 20

const wordsOf = (words: ReadonlyArray<string> | string) =>
  (Predicate.isString(words) ? [words] : words)
    .map((word) => word.trim())
    .filter((word) => word !== '')

export const guideHandlers = (book: GuideBook, seen: Set<string>) => {
  const facts = (found: ReadonlyArray<GameFact>, limit = TOOL_LIMIT) =>
    found.slice(0, limit).map((fact) => {
      seen.add(fact.id)

      return toModel(fact)
    })

  const unique = (lists: ReadonlyArray<ReadonlyArray<GameFact>>) => [
    ...new Map(lists.flat().map((fact) => [fact.id, fact])).values(),
  ]

  return GuideToolkit.toLayer({
    game_overview: () =>
      Effect.sync(() => ({
        title: book.index.title,
        characters: book.characters(),
        maps: book.index.maps.slice(0, 60).map((map) => `m${map.id} ${book.mapName(map.id)}`),
      })),
    find: ({ words }) =>
      Effect.sync(() => {
        const queries = wordsOf(words)
        const found = queries.map((query) => book.find(query))
        const named = book.names(queries)

        return {
          subjects: found
            .flatMap((result) => result.subjects)
            .slice(0, 8)
            .map((subject) => ({
              kind: subject.subject.kind,
              id: subject.subject.id,
              name: subject.subject.name,
              description: subject.description,
              ...(subject.held === undefined ? {} : { held: subject.held }),
              facts: facts(subject.facts, 5),
            })),
          people: facts(unique(found.map((result) => result.people))),
          places: facts(unique(found.map((result) => result.places))),
          dialogue: facts(book.dialogue(queries, 8)),
          states: named.states,
          skills: named.skills,
          characters: named.actors,
          switches: named.switches,
          variables: named.variables,
          commonEvents: named.commonEvents,
        }
      }),
    search_dialogue: ({ words }) =>
      Effect.sync(() => facts(book.dialogue(wordsOf(words), DIALOGUE_LIMIT), DIALOGUE_LIMIT)),
    where_to_get: ({ kind, id }) => Effect.sync(() => facts(book.whereToGet(kind, id))),
    what_needs: ({ kind, id }) => Effect.sync(() => facts(book.whatNeeds(kind, id))),
    switch_facts: ({ id }) =>
      Effect.sync(() => ({
        setBy: facts(book.whatSets(id)),
        opens: facts(book.whatOpensAfter(id)),
      })),
    map_contents: ({ mapId }) =>
      Effect.sync(() => facts(book.around(book.findMap(mapId) ?? book.state.mapId))),
    next_steps: () => Effect.sync(() => facts(book.nextSteps(TOOL_LIMIT))),
    recent_dialogue: () => Effect.sync(() => book.recentDialogue().map((fact) => toModel(fact))),
    enemy: ({ id }) =>
      Effect.sync(() => {
        const card = book.enemyCard(id)

        return facts(card === undefined ? [] : [card])
      }),
  })
}
