import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { ChatCircleIcon, CheckIcon, CircleIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Effect, Exit, Schema, Stream } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  AskAnswer,
  type DigestProgress,
  type FlagFinding,
  type NovelAnswer,
  type NovelInsight,
} from '#contract/Novels'
import { formatUsd } from '#lib/format'
import { formErrorOf } from '#lib/forms'
import { novelReaderAtom } from '#lib/navigation'
import { useCoreCall } from '#lib/rpc'
import { Button } from '#ui/button'
import { Input } from '#ui/input'
import { Spinner } from '#ui/spinner'
import { digestAtom, novelInsightAtom } from '../novels'

const isAnswer = Schema.is(AskAnswer)

const digestLines: Record<DigestProgress['stage'], (progress: DigestProgress) => string> = {
  reading: (progress) => `Reading chapters ${progress.done} of ${progress.total}`,
  digesting: (progress) => `Summarising chapters ${progress.done} of ${progress.total}`,
  done: (progress) => `Read ${progress.total} chapters`,
  failed: (progress) => progress.message ?? 'Reading the chapters failed.',
}

const knowsLabel = (insight: NovelInsight) => {
  if (insight.digested === 0) {
    return 'Has not read the chapters yet'
  }

  if (insight.knownUpTo > 0 && insight.knownUpTo >= insight.digested) {
    return `Knows chapters 1–${insight.knownUpTo}`
  }

  return `Knows ${insight.digested} of ${insight.chapters} chapters`
}

const spoilerLabel = (insight: NovelInsight, spoilers: boolean) => {
  if (spoilers) {
    return 'spoilers allowed'
  }

  return insight.readingChapter === null
    ? 'no spoilers'
    : `no spoilers past ${insight.readingChapter}`
}

export function AnswerText({ text }: { readonly text: string }) {
  const blocks = text.split(/\n{2,}/)

  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-foreground/90">
      {blocks.map((block, index) => {
        const lines = block.split('\n')

        if (lines.every((line) => line.startsWith('- '))) {
          return (
            // oxlint-disable-next-line react/no-array-index-key -- the answer's blocks never reorder.
            <ul key={index} className="list-disc pl-5">
              {lines.map((line) => (
                <li key={line}>{line.slice(2)}</li>
              ))}
            </ul>
          )
        }

        return (
          // oxlint-disable-next-line react/no-array-index-key -- the answer's blocks never reorder.
          <p key={index} className="whitespace-pre-line">
            {block}
          </p>
        )
      })}
    </div>
  )
}

function FlagChip({ flag, checked }: { readonly flag: FlagFinding; readonly checked: boolean }) {
  if (flag.chapters.length > 0) {
    return (
      <span
        title={flag.note ?? undefined}
        className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning"
      >
        <CircleIcon weight="fill" className="size-2.5" />
        {flag.label} · {flag.chapters.slice(0, 3).join(', ')}
        {flag.chapters.length > 3 ? '…' : ''}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
      {checked ? <CheckIcon className="size-3" /> : null}
      {flag.label}
    </span>
  )
}

function DigestRun({
  novelId,
  run,
  onFinished,
}: {
  readonly novelId: string
  readonly run: { readonly upTo: number; readonly n: number }
  readonly onFinished: () => void
}) {
  const result = useAtomValue(digestAtom(`${novelId}|${run.upTo}|${run.n}`))

  if (!AsyncResult.isSuccess(result)) {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Starting
      </span>
    )
  }

  const progress = result.value
  const running = progress.stage !== 'done' && progress.stage !== 'failed'

  return (
    <span
      className={cn(
        'flex items-center gap-2 text-xs',
        progress.stage === 'failed' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {running ? <Spinner className="size-3" /> : null}
      {digestLines[progress.stage](progress)}
      {progress.costUsd > 0 ? ` · ${formatUsd(progress.costUsd)}` : ''}
      {running ? null : (
        <Button variant="ghost" className="h-6 rounded-full px-2 text-xs" onClick={onFinished}>
          OK
        </Button>
      )}
    </span>
  )
}

function Checked({
  novelId,
  insight,
}: {
  readonly novelId: string
  readonly insight: NovelInsight
}) {
  const [run, setRun] = useState<{ readonly upTo: number; readonly n: number } | undefined>(
    undefined,
  )

  const left = insight.readable - insight.digested
  const checked = insight.digested > 0

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
      <span className="mr-1 text-xs text-muted-foreground">
        {checked ? `Checked ${insight.digested} of ${insight.chapters}` : 'Not checked yet'}
      </span>
      {insight.flags.map((flag) => (
        <FlagChip key={flag.id} flag={flag} checked={checked} />
      ))}
      <span className="ml-auto flex items-center">
        {run === undefined && left > 0 ? (
          <Button
            variant="ghost"
            className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
            onClick={() =>
              setRun((before) => ({ upTo: Number.MAX_SAFE_INTEGER, n: (before?.n ?? 0) + 1 }))
            }
          >
            {checked ? `Read ${left} more chapters` : `Read ${left} chapters to check`}
          </Button>
        ) : null}
        {run === undefined ? null : (
          <DigestRun novelId={novelId} run={run} onFinished={() => setRun(undefined)} />
        )}
      </span>
    </div>
  )
}

function LastAnswer({
  novelId,
  answer,
}: {
  readonly novelId: string
  readonly answer: NovelAnswer
}) {
  const openReader = useAtomSet(novelReaderAtom)

  return (
    <div className="mx-3 mt-3 flex flex-col gap-2 border-t pt-3 pb-2">
      <div className="text-[13px] font-medium">{answer.question}</div>
      <AnswerText text={answer.text} />
      <div className="flex flex-wrap items-center gap-1.5">
        {answer.chapters.map((chapter) => (
          <Button
            key={chapter}
            variant="secondary"
            className="h-6 rounded-full px-2.5 text-xs"
            onClick={() => openReader({ novelId, chapter })}
          >
            Ch. {chapter}
          </Button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {answer.coverage}
          {answer.costUsd === null ? '' : ` · ${formatUsd(answer.costUsd)}`}
        </span>
      </div>
    </div>
  )
}

export function AskFirst({ novelId }: { readonly novelId: string }) {
  const result = useAtomValue(novelInsightAtom(novelId))
  const refresh = useAtomRefresh(novelInsightAtom(novelId))
  const call = useCoreCall()
  const [question, setQuestion] = useState('')
  const [spoilers, setSpoilers] = useState(false)
  const [pending, setPending] = useState<{ readonly question: string; readonly step: string }>()
  const [problem, setProblem] = useState<string>()

  if (!AsyncResult.isSuccess(result)) {
    return null
  }

  const insight = result.value
  const last = insight.answers.find((answer) => answer.kind === 'question')

  const ask = async () => {
    const asked = question.trim()

    if (asked === '' || pending !== undefined) {
      return
    }

    setProblem(undefined)
    setPending({ question: asked, step: 'Thinking' })

    const exit = await call((client) =>
      client('askNovel', { novelId, question: asked, spoilers, kind: 'question' }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (!isAnswer(event)) {
              setPending({ question: asked, step: event.label })
            }
          }),
        ),
      ),
    )

    setPending(undefined)

    if (Exit.isSuccess(exit)) {
      setQuestion('')
      refresh()
    } else {
      setProblem(formErrorOf(exit)?.message ?? 'Novel Chat could not answer.')
    }
  }

  return (
    <section className="mt-5 rounded-[22px] bg-card p-2 shadow-card">
      <div className="flex h-11 items-center gap-3 rounded-[16px] bg-secondary/50 px-4">
        <ChatCircleIcon className="shrink-0 text-muted-foreground" />
        <Input
          aria-label="Ask before you read"
          placeholder="Ask before you read, like “is there NTR?”"
          value={question}
          disabled={pending !== undefined}
          className="h-9 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void ask()
            }
          }}
        />
        {pending === undefined ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {knowsLabel(insight)} ·
            <Button
              variant="ghost"
              aria-pressed={spoilers}
              className="h-6 rounded-full px-1.5 text-xs font-normal text-muted-foreground"
              onClick={() => setSpoilers((before) => !before)}
            >
              {spoilerLabel(insight, spoilers)}
            </Button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            {pending.step}
          </span>
        )}
        {question.trim() === '' || pending !== undefined ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ask"
            className="rounded-full"
            onClick={() => void ask()}
          >
            <PaperPlaneRightIcon />
          </Button>
        )}
      </div>
      <Checked novelId={novelId} insight={insight} />
      {problem === undefined ? null : (
        <p className="mx-3 mt-3 text-xs text-destructive">{problem}</p>
      )}
      {pending === undefined && last !== undefined ? (
        <LastAnswer novelId={novelId} answer={last} />
      ) : null}
      {pending === undefined ? null : (
        <div className="mx-3 mt-3 border-t pt-3 pb-2 text-[13px] font-medium">
          {pending.question}
        </div>
      )}
    </section>
  )
}
