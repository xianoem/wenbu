import { Option } from 'effect'
import { type HTMLElement, parse } from 'node-html-parser'
import type { NovelLanguage, SiteEntry } from '#contract/Novels'
import { cleanChapter, cleanTitle, isExtra, looksLikeChapter, splitParagraphs } from './ChapterText'

export const builtInSites: ReadonlyArray<SiteEntry> = [
  {
    id: 'qidian',
    name: 'Qidian',
    role: 'official',
    hosts: ['www.qidian.com', 'qidian.com'],
    language: 'zh',
    builtIn: true,
    selectors: {
      book: '/book/{id}/',
      chapterList: null,
      chapterLink: 'li.chapter-item a.chapter-name',
      chapterText: 'main.content',
      drop: ['script'],
      locked: '.chapter-locked',
      search: { url: '/so/{query}.html', item: 'li.res-book-item' },
    },
  },
  {
    id: '17k',
    name: '17k',
    role: 'official',
    hosts: ['www.17k.com', '17k.com'],
    language: 'zh',
    builtIn: true,
    selectors: {
      book: '/book/{id}.html',
      chapterList: '/list/{id}.html',
      chapterLink: 'dl.Volume dd a',
      chapterText: '.readAreaBox .p',
      drop: ['script', '.author-say', '.chapter_update_time'],
      locked: '.vip',
      search: {
        url: 'https://search.17k.com/search.xhtml?c.st=0&c.q={query}',
        item: '.textlist',
      },
    },
  },
  {
    id: '101kks',
    name: '101kks',
    role: 'host',
    hosts: ['101kks.com'],
    language: 'zh',
    builtIn: true,
    selectors: {
      book: '/book/{id}.html',
      chapterList: '/ajax_novels/chapterlist/{id}.html',
      chapterLink: 'li > a',
      chapterText: '#txtcontent',
      drop: ['script', '.txtcenter'],
      search: { url: '/search/{query}/1.html', item: '#article_list_content > li' },
    },
  },
]

const hostMatches = (host: string, site: string) => host === site || host.endsWith(`.${site}`)

export const siteFor = (sites: ReadonlyArray<SiteEntry>, url: URL) =>
  Option.fromNullishOr(
    sites.find((site) => site.hosts.some((host) => hostMatches(url.hostname, host))),
  )

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

export const bookIdOf = (site: SiteEntry, url: URL) => {
  const [before = '', after = ''] = site.selectors.book.split('{id}')
  const match = new RegExp(`^${escape(before)}([^/?#]+)${escape(after)}$`).exec(url.pathname)

  return Option.fromNullishOr(match?.[1])
}

export const siteUrl = (
  site: SiteEntry,
  template: string,
  values: { readonly id?: string; readonly query?: string },
) =>
  new URL(
    template
      .replace('{id}', encodeURIComponent(values.id ?? ''))
      .replace('{query}', encodeURIComponent(values.query ?? '')),
    `https://${site.hosts[0] ?? ''}/`,
  ).href

const resolve = (site: SiteEntry, href: string | undefined) => {
  if (href === undefined || href === '' || href.startsWith('javascript:') || href === '#') {
    return undefined
  }

  return URL.parse(href, `https://${site.hosts[0] ?? ''}/`)?.href
}

export const isOfficial = (site: SiteEntry) => site.role === 'official'

const absolute = (url: string | null) => (url?.startsWith('//') === true ? `https:${url}` : url)

const meta = (root: HTMLElement, property: string) => {
  const content = root
    .querySelector(`meta[property="${property}"], meta[name="${property}"]`)
    ?.getAttribute('content')
    ?.trim()

  return content === undefined || content === '' ? null : content
}

const statusOf = (text: string | null) => {
  if (text === null) {
    return null
  }

  if (/完本|完結|完结|已完|全本/.test(text)) {
    return 'finished'
  }

  return /連載|连载|更新/.test(text) ? 'ongoing' : null
}

export interface BookPage {
  readonly title: string | null
  readonly author: string | null
  readonly coverUrl: string | null
  readonly synopsis: string | null
  readonly tags: ReadonlyArray<string>
  readonly status: 'ongoing' | 'finished' | null
  readonly latestChapter: string | null
  readonly url: string | null
}

export const parseBook = (html: string): BookPage => {
  const root = parse(html)
  const category = meta(root, 'og:novel:category')
  const ogTitle = meta(root, 'og:title')
  const quoted = ogTitle === null ? null : /《([^》]+)》\s*([^-—_|]+?)\s*著/.exec(ogTitle)

  return {
    title:
      meta(root, 'og:novel:book_name') ??
      quoted?.[1]?.trim() ??
      ogTitle ??
      root.querySelector('h1')?.text.trim() ??
      null,
    author: meta(root, 'og:novel:author') ?? quoted?.[2]?.trim() ?? null,
    coverUrl: absolute(meta(root, 'og:image')),
    synopsis: meta(root, 'og:description'),
    tags: category === null ? [] : [category],
    status: statusOf(meta(root, 'og:novel:status')),
    latestChapter: meta(root, 'og:novel:latest_chapter_name'),
    url: absolute(meta(root, 'og:url')),
  }
}

export interface ListedChapter {
  readonly title: string
  readonly url: string
  readonly extra: boolean
  readonly locked: boolean
  readonly releasedAt: string | null
}

const datePattern = /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/

const isLocked = (site: SiteEntry, link: HTMLElement) => {
  const locked = site.selectors.locked

  if (locked === undefined) {
    return false
  }

  return link.querySelector(locked) !== null || link.closest('li')?.querySelector(locked) != null
}

export const parseChapterList = (site: SiteEntry, html: string): ReadonlyArray<ListedChapter> => {
  const seen = new Set<string>()
  const chapters: Array<ListedChapter> = []

  for (const link of parse(html).querySelectorAll(site.selectors.chapterLink)) {
    const url = resolve(site, link.getAttribute('href'))
    const title = cleanTitle(link.text.trim())

    if (url === undefined || title === '' || seen.has(url)) {
      continue
    }

    seen.add(url)

    chapters.push({
      title,
      url,
      extra: isExtra(title),
      locked: isLocked(site, link),
      releasedAt: datePattern.exec(link.getAttribute('title') ?? '')?.[1] ?? null,
    })
  }

  return chapters
}

const textOf = (element: HTMLElement) =>
  parse(element.innerHTML.replaceAll(/<br\s*\/?>/gi, '\n').replaceAll(/<\/(?:p|div)>/gi, '\n')).text

const sameText = (left: string, right: string) =>
  left.replaceAll(/\s/g, '') === right.replaceAll(/\s/g, '')

export const parseChapterText = (site: SiteEntry, html: string, title?: string) => {
  const container = parse(html).querySelector(site.selectors.chapterText)

  if (container === null) {
    return { paragraphs: [], note: null }
  }

  for (const selector of site.selectors.drop) {
    for (const element of container.querySelectorAll(selector)) {
      element.remove()
    }
  }

  const paragraphs = splitParagraphs(textOf(container))

  return cleanChapter(
    title !== undefined && paragraphs[0] !== undefined && sameText(paragraphs[0], title)
      ? paragraphs.slice(1)
      : paragraphs,
  )
}

export interface SearchHit {
  readonly url: string
  readonly title: string
  readonly author: string | null
  readonly coverUrl: string | null
  readonly latestChapter: string | null
}

export const parseSearch = (site: SiteEntry, html: string): ReadonlyArray<SearchHit> => {
  const search = site.selectors.search

  if (search === null) {
    return []
  }

  const hits: Array<SearchHit> = []
  const seen = new Set<string>()

  for (const item of parse(html).querySelectorAll(search.item)) {
    const links = item.querySelectorAll('a')

    const bookLinks = links.filter((link) => {
      const url = resolve(site, link.getAttribute('href'))

      return url !== undefined && Option.isSome(bookIdOf(site, new URL(url)))
    })

    const titled = bookLinks.find(
      (link) => link.text.trim() !== '' && !/閱讀|阅读|書架|书架/.test(link.text),
    )

    const url = resolve(site, titled?.getAttribute('href'))

    if (titled === undefined || url === undefined || seen.has(url)) {
      continue
    }

    const image = item.querySelector('img')

    const cover = resolve(
      site,
      image?.getAttribute('data-src') ??
        image?.getAttribute('data-original') ??
        image?.getAttribute('src'),
    )

    const latest = links
      .map((link) => link.text.trim().replace(/^[^第]{1,8}(?=第)/, ''))
      .find((text) => looksLikeChapter(text))

    const author = links
      .find((link) => /author|\/see\//.test(link.getAttribute('href') ?? ''))
      ?.text.trim()

    seen.add(url)

    hits.push({
      url,
      title: titled.text.trim(),
      author: author === undefined || author === '' ? null : author,
      coverUrl: cover === undefined || /nocover|no-cover|default/.test(cover) ? null : cover,
      latestChapter: latest === undefined ? null : cleanTitle(latest),
    })
  }

  return hits
}

export const languageOf = (text: string): NovelLanguage => {
  if (/[぀-ヿ]/.test(text)) {
    return 'ja'
  }

  return /[가-힯]/.test(text) ? 'ko' : 'zh'
}

const selectorOf = (element: HTMLElement) => {
  if (element.id !== '') {
    return `#${element.id}`
  }

  const className = element.classList.value[0]

  return className === undefined
    ? element.tagName.toLowerCase()
    : `${element.tagName.toLowerCase()}.${className}`
}

const ownText = (element: HTMLElement) =>
  element.childNodes
    .filter((node) => node.nodeType === 3)
    .reduce((total, node) => total + node.text.trim().length, 0)

const templateOf = (url: URL) => url.pathname.replace(/\d+(?=[^\d]*$)/, '{id}')

export interface SitePagesHtml {
  readonly book: string
  readonly chapterList: { readonly url: string; readonly html: string } | null
  readonly chapter: string
}

export const detectSite = (bookUrl: URL, pages: SitePagesHtml): SiteEntry => {
  const listHtml = pages.chapterList?.html ?? pages.book
  const groups = new Map<string, number>()

  for (const link of parse(listHtml).querySelectorAll('a')) {
    const parent = link.parentNode

    if (looksLikeChapter(cleanTitle(link.text.trim())) && parent !== null) {
      const selector = `${selectorOf(parent)} > a`

      groups.set(selector, (groups.get(selector) ?? 0) + 1)
    }
  }

  const chapterLink = [...groups].toSorted((left, right) => right[1] - left[1])[0]?.[0] ?? 'a'
  const chapterRoot = parse(pages.chapter)

  const textElement = chapterRoot
    .querySelectorAll('div, article, section, p, td')
    .toSorted((left, right) => ownText(right) - ownText(left))[0]

  const host = bookUrl.hostname.replace(/^www\./, '')

  return {
    id: host,
    name: host,
    hosts: [host],
    language: languageOf(textElement?.text ?? ''),
    role: 'host',
    builtIn: false,
    selectors: {
      book: templateOf(bookUrl),
      chapterList: pages.chapterList === null ? null : templateOf(new URL(pages.chapterList.url)),
      chapterLink,
      chapterText: textElement === undefined ? 'body' : selectorOf(textElement),
      drop: ['script', 'style', 'div', 'ins', 'iframe'],
      search: null,
    },
  }
}
