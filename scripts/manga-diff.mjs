// Runs the Python manga worker and the native manga engine on the same Manga Editor pages and
// writes a diff report: block boxes and texts, masks, cleaned pages and lettered pages.
//
//   pnpm build && pnpm exec electron scripts/manga-diff.mjs --engine <engine folder> [--out <folder>] [--pages 10] [--ops scan,clean,render]
//
// The pages come from the editor database, opened read-only. Nothing in the galleries is written.

/* oxlint-disable no-await-in-loop -- both runtimes share one GPU, so pages and steps run one at a time. */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { app, MessageChannelMain, utilityProcess } from 'electron'
import { decode, encode } from 'fast-png'

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => !arg.endsWith('manga-diff.mjs')),
  options: {
    engine: { type: 'string' },
    plugin: { type: 'string' },
    out: { type: 'string', default: 'manga-diff' },
    pages: { type: 'string', default: '0' },
    ops: { type: 'string', default: 'scan,clean,render' },
  },
  strict: false,
})

const appData = process.env['APPDATA'] ?? ''
const repo = resolve(import.meta.dirname, '..')
const out = resolve(String(args.out))
const ops = new Set(String(args.ops).split(','))

const pluginFolder =
  args.plugin === undefined
    ? join(appData, 'Wenbu', 'plugins', 'manga-image-translator', '80f1bed-63a1829f')
    : String(args.plugin)

const options = {
  font_dir: join(repo, 'resources', 'fonts', 'Anime Ace'),
  model_dir: join(pluginFolder, 'models'),
  output_format: 'png',
}

const pythonWorker = () => {
  const child = spawn(
    join(pluginFolder, 'env', 'Scripts', 'python.exe'),
    ['-m', 'wenbu_manga.worker'],
    {
      env: {
        ...process.env,
        PYTHONPATH: [join(repo, 'resources', 'python'), join(pluginFolder, 'upstream')].join(';'),
        PYTHONPYCACHEPREFIX: join(pluginFolder, 'pycache'),
        PYTHONIOENCODING: 'utf-8',
        PYTHONNOUSERSITE: '1',
        PYTHONUTF8: '1',
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )

  let partial = ''
  const listeners = new Set()

  child.stdout.setEncoding('utf8')

  child.stdout.on('data', (chunk) => {
    const lines = (partial + chunk).split('\n')

    partial = lines.pop() ?? ''

    for (const line of lines.filter((text) => text.trim() !== '')) {
      for (const listener of listeners) {
        listener(line)
      }
    }
  })

  return {
    name: 'python',
    send: (line) => child.stdin.write(`${line}\n`),
    listen: (listener) => listeners.add(listener),
    stop: () => child.kill(),
  }
}

const nativeEngine = () => {
  const engine = utilityProcess.fork(join(repo, 'out', 'main', 'engine.js'), [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      WENBU_MANGA_ENGINE_DIR: String(args.engine ?? ''),
      WENBU_RESOURCES_DIR: join(repo, 'resources'),
    },
  })

  const { port1, port2 } = new MessageChannelMain()
  const listeners = new Set()

  engine.once('spawn', () => engine.postMessage(null, [port1]))

  port2.on('message', (event) => {
    for (const listener of listeners) {
      listener(String(event.data))
    }
  })

  port2.start()

  engine.once('exit', (code) => {
    for (const listener of listeners) {
      listener(JSON.stringify({ event: 'exited', code }))
    }
  })

  return {
    name: 'native',
    send: (line) => port2.postMessage(line),
    listen: (listener) => listeners.add(listener),
    stop: () => engine.kill(),
  }
}

const connect = (worker) => {
  let next = 0
  const waiting = new Map()
  let markReady
  let exited = false

  const ready = new Promise((done) => {
    markReady = done
  })

  worker.listen((line) => {
    const message = JSON.parse(line)

    if (message.event === 'ready') {
      markReady()
    }

    if (message.event === 'exited') {
      markReady()

      for (const done of waiting.values()) {
        done({ event: 'editor-failed', message: `The engine exited with code ${message.code}.` })
      }

      waiting.clear()
      exited = true
    }

    if (message.event === 'editor-done' || message.event === 'editor-failed') {
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
    }

    if (message.run !== undefined) {
      runListener?.(message)
    }
  })

  let runListener

  /** A folder run with filler translations: each text becomes an English line of similar length. */
  const folderRun = (pages) =>
    new Promise((done) => {
      const events = []
      const started = performance.now()

      runListener = (message) => {
        events.push({ ...message, at: (performance.now() - started) / 1000 })

        if (message.event === 'translate') {
          worker.send(
            JSON.stringify({
              type: 'translated',
              id: message.id,
              translations: message.texts.map((text, index) =>
                filler.slice(
                  0,
                  Math.max(12, Math.min(filler.length, [...text].length * 4 + index)),
                ),
              ),
            }),
          )
        }

        if (message.event === 'run-done' || message.event === 'run-failed') {
          runListener = undefined
          done({ events, seconds: (performance.now() - started) / 1000 })
        }
      }

      worker.send(JSON.stringify({ type: 'run', run: `diff-${worker.name}`, options, pages }))
    })

  const editor = async (request) => {
    await Promise.race([ready, new Promise((done) => setTimeout(done, 120_000))])

    if (exited) {
      return { event: 'editor-failed', message: 'The engine has exited.', seconds: 0 }
    }

    next += 1

    const id = next
    const started = performance.now()

    const reply = await new Promise((done) => {
      waiting.set(id, done)
      worker.send(JSON.stringify({ type: 'editor', id, options, ...request }))
    })

    return { ...reply, seconds: (performance.now() - started) / 1000 }
  }

  return { name: worker.name, ready, editor, folderRun, stop: worker.stop }
}

const filler =
  "Hey, wait a second! I didn't think you'd actually come all this way just to see me. That's so sweet of you, really."

const readPng = (file) => {
  if (!existsSync(file)) {
    return undefined
  }

  const image = decode(readFileSync(file))

  return { width: image.width, height: image.height, channels: image.channels, data: image.data }
}

/** Grey where the images agree, red scaled by the difference (times eight) where they do not. */
const differenceMap = (a, b, channels) => {
  const data = new Uint8Array(a.width * a.height * 3)

  for (let pixel = 0; pixel < a.width * a.height; pixel += 1) {
    let worst = 0

    for (let channel = 0; channel < channels; channel += 1) {
      worst = Math.max(
        worst,
        Math.abs(a.data[pixel * a.channels + channel] - b.data[pixel * b.channels + channel]),
      )
    }

    const grey = 128 + (a.data[pixel * a.channels] >> 2)

    data.set(worst === 0 ? [grey, grey, grey] : [255, Math.max(0, 200 - worst * 8), 0], pixel * 3)
  }

  return encode({ width: a.width, height: a.height, data, channels: 3, depth: 8 })
}

const compareImages = (a, b, differences) => {
  if (a === undefined || b === undefined) {
    return { missing: a === undefined ? 'python' : 'native' }
  }

  if (a.width !== b.width || a.height !== b.height) {
    return { size: [`${a.width}x${a.height}`, `${b.width}x${b.height}`] }
  }

  const channels = Math.min(a.channels, b.channels, 3)
  let differing = 0
  let max = 0
  let sum = 0

  for (let pixel = 0; pixel < a.width * a.height; pixel += 1) {
    let worst = 0

    for (let channel = 0; channel < channels; channel += 1) {
      const delta = Math.abs(
        a.data[pixel * a.channels + channel] - b.data[pixel * b.channels + channel],
      )

      worst = Math.max(worst, delta)
    }

    if (worst > 0) {
      differing += 1
      sum += worst
    }

    max = Math.max(max, worst)
  }

  if (differences !== undefined && differing > 0) {
    writeFileSync(differences, differenceMap(a, b, channels))
  }

  return {
    pixels: a.width * a.height,
    differing,
    max,
    meanWhereDiffering: differing === 0 ? 0 : sum / differing,
  }
}

const iou = (a, b) => {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const area = (box) => (box[2] - box[0]) * (box[3] - box[1])

  return inter / (area(a) + area(b) - inter || 1)
}

const plain = (text) => text.normalize('NFKC').replace(/\s+/g, '')

/** Native colours against the colours stored in the editor for the same block (IoU of at least 0.5). */
const compareColours = (stored, native) =>
  stored.flatMap((block) => {
    if (block.fg === undefined || block.bg === undefined) {
      return []
    }

    const match = native.find((candidate) => iou(block.box, candidate.box) >= 0.5)

    if (match === undefined) {
      return []
    }

    const distance = (a, b) => Math.max(...a.map((value, channel) => Math.abs(value - b[channel])))

    return [{ fg: distance(block.fg, match.fg), bg: distance(block.bg, match.bg) }]
  })

const compareBlocks = (python, native) => {
  const used = new Set()

  const pairs = python.map((block) => {
    let best = -1
    let bestIou = 0

    native.forEach((candidate, index) => {
      const overlap = iou(block.box, candidate.box)

      if (!used.has(index) && overlap > bestIou) {
        best = index
        bestIou = overlap
      }
    })

    if (best >= 0 && bestIou >= 0.5) {
      used.add(best)

      const other = native[best]

      return {
        iou: bestIou,
        python: block.text,
        native: other.text,
        sameText: plain(block.text) === plain(other.text),
        confidence: other.confidence,
        fg: block.fg.map((value, channel) => Math.abs(value - (other.fg[channel] ?? 0))),
        bg: block.bg.map((value, channel) => Math.abs(value - (other.bg[channel] ?? 0))),
        fontSize: [block.fontSize, other.fontSize],
        vertical: [block.vertical, other.vertical],
      }
    }

    return { iou: 0, python: block.text, native: undefined, sameText: false }
  })

  return {
    python: python.length,
    native: native.length,
    matched: pairs.filter((pair) => pair.native !== undefined).length,
    meanIou:
      pairs.length === 0 ? 1 : pairs.reduce((total, pair) => total + pair.iou, 0) / pairs.length,
    sameText: pairs.filter((pair) => pair.sameText).length,
    extraNative: native
      .filter((_, index) => !used.has(index))
      .map((block) => ({ text: block.text, confidence: block.confidence })),
    pairs,
  }
}

const editorPages = () => {
  const database = new DatabaseSync(join(appData, 'Wenbu', 'wenbu.sqlite'), { readOnly: true })

  const rows = database
    .prepare(
      'select b.folder, b.page, b.x, b.y, b.width, b.height, b.source, b.translation, b.vertical, b.fg, b.bg, b.font_size, b.origin from manga_editor_blocks b order by b.folder, b.page, b.position',
    )
    .all()

  const pages = new Map()

  for (const row of rows) {
    const key = `${row.folder}\u0000${row.page}`
    const page = pages.get(key) ?? { folder: row.folder, page: row.page, blocks: [] }

    page.blocks.push({
      box: [row.x, row.y, row.x + row.width, row.y + row.height],
      text: row.source,
      translation: row.translation,
      vertical: row.vertical === 1,
      ...(row.fg ? { fg: JSON.parse(row.fg) } : {}),
      ...(row.bg ? { bg: JSON.parse(row.bg) } : {}),
      ...(row.font_size ? { fontSize: row.font_size } : {}),
      drawn: row.origin === 'drawn',
    })

    pages.set(key, page)
  }

  database.close()

  return [...pages.values()].filter((page) => existsSync(join(page.folder, page.page)))
}

const run = async () => {
  const limit = Number(args.pages)
  const pages = editorPages().slice(0, limit > 0 ? limit : undefined)
  // The engine picks its GPU by timing a probe at start, so it starts before Python loads its models.
  const native = connect(nativeEngine())

  await native.ready

  const workers = [native, connect(pythonWorker())]
  const report = []

  if (ops.has('run')) {
    const jobs = (name) =>
      pages.map((page, index) => ({
        source: join(page.folder, page.page),
        output: join(out, name, 'run', `${index}.png`),
      }))

    const runs = {}

    for (const worker of workers) {
      runs[worker.name] = await worker.folderRun(jobs(worker.name))
    }

    const pagesOf = (name) =>
      runs[name].events.filter(
        (event) => event.event === 'page-done' || event.event === 'page-failed',
      )

    const runReport = pages.map((page, index) => ({
      page: join(page.folder, page.page),
      python: pagesOf('python').find((event) => event.page === index),
      native: pagesOf('native').find((event) => event.page === index),
      image: compareImages(
        readPng(join(out, 'python', 'run', `${index}.png`)),
        readPng(join(out, 'native', 'run', `${index}.png`)),
        join(out, `${index}-run-difference.png`),
      ),
    }))

    writeFileSync(
      join(out, 'run.json'),
      JSON.stringify(
        {
          seconds: { python: runs.python.seconds, native: runs.native.seconds },
          pages: runReport,
          events: { python: runs.python.events, native: runs.native.events },
        },
        null,
        1,
      ),
    )

    process.stdout.write(
      `run: ${pages.length} pages, python ${runs.python.seconds.toFixed(1)} s, native ${runs.native.seconds.toFixed(1)} s, native failed on ${runReport.filter((entry) => entry.native?.event !== 'page-done').length}\n`,
    )

    for (const worker of workers) {
      worker.stop()
    }

    return
  }

  for (const worker of workers) {
    mkdirSync(join(out, worker.name), { recursive: true })
  }

  for (const [index, page] of pages.entries()) {
    const source = join(page.folder, page.page)
    const entry = { page: source, ops: {} }
    const results = {}
    const file = (worker, kind) => join(out, worker, `${index}-${kind}.png`)

    const cleaning = page.blocks.map((block) => ({
      box: block.box,
      drawn: block.drawn,
      method: 'inpaint',
      ...(block.fg === undefined ? {} : { fg: block.fg }),
      ...(block.bg === undefined ? {} : { bg: block.bg }),
    }))

    const lettering = page.blocks
      .filter((block) => block.translation.trim() !== '')
      .map((block) => ({
        box: block.box,
        text: block.text,
        translation: block.translation,
        vertical: block.vertical,
        ...(block.fg === undefined ? {} : { fg: block.fg }),
        ...(block.bg === undefined ? {} : { bg: block.bg }),
        ...(block.fontSize === undefined ? {} : { fontSize: block.fontSize }),
      }))

    const requests = {
      scan: (worker) => ({ op: 'scan', source, mask: file(worker.name, 'mask') }),
      clean: (worker) => ({
        op: 'clean',
        source,
        mask: file('python', 'mask'),
        output: file(worker.name, 'cleaned'),
        blocks: cleaning,
      }),
      render: (worker) => ({
        op: 'render',
        source,
        output: file(worker.name, 'rendered'),
        cleaned: file('python', 'cleaned'),
        blocks: lettering,
      }),
    }

    for (const worker of workers) {
      results[worker.name] = {}
    }

    // One op at a time on both runtimes, so the GPU never runs both at once, and the clean and
    // render steps find the Python mask and cleaned page they read.
    for (const op of ['scan', 'clean', 'render']) {
      if (!ops.has(op)) {
        continue
      }

      for (const worker of workers) {
        results[worker.name][op] = await worker.editor(requests[op](worker))
      }
    }

    if (ops.has('breaks')) {
      const breaks = []

      for (const block of lettering) {
        const answers = {}

        for (const worker of workers) {
          answers[worker.name] = await worker.editor({ op: 'breaks', source, blocks: [block] })
        }

        const candidates = (answer) =>
          answer.event === 'editor-done' ? JSON.stringify(answer.result.candidates) : answer.message

        breaks.push({
          translation: block.translation,
          same: candidates(answers.python) === candidates(answers.native),
          python: candidates(answers.python),
          native: candidates(answers.native),
        })
      }

      entry.breaks = breaks
    }

    for (const op of ['scan', 'clean', 'render']) {
      if (!ops.has(op)) {
        continue
      }

      const python = results.python[op]
      const native = results.native[op]
      const kind = { scan: 'mask', clean: 'cleaned', render: 'rendered' }[op]

      entry.ops[op] = {
        seconds: { python: python.seconds, native: native.seconds },
        failed: {
          python: python.event === 'editor-failed' ? python.message : undefined,
          native: native.event === 'editor-failed' ? native.message : undefined,
        },
        image: compareImages(
          readPng(file('python', kind)),
          readPng(file('native', kind)),
          op === 'scan' ? undefined : join(out, `${index}-${kind}-difference.png`),
        ),
        files: [`python/${index}-${kind}.png`, `native/${index}-${kind}.png`].concat(
          op === 'scan' ? [] : [`${index}-${kind}-difference.png`],
        ),
        ...(op === 'scan' && python.event === 'editor-done' && native.event === 'editor-done'
          ? {
              blocks: compareBlocks(python.result.blocks, native.result.blocks),
              colours: compareColours(page.blocks, native.result.blocks),
            }
          : {}),
      }
    }

    report.push(entry)

    process.stdout.write(`${index + 1}/${pages.length} ${source}\n`)
  }

  for (const worker of workers) {
    worker.stop()
  }

  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1))
  writeFileSync(join(out, 'report.html'), html(report))

  process.stdout.write(`${summary(report)}\n`)
}

const summary = (report) => {
  const lines = []
  const breaks = report.flatMap((entry) => entry.breaks ?? [])

  if (breaks.length > 0) {
    lines.push(
      `breaks: ${breaks.filter((value) => value.same).length}/${breaks.length} blocks with the same candidates`,
    )
  }

  for (const op of ['scan', 'clean', 'render']) {
    const entries = report.map((entry) => entry.ops[op]).filter((value) => value !== undefined)

    if (entries.length === 0) {
      continue
    }

    const failed = entries.filter((value) => value.failed.native !== undefined).length
    const identical = entries.filter((value) => value.image.differing === 0).length

    lines.push(
      `${op}: ${entries.length} pages, native failed on ${failed}, identical images on ${identical}`,
    )

    if (op === 'scan') {
      const blocks = entries.map((value) => value.blocks).filter((value) => value !== undefined)
      const python = blocks.reduce((total, value) => total + value.python, 0)
      const matched = blocks.reduce((total, value) => total + value.matched, 0)
      const sameText = blocks.reduce((total, value) => total + value.sameText, 0)

      const extra = blocks.reduce((total, value) => total + value.extraNative.length, 0)
      const colours = entries.flatMap((value) => value.colours ?? [])

      const middle = (values) =>
        values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

      lines.push(
        `  blocks: ${matched}/${python} matched, ${sameText} with the same text, ${extra} extra native blocks`,
        `  colours against the editor's stored ones (${colours.length} blocks): median largest channel difference fg ${middle(colours.map((c) => c.fg))}, bg ${middle(colours.map((c) => c.bg))}`,
      )
    }
  }

  return lines.join('\n')
}

const escape = (text) =>
  String(text ?? '').replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character],
  )

const html = (report) =>
  `<!doctype html><meta charset="utf-8"><title>Manga engine diff</title>
<style>body{font-family:'Segoe UI','Yu Gothic UI',sans-serif;margin:24px;background:#16161a;color:#e8e8ea}
td,th{border:1px solid #3a3a42;padding:6px;vertical-align:top}table{border-collapse:collapse}.bad{color:#ffb454}</style>
<h1>Manga engine diff</h1><pre>${escape(summary(report))}</pre>
${report
  .map(
    (entry, index) =>
      `<h2>${index + 1}. ${escape(entry.page)}</h2>${Object.entries(entry.ops)
        .map(
          ([op, value]) =>
            `<h3>${op}</h3><pre>${escape(JSON.stringify({ seconds: value.seconds, failed: value.failed, image: value.image }))}</pre><p>${(
              value.files ?? []
            )
              .map((name) => `<a href="${name}"><img src="${name}" loading="lazy" width="360"></a>`)
              .join(' ')}</p>${
              value.blocks === undefined
                ? ''
                : `<table><tr><th>IoU</th><th>Python</th><th>Native</th></tr>${value.blocks.pairs
                    .map(
                      (pair) =>
                        `<tr class="${pair.sameText ? '' : 'bad'}"><td>${pair.iou.toFixed(2)}</td><td>${escape(pair.python)}</td><td>${escape(pair.native)}</td></tr>`,
                    )
                    .join('')}</table>`
            }`,
        )
        .join('')}`,
  )
  .join('')}`

void app
  .whenReady()
  .then(run)
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`)

    process.exitCode = 1
  })
  .finally(() => app.quit())
