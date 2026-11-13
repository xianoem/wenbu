import type { DecodedMessage, DecodeMessage } from './decodeWorker'
import type { DecodeRequest } from './pageLoader'

const workers = 2

const decoderOf = (worker: Worker) => {
  const waiting = new Map<number, (message: DecodedMessage) => void>()
  let nextId = 0

  worker.addEventListener('message', (event: MessageEvent<DecodedMessage>) => {
    waiting.get(event.data.id)?.(event.data)
    waiting.delete(event.data.id)
  })

  return {
    decode: (request: DecodeRequest) => {
      const { promise, resolve, reject } = Promise.withResolvers<ImageBitmap>()
      const id = nextId++
      const message: DecodeMessage = { id, url: request.url, width: request.width }

      waiting.set(id, (decoded) =>
        decoded.bitmap === undefined
          ? reject(new Error(`Could not decode ${request.url}`))
          : resolve(decoded.bitmap),
      )

      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin.
      worker.postMessage(message)

      return promise
    },
  }
}

let started: ReadonlyArray<ReturnType<typeof decoderOf>> | undefined = undefined

export const pageDecoders = () => {
  started ??= Array.from({ length: workers }, () =>
    decoderOf(new Worker(new URL('./decodeWorker.ts', import.meta.url), { type: 'module' })),
  )

  return started
}
