import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Option } from 'effect'
import { defaultMangaSettings } from '#contract/Manga'
import { workerOptions } from './MangaOptions'

const optionsWith = (screenAi: Option.Option<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const plugin = yield* fs.makeTempDirectoryScoped()

    return yield* workerOptions(defaultMangaSettings, plugin, {
      resources: 'C:/Wenbu/resources',
      dataDir: 'C:/Wenbu/data',
      screenAi,
    })
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe('workerOptions', () => {
  it.effect('passes the Screen AI folder when Screen AI is installed', () =>
    Effect.gen(function* () {
      const options = yield* optionsWith(Option.some('C:/Wenbu/plugins/screen-ai/153.05'))

      expect(options['screen_ai']).toBe('C:/Wenbu/plugins/screen-ai/153.05')
    }),
  )

  it.effect('leaves Screen AI out when it is not installed', () =>
    Effect.gen(function* () {
      const options = yield* optionsWith(Option.none())

      expect(options).not.toHaveProperty('screen_ai')
    }),
  )
})
