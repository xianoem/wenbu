import { describe, expect, it } from '@effect/vitest'
import { fold, makeMatcher } from './GlossaryMatcher'

const matcher = makeMatcher([
  { id: 'person', patterns: ['青云'] },
  { id: 'sect', patterns: ['青云宗'] },
  { id: 'hero', patterns: ['丁松言', '松言'] },
  { id: 'dragon', patterns: ['燭龍'] },
])

const ids = (text: string) => matcher.find(text).map((match) => match.id)

describe('fold', () => {
  it('folds Traditional characters to Simplified, one for one', () => {
    expect(fold('燭龍與山海經')).toBe('烛龙与山海经')
    expect(fold('烛龙')).toBe('烛龙')
  })
})

describe('makeMatcher', () => {
  it('prefers the longest term at a position', () => {
    expect(ids('他拜入青云宗。青云笑了。')).toEqual(['sect', 'person'])
  })

  it('matches aliases to their term', () => {
    expect(ids('丁松言回頭，松言二字很好聽。')).toEqual(['hero', 'hero'])
  })

  it('matches Traditional text against Simplified terms and the other way round', () => {
    expect(ids('他曾在書裡讀過烛龙。')).toEqual(['dragon'])
    expect(ids('燭龍')).toEqual(['dragon'])
  })

  it('reports where each match is in the original text', () => {
    expect(matcher.find('讀過燭龍')).toEqual([{ id: 'dragon', start: 2, end: 4 }])
  })

  it('finds nothing without terms', () => {
    expect(makeMatcher([]).find('燭龍')).toEqual([])
  })
})
