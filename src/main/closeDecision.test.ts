import { describe, expect, it } from '@effect/vitest'
import { defaultBackgroundSettings } from '#contract/Background'
import { closeDecision } from './closeDecision'

const asked = { ...defaultBackgroundSettings, closeAsked: true }

describe('closeDecision', () => {
  it('asks the first time the window is closed', () => {
    expect(closeDecision(defaultBackgroundSettings, { quitting: false, answered: false })).toBe(
      'ask',
    )
  })

  it('lets the window close and keeps Wenbu in the tray once the user chose that', () => {
    expect(closeDecision(asked, { quitting: false, answered: false })).toBe('close')
  })

  it('quits when the user chose to quit on close', () => {
    expect(
      closeDecision({ ...asked, closeAction: 'quit' }, { quitting: false, answered: false }),
    ).toBe('quit')
  })

  it('closes right after the user answers the first-close question', () => {
    expect(closeDecision(defaultBackgroundSettings, { quitting: false, answered: true })).toBe(
      'close',
    )
  })

  it('never holds the window back while Wenbu quits', () => {
    expect(closeDecision(defaultBackgroundSettings, { quitting: true, answered: false })).toBe(
      'close',
    )
  })
})
