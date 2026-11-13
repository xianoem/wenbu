import type { DLsiteFilters } from '#contract/Details'

interface Filterable {
  readonly genres: ReadonlyArray<{ readonly id: number }>
  readonly workType: string
}

/** DLsite's own tag search also answers with works that do not list the tag. */
export const applyListFilters = <A extends Filterable>(
  works: ReadonlyArray<A>,
  filters: DLsiteFilters,
): ReadonlyArray<A> => {
  const types = new Set<string>(filters.gameTypes)

  return works.filter((work) => {
    const has = new Set(work.genres.map((genre) => genre.id))

    return (
      filters.tags.every((tag) => has.has(tag.id)) && (types.size === 0 || types.has(work.workType))
    )
  })
}
