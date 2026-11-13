import { describe, expect, it } from '@effect/vitest'
import { UpdateStatus } from '#contract/Updates'
import { afterUpdaterEvent } from './updateProgress'

const idle = UpdateStatus.make({ state: 'idle' })

describe('afterUpdaterEvent', () => {
  it('follows a download from the check to the restart', () => {
    const checking = afterUpdaterEvent(idle, { type: 'checking' })
    const downloading = afterUpdaterEvent(checking, { type: 'available', version: '0.3.0' })
    const ready = afterUpdaterEvent(downloading, { type: 'downloaded', version: '0.3.0' })

    expect(checking).toEqual(UpdateStatus.make({ state: 'checking' }))
    expect(downloading).toEqual(UpdateStatus.make({ state: 'downloading', version: '0.3.0' }))
    expect(ready).toEqual(UpdateStatus.make({ state: 'ready', version: '0.3.0' }))
  })

  it('goes back to idle when there is nothing newer or the check failed', () => {
    const checking = UpdateStatus.make({ state: 'checking' })

    expect(afterUpdaterEvent(checking, { type: 'not-available' })).toEqual(idle)
    expect(afterUpdaterEvent(checking, { type: 'failed' })).toEqual(idle)
  })

  it('keeps a downloaded update ready through later checks and failures', () => {
    const ready = UpdateStatus.make({ state: 'ready', version: '0.3.0' })

    expect(afterUpdaterEvent(ready, { type: 'checking' })).toEqual(ready)
    expect(afterUpdaterEvent(ready, { type: 'not-available' })).toEqual(ready)
    expect(afterUpdaterEvent(ready, { type: 'failed' })).toEqual(ready)
    expect(afterUpdaterEvent(ready, { type: 'available', version: '0.3.1' })).toEqual(ready)

    expect(afterUpdaterEvent(ready, { type: 'downloaded', version: '0.3.1' })).toEqual(
      UpdateStatus.make({ state: 'ready', version: '0.3.1' }),
    )
  })
})
