import { describe, expect, it } from '@effect/vitest'
import { isCheckPage } from './checkPages'

describe('isCheckPage', () => {
  it('knows Cloudflare’s check', () => {
    expect(
      isCheckPage(403, new Headers({ server: 'cloudflare' }), '<title>Just a moment...</title>'),
    ).toBe(true)
  })

  it('knows a site firewall that answers with a probe script', () => {
    expect(
      isCheckPage(
        202,
        new Headers({ 'x-waf-uuid': '9717856948483256207' }),
        '<script src="/C2WF946J0/probe.js?v=vc1jasc"></script><body></body>',
      ),
    ).toBe(true)
  })

  it('lets real pages through', () => {
    expect(isCheckPage(200, new Headers({ server: 'cloudflare' }), '<title>剑烛大荒</title>')).toBe(
      false,
    )

    expect(isCheckPage(404, new Headers(), 'Not found')).toBe(false)
  })
})
