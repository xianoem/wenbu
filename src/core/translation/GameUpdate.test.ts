import { describe, expect, it } from '@effect/vitest'
import type { ZipEntry } from '../platform/ZipIndex'
import { planUpdate, type UpdatePlanInput, versionOf } from './GameUpdate'

const entry = (name: string, size = 10): ZipEntry => ({
  name,
  size,
  compressedSize: size,
  method: 0,
  encrypted: false,
  directory: name.endsWith('/'),
  offset: 0,
  modifiedAt: Date.UTC(2026, 9, 20),
})

const existing = new Set([
  'game.exe',
  'www/data/system.json',
  'www/data/map001.json',
  'www/js/plugins.js',
  'www/save/file1.rpgsave',
])

const input = (overrides: Partial<UpdatePlanInput>): UpdatePlanInput => ({
  archiveName: 'RJ01234567_虚ろ社の灯籠_ver1.05.zip',
  engine: 'rpg-maker-mv',
  entries: [],
  existing,
  gameTitle: '虚ろ社の灯籠',
  zipTitle: '虚ろ社の灯籠',
  installedVersion: '1.02',
  ...overrides,
})

const statuses = (plan: ReturnType<typeof planUpdate>) =>
  Object.fromEntries(plan.checks.map((check) => [check.id, check.status]))

const full = [
  entry('虚ろ社の灯籠_ver1.05/'),
  entry('虚ろ社の灯籠_ver1.05/Game.exe'),
  entry('虚ろ社の灯籠_ver1.05/www/data/System.json'),
  entry('虚ろ社の灯籠_ver1.05/www/data/Map001.json', 100),
  entry('虚ろ社の灯籠_ver1.05/www/data/Map031.json', 50),
  entry('虚ろ社の灯籠_ver1.05/www/save/file1.rpgsave'),
  entry('readme.txt'),
]

describe('planUpdate', () => {
  it('maps a full update in its own folder onto the game, skipping saves', () => {
    const plan = planUpdate(input({ entries: full }))

    expect(plan.root).toBe('虚ろ社の灯籠_ver1.05/')
    expect(plan.version).toBe('1.05')

    expect(plan.files.map((file) => file.path)).toEqual([
      'Game.exe',
      'www/data/System.json',
      'www/data/Map001.json',
      'www/data/Map031.json',
    ])

    expect([plan.replaced, plan.added, plan.saves, plan.bytes]).toEqual([3, 1, 1, 170])

    expect(statuses(plan)).toEqual({
      'same-game': 'ok',
      fits: 'ok',
      safe: 'ok',
      newer: 'ok',
      saves: 'warning',
    })

    expect(plan.blocked).toBe(false)
  })

  it('blocks a zip of another game', () => {
    const plan = planUpdate(input({ entries: full, zipTitle: '月夜の迷宮' }))

    expect(statuses(plan)['same-game']).toBe('blocked')

    expect(plan.checks.find((check) => check.id === 'same-game')?.detail).toBe(
      'The zip holds 月夜の迷宮, not 虚ろ社の灯籠.',
    )

    expect(plan.blocked).toBe(true)
  })

  it('blocks paths that leave the folder and programs the game does not have', () => {
    const escaping = planUpdate(
      input({ entries: [...full, entry('虚ろ社の灯籠_ver1.05/../evil.txt')] }),
    )

    const program = planUpdate(
      input({ entries: [...full, entry('虚ろ社の灯籠_ver1.05/helper.exe')] }),
    )

    expect([statuses(escaping).safe, statuses(program).safe]).toEqual(['blocked', 'blocked'])

    expect(program.checks.find((check) => check.id === 'safe')?.detail).toBe(
      'It adds a program the game doesn’t have: helper.exe',
    )
  })

  it('warns about an older version but still allows it', () => {
    const plan = planUpdate(input({ entries: full, installedVersion: '1.10' }))

    expect(statuses(plan).newer).toBe('warning')
    expect(plan.blocked).toBe(false)
  })

  it('accepts a patch with only some files when the game already has them', () => {
    const patch = planUpdate(
      input({
        entries: [entry('www/data/Map001.json')],
        zipTitle: undefined,
        archiveName: 'patch.zip',
      }),
    )

    const stranger = planUpdate(
      input({ entries: [entry('stuff/Map099.json')], zipTitle: undefined, archiveName: 'x.zip' }),
    )

    expect([patch.root, statuses(patch)['same-game'], patch.blocked]).toEqual(['', 'ok', false])
    expect([statuses(stranger).fits, stranger.blocked]).toEqual(['blocked', true])
  })
})

describe('versionOf', () => {
  it('reads versions the way authors write them in file names', () => {
    expect(
      ['game_ver1.05.zip', 'Game v2.1.3.zip', '虚ろ社の灯籠 1.2版.zip', 'RJ01234567.zip'].map(
        versionOf,
      ),
    ).toEqual(['1.05', '2.1.3', '1.2', undefined])
  })
})
