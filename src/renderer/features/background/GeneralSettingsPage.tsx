import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import type { BackgroundSettings, NoticeKind } from '#contract/Background'
import type { DetectionSettings } from '#contract/Detections'
import { Switch } from '#ui/switch'
import {
  detectionSettingsAtom,
  detectionSettingsKeys,
  saveDetectionSettingsAtom,
} from '../detections/detections'
import { useDetectionsAvailable } from '../detections/hooks/useDetectionsAvailable'
import { QuickTranslateSettings } from '../quicktranslate/QuickTranslateSettings'
import { Segmented } from '../settings/components/Segmented'
import { SettingRow, SettingsCard } from '../settings/components/SettingsCard'
import { backgroundKeys, backgroundSettingsAtom, saveBackgroundSettingsAtom } from './background'

const noticeRows: ReadonlyArray<{
  readonly kind: NoticeKind
  readonly label: string
  readonly description?: string
}> = [
  {
    kind: 'runs',
    label: 'A translation run finishes or stops',
    description: 'RPG Maker and manga runs',
  },
  {
    kind: 'chapters',
    label: 'A followed Novel has new chapters',
    description: 'From its Official Source',
  },
  { kind: 'downloads', label: 'Downloads finish' },
  { kind: 'releases', label: 'A watched work is released' },
]

function Shortcut({ keys }: { readonly keys: ReadonlyArray<string> }) {
  return (
    <span className="inline-flex gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded-md px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground ring-1 ring-border"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

function BackgroundForm({
  settings,
  detections,
}: {
  readonly settings: BackgroundSettings
  readonly detections: DetectionSettings | undefined
}) {
  const save = useAtomSet(saveBackgroundSettingsAtom)
  const saveDetections = useAtomSet(saveDetectionSettingsAtom)

  const change = (next: Partial<BackgroundSettings>) =>
    save({ payload: { ...settings, ...next }, reactivityKeys: backgroundKeys })

  const notify = (kind: NoticeKind, on: boolean) =>
    change({ notify: { ...settings.notify, [kind]: on } })

  return (
    <div className="mt-7 flex flex-col gap-5">
      <SettingsCard
        title="Background"
        description="What happens when you close the window, and how Wenbu starts."
        className="gap-1"
      >
        <SettingRow label="When I close the window" description="The ✕ button and Alt+F4">
          <Segmented
            label="When I close the window"
            value={settings.closeAction}
            options={[
              ['tray', 'Keep in tray'],
              ['quit', 'Quit'],
            ]}
            onChange={(closeAction) => change({ closeAction, closeAsked: true })}
          />
        </SettingRow>
        <SettingRow label="Start with Windows" description="Opens in the tray, without a window">
          <Switch
            checked={settings.startWithWindows}
            onCheckedChange={(startWithWindows) => change({ startWithWindows })}
          />
        </SettingRow>
        <SettingRow
          label="Left-click on the tray icon"
          description="Double-click always opens the window"
        >
          <Segmented
            label="Left-click on the tray icon"
            value={settings.trayClick}
            options={[
              ['panel', 'Quick panel'],
              ['window', 'Open window'],
            ]}
            onChange={(trayClick) => change({ trayClick })}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard
        title="Notifications"
        description="Windows notifications, so you hear from Wenbu while its window is closed."
        className="gap-1"
      >
        {noticeRows.map((row) => (
          <SettingRow
            key={row.kind}
            label={row.label}
            {...(row.description === undefined ? {} : { description: row.description })}
          >
            <Switch
              checked={settings.notify[row.kind]}
              onCheckedChange={(on) => notify(row.kind, on)}
            />
          </SettingRow>
        ))}
      </SettingsCard>

      {window.wenbu.platform === 'win32' ? <QuickTranslateSettings /> : null}

      <SettingsCard
        title="Always on"
        description="Wenbu listens for these while it runs, with or without its window."
        className="gap-1"
      >
        {detections === undefined ? null : (
          <SettingRow
            label="Watch copied images"
            description="Makes Detections from images you copy"
          >
            <Switch
              checked={detections.listenToClipboard}
              onCheckedChange={(listenToClipboard) =>
                saveDetections({
                  payload: { ...detections, listenToClipboard },
                  reactivityKeys: detectionSettingsKeys,
                })
              }
            />
          </SettingRow>
        )}
        <SettingRow
          label="Watch copied gallery links"
          description="Copy a gallery link anywhere and Wenbu offers to download it"
        >
          <Switch
            checked={settings.watchLinks}
            onCheckedChange={(watchLinks) => change({ watchLinks })}
          />
        </SettingRow>
        <SettingRow
          label="When a gallery link is copied"
          description="Ask in a notification, or start the download at once"
        >
          <Segmented
            label="When a gallery link is copied"
            value={settings.linkAction}
            disabled={!settings.watchLinks}
            options={[
              ['ask', 'Ask'],
              ['download', 'Download'],
            ]}
            onChange={(linkAction) => change({ linkAction })}
          />
        </SettingRow>
        <SettingRow label="Download copied link" description="Works from any app">
          <Shortcut keys={['Ctrl', 'Alt', 'D']} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

export function GeneralSettingsPage() {
  const result = useAtomValue(backgroundSettingsAtom)
  const detections = useAtomValue(detectionSettingsAtom)
  const detectionsAvailable = useDetectionsAvailable()

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col">
      <h1 className="text-[28px] font-semibold tracking-tight">General</h1>
      <p className="mt-1 text-muted-foreground">
        How Wenbu runs in the background, and what it tells you while it does.
      </p>
      {AsyncResult.isSuccess(result) ? (
        <BackgroundForm
          settings={result.value}
          detections={
            detectionsAvailable && AsyncResult.isSuccess(detections) ? detections.value : undefined
          }
        />
      ) : null}
      {AsyncResult.isFailure(result) ? (
        <p className="mt-6 text-muted-foreground">Settings couldn't be loaded. Restart Wenbu.</p>
      ) : null}
    </div>
  )
}
