import type { Effect } from 'effect'
import { LiveControlsError } from '#contract/LiveControls'

export type RuntimeArgument = string | number | boolean | null | ReadonlyArray<RuntimeArgument>

export interface GameRuntime {
  readonly call: (
    command: string,
    args?: ReadonlyArray<RuntimeArgument>,
  ) => Effect.Effect<unknown, LiveControlsError>
  readonly lost: Effect.Effect<void>
}

const reasons = ['not-ready', 'invalid'] as const

export const gameError = (message: string) => {
  const reason = reasons.find((candidate) => message.startsWith(`${candidate}: `))

  return reason === undefined
    ? new LiveControlsError({ reason: 'failed', message: `The game reported: ${message}` })
    : new LiveControlsError({ reason, message: message.slice(reason.length + 2) })
}

export const connectionLost = () =>
  new LiveControlsError({
    reason: 'not-connected',
    message: 'The connection to the game was lost.',
  })
