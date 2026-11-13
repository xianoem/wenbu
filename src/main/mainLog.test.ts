import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, describe, it } from '@effect/vitest'
import { DateTime } from 'effect'
import type { LogEntry } from '#contract/Diagnostics'
import { parseLogText } from '#contract/LogText'
import { launchId, listLaunches, mainLog, outputTail, pruneLaunches } from './mainLog'

const roots: Array<string> = []

const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'wenbu-logs-'))

  roots.push(root)

  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('mainLog', () => {
  it('names a launch after its UTC start, safe for a folder name', () => {
    const at = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-10-25T11:03:12.123Z'))

    assert.strictEqual(launchId(at), '2026-10-25T11-03-12')
  })

  it('keeps only the newest launches', () => {
    const root = makeRoot()

    for (const name of ['2026-10-23T10-00-00', '2026-10-25T10-00-00', '2026-10-24T10-00-00']) {
      mkdirSync(join(root, name))
    }

    mkdirSync(join(root, 'other'))
    pruneLaunches(root, 2)

    assert.deepStrictEqual(listLaunches(root), ['2026-10-25T10-00-00', '2026-10-24T10-00-00'])
  })

  it('writes entries to main.log and shares them', () => {
    const folder = join(makeRoot(), '2026-10-25T10-00-00')
    const shared: Array<LogEntry> = []
    const log = mainLog({ folder, home: 'C:\\Users\\Ana', forward: (entry) => shared.push(entry) })

    log.error('Core exited unexpectedly', { exitCode: 3, run: 1 }, 'at C:\\Users\\Ana\\core.js')

    const [entry] = parseLogText(readFileSync(join(folder, 'main.log'), 'utf8'))

    assert.deepStrictEqual(
      [entry?.process, entry?.level, entry?.fields, entry?.cause],
      ['main', 'error', { exitCode: '3', run: '1' }, 'at %USERPROFILE%\\core.js'],
    )

    assert.deepStrictEqual(shared, entry === undefined ? [] : [entry])
  })

  it('keeps the last lines of output across chunks', () => {
    const tail = outputTail(2)

    tail.push('one\ntw')
    tail.push('o\nthree\nfou')

    assert.strictEqual(tail.take(), 'two\nthree\nfou')
    assert.strictEqual(tail.take(), '')
  })
})
