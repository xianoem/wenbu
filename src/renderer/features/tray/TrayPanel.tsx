import { useAtomRefresh } from '@effect/atom-react'
import { GearSixIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OpenGeneralSettings } from '#contract/Background'
import { Button } from '#ui/button'
import logo from '../../../../build/icon.png'
import { useApplyTheme } from '../appearance/appearance'
import { QuitConfirm } from '../background/QuitConfirm'
import { useDetectionsAvailable } from '../detections/hooks/useDetectionsAvailable'
import { continueReadingAtom } from '../galleries/galleries'
import { gamesAtom } from '../library/library'
import { shelfAtom } from '../novels/novels'
import { DownloadBox } from './components/DownloadBox'
import { JumpBackIn } from './components/JumpBackIn'
import { LatestDetection } from './components/LatestDetection'
import { PanelMenu } from './components/PanelMenu'
import { QuickActions } from './components/QuickActions'

export function TrayPanel() {
  useApplyTheme()

  const root = useRef<HTMLDivElement | null>(null)
  const [link, setLink] = useState<string | undefined>(undefined)
  const [opened, setOpened] = useState(0)
  const canDetect = useDetectionsAvailable()
  const refreshGames = useAtomRefresh(gamesAtom)
  const refreshNovels = useAtomRefresh(shelfAtom)
  const refreshGalleries = useAtomRefresh(continueReadingAtom)

  useEffect(
    () =>
      window.wenbu.onPanelShown((shown) => {
        setLink(shown.link)
        setOpened((count) => count + 1)
      }),
    [],
  )

  // Main shows the window only after this, so it opens at its final size.
  useLayoutEffect(() => {
    if (opened > 0 && root.current !== null) {
      window.wenbu.resizePanel(root.current.offsetHeight)
    }
  }, [opened])

  // Fresh data loads while the panel is hidden, so nothing moves while it is on screen.
  useEffect(() => {
    const changed = () => {
      if (document.visibilityState === 'hidden') {
        refreshGames()
        refreshNovels()
        refreshGalleries()

        return
      }

      requestAnimationFrame(() => requestAnimationFrame(() => window.wenbu.panelPainted()))
    }

    document.addEventListener('visibilitychange', changed)

    return () => document.removeEventListener('visibilitychange', changed)
  }, [refreshGames, refreshNovels, refreshGalleries])

  useEffect(() => {
    const element = root.current

    if (element === null) {
      return
    }

    const observer = new ResizeObserver(() => window.wenbu.resizePanel(element.offsetHeight))

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.wenbu.hidePanel()
      }
    }

    window.addEventListener('keydown', close)

    return () => window.removeEventListener('keydown', close)
  }, [])

  return (
    <div ref={root} className="p-4 select-none">
      <div className="flex flex-col overflow-hidden rounded-[20px] bg-popover text-popover-foreground shadow-[0_24px_48px_-12px_rgb(0_0_0/0.6),0_8px_16px_-8px_rgb(0_0_0/0.5),0_0_0_1px_oklch(1_0_0/0.08)]">
        <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <img src={logo} alt="" className="size-7 rounded-lg" />
          <span className="flex-1 text-sm font-semibold">Wenbu</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            className="rounded-full text-muted-foreground"
            onClick={() => window.wenbu.openApp(OpenGeneralSettings.make({}))}
          >
            <GearSixIcon />
          </Button>
        </header>
        <div className="flex flex-col gap-3.5 px-4 pb-3.5">
          <DownloadBox key={opened} link={link} />
          {canDetect ? <LatestDetection /> : null}
          <JumpBackIn />
          <QuickActions canDetect={canDetect} />
        </div>
        <PanelMenu canDetect={canDetect} />
      </div>
      <QuitConfirm />
    </div>
  )
}
