import { cn } from 'cn'
import { ToggleGroup, ToggleGroupItem } from '#ui/toggle-group'

export function Segmented<A extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly value: A
  readonly options: ReadonlyArray<readonly [A, string]>
  readonly disabled?: boolean
  readonly onChange: (value: A) => void
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      disabled={disabled}
      className="rounded-full bg-foreground/6 p-[3px]"
      onValueChange={(next) => {
        const chosen = options.find(([option]) => next.includes(option))

        if (chosen !== undefined) {
          onChange(chosen[0])
        }
      }}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem
          key={option}
          value={option}
          className={cn(
            'h-7 rounded-full px-3 text-[13px] font-normal text-muted-foreground hover:bg-transparent',
            'data-pressed:bg-background data-pressed:font-medium data-pressed:text-foreground data-pressed:shadow-card',
          )}
        >
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
