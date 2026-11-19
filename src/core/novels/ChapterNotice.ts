import { OpenNovel } from '#contract/Background'
import { NoticeOpen } from '#contract/CoreMessages'
import type { Notice } from '../background/Background'

export const chapterNotice = (
  novelId: string,
  name: string,
  added: ReadonlyArray<number>,
): Notice => {
  const first = Math.min(...added)
  const target = OpenNovel.make({ novelId, chapter: first })
  const count = added.length === 1 ? '1 new chapter' : `${added.length} new chapters`

  return {
    kind: 'chapters',
    title: `${name} has ${count}`,
    body: `From chapter ${first}`,
    target,
    buttons: [NoticeOpen.make({ label: 'Read', target })],
  }
}
