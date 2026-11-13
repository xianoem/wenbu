import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const ImageStyle = Schema.Literals(['cover', 'label'])

export type ImageStyle = typeof ImageStyle.Type

export const WhenTooLong = Schema.Literals(['shorten', 'shrink-only'])

export type WhenTooLong = typeof WhenTooLong.Type

export const OriginalKey = Schema.Literals(['backquote', 'tab', 'alt'])

export type OriginalKey = typeof OriginalKey.Type

export const InGameTextSettings = Schema.Struct({
  uiText: Schema.Boolean,
  imageText: Schema.Boolean,
  imageStyle: ImageStyle,
  whenTooLong: WhenTooLong,
  wordWrap: Schema.Boolean,
  reflow: Schema.Boolean,
  originalKey: OriginalKey,
})

export type InGameTextSettings = typeof InGameTextSettings.Type

export const defaultInGameTextSettings: InGameTextSettings = {
  uiText: false,
  imageText: false,
  imageStyle: 'cover',
  whenTooLong: 'shorten',
  wordWrap: false,
  reflow: false,
  originalKey: 'backquote',
}

export const TextFit = Schema.Literals(['as-is', 'smaller', 'squeezed', 'wrapped', 'too-long'])

export type TextFit = typeof TextFit.Type

export const InGameTextOrigin = Schema.Literals(['ui', 'image'])

export type InGameTextOrigin = typeof InGameTextOrigin.Type

export const InGameTextEntry = Schema.Struct({
  /** The source text with digit runs replaced by {0}, {1}, ... */
  key: Schema.String,
  origin: InGameTextOrigin,
  translatedText: Schema.String,
  scene: Schema.optional(Schema.String),
  allowedWidth: Schema.optional(Schema.Int),
  fontSize: Schema.optional(Schema.Int),
  fit: TextFit,
  edited: Schema.Boolean,
  locked: Schema.Boolean,
  firstSeenAt: Schema.String,
  updatedAt: Schema.String,
})

export type InGameTextEntry = typeof InGameTextEntry.Type

export const InGameTextFilter = Schema.Literals(['all', 'too-long', 'edited', 'images'])

export type InGameTextFilter = typeof InGameTextFilter.Type

export const ImageScanProgress = Schema.Struct({ done: Schema.Int, total: Schema.Int })

export type ImageScanProgress = typeof ImageScanProgress.Type

export const InGameTextSummary = Schema.Struct({
  strings: Schema.Int,
  tooLong: Schema.Int,
  images: Schema.Struct({ withText: Schema.Int, total: Schema.Int }),
  scan: Schema.optional(ImageScanProgress),
  notice: Schema.optional(Schema.String),
})

export type InGameTextSummary = typeof InGameTextSummary.Type

export class InGameTextError extends Schema.TaggedError<InGameTextError>()('InGameTextError', {
  reason: Schema.Literals(['not-found', 'not-ready', 'failed']),
  message: Schema.String,
}) {}

const ByGame = { gameId: Schema.String }

const ByEntry = { gameId: Schema.String, origin: InGameTextOrigin, key: Schema.String }

export class InGameTextRpc extends RpcGroup.make(
  Rpc.make('getInGameTextSettings', { payload: ByGame, success: InGameTextSettings }),
  Rpc.make('saveInGameTextSettings', {
    payload: { ...ByGame, settings: InGameTextSettings },
    success: InGameTextSettings,
  }),
  Rpc.make('watchInGameTextSummary', {
    payload: ByGame,
    success: InGameTextSummary,
    stream: true,
  }),
  Rpc.make('listInGameTexts', {
    payload: { ...ByGame, filter: InGameTextFilter, search: Schema.String },
    success: Schema.Array(InGameTextEntry),
  }),
  Rpc.make('saveInGameText', {
    payload: { ...ByEntry, translatedText: Schema.String },
    success: InGameTextEntry,
    error: InGameTextError,
  }),
  Rpc.make('setInGameTextLocked', {
    payload: { ...ByEntry, locked: Schema.Boolean },
    success: InGameTextEntry,
    error: InGameTextError,
  }),
  Rpc.make('shortenInGameText', {
    payload: ByEntry,
    success: InGameTextEntry,
    error: InGameTextError,
  }),
  Rpc.make('scanGameImages', { payload: ByGame, error: InGameTextError }),
  Rpc.make('cancelImageScan', { payload: ByGame }),
) {}
