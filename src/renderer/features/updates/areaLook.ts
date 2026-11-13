import {
  BookBookmarkIcon,
  BooksIcon,
  CompassIcon,
  DownloadSimpleIcon,
  GameControllerIcon,
  type Icon,
  IdentificationCardIcon,
  ImagesIcon,
  ImagesSquareIcon,
  MagicWandIcon,
  MonitorPlayIcon,
  PencilSimpleLineIcon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  ScanIcon,
  SparkleIcon,
  SquaresFourIcon,
  SubtitlesIcon,
  TextAaIcon,
  TranslateIcon,
} from '@phosphor-icons/react'
import { type ReleaseArea, releaseAreaOf, releaseAreas } from '#contract/Updates'
import type { Screen, SettingsPage } from '#lib/navigation'

const tints = {
  violet: 'bg-tint-violet text-tint-violet-foreground',
  teal: 'bg-tint-teal text-tint-teal-foreground',
  amber: 'bg-tint-amber text-tint-amber-foreground',
  slate: 'bg-tint-slate text-tint-slate-foreground',
}

interface Look {
  readonly Icon: Icon
  readonly tint: keyof typeof tints
  readonly screen?: Screen
  readonly settingsPage?: SettingsPage
}

const looks: Readonly<Record<ReleaseArea, Look>> = {
  app: { Icon: SparkleIcon, tint: 'slate' },
  dashboard: { Icon: SquaresFourIcon, tint: 'slate', screen: 'dashboard' },
  library: { Icon: GameControllerIcon, tint: 'amber', screen: 'library' },
  details: { Icon: IdentificationCardIcon, tint: 'amber' },
  translation: { Icon: TranslateIcon, tint: 'teal' },
  overlay: { Icon: MonitorPlayIcon, tint: 'teal', settingsPage: 'overlay' },
  subtitles: { Icon: SubtitlesIcon, tint: 'teal', settingsPage: 'subtitles' },
  detections: { Icon: ScanIcon, tint: 'teal', settingsPage: 'detections' },
  'live-controls': { Icon: MagicWandIcon, tint: 'violet' },
  ingametext: { Icon: TextAaIcon, tint: 'violet' },
  'game-guide': { Icon: CompassIcon, tint: 'violet' },
  memories: { Icon: ImagesIcon, tint: 'violet' },
  novels: { Icon: BooksIcon, tint: 'violet', screen: 'novels' },
  glossaries: { Icon: BookBookmarkIcon, tint: 'violet', screen: 'glossaries' },
  galleries: { Icon: ImagesSquareIcon, tint: 'amber', screen: 'galleries' },
  downloads: { Icon: DownloadSimpleIcon, tint: 'amber', settingsPage: 'downloads' },
  manga: { Icon: TranslateIcon, tint: 'teal', screen: 'manga' },
  'manga-editor': { Icon: PencilSimpleLineIcon, tint: 'teal' },
  models: { Icon: PlugsConnectedIcon, tint: 'slate', settingsPage: 'models' },
  plugins: { Icon: PuzzlePieceIcon, tint: 'slate', screen: 'plugins' },
}

/** An area an older release named and a later Wenbu dropped still shows, as a change to Wenbu itself. */
export const areaLook = (area: string) => {
  const known = releaseAreaOf(area)
  const look = looks[known]

  return {
    name: releaseAreas[known],
    Icon: look.Icon,
    tintClass: tints[look.tint],
    screen: look.screen,
    settingsPage: look.settingsPage,
  }
}
