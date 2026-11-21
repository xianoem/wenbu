import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const quickTextLimit = 10_000

export const QuickTranslateSettings = Schema.Struct({
  enabled: Schema.Boolean,
  presetId: Schema.String,
})

export type QuickTranslateSettings = typeof QuickTranslateSettings.Type

export const defaultQuickTranslateSettings: QuickTranslateSettings = {
  enabled: true,
  presetId: '',
}

export const QuickLanguage = Schema.TaggedStruct('QuickLanguage', { name: Schema.String })

export type QuickLanguage = typeof QuickLanguage.Type

export const QuickDelta = Schema.TaggedStruct('QuickDelta', { text: Schema.String })

export type QuickDelta = typeof QuickDelta.Type

export const QuickDone = Schema.TaggedStruct('QuickDone', {
  modelName: Schema.String,
  costUsd: Schema.optional(Schema.Number),
})

export type QuickDone = typeof QuickDone.Type

export const QuickEvent = Schema.Union([QuickLanguage, QuickDelta, QuickDone])

export type QuickEvent = typeof QuickEvent.Type

export const QuickMessage = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
})

export type QuickMessage = typeof QuickMessage.Type

export class QuickTranslateError extends Schema.TaggedError<QuickTranslateError>()(
  'QuickTranslateError',
  {
    reason: Schema.Literals(['no-preset', 'invalid', 'failed']),
    message: Schema.String,
  },
) {}

export class QuickTranslateRpc extends RpcGroup.make(
  Rpc.make('quickTranslate', {
    payload: { text: Schema.String },
    success: QuickEvent,
    error: QuickTranslateError,
    stream: true,
  }),
  Rpc.make('quickAsk', {
    payload: {
      text: Schema.String,
      translation: Schema.String,
      history: Schema.Array(QuickMessage),
      question: Schema.String,
    },
    success: QuickEvent,
    error: QuickTranslateError,
    stream: true,
  }),
  Rpc.make('getQuickTranslateSettings', { success: QuickTranslateSettings }),
  Rpc.make('saveQuickTranslateSettings', {
    payload: QuickTranslateSettings,
    success: QuickTranslateSettings,
  }),
) {}
