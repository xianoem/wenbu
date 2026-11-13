import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { ArrowsClockwiseIcon, CaretRightIcon, XIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { Release, UpdateStatus, WhatsNew } from '#contract/Updates'
import { formatDay } from '#lib/format'
import { type Screen, screenAtom, settingsPageAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { ScrollArea } from '#ui/scroll-area'
import { Spinner } from '#ui/spinner'
import { type Destination, ReleaseNotes } from './components/ReleaseNotes'
import {
  installUpdateAtom,
  markWhatsNewSeenAtom,
  updateStatusAtom,
  whatsNewAtom,
  whatsNewKeys,
} from './updates'
import { splitReleases } from './utils/releaseSections'
import { whatsNewShown } from './utils/whatsNewShown'

const subtitleOf = (release: Release | undefined, updatedFrom: string | undefined) => {
  if (release === undefined) {
    return 'No release notes yet'
  }

  const released = formatDay(release.date)

  return updatedFrom === undefined ? released : `${released} · Updated from ${updatedFrom}`
}

function ReleaseHeading({ release }: { readonly release: Release }) {
  return (
    <div className="flex items-baseline gap-2 px-3 pt-3 pb-1">
      <span className="text-[13px] font-semibold tabular-nums">{release.version}</span>
      <span className="text-xs text-muted-foreground">{formatDay(release.date)}</span>
    </div>
  )
}

function EarlierVersions({
  releases,
  onOpen,
}: {
  readonly releases: ReadonlyArray<Release>
  readonly onOpen: (destination: Destination) => void
}) {
  if (releases.length === 0) {
    return null
  }

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="group h-9 w-full justify-start gap-2 rounded-xl px-3 text-[12.5px] font-normal text-muted-foreground"
          />
        }
      >
        <CaretRightIcon className="size-[13px] transition-transform group-data-panel-open:rotate-90" />
        Earlier versions
      </CollapsibleTrigger>
      <CollapsibleContent>
        {releases.map((release) => (
          <div key={release.version}>
            <ReleaseHeading release={release} />
            <ReleaseNotes release={release} onOpen={onOpen} />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function UpdateCard({
  status,
  onRestart,
}: {
  readonly status: UpdateStatus | undefined
  readonly onRestart: () => void
}) {
  if (status?.state === 'downloading') {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl bg-muted px-3.5 py-3 text-[12.5px] text-muted-foreground">
        <Spinner className="size-3.5" />
        Downloading Wenbu {status.version}
      </div>
    )
  }

  if (status?.state !== 'ready') {
    return null
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted px-3.5 py-3">
      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-tint-teal text-tint-teal-foreground">
        <ArrowsClockwiseIcon />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">Wenbu {status.version} is ready</div>
        <div className="text-xs text-muted-foreground">Installs when you restart or quit</div>
      </div>
      <Button size="sm" className="rounded-full px-3.5" onClick={onRestart}>
        Restart
      </Button>
    </div>
  )
}

function TriggerLabel({
  whatsNew,
  status,
}: {
  readonly whatsNew: WhatsNew
  readonly status: UpdateStatus | undefined
}) {
  if (status?.state === 'ready') {
    return (
      <>
        <ArrowsClockwiseIcon className="size-[15px]" />
        Restart to update
        <span className="ml-auto text-[11.5px] tabular-nums opacity-80">{status.version}</span>
      </>
    )
  }

  return (
    <>
      {whatsNew.updatedFrom === undefined ? null : (
        <span
          aria-label="Wenbu was updated"
          className="size-[7px] rounded-full bg-tint-violet-foreground ring-[3px] ring-tint-violet-foreground/20"
        />
      )}
      <span className={cn(whatsNew.updatedFrom === undefined && 'text-muted-foreground')}>
        What's new
      </span>
      <span className="ml-auto text-[11.5px] font-normal text-muted-foreground tabular-nums">
        v{whatsNew.version}
      </span>
    </>
  )
}

export function WhatsNewPopover({ onGo }: { readonly onGo: (screen: Screen) => void }) {
  const whatsNewResult = useAtomValue(whatsNewAtom)
  const statusResult = useAtomValue(updateStatusAtom)
  const markSeen = useAtomSet(markWhatsNewSeenAtom)
  const install = useAtomSet(installUpdateAtom)
  const setScreen = useAtomSet(screenAtom)
  const setSettingsPage = useAtomSet(settingsPageAtom)
  const [open, setOpen] = useState(false)

  if (!AsyncResult.isSuccess(whatsNewResult)) {
    return null
  }

  const whatsNew = whatsNewResult.value
  const status = AsyncResult.isSuccess(statusResult) ? statusResult.value : undefined

  if (!open && !whatsNewShown(whatsNew, status)) {
    return null
  }

  const { opened, earlier } = splitReleases(whatsNew)
  const ready = status?.state === 'ready'

  const change = (next: boolean) => {
    setOpen(next)

    if (!next && whatsNew.updatedFrom !== undefined) {
      markSeen({ payload: undefined, reactivityKeys: whatsNewKeys })
    }
  }

  const openDestination = (destination: Destination) => {
    change(false)

    if (destination === undefined) {
      return
    }

    if ('screen' in destination) {
      onGo(destination.screen)

      return
    }

    setSettingsPage(destination.settingsPage)
    setScreen('settings')
  }

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label={ready ? 'Restart to update Wenbu' : "What's new in Wenbu"}
            className={cn(
              'mt-2 h-[34px] justify-start gap-2 rounded-xl bg-muted pr-2.5 pl-2.5 text-[12.5px] font-medium whitespace-nowrap',
              ready && 'bg-tint-teal text-tint-teal-foreground hover:bg-tint-teal',
            )}
          />
        }
      >
        <TriggerLabel whatsNew={whatsNew} status={status} />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={24}
        className="flex w-[384px] flex-col gap-2 rounded-[22px] bg-popover/75 p-2 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex items-start px-3 pt-3 pb-1">
          <div>
            <div className="text-[15px] font-semibold">Wenbu {whatsNew.version}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {subtitleOf(opened[0], whatsNew.updatedFrom)}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            className="ml-auto text-muted-foreground"
            onClick={() => change(false)}
          >
            <XIcon />
          </Button>
        </div>
        {opened.length === 0 ? null : (
          <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-[min(520px,calc(var(--available-height)-170px))]">
            {opened.map((release, index) => (
              <div key={release.version}>
                {index === 0 ? null : <ReleaseHeading release={release} />}
                <ReleaseNotes release={release} onOpen={openDestination} />
              </div>
            ))}
            <EarlierVersions releases={earlier} onOpen={openDestination} />
          </ScrollArea>
        )}
        <UpdateCard status={status} onRestart={() => install({ payload: undefined })} />
      </PopoverContent>
    </Popover>
  )
}
