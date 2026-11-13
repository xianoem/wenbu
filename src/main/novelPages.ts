import { BrowserWindow, session } from 'electron'
import { Deferred, Effect } from 'effect'
import { PageFetched, type PageFetch } from '#contract/CoreMessages'
import { isCheckPage } from './checkPages'

export const novelPages = (options: {
  readonly userAgent: string
  readonly log: (
    level: 'info' | 'warn',
    message: string,
    fields: Readonly<Record<string, unknown>>,
  ) => void
}) => {
  const pages = session.fromPartition('persist:novels')
  const checking = new Map<string, Deferred.Deferred<void>>()

  pages.setUserAgent(options.userAgent)

  const once = (url: string) =>
    Effect.tryPromise(async () => {
      const response = await pages.fetch(url, {
        headers: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
      })

      return { response, body: await response.text() }
    })

  const passed = (url: string) =>
    Effect.map(
      once(url),
      ({ response, body }) => !isCheckPage(response.status, response.headers, body),
    ).pipe(Effect.orElseSucceed(() => false))

  const passCheck = (url: string, interactive: boolean) =>
    Effect.acquireUseRelease(
      Effect.sync(
        () =>
          new BrowserWindow({
            show: false,
            width: 900,
            height: 700,
            title: `Wenbu: pass the check on ${new URL(url).hostname}`,
            autoHideMenuBar: true,
            webPreferences: {
              session: pages,
              sandbox: true,
              contextIsolation: true,
              backgroundThrottling: false,
            },
          }),
      ),
      (window) =>
        Effect.gen(function* () {
          // Sites full of ads may never finish loading, so the load is not awaited.
          window.loadURL(url).catch(() => undefined)

          for (let waited = 0; waited < 15_000; waited += 1000) {
            yield* Effect.sleep('1 second')

            if (yield* passed(url)) {
              return
            }
          }

          if (!interactive) {
            return
          }

          options.log('warn', 'A novel site wants the user to pass a check', {
            host: new URL(url).hostname,
          })

          window.show()

          while (!window.isDestroyed() && !(yield* passed(url))) {
            yield* Effect.sleep('1 second')
          }
        }),
      (window) =>
        Effect.sync(() => {
          if (!window.isDestroyed()) {
            window.destroy()
          }
        }),
    )

  const passCheckOnce = (url: string, interactive: boolean) =>
    Effect.suspend(() => {
      const host = new URL(url).hostname
      const running = checking.get(host)

      if (running !== undefined) {
        return Deferred.await(running)
      }

      return Effect.gen(function* () {
        const done = yield* Deferred.make<void>()

        checking.set(host, done)

        yield* passCheck(url, interactive).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              checking.delete(host)

              return Deferred.succeed(done, undefined)
            }),
          ),
        )
      })
    })

  const failed = (request: PageFetch, problem: string) =>
    PageFetched.make({ id: request.id, status: 0, url: request.url, body: '', problem })

  const fetch = (request: PageFetch) =>
    Effect.gen(function* () {
      const host = new URL(request.url).hostname
      let { response, body } = yield* once(request.url)

      if (isCheckPage(response.status, response.headers, body)) {
        options.log('info', 'Passing a novel site check', { host })

        yield* passCheckOnce(request.url, request.interactive)
        ;({ response, body } = yield* once(request.url))
      }

      if (isCheckPage(response.status, response.headers, body)) {
        return failed(
          request,
          request.interactive
            ? `${host} still wants its check passed. Try again to open it.`
            : `${host} wants its check passed. Open the novel to pass it.`,
        )
      }

      return PageFetched.make({
        id: request.id,
        status: response.status,
        url: response.url,
        body,
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          failed(
            request,
            `${new URL(request.url).hostname} could not be reached: ${String(error.cause)}`,
          ),
        ),
      ),
    )

  return { fetch }
}
