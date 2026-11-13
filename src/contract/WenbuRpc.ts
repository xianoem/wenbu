import { AppearanceRpc } from './Appearance'
import { DashboardRpc } from './Dashboard'
import { DetailsRpc } from './Details'
import { DetectionsRpc } from './Detections'
import { DiagnosticsRpc, RpcLogging } from './Diagnostics'
import { DownloadsRpc } from './Downloads'
import { GalleriesRpc } from './Galleries'
import { GameGuideRpc } from './GameGuide'
import { GameTranslationRpc } from './GameTranslation'
import { InGameTextRpc } from './InGameText'
import { LibraryRpc } from './Library'
import { LiveControlsRpc } from './LiveControls'
import { LlmRpc } from './Llm'
import { MangaRpc } from './Manga'
import { MangaEditorRpc } from './MangaEditor'
import { MemoriesRpc } from './Memories'
import { NovelsRpc } from './Novels'
import { PluginsRpc } from './Plugins'
import { StorageRpc } from './Storage'
import { SubtitlesRpc } from './Subtitles'
import { TranslationOverlayRpc } from './TranslationOverlay'

export class WenbuRpc extends AppearanceRpc.merge(
  LlmRpc,
  LibraryRpc,
  GameTranslationRpc,
  PluginsRpc,
  DetectionsRpc,
  TranslationOverlayRpc,
  SubtitlesRpc,
  LiveControlsRpc,
  InGameTextRpc,
  GameGuideRpc,
  MemoriesRpc,
  MangaRpc,
  MangaEditorRpc,
  DownloadsRpc,
  GalleriesRpc,
  DiagnosticsRpc,
  StorageRpc,
  DashboardRpc,
  DetailsRpc,
  NovelsRpc,
).middleware(RpcLogging) {}
