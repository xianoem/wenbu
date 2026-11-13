import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, describe, it } from '@effect/vitest'
import type { LogEntry } from '#contract/Diagnostics'
import { formatLogEntry } from '#contract/LogText'
import { diagnosticsReport } from './diagnosticsReport'

const roots: Array<string> = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const entry = (at: number, process: LogEntry['process'], message: string): LogEntry => ({
  at,
  level: 'info',
  process,
  run: process === 'core' ? 1 : 0,
  feature: 'app',
  message,
  fields: {},
})

const writeLaunch = (root: string, id: string, main: Array<LogEntry>, core: Array<LogEntry>) => {
  mkdirSync(join(root, id))

  writeFileSync(
    join(root, id, 'main.log'),
    main.map((line) => `${formatLogEntry(line)}\n`).join(''),
  )

  if (core.length > 0) {
    writeFileSync(
      join(root, id, 'core.log'),
      core.map((line) => `${formatLogEntry(line)}\n`).join(''),
    )
  }
}

describe('diagnosticsReport', () => {
  it('lists what Wenbu runs on, then the last two launches with both processes in time order', () => {
    const root = mkdtempSync(join(tmpdir(), 'wenbu-report-'))

    roots.push(root)
    writeLaunch(root, '2026-10-23T10-00-00', [entry(1, 'main', 'Oldest')], [])
    writeLaunch(root, '2026-10-24T10-00-00', [entry(10, 'main', 'Yesterday')], [])

    writeLaunch(
      root,
      '2026-10-25T10-00-00',
      [entry(100, 'main', 'Wenbu started'), entry(300, 'main', 'Core exited')],
      [entry(200, 'core', 'Core started')],
    )

    const report = diagnosticsReport({
      root,
      about: [
        ['App', '0.1.0'],
        ['Electron', '45.0.0'],
      ],
    })

    assert.include(report, 'App       0.1.0\nElectron  45.0.0')
    assert.notInclude(report, 'Oldest')

    const lines = report.split('\n')
    const today = lines.indexOf('== Launch 2026-10-25T10-00-00 (UTC) ==')
    const yesterday = lines.indexOf('== Launch 2026-10-24T10-00-00 (UTC) ==')

    assert.isBelow(today, yesterday)

    assert.deepStrictEqual(
      lines.slice(today + 1, today + 4).map((line) => line.split('"')[1]),
      ['Wenbu started', 'Core started', 'Core exited'],
    )
  })
})
