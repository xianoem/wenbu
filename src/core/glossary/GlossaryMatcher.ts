import { simplified, traditional } from './simplifiedForms'

const simplifiedOf = new Map(
  [...traditional].map((character, index) => [character, simplified[index] ?? character]),
)

export const fold = (text: string) => {
  let folded = ''

  for (const character of text) {
    folded += simplifiedOf.get(character) ?? character
  }

  return folded
}

export interface MatchTerm {
  readonly id: string
  readonly patterns: ReadonlyArray<string>
}

export interface TermMatch {
  readonly id: string
  readonly start: number
  readonly end: number
}

interface Node {
  readonly next: Map<string, number>
  fail: number
  output: { readonly id: string; readonly length: number } | undefined
}

export const makeMatcher = (terms: ReadonlyArray<MatchTerm>) => {
  const nodes: Array<Node> = [{ next: new Map(), fail: 0, output: undefined }]

  for (const term of terms) {
    for (const pattern of term.patterns) {
      const characters = [...fold(pattern)]

      if (characters.length === 0) {
        continue
      }

      let at = 0

      for (const character of characters) {
        const found = nodes[at]?.next.get(character)

        if (found === undefined) {
          nodes.push({ next: new Map(), fail: 0, output: undefined })
          nodes[at]?.next.set(character, nodes.length - 1)
          at = nodes.length - 1
        } else {
          at = found
        }
      }

      const node = nodes[at]

      if (node !== undefined && (node.output?.length ?? 0) < characters.length) {
        node.output = { id: term.id, length: characters.length }
      }
    }
  }

  const queue: Array<number> = [...(nodes[0]?.next.values() ?? [])]

  while (queue.length > 0) {
    const at = queue.shift() ?? 0
    const node = nodes[at]

    if (node === undefined) {
      continue
    }

    for (const [character, child] of node.next) {
      let fail = node.fail

      while (fail !== 0 && nodes[fail]?.next.has(character) !== true) {
        fail = nodes[fail]?.fail ?? 0
      }

      const target = nodes[fail]?.next.get(character)
      const childNode = nodes[child]

      if (childNode !== undefined) {
        childNode.fail = target !== undefined && target !== child ? target : 0
        childNode.output ??= nodes[childNode.fail]?.output
      }

      queue.push(child)
    }
  }

  const find = (text: string): ReadonlyArray<TermMatch> => {
    const characters = [...fold(text)]
    const offsets: Array<number> = []
    let offset = 0

    for (const character of characters) {
      offsets.push(offset)
      offset += character.length
    }

    offsets.push(offset)

    const candidates: Array<TermMatch> = []
    let at = 0

    for (const [index, character] of characters.entries()) {
      while (at !== 0 && nodes[at]?.next.has(character) !== true) {
        at = nodes[at]?.fail ?? 0
      }

      at = nodes[at]?.next.get(character) ?? 0

      for (let state = at; state !== 0; state = nodes[state]?.fail ?? 0) {
        const output = nodes[state]?.output

        if (output !== undefined) {
          candidates.push({
            id: output.id,
            start: offsets[index + 1 - output.length] ?? 0,
            end: offsets[index + 1] ?? 0,
          })
        }
      }
    }

    candidates.sort((left, right) => left.start - right.start || right.end - left.end)

    const matches: Array<TermMatch> = []
    let end = 0

    for (const candidate of candidates) {
      if (candidate.start >= end) {
        matches.push(candidate)
        end = candidate.end
      }
    }

    return matches
  }

  return { find }
}

export type GlossaryMatcher = ReturnType<typeof makeMatcher>
