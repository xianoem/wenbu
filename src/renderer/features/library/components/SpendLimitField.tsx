import { cn } from 'cn'
import { useState } from 'react'
import type { SpendLimit } from '#contract/GameTranslation'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '#ui/input-group'
import { limitValue, withLimit } from '../library'

export function SpendLimitField({
  limit,
  priced,
  label,
  className,
  onCommit,
}: {
  readonly limit: SpendLimit | undefined
  readonly priced: boolean
  readonly label: string
  readonly className?: string
  readonly onCommit: (limit: SpendLimit) => void
}) {
  const saved = limitValue(limit, priced)
  const [draft, setDraft] = useState(saved === undefined ? '' : String(saved))

  const commit = () => {
    if (draft.trim() === '') {
      onCommit(withLimit(limit, priced, undefined))

      return
    }

    const parsed = Number.parseFloat(draft)

    if (Number.isNaN(parsed) || parsed <= 0) {
      setDraft(saved === undefined ? '' : String(saved))

      return
    }

    onCommit(withLimit(limit, priced, priced ? Math.round(parsed * 100) / 100 : Math.round(parsed)))
  }

  return (
    <InputGroup className={cn('h-8 w-28 rounded-full bg-card', className)}>
      {priced ? (
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
      ) : null}
      <InputGroupInput
        inputMode="decimal"
        aria-label={label}
        placeholder="No limit"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
      {priced ? null : (
        <InputGroupAddon align="inline-end">
          <InputGroupText>tokens</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
