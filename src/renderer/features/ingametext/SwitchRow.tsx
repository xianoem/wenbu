import { cn } from 'cn'
import type { ReactNode } from 'react'
import { Switch } from '#ui/switch'

export function SwitchRow({
  title,
  description,
  checked,
  disabled = false,
  aside,
  className,
  onCheckedChange,
  children,
}: {
  readonly title: string
  readonly description: ReactNode
  readonly checked: boolean
  readonly disabled?: boolean
  readonly aside?: ReactNode
  readonly className?: string | undefined
  readonly onCheckedChange: (checked: boolean) => void
  readonly children?: ReactNode
}) {
  return (
    <div className={cn('border-t py-3', className)}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">{title}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        </div>
        {aside}
        <Switch
          aria-label={title}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {children}
    </div>
  )
}
