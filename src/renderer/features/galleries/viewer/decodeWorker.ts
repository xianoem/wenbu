export interface DecodeMessage {
  readonly id: number
  readonly url: string
  readonly width: number
}

export interface DecodedMessage {
  readonly id: number
  readonly bitmap?: ImageBitmap
}

addEventListener('message', ({ data }: MessageEvent<DecodeMessage>) => {
  const reply = (message: DecodedMessage, transfer: Array<Transferable>) =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no target origin.
    postMessage(message, { transfer })

  // Pages come from the wenbu-image scheme; Effect's HTTP client adds nothing for a local file.
  // @effect-diagnostics-next-line globalFetch:off
  void fetch(data.url)
    .then((response) => response.blob())
    .then((blob) => createImageBitmap(blob, { resizeWidth: data.width, resizeQuality: 'high' }))
    .then(
      (bitmap) => reply({ id: data.id, bitmap }, [bitmap]),
      () => reply({ id: data.id }, []),
    )
})
