import { Predicate } from 'effect'
import { isDataArray, pointerOf, type RpgData } from './RpgData'
import { commandParameters, eventListsOf } from './TextLocations'

export interface Speaker {
  readonly name?: string
  readonly actor?: number
  readonly face?: string
}

const actorCode = /^\\N\[(\d+)\]$/i

const namePatterns = [/^\\n[cr]?<([^>]+)>/i, /^【([^】]+)】/]

const displayCodes = /\\(?![Nn]\[)[A-Za-z]+\[\d*\]|\\[{}.|!><^$]/g

const speakerOfName = (name: string): Speaker => {
  const clean = name.replace(displayCodes, '').trim()
  const actor = actorCode.exec(clean)?.[1]

  if (actor !== undefined) {
    return { actor: Number(actor) }
  }

  return clean === '' ? {} : { name: clean }
}

const nameInText = (line: string): Speaker | undefined => {
  const trimmed = line.trim()

  if (actorCode.test(trimmed)) {
    return speakerOfName(trimmed)
  }

  for (const pattern of namePatterns) {
    const name = pattern.exec(trimmed)?.[1]?.trim()

    if (name !== undefined && name !== '') {
      return speakerOfName(name)
    }
  }

  return undefined
}

const messageHeader = (parameters: ReadonlyArray<RpgData>): Speaker => {
  const [faceName, faceIndex] = parameters
  const nameBox = parameters[4]

  return {
    ...(Predicate.isString(nameBox) && nameBox.trim() !== '' ? speakerOfName(nameBox) : {}),
    ...(Predicate.isString(faceName) && faceName !== ''
      ? { face: `${faceName}:${Predicate.isNumber(faceIndex) ? faceIndex : 0}` }
      : {}),
  }
}

const isEmpty = (speaker: Speaker) =>
  speaker.name === undefined && speaker.actor === undefined && speaker.face === undefined

/** Who says each Show Text message, keyed by the pointer of its first line. */
export const dialogueSpeakers = (file: string, data: RpgData): ReadonlyMap<string, Speaker> => {
  const speakers = new Map<string, Speaker>()

  for (const events of eventListsOf(file, data)) {
    const list = isDataArray(events.list) ? events.list : []
    let header: Speaker | undefined

    for (const [index, entry] of list.entries()) {
      const command = commandParameters(entry)

      if (command?.code === 101) {
        header = messageHeader(command.parameters)
        continue
      }

      if (command?.code !== 401) {
        header = undefined
        continue
      }

      const first = command.parameters[0]

      if (header === undefined || !Predicate.isString(first)) {
        continue
      }

      const fromText =
        header.name === undefined && header.actor === undefined ? nameInText(first) : undefined

      const speaker = { ...fromText, ...header }

      if (!isEmpty(speaker)) {
        speakers.set(pointerOf(...events.base, index, 'parameters', 0), speaker)
      }

      header = undefined
    }
  }

  return speakers
}

/** Keys that identify a speaker, most certain first. */
export const speakerKeysOf = (speaker: Speaker): ReadonlyArray<string> => [
  ...(speaker.name === undefined ? [] : [`name:${speaker.name}`]),
  ...(speaker.actor === undefined ? [] : [`actor:${speaker.actor}`]),
  ...(speaker.face === undefined ? [] : [`face:${speaker.face}`]),
]
