import { BookOpenIcon, BooksIcon, type Icon, ImageIcon, ImagesIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { SourceAccount, SourceId } from '#contract/Downloads'
import { formatMoment } from '#lib/format'
import { Spinner } from '#ui/spinner'

export const sourceLooks: Record<SourceId, { readonly Icon: Icon; readonly className: string }> = {
  exhentai: { Icon: BookOpenIcon, className: 'bg-tint-violet text-tint-violet-foreground' },
  hdoujin: { Icon: BooksIcon, className: 'bg-tint-teal text-tint-teal-foreground' },
  hitomi: { Icon: ImagesIcon, className: 'bg-tint-amber text-tint-amber-foreground' },
  nhentai: { Icon: ImageIcon, className: 'bg-tint-slate text-tint-slate-foreground' },
}

export function SourceChip({ source }: { readonly source: SourceId }) {
  const { Icon, className } = sourceLooks[source]

  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', className)}>
      <Icon weight="bold" className="size-[17px]" />
    </span>
  )
}

type Tone = 'success' | 'warning' | 'danger' | 'muted'

interface Pill {
  readonly label: string
  readonly tone: Tone
  readonly busy?: boolean
}

const tones: Record<Tone, { readonly pill: string; readonly dot: string }> = {
  success: { pill: 'bg-success/10 text-success', dot: 'bg-success' },
  warning: { pill: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  danger: { pill: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  muted: { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
}

export const accountPill = (account: SourceAccount, signIn: boolean): Pill => {
  if (account.status === 'signing-in') {
    return { label: 'Signing in', tone: 'muted', busy: true }
  }

  if (account.status === 'checking') {
    return { label: 'Checking', tone: 'muted', busy: true }
  }

  if (account.status === 'ready') {
    return { label: 'Signed in', tone: 'success' }
  }

  if (account.status === 'expired') {
    return { label: 'Sign in again', tone: 'danger' }
  }

  if (account.status === 'unreachable') {
    return { label: 'Unreachable', tone: 'danger' }
  }

  if (account.status === 'signed-out') {
    return { label: signIn ? 'Sign in needed' : 'Not signed in', tone: 'warning' }
  }

  return account.checkedAt === undefined
    ? { label: 'No sign-in needed', tone: 'muted' }
    : { label: 'Reachable', tone: 'success' }
}

export function StatusPill({ pill }: { readonly pill: Pill }) {
  const tone = tones[pill.tone]

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        tone.pill,
      )}
    >
      {pill.busy === true ? (
        <Spinner className="size-3" />
      ) : (
        <span className={cn('size-1.5 rounded-full', tone.dot)} />
      )}
      {pill.label}
    </span>
  )
}

export const accountSummary = (account: SourceAccount) =>
  [
    account.checkedAt === undefined
      ? undefined
      : `Checked ${formatMoment(account.checkedAt).toLowerCase()}`,
    account.message ?? account.detail,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
