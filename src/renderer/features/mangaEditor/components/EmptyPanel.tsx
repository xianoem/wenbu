import { CircleNotchIcon, ScanIcon } from '@phosphor-icons/react'
import type { EditorPage } from '#contract/MangaEditor'
import { Button } from '#ui/button'
import { Kbd } from './Kbd'

export function EmptyPanel({
  page,
  onScan,
}: {
  readonly page: EditorPage
  readonly onScan: () => void
}) {
  const scanning = page.running === 'scan' || page.running === 'translate'

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-7 text-center">
      <div className="flex size-13 items-center justify-center rounded-[18px] bg-muted/60 text-muted-foreground ring-1 ring-foreground/8">
        <ScanIcon className="size-6" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[15px] font-semibold">
          {scanning ? 'Scanning the page…' : 'Nothing on this page yet'}
        </span>
        <span className="max-w-65 text-[12.5px] leading-relaxed text-muted-foreground">
          {page.running === 'translate'
            ? 'Drafting a translation for every line.'
            : 'Scanning finds every line, reads the Japanese and drafts a translation. You review them next.'}
        </span>
      </div>
      <Button size="lg" className="mt-1 rounded-full px-5" disabled={scanning} onClick={onScan}>
        {scanning ? <CircleNotchIcon className="animate-spin" /> : <ScanIcon />}
        Scan page
        {scanning ? null : <Kbd className="border-transparent bg-black/10 text-current">S</Kbd>}
      </Button>
      {page.error === undefined || scanning ? null : (
        <span className="max-w-70 text-[12px] text-destructive">{page.error}</span>
      )}
    </div>
  )
}
