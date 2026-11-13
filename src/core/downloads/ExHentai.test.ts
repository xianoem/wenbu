import { assert, describe, it } from '@effect/vitest'
import { Option, Schema } from 'effect'
import {
  explainOriginalPage,
  hasExAccess,
  imageLimits,
  isSignedIn,
  parseGallery,
  parseImagePage,
} from './ExHentai'
import { ReducedQualityOnly, type Session, SourceProblem } from './GallerySource'

const session = (cookies: Record<string, string>): Option.Option<Session> =>
  Option.some({
    userAgent: 'Test',
    cookies: Object.entries(cookies).map(([name, value]) => ({
      name,
      value,
      domain: '.e-hentai.org',
    })),
  })

describe('ExHentai', () => {
  it('reads a gallery listing', () => {
    const listing = parseGallery(
      `<h1 id="gn">A &amp; B</h1><h1 id="gj"></h1>
       <td class="gdt1">Length:</td><td class="gdt2">45 pages</td>
       <div id="td_parody:zenless_zone_zero"></div><div id="td_artist:ursica"></div>
       <a href="https://e-hentai.org/s/a1d6257060/4279096-1"></a>
       <a href="https://e-hentai.org/s/8280032242/4279096-2"></a>
       <a href="https://e-hentai.org/s/0000000000/1-2"></a>`,
      '4279096',
    )

    assert.deepStrictEqual(listing.title, Option.some('A & B'))
    assert.isTrue(Option.isNone(listing.titleJapanese))
    assert.strictEqual(listing.length, 45)
    assert.deepStrictEqual(listing.tags, ['parody:zenless zone zero', 'artist:ursica'])

    assert.deepStrictEqual(listing.links, [
      [1, 'a1d6257060'],
      [2, '8280032242'],
    ])
  })

  it('finds the resampled image and the original on an image page', () => {
    const page = parseImagePage(
      `<img id="img" src="https://x.hath.network/h/key/1.webp" />
       <a href="https://e-hentai.org/fullimg/4279096/1/f98vmc2ao9w/1.jpg?a=1&amp;b=2">Download original 2290 x 3028 5.35 MiB source</a>`,
    )

    assert.deepStrictEqual(page.image, Option.some('https://x.hath.network/h/key/1.webp'))

    assert.deepStrictEqual(
      page.original,
      Option.some('/fullimg/4279096/1/f98vmc2ao9w/1.jpg?a=1&b=2'),
    )
  })

  it('tells a missing-GP page apart from a ban', () => {
    const gp = explainOriginalPage('Downloading original files of this gallery requires GP')
    const ban = explainOriginalPage('Your IP address has been temporarily banned')

    assert.isTrue(Schema.is(ReducedQualityOnly)(gp))
    assert.isTrue(Schema.is(SourceProblem)(ban) && ban.reason === 'limit')
  })

  it('needs both member cookies to count as signed in', () => {
    assert.isTrue(isSignedIn(session({ ipb_member_id: '1', ipb_pass_hash: 'x' })))
    assert.isFalse(isSignedIn(session({ ipb_member_id: '1' })))
    assert.isFalse(hasExAccess(session({ igneous: 'mystery' })))
    assert.isTrue(hasExAccess(session({ igneous: '1a2b' })))
  })

  it('reads the image limits however home.php words them', () => {
    assert.deepStrictEqual(
      imageLimits(
        '<p>You are currently at <strong>1,240</strong> towards a limit of <strong>5,000</strong>.</p>',
      ),
      Option.some('Image limits 1,240 of 5,000'),
    )

    assert.deepStrictEqual(
      imageLimits(
        '<h2>Image Limits</h2><p>Used: <strong>12</strong> / <strong>10,000</strong></p>',
      ),
      Option.some('Image limits 12 of 10,000'),
    )

    assert.isTrue(Option.isNone(imageLimits('<p>Welcome back</p>')))
  })
})
