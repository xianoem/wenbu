import { describe, expect, it } from '@effect/vitest'
import type { ReleaseChange } from '#contract/Updates'
import { fixesOf, newByArea, splitReleases } from './releaseSections'

const changes: ReadonlyArray<ReleaseChange> = [
  { kind: 'new', area: 'details', text: 'DLsite works open in a dialog' },
  { kind: 'fixed', area: 'overlay', text: 'Overlay keeps its position' },
  { kind: 'new', area: 'novels', text: 'Novels with a reader' },
  { kind: 'new', area: 'details', text: 'Lists filter by game type' },
]

describe('releaseSections', () => {
  it('gathers what is new under each area', () => {
    expect(newByArea(changes)).toEqual([
      { area: 'details', texts: ['DLsite works open in a dialog', 'Lists filter by game type'] },
      { area: 'novels', texts: ['Novels with a reader'] },
    ])
  })

  it('lists the fixes on their own', () => {
    expect(fixesOf(changes)).toEqual(['Overlay keeps its position'])
  })

  it('opens every release since the one last seen and folds the rest away', () => {
    const release = (version: string) => ({ version, date: '2026-11-13', changes: [] })
    const releases = [release('0.3.0'), release('0.2.1'), release('0.2.0'), release('0.1.0')]

    const versions = (list: ReadonlyArray<{ readonly version: string }>) =>
      list.map((entry) => entry.version)

    const updated = splitReleases({
      version: '0.3.0',
      updatedFrom: '0.2.0',
      releases,
      newAreas: [],
    })

    const seen = splitReleases({ version: '0.3.0', releases, newAreas: [] })

    expect(versions(updated.opened)).toEqual(['0.3.0', '0.2.1'])
    expect(versions(updated.earlier)).toEqual(['0.2.0', '0.1.0'])
    expect(versions(seen.opened)).toEqual(['0.3.0'])
    expect(versions(seen.earlier)).toEqual(['0.2.1', '0.2.0', '0.1.0'])
  })
})
