import type { UpdateStatus, WhatsNew } from '#contract/Updates'

export const whatsNewShown = (whatsNew: WhatsNew, status: UpdateStatus | undefined) =>
  whatsNew.updatedFrom !== undefined || status?.state === 'downloading' || status?.state === 'ready'
