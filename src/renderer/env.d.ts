import type { WenbuBridge } from '#contract/Bridge'

declare global {
  interface Window {
    readonly wenbu: WenbuBridge
    readonly queryLocalFonts?: () => Promise<ReadonlyArray<{ readonly family: string }>>
  }
}
