import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, describe, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Option, Path, Redacted, Schema, Stream } from 'effect'
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from 'effect/http'
import { KeyValueStore } from 'effect/persistence'
import { RpcTest } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { SourceSession } from '#contract/CoreMessages'
import {
  canResume,
  defaultDownloadSettings,
  DownloadJob,
  DownloadSettings,
  DownloadsRpc,
  type DownloadsState,
} from '#contract/Downloads'
import { reserveBytes } from '#contract/Storage'
import { Credentials } from '../llm/Credentials'
import * as Database from '../platform/Database'
import { DiskSpace } from '../platform/DiskSpace'
import * as SettingsStore from '../platform/SettingsStore'
import { DownloadsRpcLive } from './Downloads'
import { Pacing } from './GallerySource'
import { SignInWindows } from './SignInWindows'

type Reply = Response | 'offline' | undefined

type Route = (url: string, request: HttpClientRequest.HttpClientRequest) => Reply

const image = (type = 'image/jpeg') =>
  new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': type } })

const html = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=UTF-8' } })

const nhentaiGallery = {
  id: 123,
  title: { english: 'Summer: Festival', japanese: '夏祭り' },
  tags: [
    { type: 'artist', name: 'koari' },
    { type: 'language', name: 'translated' },
  ],
  pages: [
    { number: 1, path: 'galleries/9/1.jpg' },
    { number: 2, path: 'galleries/9/2.png' },
    { number: 3, path: 'galleries/9/3.jpg' },
  ],
}

const nhentai: Route = (url) => {
  if (url === 'https://nhentai.net/api/v2/galleries/123') {
    return Response.json(nhentaiGallery)
  }

  if (/^https:\/\/i\d\.nhentai\.net\/galleries\/9\/\d\.png$/.test(url)) {
    return image('image/png')
  }

  return /^https:\/\/i\d\.nhentai\.net\/galleries\/9\/\d\.jpg$/.test(url) ? image() : undefined
}

const exGallery = `
  <h1 id="gn">Office &amp; Diaries</h1><h1 id="gj">オフィス日記</h1>
  <td class="gdt1">Length:</td><td class="gdt2">2 pages</td>
  <div id="td_artist:sato_ken" class="gtl"></div>
  <a href="https://e-hentai.org/s/aaaaaaaaaa/777-1">1</a>
  <a href="https://e-hentai.org/s/bbbbbbbbbb/777-2">2</a>`

const exPage = (number: number) => `
  <img id="img" src="https://h.hath.network/resampled/${number}.webp" />
  <a href="https://e-hentai.org/fullimg/777/${number}/xyz/${number}.jpg">Download original 2290 x 3028 5.35 MiB source</a>`

const exhentai =
  (gp: 'enough' | 'none'): Route =>
  (url) => {
    if (url === 'https://e-hentai.org/g/777/0123456789/') {
      return html(exGallery)
    }

    const page = /^https:\/\/e-hentai\.org\/s\/\w+\/777-(\d)$/.exec(url)

    if (page !== null) {
      return html(exPage(Number(page[1])))
    }

    if (url.startsWith('https://e-hentai.org/fullimg/')) {
      return gp === 'enough'
        ? image()
        : html(
            '<p>Downloading original files of this gallery requires GP, and you do not have enough.</p>',
          )
    }

    if (url.startsWith('https://h.hath.network/resampled/')) {
      return image('image/webp')
    }

    if (url === 'https://e-hentai.org/home.php') {
      return html(
        '<p>You are currently at <strong>10</strong> towards a limit of <strong>5,000</strong>.</p>',
      )
    }

    return url === 'https://exhentai.org/' ? new Response('') : undefined
  }

const signedInWindow = SourceSession.make({
  source: 'exhentai',
  cookies: [
    { name: 'ipb_member_id', value: '42', domain: '.e-hentai.org' },
    { name: 'ipb_pass_hash', value: 'hash', domain: '.e-hentai.org' },
  ],
  userAgent: 'Test Browser',
  storage: {},
})

const CredentialsTest = Layer.effect(
  Credentials,
  Credentials.make({
    key: Redacted.make('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
    protection: 'os',
  }),
)

const fakeHttp = (route: Route, requests: Array<string>) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      requests.push(request.url)

      const reply = route(request.url, request)

      if (reply === 'offline') {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: 'offline' }),
          }),
        )
      }

      return Effect.succeed(
        HttpClientResponse.fromWeb(request, reply ?? new Response('missing', { status: 404 })),
      )
    }),
  )

interface Options {
  readonly route: Route
  readonly settings?: Partial<DownloadSettings>
  readonly saved?: ReadonlyArray<DownloadJob>
  readonly window?: SourceSession
  readonly freeBytes?: number
}

const encodeJob = Schema.encodeEffect(Schema.fromJsonString(DownloadJob))

const setup = Effect.fn(function* (options: Options) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped()
  const folder = path.join(root, 'Downloads')
  const requests: Array<string> = []

  const storage = yield* Layer.build(
    KeyValueStore.layerSql({ table: 'settings' }).pipe(
      Layer.provideMerge(Database.layer(':memory:')),
    ),
  )

  const settings: DownloadSettings = { ...defaultDownloadSettings, folder, ...options.settings }

  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* SettingsStore.make(
      yield* KeyValueStore.KeyValueStore,
      DownloadSettings,
      defaultDownloadSettings,
    ).set('downloads', settings)

    for (const job of options.saved ?? []) {
      yield* sql`INSERT INTO download_jobs ${sql.insert({
        id: job.id,
        created_at: job.createdAt,
        status: job.status,
        job: yield* encodeJob(job),
      })}`
    }
  }).pipe(Effect.provideContext(storage), Effect.orDie)

  const windows = Layer.succeed(SignInWindows)({
    open: () =>
      Effect.succeed(
        options.window ??
          SourceSession.make({ source: 'exhentai', cookies: [], userAgent: '', storage: {} }),
      ),
    forget: () => Effect.void,
  })

  const layer = DownloadsRpcLive.pipe(
    Layer.provide([
      fakeHttp(options.route, requests),
      windows,
      CredentialsTest,
      Layer.succeed(Pacing)(0),
      Layer.succeedContext(storage),
      DiskSpace.fixed(options.freeBytes ?? 100 * 1024 ** 3),
    ]),
  )

  const context = yield* Layer.build(layer)
  const client = yield* RpcTest.makeClient(DownloadsRpc).pipe(Effect.provideContext(context))

  const until = (predicate: (state: DownloadsState) => boolean) =>
    client
      .watchDownloads()
      .pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout('10 seconds'),
      )

  const settle = (id: string) =>
    Effect.map(
      until((state) =>
        state.jobs.some((job) => job.id === id && !['queued', 'running'].includes(job.status)),
      ),
      (state) => Option.getOrThrow(Option.fromNullishOr(state.jobs.find((job) => job.id === id))),
    )

  return { client, folder, path, fs, requests, until, settle }
})

describe('Downloads', () => {
  it.live('downloads every page into a folder named after the gallery', () =>
    Effect.gen(function* () {
      const { client, folder, path, fs, settle } = yield* setup({ route: nhentai })
      const id = yield* client.startDownload({ url: 'https://nhentai.net/g/123/' })
      const job = yield* settle(id)
      const gallery = path.join(folder, 'Summer Festival')

      assert.strictEqual(job.status, 'finished')
      assert.strictEqual(job.title, 'Summer: Festival')
      assert.strictEqual(job.folder, gallery)
      assert.deepStrictEqual(job.pages, { total: 3, done: 3 })

      assert.deepStrictEqual((yield* fs.readDirectory(gallery)).toSorted(), [
        '001.jpg',
        '002.png',
        '003.jpg',
        'info.json',
      ])

      const details = yield* fs.readFileString(path.join(gallery, 'info.json'))

      assert.include(details, '"artists":["koari"]')
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('stops a download the drive has no room for, and keeps it resumable', () =>
    Effect.gen(function* () {
      const { client, settle } = yield* setup({ route: nhentai, freeBytes: reserveBytes })
      const id = yield* client.startDownload({ url: 'https://nhentai.net/g/123/' })
      const job = yield* settle(id)

      assert.strictEqual(job.status, 'failed')
      assert.strictEqual(job.problem?.reason, 'disk')
      assert.strictEqual(job.problem?.space?.freeBytes, reserveBytes)
      assert.isTrue(canResume(job))
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('resumes from the next page that is not saved yet', () =>
    Effect.gen(function* () {
      const { client, folder, path, fs, requests, settle } = yield* setup({ route: nhentai })
      const gallery = path.join(folder, 'Summer Festival')

      yield* fs.makeDirectory(gallery, { recursive: true })
      yield* fs.writeFile(path.join(gallery, '001.jpg'), new Uint8Array([9]))
      yield* fs.writeFile(path.join(gallery, '002.png'), new Uint8Array([9]))

      const job = yield* settle(yield* client.startDownload({ url: 'https://nhentai.net/g/123/' }))
      const images = requests.filter((url) => url.includes('.nhentai.net/galleries/'))

      assert.strictEqual(job.status, 'finished')
      assert.deepStrictEqual(job.pages, { total: 3, done: 3 })

      assert.deepStrictEqual(
        images.map((url) => url.slice(-5)),
        ['3.jpg'],
      )
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('tries again when the connection drops', () =>
    Effect.gen(function* () {
      let dropped = false

      const flaky: Route = (url, request) => {
        if (url.endsWith('/2.png') && !dropped) {
          dropped = true

          return 'offline'
        }

        return nhentai(url, request)
      }

      const { client, requests, settle } = yield* setup({ route: flaky })
      const job = yield* settle(yield* client.startDownload({ url: 'https://nhentai.net/g/123/' }))

      assert.strictEqual(job.status, 'finished')
      assert.strictEqual(job.activity, undefined)
      assert.strictEqual(requests.filter((url) => url.endsWith('/2.png')).length, 2)
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('fails with the reason once the connection stays down', () =>
    Effect.gen(function* () {
      const offline: Route = (url, request) =>
        url.endsWith('/3.jpg') ? 'offline' : nhentai(url, request)

      const { client, settle } = yield* setup({ route: offline })
      const job = yield* settle(yield* client.startDownload({ url: 'https://nhentai.net/g/123/' }))

      assert.strictEqual(job.status, 'failed')
      assert.strictEqual(job.problem?.reason, 'network')
      assert.deepStrictEqual(job.pages, { total: 3, done: 2 })
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  const runningJob = DownloadJob.make({
    id: 'job-1',
    url: 'https://nhentai.net/g/123/',
    source: 'nhentai',
    title: 'Summer: Festival',
    status: 'running',
    attempt: 1,
    pages: { total: 3, done: 1 },
    bytes: 4,
    activity: 'Reading the gallery',
    reducedQuality: false,
    createdAt: '2026-10-24T10:00:00.000Z',
  })

  it.live('marks a download Wenbu closed during as interrupted, ready to resume', () =>
    Effect.gen(function* () {
      const { client, until, settle } = yield* setup({
        route: nhentai,
        settings: { resumeOnStart: false },
        saved: [runningJob],
      })

      const state = yield* until((current) => current.jobs.length === 1)

      assert.strictEqual(state.jobs[0]?.status, 'interrupted')
      assert.strictEqual(state.jobs[0]?.activity, undefined)

      yield* client.resumeDownload({ jobId: 'job-1' })

      const job = yield* settle('job-1')

      assert.strictEqual(job.status, 'finished')
      assert.strictEqual(job.attempt, 2)
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('resumes interrupted downloads on start when the setting is on', () =>
    Effect.gen(function* () {
      const { settle } = yield* setup({ route: nhentai, saved: [runningJob] })
      const job = yield* settle('job-1')

      assert.strictEqual(job.status, 'finished')
      assert.deepStrictEqual(job.pages, { total: 3, done: 3 })
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  const isReady = (state: DownloadsState) =>
    state.accounts.some((account) => account.source === 'exhentai' && account.status === 'ready')

  it.live('downloads ExHentai originals for a signed-in account', () =>
    Effect.gen(function* () {
      const { client, until, settle, requests } = yield* setup({
        route: exhentai('enough'),
        window: signedInWindow,
      })

      yield* client.signInToSource({ source: 'exhentai' })

      const state = yield* until(isReady)

      assert.strictEqual(
        state.accounts.find((account) => account.source === 'exhentai')?.detail,
        'Image limits 10 of 5,000 · E-Hentai only',
      )

      const job = yield* settle(
        yield* client.startDownload({ url: 'https://exhentai.org/g/777/0123456789/' }),
      )

      assert.strictEqual(job.status, 'finished')
      assert.strictEqual(job.title, 'Office & Diaries')
      assert.isFalse(job.reducedQuality)
      assert.strictEqual(requests.filter((url) => url.includes('/fullimg/')).length, 2)
      assert.isFalse(requests.some((url) => url.includes('/resampled/')))
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('asks before finishing at reduced quality when GP runs out', () =>
    Effect.gen(function* () {
      const { client, until, settle, folder, path, fs } = yield* setup({
        route: exhentai('none'),
        window: signedInWindow,
      })

      yield* client.signInToSource({ source: 'exhentai' })
      yield* until(isReady)

      const id = yield* client.startDownload({ url: 'https://e-hentai.org/g/777/0123456789/' })

      const waiting = yield* until((current) =>
        current.jobs.some((job) => job.id === id && job.status === 'waiting'),
      )

      assert.deepStrictEqual(waiting.jobs.find((job) => job.id === id)?.question, {
        reason: 'not-enough-gp',
        remaining: 2,
      })

      yield* client.answerDownload({ jobId: id, accept: true })

      const job = yield* settle(id)

      assert.strictEqual(job.status, 'finished')
      assert.isTrue(job.reducedQuality)

      assert.deepStrictEqual(
        (yield* fs.readDirectory(path.join(folder, 'Office & Diaries'))).toSorted(),
        ['001.webp', '002.webp', 'info.json'],
      )
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('stops when the user declines reduced quality', () =>
    Effect.gen(function* () {
      const { client, until, settle } = yield* setup({ route: exhentai('none') })
      const id = yield* client.startDownload({ url: 'https://e-hentai.org/g/777/0123456789/' })

      const waiting = yield* until((current) =>
        current.jobs.some((job) => job.id === id && job.status === 'waiting'),
      )

      assert.strictEqual(waiting.jobs[0]?.question?.reason, 'signed-out')

      yield* client.answerDownload({ jobId: id, accept: false })

      const job = yield* settle(id)

      assert.strictEqual(job.status, 'cancelled')
      assert.strictEqual(job.question, undefined)
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('refuses links it cannot download', () =>
    Effect.gen(function* () {
      const { client } = yield* setup({
        route: nhentai,
        settings: { enabledSources: ['exhentai', 'hdoujin', 'hitomi'] },
      })

      const unsupported = yield* Effect.flip(
        client.startDownload({ url: 'https://example.com/g/1' }),
      )

      const disabled = yield* Effect.flip(
        client.startDownload({ url: 'https://nhentai.net/g/123/' }),
      )

      assert.strictEqual(unsupported.reason, 'invalid')
      assert.strictEqual(disabled.reason, 'disabled')
      assert.strictEqual(disabled.message, 'NHentai is turned off in Settings › Downloads.')
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('needs a download folder before starting', () =>
    Effect.gen(function* () {
      const { client } = yield* setup({ route: nhentai, settings: { folder: '' } })
      const error = yield* Effect.flip(client.startDownload({ url: 'https://nhentai.net/g/123/' }))

      assert.strictEqual(error.reason, 'no-folder')
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('keeps the account signed out when the browser closes early', () =>
    Effect.gen(function* () {
      const { client, until } = yield* setup({ route: exhentai('enough') })

      yield* client.signInToSource({ source: 'exhentai' })

      const state = yield* until((current) =>
        current.accounts.some(
          (account) => account.source === 'exhentai' && account.status === 'signed-out',
        ),
      )

      const account = state.accounts.find((candidate) => candidate.source === 'exhentai')

      assert.strictEqual(account?.message, 'The browser closed before the sign-in finished.')
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('counts E-Hentai sending Wenbu to its login page as a failed sign-in', () =>
    Effect.gen(function* () {
      const loginPage: Route = (url, request) =>
        url === 'https://e-hentai.org/home.php'
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://e-hentai.org/bounce_login.php?b=d&bt=1-1' },
            })
          : exhentai('enough')(url, request)

      const { client, until } = yield* setup({ route: loginPage, window: signedInWindow })

      yield* client.signInToSource({ source: 'exhentai' })

      const state = yield* until((current) =>
        current.accounts.some(
          (account) => account.source === 'exhentai' && account.status === 'expired',
        ),
      )

      assert.include(
        state.accounts.find((account) => account.source === 'exhentai')?.message,
        'login page',
      )
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('signs in to ExHentai even when home.php words its limits differently', () =>
    Effect.gen(function* () {
      const reworded: Route = (url, request) =>
        url === 'https://e-hentai.org/home.php'
          ? html('<h1>Overview</h1><p>Welcome back</p>')
          : exhentai('enough')(url, request)

      const { client, until } = yield* setup({ route: reworded, window: signedInWindow })

      yield* client.signInToSource({ source: 'exhentai' })

      const state = yield* until(isReady)

      assert.strictEqual(
        state.accounts.find((account) => account.source === 'exhentai')?.detail,
        'E-Hentai only',
      )
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  const handshake =
    (igneous: string): Route =>
    (url, request) => {
      const cookie = request.headers['cookie'] ?? ''

      if (url === 'https://exhentai.org/') {
        return cookie.includes('igneous=')
          ? html(igneous === 'mystery' ? '' : '<title>ExHentai.org</title>')
          : new Response(null, {
              status: 302,
              headers: { location: 'https://forums.e-hentai.org/remoteapi.php?ex=token' },
            })
      }

      if (url === 'https://forums.e-hentai.org/remoteapi.php?ex=token') {
        return cookie.includes('ipb_member_id=42')
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://exhentai.org/?poni=token' },
            })
          : undefined
      }

      if (url === 'https://exhentai.org/?poni=token') {
        return new Response(null, {
          status: 302,
          headers: {
            location: '/',
            'set-cookie': `igneous=${igneous}; domain=.exhentai.org; path=/`,
          },
        })
      }

      return exhentai('enough')(url, request)
    }

  it.live('follows exhentai.org through the forum and keeps the cookie it grants', () =>
    Effect.gen(function* () {
      const { client, until, requests } = yield* setup({
        route: handshake('granted'),
        window: signedInWindow,
      })

      yield* client.signInToSource({ source: 'exhentai' })

      const state = yield* until(isReady)

      assert.strictEqual(
        state.accounts.find((account) => account.source === 'exhentai')?.detail,
        'Image limits 10 of 5,000 · ExHentai access',
      )

      assert.deepStrictEqual(
        requests.filter((url) => url.includes('exhentai.org') || url.includes('remoteapi')),
        [
          'https://exhentai.org/',
          'https://forums.e-hentai.org/remoteapi.php?ex=token',
          'https://exhentai.org/?poni=token',
          'https://exhentai.org/',
        ],
      )
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )

  it.live('reports E-Hentai only for an account ExHentai turns away', () =>
    Effect.gen(function* () {
      const { client, until } = yield* setup({
        route: handshake('mystery'),
        window: signedInWindow,
      })

      yield* client.signInToSource({ source: 'exhentai' })

      const state = yield* until(isReady)

      assert.strictEqual(
        state.accounts.find((account) => account.source === 'exhentai')?.detail,
        'Image limits 10 of 5,000 · E-Hentai only',
      )
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  )
})
