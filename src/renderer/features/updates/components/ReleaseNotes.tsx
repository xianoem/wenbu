import { ArrowRightIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { Release } from '#contract/Updates'
import type { Screen, SettingsPage } from '#lib/navigation'
import { Button } from '#ui/button'
import { areaLook } from '../areaLook'
import { type AreaChanges, fixesOf, newByArea } from '../utils/releaseSections'

export type Destination =
  | { readonly screen: Screen }
  | { readonly settingsPage: SettingsPage }
  | undefined

const destinationOf = (look: ReturnType<typeof areaLook>): Destination => {
  if (look.screen !== undefined) {
    return { screen: look.screen }
  }

  return look.settingsPage === undefined ? undefined : { settingsPage: look.settingsPage }
}

function AreaLines({ texts }: { readonly texts: ReadonlyArray<string> }) {
  return (
    <div className="mt-1 flex flex-col gap-1 pl-[38px]">
      {texts.map((text) => (
        <p key={text} className="text-[12.5px] leading-[1.45] font-normal text-muted-foreground">
          {text}
        </p>
      ))}
    </div>
  )
}

function AreaBlock({
  changes,
  onOpen,
}: {
  readonly changes: AreaChanges
  readonly onOpen: (destination: Destination) => void
}) {
  const look = areaLook(changes.area)
  const destination = destinationOf(look)

  const heading = (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-[9px]',
          look.tintClass,
        )}
      >
        <look.Icon className="size-[15px]" />
      </span>
      <span className="text-[13.5px] font-medium">{look.name}</span>
      {destination === undefined ? null : (
        <span className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover/area:text-foreground">
          Open
          <ArrowRightIcon className="size-[13px]" />
        </span>
      )}
    </div>
  )

  if (destination === undefined) {
    return (
      <div className="rounded-[14px] p-2.5">
        {heading}
        <AreaLines texts={changes.texts} />
      </div>
    )
  }

  return (
    <Button
      variant="ghost"
      className="group/area block h-auto w-full rounded-[14px] p-2.5 text-left whitespace-normal"
      onClick={() => onOpen(destination)}
    >
      {heading}
      <AreaLines texts={changes.texts} />
    </Button>
  )
}

export function ReleaseNotes({
  release,
  onOpen,
}: {
  readonly release: Release
  readonly onOpen: (destination: Destination) => void
}) {
  const areas = newByArea(release.changes)
  const fixes = fixesOf(release.changes)

  if (areas.length === 0 && fixes.length === 0) {
    return (
      <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
        Maintenance release, with nothing new to see.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {areas.map((changes) => (
        <AreaBlock key={changes.area} changes={changes} onOpen={onOpen} />
      ))}
      {areas.length > 0 && fixes.length > 0 ? (
        <div className="mx-2.5 my-1.5 h-px bg-border" />
      ) : null}
      {fixes.length === 0 ? null : (
        <div className="px-3 pb-1">
          <div className="pt-2 pb-1 text-xs font-medium text-muted-foreground">Fixes</div>
          {fixes.map((text) => (
            <div
              key={text}
              className="flex gap-2.5 py-1 text-[12.5px] leading-[1.45] text-muted-foreground"
            >
              <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-warning" />
              {text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
