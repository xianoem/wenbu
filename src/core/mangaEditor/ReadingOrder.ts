import type { PageBox } from '#contract/MangaEditor'

const middle = (box: PageBox) => box.y + box.height / 2

const readsBefore = (first: PageBox, second: PageBox) => {
  if (middle(first) < second.y) {
    return true
  }

  if (middle(second) < first.y) {
    return false
  }

  return first.x + first.width / 2 > second.x + second.width / 2
}

export const insertionIndex = (ordered: ReadonlyArray<PageBox>, box: PageBox) => {
  const last = ordered.findLastIndex((existing) => readsBefore(existing, box))

  return last + 1
}
