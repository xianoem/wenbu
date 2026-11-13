import { useAtomValue } from '@effect/atom-react'
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react'
import { Effect, Exit, Schema, Stream } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useState } from 'react'
import { AskAnswer, type NovelAnswer } from '#contract/Novels'
import { useCoreCall } from '#lib/rpc'
import { Button } from '#ui/button'
import { Spinner } from '#ui/spinner'
import { AnswerText } from '../components/AskFirst'
import { novelInsightAtom } from '../novels'

export const RECAP_AFTER_DAYS = 3

const isAnswer = Schema.is(AskAnswer)

const awayLabel = (days: number) => (days === 1 ? '1 day ago' : `${days} days ago`)

export function Previously({
  novelId,
  chapter,
  daysAway,
  onOpen,
}: {
  readonly novelId: string
  readonly chapter: number
  readonly daysAway: number
  readonly onOpen: (chapter: number) => void
}) {
  const result = useAtomValue(novelInsightAtom(novelId))
  const call = useCoreCall()
  const [made, setMade] = useState<NovelAnswer | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const insight = AsyncResult.isSuccess(result) ? result.value : undefined
  const question = `Up to chapter ${chapter}`

  const cached = insight?.answers.find(
    (answer) => answer.kind === 'recap' && answer.question === question,
  )

  const recap = made ?? cached
  const wanted = insight !== undefined && insight.digested > 0 && recap === undefined && !failed

  useEffect(() => {
    if (!wanted) {
      return
    }

    let stopped = false

    void call((client) =>
      client('askNovel', { novelId, question: '', spoilers: false, kind: 'recap' }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (!stopped && isAnswer(event)) {
              setMade(event.answer)
            }
          }),
        ),
      ),
    ).then((exit) => {
      if (!stopped && Exit.isFailure(exit)) {
        setFailed(true)
      }
    })

    return () => {
      stopped = true
    }
  }, [call, novelId, wanted])

  if (hidden || insight === undefined || insight.digested === 0 || failed) {
    return null
  }

  return (
    <div className="mx-auto mt-6 max-w-[640px] rounded-[20px] bg-card px-5 py-4 font-sans shadow-card">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <ClockCounterClockwiseIcon className="text-muted-foreground" />
        Previously
        <span className="font-normal text-muted-foreground">
          · you last read {awayLabel(daysAway)}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          className="h-6 rounded-full px-2 text-xs font-normal text-muted-foreground"
          onClick={() => setHidden(true)}
        >
          Hide
        </Button>
      </div>
      {recap === undefined ? (
        <div className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3" />
          Writing a recap of the story so far
        </div>
      ) : (
        <div className="mt-2">
          <AnswerText text={recap.text} />
          {recap.chapters.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recap.chapters.map((number) => (
                <Button
                  key={number}
                  variant="secondary"
                  className="h-6 rounded-full px-2.5 text-xs"
                  onClick={() => onOpen(number)}
                >
                  Ch. {number}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
