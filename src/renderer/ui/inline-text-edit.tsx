import { PencilSimpleIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { Button } from '#ui/button'
import { Input } from '#ui/input'

export function InlineTextEdit({
  value,
  label,
  placeholder,
  hint,
  title,
  align = 'start',
  disabled,
  className,
  onSave,
  children,
}: {
  readonly value: string
  readonly label: string
  readonly placeholder?: string
  readonly hint?: string
  readonly title?: string
  readonly align?: 'start' | 'end'
  readonly disabled?: boolean
  readonly className?: string
  readonly onSave: (value: string) => Promise<string | undefined>
  readonly children: ReactNode
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const close = () => {
    setDraft(undefined)
    setError(undefined)
  }

  const submit = async (next: string) => {
    const problem = await onSave(next)

    if (problem === undefined) {
      close()

      return
    }

    setError(problem)
  }

  if (draft === undefined) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 gap-1.5 rounded-full px-2.5 font-normal text-muted-foreground',
          className,
        )}
        title={title}
        disabled={disabled}
        onClick={() => setDraft(value)}
      >
        {children}
        <PencilSimpleIcon />
      </Button>
    )
  }

  return (
    <form
      className={cn('flex flex-col gap-1', align === 'end' ? 'items-end' : 'items-start')}
      onSubmit={(event) => {
        event.preventDefault()
        void submit(draft)
      }}
    >
      <span className="flex items-center gap-1.5">
        <Input
          autoFocus
          aria-label={label}
          aria-invalid={error !== undefined}
          value={draft}
          placeholder={placeholder}
          className="h-7 w-44 rounded-full"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
            }
          }}
        />
        <Button type="submit" size="sm" className="h-7 rounded-full">
          Save
        </Button>
      </span>
      {error === undefined && hint === undefined ? null : (
        <span
          className={cn(
            'text-xs',
            error === undefined ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {error ?? hint}
        </span>
      )}
    </form>
  )
}
