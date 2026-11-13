import { isUtf8 } from 'node:buffer'
import { Predicate } from 'effect'
import { isDataArray, isDataObject, type RpgData, type RpgDataObject } from './RpgData'

export interface DecodeOptions {
  readonly binaryStrings?: boolean
}

const textDecoder = new TextDecoder()

const textEncoder = new TextEncoder()

const charCode = (char: string) => char.charCodeAt(0)

const isUserDefined = (
  value: RpgDataObject,
): value is RpgDataObject & { __rubyUserDefined: string; bytes: Uint8Array } =>
  Predicate.isString(value['__rubyUserDefined']) && value['bytes'] instanceof Uint8Array

export const decodeRubyMarshal = (bytes: Uint8Array, options: DecodeOptions = {}): RpgData => {
  let offset = 0
  const symbols: Array<string> = []
  const objects: Array<RpgData> = []

  const fail = (message: string): never => {
    throw new Error(message)
  }

  const byte = () => (offset < bytes.length ? bytes[offset++]! : fail('Unexpected end of data.'))

  const signedByte = () => {
    const value = byte()

    return value > 127 ? value - 256 : value
  }

  const take = (length: number) => {
    if (length < 0 || offset + length > bytes.length) {
      return fail('Unexpected end of a byte string.')
    }

    const slice = bytes.subarray(offset, offset + length)

    offset += length

    return slice
  }

  const fixnum = () => {
    const marker = signedByte()

    if (marker === 0) {
      return 0
    }

    if (marker > 4) {
      return marker - 5
    }

    if (marker < -4) {
      return marker + 5
    }

    const count = Math.abs(marker)
    let value = 0

    for (let index = 0; index < count; index++) {
      value |= byte() << (index * 8)
    }

    return marker > 0 ? value >>> 0 : value - 2 ** (count * 8)
  }

  const byteString = () => take(fixnum())

  const remember = <A extends RpgData>(value: A) => {
    objects.push(value)

    return value
  }

  const newSymbol = () => {
    const symbol = textDecoder.decode(byteString())

    symbols.push(symbol)

    return symbol
  }

  const symbolLink = () => symbols[fixnum()] ?? fail('A symbol link points outside the table.')

  const symbol = () => {
    const type = String.fromCharCode(byte())

    if (type === ':') {
      return newSymbol()
    }

    if (type === ';') {
      return symbolLink()
    }

    return fail(`Expected a symbol, found ${type}.`)
  }

  const string = () => {
    const raw = byteString()
    const value = options.binaryStrings && !isUtf8(raw) ? Buffer.from(raw) : textDecoder.decode(raw)

    return remember(value)
  }

  const float = () => {
    const text = textDecoder.decode(byteString())

    const special: Record<string, number> = {
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      '-inf': Number.NEGATIVE_INFINITY,
    }

    return remember(special[text] ?? Number(text))
  }

  // Instance variables on a string carry its encoding; the value itself is what matters.
  const withInstanceVariables = () => {
    const wrapped = value()
    const count = fixnum()

    for (let index = 0; index < count; index++) {
      symbol()
      value()
    }

    return wrapped
  }

  const array = () => {
    const items = remember<Array<RpgData>>([])
    const count = fixnum()

    for (let index = 0; index < count; index++) {
      items.push(value())
    }

    return items
  }

  const hash = () => {
    const record = remember<RpgDataObject>({})
    const count = fixnum()

    for (let index = 0; index < count; index++) {
      const key = value()

      record[String(key)] = value()
    }

    return record
  }

  const object = () => {
    const record = remember<RpgDataObject>({ __rubyClass: symbol() })
    const count = fixnum()

    for (let index = 0; index < count; index++) {
      const key = symbol().replace(/^@/, '')

      record[key] = value()
    }

    return record
  }

  const objectLink = () => {
    const index = fixnum()
    const linked = objects[index]

    if (linked === undefined) {
      return fail(`Object link ${index} points outside the table of ${objects.length}.`)
    }

    return linked
  }

  const userDefined = () => {
    const rubyClass = symbol()

    return remember<RpgDataObject>({
      __rubyUserDefined: rubyClass,
      bytes: Buffer.from(byteString()),
    })
  }

  const readers: Record<string, () => RpgData> = {
    '0': () => null,
    T: () => true,
    F: () => false,
    i: fixnum,
    f: float,
    '"': string,
    I: withInstanceVariables,
    ':': newSymbol,
    ';': symbolLink,
    '[': array,
    '{': hash,
    o: object,
    '@': objectLink,
    u: userDefined,
  }

  function value(): RpgData {
    const type = String.fromCharCode(byte())
    const read = readers[type] ?? fail(`Unsupported value type ${type}.`)

    return read()
  }

  if (byte() !== 4 || byte() !== 8) {
    return fail('Unsupported Ruby Marshal version.')
  }

  return value()
}

const byteCountOf = (integer: number) => {
  let count = 1

  while (count < 4 && (integer < 0 ? integer < -(2 ** (count * 8)) : integer >= 2 ** (count * 8))) {
    count++
  }

  return count
}

export const encodeRubyMarshal = (root: RpgData): Uint8Array => {
  const chunks: Array<Uint8Array> = []
  let pending: Array<number> = [4, 8]

  const push = (...bytes: ReadonlyArray<number>) => {
    for (const byte of bytes) {
      pending.push(byte & 0xff)
    }
  }

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(Uint8Array.from(pending), bytes)
    pending = []
  }

  const fixnum = (value: number) => {
    const integer = Math.trunc(value)

    if (integer === 0) {
      return push(0)
    }

    if (integer > 0 && integer < 123) {
      return push(integer + 5)
    }

    if (integer < 0 && integer > -124) {
      return push(integer - 5)
    }

    const count = byteCountOf(integer)
    const unsigned = integer < 0 ? 2 ** (count * 8) + integer : integer

    push(integer < 0 ? -count : count)

    for (let index = 0; index < count; index++) {
      push(Math.floor(unsigned / 2 ** (index * 8)))
    }
  }

  const byteString = (bytes: Uint8Array) => {
    fixnum(bytes.length)
    pushBytes(bytes)
  }

  const symbol = (name: string) => {
    push(charCode(':'))
    byteString(textEncoder.encode(name))
  }

  const string = (text: string) => {
    push(charCode('I'), charCode('"'))
    byteString(textEncoder.encode(text))
    fixnum(1)
    symbol('E')
    push(charCode('T'))
  }

  const float = (number: number) => {
    const text = Number.isNaN(number)
      ? 'nan'
      : number === Number.POSITIVE_INFINITY
        ? 'inf'
        : number === Number.NEGATIVE_INFINITY
          ? '-inf'
          : String(number)

    push(charCode('f'))
    byteString(textEncoder.encode(text))
  }

  const record = (value: RpgDataObject) => {
    const rubyClass = value['__rubyClass']
    const entries = Object.entries(value).filter(([key]) => key !== '__rubyClass')

    if (Predicate.isString(rubyClass)) {
      push(charCode('o'))
      symbol(rubyClass)
      fixnum(entries.length)

      for (const [key, field] of entries) {
        symbol(key.startsWith('@') ? key : `@${key}`)
        write(field)
      }

      return
    }

    push(charCode('{'))
    fixnum(entries.length)

    for (const [key, field] of entries) {
      if (/^-?\d+$/.test(key)) {
        push(charCode('i'))
        fixnum(Number(key))
      } else {
        string(key)
      }

      write(field)
    }
  }

  function write(value: RpgData): void {
    if (value === null) {
      return push(charCode('0'))
    }

    if (Predicate.isBoolean(value)) {
      return push(charCode(value ? 'T' : 'F'))
    }

    if (Predicate.isNumber(value)) {
      if (Number.isInteger(value)) {
        push(charCode('i'))

        return fixnum(value)
      }

      return float(value)
    }

    if (Predicate.isString(value)) {
      return string(value)
    }

    if (value instanceof Uint8Array) {
      push(charCode('"'))

      return byteString(value)
    }

    if (isDataArray(value)) {
      push(charCode('['))
      fixnum(value.length)

      for (const item of value) {
        write(item)
      }

      return
    }

    if (isDataObject(value) && isUserDefined(value)) {
      push(charCode('u'))
      symbol(value['__rubyUserDefined'])

      return byteString(value.bytes)
    }

    record(value)
  }

  write(root)
  chunks.push(Uint8Array.from(pending))

  return Buffer.concat(chunks)
}
