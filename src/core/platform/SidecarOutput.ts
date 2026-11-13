import { Effect, Ref, Stream } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'

const tailLines = 40

export const watchSidecar = Effect.fnUntraced(function* (
  sidecar: string,
  handle: ChildProcessSpawner.ChildProcessHandle,
) {
  const tail = yield* Ref.make<ReadonlyArray<string>>([])

  yield* handle.stderr.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.runForEach((line) => Ref.update(tail, (lines) => [...lines, line].slice(-tailLines))),
    Effect.ignore,
    Effect.forkScoped,
  )

  const exited = Effect.fnUntraced(function* (exitCode: number) {
    if (exitCode === 0) {
      return yield* Effect.logDebug('Sidecar exited').pipe(Effect.annotateLogs({ sidecar }))
    }

    const output = (yield* Ref.get(tail)).join('\n')

    yield* Effect.logError('Sidecar exited with an error').pipe(
      Effect.annotateLogs({ sidecar, exitCode, pid: handle.pid, output }),
    )
  })

  yield* handle.exitCode.pipe(
    Effect.flatMap((exitCode) => exited(exitCode)),
    Effect.ignore,
    Effect.forkScoped,
  )
})
