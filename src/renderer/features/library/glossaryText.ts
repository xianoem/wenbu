import type { GameGlossary, GlossaryEstimate } from '#contract/GameGlossary'
import { formatTokens, formatUsd } from './library'

const plural = (count: number, noun: string) =>
  `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`

const benefit = 'Keeps names, terms and each character’s way of talking the same in every scene.'

export const preparationText = (estimate: GlossaryEstimate) =>
  estimate.prepare.costUsd === undefined
    ? `${formatTokens(estimate.prepare.inputTokens + estimate.prepare.outputTokens)} tokens`
    : formatUsd(estimate.prepare.costUsd)

const percentOf = (estimate: GlossaryEstimate) => {
  if (estimate.extraCostUsd === undefined || (estimate.baseCostUsd ?? 0) <= 0) {
    return undefined
  }

  return Math.round((estimate.extraCostUsd / (estimate.baseCostUsd ?? 1)) * 100)
}

export const extraText = (estimate: GlossaryEstimate) => {
  if (estimate.extraCostUsd === undefined) {
    return `${formatTokens(estimate.extraInputTokens)} tokens`
  }

  const percent = percentOf(estimate)
  const amount = formatUsd(estimate.extraCostUsd)

  return percent === undefined ? amount : `${amount} (${percent}%)`
}

export const offSummary = (estimate: GlossaryEstimate | undefined) =>
  estimate === undefined
    ? benefit
    : `${benefit} About ${preparationText(estimate)} once, then about ${extraText(estimate)} more a run.`

export const unpreparedSummary = (estimate: GlossaryEstimate | undefined) =>
  estimate === undefined
    ? 'Not prepared yet. Translate prepares it first, or prepare it now and review it before translating.'
    : `Not prepared yet. Translate prepares it first, about ${preparationText(estimate)} once. Or prepare it now and review it before translating.`

export const characterCount = (glossary: GameGlossary) =>
  glossary.entries.filter((entry) => entry.kind === 'character').length

export const contentsOf = (glossary: GameGlossary) => {
  const characters = characterCount(glossary)

  return `${plural(characters, 'character')} and ${plural(glossary.entries.length - characters, 'term')}`
}

export const readySummary = (glossary: GameGlossary, estimate: GlossaryEstimate | undefined) =>
  [
    contentsOf(glossary),
    ...(glossary.costUsd === undefined ? [] : [`prepared for ${formatUsd(glossary.costUsd)}`]),
    ...(estimate === undefined ? [] : [`adds about ${extraText(estimate)} a run`]),
  ].join(' · ')

export const offPreparedSummary = (
  glossary: GameGlossary,
  estimate: GlossaryEstimate | undefined,
) =>
  estimate === undefined
    ? `${contentsOf(glossary)} · off`
    : `${contentsOf(glossary)} · off · would add about ${extraText(estimate)} a run`

export const speakerLabel = (key: string) => {
  const [kind = '', ...rest] = key.split(':')

  if (kind === 'name') {
    return `name box ${rest.join(':')}`
  }

  if (kind === 'face') {
    const index = rest.pop()

    return `face ${rest.join(':')} #${index ?? 0}`
  }

  return `actor ${rest.join(':')}`
}
