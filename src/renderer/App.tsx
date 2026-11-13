import { useAtomValue } from '@effect/atom-react'
import { cn } from 'cn'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { GalleriesPage } from './features/galleries/GalleriesPage'
import { GalleryViewer } from './features/galleries/viewer/Viewer'
import { LibraryPage } from './features/library/LibraryPage'
import { LogsPage } from './features/diagnostics/LogsPage'
import { MangaPage } from './features/manga/MangaPage'
import { MangaEditorPage } from './features/mangaEditor/MangaEditorPage'
import { GlossariesPage } from './features/novels/GlossariesPage'
import { GlossaryPage } from './features/novels/GlossaryPage'
import { NovelPage } from './features/novels/NovelPage'
import { NovelsPage } from './features/novels/NovelsPage'
import { NovelReader } from './features/novels/reader/NovelReader'
import { PluginsPage } from './features/plugins/PluginsPage'
import { useApplyTheme } from './features/appearance/appearance'
import { SettingsPage } from './features/settings/SettingsPage'
import { LowSpaceNotice } from './features/storage/LowSpaceNotice'
import { coreStoppedAtom } from '#lib/coreStopped'
import {
  mangaEditorAtom,
  novelReaderAtom,
  openGlossaryAtom,
  openNovelAtom,
  screenAtom,
  sidebarOpenAtom,
  viewerAtom,
} from '#lib/navigation'
import { CoreStoppedScreen } from './shell/CoreStoppedScreen'
import { Sidebar } from './shell/Sidebar'
import { TitleBar } from './shell/TitleBar'

function CurrentScreen() {
  const screen = useAtomValue(screenAtom)
  const openNovel = useAtomValue(openNovelAtom)
  const openGlossary = useAtomValue(openGlossaryAtom)

  if (screen === 'dashboard') {
    return <DashboardPage />
  }

  if (screen === 'settings') {
    return <SettingsPage />
  }

  if (screen === 'plugins') {
    return <PluginsPage />
  }

  if (screen === 'galleries') {
    return <GalleriesPage />
  }

  if (screen === 'manga') {
    return <MangaPage />
  }

  if (screen === 'logs') {
    return <LogsPage />
  }

  if (screen === 'novels') {
    return openNovel === undefined ? <NovelsPage /> : <NovelPage novelId={openNovel} />
  }

  if (screen === 'glossaries') {
    return openGlossary === undefined ? (
      <GlossariesPage />
    ) : (
      <GlossaryPage key={openGlossary} glossaryKey={openGlossary} />
    )
  }

  return <LibraryPage />
}

export function App() {
  useApplyTheme()

  const sidebarOpen = useAtomValue(sidebarOpenAtom)
  const coreStopped = useAtomValue(coreStoppedAtom)
  const screen = useAtomValue(screenAtom)
  const editedGallery = useAtomValue(mangaEditorAtom)
  const viewing = useAtomValue(viewerAtom)
  const novelReading = useAtomValue(novelReaderAtom)
  const logs = screen === 'logs'
  const editing = screen === 'manga' && editedGallery !== undefined

  if (coreStopped !== undefined) {
    return (
      <div className="flex h-screen flex-col">
        <TitleBar logs={false} />
        <CoreStoppedScreen stopped={coreStopped} />
      </div>
    )
  }

  if (screen === 'galleries' && viewing !== undefined) {
    return (
      <div className="flex h-screen flex-col bg-[oklch(0.11_0.004_285.823)]">
        <TitleBar />
        <GalleryViewer opening={viewing} />
      </div>
    )
  }

  if (screen === 'novels' && novelReading !== undefined) {
    return <NovelReader opening={novelReading} />
  }

  if (editing) {
    return (
      <div className="flex h-screen flex-col">
        <MangaEditorPage folder={editedGallery} />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto border-t border-sidebar-border bg-background px-10 pt-7 pb-12 transition-[border-radius] duration-200',
            sidebarOpen && 'rounded-tl-xl border-l',
            logs && 'overflow-y-hidden px-7 pt-6 pb-0',
          )}
        >
          <div
            className={cn('mx-auto flex w-full flex-1 flex-col', logs ? 'min-h-0' : 'max-w-5xl')}
          >
            {logs ? null : <LowSpaceNotice />}
            <CurrentScreen />
          </div>
        </main>
      </div>
    </div>
  )
}
