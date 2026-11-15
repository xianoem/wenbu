// Speaks wenbu-manga-cv's binary protocol for put, get and drop, and fails every other operation.
const images = new Map()
let pending = Buffer.alloc(0)

const reply = (status, params, buffers) => {
  const head = Buffer.alloc(8)

  head.writeUInt32LE(status, 0)
  head.writeUInt32LE(params.length, 4)

  const parts = [
    head,
    ...params.map((value) => {
      const part = Buffer.alloc(8)

      part.writeDoubleLE(value, 0)

      return part
    }),
  ]

  const count = Buffer.alloc(4)

  count.writeUInt32LE(buffers.length, 0)
  parts.push(count)

  for (const buffer of buffers) {
    const size = Buffer.alloc(8)

    size.writeBigUInt64LE(BigInt(buffer.length), 0)
    parts.push(size, buffer)
  }

  process.stdout.write(Buffer.concat(parts))
}

const parse = () => {
  let offset = 0

  let complete = true

  const need = (size) => {
    if (pending.length < offset + size) {
      complete = false

      return Buffer.alloc(Math.max(size, 8))
    }

    const slice = pending.subarray(offset, offset + size)

    offset += size

    return slice
  }

  const op = need(4).readUInt32LE(0)
  const params = []

  for (let index = need(4).readUInt32LE(0); index > 0; index -= 1) {
    params.push(need(8).readDoubleLE(0))
  }

  const buffers = []

  for (let index = need(4).readUInt32LE(0); index > 0; index -= 1) {
    buffers.push(Buffer.from(need(Number(need(8).readBigUInt64LE(0)))))
  }

  if (!complete) {
    return undefined
  }

  pending = pending.subarray(offset)

  return { op, params, buffers }
}

process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk])

  for (let request = parse(); request !== undefined; request = parse()) {
    const [id = 0, width = 0, height = 0, channels = 0] = request.params

    if (request.op === 1) {
      images.set(id, { width, height, channels, data: request.buffers[0] })
      reply(0, [], [])
    } else if (request.op === 2 && images.has(id)) {
      const image = images.get(id)

      reply(0, [image.width, image.height, image.channels], [image.data])
    } else if (request.op === 3) {
      images.delete(id)
      reply(0, [], [])
    } else {
      reply(1, [], [Buffer.from(`unknown operation ${request.op}`)])
    }
  }
})
