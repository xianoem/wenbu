import { useAtomSet } from '@effect/atom-react'
import {
  BracketsCurlyIcon,
  FileZipIcon,
  FolderOpenIcon,
  type Icon,
  InfoIcon,
  TableIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { useState } from 'react'
import type { ExportFormat, ExportResult } from '#contract/GameTranslation'
import type { Game } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import { Switch } from '#ui/switch'
import { exportTranslationAtom } from './translationLines'

const formats: ReadonlyArray<{
  readonly id: ExportFormat
  readonly Icon: Icon
  readonly title: string
  readonly detail: string
  readonly extension: string
  readonly fileName?: string
}> = [
  {
    id: 'data-files',
    Icon: FileZipIcon,
    title: 'Patched data files',
    detail:
      'A zip of only the files whose text is translated, placed as in the game’s own folder. Players unzip it over the game.',
    extension: 'zip',
  },
  {
    id: 'csv',
    Icon: TableIcon,
    title: 'Translation table · CSV',
    detail:
      'One row per translated line: file, location, original and translation. Opens in a spreadsheet.',
    extension: 'csv',
  },
  {
    id: 'json',
    Icon: BracketsCurlyIcon,
    title: 'Translation file · JSON',
    detail:
      'Every translated line with its file, location and original, for tools and other projects.',
    extension: 'json',
  },
  {
    id: 'mtool',
    Icon: BracketsCurlyIcon,
    title: 'MTool translation file',
    detail:
      'ManualTransFile.json: originals and their translations. Put it in the game’s folder and load it from MTool’s translation page.',
    extension: 'json',
    fileName: 'ManualTransFile.json',
  },
]

const fileNameOf = (text: string) =>
  text
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function ExportDialog({
  game,
  targetLanguage,
  unapplied,
  open,
  onOpenChange,
}: {
  readonly game: Game
  readonly targetLanguage: string
  readonly unapplied: number
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const exportTranslation = useAtomSet(exportTranslationAtom, { mode: 'promiseExit' })
  const [format, setFormat] = useState<ExportFormat>('data-files')
  const [readme, setReadme] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState<ExportResult | undefined>(undefined)
  const chosen = formats.find((option) => option.id === format) ?? formats[0]!

  const save = async () => {
    const target = await window.wenbu.chooseSavePath(
      chosen.fileName ??
        `${fileNameOf(game.title)} (${fileNameOf(targetLanguage)}).${chosen.extension}`,
      chosen.extension,
    )

    if (target === undefined) {
      return
    }

    setBusy(true)
    setError(undefined)

    const exit = await exportTranslation({ payload: { gameId: game.id, format, target, readme } })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setSaved(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[26px] p-6 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Export the translation</DialogTitle>
          <DialogDescription>
            For players who don’t use Wenbu. Only translated text goes in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {formats.map((option) => (
            <Button
              key={option.id}
              variant="ghost"
              aria-pressed={format === option.id}
              className={cn(
                'h-auto items-start justify-start gap-3 rounded-[18px] bg-muted px-3.5 py-3 text-left font-normal whitespace-normal hover:bg-muted',
                format === option.id && 'ring-[1.5px] ring-primary',
              )}
              onClick={() => {
                setFormat(option.id)
                setSaved(undefined)
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground',
                  format === option.id && 'border-5 border-primary',
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 font-medium">
                  <option.Icon />
                  {option.title}
                </span>
                <span className="text-xs text-muted-foreground">{option.detail}</span>
              </span>
            </Button>
          ))}
        </div>

        {format === 'data-files' ? (
          <label className="flex items-center gap-3 border-t pt-3 text-[13px]">
            <span className="flex-1">Add a readme with the game version and how to install</span>
            <Switch checked={readme} onCheckedChange={setReadme} />
          </label>
        ) : null}

        {format === 'data-files' && unapplied > 0 ? (
          <p className="flex gap-1.5 text-xs text-warning">
            <InfoIcon className="mt-0.5 shrink-0" />
            {unapplied.toLocaleString('en-US')} {unapplied === 1 ? 'edit is' : 'edits are'} not in
            the game yet, so the data files leave {unapplied === 1 ? 'it' : 'them'} out. Apply to
            game first to include {unapplied === 1 ? 'it' : 'them'}.
          </p>
        ) : null}

        {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}

        {saved === undefined ? null : (
          <p className="flex items-center gap-2 text-[13px] text-success">
            Saved {saved.lines.toLocaleString('en-US')} lines
            {format === 'data-files' ? ` in ${saved.files.toLocaleString('en-US')} files` : ''}.
            <Button
              variant="ghost"
              size="sm"
              className="h-6 rounded-full px-2 text-xs font-normal"
              onClick={() => window.wenbu.revealPath(saved.path)}
            >
              <FolderOpenIcon />
              Show in Explorer
            </Button>
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            {saved === undefined ? 'Cancel' : 'Done'}
          </Button>
          <Button className="rounded-full px-4" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
