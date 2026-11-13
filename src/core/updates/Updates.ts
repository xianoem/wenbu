import { Config, Effect, Layer, Schema, Semaphore } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { compareVersions, Release, UpdatesRpc, WhatsNew } from '#contract/Updates'
import * as SettingsStore from '../platform/SettingsStore'
import { MainUpdater } from './MainUpdater'
import releaseNotesJson from './releaseNotes.json' with { type: 'json' }

const Seen = Schema.Struct({
  /** The version whose changes the user has looked at. Empty until Wenbu has run once. */
  seenVersion: Schema.String,
  /** The version up to which `newAreas` was gathered. */
  notedVersion: Schema.String,
  newAreas: Schema.Array(Schema.String),
})

type Seen = typeof Seen.Type

const neverRan: Seen = { seenVersion: '', notedVersion: '', newAreas: [] }

const numbersOf = (version: string) => /\d+(\.\d+)*/.exec(version)?.[0] ?? '0'

const newAreasBetween = (releases: ReadonlyArray<Release>, after: string, upTo: string) =>
  releases
    .filter(
      (release) =>
        compareVersions(release.version, after) > 0 && compareVersions(release.version, upTo) <= 0,
    )
    .flatMap((release) => release.changes)
    .filter((change) => change.kind === 'new')
    .map((change) => change.area)

const caughtUp = (saved: Seen, version: string, releases: ReadonlyArray<Release>): Seen => {
  const moved = saved.seenVersion === '' ? -1 : compareVersions(version, saved.notedVersion)

  if (moved < 0) {
    return { seenVersion: version, notedVersion: version, newAreas: [] }
  }

  if (moved === 0) {
    return saved
  }

  const areas = [...saved.newAreas, ...newAreasBetween(releases, saved.notedVersion, version)]

  return { ...saved, notedVersion: version, newAreas: [...new Set(areas)] }
}

export const updatesRpc = (options: {
  readonly version: string
  readonly releases: ReadonlyArray<Release>
}) =>
  UpdatesRpc.toLayer(
    Effect.gen(function* () {
      const updater = yield* MainUpdater
      const store = SettingsStore.make(yield* KeyValueStore.KeyValueStore, Seen, neverRan)
      const gate = yield* Semaphore.make(1)
      const version = numbersOf(options.version)

      const releases = options.releases.filter(
        (release) => compareVersions(release.version, version) <= 0,
      )

      const change = (edit: (seen: Seen) => Seen) =>
        Effect.gen(function* () {
          const seen = edit(caughtUp(yield* store.get('updates'), version, releases))

          yield* store.set('updates', seen)

          return WhatsNew.make({
            version,
            updatedFrom:
              compareVersions(seen.seenVersion, version) < 0 ? seen.seenVersion : undefined,
            releases,
            newAreas: seen.newAreas,
          })
        }).pipe(gate.withPermits(1), Effect.orDie)

      return UpdatesRpc.of({
        getWhatsNew: Effect.fn('Updates.getWhatsNew')(function* () {
          return yield* change((seen) => seen)
        }),
        markWhatsNewSeen: Effect.fn('Updates.markWhatsNewSeen')(function* () {
          return yield* change((seen) => ({ ...seen, seenVersion: version }))
        }),
        markAreaSeen: Effect.fn('Updates.markAreaSeen')(function* ({ area }) {
          return yield* change((seen) => ({
            ...seen,
            newAreas: seen.newAreas.filter((candidate) => candidate !== area),
          }))
        }),
        watchUpdate: () => updater.status,
        installUpdate: Effect.fn('Updates.install')(function* () {
          yield* Effect.logInfo('Installing the downloaded update')
          yield* updater.install
        }),
      })
    }),
  )

export const UpdatesRpcLive = Layer.unwrap(
  Effect.gen(function* () {
    const version = yield* Config.String('WENBU_APP_VERSION').pipe(Config.withDefault('0'))

    const releases = yield* Effect.orDie(
      Schema.decodeUnknownEffect(Schema.Array(Release))(releaseNotesJson),
    )

    return updatesRpc({ version, releases })
  }),
)
