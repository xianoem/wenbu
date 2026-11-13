import type { ReactNode } from 'react'
import { InputGroup, InputGroupInput } from '#ui/input-group'

export function CommitInput({
  value,
  label,
  numeric = true,
  addon,
  onCommit,
}: {
  readonly value: string | number | boolean
  readonly label: string
  readonly numeric?: boolean
  readonly addon?: ReactNode
  readonly onCommit: (text: string) => void
}) {
  return (
    <InputGroup>
      <InputGroupInput
        key={String(value)}
        aria-label={label}
        inputMode={numeric ? 'numeric' : 'text'}
        defaultValue={String(value)}
        onChange={(event) => {
          if (numeric) {
            event.currentTarget.value = event.currentTarget.value.replace(/[^0-9-]/g, '')
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onCommit(event.currentTarget.value)
          }
        }}
      />
      {addon}
    </InputGroup>
  )
}

export const wholeNumber = (text: string) => Number.parseInt(text, 10) || 0
