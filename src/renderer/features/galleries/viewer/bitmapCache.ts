interface Bitmap {
  readonly width: number
  readonly height: number
  readonly close: () => void
}

const bytesOf = (bitmap: Bitmap) => bitmap.width * bitmap.height * 4

// Read through useSyncExternalStore: the React Compiler caches a read of the mutable map.
export const bitmapCache = <B extends Bitmap>(defaultBudget: number) => {
  const pages = new Map<string, B>()
  const listeners = new Set<() => void>()
  let snapshot: ReadonlyMap<string, B> = new Map()

  const changed = () => {
    snapshot = new Map(pages)

    for (const listener of listeners) {
      listener()
    }
  }

  const drop = (key: string) => {
    pages.get(key)?.close()
    pages.delete(key)
  }

  return {
    get: (key: string) => pages.get(key),
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    put: (key: string, bitmap: B) => {
      const old = pages.get(key)

      if (old !== undefined && old !== bitmap) {
        old.close()
      }

      pages.set(key, bitmap)
      changed()
    },
    keep: (wanted: ReadonlyArray<string>, budget = defaultBudget, onScreen = 0) => {
      const rank = new Map(wanted.map((key, index) => [key, index]))
      const shown = new Set(wanted.slice(0, onScreen))

      const leastWantedFirst = [...pages.keys()]
        .filter((key) => !shown.has(key))
        .toSorted((left, right) => (rank.get(right) ?? Infinity) - (rank.get(left) ?? Infinity))

      let total = [...pages.values()].reduce((sum, bitmap) => sum + bytesOf(bitmap), 0)

      const dropped = leastWantedFirst.filter((key) => {
        if (total <= budget) {
          return false
        }

        total -= bytesOf(pages.get(key) ?? { width: 0, height: 0, close: () => {} })

        return true
      })

      dropped.forEach((key) => drop(key))

      if (dropped.length > 0) {
        changed()
      }
    },
    clear: () => {
      for (const key of pages.keys()) {
        drop(key)
      }

      changed()
    },
  }
}
