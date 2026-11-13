import {
  Cause,
  Clock,
  Config,
  Crypto,
  DateTime,
  Deferred,
  Effect,
  FiberMap,
  FileSystem,
  Option,
  Path,
  Redacted,
  Result,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect'
import type { HttpClient } from 'effect/http'
import { KeyValueStore } from 'effect/persistence'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  canResume,
  defaultDownloadSettings,
  DownloadError,
  DownloadJob,
  type DownloadProblem,
  type DownloadQuestion,
  DownloadSettings,
  DownloadsRpc,
  isActive,
  type SourceAccount,
  SourceId,
  sourceName,
  sources as sourceInfo,
} from '#contract/Downloads'
import { NotEnoughSpace } from '#contract/Storage'
import { Credentials } from '../llm/Credentials'
import { DiskSpace, nextFileBytes } from '../platform/DiskSpace'
import * as SettingsStore from '../platform/SettingsStore'
import { ExHentai } from './ExHentai'
import {
  extensionFor,
  galleryDetails,
  galleryFolder,
  detailsFile,
  encodeDetails,
  pageStem,
  savedPages,
  titleFor,
} from './GalleryFiles'
import {
  type GalleryPage,
  type GallerySource,
  type ImageRequest,
  pause,
  send,
  Session,
  type SourceContext,
  SourceProblem,
} from './GallerySource'
import { HDoujin } from './HDoujin'
import { Hitomi } from './Hitomi'
import { NHentai } from './NHentai'
import { SignInWindows } from './SignInWindows'

export const gallerySources: ReadonlyArray<GallerySource> = [ExHentai, HDoujin, Hitomi, NHentai]

const settingsKey = 'downloads'

const historyLimit = 100

/** Some sites refuse agents that are not a browser's. */
const chromeAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

const retryDelays = [2, 4, 8, 16, 30, 60] as const

const JobRow = Schema.Struct({ job: Schema.fromJsonString(DownloadJob) })

const SessionRow = Schema.Struct({ source: SourceId, session: Schema.String })

const encodeJob = Schema.encodeEffect(Schema.fromJsonString(DownloadJob))

const SessionJson = Schema.fromJsonString(Session)

class Declined extends Schema.TaggedError<Declined>()('Declined', {}) {}

const invalid = (field: string, message: string) =>
  new DownloadError({ reason: 'invalid', field, message })

const sourceOf = (id: SourceId) => gallerySources.find((source) => source.id === id) ?? NHentai

const parseLink = (text: string) => {
  const url = URL.parse(text.trim())

  return url !== null && (url.protocol === 'https:' || url.protocol === 'http:')
    ? Option.some(url)
    : Option.none()
}

const withoutProgress = (job: DownloadJob) => {
  const {
    activity: _activity,
    bytesPerSecond: _speed,
    secondsLeft: _left,
    question: _question,
    ...rest
  } = job

  return rest
}

export const DownloadsRpcLive = DownloadsRpc.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const credentials = yield* Credentials
    const windows = yield* SignInWindows
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const disk = yield* DiskSpace
    const path = yield* Path.Path
    const services = yield* Effect.context<HttpClient.HttpClient | FileSystem.FileSystem>()

    const userAgent = yield* Config.String('WENBU_USER_AGENT').pipe(Config.withDefault(chromeAgent))

    const store = SettingsStore.make(
      yield* KeyValueStore.KeyValueStore,
      DownloadSettings,
      defaultDownloadSettings,
    )

    const getSettings = Effect.orDie(store.get(settingsKey))
    const now = Effect.map(DateTime.now, DateTime.formatIso)

    const recentJobs = SqlSchema.findAll({
      Request: Schema.Number,
      Result: JobRow,
      execute: (limit) =>
        sql`SELECT job FROM download_jobs ORDER BY created_at DESC LIMIT ${limit}`,
    })

    const storedSessions = SqlSchema.findAll({
      Request: Schema.Void,
      Result: SessionRow,
      execute: () => sql`SELECT source, session FROM download_sessions`,
    })

    const save = Effect.fnUntraced(function* (job: DownloadJob) {
      const json = yield* encodeJob(job)

      yield* sql`INSERT INTO download_jobs ${sql.insert({
        id: job.id,
        created_at: job.createdAt,
        status: job.status,
        job: json,
      })} ON CONFLICT(id) DO UPDATE SET status = excluded.status, job = excluded.job`
    }, Effect.orDie)

    const sessions = new Map<SourceId, Session>()

    for (const row of yield* Effect.orDie(storedSessions(undefined))) {
      const opened = yield* credentials.open(row.session).pipe(
        Effect.flatMap((secret) => Schema.decodeUnknownEffect(SessionJson)(Redacted.value(secret))),
        Effect.option,
      )

      if (Option.isSome(opened)) {
        sessions.set(row.source, opened.value)
      }
    }

    const saveSession = Effect.fnUntraced(function* (source: SourceId, session: Session) {
      const json = yield* Effect.orDie(Schema.encodeEffect(SessionJson)(session))
      const sealed = yield* credentials.seal(Redacted.make(json))

      sessions.set(source, session)

      yield* Effect.orDie(
        sql`INSERT INTO download_sessions ${sql.insert({
          source,
          session: sealed,
          saved_at: yield* now,
        })} ON CONFLICT(source) DO UPDATE SET session = excluded.session, saved_at = excluded.saved_at`,
      )
    })

    const initialAccount = (info: (typeof sourceInfo)[number]): SourceAccount => {
      if (!info.signIn) {
        return { source: info.id, status: 'open' }
      }

      return { source: info.id, status: sessions.has(info.id) ? 'ready' : 'signed-out' }
    }

    const accounts = yield* SubscriptionRef.make<ReadonlyArray<SourceAccount>>(
      sourceInfo.map(initialAccount),
    )

    const setAccount = (account: SourceAccount) =>
      SubscriptionRef.update(accounts, (all) =>
        all.map((current) => (current.source === account.source ? account : current)),
      )

    const contextFor = (source: SourceId, settings: DownloadSettings): SourceContext => ({
      session: Option.fromNullishOr(sessions.get(source)),
      userAgent,
      settings,
    })

    const loaded = (yield* Effect.orDie(recentJobs(historyLimit))).map((row) => row.job)
    const startupSettings = yield* getSettings

    const restored = yield* Effect.forEach(loaded, (job) =>
      Effect.gen(function* () {
        if (!isActive(job.status)) {
          return job
        }

        const interrupted = DownloadJob.make({ ...withoutProgress(job), status: 'interrupted' })

        const next = startupSettings.resumeOnStart
          ? DownloadJob.make({
              ...withoutProgress(job),
              status: 'queued',
              attempt: job.attempt + 1,
            })
          : interrupted

        yield* save(next)

        return next
      }),
    )

    const jobs = yield* SubscriptionRef.make<ReadonlyArray<DownloadJob>>(restored)

    const find = (id: string) =>
      Effect.map(SubscriptionRef.get(jobs), (all) =>
        Option.fromNullishOr(all.find((job) => job.id === id)),
      )

    const update = (id: string, change: (job: DownloadJob) => DownloadJob) =>
      SubscriptionRef.update(jobs, (all) => all.map((job) => (job.id === id ? change(job) : job)))

    const persist = Effect.fnUntraced(function* (id: string) {
      const job = yield* find(id)

      if (Option.isSome(job)) {
        yield* save(job.value)
      }
    })

    const fibers = yield* FiberMap.make<string>()
    const signIns = yield* FiberMap.make<SourceId>()
    const pumpLock = yield* Semaphore.make(1)
    const questions = new Map<string, Deferred.Deferred<boolean>>()
    const cancelling = new Set<string>()

    const setActivity = (id: string, activity: string | undefined) =>
      update(id, (job) => {
        const { activity: _previous, ...rest } = job

        return DownloadJob.make(activity === undefined ? rest : { ...rest, activity })
      })

    const withRetries = <A, E, R>(id: string, effect: Effect.Effect<A, E | SourceProblem, R>) => {
      const attempt = (index: number): Effect.Effect<A, E | SourceProblem, R> =>
        effect.pipe(
          Effect.catchIf(
            (error): error is SourceProblem =>
              Schema.is(SourceProblem)(error) &&
              error.transient === true &&
              index < retryDelays.length,
            (error) => {
              const seconds = retryDelays[index] ?? 60

              return setActivity(id, `${error.message} · trying again in ${seconds} s`).pipe(
                Effect.andThen(pause(seconds)),
                Effect.andThen(attempt(index + 1)),
              )
            },
          ),
        )

      return attempt(0).pipe(Effect.tap(() => clearRetryActivity(id)))
    }

    const clearRetryActivity = (id: string) =>
      Effect.flatMap(find(id), (job) =>
        Option.exists(job, (found) => found.activity?.includes('trying again') === true)
          ? setActivity(id, undefined)
          : Effect.void,
      )

    const imageResponse = Effect.fnUntraced(function* (
      request: ImageRequest,
      context: SourceContext,
      page: number,
    ) {
      const response = yield* send(request.url, context, { headers: request.headers })

      if (response.status === 404) {
        return yield* new SourceProblem({
          reason: 'failed',
          message: `Page ${page} is missing on the site.`,
        })
      }

      if (response.status < 200 || response.status >= 300) {
        return yield* new SourceProblem({
          reason: response.status === 401 || response.status === 403 ? 'sign-in' : 'failed',
          message: `The site refused page ${page} (${response.status}).`,
        })
      }

      if ((response.headers['content-type'] ?? '').startsWith('text/html')) {
        const body = yield* response.text.pipe(Effect.orElseSucceed(() => ''))

        return yield* (
          request.explainPage?.(body) ??
            new SourceProblem({
              reason: 'failed',
              message: `The site sent a web page instead of page ${page}.`,
            })
        )
      }

      return response
    })

    const execute = Effect.fnUntraced(function* (id: string) {
      const job = yield* Effect.flatMap(find(id), (found) =>
        Option.match(found, {
          onNone: () => Effect.interrupt,
          onSome: Effect.succeed,
        }),
      )

      const settings = yield* getSettings
      const source = sourceOf(job.source)
      const context = contextFor(job.source, settings)
      const startedAt = yield* Clock.currentTimeMillis
      let reduced = job.reducedQuality
      let question: Option.Option<Deferred.Deferred<boolean>> = Option.none()

      yield* update(id, (current) => {
        const { problem: _problem, finishedAt: _finished, ...rest } = withoutProgress(current)

        return DownloadJob.make({ ...rest, status: 'running', activity: 'Reading the gallery' })
      })

      const gallery = yield* withRetries(id, source.resolve(new URL(job.url), context))
      const folder = job.folder ?? galleryFolder(path, settings, job.source, gallery)

      yield* disk.ensure(folder, nextFileBytes)
      yield* fs.makeDirectory(folder, { recursive: true })

      const saved = yield* savedPages(folder)
      const total = gallery.pages.length

      const savedBytes = yield* Effect.forEach(yield* fs.readDirectory(folder), (name) =>
        fs.stat(path.join(folder, name)).pipe(
          Effect.map((info) => (info.type === 'File' ? Number(info.size) : 0)),
          Effect.orElseSucceed(() => 0),
        ),
      ).pipe(Effect.map((sizes) => sizes.reduce((sum, size) => sum + size, 0)))

      let done = gallery.pages.filter((page) => saved.has(page.number)).length
      let bytes = savedBytes
      let pagesNow = 0
      let bytesNow = 0

      yield* update(id, (current) =>
        DownloadJob.make({
          ...withoutProgress(current),
          status: 'running',
          title: titleFor(gallery, settings),
          folder,
          pages: { total, done },
          bytes,
        }),
      )

      yield* persist(id)

      if (settings.saveDetails) {
        const details = yield* encodeDetails(
          galleryDetails(gallery, job.source, job.url, yield* now),
        )

        yield* fs.writeFileString(path.join(folder, detailsFile), `${details}\n`)
      }

      const progress = Effect.gen(function* () {
        const seconds = ((yield* Clock.currentTimeMillis) - startedAt) / 1000
        const speed = seconds > 1 ? bytesNow / seconds : undefined
        const left = pagesNow > 0 ? ((total - done) * seconds) / pagesNow : undefined

        yield* update(id, (current) =>
          DownloadJob.make({
            ...withoutProgress(current),
            ...(current.activity === undefined ? {} : { activity: current.activity }),
            ...(current.question === undefined ? {} : { question: current.question }),
            pages: { total, done },
            bytes,
            ...(speed === undefined ? {} : { bytesPerSecond: speed }),
            ...(left === undefined ? {} : { secondsLeft: left }),
          }),
        )
      })

      const askReduced = Effect.fnUntraced(function* (reason: DownloadQuestion['reason']) {
        if (reduced) {
          return
        }

        const pending = Option.getOrUndefined(question)
        const deferred = pending ?? (yield* Deferred.make<boolean>())

        if (pending === undefined) {
          question = Option.some(deferred)
          questions.set(id, deferred)

          yield* update(id, (current) =>
            DownloadJob.make({
              ...withoutProgress(current),
              status: 'waiting',
              question: { reason, remaining: total - done },
            }),
          )

          yield* persist(id)
        }

        const accepted = yield* Deferred.await(deferred)

        if (!accepted) {
          return yield* new Declined()
        }

        if (!reduced) {
          reduced = true
          questions.delete(id)

          yield* update(id, (current) =>
            DownloadJob.make({
              ...withoutProgress(current),
              status: 'running',
              reducedQuality: true,
            }),
          )

          yield* persist(id)
        }
      })

      const savePage = (page: GalleryPage, lower: boolean) =>
        Effect.gen(function* () {
          const request = yield* page.image(lower)
          const response = yield* imageResponse(request, context, page.number)
          const stem = pageStem(page.number, total)
          const part = path.join(folder, `${stem}.part`)
          let size = 0

          yield* response.stream.pipe(
            Stream.tap((chunk) =>
              Effect.sync(() => {
                size += chunk.length
              }),
            ),
            Stream.run(fs.sink(part)),
            disk.refine(folder),
            Effect.catchTag('HttpClientError', () =>
              Effect.fail(
                new SourceProblem({
                  reason: 'network',
                  message: `The connection dropped during page ${page.number}`,
                  transient: true,
                }),
              ),
            ),
            Effect.timeoutOrElse({
              duration: '3 minutes',
              orElse: () =>
                Effect.fail(
                  new SourceProblem({
                    reason: 'network',
                    message: `Page ${page.number} stopped downloading`,
                    transient: true,
                  }),
                ),
            }),
          )

          const extension = extensionFor(response.headers['content-type'], request.url)

          return { part, file: path.join(folder, `${stem}.${extension}`), size }
        })

      const downloadPage = Effect.fnUntraced(function* (page: GalleryPage) {
        yield* disk.ensure(folder, nextFileBytes)

        const file = yield* withRetries(id, savePage(page, reduced)).pipe(
          Effect.catchTag('ReducedQualityOnly', (wanted) =>
            Effect.andThen(askReduced(wanted.reason), withRetries(id, savePage(page, true))),
          ),
        )

        yield* fs.rename(file.part, file.file)

        done += 1
        pagesNow += 1
        bytes += file.size
        bytesNow += file.size

        yield* progress
        yield* persist(id)
      })

      const todo = gallery.pages.filter((page) => !saved.has(page.number))

      yield* setActivity(id, undefined)

      let failure: Option.Option<Effect.Error<ReturnType<typeof downloadPage>>> = Option.none()

      yield* Effect.forEach(
        todo,
        (page) =>
          Effect.suspend(() =>
            Option.isSome(failure)
              ? Effect.void
              : downloadPage(page).pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => {
                      failure = Option.orElse(failure, () => Option.some(error))
                    }),
                  ),
                ),
          ),
        { concurrency: source.pageConcurrency, discard: true },
      )

      if (Option.isSome(failure)) {
        return yield* Effect.fail(failure.value)
      }
    })

    const finish = Effect.fnUntraced(function* (
      id: string,
      status: DownloadJob['status'],
      problem?: DownloadProblem,
    ) {
      const finishedAt = yield* now

      questions.delete(id)
      cancelling.delete(id)

      yield* update(id, (current) => {
        const { problem: _problem, ...rest } = withoutProgress(current)

        return DownloadJob.make({
          ...rest,
          status,
          finishedAt,
          ...(problem === undefined ? {} : { problem }),
        })
      })

      yield* persist(id)

      const job = (yield* SubscriptionRef.get(jobs)).find((candidate) => candidate.id === id)

      yield* (status === 'failed' ? Effect.logWarning : Effect.logInfo)('Download finished').pipe(
        Effect.annotateLogs({
          job: id,
          source: job?.source,
          status,
          pages: job?.pages.done,
          totalPages: job?.pages.total,
          sizeMb: job === undefined ? undefined : Math.round(job.bytes / 1024 ** 2),
          reason: problem?.reason,
          error: problem?.message,
        }),
      )
    })

    const markExpired = (source: SourceId, message: string) =>
      sourceOf(source).signIn === undefined
        ? Effect.void
        : setAccount({ source, status: 'expired', message })

    const run = (
      id: string,
      source: SourceId,
    ): Effect.Effect<void, never, HttpClient.HttpClient | FileSystem.FileSystem> =>
      execute(id).pipe(
        Effect.matchCauseEffect({
          onSuccess: () => finish(id, 'finished'),
          onFailure: (cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              // Only a cancel is the user's; when Wenbu quits, the next start marks it interrupted.
              return cancelling.has(id) ? finish(id, 'cancelled') : Effect.void
            }

            const error = Cause.findErrorOption(cause)

            if (Option.isNone(error)) {
              return Effect.andThen(
                Effect.logError('Download failed unexpectedly', cause),
                finish(id, 'failed', { reason: 'failed', message: 'Something went wrong.' }),
              )
            }

            const failure = error.value

            if (Schema.is(Declined)(failure)) {
              return finish(id, 'cancelled')
            }

            if (Schema.is(SourceProblem)(failure)) {
              const problem = { reason: failure.reason, message: failure.message }

              return failure.reason === 'sign-in'
                ? Effect.andThen(
                    markExpired(source, failure.message),
                    finish(id, 'failed', problem),
                  )
                : finish(id, 'failed', problem)
            }

            if (Schema.is(NotEnoughSpace)(failure)) {
              return finish(id, 'failed', {
                reason: 'disk',
                message: failure.message,
                space: failure.shortfall,
              })
            }

            return Effect.andThen(
              Effect.logWarning('Download could not save pages', cause),
              finish(id, 'failed', {
                reason: 'disk',
                message: 'Wenbu could not save the pages. Check the download folder.',
              }),
            )
          },
        }),
        Effect.ensuring(Effect.suspend(() => pump)),
      )

    const pump: Effect.Effect<void> = pumpLock.withPermits(1)(
      Effect.gen(function* () {
        const settings = yield* getSettings
        const all = yield* SubscriptionRef.get(jobs)
        const busy = all.filter((job) => job.status === 'running' || job.status === 'waiting')
        const free = Math.max(0, settings.parallelDownloads - busy.length)

        const next = all
          .filter((job) => job.status === 'queued')
          .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
          .slice(0, free)

        for (const job of next) {
          yield* update(job.id, (current) =>
            DownloadJob.make({ ...withoutProgress(current), status: 'running' }),
          )

          yield* FiberMap.run(
            fibers,
            job.id,
            run(job.id, job.source).pipe(Effect.provideContext(services)),
          )
        }
      }),
    )

    const start = Effect.fn('Downloads.start')(function* (text: string) {
      const settings = yield* getSettings

      if (settings.folder === '') {
        return yield* new DownloadError({
          reason: 'no-folder',
          message: 'Choose a download folder in Settings › Downloads first.',
        })
      }

      const url = yield* Option.match(parseLink(text), {
        onNone: () => Effect.fail(invalid('url', 'Paste a gallery link starting with https://.')),
        onSome: Effect.succeed,
      })

      const source = gallerySources.find((candidate) => candidate.matches(url))

      if (source === undefined) {
        return yield* invalid(
          'url',
          "Wenbu can't download this link. Paste a gallery from ExHentai, HDoujin, Hitomi or NHentai.",
        )
      }

      if (!settings.enabledSources.includes(source.id)) {
        return yield* new DownloadError({
          reason: 'disabled',
          message: `${sourceName(source.id)} is turned off in Settings › Downloads.`,
        })
      }

      const all = yield* SubscriptionRef.get(jobs)

      if (all.some((job) => job.url === url.href && isActive(job.status))) {
        return yield* new DownloadError({
          reason: 'conflict',
          message: 'This gallery is already downloading.',
        })
      }

      const job = DownloadJob.make({
        id: yield* Effect.orDie(crypto.randomUUIDv7()),
        url: url.href,
        source: source.id,
        title: url.href,
        status: 'queued',
        attempt: 1,
        pages: { done: 0 },
        bytes: 0,
        reducedQuality: false,
        createdAt: yield* now,
      })

      yield* save(job)
      yield* SubscriptionRef.update(jobs, (current) => [job, ...current].slice(0, historyLimit))

      yield* Effect.logInfo('Download queued').pipe(
        Effect.annotateLogs({ job: job.id, source: source.id }),
      )

      yield* pump

      return job.id
    })

    const resume = Effect.fn('Downloads.resume')(function* (id: string) {
      const job = yield* find(id)

      if (Option.isNone(job)) {
        return yield* new DownloadError({ reason: 'not-found', message: 'The download is gone.' })
      }

      if (!canResume(job.value)) {
        return yield* new DownloadError({
          reason: 'conflict',
          message: 'Only a stopped download can be resumed.',
        })
      }

      yield* update(id, (current) => {
        const { problem: _problem, finishedAt: _finished, ...rest } = withoutProgress(current)

        return DownloadJob.make({ ...rest, status: 'queued', attempt: current.attempt + 1 })
      })

      yield* persist(id)
      yield* pump
    })

    const cancel = Effect.fn('Downloads.cancel')(function* (id: string) {
      const job = yield* find(id)

      if (Option.isNone(job) || !isActive(job.value.status)) {
        return
      }

      if (job.value.status === 'queued') {
        return yield* finish(id, 'cancelled')
      }

      cancelling.add(id)
      yield* FiberMap.remove(fibers, id)
    })

    const remove = Effect.fn('Downloads.remove')(function* (id: string) {
      const job = yield* find(id)

      if (Option.exists(job, (found) => isActive(found.status))) {
        return yield* new DownloadError({
          reason: 'conflict',
          message: 'Cancel the download first.',
        })
      }

      yield* Effect.orDie(sql`DELETE FROM download_jobs WHERE id = ${id}`)
      yield* SubscriptionRef.update(jobs, (all) => all.filter((current) => current.id !== id))
    })

    const check = Effect.fn('Downloads.check')(function* (source: SourceId) {
      const gallerySource = sourceOf(source)
      const context = contextFor(source, yield* getSettings)
      const needsSession = gallerySource.signIn !== undefined

      if (needsSession && Option.isNone(context.session)) {
        return yield* setAccount({ source, status: 'signed-out' })
      }

      const before = (yield* SubscriptionRef.get(accounts)).find(
        (account) => account.source === source,
      )

      yield* setAccount({ ...before, source, status: 'checking' })

      const result = yield* gallerySource.check(context).pipe(Effect.result)
      const checkedAt = yield* now

      if (Result.isFailure(result)) {
        const failure = result.failure

        return yield* setAccount({
          source,
          status: needsSession && failure.reason === 'sign-in' ? 'expired' : 'unreachable',
          message: failure.message,
          checkedAt,
        })
      }

      if (result.success.session !== undefined) {
        yield* saveSession(source, result.success.session)
      }

      yield* setAccount({
        source,
        status: needsSession ? 'ready' : 'open',
        detail: result.success.detail ?? 'Reachable',
        checkedAt,
      })
    })

    const signIn = Effect.fn('Downloads.signIn')(function* (source: SourceId) {
      const page = sourceOf(source).signIn

      if (page === undefined) {
        return
      }

      const before = (yield* SubscriptionRef.get(accounts)).find(
        (account) => account.source === source,
      )

      yield* setAccount({ source, status: 'signing-in', message: page.instructions })

      const captured = yield* windows.open({
        source,
        url: page.url,
        sites: page.sites,
        storageKeys: page.storageKeys,
      })

      const session: Session = {
        cookies: captured.cookies,
        userAgent: captured.userAgent,
        storage: captured.storage,
      }

      if (captured.problem !== undefined || !page.accepts(session)) {
        const { message: _message, ...previous } = before ?? { source }

        return yield* setAccount({
          ...previous,
          status: sessions.has(source) ? 'ready' : 'signed-out',
          message: captured.problem ?? 'The browser closed before the sign-in finished.',
        })
      }

      yield* saveSession(source, session)
      yield* check(source)
    })

    const signOut = Effect.fn('Downloads.signOut')(function* (source: SourceId) {
      sessions.delete(source)
      yield* Effect.orDie(sql`DELETE FROM download_sessions WHERE source = ${source}`)
      yield* windows.forget(source)
      yield* setAccount({ source, status: 'signed-out' })
    })

    const saveSettings = Effect.fn('Downloads.saveSettings')(function* (
      settings: DownloadSettings,
    ) {
      const folder = settings.folder.trim()

      if (folder !== '') {
        if (!path.isAbsolute(folder)) {
          return yield* invalid('folder', 'Choose a folder on this computer.')
        }

        const probe = path.join(folder, '.wenbu-write-test')

        yield* fs.makeDirectory(folder, { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(probe, 'ok')),
          Effect.andThen(fs.remove(probe)),
          Effect.mapError(() =>
            invalid('folder', "Wenbu can't save into this folder. Choose another."),
          ),
        )
      }

      if (
        !Number.isInteger(settings.parallelDownloads) ||
        settings.parallelDownloads < 1 ||
        settings.parallelDownloads > 3
      ) {
        return yield* invalid('parallelDownloads', 'Use between 1 and 3 downloads at once.')
      }

      const clean: DownloadSettings = {
        ...settings,
        folder,
        enabledSources: SourceId.literals.filter((id) => settings.enabledSources.includes(id)),
      }

      yield* Effect.orDie(store.set(settingsKey, clean))
      yield* pump

      return clean
    })

    yield* pump

    return DownloadsRpc.of({
      getDownloadSettings: () => getSettings,
      saveDownloadSettings: (settings) => saveSettings(settings),
      watchDownloads: () =>
        Stream.zipLatest(SubscriptionRef.changes(jobs), SubscriptionRef.changes(accounts)).pipe(
          Stream.map(([all, sourceAccounts]) => ({ jobs: all, accounts: sourceAccounts })),
        ),
      startDownload: ({ url }) => start(url),
      resumeDownload: ({ jobId }) => resume(jobId),
      cancelDownload: ({ jobId }) => cancel(jobId),
      removeDownload: ({ jobId }) => remove(jobId),
      answerDownload: ({ jobId, accept }) =>
        Effect.suspend(() => {
          const deferred = questions.get(jobId)

          return deferred === undefined ? Effect.void : Deferred.succeed(deferred, accept)
        }).pipe(Effect.asVoid),
      signInToSource: ({ source }) =>
        FiberMap.run(signIns, source, signIn(source).pipe(Effect.provideContext(services)), {
          onlyIfMissing: true,
        }).pipe(Effect.asVoid),
      signOutOfSource: ({ source }) => signOut(source),
      checkSource: ({ source }) => check(source).pipe(Effect.provideContext(services)),
    })
  }),
)
