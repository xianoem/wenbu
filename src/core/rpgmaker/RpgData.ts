import { JsonPointer, Predicate } from 'effect'

export type RpgData = null | boolean | number | string | Uint8Array | RpgDataArray | RpgDataObject

export interface RpgDataArray extends Array<RpgData> {}

export interface RpgDataObject {
  [key: string]: RpgData
}

export const isDataObject = (value: RpgData | undefined): value is RpgDataObject =>
  Predicate.isObject(value) && !Array.isArray(value) && !(value instanceof Uint8Array)

export const isDataArray = (value: RpgData | undefined): value is RpgDataArray =>
  Array.isArray(value)

export const pointerOf = (...segments: ReadonlyArray<string | number>) =>
  `/${segments.map((segment) => JsonPointer.escapeToken(String(segment))).join('/')}`

const segmentsOf = (pointer: string) =>
  pointer.startsWith('/') ? pointer.slice(1).split('/').map(JsonPointer.unescapeToken) : []

const childOf = (value: RpgData | undefined, segment: string): RpgData | undefined => {
  if (isDataArray(value)) {
    const index = Number(segment)

    return Number.isInteger(index) ? value[index] : undefined
  }

  return isDataObject(value) && Object.hasOwn(value, segment) ? value[segment] : undefined
}

export const getAt = (root: RpgData, pointer: string): RpgData | undefined =>
  segmentsOf(pointer).reduce<RpgData | undefined>(childOf, root)

export const setAt = (root: RpgData, pointer: string, value: RpgData): boolean => {
  const segments = segmentsOf(pointer)
  const key = segments.pop()

  if (key === undefined) {
    return false
  }

  const parent = segments.reduce<RpgData | undefined>(childOf, root)

  if (isDataArray(parent)) {
    const index = Number(key)

    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      return false
    }

    parent[index] = value

    return true
  }

  if (!isDataObject(parent) || !Object.hasOwn(parent, key)) {
    return false
  }

  parent[key] = value

  return true
}
