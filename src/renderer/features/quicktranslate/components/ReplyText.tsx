import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '#ui/button'
import { replyBlocks } from '../replyBlocks'

function CopyBlock({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })

  return (
    <div className="my-1 flex flex-col gap-2 rounded-2xl bg-muted px-4 py-3">
      <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap text-foreground select-text">
        {text}
      </p>
      <Button
        variant="secondary"
        size="xs"
        className="w-fit rounded-full bg-background/40 px-2.5"
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

const bold = /\*\*(.+?)\*\*/g

function Inline({ text }: { readonly text: string }) {
  const parts: Array<React.ReactNode> = []
  let from = 0

  for (const match of text.matchAll(bold)) {
    parts.push(text.slice(from, match.index))

    parts.push(
      <strong key={match.index} className="font-semibold text-foreground">
        {match[1]}
      </strong>,
    )

    from = match.index + match[0].length
  }

  parts.push(text.slice(from))

  return parts
}

export function ReplyText({ text }: { readonly text: string }) {
  return (
    <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-foreground/90 select-text">
      {replyBlocks(text).map((block) => {
        if (block.kind === 'copy') {
          return <CopyBlock key={block.line} text={block.text} />
        }

        if (block.kind === 'list') {
          return (
            <ul key={block.line} className="flex list-disc flex-col gap-1 pl-5">
              {block.items.map((item) => (
                <li key={item.line}>
                  <Inline text={item.text} />
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={block.line} className="whitespace-pre-wrap">
            <Inline text={block.text} />
          </p>
        )
      })}
    </div>
  )
}
