import { compareVersions, type Release, type ReleaseChange, type WhatsNew } from '#contract/Updates'

export interface AreaChanges {
  readonly area: string
  readonly texts: ReadonlyArray<string>
}

export const newByArea = (changes: ReadonlyArray<ReleaseChange>): ReadonlyArray<AreaChanges> => {
  const areas = new Map<string, Array<string>>()

  for (const change of changes) {
    if (change.kind !== 'new') {
      continue
    }

    areas.set(change.area, [...(areas.get(change.area) ?? []), change.text])
  }

  return [...areas].map(([area, texts]) => ({ area, texts }))
}

export const fixesOf = (changes: ReadonlyArray<ReleaseChange>) =>
  changes.filter((change) => change.kind === 'fixed').map((change) => change.text)

export const splitReleases = (
  whatsNew: WhatsNew,
): { readonly opened: ReadonlyArray<Release>; readonly earlier: ReadonlyArray<Release> } => {
  const { releases, updatedFrom } = whatsNew

  const unseen =
    updatedFrom === undefined
      ? 0
      : releases.filter((release) => compareVersions(release.version, updatedFrom) > 0).length

  const opened = Math.max(1, unseen)

  return { opened: releases.slice(0, opened), earlier: releases.slice(opened) }
}
