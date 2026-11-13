import { Duration } from 'effect'

export interface CrashBudget {
  readonly crashes: number
  readonly within: Duration.Duration
}

export const coreCrashBudget: CrashBudget = { crashes: 3, within: Duration.minutes(1) }

export const recordCrash = (budget: CrashBudget, previous: ReadonlyArray<number>, now: number) => {
  const since = now - Duration.toMillis(budget.within)
  const recent = [...previous.filter((at) => at > since), now]

  return { recent, exhausted: recent.length >= budget.crashes }
}
