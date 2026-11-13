import { describe, expect, it } from '@effect/vitest'
import {
  contextBudget,
  defaultOverlaySettings,
  type OverlayContext,
} from '#contract/TranslationOverlay'
import { estimateTokens } from '../translation/Batches'
import {
  contextFor,
  type ContextPair,
  summaryLimit,
  summaryPrompt,
  systemPrompt,
} from './TranslationContext'

const context = (overrides: Partial<OverlayContext>): OverlayContext => ({
  ...defaultOverlaySettings.context,
  ...overrides,
})

const pairs = (count: number): ReadonlyArray<ContextPair> =>
  Array.from({ length: count }, (_, index) => ({
    source: `line ${index}`,
    translation: `translation ${index}`,
  }))

const system = systemPrompt({ sourceLanguage: 'Japanese', targetLanguage: 'English' })

describe('contextBudget', () => {
  it('uses the setting when the model window is large', () => {
    expect(
      contextBudget(
        { contextWindow: 128_000, maxOutputTokens: 4096 },
        context({ maxTokens: 2000 }),
        50,
      ),
    ).toBe(2000)
  })

  it('is clamped by half the window minus the output and prompt', () => {
    expect(
      contextBudget(
        { contextWindow: 8000, maxOutputTokens: 3000 },
        context({ maxTokens: 2000 }),
        200,
      ),
    ).toBe(800)
  })

  it('assumes an 8,000 token window for uncatalogued models', () => {
    expect(contextBudget({ maxOutputTokens: 3500 }, context({ maxTokens: 2000 }), 0)).toBe(500)
  })

  it('never goes below zero', () => {
    expect(contextBudget({ contextWindow: 4000, maxOutputTokens: 4000 }, context({}), 0)).toBe(0)
  })
})

describe('contextFor', () => {
  it('sends no history when context is off', () => {
    expect(
      contextFor({ system, pairs: pairs(5), settings: context({ mode: 'off' }), budget: 2000 }),
    ).toEqual({ system, history: [] })
  })

  it('sends the last pairs oldest first as user and assistant turns', () => {
    const result = contextFor({
      system,
      pairs: pairs(5),
      settings: context({ mode: 'recent', lines: 2 }),
      budget: 2000,
    })

    expect(result.system).toBe(system)

    expect(result.history).toEqual([
      { role: 'user', text: 'line 3' },
      { role: 'assistant', text: 'translation 3' },
      { role: 'user', text: 'line 4' },
      { role: 'assistant', text: 'translation 4' },
    ])
  })

  it('drops the oldest pairs until the history fits the budget', () => {
    const cost = estimateTokens('line 0') + estimateTokens('translation 0')

    const result = contextFor({
      system,
      pairs: pairs(10),
      settings: context({ mode: 'recent', lines: 10 }),
      budget: cost * 3,
    })

    expect(result.history.map((turn) => turn.text)).toEqual([
      'line 7',
      'translation 7',
      'line 8',
      'translation 8',
      'line 9',
      'translation 9',
    ])
  })

  it('puts the summary after the instructions so the prefix stays stable', () => {
    const result = contextFor({
      system,
      pairs: pairs(5),
      summary: 'Aki (she/her) calls Ren "senpai".',
      settings: context({ mode: 'summary', lines: 1 }),
      budget: 2000,
    })

    expect(result.system.startsWith(system)).toBe(true)
    expect(result.system).toContain('Aki (she/her) calls Ren "senpai".')
    expect(result.history.map((turn) => turn.text)).toEqual(['line 4', 'translation 4'])
  })

  it('leaves the summary out of recent mode', () => {
    const result = contextFor({
      system,
      pairs: [],
      summary: 'A story',
      settings: context({ mode: 'recent' }),
      budget: 2000,
    })

    expect(result.system).toBe(system)
  })

  it('counts the summary against the budget', () => {
    const summary = 'word '.repeat(40)
    const pairCost = estimateTokens('line 0') + estimateTokens('translation 0')

    const result = contextFor({
      system,
      pairs: pairs(10),
      summary,
      settings: context({ mode: 'summary', lines: 10 }),
      budget: estimateTokens(summary) + pairCost * 2,
    })

    expect(result.history).toHaveLength(4)
  })
})

describe('summaryPrompt', () => {
  it('asks to merge the previous summary with new lines within the limit', () => {
    const prompt = summaryPrompt('Old summary', pairs(2), 300)

    expect(prompt.prompt).toContain('Old summary')
    expect(prompt.prompt).toContain('line 1')
    expect(prompt.prompt).toContain('translation 1')
    expect(prompt.system).toContain('300')
  })

  it('caps the summary at a quarter of the budget', () => {
    expect(summaryLimit(2000)).toBe(500)
  })
})
