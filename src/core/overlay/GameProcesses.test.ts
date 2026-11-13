import { describe, expect, it } from '@effect/vitest'
import { descendantsOf, matchGameProcesses, type RunningProcess } from './GameProcesses'

const game = {
  executablePath: 'C:\\Games\\Aki\\Game.exe',
  folderPath: 'C:\\Games\\Aki',
}

const running = (pid: number, name: string, path: string, parentPid = 1): RunningProcess => ({
  pid,
  parentPid,
  name,
  path,
})

describe('matchGameProcesses', () => {
  it('ranks the game executable first, then its folder, subfolders and name matches', () => {
    const matches = matchGameProcesses(game, [
      running(10, 'Game.exe', 'D:\\Other\\Game.exe'),
      running(11, 'nw.exe', 'C:\\Games\\Aki\\bin\\nw.exe'),
      running(12, 'Helper.exe', 'c:\\games\\aki\\Helper.exe'),
      running(13, 'Game.exe', 'C:/Games/Aki/Game.exe'),
      running(14, 'explorer.exe', 'C:\\Windows\\explorer.exe'),
    ])

    expect(matches.map((match) => match.processId)).toEqual([13, 12, 11, 10])
    expect(matches[0]?.matchReason).toBe('Executable path matches this game.')
  })

  it('leaves out Wenbu itself', () => {
    expect(
      matchGameProcesses(game, [running(5, 'Game.exe', 'C:\\Games\\Aki\\Game.exe')], 5),
    ).toEqual([])
  })

  it('does not treat a sibling folder with the same prefix as the game folder', () => {
    expect(matchGameProcesses(game, [running(7, 'Tool.exe', 'C:\\Games\\Aki2\\Tool.exe')])).toEqual(
      [],
    )
  })
})

describe('descendantsOf', () => {
  it('finds children and grandchildren of the launched process', () => {
    const processes = [
      running(100, 'launcher.exe', 'C:\\Games\\Aki\\launcher.exe', 1),
      running(101, 'Game.exe', 'C:\\Games\\Aki\\Game.exe', 100),
      running(102, 'renderer.exe', 'C:\\Games\\Aki\\renderer.exe', 101),
      running(200, 'other.exe', 'C:\\other.exe', 1),
    ]

    expect([...descendantsOf([100], processes)].toSorted()).toEqual([101, 102])
  })
})
