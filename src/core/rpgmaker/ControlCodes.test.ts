import { describe, expect, it } from '@effect/vitest'
import { isControlCodesOnly, promptTextOf, restoreEdgeCodes } from './ControlCodes'

describe('ControlCodes', () => {
  it('treats numbered codes such as a face code as control codes', () => {
    expect(isControlCodesOnly('\\F1[u6]・\\!・\\!・\\!')).toBe(false)
    expect(isControlCodesOnly('\\F1[u6]\\AA[1]')).toBe(true)
    expect(isControlCodesOnly('\\C[2]\\.')).toBe(true)
    expect(isControlCodesOnly('\\C[2]はい')).toBe(false)
  })

  it('sends the model the text without the codes at its start and end', () => {
    expect(promptTextOf('\\AA[1]\\F1[a1]あ、どうも～。\\!いらっしゃい！')).toBe(
      'あ、どうも～。\\!いらっしゃい！',
    )

    expect(promptTextOf('\\F1[r3]うーん。\n\\!腰か？\\FH[OFF]')).toBe('うーん。\n\\!腰か？')
  })

  it('keeps the codes when the text between them has codes of its own', () => {
    expect(promptTextOf('\\C[16]精神回復度\\c[0]が上昇した。')).toBe(
      '\\C[16]精神回復度\\c[0]が上昇した。',
    )
  })

  it('keeps text that is nothing but codes', () => {
    expect(promptTextOf('\\F1[a1]\\AA[1]')).toBe('\\F1[a1]\\AA[1]')
  })

  it('puts the codes back around the translated text', () => {
    expect(restoreEdgeCodes('\\AA[1]\\F1[a1]あ、どうも～。\\FH[OFF]', 'Oh, hello~.')).toBe(
      '\\AA[1]\\F1[a1]Oh, hello~.\\FH[OFF]',
    )
  })

  it('leaves a reply that already carries the codes as it is', () => {
    expect(
      restoreEdgeCodes(
        '\\AA[1]\\F1[a1]さ、食べようか。\\FH[OFF]',
        '\\AA[1]\\F1[a1]Let us eat.\\FH[OFF]',
      ),
    ).toBe('\\AA[1]\\F1[a1]Let us eat.\\FH[OFF]')

    expect(restoreEdgeCodes('\\C[16]精神\\c[0]が上昇', 'Mind \\C[16]up\\c[0]')).toBe(
      'Mind \\C[16]up\\c[0]',
    )
  })

  it('leaves text without edge codes alone', () => {
    expect(promptTextOf('こんにちは')).toBe('こんにちは')
    expect(restoreEdgeCodes('こんにちは', 'Hello')).toBe('Hello')
  })
})
