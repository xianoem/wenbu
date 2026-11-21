import { RegistryContext } from '@effect/atom-react'
import { Cause, Effect, Exit, Fiber, Option, Schema, Stream } from 'effect'
import { AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  QuickDelta,
  type QuickEvent,
  QuickLanguage,
  type QuickMessage,
  QuickTranslateError,
} from '#contract/QuickTranslate'
import { Core } from '#lib/rpc'

export const quickTranslateKeys = ['quick-translate-settings']

export const quickTranslateSettingsAtom = Core.query('getQuickTranslateSettings', undefined, {
  reactivityKeys: quickTranslateKeys,
})

export const saveQuickTranslateSettingsAtom = Core.mutation('saveQuickTranslateSettings')

export const explainQuestion =
  'Explain this text: what it means, its tone, and any words or grammar worth knowing.'

const isLanguage = Schema.is(QuickLanguage)

const isDelta = Schema.is(QuickDelta)

const isQuickError = Schema.is(QuickTranslateError)

export interface QuickTurn {
  readonly id: number
  readonly role: QuickMessage['role']
  readonly text: string
  readonly label?: string
}

export interface QuickProblem {
  readonly message: string
  readonly needsModel: boolean
}

export interface QuickState {
  readonly id: number
  readonly text: string
  readonly language: string | undefined
  readonly translation: string
  readonly translating: boolean
  readonly turns: ReadonlyArray<QuickTurn>
  readonly answering: boolean
  readonly problem: QuickProblem | undefined
}

const emptyState: QuickState = {
  id: 0,
  text: '',
  language: undefined,
  translation: '',
  translating: false,
  turns: [],
  answering: false,
  problem: undefined,
}

const problemOf = (cause: Cause.Cause<unknown>): QuickProblem | undefined => {
  if (Cause.hasInterruptsOnly(cause)) {
    return undefined
  }

  const error = Option.getOrUndefined(Cause.findErrorOption(cause))

  if (isQuickError(error)) {
    return { message: error.message, needsModel: error.reason === 'no-preset' }
  }

  return { message: 'Something went wrong. Try again.', needsModel: false }
}

const withLastTurn = (turns: ReadonlyArray<QuickTurn>, more: string) => {
  const last = turns.at(-1)

  if (last === undefined || last.role !== 'assistant') {
    return [...turns, { id: turns.length, role: 'assistant' as const, text: more }]
  }

  return [...turns.slice(0, -1), { ...last, text: last.text + more }]
}

function useCoreStream() {
  const registry = useContext(RegistryContext)

  return useCallback(
    <E>(
      stream: (client: Core['Service']) => Stream.Stream<QuickEvent, E>,
      onEvent: (event: QuickEvent) => void,
    ) =>
      Effect.runFork(
        AtomRegistry.getResult(registry, Core.runtime).pipe(
          Effect.flatMap((context) =>
            Effect.gen(function* () {
              const client = yield* Core

              yield* Stream.runForEach(stream(client), (event) => Effect.sync(() => onEvent(event)))
            }).pipe(Effect.provide(context)),
          ),
        ),
      ),
    [registry],
  )
}

export function useQuickTranslation() {
  const run = useCoreStream()
  const [state, setState] = useState<QuickState>(emptyState)
  const running = useRef<Fiber.Fiber<void, unknown> | undefined>(undefined)
  const current = useRef(state)
  const latestRun = useRef(0)

  useEffect(() => {
    current.current = state
  })

  const stop = useCallback(() => {
    const fiber = running.current

    running.current = undefined

    if (fiber !== undefined) {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [])

  const update = useCallback((run: number, change: (state: QuickState) => QuickState) => {
    if (latestRun.current === run) {
      setState((now) => change(now))
    }
  }, [])

  const follow = useCallback(
    (fiber: Fiber.Fiber<void, unknown>, run: number, finish: (state: QuickState) => QuickState) => {
      running.current = fiber

      void Effect.runPromise(Fiber.await(fiber)).then((exit) =>
        update(run, (now) => {
          const finished = finish(now)

          return Exit.isFailure(exit) ? { ...finished, problem: problemOf(exit.cause) } : finished
        }),
      )
    },
    [update],
  )

  const translate = useCallback(
    (id: number, text: string) => {
      stop()
      setState({ ...emptyState, id, text, translating: true })

      latestRun.current += 1

      const thisRun = latestRun.current

      const fiber = run(
        (client) => client('quickTranslate', { text }),
        (event) =>
          update(thisRun, (now) => {
            if (isLanguage(event)) {
              return { ...now, language: event.name }
            }

            if (isDelta(event)) {
              return { ...now, translation: now.translation + event.text }
            }

            return now
          }),
      )

      follow(fiber, thisRun, (now) => ({ ...now, translating: false }))
    },
    [follow, run, stop, update],
  )

  const ask = useCallback(
    (question: string, label?: string) => {
      const asked = question.trim()
      const now = current.current

      if (asked === '' || now.translating || now.answering || now.translation === '') {
        return
      }

      const history = now.turns.map((turn) => ({ role: turn.role, text: turn.text }))

      const turn: QuickTurn = {
        id: now.turns.length,
        role: 'user',
        text: asked,
        ...(label === undefined ? {} : { label }),
      }

      stop()
      setState({ ...now, turns: [...now.turns, turn], answering: true, problem: undefined })

      latestRun.current += 1

      const thisRun = latestRun.current

      const fiber = run(
        (client) =>
          client('quickAsk', {
            text: now.text,
            translation: now.translation,
            history,
            question: asked,
          }),
        (event) =>
          update(thisRun, (latest) =>
            isDelta(event) ? { ...latest, turns: withLastTurn(latest.turns, event.text) } : latest,
          ),
      )

      follow(fiber, thisRun, (latest) => ({ ...latest, answering: false }))
    },
    [follow, run, stop, update],
  )

  const retry = useCallback(() => {
    const now = current.current

    translate(now.id, now.text)
  }, [translate])

  useEffect(() => stop, [stop])

  return { state, translate, ask, retry, stop }
}
