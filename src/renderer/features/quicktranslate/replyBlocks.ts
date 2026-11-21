export interface ReplyLine {
  readonly line: number
  readonly text: string
}

export type ReplyBlock =
  | ({ readonly kind: 'paragraph' } & ReplyLine)
  | { readonly kind: 'list'; readonly line: number; readonly items: ReadonlyArray<ReplyLine> }
  | ({ readonly kind: 'copy' } & ReplyLine)

const fence = /^\s*```/

const listItem = /^\s*[-•]\s+/

const proseBlocks = (lines: ReadonlyArray<ReplyLine>): ReadonlyArray<ReplyBlock> => {
  const blocks: Array<ReplyBlock> = []
  let paragraph: Array<ReplyLine> = []
  let items: Array<ReplyLine> = []

  const flush = () => {
    const first = paragraph[0]

    if (first !== undefined) {
      const text = paragraph.map((entry) => entry.text).join('\n')

      blocks.push({ kind: 'paragraph', line: first.line, text })
      paragraph = []
    }

    const firstItem = items[0]

    if (firstItem !== undefined) {
      blocks.push({ kind: 'list', line: firstItem.line, items })
      items = []
    }
  }

  for (const entry of lines) {
    if (entry.text.trim() === '') {
      flush()

      continue
    }

    if (listItem.test(entry.text)) {
      if (paragraph.length > 0) {
        flush()
      }

      items.push({ line: entry.line, text: entry.text.replace(listItem, '') })

      continue
    }

    if (items.length > 0) {
      flush()
    }

    paragraph.push({ line: entry.line, text: entry.text.trim() })
  }

  flush()

  return blocks
}

const copyBlock = (lines: ReadonlyArray<ReplyLine>, start: number): ReplyBlock => ({
  kind: 'copy',
  line: start,
  text: lines
    .map((entry) => entry.text)
    .join('\n')
    .trim(),
})

export const replyBlocks = (reply: string): ReadonlyArray<ReplyBlock> => {
  const blocks: Array<ReplyBlock> = []
  let prose: Array<ReplyLine> = []
  let copy: { readonly start: number; readonly lines: Array<ReplyLine> } | undefined

  for (const [line, text] of reply.split('\n').entries()) {
    if (fence.test(text)) {
      if (copy === undefined) {
        blocks.push(...proseBlocks(prose))
        prose = []
        copy = { start: line, lines: [] }
      } else {
        blocks.push(copyBlock(copy.lines, copy.start))
        copy = undefined
      }

      continue
    }

    if (copy === undefined) {
      prose.push({ line, text })
    } else {
      copy.lines.push({ line, text })
    }
  }

  blocks.push(...proseBlocks(prose))

  if (copy !== undefined) {
    blocks.push(copyBlock(copy.lines, copy.start))
  }

  return blocks.filter((block) => block.kind !== 'copy' || block.text !== '')
}
