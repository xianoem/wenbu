import { useAtomSet } from '@effect/atom-react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { useEffect, useState } from 'react'
import type { NovelLanguage, PastedChapter } from '#contract/Novels'
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
import { Input } from '#ui/input'
import { Textarea } from '#ui/textarea'
import { createNovelAtom, novelsKeys, pasteChaptersAtom, previewPasteAtom } from '../novels'

const languageOf = (text: string): NovelLanguage => {
  if (/[぀-ヿ]/.test(text)) {
    return 'ja'
  }

  return /[가-힯]/.test(text) ? 'ko' : 'zh'
}

const previewLine = (chapters: ReadonlyArray<PastedChapter>) => {
  if (chapters.length === 0) {
    return 'Paste one chapter or several. Headings like 第一章, 第1話 or 제1화 start a new chapter.'
  }

  const paragraphs = chapters.reduce((total, chapter) => total + chapter.paragraphs, 0)

  return `${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'} · ${paragraphs} paragraphs`
}

export function PasteDialog({
  open,
  onOpenChange,
  novelId,
  startAt = null,
  onDone,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly novelId?: string
  readonly startAt?: number | null
  readonly onDone: (novelId: string, chapter: number) => void
}) {
  const preview = useAtomSet(previewPasteAtom, { mode: 'promiseExit' })
  const paste = useAtomSet(pasteChaptersAtom, { mode: 'promiseExit' })
  const create = useAtomSet(createNovelAtom, { mode: 'promiseExit' })
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [chapters, setChapters] = useState<ReadonlyArray<PastedChapter>>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true

    void preview({ payload: { text } }).then((exit) => {
      if (current && Exit.isSuccess(exit)) {
        setChapters(exit.value)
      }
    })

    return () => {
      current = false
    }
  }, [preview, text])

  const scrambled = chapters.some((chapter) => chapter.scrambled)
  const needsTitle = novelId === undefined && title.trim() === ''

  const submit = async () => {
    setBusy(true)
    setError(undefined)

    const target =
      novelId === undefined
        ? await create({ payload: { title: title.trim(), language: languageOf(text) } })
        : Exit.succeed(novelId)

    if (Exit.isFailure(target)) {
      setBusy(false)
      setError(formErrorOf(target)?.message)

      return
    }

    const exit = await paste({
      payload: { novelId: target.value, text, startAt },
      reactivityKeys: novelsKeys,
    })

    setBusy(false)

    if (Exit.isSuccess(exit)) {
      setText('')
      setTitle('')
      onOpenChange(false)
      onDone(target.value, exit.value[0] ?? 1)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-[22px] p-5 sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{novelId === undefined ? 'Paste a novel' : 'Paste chapters'}</DialogTitle>
          <DialogDescription>
            {startAt === null
              ? 'Wenbu adds the text as chapters and translates them like any other.'
              : `The text becomes chapter ${startAt}.`}
          </DialogDescription>
        </DialogHeader>
        {novelId === undefined ? (
          <Input
            aria-label="Novel title"
            placeholder="Title"
            value={title}
            className="h-9 rounded-full px-3.5"
            onChange={(event) => setTitle(event.target.value)}
          />
        ) : null}
        <Textarea
          aria-label="Chapter text"
          placeholder="第一章 …"
          value={text}
          className="h-64 resize-none rounded-[16px] font-serif text-[15px] leading-relaxed"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <span>{previewLine(chapters)}</span>
          {chapters.length > 1 ? (
            <span className="truncate">
              {chapters
                .slice(0, 6)
                .map((chapter) => chapter.title ?? 'Untitled')
                .join(' · ')}
              {chapters.length > 6 ? ' · …' : ''}
            </span>
          ) : null}
          {scrambled ? (
            <span className="flex items-center gap-1.5 text-warning">
              <WarningCircleIcon weight="fill" />
              This text looks scrambled, as protected pages copy. Wenbu cannot translate it.
            </span>
          ) : null}
          {error === undefined ? null : <span className="text-destructive">{error}</span>}
        </div>
        <DialogFooter className="-mx-5 -mb-5 rounded-b-[22px] px-5">
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={busy || chapters.length === 0 || scrambled || needsTitle}
            onClick={() => void submit()}
          >
            {chapters.length > 1 ? `Add ${chapters.length} chapters` : 'Add chapter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
