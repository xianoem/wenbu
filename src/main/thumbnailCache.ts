interface Kept {
  readonly thumbnail: Promise<Uint8Array | undefined>
  bytes: number
}

export const thumbnailCache = (budgetBytes: number) => {
  const kept = new Map<string, Kept>()
  let total = 0

  const trim = () => {
    for (const [key, entry] of kept) {
      if (total <= budgetBytes) {
        return
      }

      kept.delete(key)
      total -= entry.bytes
    }
  }

  return {
    get: (key: string, make: () => Promise<Uint8Array | undefined>) => {
      const known = kept.get(key)

      if (known !== undefined) {
        kept.delete(key)
        kept.set(key, known)

        return known.thumbnail
      }

      const entry: Kept = { thumbnail: make(), bytes: 0 }

      kept.set(key, entry)

      void entry.thumbnail.then((thumbnail) => {
        if (kept.get(key) === entry) {
          entry.bytes = thumbnail?.byteLength ?? 0
          total += entry.bytes
          trim()
        }
      })

      return entry.thumbnail
    },
  }
}
