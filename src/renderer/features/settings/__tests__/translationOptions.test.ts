import { describe, expect, it } from '@effect/vitest'
import { coverageKeys, defaultTranslationSettings, modeValues } from '#contract/GameTranslation'
import {
  coveragePresets,
  coveragePresetOf,
  databaseOptions,
  modeSummary,
  textCoverageOptions,
} from '../utils/translationOptions'

describe('translation options', () => {
  it('lists every coverage setting exactly once', () => {
    const listed = [...textCoverageOptions, ...databaseOptions].map((option) => option.key)

    expect(listed.toSorted()).toEqual([...coverageKeys].toSorted())
  })

  it('names the preset a coverage matches, or custom', () => {
    const standard = defaultTranslationSettings.coverage

    expect(coveragePresetOf(standard)).toBe('standard')
    expect(coveragePresetOf(coveragePresets.story.coverage)).toBe('story')
    expect(coveragePresetOf(coveragePresets.everything.coverage)).toBe('everything')
    expect(coveragePresetOf({ ...standard, items: false })).toBe('custom')
  })

  it('keeps the database out of story only and turns everything on for everything', () => {
    expect(coveragePresets.story.coverage.items).toBe(false)
    expect(coveragePresets.story.coverage.mapEvents).toBe(true)
    expect(Object.values(coveragePresets.everything.coverage).every(Boolean)).toBe(true)
  })

  it('describes the speed values in words', () => {
    expect(modeSummary(modeValues.balanced)).toBe(
      '64 requests at a time · 512-token batches · 120s timeout · 16 retry rounds',
    )
  })
})
