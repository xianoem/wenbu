import type { bitmapCache } from './bitmapCache'

export interface DecodeRequest {
  readonly key: string
  readonly url: string
  readonly width: number
}

interface Bitmap {
  readonly width: number
  readonly height: number
  readonly close: () => void
}

interface Decoder<B> {
  readonly decode: (request: DecodeRequest) => Promise<B>
}

const closeEnough = 0.9

export const pageLoader = <B extends Bitmap>(
  decoders: ReadonlyArray<Decoder<B>>,
  cache: ReturnType<typeof bitmapCache<B>>,
) => {
  let waiting: ReadonlyArray<DecodeRequest> = []
  const busy = new Set<Decoder<B>>()
  const decoding = new Map<string, number>()

  const needs = (request: DecodeRequest) => {
    const kept = cache.get(request.key)
    const inFlight = decoding.get(request.key)

    if (kept !== undefined && kept.width >= request.width * closeEnough) {
      return false
    }

    return inFlight === undefined || inFlight < request.width * closeEnough
  }

  const next = () => {
    for (const decoder of decoders) {
      if (busy.has(decoder)) {
        continue
      }

      const request = waiting.find((candidate) => needs(candidate))

      if (request === undefined) {
        return
      }

      waiting = waiting.filter((candidate) => candidate !== request)
      busy.add(decoder)
      decoding.set(request.key, request.width)

      void decoder.decode(request).then(
        (bitmap) => {
          cache.put(request.key, bitmap)
          finish(decoder, request)
        },
        () => finish(decoder, request),
      )
    }
  }

  const finish = (decoder: Decoder<B>, request: DecodeRequest) => {
    busy.delete(decoder)

    if (decoding.get(request.key) === request.width) {
      decoding.delete(request.key)
    }

    next()
  }

  return {
    want: (requests: ReadonlyArray<DecodeRequest>) => {
      waiting = requests
      next()
    },
  }
}
