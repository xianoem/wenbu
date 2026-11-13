import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const detectionHistoryLimit = 100

export const DetectionEngineId = Schema.Literals(['screen-ai', 'google-lens'])

export type DetectionEngineId = typeof DetectionEngineId.Type

export const DetectionInput = Schema.Literals(['clipboard', 'image'])

export type DetectionInput = typeof DetectionInput.Type

export const OcrBox = Schema.Struct({
  centerX: Schema.Finite,
  centerY: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  rotation: Schema.optional(Schema.Finite),
})

export type OcrBox = typeof OcrBox.Type

export const OcrWord = Schema.Struct({
  text: Schema.String,
  separator: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Finite),
  box: Schema.optional(OcrBox),
})

export type OcrWord = typeof OcrWord.Type

export const OcrLine = Schema.Struct({
  text: Schema.String,
  box: Schema.optional(OcrBox),
  words: Schema.Array(OcrWord),
})

export type OcrLine = typeof OcrLine.Type

export const OcrParagraph = Schema.Struct({
  box: Schema.optional(OcrBox),
  lines: Schema.Array(OcrLine),
})

export type OcrParagraph = typeof OcrParagraph.Type

export const OcrResult = Schema.Struct({
  image: Schema.Struct({ width: Schema.Int, height: Schema.Int }),
  paragraphs: Schema.Array(OcrParagraph),
})

export type OcrResult = typeof OcrResult.Type

export const DetectionEngineLocality = Schema.Literals(['local', 'cloud'])

export const DetectionEngine = Schema.Struct({
  id: DetectionEngineId,
  label: Schema.String,
  locality: DetectionEngineLocality,
  ready: Schema.Boolean,
  detail: Schema.optional(Schema.String),
})

export type DetectionEngine = typeof DetectionEngine.Type

export const DetectionTranslation = Schema.Struct({
  status: Schema.Literals(['translated', 'failed']),
  presetName: Schema.String,
  error: Schema.optional(Schema.String),
})

export type DetectionTranslation = typeof DetectionTranslation.Type

export const Detection = Schema.Struct({
  id: Schema.String,
  originalText: Schema.String,
  translatedText: Schema.optional(Schema.String),
  input: DetectionInput,
  detectedAt: Schema.String,
  engine: Schema.Struct({ id: DetectionEngineId, label: Schema.String }),
  translation: Schema.optional(DetectionTranslation),
  ocr: OcrResult,
})

export type Detection = typeof Detection.Type

export const PendingDetection = Schema.Struct({
  id: Schema.String,
  input: DetectionInput,
  startedAt: Schema.String,
})

export type PendingDetection = typeof PendingDetection.Type

export const DetectionSettings = Schema.Struct({
  engineId: Schema.optional(DetectionEngineId),
  listenToClipboard: Schema.Boolean,
  concurrentJobs: Schema.Int,
  cloudRequestsPerMinute: Schema.Int,
  translation: Schema.Struct({
    presetId: Schema.String,
    targetLanguage: Schema.String,
    timeoutSeconds: Schema.Int,
    retryRounds: Schema.Int,
  }),
})

export type DetectionSettings = typeof DetectionSettings.Type

export const defaultDetectionSettings: DetectionSettings = {
  listenToClipboard: true,
  concurrentJobs: 1,
  cloudRequestsPerMinute: 10,
  translation: { presetId: '', targetLanguage: 'English', timeoutSeconds: 120, retryRounds: 2 },
}

export const DetectionsState = Schema.Struct({
  detections: Schema.Array(Detection),
  pending: Schema.Array(PendingDetection),
  engines: Schema.Array(DetectionEngine),
  lastError: Schema.optional(Schema.String),
})

export type DetectionsState = typeof DetectionsState.Type

export class DetectionError extends Schema.TaggedError<DetectionError>()('DetectionError', {
  reason: Schema.Literals(['invalid', 'not-ready', 'failed']),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

export const RgbaImage = Schema.Struct({
  width: Schema.Int,
  height: Schema.Int,
  pixels: Schema.Uint8Array,
})

export type RgbaImage = typeof RgbaImage.Type

export class DetectionsRpc extends RpcGroup.make(
  Rpc.make('watchDetections', { success: DetectionsState, stream: true }),
  Rpc.make('getDetectionSettings', { success: DetectionSettings }),
  Rpc.make('saveDetectionSettings', {
    payload: DetectionSettings,
    success: DetectionSettings,
    error: DetectionError,
  }),
  Rpc.make('detectImage', { payload: RgbaImage, error: DetectionError }),
  Rpc.make('removeDetection', { payload: { id: Schema.String } }),
) {}
