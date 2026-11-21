/**
 * A WOLF RPG message split the way games lay them out: lines of codes the game reads (like `@10`
 * for a face), a speaker line, then the body, which is usually indented under the speaker.
 */
export interface WolfMessage {
  readonly head: string
  readonly before: string
  readonly speaker: string
  readonly after: string
  readonly indent: string
  readonly body: string
  readonly tail: string
}

const codeLine = /^(?:@\d+|\s*(?:\\[A-Za-z]+(?:\[[^\]]*\])?\s*)+)$/

const speakerPatterns: ReadonlyArray<RegExp> = [
  /^()([^\s　【】[\]：:]{1,16})([：:])$/,
  /^(【)([^【】]{1,16})(】)$/,
]

const isBlank = (line: string) => line.trim() === ''

const speakerOf = (line: string | undefined) => {
  for (const pattern of speakerPatterns) {
    const match = line === undefined ? null : pattern.exec(line)

    if (match !== null) {
      return { before: match[1] ?? '', speaker: match[2] ?? '', after: match[3] ?? '' }
    }
  }

  return undefined
}

const leadingSpace = (line: string) => /^[\s　]*/.exec(line)?.[0] ?? ''

const commonIndent = (lines: ReadonlyArray<string>) => {
  const indents = lines.filter((line) => !isBlank(line)).map(leadingSpace)

  return indents.reduce((shared, indent) => {
    let length = 0

    while (length < shared.length && shared[length] === indent[length]) {
      length++
    }

    return shared.slice(0, length)
  }, indents[0] ?? '')
}

const isLatinName = (name: string) => /[A-Za-z]/.test(name) && !/[぀-ヿ㐀-鿿가-힯]/.test(name)

const speakerLine = (message: WolfMessage) => {
  const after = message.after === '：' && isLatinName(message.speaker) ? ':' : message.after

  return `${message.before}${message.speaker}${after}`
}

/** Writes a message back, with its body replaced by `bodyLines` when given. */
export const composeMessage = (message: WolfMessage, bodyLines?: ReadonlyArray<string>) => {
  const body = (bodyLines ?? message.body.split('\n')).map((line) =>
    line === '' ? '' : `${message.indent}${line}`,
  )

  const lines = [
    ...(message.head === '' ? [] : message.head.split('\n')),
    ...(message.speaker === '' ? [] : [speakerLine(message)]),
    ...body,
  ]

  return `${lines.join('\n')}${message.tail}`
}

// Games often end a message with an indented empty line, which is kept as it is.
const split = (text: string) => {
  const all = text.split('\n')
  let end = all.length

  while (end > 0 && isBlank(all[end - 1] ?? '')) {
    end--
  }

  const lines = all.slice(0, end)

  return { lines, tail: text.slice(lines.join('\n').length) }
}

/** Splits a message, or gives `undefined` when the parts would not write it back unchanged. */
export const parseMessage = (text: string): WolfMessage | undefined => {
  const { lines, tail } = split(text)
  let start = 0

  while (start < lines.length && codeLine.test(lines[start] ?? '')) {
    start++
  }

  const named = speakerOf(lines[start])
  const hasBodyAfter = lines.slice(start + 1).some((line) => !isBlank(line))
  const speaker = named !== undefined && hasBodyAfter ? named : undefined
  const bodyLines = lines.slice(start + (speaker === undefined ? 0 : 1))

  if (!bodyLines.some((line) => !isBlank(line))) {
    return undefined
  }

  const indent = commonIndent(bodyLines)

  const message: WolfMessage = {
    head: lines.slice(0, start).join('\n'),
    before: speaker?.before ?? '',
    speaker: speaker?.speaker ?? '',
    after: speaker?.after ?? '',
    indent,
    body: bodyLines.map((line) => (isBlank(line) ? '' : line.slice(indent.length))).join('\n'),
    tail,
  }

  return composeMessage(message) === text ? message : undefined
}
