import { describe, expect, it } from '@effect/vitest'
import { replyBlocks } from './replyBlocks'

describe('replyBlocks', () => {
  it('splits prose into paragraphs and lists', () => {
    expect(
      replyBlocks(
        'One nuance:\nit is polite.\n\n- みたいです: it sounds like\n- 多い: often\nThat is all.',
      ),
    ).toEqual([
      { kind: 'paragraph', line: 0, text: 'One nuance:\nit is polite.' },
      {
        kind: 'list',
        line: 3,
        items: [
          { line: 3, text: 'みたいです: it sounds like' },
          { line: 4, text: '多い: often' },
        ],
      },
      { kind: 'paragraph', line: 5, text: 'That is all.' },
    ])
  })

  it('gives text between backtick lines its own block', () => {
    expect(
      replyBlocks(
        'A polite reply:\n```\nありがとうございます！\n```\nThank you! It keeps the tone polite.',
      ),
    ).toEqual([
      { kind: 'paragraph', line: 0, text: 'A polite reply:' },
      { kind: 'copy', line: 1, text: 'ありがとうございます！' },
      { kind: 'paragraph', line: 4, text: 'Thank you! It keeps the tone polite.' },
    ])
  })

  it('shows a block that is still being written', () => {
    expect(replyBlocks('Try this:\n```text\nありがと')).toEqual([
      { kind: 'paragraph', line: 0, text: 'Try this:' },
      { kind: 'copy', line: 1, text: 'ありがと' },
    ])
  })

  it('drops an empty block', () => {
    expect(replyBlocks('Here:\n```\n\n```')).toEqual([
      { kind: 'paragraph', line: 0, text: 'Here:' },
    ])
  })
})
