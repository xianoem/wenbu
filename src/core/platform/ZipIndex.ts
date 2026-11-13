import { Effect, FileSystem, Option, Path, Schema } from 'effect'
import { Inflate, inflateSync } from 'fflate'

export interface ZipEntry {
  readonly name: string
  readonly size: number
  readonly compressedSize: number
  readonly method: number
  readonly encrypted: boolean
  readonly directory: boolean
  readonly offset: number
  readonly modifiedAt: number
}

export class ZipError extends Schema.TaggedError<ZipError>()('ZipError', {
  message: Schema.String,
}) {}

const notZip = () => new ZipError({ message: 'This file is not a zip archive, or it is damaged.' })

const chunkSize = 1024 * 1024

const signatures = {
  local: 0x04034b50,
  central: 0x02014b50,
  end: 0x06054b50,
  zip64End: 0x06064b50,
  zip64Locator: 0x07064b50,
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const u64 = (data: DataView, at: number) =>
  data.getUint32(at, true) + data.getUint32(at + 4, true) * 2 ** 32

const utf8 = new TextDecoder('utf-8')

const shiftJis = new TextDecoder('shift_jis')

const latin1 = new TextDecoder('latin1')

const replacementCharacter = String.fromCodePoint(0xfffd)

/** Without the UTF-8 flag names are Shift-JIS from Japanese archivers, which also reads ASCII. */
const decodeName = (bytes: Uint8Array, flags: number) => {
  if ((flags & 0x800) !== 0) {
    return utf8.decode(bytes)
  }

  const name = shiftJis.decode(bytes)

  return name.includes(replacementCharacter) ? latin1.decode(bytes) : name
}

const unicodeName = (extra: DataView) => {
  for (let at = 0; at + 4 <= extra.byteLength;) {
    const id = extra.getUint16(at, true)
    const length = extra.getUint16(at + 2, true)

    if (id === 0x7075 && length > 5) {
      return utf8.decode(new Uint8Array(extra.buffer, extra.byteOffset + at + 9, length - 5))
    }

    at += 4 + length
  }

  return undefined
}

/** The zip64 field holds, in order, whichever of these the fixed header set to 0xFFFFFFFF. */
const zip64Values = (
  extra: DataView,
  wanted: { readonly size: boolean; readonly compressed: boolean; readonly offset: boolean },
) => {
  for (let at = 0; at + 4 <= extra.byteLength;) {
    const id = extra.getUint16(at, true)
    const length = extra.getUint16(at + 2, true)

    if (id === 0x0001) {
      let field = at + 4

      const next = (needed: boolean) => {
        if (!needed || field + 8 > at + 4 + length) {
          return undefined
        }

        const value = u64(extra, field)

        field += 8

        return value
      }

      return {
        size: next(wanted.size),
        compressed: next(wanted.compressed),
        offset: next(wanted.offset),
      }
    }

    at += 4 + length
  }

  return {}
}

const dosTimeOf = (time: number, date: number) =>
  Date.UTC(
    1980 + (date >>> 9),
    ((date >>> 5) & 0xf) - 1,
    date & 0x1f,
    time >>> 11,
    (time >>> 5) & 0x3f,
    (time & 0x1f) * 2,
  )

const readAt = Effect.fnUntraced(function* (
  file: FileSystem.File,
  position: number,
  length: number,
) {
  const buffer = new Uint8Array(length)
  let filled = 0

  while (filled < length) {
    const read = yield* file.read(buffer.subarray(filled), { position: BigInt(position + filled) })

    if (read === 0) {
      return yield* notZip()
    }

    filled += read
  }

  return buffer
})

const findDirectory = Effect.fnUntraced(function* (file: FileSystem.File, size: number) {
  const tailLength = Math.min(size, 22 + 0xffff)
  const tail = view(yield* readAt(file, size - tailLength, tailLength))
  let end = -1

  for (let at = tail.byteLength - 22; at >= 0; at--) {
    if (tail.getUint32(at, true) === signatures.end) {
      end = at
      break
    }
  }

  if (end === -1) {
    return yield* notZip()
  }

  const entries = tail.getUint16(end + 10, true)
  const length = tail.getUint32(end + 12, true)
  const offset = tail.getUint32(end + 16, true)

  if (entries !== 0xffff && length !== 0xffffffff && offset !== 0xffffffff) {
    return { entries, offset, length }
  }

  const locator = end - 20

  if (locator < 0 || tail.getUint32(locator, true) !== signatures.zip64Locator) {
    return { entries, offset, length }
  }

  const record = view(yield* readAt(file, u64(tail, locator + 8), 56))

  if (record.getUint32(0, true) !== signatures.zip64End) {
    return yield* notZip()
  }

  return { entries: u64(record, 32), length: u64(record, 40), offset: u64(record, 48) }
})

export const readZipIndex = Effect.fn('ZipIndex.read')(function* (archive: string) {
  const fs = yield* FileSystem.FileSystem
  const file = yield* fs.open(archive).pipe(Effect.mapError(() => notZip()))
  const size = Number((yield* file.stat.pipe(Effect.mapError(() => notZip()))).size)

  const directory = yield* findDirectory(file, size).pipe(
    Effect.catchTag('PlatformError', () => Effect.fail(notZip())),
  )

  const bytes = yield* readAt(file, directory.offset, directory.length).pipe(
    Effect.catchTag('PlatformError', () => Effect.fail(notZip())),
  )

  const data = view(bytes)
  const entries: Array<ZipEntry> = []

  for (let at = 0; entries.length < directory.entries;) {
    if (at + 46 > data.byteLength || data.getUint32(at, true) !== signatures.central) {
      return yield* notZip()
    }

    const flags = data.getUint16(at + 8, true)
    const nameLength = data.getUint16(at + 28, true)
    const extraLength = data.getUint16(at + 30, true)
    const commentLength = data.getUint16(at + 32, true)
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength)
    const extra = new DataView(bytes.buffer, bytes.byteOffset + at + 46 + nameLength, extraLength)
    const compressedSize = data.getUint32(at + 20, true)
    const size = data.getUint32(at + 24, true)
    const offset = data.getUint32(at + 42, true)

    const big = zip64Values(extra, {
      size: size === 0xffffffff,
      compressed: compressedSize === 0xffffffff,
      offset: offset === 0xffffffff,
    })

    const name = (unicodeName(extra) ?? decodeName(nameBytes, flags)).replace(/\\/g, '/')

    entries.push({
      name,
      size: big.size ?? size,
      compressedSize: big.compressed ?? compressedSize,
      method: data.getUint16(at + 10, true),
      encrypted: (flags & 1) !== 0,
      directory: name.endsWith('/'),
      offset: big.offset ?? offset,
      modifiedAt: dosTimeOf(data.getUint16(at + 12, true), data.getUint16(at + 14, true)),
    })

    at += 46 + nameLength + extraLength + commentLength
  }

  return entries
}, Effect.scoped)

const ensureReadable = (entry: ZipEntry) => {
  if (entry.encrypted) {
    return Effect.fail(
      new ZipError({ message: 'The zip is password-protected. Unzip it first, then try again.' }),
    )
  }

  if (entry.method !== 0 && entry.method !== 8) {
    return Effect.fail(
      new ZipError({
        message: `${entry.name} is packed in a way Wenbu can't read. Unzip it first, then try again.`,
      }),
    )
  }

  return Effect.void
}

const dataStart = Effect.fnUntraced(function* (file: FileSystem.File, entry: ZipEntry) {
  const header = view(yield* readAt(file, entry.offset, 30))

  if (header.getUint32(0, true) !== signatures.local) {
    return yield* notZip()
  }

  return entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true)
})

export const readZipEntry = Effect.fn('ZipIndex.readEntry')(function* (
  archive: string,
  entry: ZipEntry,
) {
  yield* ensureReadable(entry)

  const fs = yield* FileSystem.FileSystem
  const file = yield* fs.open(archive).pipe(Effect.mapError(() => notZip()))

  const body = yield* Effect.gen(function* () {
    const start = yield* dataStart(file, entry)

    return yield* readAt(file, start, entry.compressedSize)
  }).pipe(Effect.catchTag('PlatformError', () => Effect.fail(notZip())))

  return entry.method === 0
    ? body
    : yield* Effect.try({ try: () => inflateSync(body), catch: () => notZip() })
}, Effect.scoped)

export const extractZipEntry = Effect.fn('ZipIndex.extract')(function* (
  archive: string,
  entry: ZipEntry,
  target: string,
) {
  yield* ensureReadable(entry)

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  yield* fs.makeDirectory(path.dirname(target), { recursive: true })

  const source = yield* fs.open(archive)
  const output = yield* fs.open(target, { flag: 'w' })
  const start = yield* dataStart(source, entry)
  const pending: Array<Uint8Array> = []
  let written = 0

  const inflate =
    entry.method === 8
      ? new Inflate((chunk) => {
          pending.push(chunk)
        })
      : undefined

  const flush = Effect.fnUntraced(function* () {
    for (const chunk of pending.splice(0)) {
      yield* output.writeAll(chunk)
      written += chunk.length
    }
  })

  for (let read = 0; read < entry.compressedSize;) {
    const length = Math.min(chunkSize, entry.compressedSize - read)
    const chunk = yield* readAt(source, start + read, length)

    read += length

    if (inflate === undefined) {
      pending.push(chunk)
    } else {
      yield* Effect.try({
        try: () => inflate.push(chunk, read === entry.compressedSize),
        catch: () => notZip(),
      })
    }

    yield* flush()
  }

  if (written !== entry.size) {
    return yield* notZip()
  }
}, Effect.scoped)

export const zipEntryOption = (entries: ReadonlyArray<ZipEntry>, name: string) =>
  Option.fromNullishOr(entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase()))
