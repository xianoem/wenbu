import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowsClockwiseIcon,
  ArrowUpRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  CircleIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  type Icon,
  PushPinIcon,
  SubtitlesIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { InstallStep, InstallStepStatus, Plugin } from '#contract/Plugins'
import { SpeechModelId } from '#contract/Subtitles'
import { formatBytes, formatDay, formatMoment } from '#lib/format'
import { Button } from '#ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '#ui/trace'
import {
  cancelPluginInstallAtom,
  checkPluginUpdatesAtom,
  installPluginAtom,
  pluginsAtom,
  removePluginAtom,
  testPluginAtom,
} from './plugins'
import { pluginMarks } from './pluginMarks'
import { NotEnoughSpaceNotice } from '../storage/NotEnoughSpaceNotice'
import { subtitleSettingsAtom } from '../subtitles/subtitles'

type Status =
  | 'installing'
  | 'failed'
  | 'unsupported'
  | 'test-failed'
  | 'update'
  | 'ready'
  | 'missing'

const statuses: Record<Status, { readonly label: string; readonly className: string }> = {
  installing: { label: 'Installing', className: 'bg-foreground/10 text-foreground' },
  failed: { label: 'Install failed', className: 'bg-destructive/10 text-destructive' },
  unsupported: { label: 'Not available', className: 'bg-muted text-muted-foreground' },
  'test-failed': { label: 'Test failed', className: 'bg-warning/10 text-warning' },
  update: { label: 'Update available', className: 'bg-warning/10 text-warning' },
  ready: { label: 'Ready', className: 'bg-success/10 text-success' },
  missing: { label: 'Not installed', className: 'bg-muted text-muted-foreground' },
}

const stepIcons: Record<InstallStepStatus, { readonly Icon: Icon; readonly className: string }> = {
  pending: { Icon: CircleIcon, className: '' },
  running: { Icon: CircleNotchIcon, className: 'animate-spin text-foreground' },
  done: { Icon: CheckCircleIcon, className: 'text-success' },
  failed: { Icon: XCircleIcon, className: 'text-destructive' },
}

const statusOf = (plugin: Plugin): Status => {
  if (plugin.install?.running === true) {
    return 'installing'
  }

  if (plugin.install?.error !== undefined) {
    return 'failed'
  }

  if (!plugin.supported) {
    return 'unsupported'
  }

  if (plugin.installed === undefined) {
    return 'missing'
  }

  if (!plugin.installed.test.passed) {
    return 'test-failed'
  }

  return plugin.latest !== undefined && plugin.latest.version !== plugin.installed.version
    ? 'update'
    : 'ready'
}

const versionLine = (plugin: Plugin) => {
  const { installed, latest } = plugin

  const published =
    latest?.publishedAt === undefined ? '' : ` from ${formatDay(latest.publishedAt)}`

  if (installed === undefined) {
    return latest === undefined ? '—' : `${latest.version}${published}`
  }

  if (latest !== undefined && latest.version !== installed.version) {
    return `${installed.version} → ${latest.version}${published}`
  }

  return plugin.pinned === undefined ? `${installed.version} · up to date` : installed.version
}

const sizeLine = (plugin: Plugin) => {
  if (plugin.installed !== undefined) {
    return `${formatBytes(plugin.installed.sizeBytes)} on disk`
  }

  return plugin.latest?.downloadBytes === undefined
    ? ''
    : `${formatBytes(plugin.latest.downloadBytes)} download`
}

const progressText = (step: InstallStep) => {
  if (step.progress === undefined || step.status !== 'running') {
    return step.detail
  }

  return `${formatBytes(step.progress.done)} of ${formatBytes(step.progress.total)}`
}

function StatusPill({ status }: { readonly status: Status }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        statuses[status].className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {statuses[status].label}
    </span>
  )
}

function InstallTrace({ plugin }: { readonly plugin: Plugin }) {
  const install = plugin.install
  const running = install?.steps.find((step) => step.status === 'running')

  if (install === undefined) {
    return plugin.installed?.test.passed === false ? (
      <p className="mt-3 rounded-2xl bg-muted/35 px-3.5 py-2.5 text-[13px] text-warning">
        {plugin.installed.test.message}
      </p>
    ) : null
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-muted/35 px-3.5 py-3">
      {install.steps.length === 0 ? (
        <TraceLine status="running">
          <TraceIcon>
            <CircleNotchIcon className="animate-spin text-foreground" />
          </TraceIcon>
          <TraceTitle className="text-foreground">Looking up the newest version</TraceTitle>
        </TraceLine>
      ) : (
        <Trace>
          {install.steps.map((step) => {
            const { Icon, className } = stepIcons[step.status]
            const detail = progressText(step)

            return (
              <TraceLine
                key={step.label}
                {...(step.status === 'running'
                  ? { status: 'running' }
                  : step.status === 'failed'
                    ? { status: 'error' }
                    : step.status === 'pending'
                      ? { status: 'pending' }
                      : {})}
              >
                <TraceIcon>
                  <Icon className={className} />
                </TraceIcon>
                <TraceTitle className="text-foreground">{step.label}</TraceTitle>
                {detail === undefined ? null : <TraceDescription>{detail}</TraceDescription>}
              </TraceLine>
            )
          })}
        </Trace>
      )}
      {running?.progress === undefined ? null : (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{
              width: `${Math.min(100, (running.progress.done / Math.max(1, running.progress.total)) * 100)}%`,
            }}
          />
        </div>
      )}
      {install.space === undefined ? null : <NotEnoughSpaceNotice space={install.space} />}
      {install.error === undefined || install.space !== undefined ? null : (
        <p className="text-[13px] text-destructive">{install.error}</p>
      )}
    </div>
  )
}

function PluginAction({ plugin, status }: { readonly plugin: Plugin; readonly status: Status }) {
  const install = useAtomSet(installPluginAtom)
  const cancel = useAtomSet(cancelPluginInstallAtom)
  const remove = useAtomSet(removePluginAtom)
  const test = useAtomSet(testPluginAtom)
  const payload = { id: plugin.id }

  if (status === 'installing') {
    return (
      <Button
        variant="outline"
        className="h-8 rounded-full px-3.5"
        onClick={() => cancel({ payload })}
      >
        Cancel
      </Button>
    )
  }

  if (status === 'unsupported') {
    return null
  }

  if (status === 'ready') {
    return (
      <Button
        variant="ghost"
        className="h-8 rounded-full px-3.5 text-muted-foreground"
        onClick={() => remove({ payload })}
      >
        Remove
      </Button>
    )
  }

  if (status === 'test-failed') {
    return (
      <Button
        variant="outline"
        className="h-8 rounded-full px-3.5"
        onClick={() => test({ payload })}
      >
        Test again
      </Button>
    )
  }

  return (
    <Button className="h-8 rounded-full px-3.5" onClick={() => install({ payload })}>
      {status === 'update' ? (
        `Update to ${plugin.latest?.version ?? ''}`
      ) : (
        <>
          <DownloadSimpleIcon />
          {status === 'failed' ? 'Try again' : 'Install'}
        </>
      )}
    </Button>
  )
}

const rowGrid =
  'grid grid-cols-[44px_minmax(0,1.5fr)_minmax(0,1fr)_150px_150px] items-center gap-3.5'

function SourceLink({ plugin }: { readonly plugin: Plugin }) {
  return (
    <Button
      variant="link"
      className="h-auto min-w-0 shrink gap-0.5 p-0 text-[12.5px] font-normal text-muted-foreground hover:text-foreground"
      onClick={() => window.wenbu.openExternal(plugin.sourceUrl)}
    >
      <span className="truncate">{plugin.sourceLabel}</span>
      <ArrowUpRightIcon className="size-3 shrink-0" />
    </Button>
  )
}

function VersionCell({ plugin }: { readonly plugin: Plugin }) {
  return (
    <span className="min-w-0 text-[13px]">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{versionLine(plugin)}</span>
        {plugin.pinned === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex shrink-0 cursor-default items-center gap-0.5 text-xs text-muted-foreground" />
              }
            >
              <PushPinIcon className="size-3" />
              tested
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{plugin.pinned}</TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className="block truncate text-xs text-muted-foreground">
        {plugin.checkError ?? sizeLine(plugin)}
      </span>
    </span>
  )
}

function PluginRow({ plugin }: { readonly plugin: Plugin }) {
  const status = statusOf(plugin)
  const { Icon, className } = pluginMarks[plugin.id]

  return (
    <li className="border-t px-3.5 py-3 first:border-t-0">
      <div className={rowGrid}>
        <span
          className={cn(
            'flex size-11 items-center justify-center rounded-[14px] text-[21px]',
            className,
          )}
        >
          <Icon />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">{plugin.name}</span>
          <span className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted-foreground">
            <span className="shrink-0">{plugin.project} ·</span>
            <SourceLink plugin={plugin} />
          </span>
        </span>
        <VersionCell plugin={plugin} />
        <StatusPill status={status} />
        <span className="justify-self-end">
          <PluginAction plugin={plugin} status={status} />
        </span>
      </div>
      <div className="ml-[58px]">
        <InstallTrace plugin={plugin} />
      </div>
    </li>
  )
}

function ModelRow({
  plugin,
  inUse,
  last,
}: {
  readonly plugin: Plugin
  readonly inUse: boolean
  readonly last: boolean
}) {
  const status = statusOf(plugin)
  const { Icon, className } = pluginMarks[plugin.id]

  return (
    <li className="relative px-3.5 py-2">
      <span className={cn('absolute top-0 left-9 w-px bg-border', last ? 'h-1/2' : 'bottom-0')} />
      <span className="absolute top-1/2 left-9 h-px w-4 bg-border" />
      <div className={rowGrid}>
        <span />
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-[10px] text-base',
              className,
            )}
          >
            <Icon />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold">
              {plugin.name}
              {inUse ? (
                <span className="rounded-full bg-success/10 px-2 py-px text-[11.5px] font-medium text-success">
                  In use
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 text-[12.5px]">
              <SourceLink plugin={plugin} />
            </span>
          </span>
        </span>
        <VersionCell plugin={plugin} />
        <StatusPill status={status} />
        <span className="justify-self-end">
          <PluginAction plugin={plugin} status={status} />
        </span>
      </div>
      <div className="ml-[100px]">
        <InstallTrace plugin={plugin} />
      </div>
    </li>
  )
}

const groupOrder: ReadonlyArray<Status> = ['installing', 'failed', 'test-failed', 'update', 'ready']

const groupStatus = (plugins: ReadonlyArray<Plugin>): Status => {
  const all = new Set(plugins.map((plugin) => statusOf(plugin)))

  return groupOrder.find((status) => all.has(status)) ?? 'missing'
}

const isSpeechModel = Schema.is(SpeechModelId)

function SpeechModelsGroup({ plugins }: { readonly plugins: ReadonlyArray<Plugin> }) {
  const [open, setOpen] = useState(false)
  const settings = useAtomValue(subtitleSettingsAtom)
  const inUse = AsyncResult.isSuccess(settings) ? settings.value.model : undefined
  const installed = plugins.filter((plugin) => plugin.installed !== undefined)
  const onDisk = installed.reduce((total, plugin) => total + (plugin.installed?.sizeBytes ?? 0), 0)
  const busy = plugins.some((plugin) => plugin.install !== undefined)
  const shown = open || busy

  return (
    <>
      <li className="border-t px-3.5 py-3 first:border-t-0">
        <div className={rowGrid}>
          <span className="flex size-11 items-center justify-center rounded-[14px] bg-tint-slate text-[21px] text-tint-slate-foreground">
            <SubtitlesIcon />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Live Subtitles</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {plugins.length} speech models · pick one in Subtitles settings
            </span>
          </span>
          <span className="min-w-0 text-[13px]">
            <span className="block truncate">
              {installed.length} of {plugins.length} installed
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {installed.length === 0 ? 'Nothing on disk' : `${formatBytes(onDisk)} on disk`}
            </span>
          </span>
          <StatusPill status={groupStatus(plugins)} />
          <span className="justify-self-end">
            <Button
              variant="outline"
              className="h-8 gap-1.5 rounded-full px-3.5"
              disabled={busy}
              onClick={() => setOpen(!open)}
            >
              {shown ? 'Hide models' : 'Show models'}
              {shown ? <CaretUpIcon /> : <CaretDownIcon />}
            </Button>
          </span>
        </div>
      </li>
      {shown
        ? plugins.map((plugin, index) => (
            <ModelRow
              key={plugin.id}
              plugin={plugin}
              inUse={plugin.id === inUse}
              last={index === plugins.length - 1}
            />
          ))
        : null}
    </>
  )
}

export function PluginsPage() {
  const result = useAtomValue(pluginsAtom)
  const check = useAtomSet(checkPluginUpdatesAtom)
  const state = AsyncResult.isSuccess(result) ? result.value : undefined

  return (
    <div className="flex flex-col">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <h1 className="text-[28px] font-semibold tracking-tight">Plugins</h1>
          <p className="mt-1 text-muted-foreground">
            Tools Wenbu downloads from their own projects when a feature needs them.
          </p>
        </div>
        {state === undefined ? null : (
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] text-muted-foreground">
              {state.checking
                ? 'Checking…'
                : state.checkedAt === undefined
                  ? 'Not checked yet'
                  : `Checked ${formatMoment(state.checkedAt).toLowerCase()}`}
            </span>
            <Button
              variant="outline"
              className="h-9 gap-1.5 rounded-full px-4"
              disabled={state.checking}
              onClick={() => check({ payload: undefined })}
            >
              <ArrowsClockwiseIcon className={cn(state.checking && 'animate-spin')} />
              Check for updates
            </Button>
          </div>
        )}
      </div>

      {state === undefined ? null : (
        <ul className="mt-6 rounded-3xl bg-card p-1.5 shadow-card">
          {state.plugins
            .filter((plugin) => !isSpeechModel(plugin.id))
            .map((plugin) => (
              <PluginRow key={plugin.id} plugin={plugin} />
            ))}
          <SpeechModelsGroup plugins={state.plugins.filter((plugin) => isSpeechModel(plugin.id))} />
        </ul>
      )}
    </div>
  )
}
