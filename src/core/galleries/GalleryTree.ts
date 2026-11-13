export interface Listing {
  readonly folder: string
  readonly images: ReadonlyArray<string>
  readonly children: ReadonlyArray<Listing>
}

export interface ClassifiedGallery {
  readonly kind: 'gallery'
  readonly folder: string
  readonly parent: string
  readonly original: ReadonlyArray<string>
  readonly translation: string | undefined
  readonly translated: ReadonlyArray<string>
}

export interface ClassifiedFolder {
  readonly kind: 'folder'
  readonly folder: string
  readonly parent: string
}

export type Classified = ClassifiedGallery | ClassifiedFolder

export const naturally = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export const editorOutputFolder = 'editor-output'

const nameOf = (folder: string) =>
  folder.slice(Math.max(folder.lastIndexOf('/'), folder.lastIndexOf('\\')) + 1)

const sameName = (folder: string, name: string) =>
  nameOf(folder).toLowerCase() === name.toLowerCase()

const byName = (left: Listing, right: Listing) =>
  naturally.compare(nameOf(left.folder), nameOf(right.folder))

export const naturalOrder = (names: ReadonlyArray<string>) =>
  names.toSorted((a, b) => naturally.compare(a, b))

export const classify = (root: Listing, translationFolder: string): ReadonlyArray<Classified> => {
  const visit = (node: Listing, parent: string, isRoot: boolean): ReadonlyArray<Classified> => {
    const translation = node.children.find((child) => sameName(child.folder, translationFolder))

    const others = node.children
      .filter((child) => child !== translation && !sameName(child.folder, editorOutputFolder))
      .toSorted(byName)

    const translated = naturalOrder(translation?.images ?? [])

    if (node.images.length > 0 || translated.length > 0) {
      const gallery: ClassifiedGallery = {
        kind: 'gallery',
        folder: node.folder,
        parent,
        original: naturalOrder(node.images),
        translation: translated.length > 0 ? translation?.folder : undefined,
        translated,
      }

      return [gallery, ...others.flatMap((child) => visit(child, parent, false))]
    }

    const below = others.flatMap((child) => visit(child, node.folder, false))

    if (isRoot || below.length === 0) {
      return below
    }

    return [{ kind: 'folder', folder: node.folder, parent }, ...below]
  }

  return visit(root, root.folder, true)
}

export interface GallerySummary {
  readonly folder: string
  readonly parent: string
  readonly pages: number
  readonly cover: string | undefined
  readonly addedAt: number
}

export interface FolderSummary {
  readonly galleries: number
  readonly pages: number
  readonly covers: ReadonlyArray<string>
  readonly addedAt: number
}

const coversShown = 3

export const summarizeFolders = (
  folders: ReadonlyArray<{ readonly folder: string; readonly parent: string }>,
  galleries: ReadonlyArray<GallerySummary>,
): ReadonlyMap<string, FolderSummary> => {
  const parentOf = new Map(folders.map((entry) => [entry.folder, entry.parent]))
  const below = new Map<string, Array<GallerySummary>>()

  for (const gallery of galleries) {
    let folder = gallery.parent

    while (parentOf.has(folder)) {
      const inside = below.get(folder) ?? []

      inside.push(gallery)
      below.set(folder, inside)
      folder = parentOf.get(folder) ?? ''
    }
  }

  return new Map(
    [...below].map(([folder, inside]) => {
      const newest = inside.toSorted((a, b) => b.addedAt - a.addedAt)

      const summary: FolderSummary = {
        galleries: inside.length,
        pages: inside.reduce((sum, gallery) => sum + gallery.pages, 0),
        covers: newest.flatMap((gallery) => gallery.cover ?? []).slice(0, coversShown),
        addedAt: newest[0]?.addedAt ?? 0,
      }

      return [folder, summary] as const
    }),
  )
}
