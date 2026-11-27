// Face and picture plugins number their codes, as in \F1[a1].
const code = String.raw`\\[A-Za-z]+\d*\[[^\]]*\]|\\[A-Za-z{}.|!><^$]`

const anyCode = new RegExp(code, 'g')

const bracketedCode = /\\[A-Za-z]+\d*\[[^\]]*\]/

const leadingCodes = new RegExp(`^(?:${code})+`)

const trailingCodes = new RegExp(`(?:${code})+$`)

export const withoutControlCodes = (text: string) => text.replace(anyCode, '')

export const isControlCodesOnly = (text: string) => withoutControlCodes(text).trim() === ''

const edgesOf = (text: string) => {
  const head = leadingCodes.exec(text)?.[0] ?? ''
  const rest = text.slice(head.length)
  const tail = trailingCodes.exec(rest)?.[0] ?? ''

  return { head, body: rest.slice(0, rest.length - tail.length), tail }
}

const codesIn = (text: string) => text.match(anyCode) ?? []

// Models often drop the portrait and picture codes that open or close a line, so they never see them.
// A line whose own text has codes keeps them all, since they often pair with the ones at its edges.
export const promptTextOf = (text: string) => {
  const { body } = edgesOf(text)

  if (body.trim() === '' || bracketedCode.test(body)) {
    return text
  }

  return body
}

const sharesCode = (codes: string, reply: string) =>
  codesIn(codes).some((one) => reply.includes(one))

export const restoreEdgeCodes = (source: string, reply: string) => {
  const { head, tail } = edgesOf(source)
  const opening = head === '' || sharesCode(head, reply) ? '' : head
  const closing = tail === '' || sharesCode(tail, reply) ? '' : tail

  return opening + reply + closing
}
