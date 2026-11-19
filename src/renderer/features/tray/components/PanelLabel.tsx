import type { ReactNode } from 'react'

export function PanelLabel({
  aside,
  children,
}: {
  readonly aside?: string | undefined
  readonly children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
      <span className="flex-1">{children}</span>
      {aside === undefined ? null : <span className="font-normal">{aside}</span>}
    </div>
  )
}
