import {
  BookOpenTextIcon,
  type Icon,
  LightningIcon,
  MusicNotesIcon,
  PlugIcon,
  ScanIcon,
  WaveformIcon,
} from '@phosphor-icons/react'
import type { PluginId } from '#contract/Plugins'

export const pluginMarks: Record<PluginId, { readonly Icon: Icon; readonly className: string }> = {
  'screen-ai': { Icon: ScanIcon, className: 'bg-tint-teal text-tint-teal-foreground' },
  'luna-hook': { Icon: PlugIcon, className: 'bg-tint-violet text-tint-violet-foreground' },
  'manga-image-translator': {
    Icon: BookOpenTextIcon,
    className: 'bg-tint-amber text-tint-amber-foreground',
  },
  'qwen3-asr': { Icon: WaveformIcon, className: 'bg-tint-slate text-tint-slate-foreground' },
  'sensevoice-small': { Icon: LightningIcon, className: 'bg-tint-teal text-tint-teal-foreground' },
  'whisper-large-v3-turbo': {
    Icon: WaveformIcon,
    className: 'bg-tint-amber text-tint-amber-foreground',
  },
  'fun-asr-mlt-nano': {
    Icon: MusicNotesIcon,
    className: 'bg-tint-violet text-tint-violet-foreground',
  },
}
