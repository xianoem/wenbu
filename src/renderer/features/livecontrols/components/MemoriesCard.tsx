import { useAtomSet } from '@effect/atom-react'
import {
  CaretRightIcon,
  CaretUpIcon,
  DoorIcon,
  FloppyDiskIcon,
  ImagesIcon,
  LockOpenIcon,
  UserIcon,
} from '@phosphor-icons/react'
import { Exit } from 'effect'
import { useEffect, useState } from 'react'
import type { Memories, MemorySwitch } from '#contract/Memories'
import { formErrorOf } from '#lib/forms'
import { Badge } from '#ui/badge'
import { Button } from '#ui/button'
import { Checkbox } from '#ui/checkbox'
import { ScrollArea } from '#ui/scroll-area'
import { findMemoriesAtom, unlockMemoriesAtom } from '../liveControls'

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'found'; readonly memories: Memories }

const loadOf = (exit: Exit.Exit<Memories, unknown>): Load =>
  Exit.isSuccess(exit)
    ? { status: 'found', memories: exit.value }
    : { status: 'failed', message: formErrorOf(exit)?.message ?? 'The memories could not be read.' }

const lockedIds = (switches: ReadonlyArray<MemorySwitch>) =>
  new Set(switches.filter((entry) => entry.suggested && !entry.unlocked).map((entry) => entry.id))

const scenesLine = (unlocked: number, total: number) =>
  `${unlocked} of ${total} ${total === 1 ? 'scene' : 'scenes'} unlocked`

const unlockLabel = (open: boolean, count: number, anyLocked: boolean) => {
  if (!anyLocked) {
    return 'All memories unlocked'
  }

  if (count === 0) {
    return 'Unlock memories'
  }

  return open ? `Unlock ${count} ${count === 1 ? 'memory' : 'memories'}` : 'Unlock all memories'
}

function SourceChip({
  icon,
  tint,
  title,
  detail,
}: {
  readonly icon: React.ReactNode
  readonly tint: string
  readonly title: string
  readonly detail: string
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className={`grid size-7 shrink-0 place-items-center rounded-[10px] ${tint}`}>
        {icon}
      </span>
      <div className="min-w-0 text-xs">
        <div className="font-medium">{title}</div>
        <div className="truncate text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

function SwitchStatus({ entry }: { readonly entry: MemorySwitch }) {
  if (entry.unlocked) {
    return (
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-medium">
        <span className="size-1.5 rounded-full bg-success" />
        Seen
      </span>
    )
  }

  const roomOnly = !entry.suggested

  return (
    <span className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-medium">
      <span
        className={`size-1.5 rounded-full ${roomOnly ? 'bg-warning' : 'bg-muted-foreground'}`}
      />
      {roomOnly ? 'Room only' : 'Locked'}
    </span>
  )
}

function Details({
  memories,
  selected,
  onToggle,
  onToggleAll,
}: {
  readonly memories: Memories
  readonly selected: ReadonlySet<number>
  readonly onToggle: (id: number, checked: boolean) => void
  readonly onToggleAll: (checked: boolean) => void
}) {
  const locked = memories.switches.filter((entry) => !entry.unlocked)
  const allChosen = locked.length > 0 && locked.every((entry) => selected.has(entry.id))
  const skipped = memories.switches.filter((entry) => !entry.suggested).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2.5">
        {memories.sharedSave === undefined ? null : (
          <SourceChip
            icon={<FloppyDiskIcon className="size-4" />}
            tint="bg-tint-teal text-tint-teal-foreground"
            title="Shared save"
            detail={memories.sharedSave}
          />
        )}
        {memories.unlockEvent === undefined ? null : (
          <SourceChip
            icon={<UserIcon className="size-4" />}
            tint="bg-tint-amber text-tint-amber-foreground"
            title="Unlock event"
            detail={memories.unlockEvent}
          />
        )}
        {memories.rooms.length === 0 ? null : (
          <SourceChip
            icon={<DoorIcon className="size-4" />}
            tint="bg-tint-violet text-tint-violet-foreground"
            title="Room"
            detail={skipped === 0 ? memories.rooms.join(', ') : `${skipped} unsure, left off`}
          />
        )}
      </div>
      <ScrollArea className="h-48 rounded-2xl border">
        <div className="px-3 py-1">
          <label className="flex items-center gap-2.5 py-2 text-xs text-muted-foreground">
            <Checkbox
              checked={allChosen}
              disabled={locked.length === 0}
              onCheckedChange={(checked) => onToggleAll(checked)}
            />
            <span className="flex-1">{selected.size} locked selected</span>
            <span>{memories.switches.length} found</span>
          </label>
          {memories.switches.map((entry) => (
            <label key={entry.id} className="flex items-center gap-2.5 border-t py-2">
              <Checkbox
                aria-label={entry.name === '' ? `Switch ${entry.id}` : entry.name}
                checked={entry.unlocked || selected.has(entry.id)}
                disabled={entry.unlocked}
                onCheckedChange={(checked) => onToggle(entry.id, checked)}
              />
              <span className="w-10 shrink-0 text-xs text-muted-foreground">#{entry.id}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {entry.name === '' ? '—' : entry.name}
              </span>
              <SwitchStatus entry={entry} />
            </label>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export function MemoriesCard() {
  const findMemories = useAtomSet(findMemoriesAtom, { mode: 'promiseExit' })
  const unlockMemories = useAtomSet(unlockMemoriesAtom, { mode: 'promiseExit' })
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const show = (next: Load) => {
    setLoad(next)
    setSelected(next.status === 'found' ? lockedIds(next.memories.switches) : new Set())
  }

  useEffect(() => {
    let current = true

    void findMemories({ payload: undefined }).then((exit) => {
      if (current) {
        const next = loadOf(exit)

        setLoad(next)
        setSelected(next.status === 'found' ? lockedIds(next.memories.switches) : new Set())
      }
    })

    return () => {
      current = false
    }
  }, [findMemories])

  if (load.status === 'loading') {
    return null
  }

  const shell = (body: React.ReactNode) => (
    <section className="flex flex-col gap-3.5 rounded-[20px] bg-card p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-tint-violet text-tint-violet-foreground">
          <ImagesIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Memories</div>
          <div className="text-xs text-muted-foreground">
            The game's recollection room and the scenes it replays.
          </div>
        </div>
        {load.status === 'found' && load.memories.sharedSave !== undefined ? (
          <Badge variant="secondary">
            <span className="size-1.5 rounded-full bg-success" />
            Shared save
          </Badge>
        ) : null}
      </div>
      {body}
    </section>
  )

  if (load.status === 'failed') {
    return shell(<div className="text-xs text-muted-foreground">{load.message}</div>)
  }

  const { memories } = load

  if (memories.switches.length === 0) {
    return shell(
      <div className="text-xs text-muted-foreground">
        Wenbu found no recollection room or scene switches in this game.
      </div>,
    )
  }

  const scenes = memories.switches.filter((entry) => entry.suggested)
  const unlocked = scenes.filter((entry) => entry.unlocked).length
  const percent = scenes.length === 0 ? 100 : Math.round((unlocked / scenes.length) * 100)

  const unlock = async () => {
    setBusy(true)
    setNotice(undefined)

    const exit = await unlockMemories({ payload: { switchIds: [...selected] } })

    setBusy(false)

    if (Exit.isFailure(exit)) {
      setNotice(formErrorOf(exit)?.message)

      return
    }

    setNotice(
      exit.value.persisted
        ? `Unlocked ${exit.value.unlocked}. The game's shared save keeps them.`
        : `Unlocked ${exit.value.unlocked}. Save the game to keep them.`,
    )

    show(loadOf(await findMemories({ payload: undefined })))
  }

  const toggle = (id: number, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)

      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }

      return next
    })

  const toggleAll = (checked: boolean) =>
    setSelected(
      checked
        ? new Set(memories.switches.filter((entry) => !entry.unlocked).map((entry) => entry.id))
        : new Set(),
    )

  return shell(
    <>
      <div>
        <div className="mb-1.5 flex justify-between">
          <span className="text-sm font-medium">{scenesLine(unlocked, scenes.length)}</span>
          <span className="text-xs text-muted-foreground">{percent}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FloppyDiskIcon className="size-4 shrink-0" />
        {memories.sharedSave === undefined ? (
          <span>Save the game after unlocking to keep the scenes.</span>
        ) : (
          <span>
            Kept by <span className="font-medium text-foreground">{memories.sharedSave}</span>{' '}
            outside the save slots, so every save sees it.
          </span>
        )}
      </div>
      {open ? (
        <Details
          memories={memories}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
        />
      ) : null}
      {notice === undefined ? null : <div className="text-xs text-muted-foreground">{notice}</div>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" className="text-muted-foreground" onClick={() => setOpen(!open)}>
          {open ? 'Hide details' : `Review ${memories.switches.length} switches`}
          {open ? (
            <CaretUpIcon data-icon="inline-end" />
          ) : (
            <CaretRightIcon data-icon="inline-end" />
          )}
        </Button>
        <Button
          className="rounded-full px-4"
          disabled={busy || selected.size === 0}
          onClick={() => void unlock()}
        >
          <LockOpenIcon data-icon="inline-start" />
          {unlockLabel(
            open,
            selected.size,
            memories.switches.some((entry) => !entry.unlocked),
          )}
        </Button>
      </div>
    </>,
  )
}
