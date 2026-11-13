import { UpdateStatus } from '#contract/Updates'

export type UpdaterEvent =
  | { readonly type: 'checking' }
  | { readonly type: 'available'; readonly version: string }
  | { readonly type: 'not-available' }
  | { readonly type: 'downloaded'; readonly version: string }
  | { readonly type: 'failed' }

/** A downloaded update stays ready: a later check that fails must not take the restart away. */
export const afterUpdaterEvent = (current: UpdateStatus, event: UpdaterEvent): UpdateStatus => {
  if (event.type === 'downloaded') {
    return UpdateStatus.make({ state: 'ready', version: event.version })
  }

  if (current.state === 'ready') {
    return current
  }

  if (event.type === 'checking') {
    return UpdateStatus.make({ state: 'checking' })
  }

  if (event.type === 'available') {
    return UpdateStatus.make({ state: 'downloading', version: event.version })
  }

  return UpdateStatus.make({ state: 'idle' })
}
