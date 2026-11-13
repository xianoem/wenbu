const numerals = '0-9０-９零〇一二三四五六七八九十百千萬万两兩'

const headings = [
  new RegExp(`^第\\s*[${numerals}]+\\s*[章節节回話话卷集篇]`),
  /^제\s*\d+\s*[화장편]/,
  /^chapter\s+\d+/i,
]

export const looksLikeChapter = (line: string) =>
  line.length <= 40 && headings.some((heading) => heading.test(line))

export const splitParagraphs = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replaceAll(/^[\s　]+|[\s　]+$/g, ''))
    .filter((line) => line !== '')

export interface SplitChapter {
  readonly title: string | null
  readonly paragraphs: ReadonlyArray<string>
}

export const splitChapters = (text: string): ReadonlyArray<SplitChapter> => {
  const chapters: Array<{ title: string | null; paragraphs: Array<string> }> = []

  for (const line of splitParagraphs(text)) {
    const current = chapters.at(-1)

    if (looksLikeChapter(line)) {
      chapters.push({ title: line, paragraphs: [] })
    } else if (current === undefined) {
      chapters.push({ title: null, paragraphs: [line] })
    } else {
      current.paragraphs.push(line)
    }
  }

  return chapters
}

const plea =
  /\s*[（(][^（）()]*(?:求|月票|推薦|推荐|加更|雙倍|双倍|訂閱|订阅|感謝|感谢|盟主|第[一二三四五六七八九十0-9]+更)[^（）()]*[）)]\s*$/

export const cleanTitle = (title: string) => title.replace(plea, '').trim()

const notice = /請假|请假|感言|收藏|上架|通知|公告|說明|说明|新書|新书|單章|单章/

export const isExtra = (title: string) => !looksLikeChapter(title) && notice.test(title)

const noteStart = /^(?:PS|ps|Ps)\s*[：:]|^作者有[話话]說|^作者有[話话]说/

export const cleanChapter = (paragraphs: ReadonlyArray<string>) => {
  const start = paragraphs.findIndex((paragraph) => noteStart.test(paragraph))

  if (start <= 0) {
    return { paragraphs, note: null }
  }

  return {
    paragraphs: paragraphs.slice(0, start),
    note: paragraphs.slice(start).join('\n'),
  }
}
