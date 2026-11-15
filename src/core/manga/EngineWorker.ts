import { type Cause, Deferred, Effect, Predicate, Queue, Schema, Stream } from 'effect'
import {
  MangaEngineExited,
  MangaEngineStart,
  MangaEngineStarted,
  MangaEngineStop,
} from '#contract/CoreMessages'
import { MangaError } from '#contract/Manga'
import type { WorkerConnection, WorkerLauncher } from './MangaRuntime'

const isStarted = Schema.is(MangaEngineStarted)

const isExited = Schema.is(MangaEngineExited)

const failed = (message: string) => new MangaError({ reason: 'failed', message })

let nextEngine = 0

const post = (message: MangaEngineStart | MangaEngineStop) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's parentPort is not a window and takes no target origin.
  Effect.sync(() => process.parentPort.postMessage(message))

/** The native manga engine: a utility process main starts for core, reached over a MessagePort. */
export const engineWorker: WorkerLauncher = (folder) =>
  Effect.gen(function* () {
    nextEngine += 1

    const id = nextEngine
    const started = yield* Deferred.make<Electron.MessagePortMain, MangaError>()
    const lines = yield* Queue.unbounded<string, Cause.Done>()
    let output = ''

    const receive = (event: Electron.MessageEvent) => {
      if (isStarted(event.data) && event.data.id === id) {
        const [port] = event.ports

        Deferred.doneUnsafe(
          started,
          port === undefined
            ? Effect.fail(failed('The manga engine started without a port.'))
            : Effect.succeed(port),
        )
      }

      if (isExited(event.data) && event.data.id === id) {
        output = event.data.output
        Deferred.doneUnsafe(started, Effect.fail(failed(`The manga engine stopped: ${output}`)))
        Queue.endUnsafe(lines)
      }
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => process.parentPort.on('message', receive)),
      () => Effect.sync(() => process.parentPort.off('message', receive)),
    )

    yield* Effect.addFinalizer(() => post(MangaEngineStop.make({ id })))
    yield* post(MangaEngineStart.make({ id, folder }))

    const port = yield* Deferred.await(started).pipe(
      Effect.timeoutOrElse({
        duration: '1 minute',
        orElse: () => Effect.fail(failed('The manga engine took too long to start.')),
      }),
    )

    port.on('message', (event) => {
      if (Predicate.isString(event.data)) {
        Queue.offerUnsafe(lines, event.data)
      }
    })

    port.on('close', () => Queue.endUnsafe(lines))
    port.start()
    yield* Effect.addFinalizer(() => Effect.sync(() => port.close()))

    return {
      lines: Stream.fromQueue(lines),
      send: (line) => Effect.sync(() => port.postMessage(line)),
      output: Effect.sync(() => output),
      pid: undefined,
    } satisfies WorkerConnection
  })
