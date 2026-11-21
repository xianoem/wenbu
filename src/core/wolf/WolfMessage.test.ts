import { describe, expect, it } from '@effect/vitest'
import { composeMessage, parseMessage } from './WolfMessage'

describe('parseMessage', () => {
  it('splits a message into its code lines, speaker and indented body', () => {
    const text = '@10\n冬子：\n　　はい、お願いします。\n　　荷物運び助かりました。\n'

    expect(parseMessage(text)).toEqual({
      head: '@10',
      before: '',
      speaker: '冬子',
      after: '：',
      indent: '　　',
      body: 'はい、お願いします。\n荷物運び助かりました。',
      tail: '\n',
    })
  })

  it('reads narration, which has no speaker', () => {
    expect(parseMessage('@1\n　　そこまで理解できているが脱出する力はない。')).toMatchObject({
      head: '@1',
      speaker: '',
      body: 'そこまで理解できているが脱出する力はない。',
      tail: '',
    })
  })

  it('reads a bracketed speaker and keeps codes inside the body', () => {
    expect(parseMessage('【リナ】\n\\c[2]鍵\\c[0]を拾った。')).toMatchObject({
      head: '',
      before: '【',
      speaker: 'リナ',
      after: '】',
      body: '\\c[2]鍵\\c[0]を拾った。',
    })
  })

  it('treats a lone short line as the body, not as a speaker', () => {
    expect(parseMessage('はい：')).toMatchObject({ speaker: '', body: 'はい：' })
  })

  it('gives up on a message it could not write back unchanged', () => {
    expect(parseMessage('@1\n')).toBeUndefined()
    expect(parseMessage('　　あ\n　　\n　　い')).toBeUndefined()
  })
})

describe('composeMessage', () => {
  it('writes an unchanged message back exactly', () => {
    const text = '@90\n小柄：\n　　あ、あれ･････。\n　　冬子さんの方から･･･キスしたぞ･･･。\n'
    const parsed = parseMessage(text)

    expect(parsed === undefined ? undefined : composeMessage(parsed)).toBe(text)
  })

  it('indents new body lines and gives a translated speaker a plain colon', () => {
    const parsed = parseMessage('@10\n冬子：\n　　はい、お願いします。\n')

    expect(
      parsed === undefined
        ? undefined
        : composeMessage({ ...parsed, speaker: 'Fuyuko' }, ['Yes, please.', 'Thank you.']),
    ).toBe('@10\nFuyuko:\n　　Yes, please.\n　　Thank you.\n')
  })
})
