import type { GamePicture, PictureStatus } from '#contract/Pictures'

export type PictureFilter = PictureStatus | 'all'

export interface PictureGroup {
  readonly key: string
  readonly status: PictureStatus
  readonly pictures: ReadonlyArray<GamePicture>
}

const statusOf = (pictures: ReadonlyArray<GamePicture>): PictureStatus => {
  if (pictures.every((picture) => picture.status === 'approved')) {
    return 'approved'
  }

  if (pictures.every((picture) => picture.status === 'kept')) {
    return 'kept'
  }

  return 'to-review'
}

export const groupsOf = (
  pictures: ReadonlyArray<GamePicture>,
  filter: PictureFilter,
): ReadonlyArray<PictureGroup> => {
  const byGroup = new Map<string, Array<GamePicture>>()

  for (const picture of pictures) {
    byGroup.set(picture.group, [...(byGroup.get(picture.group) ?? []), picture])
  }

  return [...byGroup.entries()]
    .map(([key, members]) => ({ key, status: statusOf(members), pictures: members }))
    .filter((group) => filter === 'all' || group.status === filter)
}

export const nextGroup = (groups: ReadonlyArray<PictureGroup>, current: string, step: 1 | -1) => {
  const index = groups.findIndex((group) => group.key === current)
  const next = (index + step + groups.length) % groups.length

  return groups[next]?.key
}

export const readyToApprove = (picture: GamePicture) =>
  picture.cleaned !== undefined &&
  picture.lines.every((line) => line.keep || (line.translation?.trim() ?? '') !== '')
