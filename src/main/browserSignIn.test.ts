import { assert, describe, it } from '@effect/vitest'
import {
  browserArgs,
  browserCandidates,
  chromeAgent,
  isOnSites,
  siteCookies,
  storageExpression,
} from './browserSignIn'

describe('browserSignIn', () => {
  it('poses as the Chrome that Electron runs, naming neither Electron nor the app', () => {
    assert.strictEqual(
      chromeAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Wenbu/0.1.0 Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36',
        '156.0.8078.48',
      ),
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    )
  })

  it('looks for Chrome first, then Edge, where Windows installs them', () => {
    const candidates = browserCandidates('win32', {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    })

    assert.include(candidates[0], 'Chrome')
    assert.isTrue(candidates.some((path) => path.endsWith('msedge.exe')))

    assert.isTrue(
      candidates.indexOf(candidates.find((path) => path.endsWith('msedge.exe')) ?? '') > 1,
    )
  })

  it('opens the sign-in in a profile of its own with a debugging port', () => {
    const args = browserArgs('C:\\Wenbu\\sign-in\\hdoujin', 9555, 'https://hdoujin.org/')

    assert.include(args, '--user-data-dir=C:\\Wenbu\\sign-in\\hdoujin')
    assert.include(args, '--remote-debugging-port=9555')
    assert.strictEqual(args.at(-1), 'https://hdoujin.org/')
  })

  it("keeps only the source's own cookies", () => {
    const cookies = siteCookies(
      [
        { name: 'ipb_member_id', value: '1', domain: '.e-hentai.org' },
        { name: 'igneous', value: 'x', domain: 'exhentai.org' },
        { name: 'ad', value: 'y', domain: '.doubleclick.net' },
      ],
      ['e-hentai.org', 'exhentai.org'],
    )

    assert.deepStrictEqual(
      cookies.map((cookie) => cookie.name),
      ['ipb_member_id', 'igneous'],
    )
  })

  it('tells the source and its subdomains from other sites', () => {
    assert.isTrue(isOnSites('https://forums.e-hentai.org/index.php', ['e-hentai.org']))
    assert.isFalse(isOnSites('https://e-hentai.org.ads.example/', ['e-hentai.org']))
  })

  it('reads only the wanted localStorage keys', () => {
    assert.strictEqual(
      storageExpression(['clearance', "to'ken"]),
      "Object.fromEntries(['clearance', 'token'].flatMap((key) => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]] }))",
    )
  })
})
