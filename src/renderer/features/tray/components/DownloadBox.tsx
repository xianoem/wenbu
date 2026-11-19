import { useAtomSet } from '@effect/atom-react'
import { ClipboardTextIcon, DownloadSimpleIcon, LinkIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { sourceOfLink } from '#contract/Downloads'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/input-group'
import { startDownloadAtom } from '../../downloads/downloads'

/** The panel remounts it on every opening, so it starts over each time. */
export function DownloadBox({ link }: { readonly link: string | undefined }) {
  const copied = link !== undefined && sourceOfLink(link) !== undefined ? link : undefined
  const [value, setValue] = useState(copied ?? '')
  const [error, setError] = useState<string | undefined>(undefined)
  const [added, setAdded] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const start = useAtomSet(startDownloadAtom, { mode: 'promiseExit' })

  useEffect(() => {
    if (copied !== undefined) {
      input.current?.focus()
      input.current?.select()
    }
  }, [copied])

  const submit = async (event: FormEvent) => {
    event.preventDefault()

    const url = value.trim()

    if (url === '' || busy) {
      return
    }

    setBusy(true)

    const exit = await start({ payload: { url } })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setValue('')
      setError(undefined)
      setAdded(true)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  const fromClipboard = copied !== undefined && value === copied
  const Icon = fromClipboard ? ClipboardTextIcon : LinkIcon

  return (
    <form className="flex flex-col gap-1.5" onSubmit={(event) => void submit(event)}>
      <InputGroup className="h-10 rounded-full bg-foreground/4.5 pr-1 dark:bg-foreground/4.5">
        <InputGroupAddon className="pl-3.5">
          <Icon className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          ref={input}
          value={value}
          aria-label="Gallery link"
          placeholder={added ? 'Added to Downloads. Paste another link' : 'Paste a gallery link'}
          spellCheck={false}
          className="px-1 text-[12.5px] selection:bg-info/30 md:text-[12.5px]"
          onChange={(event) => {
            setValue(event.target.value)
            setError(undefined)
          }}
        />
        <InputGroupAddon align="inline-end" className="pr-0">
          <Button
            type="submit"
            size="sm"
            disabled={value.trim() === '' || busy}
            className="h-8 rounded-full px-3"
          >
            <DownloadSimpleIcon />
            Download
          </Button>
        </InputGroupAddon>
      </InputGroup>
      {error === undefined ? null : <p className="px-3 text-xs text-destructive">{error}</p>}
    </form>
  )
}
