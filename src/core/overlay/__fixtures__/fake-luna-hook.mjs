import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const argument = (name) => {
  const index = process.argv.indexOf(name)

  return index === -1 ? undefined : process.argv[index + 1]
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

if (process.argv.includes('--processes')) {
  send({
    processes: [
      { pid: 4, parent: 0, name: 'System', path: '' },
      { pid: 100, parent: 4, name: 'Game.exe', path: 'C:\\Games\\Aki\\Game.exe' },
    ],
  })

  process.exit(0)
}

const plugin = argument('--plugin') ?? ''
const log = argument('--log')

if (plugin.includes('missing')) {
  send({ event: 'error', message: 'LunaHost64.dll could not be loaded: not found.' })
  process.exit(1)
}

send({ event: 'ready' })

const thread = (pid, code) => `${pid}:${code}:0:0`

const lines = createInterface({ input: process.stdin })

lines.on('line', (line) => {
  if (log !== undefined) {
    appendFileSync(log, `${line}\n`)
  }

  if (line === 'quit') {
    process.exit(0)
  }

  const { id, op, pid, code } = JSON.parse(line)

  if (op === 'attach' && pid === 666) {
    send({ id, reason: 'elevated', error: 'The game runs as administrator.' })

    return
  }

  if (op === 'attach' && pid === 13) {
    process.exit(3)
  }

  if (op === 'attach' || op === 'elevate') {
    send({ id })
    send({ event: 'connected', pid })

    send({
      event: 'thread',
      thread: thread(pid, 'HS8@0:Game.exe'),
      pid,
      ctx: '0',
      ctx2: '0',
      code: 'HS8@0:Game.exe',
      name: 'TextOutA',
    })

    send({ event: 'text', thread: thread(pid, 'HS8@0:Game.exe'), text: 'こんにちは、世界。' })
    send({ event: 'log', level: 'info', message: 'Game engine: KiriKiri.' })

    return
  }

  if (op === 'insertHook') {
    send({ id })

    send({
      event: 'thread',
      thread: thread(pid, code),
      pid,
      ctx: '0',
      ctx2: '0',
      code,
      name: 'Manual',
    })

    return
  }

  if (op === 'detach') {
    send({ id })
    send({ event: 'disconnected', pid })

    return
  }

  send({ id, reason: 'failed', error: `Unknown command ${op}.` })
})

lines.on('close', () => process.exit(0))
