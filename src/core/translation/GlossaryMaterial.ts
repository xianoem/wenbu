import { Predicate } from 'effect'
import type { GameGlossaryEntry, GlossaryEntryKind } from '#contract/GameGlossary'
import { makeMatcher } from '../glossary/GlossaryMatcher'
import { isDataArray, isDataObject, type RpgData } from '../rpgmaker/RpgData'
import { dialogueSpeakers, type Speaker, speakerKeysOf } from '../rpgmaker/Speakers'
import type { TextEntry, TranslationItem } from '../rpgmaker/TextEntries'
import { isMapFile } from '../rpgmaker/TextLocations'
import { isWolfTextFile, wolfDatabaseNames, wolfSpeakers } from '../wolf/WolfText'

export interface GlossaryActor {
  readonly id: number
  readonly name: string
  readonly nickname: string
  readonly profile: string
  readonly face?: string
}

export interface GlossaryName {
  readonly kind: GlossaryEntryKind
  readonly name: string
}

export interface GlossaryMaterial {
  /** Keyed by entry id. */
  readonly speakers: ReadonlyMap<string, Speaker>
  readonly actors: ReadonlyArray<GlossaryActor>
  readonly names: ReadonlyArray<GlossaryName>
}

const nameFiles: Record<string, GlossaryEntryKind> = {
  'Classes.json': 'other',
  'Skills.json': 'skill',
  'Items.json': 'item',
  'Weapons.json': 'item',
  'Armors.json': 'item',
  'Enemies.json': 'other',
  'States.json': 'other',
  'MapInfos.json': 'place',
}

const jsonName = (file: string) => file.replace(/\.rvdata2$/i, '.json')

export const isMaterialFile = (file: string) => {
  const name = jsonName(file)

  return (
    name === 'Actors.json' ||
    name === 'CommonEvents.json' ||
    name === 'Troops.json' ||
    Object.hasOwn(nameFiles, name) ||
    isMapFile(name) ||
    isWolfTextFile(file)
  )
}

const hasLetters = (text: string) => /[A-Za-z぀-ヿ㐀-鿿가-힯]/.test(text)

const textField = (record: Record<string, RpgData>, ...keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    const value = record[key]

    if (Predicate.isString(value)) {
      return value.trim()
    }
  }

  return ''
}

const recordsOf = (data: RpgData) =>
  isDataArray(data) ? data.filter((record) => isDataObject(record)) : []

const actorsOf = (data: RpgData): ReadonlyArray<GlossaryActor> =>
  recordsOf(data).flatMap((record) => {
    const name = textField(record, 'name')
    const id = record['id']
    const faceName = textField(record, 'faceName', 'face_name')
    const faceIndex = record['faceIndex'] ?? record['face_index']

    if (name === '' || !Predicate.isNumber(id)) {
      return []
    }

    return [
      {
        id,
        name,
        nickname: textField(record, 'nickname'),
        profile: textField(record, 'profile', 'description'),
        ...(faceName === ''
          ? {}
          : { face: `${faceName}:${Predicate.isNumber(faceIndex) ? faceIndex : 0}` }),
      },
    ]
  })

const namesOf = (file: string, data: RpgData): ReadonlyArray<GlossaryName> => {
  const name = jsonName(file)
  const kind = nameFiles[name]

  if (kind !== undefined) {
    return recordsOf(data).map((record) => ({ kind, name: textField(record, 'name') }))
  }

  if (isMapFile(name) && isDataObject(data)) {
    return [{ kind: 'place', name: textField(data, 'displayName', 'display_name') }]
  }

  return []
}

export const collectMaterial = () => {
  const speakers = new Map<string, Speaker>()
  const actors: Array<GlossaryActor> = []
  const names = new Map<string, GlossaryName>()

  const add = (file: string, data: RpgData) => {
    for (const [pointer, speaker] of [
      ...dialogueSpeakers(file, data),
      ...wolfSpeakers(file, data),
    ]) {
      speakers.set(`${file}::${pointer}`, speaker)
    }

    if (jsonName(file) === 'Actors.json') {
      actors.push(...actorsOf(data))
    }

    for (const found of [...namesOf(file, data), ...wolfDatabaseNames(file, data)]) {
      if (hasLetters(found.name) && !names.has(found.name)) {
        names.set(found.name, found)
      }
    }
  }

  const material = (): GlossaryMaterial => ({ speakers, actors, names: [...names.values()] })

  return { add, material }
}

const mentionCounts = (
  patterns: ReadonlyArray<{ readonly id: string; readonly original: string }>,
  entries: ReadonlyArray<TextEntry>,
) => {
  const matcher = makeMatcher(
    patterns
      .filter((pattern) => pattern.original !== '')
      .map((pattern) => ({ id: pattern.id, patterns: [pattern.original] })),
  )

  const counts = new Map<string, number>()

  for (const entry of entries) {
    for (const id of new Set(matcher.find(entry.src).map((match) => match.id))) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  return counts
}

/** The database names worth a glossary entry, those the dialogue mentions most first. */
export const candidateNames = (
  material: GlossaryMaterial,
  entries: ReadonlyArray<TextEntry>,
  limit: number,
) => {
  const counts = mentionCounts(
    material.names.map((found) => ({ id: found.name, original: found.name })),
    entries,
  )

  return material.names
    .toSorted((left, right) => (counts.get(right.name) ?? 0) - (counts.get(left.name) ?? 0))
    .slice(0, limit)
}

export interface ResolvedSpeaker {
  readonly label: string
  readonly character?: GameGlossaryEntry
}

const claimsOf = (material: GlossaryMaterial, entries: ReadonlyArray<GameGlossaryEntry>) => {
  const characters = entries.filter((entry) => entry.kind === 'character')
  const claims = new Map<string, GameGlossaryEntry>()

  const claim = (key: string, character: GameGlossaryEntry | undefined) => {
    if (character !== undefined && !claims.has(key)) {
      claims.set(key, character)
    }
  }

  for (const character of characters) {
    for (const key of character.speakers) {
      claim(key, character)
    }
  }

  const byName = new Map(characters.map((character) => [character.original, character]))

  for (const character of characters) {
    claim(`name:${character.original}`, character)
  }

  for (const actor of material.actors) {
    claim(`actor:${actor.id}`, byName.get(actor.name))

    if (actor.face !== undefined) {
      claim(`face:${actor.face}`, byName.get(actor.name))
    }
  }

  return claims
}

/** Finds who says a line: a glossary character, or else the name the game shows. */
export const speakerIndex = (
  material: GlossaryMaterial,
  entries: ReadonlyArray<GameGlossaryEntry>,
) => {
  const claims = claimsOf(material, entries)
  const actorNames = new Map(material.actors.map((actor) => [actor.id, actor.name]))
  const faceNames = new Map(material.actors.map((actor) => [actor.face, actor.name]))

  const fallback = (speaker: Speaker) => {
    if (speaker.name !== undefined) {
      return speaker.name
    }

    if (speaker.actor !== undefined) {
      return actorNames.get(speaker.actor)
    }

    return speaker.face === undefined ? undefined : faceNames.get(speaker.face)
  }

  const resolve = (entryId: string): ResolvedSpeaker | undefined => {
    const speaker = material.speakers.get(entryId)

    if (speaker === undefined) {
      return undefined
    }

    for (const key of speakerKeysOf(speaker)) {
      const character = claims.get(key)

      if (character !== undefined) {
        return { label: character.translation, character }
      }
    }

    const label = fallback(speaker)

    return label === undefined || label === '' ? undefined : { label }
  }

  return { resolve }
}

export type SpeakerIndex = ReturnType<typeof speakerIndex>

/** A line shared by several speakers is translated once for each, in each one's voice. */
export const splitBySpeaker = (
  items: ReadonlyArray<TranslationItem>,
  labelOf: (entryId: string) => string | undefined,
): ReadonlyArray<TranslationItem> =>
  items.flatMap((item) => {
    if (item.entryIds.length < 2) {
      return [item]
    }

    const groups = Map.groupBy(item.entryIds, (entryId) => labelOf(entryId) ?? '')

    if (groups.size < 2) {
      return [item]
    }

    return [...groups.values()].map((entryIds) => ({
      ...item,
      id: entryIds[0] ?? item.id,
      entryIds,
    }))
  })

export const lineCounts = (
  glossary: ReadonlyArray<GameGlossaryEntry>,
  entries: ReadonlyArray<TextEntry>,
  index: SpeakerIndex,
) => {
  const matcher = makeMatcher(
    glossary
      .filter((entry) => entry.original !== '')
      .map((entry) => ({ id: entry.id, patterns: [entry.original] })),
  )

  const counts = new Map(glossary.map((entry) => [entry.id, 0]))

  for (const line of entries) {
    const found = new Set(matcher.find(line.src).map((match) => match.id))
    const speaker = index.resolve(line.id)?.character

    if (speaker !== undefined) {
      found.add(speaker.id)
    }

    for (const id of found) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  return counts
}

export const nameLimit = 300

export const speakerLimit = 80

const stand = (length: number) => 'x'.repeat(length)

const standInName = (original: string) => stand(Math.min(24, Math.max(4, original.length * 2)))

const standInVoice = stand(140)

const standInCharacter = (
  id: string,
  original: string,
  speakers: ReadonlyArray<string>,
): GameGlossaryEntry => ({
  id,
  kind: 'character',
  original,
  translation: standInName(original),
  note: standInVoice,
  speakers,
  lines: 0,
})

/** Stands in for the glossary before the model prepares it, so its cost can be estimated. */
export const provisionalGlossary = (
  material: GlossaryMaterial,
  entries: ReadonlyArray<TextEntry>,
): ReadonlyArray<GameGlossaryEntry> => {
  const actorNames = new Set(material.actors.map((actor) => actor.name))

  const actors = material.actors.map((actor) =>
    standInCharacter(`actor:${actor.id}`, actor.name, [
      `actor:${actor.id}`,
      `name:${actor.name}`,
      ...(actor.face === undefined ? [] : [`face:${actor.face}`]),
    ]),
  )

  const nameBoxes = [
    ...new Set([...material.speakers.values()].flatMap((speaker) => speaker.name ?? [])),
  ]
    .filter((name) => !actorNames.has(name))
    .map((name) => standInCharacter(`name:${name}`, name, [`name:${name}`]))

  const named = speakerIndex(material, [...actors, ...nameBoxes])

  const faces = [
    ...new Set(
      entries.flatMap((entry) => {
        const face = material.speakers.get(entry.id)?.face

        return face === undefined || named.resolve(entry.id) !== undefined ? [] : [face]
      }),
    ),
  ].map((face) => standInCharacter(`face:${face}`, '', [`face:${face}`]))

  const terms = candidateNames(material, entries, nameLimit)
    .filter((found) => !actorNames.has(found.name))
    .map((found) => ({
      id: `term:${found.name}`,
      kind: found.kind,
      original: found.name,
      translation: standInName(found.name),
      note: '',
      speakers: [],
      lines: 0,
    }))

  return [...actors, ...nameBoxes, ...faces, ...terms].slice(0, nameLimit + speakerLimit)
}
