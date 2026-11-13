import { assert, describe, it } from '@effect/vitest'
import { overlayIndicator } from './overlayIndicator'

describe('overlayIndicator', () => {
  it('shows nothing before the overlay has been used', () => {
    assert.isUndefined(overlayIndicator(undefined))
    assert.isUndefined(overlayIndicator({ status: 'idle', visible: false }))
  })

  it('shows nothing when setup is still missing', () => {
    assert.isUndefined(overlayIndicator({ status: 'setup-required', visible: false }))
  })

  it('shows an error once the overlay has failed', () => {
    assert.strictEqual(overlayIndicator({ status: 'failed', visible: false }), 'bg-destructive')
  })

  it('shows whether a running session is visible', () => {
    assert.strictEqual(
      overlayIndicator({ status: 'attached', sessionId: 'session', visible: true }),
      'bg-warning',
    )

    assert.strictEqual(
      overlayIndicator({ status: 'attached', sessionId: 'session', visible: false }),
      'border border-muted-foreground bg-transparent',
    )
  })
})
