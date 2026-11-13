import {
  ArrowBendDownRightIcon,
  ArrowUpIcon,
  CircleNotchIcon,
  FileIcon,
  SparkleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import type { ChatReply } from '#contract/MangaEditor'
import { Button } from '#ui/button'
import { Textarea } from '#ui/textarea'
import { LineNumber, Parts } from './Lines'

export interface ChatEntry {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly suggestion?: ChatReply['suggestion']
}

export function ChatDrawer({
  pageNumber,
  attached,
  entries,
  waiting,
  problem,
  onDetach,
  onSend,
  onUse,
  onClose,
}: {
  readonly pageNumber: number
  readonly attached: string | undefined
  readonly entries: ReadonlyArray<ChatEntry>
  readonly waiting: boolean
  readonly problem: string | undefined
  readonly onDetach: () => void
  readonly onSend: (text: string) => void
  readonly onUse: (suggestion: NonNullable<ChatReply['suggestion']>) => void
  readonly onClose: () => void
}) {
  const [draft, setDraft] = useState('')

  const send = () => {
    if (draft.trim() === '' || waiting) {
      return
    }

    onSend(draft.trim())
    setDraft('')
  }

  return (
    <div className="absolute inset-y-3 left-3 z-20 flex w-100 flex-col rounded-[20px] bg-popover shadow-[16px_0_50px_rgb(0_0_0/0.45)] ring-1 ring-foreground/10">
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <SparkleIcon className="size-4 text-info" />
        <div className="flex flex-1 flex-col">
          <span className="text-[13.5px] font-semibold">Chat</span>
          <span className="text-[11.5px] text-muted-foreground">
            Sees this page, its script and your series notes
          </span>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close the chat" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-1.5">
          <span className="flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[12px]">
            <FileIcon />
            Page {pageNumber}
          </span>
          {attached === undefined ? null : (
            <span className="flex h-7 items-center gap-1.5 rounded-full bg-muted py-0 pr-1 pl-1.5 text-[12px]">
              <LineNumber number={attached} className="h-5 bg-background" />
              Line {attached}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Detach the line"
                onClick={onDetach}
              >
                <XIcon />
              </Button>
            </span>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Ask who is speaking, what a phrase means, or for a better way to say a line.
          </p>
        ) : null}
        {entries.map((entry) =>
          entry.role === 'user' ? (
            <div
              key={entry.id}
              className="max-w-[85%] self-end rounded-2xl rounded-tr-md bg-muted px-3 py-2 text-[13px]"
            >
              {entry.text}
            </div>
          ) : (
            <div key={entry.id} className="flex flex-col gap-2">
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{entry.text}</p>
              {entry.suggestion === undefined ? null : (
                <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3 ring-1 ring-foreground/5">
                  <Parts text={entry.suggestion.translation} className="text-[13px]" />
                  <Button
                    size="sm"
                    className="self-start rounded-full"
                    onClick={() =>
                      entry.suggestion === undefined ? undefined : onUse(entry.suggestion)
                    }
                  >
                    <ArrowBendDownRightIcon />
                    Use for line {entry.suggestion.number}
                  </Button>
                </div>
              )}
            </div>
          ),
        )}
        {waiting ? (
          <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <CircleNotchIcon className="animate-spin text-info" />
            Thinking…
          </span>
        ) : null}
        {problem === undefined ? null : (
          <span className="text-[12.5px] text-destructive">{problem}</span>
        )}
        <div
          key={`${entries.length}-${waiting}`}
          ref={(node) => node?.scrollIntoView({ block: 'end' })}
        />
      </div>
      <div className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={draft}
          placeholder="Ask about the page, a line or a word…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          className="max-h-32 min-h-10 resize-none rounded-2xl text-[13px] md:text-[13px]"
        />
        <Button
          size="icon"
          className="shrink-0 rounded-full"
          aria-label="Send"
          disabled={waiting || draft.trim() === ''}
          onClick={send}
        >
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
  )
}
