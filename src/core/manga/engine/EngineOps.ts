import { Context, Effect, Layer } from 'effect'
import { MangaError } from '#contract/Manga'
import type { EditorRequest } from '../MangaRuntime'

export type EditorOp = EditorRequest

const notPorted = (op: string) =>
  new MangaError({ reason: 'failed', message: `The native engine cannot ${op} pages yet.` })

export class EngineOps extends Context.Service<
  EngineOps,
  {
    readonly editor: (request: EditorOp) => Effect.Effect<unknown, MangaError>
  }
>()('wenbu/core/manga/engine/EngineOps') {
  static readonly layer = Layer.succeed(
    EngineOps,
    EngineOps.of({
      editor: Effect.fn('EngineOps.editor')(function* (request: EditorOp) {
        return yield* notPorted(request.op)
      }),
    }),
  )
}
