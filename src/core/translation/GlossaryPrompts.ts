import { Effect, Schema } from 'effect'
import type { GameGlossaryEntry, GlossaryEntryKind } from '#contract/GameGlossary'
import type { TranslationSettings } from '#contract/GameTranslation'
import { makeMatcher } from '../glossary/GlossaryMatcher'
import { speakerKeysOf } from '../rpgmaker/Speakers'
import type { TextEntry, TranslationItem } from '../rpgmaker/TextEntries'
import { batchPrompt, fencedJson, instructionsOf } from './Batches'
import {
  candidateNames,
  type GlossaryMaterial,
  nameLimit,
  type SpeakerIndex,
  speakerLimit,
} from './GlossaryMaterial'
import { encodeJson } from './TranslationShared'

export const preparationSystem = 'You prepare glossaries for translating games.'

const sampleCount = 5

const sampleLength = 80

const speakerSamples = (material: GlossaryMaterial, entries: ReadonlyArray<TextEntry>) => {
  const found = new Map<string, { lines: number; samples: Array<string> }>()

  for (const entry of entries) {
    const speaker = material.speakers.get(entry.id)

    for (const key of speaker === undefined ? [] : speakerKeysOf(speaker)) {
      const seen = found.get(key) ?? { lines: 0, samples: [] }
      const sample = entry.src.replace(/\s+/g, ' ').trim().slice(0, sampleLength)

      seen.lines++

      if (seen.samples.length < sampleCount && sample !== '' && !seen.samples.includes(sample)) {
        seen.samples.push(sample)
      }

      found.set(key, seen)
    }
  }

  return new Map(
    [...found].toSorted(([, left], [, right]) => right.lines - left.lines).slice(0, speakerLimit),
  )
}

const actorsOf = (material: GlossaryMaterial) =>
  material.actors.map((actor) => ({
    id: actor.id,
    name: actor.name,
    ...(actor.nickname === '' ? {} : { nickname: actor.nickname }),
    ...(actor.profile === '' ? {} : { profile: actor.profile }),
    ...(actor.face === undefined ? {} : { face: `face:${actor.face}` }),
  }))

const namesByKind = (material: GlossaryMaterial, entries: ReadonlyArray<TextEntry>) => {
  const actorNames = new Set(material.actors.map((actor) => actor.name))
  const grouped: Partial<Record<GlossaryEntryKind, Array<string>>> = {}

  for (const found of candidateNames(material, entries, nameLimit)) {
    if (!actorNames.has(found.name)) {
      grouped[found.kind] = [...(grouped[found.kind] ?? []), found.name]
    }
  }

  return grouped
}

/** The speaker keys the preparation prompt shows, which the reply may assign to characters. */
export const preparationKeys = (material: GlossaryMaterial, entries: ReadonlyArray<TextEntry>) =>
  new Set([
    ...speakerSamples(material, entries).keys(),
    ...material.actors.flatMap((actor) => [
      `actor:${actor.id}`,
      `name:${actor.name}`,
      ...(actor.face === undefined ? [] : [`face:${actor.face}`]),
    ]),
  ])

export const preparationPrompt = Effect.fnUntraced(function* (
  targetLanguage: string,
  material: GlossaryMaterial,
  entries: ReadonlyArray<TextEntry>,
) {
  return [
    `Prepare a glossary for translating this game into ${targetLanguage}.`,
    'Return only a JSON object like {"characters":[{"original":"リナ","english":"Lina","voice":"Bright and quick to apologise. Calls Elda \\"Granny\\".","speakers":["name:リナ","face:Actor1:0"]}],"terms":[{"original":"灯火の森","english":"Lanternwood","kind":"place","note":""}]}.',
    'characters: everyone who speaks or is named below. "english" is the one name to use every time. "voice" is one or two short sentences a translator can follow: tone, how formal they are, how they refer to themselves and others, verbal habits. "speakers" lists the speaker keys below that belong to this character; a key belongs to one character at most.',
    'terms: places, items, skills and other names that must be translated the same way every time. "kind" is place, item, skill or other. "note" is optional: a few words when the use is not obvious.',
    'Leave out control codes and ordinary words.',
    `Speakers, with how many lines each has and some of them:\n${yield* Effect.orDie(encodeJson(Object.fromEntries(speakerSamples(material, entries))))}`,
    `Party members from the game's database:\n${yield* Effect.orDie(encodeJson(actorsOf(material)))}`,
    `Names from the game's database:\n${yield* Effect.orDie(encodeJson(namesByKind(material, entries)))}`,
  ].join('\n\n')
})

const OptionalText = Schema.optional(Schema.NullOr(Schema.String))

const PreparedReply = Schema.fromJsonString(
  Schema.Struct({
    characters: Schema.optional(
      Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            original: Schema.String,
            english: Schema.String,
            voice: OptionalText,
            speakers: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
          }),
        ),
      ),
    ),
    terms: Schema.optional(
      Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            original: Schema.String,
            english: Schema.String,
            kind: OptionalText,
            note: OptionalText,
          }),
        ),
      ),
    ),
  }),
)

const decodePrepared = Schema.decodeUnknownEffect(PreparedReply)

export type PreparedEntry = Omit<GameGlossaryEntry, 'id' | 'lines'>

const termKind = (kind: string | null | undefined): GlossaryEntryKind => {
  const clean = (kind ?? '').trim().toLowerCase()

  return clean === 'place' || clean === 'item' || clean === 'skill' ? clean : 'other'
}

export const parsePreparation = Effect.fnUntraced(function* (
  reply: string,
  knownKeys: ReadonlySet<string>,
) {
  const decoded = yield* decodePrepared(fencedJson(reply))
  const entries: Array<PreparedEntry> = []
  const originals = new Set<string>()
  const claimed = new Set<string>()

  for (const character of decoded.characters ?? []) {
    const original = character.original.trim()
    const translation = character.english.trim()

    if (original === '' || translation === '' || originals.has(original)) {
      continue
    }

    const speakers = (character.speakers ?? []).filter(
      (key) => knownKeys.has(key) && !claimed.has(key),
    )

    for (const key of speakers) {
      claimed.add(key)
    }

    originals.add(original)

    entries.push({
      kind: 'character',
      original,
      translation,
      note: (character.voice ?? '').trim(),
      speakers,
    })
  }

  for (const term of decoded.terms ?? []) {
    const original = term.original.trim()
    const translation = term.english.trim()

    if (original === '' || translation === '' || originals.has(original)) {
      continue
    }

    originals.add(original)

    entries.push({
      kind: termKind(term.kind),
      original,
      translation,
      note: (term.note ?? '').trim(),
      speakers: [],
    })
  }

  return entries
})

export interface GlossaryRequests {
  readonly speakerOf: (item: TranslationItem) => string | undefined
  readonly entriesFor: (batch: ReadonlyArray<TranslationItem>) => ReadonlyArray<GameGlossaryEntry>
}

export const makeGlossaryRequests = (
  glossary: ReadonlyArray<GameGlossaryEntry>,
  index: SpeakerIndex,
): GlossaryRequests => {
  const matcher = makeMatcher(
    glossary
      .filter((entry) => entry.original !== '')
      .map((entry) => ({ id: entry.id, patterns: [entry.original] })),
  )

  const resolve = (item: TranslationItem) => index.resolve(item.entryIds[0] ?? item.id)

  return {
    speakerOf: (item) => resolve(item)?.label,
    entriesFor: (batch) => {
      const ids = new Set<string>()

      for (const item of batch) {
        for (const match of matcher.find(item.src)) {
          ids.add(match.id)
        }

        const character = resolve(item)?.character

        if (character !== undefined) {
          ids.add(character.id)
        }
      }

      return glossary.filter((entry) => ids.has(entry.id))
    },
  }
}

const glossaryGuide =
  "Use this glossary for the game. Write each name and term the way it gives them. When a line names its speaker, write it in that character's voice."

const glossaryJson = (entries: ReadonlyArray<GameGlossaryEntry>) => {
  const characters = entries
    .filter((entry) => entry.kind === 'character')
    .map((entry) => ({
      name: entry.original,
      english: entry.translation,
      ...(entry.note === '' ? {} : { voice: entry.note }),
    }))

  const terms = entries
    .filter((entry) => entry.kind !== 'character')
    .map((entry) => ({
      original: entry.original,
      english: entry.translation,
      ...(entry.note === '' ? {} : { note: entry.note }),
    }))

  return {
    ...(characters.length === 0 ? {} : { characters }),
    ...(terms.length === 0 ? {} : { terms }),
  }
}

export const glossaryBatchPrompt = Effect.fnUntraced(function* (
  settings: TranslationSettings,
  batch: ReadonlyArray<TranslationItem>,
  requests: GlossaryRequests,
) {
  const speakers = batch.map((item) => requests.speakerOf(item))
  const entries = requests.entriesFor(batch)

  if (entries.length === 0 && speakers.every((speaker) => speaker === undefined)) {
    return yield* batchPrompt(settings, batch)
  }

  const items = Object.fromEntries(
    batch.map((item, index) => {
      const speaker = speakers[index]

      return [
        String(index + 1),
        {
          text: item.src,
          context: item.context,
          ...(speaker === undefined ? {} : { speaker }),
        },
      ]
    }),
  )

  return [
    ...instructionsOf(settings),
    glossaryGuide,
    ...(entries.length === 0 ? [] : [yield* Effect.orDie(encodeJson(glossaryJson(entries)))]),
    yield* Effect.orDie(encodeJson(items)),
  ].join('\n\n')
})
