import { describe, expect, it } from '@effect/vitest'
import { pySetOrder } from './PySet'
import cases from './__fixtures__/py-sets.json'

describe('pySetOrder', () => {
  it('iterates in the order CPython 3.11 does', () => {
    for (const { inserted, order } of cases) {
      expect(pySetOrder(inserted)).toEqual(order)
    }
  })
})
