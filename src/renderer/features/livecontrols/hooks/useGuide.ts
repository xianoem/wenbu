import { Effect, Exit, Stream } from 'effect'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GuideAnswer, GuideHere, MapSketch } from '#contract/GameGuide'
import { formErrorOf } from '#lib/forms'
import { useCoreCall } from '#lib/rpc'

const HERE_EVERY_MS = 3000

const messageOf = <E>(exit: Exit.Exit<unknown, E>) => formErrorOf(exit)?.message

export function useGuideHere(active: boolean) {
  const call = useCoreCall()
  const [here, setHere] = useState<GuideHere>()
  const [problem, setProblem] = useState<string>()

  useEffect(() => {
    if (!active) {
      return
    }

    let stopped = false

    const load = async () => {
      const exit = await call((client) => client('guideHere', undefined))

      if (stopped) {
        return
      }

      if (Exit.isSuccess(exit)) {
        setHere(exit.value)
        setProblem(undefined)
      } else {
        setProblem(messageOf(exit))
      }
    }

    void load()

    const timer = window.setInterval(() => void load(), HERE_EVERY_MS)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [active, call])

  return { here, problem }
}

export interface PendingQuestion {
  readonly question: string
  readonly steps: ReadonlyArray<string>
}

export function useGuideAsk() {
  const call = useCoreCall()
  const [answers, setAnswers] = useState<ReadonlyArray<GuideAnswer>>([])
  const [pending, setPending] = useState<PendingQuestion>()
  const [problem, setProblem] = useState<string>()
  const busy = useRef(false)

  useEffect(() => {
    void call((client) => client('guideConversation', undefined)).then((exit) => {
      if (Exit.isSuccess(exit)) {
        setAnswers(exit.value)
      }
    })
  }, [call])

  const ask = useCallback(
    async (question: string) => {
      const asked = question.trim()

      if (asked === '' || busy.current) {
        return
      }

      busy.current = true
      setProblem(undefined)
      setPending({ question: asked, steps: [] })

      const exit = await call((client) =>
        client('askGuide', { question: asked }).pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event.type === 'step') {
                setPending((current) =>
                  current === undefined
                    ? current
                    : { ...current, steps: [...current.steps, event.label] },
                )
              } else {
                setAnswers((current) => [...current, event.answer])
              }
            }),
          ),
        ),
      )

      busy.current = false
      setPending(undefined)
      setProblem(messageOf(exit))
    },
    [call],
  )

  const clear = useCallback(async () => {
    await call((client) => client('clearGuideConversation', undefined))
    setAnswers([])
  }, [call])

  return { answers, pending, problem, ask, clear }
}

export function useMapSketch(
  mapId: number | undefined,
  target: { readonly x: number; readonly y: number } | undefined,
) {
  const call = useCoreCall()
  const [found, setFound] = useState<{ readonly key: string; readonly sketch: MapSketch }>()
  const x = target?.x
  const y = target?.y
  const key = `${mapId}:${x}:${y}`

  useEffect(() => {
    if (mapId === undefined) {
      return
    }

    let stopped = false
    const spot = x === undefined || y === undefined ? {} : { target: { x, y } }

    void call((client) => client('mapSketch', { mapId, ...spot })).then((exit) => {
      if (!stopped && Exit.isSuccess(exit)) {
        setFound({ key: `${mapId}:${x}:${y}`, sketch: exit.value })
      }
    })

    return () => {
      stopped = true
    }
  }, [call, mapId, x, y])

  return found?.key === key ? found.sketch : undefined
}
