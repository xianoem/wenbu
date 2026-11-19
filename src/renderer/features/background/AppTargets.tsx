import { useAtomSet } from '@effect/atom-react'
import { Match } from 'effect'
import { useEffect } from 'react'
import type { AppTarget } from '#contract/Background'
import {
  gameIdAtom,
  novelReaderAtom,
  openNovelAtom,
  screenAtom,
  settingsPageAtom,
  viewerAtom,
} from '#lib/navigation'

export function AppTargets() {
  const setScreen = useAtomSet(screenAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)
  const setGameId = useAtomSet(gameIdAtom)
  const setOpenNovel = useAtomSet(openNovelAtom)
  const setNovelReader = useAtomSet(novelReaderAtom)
  const setViewer = useAtomSet(viewerAtom)

  useEffect(() => {
    const open = Match.type<AppTarget>().pipe(
      Match.tagsExhaustive({
        OpenHome: () => setScreen('dashboard'),
        OpenGeneralSettings: () => {
          setSettingsPage('general')
          setScreen('settings')
        },
        OpenGame: ({ gameId }) => {
          setGameId(gameId)
          setScreen('library')
        },
        OpenNovel: ({ novelId, chapter }) => {
          setOpenNovel(novelId)
          setNovelReader({ novelId, chapter })
          setScreen('novels')
        },
        OpenGallery: ({ folder, page, version }) => {
          setViewer({ folder, page, version })
          setScreen('galleries')
        },
      }),
    )

    return window.wenbu.onNavigate((target) => open(target))
  }, [setScreen, setSettingsPage, setGameId, setOpenNovel, setNovelReader, setViewer])

  return null
}
