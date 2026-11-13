import { cn } from 'cn'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'

export interface Choice<V> {
  readonly value: V
  readonly label: string
}

export function ChoiceSelect<V extends string | number>({
  label,
  choices,
  value,
  onChange,
  width = 'w-72',
}: {
  readonly label: string
  readonly choices: ReadonlyArray<Choice<V>>
  readonly value: V
  readonly onChange: (value: V) => void
  readonly width?: string
}) {
  return (
    <Select
      items={Object.fromEntries(choices.map((choice) => [String(choice.value), choice.label]))}
      value={String(value)}
      onValueChange={(next) => {
        const found = choices.find((choice) => String(choice.value) === next)

        if (found !== undefined) {
          onChange(found.value)
        }
      }}
    >
      <SelectTrigger aria-label={label} className={cn('h-9 rounded-full', width)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={String(choice.value)}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
