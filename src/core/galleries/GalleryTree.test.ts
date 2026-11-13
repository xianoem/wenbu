import { assert, describe, it } from '@effect/vitest'
import { classify, type Listing, summarizeFolders } from './GalleryTree'

const listing = (
  folder: string,
  images: ReadonlyArray<string>,
  children: ReadonlyArray<Listing> = [],
): Listing => ({ folder, images, children })

const root = (children: ReadonlyArray<Listing>, images: ReadonlyArray<string> = []) =>
  listing('R', images, children)

const kinds = (tree: Listing) =>
  classify(tree, 'translated').map((entry) => `${entry.kind} ${entry.folder} in ${entry.parent}`)

describe('classify', () => {
  it('makes a folder with images an original-only gallery, pages in natural order', () => {
    const [gallery] = classify(root([listing('R/A', ['10.jpg', '2.jpg', '1.webp'])]), 'translated')

    assert.deepStrictEqual(gallery, {
      kind: 'gallery',
      folder: 'R/A',
      parent: 'R',
      original: ['1.webp', '2.jpg', '10.jpg'],
      translation: undefined,
      translated: [],
    })
  })

  it('reads the translation folder as the translated version, and alone as translated-only', () => {
    const both = listing('R/A', ['1.jpg'], [listing('R/A/translated', ['1.png'])])
    const translatedOnly = listing('R/B', [], [listing('R/B/Translated', ['2.jpg', '1.jpg'])])
    const entries = classify(root([both, translatedOnly]), 'translated')

    assert.deepStrictEqual(
      entries.map((entry) =>
        entry.kind === 'gallery' ? [entry.translation, entry.translated] : [],
      ),
      [
        ['R/A/translated', ['1.png']],
        ['R/B/Translated', ['1.jpg', '2.jpg']],
      ],
    )
  })

  it('never reads editor-output, and an empty translation folder makes no gallery', () => {
    const tree = root([
      listing('R/A', [], [listing('R/A/editor-output', ['1.png']), listing('R/A/translated', [])]),
    ])

    assert.deepStrictEqual(kinds(tree), [])
  })

  it('shows a folder only when a gallery is somewhere below it', () => {
    const tree = root([
      listing(
        'R/Series',
        [],
        [listing('R/Series/Vol 1', [], [listing('R/Series/Vol 1/G', ['1.jpg'])])],
      ),
      listing('R/Empty', [], [listing('R/Empty/Nothing', [])]),
    ])

    assert.deepStrictEqual(kinds(tree), [
      'folder R/Series in R',
      'folder R/Series/Vol 1 in R/Series',
      'gallery R/Series/Vol 1/G in R/Series/Vol 1',
    ])
  })

  it('lifts the chapter folders of a gallery into its parent, so nothing is hidden', () => {
    const tree = root([
      listing(
        'R/Book',
        ['cover.jpg'],
        [
          listing('R/Book/Ch 2', ['1.jpg']),
          listing('R/Book/Ch 1', ['1.jpg'], [listing('R/Book/Ch 1/translated', ['1.jpg'])]),
          listing('R/Book/Extras', [], [listing('R/Book/Extras/Art', ['1.jpg'])]),
        ],
      ),
    ])

    assert.deepStrictEqual(kinds(tree), [
      'gallery R/Book in R',
      'gallery R/Book/Ch 1 in R',
      'gallery R/Book/Ch 2 in R',
      'folder R/Book/Extras in R',
      'gallery R/Book/Extras/Art in R/Book/Extras',
    ])
  })

  it('makes a root with images a gallery of its own, at the top', () => {
    assert.deepStrictEqual(kinds(root([], ['1.jpg'])), ['gallery R in R'])
  })
})

describe('summarizeFolders', () => {
  it('counts every gallery below a folder, and fans out the three added last', () => {
    const folders = [
      { folder: 'R/S', parent: 'R' },
      { folder: 'R/S/V', parent: 'R/S' },
    ]

    const galleries = [
      { folder: 'R/S/A', parent: 'R/S', pages: 10, cover: 'a', addedAt: 1 },
      { folder: 'R/S/V/B', parent: 'R/S/V', pages: 20, cover: 'b', addedAt: 4 },
      { folder: 'R/S/V/C', parent: 'R/S/V', pages: 5, cover: undefined, addedAt: 3 },
      { folder: 'R/S/V/D', parent: 'R/S/V', pages: 1, cover: 'd', addedAt: 2 },
      { folder: 'R/E', parent: 'R', pages: 7, cover: 'e', addedAt: 9 },
    ]

    const summaries = summarizeFolders(folders, galleries)

    assert.deepStrictEqual(summaries.get('R/S'), {
      galleries: 4,
      pages: 36,
      covers: ['b', 'd', 'a'],
      addedAt: 4,
    })

    assert.deepStrictEqual(summaries.get('R/S/V'), {
      galleries: 3,
      pages: 26,
      covers: ['b', 'd'],
      addedAt: 4,
    })

    assert.isUndefined(summaries.get('R'))
  })
})
