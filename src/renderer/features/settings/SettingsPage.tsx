import { useAtomValue } from '@effect/atom-react'
import { settingsPageAtom, type SettingsPage as Page } from '#lib/navigation'
import { GeneralSettingsPage } from '../background/GeneralSettingsPage'
import { DetectionsSettingsPage } from '../detections/DetectionsSettingsPage'
import { useDetectionsAvailable } from '../detections/hooks/useDetectionsAvailable'
import { DownloadsSettingsPage } from '../downloads/DownloadsSettingsPage'
import { MangaSettingsPage } from '../manga/MangaSettingsPage'
import { NovelsSettingsPage } from '../novels/NovelsSettingsPage'
import { OverlaySettingsPage } from '../overlay/OverlaySettingsPage'
import { SubtitleSettingsPage } from '../subtitles/SubtitleSettingsPage'
import { ModelsPage } from './ModelsPage'
import { TranslationSettingsPage } from './TranslationSettingsPage'

const pages: Record<Page, () => React.JSX.Element> = {
  general: GeneralSettingsPage,
  models: ModelsPage,
  translation: TranslationSettingsPage,
  overlay: OverlaySettingsPage,
  subtitles: SubtitleSettingsPage,
  manga: MangaSettingsPage,
  detections: DetectionsSettingsPage,
  downloads: DownloadsSettingsPage,
  novels: NovelsSettingsPage,
}

export function SettingsPage() {
  const page = useAtomValue(settingsPageAtom)
  const detectionsAvailable = useDetectionsAvailable()
  const Page = pages[page === 'detections' && !detectionsAvailable ? 'models' : page]

  return <Page />
}
