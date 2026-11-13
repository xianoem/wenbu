import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  BookOpenTextIcon,
  CaretDownIcon,
  CaretLeftIcon,
  DownloadSimpleIcon,
  GameControllerIcon,
  GearIcon,
  type Icon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  ScanIcon,
  SquaresFourIcon,
  TranslateIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import {
  galleryFolderAtom,
  gameIdAtom,
  openGalleryAtom,
  openGlossaryAtom,
  openNovelAtom,
  type Screen,
  type SettingsPage,
  screenAtom,
  settingsPageAtom,
  sidebarOpenAtom,
} from '#lib/navigation'
import { Button } from '#ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { DetectionsPopover } from '../features/detections/DetectionsPopover'
import { LogsSidebar } from '../features/diagnostics/LogsSidebar'
import { DownloadsPopover } from '../features/downloads/DownloadsPopover'
import { useDetectionsAvailable } from '../features/detections/hooks/useDetectionsAvailable'
import { OverlayPopover } from '../features/overlay/OverlayPopover'
import { SubtitlesPopover } from '../features/subtitles/SubtitlesPopover'
import { StorageMeter } from '../features/storage/StorageMeter'

const appDestinations = [
  { screen: 'dashboard', label: 'Dashboard', Icon: SquaresFourIcon },
  { screen: 'library', label: 'Library', Icon: GameControllerIcon },
] as const satisfies ReadonlyArray<{ screen: Screen; label: string; Icon: Icon }>

const mangaDestination = { screen: 'manga', label: 'Manga', Icon: TranslateIcon } as const

const readerScreens = [
  { screen: 'novels', label: 'Novels' },
  { screen: 'galleries', label: 'Galleries' },
  { screen: 'glossaries', label: 'Glossaries' },
] as const satisfies ReadonlyArray<{ screen: Screen; label: string }>

const modelsDestination = { page: 'models', label: 'Models', Icon: PlugsConnectedIcon } as const

const detectionsDestination = { page: 'detections', label: 'Detections', Icon: ScanIcon } as const

const novelsDestination = { page: 'novels', label: 'Novels', Icon: BookOpenTextIcon } as const

const downloadsDestination = {
  page: 'downloads',
  label: 'Downloads',
  Icon: DownloadSimpleIcon,
} as const

const translationPages = [
  { page: 'translation', label: 'Games' },
  { page: 'overlay', label: 'Overlay' },
  { page: 'subtitles', label: 'Subtitles' },
  { page: 'manga', label: 'Manga' },
] as const satisfies ReadonlyArray<{ page: SettingsPage; label: string }>

function NavButton({
  label,
  Icon,
  active,
  onClick,
}: {
  readonly label: string
  readonly Icon: Icon
  readonly active: boolean
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground',
        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
      )}
      onClick={onClick}
    >
      <Icon />
      {label}
    </Button>
  )
}

function ReaderGroup({ onGo }: { readonly onGo: (screen: Screen) => void }) {
  const screen = useAtomValue(screenAtom)
  const inGroup = readerScreens.some((destination) => destination.screen === screen)
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open || inGroup} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="group w-full justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground"
          />
        }
      >
        <BookOpenTextIcon />
        Reader
        <CaretDownIcon className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 flex flex-col gap-0.5 border-l border-sidebar-border py-0.5 pl-2">
          {readerScreens.map((destination) => (
            <Button
              key={destination.screen}
              variant="ghost"
              aria-current={screen === destination.screen ? 'page' : undefined}
              className={cn(
                'h-8 justify-start px-2 font-normal whitespace-nowrap text-sidebar-foreground',
                screen === destination.screen &&
                  'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )}
              onClick={() => onGo(destination.screen)}
            >
              {destination.label}
            </Button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function GroupLabel({ children }: { readonly children: string }) {
  return (
    <div className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground first:pt-1">
      {children}
    </div>
  )
}

function TranslationGroup() {
  const [page, setPage] = useAtom(settingsPageAtom)
  const inGroup = translationPages.some((destination) => destination.page === page)
  const [open, setOpen] = useState(inGroup)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="group w-full justify-start gap-2.5 px-2 font-normal whitespace-nowrap text-sidebar-foreground"
          />
        }
      >
        <TranslateIcon />
        Translation
        <CaretDownIcon className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 flex flex-col gap-0.5 border-l border-sidebar-border py-0.5 pl-2">
          {translationPages.map((destination) => (
            <Button
              key={destination.page}
              variant="ghost"
              aria-current={page === destination.page ? 'page' : undefined}
              className={cn(
                'h-8 justify-start px-2 font-normal whitespace-nowrap text-sidebar-foreground',
                page === destination.page &&
                  'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )}
              onClick={() => setPage(destination.page)}
            >
              {destination.label}
            </Button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SettingsNavigation({ onBack }: { readonly onBack: () => void }) {
  const [page, setPage] = useAtom(settingsPageAtom)
  const detectionsAvailable = useDetectionsAvailable()

  const navButton = (
    destination:
      | typeof modelsDestination
      | typeof detectionsDestination
      | typeof downloadsDestination
      | typeof novelsDestination,
  ) => (
    <NavButton
      label={destination.label}
      Icon={destination.Icon}
      active={page === destination.page}
      onClick={() => setPage(destination.page)}
    />
  )

  return (
    <>
      <Button
        variant="ghost"
        className="mb-2 justify-start gap-2 px-2 font-normal text-muted-foreground"
        onClick={onBack}
      >
        <CaretLeftIcon />
        Back to app
      </Button>
      {navButton(modelsDestination)}
      <TranslationGroup />
      {detectionsAvailable ? navButton(detectionsDestination) : null}
      {navButton(downloadsDestination)}
      {navButton(novelsDestination)}
    </>
  )
}

const navigationLabel = (screen: Screen) => {
  if (screen === 'settings') {
    return 'Settings'
  }

  return screen === 'logs' ? 'Logs' : 'Main'
}

export function Sidebar() {
  const [screen, setScreen] = useAtom(screenAtom)
  const setGameId = useAtomSet(gameIdAtom)
  const setGalleryFolder = useAtomSet(galleryFolderAtom)
  const setOpenGallery = useAtomSet(openGalleryAtom)
  const setOpenNovel = useAtomSet(openNovelAtom)
  const setOpenGlossary = useAtomSet(openGlossaryAtom)
  const open = useAtomValue(sidebarOpenAtom)

  const go = (destination: Screen) => {
    setScreen(destination)
    setGameId(undefined)
    setGalleryFolder(undefined)
    setOpenGallery(undefined)
    setOpenNovel(undefined)
    setOpenGlossary(undefined)
  }

  return (
    <nav
      aria-label={navigationLabel(screen)}
      inert={!open}
      className={cn(
        'flex shrink-0 flex-col gap-0.5 overflow-hidden pt-1.5 pb-3.5 transition-[width,padding,opacity] duration-200 ease-out',
        open ? 'w-56 px-3' : 'w-0 px-0 opacity-0',
      )}
    >
      {screen === 'logs' ? <LogsSidebar /> : null}
      {screen === 'settings' ? <SettingsNavigation onBack={() => setScreen('dashboard')} /> : null}
      {screen === 'logs' || screen === 'settings' ? null : (
        <>
          <GroupLabel>General</GroupLabel>
          <OverlayPopover />
          <SubtitlesPopover />
          <DetectionsPopover />
          <DownloadsPopover />
          <GroupLabel>App</GroupLabel>
          {appDestinations.map((destination) => (
            <NavButton
              key={destination.screen}
              label={destination.label}
              Icon={destination.Icon}
              active={screen === destination.screen}
              onClick={() => go(destination.screen)}
            />
          ))}
          <ReaderGroup onGo={go} />
          <NavButton
            label={mangaDestination.label}
            Icon={mangaDestination.Icon}
            active={screen === mangaDestination.screen}
            onClick={() => go(mangaDestination.screen)}
          />
          <div className="flex-1" />
          <StorageMeter />
          <NavButton
            label="Plugins"
            Icon={PuzzlePieceIcon}
            active={screen === 'plugins'}
            onClick={() => go('plugins')}
          />
          <NavButton
            label="Settings"
            Icon={GearIcon}
            active={false}
            onClick={() => setScreen('settings')}
          />
        </>
      )}
    </nav>
  )
}
