import { GlobeHemisphereEastIcon } from '@phosphor-icons/react'
import { cn } from 'cn'

export function JapanVpnNote({
  children,
  className,
}: {
  readonly children: string
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-2xl bg-info/10 px-3.5 py-2.5 text-sm text-foreground/90',
        className,
      )}
    >
      <GlobeHemisphereEastIcon className="mt-0.5 size-4 shrink-0 text-info" />
      <p>{children}</p>
    </div>
  )
}
