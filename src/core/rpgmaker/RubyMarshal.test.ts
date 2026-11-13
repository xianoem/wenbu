import { describe, expect, it } from '@effect/vitest'
import { decodeRubyMarshal, encodeRubyMarshal } from './RubyMarshal'

const text = (value: string) => [...Buffer.from(value)]

describe('RubyMarshal', () => {
  it('decodes RPG Maker object graphs into editable records', () => {
    const encoded = Uint8Array.from([
      0x04,
      0x08,
      0x6f,
      0x3a,
      0x0d,
      ...text('RPG::Map'),
      0x07,
      0x3a,
      0x12,
      ...text('@display_name'),
      0x49,
      0x22,
      0x08,
      ...text('森'),
      0x06,
      0x3a,
      0x06,
      ...text('E'),
      0x54,
      0x3a,
      0x0c,
      ...text('@events'),
      0x5b,
      0x07,
      0x30,
      0x6f,
      0x3a,
      0x0f,
      ...text('RPG::Event'),
      0x06,
      0x3a,
      0x0b,
      ...text('@pages'),
      0x5b,
      0x06,
      0x6f,
      0x3a,
      0x15,
      ...text('RPG::Event::Page'),
      0x06,
      0x3a,
      0x0a,
      ...text('@list'),
      0x5b,
      0x06,
      0x6f,
      0x3a,
      0x16,
      ...text('RPG::EventCommand'),
      0x07,
      0x3a,
      0x0a,
      ...text('@code'),
      0x69,
      0x02,
      0x91,
      0x01,
      0x3a,
      0x10,
      ...text('@parameters'),
      0x5b,
      0x06,
      0x49,
      0x22,
      0x14,
      ...text('こんにちは'),
      0x06,
      0x3a,
      0x06,
      ...text('E'),
      0x54,
    ])

    expect(decodeRubyMarshal(encoded)).toEqual({
      __rubyClass: 'RPG::Map',
      display_name: '森',
      events: [
        null,
        {
          __rubyClass: 'RPG::Event',
          pages: [
            {
              __rubyClass: 'RPG::Event::Page',
              list: [{ __rubyClass: 'RPG::EventCommand', code: 401, parameters: ['こんにちは'] }],
            },
          ],
        },
      ],
    })
  })

  it('round-trips objects, floats, large integers and nested arrays', () => {
    const value = {
      __rubyClass: 'RPG::MoveCommand',
      code: 45,
      parameters: [1.5, -300, 70_000, -70_000, 1_000_000_000, 'Hello', true, false, null],
    }

    expect(decodeRubyMarshal(encodeRubyMarshal(value))).toEqual(value)
  })

  it('follows object links to earlier values', () => {
    const encoded = Uint8Array.from([
      0x04,
      0x08,
      0x5b,
      0x07,
      0x66,
      0x08,
      ...text('1.5'),
      0x40,
      0x06,
    ])

    expect(decodeRubyMarshal(encoded)).toEqual([1.5, 1.5])
  })

  it('keeps binary byte strings as bytes when asked', () => {
    const payload = Buffer.from([0x78, 0x9c, 0x00, 0xff, 0xfe, 0x01, 0x9d, 0x80])

    const decoded = decodeRubyMarshal(encodeRubyMarshal([27, 'Scripts', payload]), {
      binaryStrings: true,
    })

    expect(decoded).toEqual([27, 'Scripts', payload])
  })

  it('decodes invalid UTF-8 lossily by default', () => {
    expect(decodeRubyMarshal(encodeRubyMarshal([Buffer.from([0xff, 0xfe])]))).toEqual(['��'])
  })

  it('writes numeric hash keys as fixnums, as VX Ace MapInfos expects', () => {
    const encoded = encodeRubyMarshal({ 1: { __rubyClass: 'RPG::MapInfo', name: 'Town' } })

    expect(encoded[4]).toBe('i'.charCodeAt(0))
    expect(encoded[5]).toBe(6)
    expect(decodeRubyMarshal(encoded)).toEqual({ 1: { __rubyClass: 'RPG::MapInfo', name: 'Town' } })
  })

  it('rejects other Marshal versions', () => {
    expect(() => decodeRubyMarshal(Uint8Array.from([0x04, 0x07, 0x30]))).toThrow('version')
  })
})
