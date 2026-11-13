import { Atom } from 'effect/reactivity'
import type { CoreStopped } from '#contract/CoreStopped'

export const coreStoppedAtom = Atom.make((get) => {
  let initial: CoreStopped | undefined
  let subscribed = false

  // The bridge replays an earlier report synchronously, before the atom has a value to replace.
  const unsubscribe = window.wenbu.onCoreStopped((stopped) => {
    if (subscribed) {
      get.setSelf(stopped)
    } else {
      initial = stopped
    }
  })

  subscribed = true
  get.addFinalizer(unsubscribe)

  return initial
})
