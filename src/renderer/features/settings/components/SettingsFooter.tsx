import type { ReactNode } from 'react'
import { Button } from '#ui/button'

export function SettingsFooter({
  note,
  error,
  dirty,
  busy,
  onDiscard,
  onSave,
}: {
  readonly note?: ReactNode
  readonly error: string | undefined
  readonly dirty: boolean
  readonly busy: boolean
  readonly onDiscard: () => void
  readonly onSave: () => void
}) {
  return (
    <div className="sticky -bottom-12 -mb-12 mt-auto flex items-center gap-3 border-t bg-background/85 py-4 backdrop-blur">
      <span className="flex-1 text-[13px] text-muted-foreground">{note}</span>
      {error === undefined ? null : <span className="text-[13px] text-destructive">{error}</span>}
      {dirty ? (
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">Unsaved changes</span>
      ) : null}
      <Button
        variant="ghost"
        className="rounded-full px-4 text-muted-foreground"
        disabled={!dirty}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button className="rounded-full px-4" disabled={!dirty || busy} onClick={onSave}>
        Save settings
      </Button>
    </div>
  )
}
