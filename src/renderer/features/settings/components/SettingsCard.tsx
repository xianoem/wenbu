import { CaretRightIcon, type Icon } from '@phosphor-icons/react'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { Input } from '#ui/input'
import { Switch } from '#ui/switch'

export function SettingsCard({
  title,
  description,
  className,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <section className={cn('flex flex-col gap-4.5 rounded-3xl bg-card p-6 shadow-card', className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function Note({
  Icon,
  title,
  children,
}: {
  readonly Icon: Icon
  readonly title?: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex gap-2.5 rounded-[14px] bg-muted/40 px-3.5 py-3 text-[12.5px] text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-0.5">
        {title === undefined ? null : <span className="font-medium text-foreground">{title}</span>}
        {children}
      </div>
    </div>
  )
}

export function SettingRow({
  label,
  description,
  children,
}: {
  readonly label: string
  readonly description?: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {description === undefined ? null : (
          <span className="text-[12.5px] text-muted-foreground">{description}</span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SwitchRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-muted/35">
      <span className="flex-1">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

export function NumberField({
  label,
  value,
  suffix,
  placeholder,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly value: number | undefined
  readonly suffix: string
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly onChange: (value: number | undefined) => void
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Input
        type="number"
        min={1}
        aria-label={label}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        className="h-[34px] w-28 rounded-full"
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10)

          onChange(Number.isNaN(parsed) ? undefined : parsed)
        }}
      />
      <span className="w-16 text-[12.5px] text-muted-foreground">{suffix}</span>
    </span>
  )
}

export function Section({
  title,
  description,
  summary,
  open,
  onOpenChange,
  plain,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly summary?: string
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly plain?: boolean
  readonly children: ReactNode
}) {
  return (
    <Collapsible
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      className={cn('overflow-hidden rounded-[18px] border', plain ? '' : 'bg-card/50')}
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30">
        <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{title}</span>
          <span className="text-[12.5px] text-muted-foreground">{description}</span>
        </span>
        {summary === undefined ? null : (
          <span className="shrink-0 text-xs text-muted-foreground">{summary}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 pt-3.5 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}
