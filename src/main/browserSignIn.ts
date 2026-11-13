import { createServer } from 'node:net'
import { join } from 'node:path'
import * as NodeServices from '@effect/platform-node/NodeServices'
import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Schedule,
  Schema,
} from 'effect'
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/http'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { type SessionCookie, SourceSession, type SourceSignIn } from '#contract/CoreMessages'

export const chromeAgent = (electronAgent: string, chromeVersion: string) => {
  const platform = /\(([^)]+)\)/.exec(electronAgent)?.[1] ?? 'Windows NT 10.0; Win64; x64'
  const major = chromeVersion.split('.')[0] ?? '0'

  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

export const isOnSites = (url: string, sites: ReadonlyArray<string>) => {
  const host = URL.parse(url)?.hostname.toLowerCase()

  return host !== undefined && sites.some((site) => host === site || host.endsWith(`.${site}`))
}

export const browserCandidates = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
) => {
  if (platform !== 'win32') {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    ]
  }

  const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']].filter(
    Predicate.isString,
  )

  return [
    ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
  ]
}

export const browserArgs = (profile: string, port: number, url: string) => [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--new-window',
  url,
]

export const siteCookies = (
  cookies: ReadonlyArray<{
    readonly name: string
    readonly value: string
    readonly domain: string
  }>,
  sites: ReadonlyArray<string>,
): ReadonlyArray<SessionCookie> =>
  cookies
    .filter((cookie) => isOnSites(`https://${cookie.domain.replace(/^\./, '')}/`, sites))
    .map(({ name, value, domain }) => ({ name, value, domain }))

export const storageExpression = (keys: ReadonlyArray<string>) =>
  `Object.fromEntries([${keys.map((key) => `'${key.replaceAll(/[^\w-]/g, '')}'`).join(', ')}]` +
  `.flatMap((key) => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]] }))`

const Version = Schema.Struct({
  webSocketDebuggerUrl: Schema.String,
  'User-Agent': Schema.String,
})

const Reply = Schema.Struct({
  id: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
})

const Cookies = Schema.Struct({
  cookies: Schema.Array(
    Schema.Struct({ name: Schema.String, value: Schema.String, domain: Schema.String }),
  ),
})

const Targets = Schema.Struct({
  targetInfos: Schema.Array(
    Schema.Struct({ targetId: Schema.String, type: Schema.String, url: Schema.String }),
  ),
})

const Attached = Schema.Struct({ sessionId: Schema.String })

const Evaluated = Schema.Struct({
  result: Schema.Struct({ value: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
})

const Outgoing = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
  params: Schema.Record(Schema.String, Schema.Unknown),
  sessionId: Schema.optional(Schema.String),
})

const decodeReply = Schema.decodeUnknownOption(Schema.fromJsonString(Reply))

const encodeOutgoing = Schema.encodeEffect(Schema.fromJsonString(Outgoing))

class SignInProblem extends Schema.TaggedError<SignInProblem>()('SignInProblem', {
  message: Schema.String,
}) {}

const couldNotOpen = () =>
  new SignInProblem({ message: 'Wenbu could not open the browser. Try again.' })

const freePort = Effect.callback<number, SignInProblem>((resume) => {
  const server = createServer()

  server.once('error', () => resume(Effect.fail(couldNotOpen())))

  server.listen(0, '127.0.0.1', () => {
    const address = server.address()

    const port =
      Predicate.hasProperty(address, 'port') && Predicate.isNumber(address.port) ? address.port : 0

    server.close(() => resume(Effect.succeed(port)))
  })
})

const waitForBrowser = (port: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.get(`http://127.0.0.1:${port}/json/version`)

    return yield* HttpClientResponse.schemaBodyJson(Version)(response)
  }).pipe(
    Effect.retry({ times: 60, schedule: Schedule.spaced('250 millis') }),
    Effect.mapError(
      () =>
        new SignInProblem({
          message: 'The browser did not start. Close any window it left open, then try again.',
        }),
    ),
  )

interface Devtools {
  readonly send: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
    sessionId?: string,
  ) => Effect.Effect<Option.Option<unknown>>
}

const openDevtools = Effect.fnUntraced(function* (url: string) {
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => new WebSocket(url)),
    (opened) => Effect.sync(() => opened.close()),
  )

  const pending = new Map<number, Deferred.Deferred<typeof Reply.Type>>()

  socket.addEventListener('message', (event) => {
    const reply = Option.getOrUndefined(decodeReply(String(event.data)))
    const deferred = reply?.id === undefined ? undefined : pending.get(reply.id)

    if (reply?.id !== undefined && deferred !== undefined) {
      pending.delete(reply.id)
      Deferred.doneUnsafe(deferred, Effect.succeed(reply))
    }
  })

  yield* Effect.callback<void, SignInProblem>((resume) => {
    socket.addEventListener('open', () => resume(Effect.void))
    socket.addEventListener('error', () => resume(Effect.fail(couldNotOpen())))
  })

  let next = 0

  const send: Devtools['send'] = (method, params = {}, sessionId) =>
    Effect.gen(function* () {
      if (socket.readyState !== WebSocket.OPEN) {
        return Option.none()
      }

      next += 1

      const id = next
      const deferred = yield* Deferred.make<typeof Reply.Type>()

      pending.set(id, deferred)

      const message = yield* encodeOutgoing({
        id,
        method,
        params,
        ...(sessionId === undefined ? {} : { sessionId }),
      })

      socket.send(message)

      const reply = yield* Deferred.await(deferred).pipe(Effect.timeoutOption('10 seconds'))

      return Option.flatMap(reply, (answer) =>
        answer.error === undefined ? Option.fromNullishOr(answer.result) : Option.none(),
      )
    }).pipe(Effect.orElseSucceed(() => Option.none()))

  return { send } satisfies Devtools
})

const decodeAs =
  <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  (value: Option.Option<unknown>) =>
    Option.flatMap(value, (found) => Schema.decodeUnknownOption(schema)(found))

interface Snapshot {
  readonly cookies: ReadonlyArray<SessionCookie>
  readonly storage: Readonly<Record<string, string>>
  readonly sawSite: boolean
}

const takeSnapshot = Effect.fnUntraced(function* (
  devtools: Devtools,
  request: SourceSignIn,
  previous: Snapshot,
) {
  const cookies = decodeAs(Cookies)(yield* devtools.send('Storage.getCookies'))
  const targets = decodeAs(Targets)(yield* devtools.send('Target.getTargets'))

  const pages = Option.match(targets, {
    onNone: () => [],
    onSome: (found) => found.targetInfos.filter((target) => target.type === 'page'),
  })

  const sitePage = pages.find((page) => isOnSites(page.url, request.sites))
  let storage = previous.storage

  if (sitePage !== undefined && request.storageKeys.length > 0) {
    const attached = decodeAs(Attached)(
      yield* devtools.send('Target.attachToTarget', { targetId: sitePage.targetId, flatten: true }),
    )

    if (Option.isSome(attached)) {
      const evaluated = decodeAs(Evaluated)(
        yield* devtools.send(
          'Runtime.evaluate',
          { expression: storageExpression(request.storageKeys), returnByValue: true },
          attached.value.sessionId,
        ),
      )

      storage = { ...previous.storage, ...Option.getOrUndefined(evaluated)?.result.value }
      yield* devtools.send('Target.detachFromTarget', { sessionId: attached.value.sessionId })
    }
  }

  const snapshot: Snapshot = {
    cookies: Option.match(cookies, {
      onNone: () => previous.cookies,
      onSome: (found) => siteCookies(found.cookies, request.sites),
    }),
    storage,
    sawSite: previous.sawSite || sitePage !== undefined,
  }

  return { snapshot, openPages: pages.length }
})

const signInThroughBrowser = Effect.fnUntraced(function* (
  request: SourceSignIn,
  folder: string,
  opened: (devtools: Devtools) => void,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  const browser = yield* Effect.findFirst(
    browserCandidates(process.platform, process.env),
    (candidate) => fs.exists(candidate).pipe(Effect.orElseSucceed(() => false)),
  )

  if (Option.isNone(browser)) {
    return yield* new SignInProblem({
      message:
        'Wenbu signs in through Google Chrome or Microsoft Edge. Install one, then try again.',
    })
  }

  const profile = path.join(folder, request.source)

  yield* fs.makeDirectory(profile, { recursive: true }).pipe(Effect.mapError(couldNotOpen))

  const port = yield* freePort

  const handle = yield* spawner
    .spawn(
      ChildProcess.make(browser.value, browserArgs(profile, port, request.url), {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    )
    .pipe(Effect.mapError(couldNotOpen))

  const version = yield* waitForBrowser(port)
  const devtools = yield* openDevtools(version.webSocketDebuggerUrl)
  let snapshot: Snapshot = { cookies: [], storage: {}, sawSite: false }

  opened(devtools)

  const poll = Effect.suspend(() => takeSnapshot(devtools, request, snapshot)).pipe(
    Effect.map((next) => {
      snapshot = next.snapshot

      return next.openPages === 0 && next.snapshot.sawSite
    }),
  )

  // Edge keeps running in the background after its last window closes.
  const lastWindowClosed = Effect.repeat(poll, {
    schedule: Schedule.spaced('2 seconds'),
    until: (done) => done,
  })

  yield* Effect.raceFirst(Effect.ignore(handle.exitCode), Effect.asVoid(lastWindowClosed))
  yield* devtools.send('Browser.close')

  return SourceSession.make({
    source: request.source,
    cookies: snapshot.cookies,
    userAgent: version['User-Agent'],
    storage: snapshot.storage,
  })
}, Effect.scoped)

interface SignInsOptions {
  readonly folder: string
  readonly deliver: (session: SourceSession) => void
}

const Services = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)

export const browserSignIns = (options: SignInsOptions) => {
  const running = new Map<string, Fiber.Fiber<void>>()
  const consoles = new Map<string, Devtools>()

  const nothing = (source: string, problem?: string) =>
    SourceSession.make({
      source,
      cookies: [],
      userAgent: '',
      storage: {},
      ...(problem === undefined ? {} : { problem }),
    })

  const show = (request: SourceSignIn) => {
    const devtools = consoles.get(request.source)

    if (devtools !== undefined) {
      Effect.runFork(devtools.send('Target.createTarget', { url: request.url }))

      return
    }

    if (running.has(request.source)) {
      return
    }

    const fiber = Effect.runFork(
      signInThroughBrowser(request, options.folder, (opened) =>
        consoles.set(request.source, opened),
      ).pipe(
        Effect.matchCause({
          onSuccess: (session) => options.deliver(session),
          onFailure: (cause) => {
            const problem = Option.getOrUndefined(Cause.findErrorOption(cause))

            options.deliver(
              nothing(
                request.source,
                Cause.hasInterruptsOnly(cause)
                  ? undefined
                  : (problem?.message ?? couldNotOpen().message),
              ),
            )
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            running.delete(request.source)
            consoles.delete(request.source)
          }),
        ),
        Effect.provide(Services),
      ),
    )

    running.set(request.source, fiber)
  }

  const forget = (source: string) => {
    const fiber = running.get(source)

    Effect.runFork(
      Effect.gen(function* () {
        if (fiber !== undefined) {
          yield* Fiber.interrupt(fiber)
        }

        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        // The browser holds its profile open for a moment after it exits.
        yield* fs
          .remove(path.join(options.folder, source), { recursive: true })
          .pipe(Effect.retry({ times: 10, schedule: Schedule.spaced('500 millis') }), Effect.ignore)
      }).pipe(Effect.provide(NodeServices.layer)),
    )
  }

  return { show, forget }
}
