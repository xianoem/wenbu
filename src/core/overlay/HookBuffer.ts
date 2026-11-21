// LunaHost holds a thread's text until the game pauses for its flush delay or the text outgrows
// this size. Games that redraw their message every frame never pause, so a full buffer is the only
// flush they get: smaller means the next line shows up sooner.
export const hookBufferSize = 1000

const borders = (text: string) => {
  const lengths = Array.from({ length: text.length }, () => 0)
  let matched = 0

  for (let index = 1; index < text.length; index += 1) {
    while (matched > 0 && text[index] !== text[matched]) {
      matched = lengths[matched - 1] ?? 0
    }

    if (text[index] === text[matched]) {
      matched += 1
    }

    lengths[index] = matched
  }

  return lengths
}

const trailingCopies = (text: string, length: number) => {
  const unit = text.slice(-length)
  let start = text.length - length
  let copies = 1

  while (start >= length && text.startsWith(unit, start - length)) {
    start -= length
    copies += 1
  }

  return copies
}

interface Run {
  readonly length: number
  readonly copies: number
}

const runOfPrefix = (prefixBorders: ReadonlyArray<number>, length: number): Run => {
  const period = length - (prefixBorders[length - 1] ?? 0)

  return length % period === 0 ? { length: period, copies: length / period } : { length, copies: 1 }
}

// A run seen only once could be any text, so it must not outweigh the repeated run beside it.
const plausible = (earlier: Run, later: Run) => {
  if (earlier.copies + later.copies < 3) {
    return false
  }

  if (later.copies === 1) {
    return earlier.copies >= 2
  }

  return earlier.copies >= 2 || earlier.length <= later.length * later.copies
}

// A full buffer holds whole copies of the line on screen, sometimes after copies of the line before it.
export const newestPush = (text: string) => {
  if (text.length <= hookBufferSize) {
    return text
  }

  const prefixBorders = borders(text)
  const whole = runOfPrefix(prefixBorders, text.length)

  if (whole.copies >= 2) {
    return text.slice(-whole.length)
  }

  let repeated: Run | undefined
  let single: Run | undefined

  for (let length = 1; length < text.length; length += 1) {
    const later = { length, copies: trailingCopies(text, length) }
    const covered = length * later.copies

    if (
      covered >= text.length ||
      !plausible(runOfPrefix(prefixBorders, text.length - covered), later)
    ) {
      continue
    }

    if (later.copies === 1) {
      single ??= later

      continue
    }

    if (repeated === undefined || covered > repeated.length * repeated.copies) {
      repeated = later
    }
  }

  const newest = repeated ?? single

  return newest === undefined ? text : text.slice(-newest.length)
}
