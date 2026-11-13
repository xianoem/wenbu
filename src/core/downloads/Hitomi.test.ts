import { assert, describe, it } from '@effect/vitest'
import { Option } from 'effect'
import { imageUrl, parseImageServers } from './Hitomi'

const script = `'use strict';
gg = { m: function(g) {
var o = 1;
switch (g) {
case 2939:
case 3696:
o = 0; break;
}
return o;
},
s: function(h) { var m = /(..)(.)$/.exec(h); return parseInt(m[2]+m[1], 16).toString(10); },
b: '1792872002/'
};`

describe('Hitomi', () => {
  it('reads the image servers from gg.js', () => {
    const servers = Option.getOrThrow(parseImageServers(script))

    assert.strictEqual(servers.base, '1792872002')
    assert.strictEqual(servers.fallback, 1)
    assert.strictEqual(servers.offsets.get(3696), 0)
  })

  it('builds the full-size WebP link the way hitomi.la does', () => {
    const servers = Option.getOrThrow(parseImageServers(script))
    const hash = '01f6a4aa5451b71522657eae2c1350ae3dc206a394789f3e6bca631ddb3bf70e'

    assert.strictEqual(
      imageUrl(servers, hash),
      `https://w1.gold-usergeneratedcontent.net/1792872002/3696/${hash}.webp`,
    )

    assert.strictEqual(
      imageUrl(servers, 'aaa0ff'),
      'https://w2.gold-usergeneratedcontent.net/1792872002/3855/aaa0ff.webp',
    )
  })

  it('fails when the script lost its path prefix', () => {
    assert.isTrue(Option.isNone(parseImageServers('gg = {}')))
  })
})
