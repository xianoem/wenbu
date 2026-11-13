// Speaks the manga worker protocol without Python. Each page asks for one translation; a page
// whose translation fails is reported failed. `crash` in the options makes the worker die.
// Editor operations answer at once: a scan finds two lines, clean and render write their output,
// breaks offers one layout, and a source with "broken" in its name fails.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const waiting = new Map()
let nextId = 0
let cancelled = false

send({ event: 'ready', protocol: Number(process.env.FAKE_PROTOCOL ?? 2) })

const translate = (run, page, texts) =>
  new Promise((resolve) => {
    nextId += 1
    waiting.set(nextId, resolve)
    send({ event: 'translate', run, id: nextId, page, texts })
  })

const run = async ({ run, options, pages }) => {
  cancelled = false

  if (options.crash) {
    process.stderr.write('CUDA error: out of memory\n')
    process.exit(3)
  }

  send({ event: 'loading-models', run })
  send({ event: 'models-loaded', run, device: 'cuda' })

  for (const [page] of pages.entries()) {
    if (cancelled) {
      send({ event: 'run-done', run, cancelled: true })

      return
    }

    send({ event: 'page-started', run, page, source: pages[page].source })
    send({ event: 'stage', run, page, stage: 'detecting' })

    // oxlint-disable-next-line no-await-in-loop -- pages run one after another, like the real worker.
    const reply = await translate(run, page, [`text ${page}`])

    if (cancelled) {
      send({ event: 'run-done', run, cancelled: true })

      return
    }

    if (reply.error) {
      send({ event: 'page-failed', run, page, message: reply.error })
    } else {
      send({
        event: 'page-done',
        run,
        page,
        output: pages[page].output,
        regions: reply.translations.length,
      })
    }
  }

  send({ event: 'run-done', run, cancelled: false, done: pages.length, failed: 0, seconds: 1.5 })
}

let modelsLoaded = false

const scanned = {
  width: 100,
  height: 200,
  blocks: [
    {
      box: [60, 10, 90, 60],
      area: [52, 4, 98, 70],
      text: 'ねえ、',
      fg: [0, 0, 0],
      bg: [255, 255, 255],
      fontSize: 20,
      vertical: true,
    },
    {
      box: [10, 120, 40, 190],
      area: null,
      text: '聞いてる？',
      fg: [0, 0, 0],
      bg: [255, 255, 255],
      fontSize: 20,
      vertical: true,
    },
  ],
}

const editor = ({ id, op, source, output, blocks }) => {
  if (!modelsLoaded) {
    modelsLoaded = true
    send({ event: 'loading-models', run: `editor-${id}` })
    send({ event: 'models-loaded', run: `editor-${id}`, device: 'cuda' })
  }

  if (String(source).includes('broken')) {
    send({ event: 'editor-failed', id, message: 'The page could not be read.' })

    return
  }

  if (op === 'scan') {
    send({ event: 'editor-done', id, result: scanned })

    return
  }

  if (op === 'breaks') {
    send({
      event: 'editor-done',
      id,
      result: { candidates: [{ lines: ['HEY,', 'YOU'], fontSize: 20 }] },
    })

    return
  }

  mkdirSync(dirname(output), { recursive: true })

  // A rendered page records what it was lettered with, so tests can read it back.
  const lettered =
    op === 'render'
      ? ` ${JSON.stringify(blocks.map((block) => [block.translation, block.lettering?.size]))}`
      : ''

  writeFileSync(output, `${op} ${source}${lettered}`)
  send({ event: 'editor-done', id, result: {} })
}

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)

  if (message.type === 'run') {
    void run(message)
  } else if (message.type === 'translated') {
    waiting.get(message.id)?.(message)
    waiting.delete(message.id)
  } else if (message.type === 'editor') {
    editor(message)
  } else if (message.type === 'cancel') {
    cancelled = true

    for (const resolve of waiting.values()) {
      resolve({ error: 'cancelled' })
    }

    waiting.clear()
  }
}
