import { Cause, Clock, Effect, Exit, Layer, Option } from 'effect'
import { AppearanceRpc } from '#contract/Appearance'
import { DetectionsRpc } from '#contract/Detections'
import { DiagnosticsRpc, RpcLogging } from '#contract/Diagnostics'
import { DownloadsRpc } from '#contract/Downloads'
import { GalleriesRpc } from '#contract/Galleries'
import { GameTranslationRpc } from '#contract/GameTranslation'
import { LibraryRpc } from '#contract/Library'
import { LiveControlsRpc } from '#contract/LiveControls'
import { LlmRpc } from '#contract/Llm'
import { MangaRpc } from '#contract/Manga'
import { PluginsRpc } from '#contract/Plugins'
import { SubtitlesRpc } from '#contract/Subtitles'
import { TranslationOverlayRpc } from '#contract/TranslationOverlay'

interface Group {
  readonly requests: ReadonlyMap<string, { readonly key: string }>
}

const featureGroups: ReadonlyArray<readonly [Group, string]> = [
  [AppearanceRpc, 'appearance'],
  [LlmRpc, 'models'],
  [LibraryRpc, 'library'],
  [GameTranslationRpc, 'translation'],
  [PluginsRpc, 'plugins'],
  [DetectionsRpc, 'detections'],
  [TranslationOverlayRpc, 'overlay'],
  [LiveControlsRpc, 'livecontrols'],
  [MangaRpc, 'manga'],
  [DownloadsRpc, 'downloads'],
  [GalleriesRpc, 'galleries'],
  [SubtitlesRpc, 'subtitles'],
  [DiagnosticsRpc, 'diagnostics'],
]

const featureOfRpc = new Map(
  featureGroups.flatMap(([group, feature]) =>
    [...group.requests.values()].map((rpc) => [rpc.key, feature] as const),
  ),
)

export const rpcFeature = (key: string) => featureOfRpc.get(key) ?? 'core'

const describeError = (error: Error) => `${error.name}: ${error.message}`

const logOutcome = (exit: Exit.Exit<unknown, unknown>, ms: number) => {
  if (Exit.isSuccess(exit)) {
    return Effect.logDebug('Request finished').pipe(Effect.annotateLogs({ ms }))
  }

  if (Cause.hasInterruptsOnly(exit.cause)) {
    return Effect.void
  }

  if (Cause.hasDies(exit.cause)) {
    return Effect.logError('Request failed unexpectedly', exit.cause).pipe(
      Effect.annotateLogs({ ms }),
    )
  }

  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))

  return Effect.logWarning('Request failed').pipe(
    Effect.annotateLogs({ ms, error: error instanceof Error ? describeError(error) : 'unknown' }),
  )
}

export const RpcLoggingLive = Layer.succeed(RpcLogging, (effect, { rpc }) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis

    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.flatMap(Clock.currentTimeMillis, (ended) => logOutcome(exit, ended - started)),
      ),
    )
  }).pipe(
    Effect.annotateLogs({
      feature: rpcFeature(rpc.key),
      rpc: rpc.key.split('/').at(-1) ?? rpc.key,
    }),
  ),
)
