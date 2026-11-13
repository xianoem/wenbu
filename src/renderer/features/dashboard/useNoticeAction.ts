import { useAtomSet } from '@effect/atom-react'
import { Match } from 'effect'
import {
  detailsReviewAtom,
  gameIdAtom,
  screenAtom,
  settingsPageAtom,
  sourceChangesAtom,
  translationReviewAtom,
} from '#lib/navigation'
import { useOpenLogs } from '../diagnostics/hooks/useOpenLogs'
import { answerDownloadAtom, resumeDownloadAtom, signInAtom } from './dashboard'
import type { NoticeAction } from './notices'

export const useNoticeAction = () => {
  const setScreen = useAtomSet(screenAtom)
  const setGameId = useAtomSet(gameIdAtom)
  const setReview = useAtomSet(translationReviewAtom)
  const setChanges = useAtomSet(sourceChangesAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)
  const setDetailsReview = useAtomSet(detailsReviewAtom)
  const openLogs = useOpenLogs()
  const resume = useAtomSet(resumeDownloadAtom)
  const answer = useAtomSet(answerDownloadAtom)
  const signIn = useAtomSet(signInAtom)

  return (action: NoticeAction) => {
    Match.value(action).pipe(
      Match.discriminatorsExhaustive('kind')({
        game: (open) => {
          setGameId(open.gameId)
          setReview(open.view === 'review' ? open.gameId : undefined)
          setChanges(open.view === 'changes' ? open.gameId : undefined)
          setScreen('library')
        },
        settings: (open) => {
          setSettingsPage(open.page)
          setScreen('settings')
        },
        'resume-download': (download) => resume({ payload: { jobId: download.jobId } }),
        'answer-download': (download) =>
          answer({ payload: { jobId: download.jobId, accept: true } }),
        'sign-in': (account) => signIn({ payload: { source: account.source } }),
        screen: (open) => (open.screen === 'logs' ? openLogs() : setScreen(open.screen)),
        'details-review': () => {
          setGameId(undefined)
          setDetailsReview(true)
          setScreen('library')
        },
        external: (open) => window.wenbu.openExternal(open.url),
      }),
    )
  }
}
