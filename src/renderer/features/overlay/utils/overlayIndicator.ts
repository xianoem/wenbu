import type { OverlayState } from '#contract/TranslationOverlay'

export const overlayIndicator = (
  state: Pick<OverlayState, 'status' | 'sessionId' | 'visible'> | undefined,
) => {
  if (state?.status === 'failed') {
    return 'bg-destructive'
  }

  if (state?.sessionId === undefined) {
    return undefined
  }

  return state.visible ? 'bg-warning' : 'border border-muted-foreground bg-transparent'
}
