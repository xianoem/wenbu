import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { TextColumnsIcon, TranslateIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import type { InGameTextSettings } from '#contract/InGameText'
import { Switch } from '#ui/switch'
import { inGameTextSettingsAtom, saveInGameTextSettingsAtom, settingsKeys } from './inGameText'

function SwitchRow({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  readonly icon: React.ReactNode
  readonly title: string
  readonly description: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch aria-label={title} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function InGameTextSwitches({
  gameId,
  unavailable,
}: {
  readonly gameId: string
  readonly unavailable: (control: 'inGameText' | 'wordWrap') => string | undefined
}) {
  const result = useAtomValue(inGameTextSettingsAtom(gameId))
  const save = useAtomSet(saveInGameTextSettingsAtom)

  if (!AsyncResult.isSuccess(result)) {
    return null
  }

  const settings = result.value

  const change = (next: Partial<InGameTextSettings>) =>
    save({
      payload: { gameId, settings: { ...settings, ...next } },
      reactivityKeys: settingsKeys(gameId),
    })

  const describe = (control: 'inGameText' | 'wordWrap', description: string) => {
    const reason = unavailable(control)

    return reason === undefined ? description : `Unavailable: ${reason}`
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <SwitchRow
        icon={<TranslateIcon className="size-5 text-muted-foreground" />}
        title="In-game text"
        description={describe('inGameText', 'Translate menus and UI.')}
        checked={settings.uiText}
        onCheckedChange={(uiText) => change({ uiText })}
      />
      <SwitchRow
        icon={<TextColumnsIcon className="size-5 text-muted-foreground" />}
        title="Dialogue Word Wrap"
        description={describe('wordWrap', 'Break long lines between words.')}
        checked={settings.wordWrap}
        onCheckedChange={(wordWrap) => change({ wordWrap })}
      />
    </div>
  )
}
