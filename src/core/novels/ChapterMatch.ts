import { fold } from '../glossary/GlossaryMatcher'
import { cleanTitle } from './ChapterText'

const numerals = '0-9０-９零〇一二三四五六七八九十百千萬万两兩'

const headings = [
  new RegExp(`^第\\s*[${numerals}]+\\s*[章節节回話话卷集篇]\\s*`),
  /^제\s*\d+\s*[화장편]\s*/,
  /^chapter\s+\d+\s*[:.\-–]?\s*/i,
]

const plain = (text: string) =>
  fold(text)
    .replaceAll(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase()

export const chapterKey = (title: string) => {
  const cleaned = cleanTitle(title).trim()
  const heading = headings.find((pattern) => pattern.test(cleaned))

  return plain(heading === undefined ? cleaned : cleaned.replace(heading, ''))
}

export const matchChapters = (
  wanted: ReadonlyArray<{ readonly number: number; readonly title: string }>,
  offered: ReadonlyArray<{ readonly title: string; readonly url: string }>,
) => {
  const byKey = new Map<string, string | null>()

  for (const chapter of offered) {
    const key = chapterKey(chapter.title)

    if (key !== '') {
      byKey.set(key, byKey.has(key) ? null : chapter.url)
    }
  }

  const matches = new Map<number, string>()

  for (const chapter of wanted) {
    const url = byKey.get(chapterKey(chapter.title))

    if (url !== undefined && url !== null) {
      matches.set(chapter.number, url)
    }
  }

  return matches
}

const placeholderAuthor = /^(?:佚名|匿名|未知|作者|unknown|anonymous)$/i

const authorOf = (author: string | null) =>
  author === null || placeholderAuthor.test(author.trim()) ? null : plain(author)

interface Book {
  readonly title: string
  readonly author: string | null
}

export const sameBook = (left: Book, right: Book) =>
  plain(left.title) !== '' &&
  plain(left.title) === plain(right.title) &&
  (authorOf(left.author) === null ||
    authorOf(right.author) === null ||
    authorOf(left.author) === authorOf(right.author))
