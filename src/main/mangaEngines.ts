import { MessageChannelMain, type UtilityProcess, utilityProcess } from 'electron'
import {
  MangaEngineExited,
  MangaEngineStarted,
  type MangaEngineStart,
  type MangaEngineStop,
} from '#contract/CoreMessages'
import { outputTail } from './mainLog'

interface MangaEnginesOptions {
  readonly entry: string
  readonly env: () => Record<string, string | undefined>
  readonly post: (
    message: MangaEngineStarted | MangaEngineExited,
    ports: Array<Electron.MessagePortMain>,
  ) => void
  readonly onExit: (id: number, exitCode: number, output: string) => void
}

export const mangaEngines = (options: MangaEnginesOptions) => {
  const running = new Map<number, UtilityProcess>()

  const start = (request: MangaEngineStart) => {
    running.get(request.id)?.kill()

    const output = outputTail(40)

    const engine = utilityProcess.fork(options.entry, [], {
      serviceName: 'Wenbu manga engine',
      stdio: 'pipe',
      env: { ...options.env(), WENBU_MANGA_ENGINE_FOLDER: request.folder },
    })

    running.set(request.id, engine)

    engine.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))

    engine.stderr?.on('data', (chunk: Buffer) => {
      output.push(chunk.toString())
      process.stderr.write(chunk)
    })

    engine.once('spawn', () => {
      const { port1, port2 } = new MessageChannelMain()

      engine.postMessage(null, [port1])
      options.post(MangaEngineStarted.make({ id: request.id }), [port2])
    })

    engine.once('exit', (exitCode) => {
      if (running.get(request.id) === engine) {
        running.delete(request.id)
      }

      const tail = output.take()

      options.onExit(request.id, exitCode, tail)
      options.post(MangaEngineExited.make({ id: request.id, exitCode, output: tail }), [])
    })
  }

  const stop = (request: MangaEngineStop) => {
    running.get(request.id)?.kill()
  }

  const stopAll = () => {
    for (const engine of running.values()) {
      engine.kill()
    }

    running.clear()
  }

  return { start, stop, stopAll }
}
