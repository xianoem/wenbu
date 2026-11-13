import { describe, expect, it } from '@effect/vitest'
import { changesFrom, parseGitLog, releaseBody, withRelease } from './CommitNotes'

describe('CommitNotes', () => {
  it('turns feat and fix commits into changes, and skips the rest', () => {
    const changes = changesFrom([
      { subject: 'feat(novels): novels with chapter sources and a reader', body: '' },
      { subject: 'fix(overlay): overlay keeps its position after a resolution change', body: '' },
      { subject: 'refactor(core): split the settings store', body: '' },
      { subject: 'chore(release): v0.2.0', body: '' },
      { subject: 'Merge branch main', body: '' },
    ])

    expect(changes).toEqual([
      { kind: 'new', area: 'novels', text: 'Novels with chapter sources and a reader' },
      {
        kind: 'fixed',
        area: 'overlay',
        text: 'Overlay keeps its position after a resolution change',
      },
    ])
  })

  it('files scopes that name no feature under Wenbu itself', () => {
    const changes = changesFrom([
      { subject: 'feat: export diagnostics', body: '' },
      { subject: 'fix(ui): dialogs keep their focus', body: '' },
      { subject: 'feat(llm)!: presets pick a reasoning effort', body: '' },
    ])

    expect(changes.map((change) => change.area)).toEqual(['app', 'app', 'models'])
  })

  it('leaves out a commit whose body asks for it', () => {
    const changes = changesFrom([
      { subject: 'feat(updates): what is new', body: 'Details.\n\nRelease-note: skip' },
      { subject: 'fix(library): games sort by title', body: 'Release-note: Skip\n' },
      { subject: 'fix(library): covers load', body: 'Mentions Release-note: skip in passing' },
    ])

    expect(changes).toEqual([{ kind: 'fixed', area: 'library', text: 'Covers load' }])
  })

  it('reads the commits out of a git log', () => {
    const log = 'feat(manga): a\u001Fbody one\n\u001E\nfix: b\u001F\u001E\n'

    expect(parseGitLog(log)).toEqual([
      { subject: 'feat(manga): a', body: 'body one' },
      { subject: 'fix: b', body: '' },
    ])
  })

  it('puts a release first and replaces an earlier draft of the same version', () => {
    const older = { version: '0.1.0', date: '2026-10-01', changes: [] }
    const draft = { version: '0.2.0', date: '2026-11-01', changes: [] }
    const release = { version: '0.2.0', date: '2026-11-13', changes: [] }

    expect(withRelease([draft, older], release)).toEqual([release, older])
  })

  it('writes the release body for GitHub', () => {
    const body = releaseBody({
      version: '0.2.0',
      date: '2026-11-13',
      changes: [
        { kind: 'new', area: 'novels', text: 'Novels with a reader' },
        { kind: 'fixed', area: 'overlay', text: 'Overlay keeps its position' },
        { kind: 'new', area: 'retired-area', text: 'Something else' },
      ],
    })

    expect(body).toBe(
      [
        '## New',
        '',
        '- **Novels:** Novels with a reader',
        '- **Wenbu:** Something else',
        '',
        '## Fixed',
        '',
        '- **Translation Overlay:** Overlay keeps its position',
        '',
      ].join('\n'),
    )
  })

  it('says so when a release has no notable changes', () => {
    expect(releaseBody({ version: '0.2.1', date: '2026-11-14', changes: [] })).toBe(
      'Maintenance release.\n',
    )
  })
})
