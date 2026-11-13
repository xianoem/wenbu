import {
  ArrowSquareOutIcon,
  ChatTextIcon,
  CoinsIcon,
  type Icon,
  LockSimpleIcon,
  MapPinIcon,
  PackageIcon,
  ScrollIcon,
  SkullIcon,
  StorefrontIcon,
  SwordIcon,
  UserIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import type { FactKind, FactStatus, GameFact, GuidePlace } from '#contract/GameGuide'
import { statusLabels, statusTones } from '../guide'

const kindIcons: Record<FactKind, Icon> = {
  gives: PackageIcon,
  takes: PackageIcon,
  sells: StorefrontIcon,
  drops: SkullIcon,
  fights: SwordIcon,
  'leads-to': ArrowSquareOutIcon,
  sets: ScrollIcon,
  joins: UsersThreeIcon,
  leaves: UsersThreeIcon,
  person: UserIcon,
  dialogue: ChatTextIcon,
  script: ScrollIcon,
}

const kindTones: Record<FactKind, string> = {
  gives: 'bg-tint-teal text-tint-teal-foreground',
  takes: 'bg-tint-amber text-tint-amber-foreground',
  sells: 'bg-tint-teal text-tint-teal-foreground',
  drops: 'bg-tint-amber text-tint-amber-foreground',
  fights: 'bg-tint-amber text-tint-amber-foreground',
  'leads-to': 'bg-tint-slate text-tint-slate-foreground',
  sets: 'bg-tint-slate text-tint-slate-foreground',
  joins: 'bg-tint-violet text-tint-violet-foreground',
  leaves: 'bg-tint-violet text-tint-violet-foreground',
  person: 'bg-tint-violet text-tint-violet-foreground',
  dialogue: 'bg-tint-slate text-tint-slate-foreground',
  script: 'bg-tint-slate text-tint-slate-foreground',
}

export function StatusPill({ status }: { readonly status: FactStatus }) {
  if (status === 'unknown') {
    return null
  }

  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap',
        statusTones[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {statusLabels[status]}
    </span>
  )
}

export const placeLabel = (place: GuidePlace) => {
  const at = place.x === undefined ? '' : ` · ${place.x}, ${place.y}`

  return place.eventName === undefined
    ? place.mapName
    : `${place.mapName} · ${place.eventName}${at}`
}

export function PlaceChip({ place }: { readonly place: GuidePlace }) {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full bg-tint-teal px-2.5 text-xs font-medium text-tint-teal-foreground">
      <MapPinIcon weight="fill" className="size-3.5 shrink-0" />
      <span className="truncate">{placeLabel(place)}</span>
    </span>
  )
}

export function CoinChip({ cost }: { readonly cost: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <CoinsIcon className="size-3.5" />${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}
    </span>
  )
}

export function FactRow({
  fact,
  selected = false,
  showPlace = true,
  onSelect,
}: {
  readonly fact: GameFact
  readonly selected?: boolean
  readonly showPlace?: boolean
  readonly onSelect?: (fact: GameFact) => void
}) {
  const KindIcon = kindIcons[fact.kind]
  const missing = fact.gate.filter((item) => item.holds === false)
  const shownGate = missing.length > 0 ? missing : fact.gate.slice(0, 2)

  const body = (
    <>
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-[10px]',
          kindTones[fact.kind],
        )}
      >
        <KindIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{fact.summary}</span>
        {showPlace && fact.place !== undefined ? (
          <span className="block truncate text-xs text-muted-foreground">
            {placeLabel(fact.place)}
          </span>
        ) : null}
        {fact.text === undefined ? null : (
          <span className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">
            {fact.text}
          </span>
        )}
        {shownGate.length === 0 ? null : (
          <span className="mt-1 flex flex-wrap gap-1">
            {shownGate.map((item) => (
              <span
                key={item.text}
                className={cn(
                  'inline-flex h-5 max-w-full items-center gap-1 truncate rounded-full px-2 text-[11px]',
                  item.holds === false
                    ? 'bg-tint-amber text-tint-amber-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <LockSimpleIcon className="size-3 shrink-0" />
                <span className="truncate">{item.text}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      <StatusPill status={fact.kind === 'dialogue' ? 'unknown' : fact.status} />
    </>
  )

  const className = cn(
    'flex w-full items-start gap-2.5 rounded-2xl px-2.5 py-2 text-left',
    selected ? 'bg-secondary' : 'hover:bg-secondary/60',
  )

  if (onSelect === undefined) {
    return <div className={className}>{body}</div>
  }

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={cn(className, 'cursor-pointer')}
      onClick={() => onSelect(fact)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onSelect(fact)
        }
      }}
    >
      {body}
    </div>
  )
}
