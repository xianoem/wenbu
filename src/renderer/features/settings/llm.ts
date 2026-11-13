import { useAtomValue } from '@effect/atom-react'
import { Atom, AsyncResult } from 'effect/reactivity'
import type { LlmModel, LlmSettings } from '#contract/Llm'
import { Core } from '#lib/rpc'

export const llmKeys = ['llm']

export const llmSettingsAtom = Core.query('getLlmSettings', undefined, { reactivityKeys: llmKeys })

export const modelCatalogAtom = Core.query('getModelCatalog', undefined)

export const createConnectionAtom = Core.mutation('createConnection')

export const updateConnectionAtom = Core.mutation('updateConnection')

export const deleteConnectionAtom = Core.mutation('deleteConnection')

export const verifyConnectionAtom = Core.mutation('verifyConnection')

export const createPresetAtom = Core.mutation('createPreset')

export const updatePresetAtom = Core.mutation('updatePreset')

export const deletePresetAtom = Core.mutation('deletePreset')

export const deletionImpactAtom = Atom.family((key: `${'connection' | 'preset'}:${string}`) => {
  const [kind, id] = key.split(/:(.*)/s)

  return Core.query(
    'describeDeletion',
    { kind: kind === 'connection' ? 'connection' : 'preset', id: id ?? '' },
    { reactivityKeys: [...llmKeys, 'translation-settings', 'detection-settings'] },
  )
})

export const useLlmSettings = (): AsyncResult.AsyncResult<LlmSettings, unknown> =>
  useAtomValue(llmSettingsAtom)

export const useModelCatalog = (): ReadonlyArray<LlmModel> => {
  const result = useAtomValue(modelCatalogAtom)

  return AsyncResult.isSuccess(result) ? result.value : []
}

const reasoningLabels: Record<string, string> = {
  default: 'Model default',
  off: 'Off',
  none: 'None',
  thinking: 'Thinking',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

export const reasoningLabel = (choice: string) => reasoningLabels[choice] ?? choice

export const compactTokens = (count: number) => {
  if (count >= 1_000_000) {
    return `${Number((count / 1_000_000).toFixed(1))}M`
  }

  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}K`
  }

  return String(count)
}

const dollars = (amount: number) => `$${Number(amount.toFixed(3))}`

export const modelSummary = (model: LlmModel) => {
  const limits = `${compactTokens(model.contextWindow)} context · up to ${compactTokens(model.maxOutputTokens)} output`

  if (model.price === undefined) {
    return limits
  }

  return `${limits} · ${dollars(model.price.input)} in / ${dollars(model.price.output)} out per 1M tokens`
}
