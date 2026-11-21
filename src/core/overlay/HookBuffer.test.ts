import { describe, expect, it } from '@effect/vitest'
import { hookBufferSize, newestPush } from './HookBuffer'

const previous = '理央：\n　　島が見えてきた。\n'
const next = '平太：\n　　やっと着いたな。\n'

const copiesOver = (text: string, size: number) => Math.ceil(size / text.length) + 1

describe('newestPush', () => {
  it('leaves text that fits in the buffer alone, even when it repeats', () => {
    expect(newestPush('あはは、あはは、あはは')).toBe('あはは、あはは、あはは')
    expect(newestPush(next.repeat(3))).toBe(next.repeat(3))
  })

  it('keeps one copy of a line the game kept redrawing', () => {
    expect(newestPush(next.repeat(copiesOver(next, hookBufferSize)))).toBe(next)
  })

  it('drops the previous line that was still on screen when the buffer filled', () => {
    expect(newestPush(previous + next.repeat(copiesOver(next, hookBufferSize)))).toBe(next)
    expect(newestPush(previous.repeat(20) + next.repeat(60))).toBe(next)
  })

  it('finds the new line when it arrived only once at the end', () => {
    const line = '冬子：\n　　大丈夫……'

    expect(newestPush(previous.repeat(copiesOver(previous, hookBufferSize)) + line)).toBe(line)
  })

  it('handles lines drawn without a separator between copies', () => {
    const before = '理央：「島が見えてきた。」'
    const after = '平太：「やっと着いたな。」'

    expect(newestPush(before.repeat(30) + after.repeat(60))).toBe(after)
  })

  it('leaves long text that is not made of repeated lines alone', () => {
    const page = Array.from({ length: hookBufferSize + 200 }, (_, index) =>
      String.fromCodePoint(0x4e00 + ((index * 7919) % 20_000)),
    ).join('')

    expect(newestPush(page)).toBe(page)
    expect(newestPush(`${page}……`)).toBe(`${page}……`)
  })
})
