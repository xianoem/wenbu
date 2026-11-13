import { assert, describe, it } from '@effect/vitest'
import { DateTime } from 'effect'
import type { LogEntry } from './Diagnostics'
import { formatLogEntry, parseLogText, redactHome } from './LogText'

const entry: LogEntry = {
  at: DateTime.toEpochMillis(DateTime.makeUnsafe('2026-10-25T11:03:12.123Z')),
  level: 'warn',
  process: 'core',
  run: 2,
  feature: 'overlay',
  message: 'Hook text dropped',
  fields: { pid: '1234', reason: 'two words', empty: '' },
}

describe('LogText', () => {
  it('writes one readable line per entry', () => {
    assert.strictEqual(
      formatLogEntry(entry),
      '2026-10-25T11:03:12.123Z WARN  core#2 overlay "Hook text dropped" pid=1234 reason="two words" empty=""',
    )
  })

  it('indents the cause under its entry', () => {
    const line = formatLogEntry({ ...entry, level: 'error', cause: 'Error: boom\n  at run' })

    assert.strictEqual(line.split('\n').slice(1).join('\n'), '    Error: boom\n      at run')
  })

  it('reads back what it writes', () => {
    const second: LogEntry = {
      ...entry,
      at: entry.at + 5,
      level: 'error',
      process: 'main',
      run: 0,
      message: 'Said "hi" = done',
      cause: 'Error: boom\n  at run',
    }

    const text = `${formatLogEntry(entry)}\n${formatLogEntry(second)}\n`

    assert.deepStrictEqual(parseLogText(text), [entry, second])
  })

  it('skips lines it does not recognize', () => {
    assert.deepStrictEqual(parseLogText(`garbage\n${formatLogEntry(entry)}\n`), [entry])
  })

  it('hides the home folder in any slash style or case', () => {
    assert.strictEqual(
      redactHome('C:\\Users\\Ana', 'at c:\\users\\ana\\game and C:/Users/Ana/x'),
      'at %USERPROFILE%\\game and %USERPROFILE%/x',
    )
  })
})
