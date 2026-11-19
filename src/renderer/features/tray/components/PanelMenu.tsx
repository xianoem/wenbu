import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  AppWindowIcon,
  CaretRightIcon,
  type Icon,
  LinkSimpleIcon,
  PowerIcon,
  ScanIcon,
} from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import type { ReactNode } from 'react'
import { activityLabel, OpenHome } from '#contract/Background'
import { Button } from '#ui/button'
import { Separator } from '#ui/separator'
import { Switch } from '#ui/switch'
import {
  activityAtom,
  backgroundKeys,
  backgroundSettingsAtom,
  saveBackgroundSettingsAtom,
} from '../../background/background'
import {
  detectionSettingsAtom,
  detectionSettingsKeys,
  saveDetectionSettingsAtom,
} from '../../detections/detections'

const rowClass = 'h-[34px] w-full justify-start gap-2.5 rounded-xl px-2.5 text-[13px] font-medium'

function ActivityLine() {
  const result = useAtomValue(activityAtom)
  const activity = AsyncResult.isSuccess(result) ? result.value : []
  const [first, ...rest] = activity

  if (first === undefined) {
    return null
  }

  return (
    <Button
      variant="ghost"
      className="mx-1 mb-2 h-auto justify-start gap-2.5 rounded-[14px] bg-foreground/3.5 px-3 py-2.5 font-normal ring-1 ring-foreground/5 hover:bg-foreground/6"
      onClick={() => window.wenbu.openApp(OpenHome.make({}))}
    >
      <span className="size-2 shrink-0 rounded-full bg-info shadow-[0_0_0_3px] shadow-info/20" />
      <span className="min-w-0 flex-1 truncate text-left text-xs">{activityLabel(first)}</span>
      {rest.length === 0 ? null : (
        <span className="text-[11px] text-muted-foreground">+{rest.length} more</span>
      )}
      <CaretRightIcon className="size-3.5 text-muted-foreground" />
    </Button>
  )
}

function SwitchRow({
  Icon,
  label,
  checked,
  onChange,
}: {
  readonly Icon: Icon
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-[34px] cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium hover:bg-accent">
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function MenuRow({
  Icon,
  onClick,
  children,
}: {
  readonly Icon: Icon
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Button variant="ghost" className={rowClass} onClick={onClick}>
      <Icon className="size-4" />
      {children}
    </Button>
  )
}

export function PanelMenu({ canDetect }: { readonly canDetect: boolean }) {
  const background = useAtomValue(backgroundSettingsAtom)
  const detections = useAtomValue(detectionSettingsAtom)
  const saveBackground = useAtomSet(saveBackgroundSettingsAtom)
  const saveDetections = useAtomSet(saveDetectionSettingsAtom)

  return (
    <div className="flex flex-col px-1.5 pb-1.5">
      <ActivityLine />
      <Separator className="mx-1 mb-2 w-auto" />
      {canDetect && AsyncResult.isSuccess(detections) ? (
        <SwitchRow
          Icon={ScanIcon}
          label="Watch copied images"
          checked={detections.value.listenToClipboard}
          onChange={(listenToClipboard) =>
            saveDetections({
              payload: { ...detections.value, listenToClipboard },
              reactivityKeys: detectionSettingsKeys,
            })
          }
        />
      ) : null}
      {AsyncResult.isSuccess(background) ? (
        <SwitchRow
          Icon={LinkSimpleIcon}
          label="Watch copied gallery links"
          checked={background.value.watchLinks}
          onChange={(watchLinks) =>
            saveBackground({
              payload: { ...background.value, watchLinks },
              reactivityKeys: backgroundKeys,
            })
          }
        />
      ) : null}
      <Separator className="mx-1 my-2 w-auto" />
      <MenuRow Icon={AppWindowIcon} onClick={() => window.wenbu.openApp()}>
        Open Wenbu
      </MenuRow>
      <MenuRow Icon={PowerIcon} onClick={() => window.wenbu.quit(false)}>
        Quit Wenbu
      </MenuRow>
    </div>
  )
}
