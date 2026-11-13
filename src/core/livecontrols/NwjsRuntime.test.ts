import { describe, expect, it } from '@effect/vitest'
import { callExpression, chromiumMajor } from './NwjsRuntime'

const binary = (text: string) => new TextEncoder().encode(text)

describe('NwjsRuntime', () => {
  it('reads the Chromium version an NW.js binary names, ignoring certificate OIDs', () => {
    expect(chromiumMajor(binary('\u00002.5.29.15\u0000171.1.1.10\u000065.0.3325.146\u0000'))).toBe(
      65,
    )

    expect(chromiumMajor(binary('1.3.6.1.4.1.311\u0000'))).toBeUndefined()
    expect(chromiumMajor(binary('Chrome/120.0.6099.71 '))).toBe(120)
  })

  it('calls the runtime, or reports that the page lost it', () => {
    expect(callExpression('setGold', [10])).toContain('live.call("setGold", [10])')
    expect(callExpression('snapshot', [])).toContain('wenbu-live-missing')
  })
})
