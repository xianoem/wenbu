import { assert, describe, it } from '@effect/vitest'
import { UpdateStatus, WhatsNew } from '#contract/Updates'
import { whatsNewShown } from './whatsNewShown'

const read = WhatsNew.make({ version: '0.2.0', releases: [], newAreas: [] })

const unread = WhatsNew.make({ ...read, updatedFrom: '0.1.0' })

describe('whatsNewShown', () => {
  it('stays hidden when nothing has changed', () => {
    assert.isFalse(whatsNewShown(read, undefined))
    assert.isFalse(whatsNewShown(read, UpdateStatus.make({ state: 'idle' })))
    assert.isFalse(whatsNewShown(read, UpdateStatus.make({ state: 'checking' })))
  })

  it('shows after an update until the notes are read', () => {
    assert.isTrue(whatsNewShown(unread, UpdateStatus.make({ state: 'idle' })))
  })

  it('shows while a newer release is downloading or ready', () => {
    assert.isTrue(
      whatsNewShown(read, UpdateStatus.make({ state: 'downloading', version: '0.3.0' })),
    )

    assert.isTrue(whatsNewShown(read, UpdateStatus.make({ state: 'ready', version: '0.3.0' })))
  })
})
