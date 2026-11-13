import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const argument = (name) => process.argv[process.argv.indexOf(name) + 1]

const annotation = readFileSync(
  join(import.meta.dirname, 'screen-ai-annotation.b64'),
  'utf8',
).trim()

appendFileSync(argument('--starts'), `${argument('--resources')}\n`)
process.stdout.write(`${JSON.stringify({ ready: true, version: '153.5', maxDimension: 64 })}\n`)

let buffer = Buffer.alloc(0)

process.stdin.on('data', (data) => {
  buffer = Buffer.concat([buffer, data])

  while (buffer.length >= 8) {
    const width = buffer.readUInt32LE(0)
    const height = buffer.readUInt32LE(4)
    const size = 8 + width * height * 4

    if (buffer.length < size) {
      return
    }

    buffer = buffer.subarray(size)

    if (width === 1 && height === 1) {
      process.exit(1)
    }

    process.stdout.write(`${JSON.stringify({ annotation, sent: [width, height] })}\n`)
  }
})
