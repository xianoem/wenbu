import { PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { Button } from '#ui/button'
import { DialogClose, DialogDescription, DialogTitle } from '#ui/dialog'

export const detailDialogClass = 'gap-5 rounded-[28px] bg-card p-6 shadow-card sm:max-w-[560px]'

export function DetailHeader({
  mark,
  title,
  subtitle,
  onEdit,
}: {
  readonly mark: ReactNode
  readonly title: string
  readonly subtitle: ReactNode
  readonly onEdit: (() => void) | undefined
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-muted text-lg font-semibold"
      >
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <DialogTitle className="truncate text-lg leading-tight font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-0.5 truncate text-[13px]">{subtitle}</DialogDescription>
      </div>
      {onEdit === undefined ? null : (
        <Button variant="outline" className="h-9 gap-1.5 rounded-full px-4" onClick={onEdit}>
          <PencilSimpleIcon />
          Edit
        </Button>
      )}
      <DialogClose
        render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="Close" />}
      >
        <XIcon />
      </DialogClose>
    </div>
  )
}

export function Tile({
  label,
  children,
  className,
}: {
  readonly label: string
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-2xl bg-muted/50 px-3.5 py-3', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-[15px] leading-snug font-semibold break-words">{children}</div>
    </div>
  )
}

export function EditFooter({
  onDelete,
  onCancel,
  saveLabel,
  onSave,
  busy,
}: {
  readonly onDelete: (() => void) | undefined
  readonly onCancel: () => void
  readonly saveLabel: string
  readonly onSave: () => void
  readonly busy: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {onDelete === undefined ? null : (
        <Button
          variant="ghost"
          className="rounded-full text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
      <span className="flex-1" />
      <Button variant="outline" className="rounded-full px-4" onClick={onCancel}>
        Cancel
      </Button>
      <Button className="rounded-full px-4" disabled={busy} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  )
}
