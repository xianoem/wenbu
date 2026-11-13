interface Shape {
  readonly width: number | null
  readonly height: number | null
}

const isLandscape = (page: Shape) =>
  page.width !== null && page.height !== null && page.width > page.height

export const spreadsOf = (
  pages: ReadonlyArray<Shape>,
  shifted: boolean,
): ReadonlyArray<ReadonlyArray<number>> => {
  const spreads: Array<ReadonlyArray<number>> = []
  let waiting: number | undefined = undefined

  const flush = () => {
    if (waiting !== undefined) {
      spreads.push([waiting])
      waiting = undefined
    }
  }

  pages.forEach((page, index) => {
    if (index === 0 || (shifted && index === 1) || isLandscape(page)) {
      flush()
      spreads.push([index])

      return
    }

    if (waiting === undefined) {
      waiting = index

      return
    }

    spreads.push([waiting, index])
    waiting = undefined
  })

  flush()

  return spreads
}

export const spreadOf = (spreads: ReadonlyArray<ReadonlyArray<number>>, page: number) => {
  const found = spreads.findIndex((spread) => spread.includes(page))

  return found === -1 ? Math.max(0, spreads.length - 1) : found
}

const stem = (name: string) => {
  const dot = name.lastIndexOf('.')

  return (dot === -1 ? name : name.slice(0, dot)).toLowerCase()
}

export const matchingPage = (
  from: ReadonlyArray<{ readonly name: string }>,
  page: number,
  to: ReadonlyArray<{ readonly name: string }>,
) => {
  const inTarget = new Map(to.map((entry, index) => [stem(entry.name), index]))

  for (let distance = 0; distance < from.length; distance++) {
    for (const candidate of [page - distance, page + distance]) {
      const found = inTarget.get(stem(from[candidate]?.name ?? ''))

      if (found !== undefined) {
        return found
      }
    }
  }

  return 0
}

export const readingOrder = (
  spreads: ReadonlyArray<ReadonlyArray<number>>,
  current: number,
  ahead: number,
  behind: number,
) => {
  const order = [current]

  for (let step = 1; step <= ahead; step++) {
    order.push(current + step)
  }

  for (let step = 1; step <= behind; step++) {
    order.push(current - step)
  }

  return order.flatMap((spread) => spreads[spread] ?? [])
}

export type Fit = 'page' | 'width'

export const aspectOf = (page: Shape) =>
  page.width !== null && page.height !== null && page.height > 0 ? page.width / page.height : 0.7

export const pageBoxes = (
  spread: ReadonlyArray<Shape>,
  stage: { readonly width: number; readonly height: number },
  fit: Fit,
) => {
  const across = spread.reduce((sum, page) => sum + aspectOf(page), 0)
  const byWidth = stage.width / Math.max(across, 0.01)
  const height = fit === 'width' ? byWidth : Math.min(stage.height, byWidth)

  return spread.map((page) => ({
    width: Math.round(aspectOf(page) * height),
    height: Math.round(height),
  }))
}
