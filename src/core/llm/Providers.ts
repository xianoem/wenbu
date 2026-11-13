import type { LlmProvider } from '#contract/Llm'

const openAiCompatibleUrls: Record<Exclude<LlmProvider, 'custom-openai-compatible'>, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com',
  moonshotai: 'https://api.moonshot.ai/v1',
}

export const apiRoot = (provider: LlmProvider, apiUrl: string | undefined) => {
  const url = provider === 'custom-openai-compatible' ? apiUrl : openAiCompatibleUrls[provider]

  return url?.trim().replace(/\/+$/, '')
}
