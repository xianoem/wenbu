import type { BackgroundSettings } from '#contract/Background'

type CloseDecision = 'ask' | 'close' | 'quit'

interface CloseMoment {
  readonly quitting: boolean
  /** The user just answered the first-close question, which saves before main hears of it. */
  readonly answered: boolean
}

export const closeDecision = (settings: BackgroundSettings, moment: CloseMoment): CloseDecision => {
  if (moment.quitting || moment.answered) {
    return 'close'
  }

  if (!settings.closeAsked) {
    return 'ask'
  }

  return settings.closeAction === 'quit' ? 'quit' : 'close'
}
