import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Config, Effect, Layer, Option, Path, Queue, Schema, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { FetchHttpClient } from 'effect/http'
import { RpcServer } from 'effect/rpc'
import {
  ClipboardImage,
  type LiveControlsWindow,
  MainLogEntry,
  OverlayBounds,
  type OverlayWindow,
  SubtitleBounds,
  SubtitleLockToggle,
  type SubtitleWindow,
} from '#contract/CoreMessages'
import { WenbuRpc } from '#contract/WenbuRpc'
import { AppearanceLive } from './appearance/Appearance'
import { DashboardRpcLive } from './dashboard/Dashboard'
import { DetailsRpcLive } from './details/Details'
import { DetailsStore } from './details/DetailsStore'
import { DLsite } from './details/DLsite'
import { Detections, DetectionsRpcLive } from './detections/Detections'
import { DiagnosticsRpcLive } from './diagnostics/Diagnostics'
import { LogBook } from './diagnostics/LogBook'
import { RpcLoggingLive } from './diagnostics/RpcLogging'
import { DownloadsRpcLive } from './downloads/Downloads'
import { GalleriesRpcLive } from './galleries/Galleries'
import { GameGuideRpcLive } from './gameguide/GameGuide'
import { GuideIndexStore } from './gameguide/GuideIndexStore'
import { RootWatcher } from './galleries/RootWatcher'
import { SignInWindows } from './downloads/SignInWindows'
import { GoogleLens } from './detections/GoogleLens'
import { ImageOcr } from './ingametext/ImageOcr'
import { InGameTextRpcLive } from './ingametext/InGameText'
import { InGameTextStore } from './ingametext/InGameTextStore'
import { ScreenAiOcr } from './detections/ScreenAiOcr'
import { Games } from './library/Games'
import { GameLauncher } from './library/GameLauncher'
import { LaunchAlias } from './library/LaunchAlias'
import { LocaleDetector } from './library/LocaleDetector'
import { LibraryRpcLive } from './library/Library'
import { GameConnector } from './livecontrols/GameConnector'
import { LiveControls, LiveControlsRpcLive } from './livecontrols/LiveControls'
import { RgssBridge } from './livecontrols/RgssRuntime'
import { ConnectionVerifier } from './llm/ConnectionVerifier'
import { Credentials } from './llm/Credentials'
import { LlmClient } from './llm/LlmClient'
import { LlmRpcLive, LlmStore } from './llm/LlmStore'
import { ModelCatalog } from './llm/ModelCatalog'
import { UsageLog } from './llm/UsageLog'
import { MangaRpcLive } from './manga/Manga'
import { MangaRuntime } from './manga/MangaRuntime'
import { MangaEditorRpcLive } from './mangaEditor/MangaEditor'
import { MemoriesRpcLive } from './memories/Memories'
import { GlossaryStore } from './glossary/GlossaryStore'
import { NovelsRpcLive } from './novels/Novels'
import { NovelInsightStore } from './novels/NovelInsightStore'
import { NovelStore } from './novels/NovelStore'
import { PageFetcher } from './novels/PageFetcher'
import { PresetReferences } from './llm/PresetReferences'
import { LunaHookHost } from './overlay/LunaHookHost'
import { OverlayPreferences } from './overlay/OverlayPreferences'
import { OverlayStore } from './overlay/OverlayStore'
import { TranslationOverlay, TranslationOverlayRpcLive } from './overlay/TranslationOverlay'
import * as Database from './platform/Database'
import { DiskSpace } from './platform/DiskSpace'
import * as PortRunner from './platform/PortRunner'
import { Plugins, PluginsRpcLive } from './plugins/Plugins'
import { GameData } from './rpgmaker/GameData'
import { StorageLive } from './storage/Storage'
import { LiveSubtitles, SubtitlesRpcLive } from './subtitles/LiveSubtitles'
import { SpeechHelper } from './subtitles/SpeechHelper'
import { SubtitlePreferences } from './subtitles/SubtitlePreferences'
import { GameTranslationLive } from './translation/GameTranslation'
import { GameFileHashes } from './translation/GameFileHashes'
import { TranslationLines } from './translation/TranslationLines'
import { MainUpdater } from './updates/MainUpdater'
import { UpdatesRpcLive } from './updates/Updates'

const fromMessagePortMain = (port: Electron.MessagePortMain): PortRunner.Port => ({
  onMessage: (listener) => {
    const handle = (event: Electron.MessageEvent) =>
      Option.map(PortRunner.decodeIncomingFrame(event.data), listener)

    port.on('message', handle)

    return () => port.off('message', handle)
  },
  onClose: (listener) => {
    port.on('close', listener)

    return () => port.off('close', listener)
  },
  post: (message) => port.postMessage(message),
  start: () => port.start(),
  close: () => port.close(),
})

const WindowPortsLive = Layer.unwrap(
  Effect.gen(function* () {
    const ports = yield* Queue.unbounded<PortRunner.Port>()

    const receive = (event: Electron.MessageEvent) => {
      for (const port of event.ports) {
        Queue.offerUnsafe(ports, fromMessagePortMain(port))
      }
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => process.parentPort.on('message', receive)),
      () => Effect.sync(() => process.parentPort.off('message', receive)),
    )

    return PortRunner.layer(ports)
  }),
)

const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const dataDir = yield* Config.String('WENBU_DATA_DIR')
    const path = yield* Path.Path

    return Database.layer(path.join(dataDir, 'wenbu.sqlite'))
  }),
)

const LlmLive = Layer.mergeAll(LlmRpcLive, LlmClient.layer).pipe(
  Layer.provideMerge(UsageLog.layer),
  Layer.provideMerge(LlmStore.layer),
  Layer.provideMerge(PresetReferences.layer),
  Layer.provide([ConnectionVerifier.layer, Credentials.layer]),
  Layer.provideMerge(ModelCatalog.layer),
)

const PluginsLive = Plugins.live.pipe(
  Layer.provideMerge(ScreenAiOcr.live),
  Layer.provideMerge(MangaRuntime.live),
)

const LiveControlsCore = LiveControls.layer.pipe(
  Layer.provide(GameConnector.layer.pipe(Layer.provide([RgssBridge.live, LunaHookHost.live]))),
  Layer.provide(Games.layer),
)

const GamesLive = Layer.mergeAll(LibraryRpcLive, GameTranslationLive).pipe(
  Layer.provideMerge(GameLauncher.layer),
  Layer.provideMerge(LaunchAlias.layer),
  Layer.provide(LocaleDetector.layer),
  Layer.provide(LiveControls.launchHooks.pipe(Layer.provide(LiveControlsCore))),
  Layer.provide([LlmLive, PluginsLive, LunaHookHost.live]),
  Layer.provide([TranslationLines.layer, GameFileHashes.layer]),
  Layer.provideMerge(Games.layer),
  Layer.provideMerge(GameData.layer),
)

const isClipboardImage = Schema.is(ClipboardImage)

const ClipboardImagesLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const detections = yield* Detections
    const overlay = yield* TranslationOverlay
    const images = yield* Queue.sliding<ClipboardImage>(1)

    const receive = (event: Electron.MessageEvent) => {
      if (isClipboardImage(event.data)) {
        Queue.offerUnsafe(images, event.data)
      }
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => process.parentPort.on('message', receive)),
      () => Effect.sync(() => process.parentPort.off('message', receive)),
    )

    yield* Stream.fromQueue(images).pipe(
      Stream.runForEach(({ width, height, pixels }) =>
        detections.detectClipboard({ width, height, pixels }).pipe(
          Effect.flatMap((detection) =>
            Option.match(detection, {
              onNone: () => Effect.void,
              onSome: (found) => overlay.submitText(found.originalText),
            }),
          ),
        ),
      ),
      Effect.forkScoped,
    )
  }),
)

const isOverlayBounds = Schema.is(OverlayBounds)

const OverlayWindowLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const overlay = yield* TranslationOverlay
    const preferences = yield* OverlayPreferences
    const bounds = yield* Queue.sliding<OverlayBounds>(1)

    const receive = (event: Electron.MessageEvent) => {
      if (isOverlayBounds(event.data)) {
        Queue.offerUnsafe(bounds, event.data)
      }
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => process.parentPort.on('message', receive)),
      () => Effect.sync(() => process.parentPort.off('message', receive)),
    )

    yield* Stream.fromQueue(bounds).pipe(
      Stream.runForEach((message) => preferences.saveBounds(message.bounds)),
      Effect.forkScoped,
    )

    const toMain = (message: OverlayWindow) =>
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's parentPort is not a window and takes no target origin.
      Effect.sync(() => process.parentPort.postMessage(message))

    yield* overlay.window.pipe(Stream.runForEach(toMain), Effect.forkScoped)
  }),
)

const OverlayLive = Layer.mergeAll(TranslationOverlayRpcLive, OverlayWindowLive).pipe(
  Layer.provideMerge(TranslationOverlay.layer),
  Layer.provideMerge(Layer.mergeAll(OverlayStore.layer, OverlayPreferences.layer)),
  Layer.provide([LlmLive, PluginsLive, LunaHookHost.live, GamesLive]),
)

const isSubtitleBounds = Schema.is(SubtitleBounds)

const isSubtitleLockToggle = Schema.is(SubtitleLockToggle)

const SubtitleWindowLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const subtitles = yield* LiveSubtitles
    const preferences = yield* SubtitlePreferences
    const bounds = yield* Queue.sliding<SubtitleBounds>(1)
    const toggles = yield* Queue.sliding<SubtitleLockToggle>(1)

    const receive = (event: Electron.MessageEvent) => {
      if (isSubtitleBounds(event.data)) {
        Queue.offerUnsafe(bounds, event.data)
      }

      if (isSubtitleLockToggle(event.data)) {
        Queue.offerUnsafe(toggles, event.data)
      }
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => process.parentPort.on('message', receive)),
      () => Effect.sync(() => process.parentPort.off('message', receive)),
    )

    yield* Stream.fromQueue(bounds).pipe(
      Stream.runForEach((message) => preferences.saveBounds(message.bounds)),
      Effect.forkScoped,
    )

    yield* Stream.fromQueue(toggles).pipe(
      Stream.runForEach(() => subtitles.toggleOverlayLocked),
      Effect.forkScoped,
    )

    const toMain = (message: SubtitleWindow) =>
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's parentPort is not a window and takes no target origin.
      Effect.sync(() => process.parentPort.postMessage(message))

    yield* subtitles.window.pipe(Stream.runForEach(toMain), Effect.forkScoped)
  }),
)

const SubtitlesLive = Layer.mergeAll(SubtitlesRpcLive, SubtitleWindowLive).pipe(
  Layer.provideMerge(LiveSubtitles.layer),
  Layer.provideMerge(SubtitlePreferences.layer),
  Layer.provide([LlmLive, PluginsLive, SpeechHelper.live]),
)

const DetectionsLive = Layer.mergeAll(DetectionsRpcLive, ClipboardImagesLive).pipe(
  Layer.provideMerge(Detections.layer),
  Layer.provide([GoogleLens.layer, LlmLive, OverlayLive]),
  Layer.provideMerge(Layer.mergeAll(PluginsRpcLive).pipe(Layer.provideMerge(PluginsLive))),
)

const LiveControlsWindowLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const live = yield* LiveControls

    const toMain = (message: LiveControlsWindow) =>
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's parentPort is not a window and takes no target origin.
      Effect.sync(() => process.parentPort.postMessage(message))

    yield* live.window.pipe(Stream.runForEach(toMain), Effect.forkScoped)
  }),
)

const LiveControlsLive = Layer.mergeAll(LiveControlsRpcLive, LiveControlsWindowLive).pipe(
  Layer.provide(LiveControlsCore),
)

const InGameTextLive = InGameTextRpcLive.pipe(
  Layer.provide([InGameTextStore.layer, ImageOcr.layer.pipe(Layer.provide(PluginsLive))]),
  Layer.provide([LiveControlsCore, LlmLive, Games.layer]),
)

const GameGuideLive = GameGuideRpcLive.pipe(
  Layer.provide([GuideIndexStore.layer, TranslationLines.layer, GameData.layer]),
  Layer.provide([LiveControlsCore, LlmLive]),
)

const MemoriesLive = MemoriesRpcLive.pipe(Layer.provide([GameData.layer, LiveControlsCore]))

const MangaLive = MangaRpcLive.pipe(Layer.provide([LlmLive, PluginsLive]))

const MangaEditorLive = MangaEditorRpcLive.pipe(Layer.provide([LlmLive, PluginsLive]))

// Not fetch: its undici aborts the whole core process when a server closes mid-download.
const DownloadsLive = DownloadsRpcLive.pipe(
  Layer.provide([Credentials.layer, SignInWindows.live, NodeHttpClient.layerNodeHttp]),
)

const GalleriesLive = GalleriesRpcLive.pipe(Layer.provide(RootWatcher.live))

const DetailsLive = DetailsRpcLive.pipe(
  Layer.provide([
    DetailsStore.layer,
    DLsite.layer.pipe(Layer.provide(NodeHttpClient.layerNodeHttp)),
    Games.layer,
    LlmLive,
  ]),
)

const isMainLogEntry = Schema.is(MainLogEntry)

const MainLogEntriesLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const book = yield* LogBook

    const receive = (event: Electron.MessageEvent) => {
      if (isMainLogEntry(event.data)) {
        book.forward(event.data.entry)
      }
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => process.parentPort.on('message', receive)),
      () => Effect.sync(() => process.parentPort.off('message', receive)),
    )
  }),
)

const CoreStartedLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const version = yield* Config.String('WENBU_APP_VERSION').pipe(Config.withDefault('dev'))

    yield* Effect.logInfo('Core started').pipe(
      Effect.annotateLogs({
        feature: 'app',
        version,
        node: process.versions.node,
        pid: process.pid,
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      }),
    )
  }),
)

const NovelsLive = NovelsRpcLive.pipe(
  Layer.provide([
    NovelStore.layer,
    GlossaryStore.layer,
    NovelInsightStore.layer,
    PageFetcher.live,
    LlmLive,
  ]),
)

const UpdatesLive = UpdatesRpcLive.pipe(Layer.provide(MainUpdater.live))

const DiagnosticsLive = Layer.mergeAll(DiagnosticsRpcLive, MainLogEntriesLive, CoreStartedLive)

const LoggingLive = LogBook.logger.pipe(Layer.provideMerge(LogBook.layer))

const PlatformLive = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)

const CoreLive = RpcServer.layer(WenbuRpc).pipe(
  Layer.provide([
    AppearanceLive,
    LlmLive,
    GamesLive,
    OverlayLive,
    SubtitlesLive,
    DetectionsLive,
    LiveControlsLive,
    InGameTextLive,
    GameGuideLive,
    MemoriesLive,
    MangaLive,
    MangaEditorLive,
    DownloadsLive,
    GalleriesLive,
    DiagnosticsLive,
    StorageLive,
    DashboardRpcLive,
    DetailsLive,
    NovelsLive,
    UpdatesLive,
    RpcLoggingLive,
  ]),
  Layer.provide(DiskSpace.layer),
  Layer.provide(KeyValueStore.layerSql({ table: 'settings' })),
  Layer.provideMerge(DatabaseLive),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(WindowPortsLive),
  Layer.provideMerge(LoggingLive),
  Layer.provide(PlatformLive),
)

NodeRuntime.runMain(Layer.launch(CoreLive))
