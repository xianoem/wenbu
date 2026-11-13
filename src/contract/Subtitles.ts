import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const ComputerAudio = Schema.TaggedStruct('ComputerAudio', {})

export const AppAudio = Schema.TaggedStruct('AppAudio', {
  pid: Schema.Int,
  name: Schema.String,
  path: Schema.String,
})

export const AudioSource = Schema.Union([ComputerAudio, AppAudio])

export type AudioSource = typeof AudioSource.Type

export const isAppAudio = Schema.is(AppAudio)

export const sameAudioSource = (left: AudioSource, right: AudioSource) => {
  if (isAppAudio(left) && isAppAudio(right)) {
    return left.pid === right.pid
  }

  return isAppAudio(left) === isAppAudio(right)
}

export const appName = (source: AudioSource) => (isAppAudio(source) ? source.name : undefined)

export const SpeechModelId = Schema.Literals([
  'qwen3-asr',
  'sensevoice-small',
  'whisper-large-v3-turbo',
  'fun-asr-mlt-nano',
])

export type SpeechModelId = typeof SpeechModelId.Type

export const defaultSpeechModel: SpeechModelId = 'qwen3-asr'

export const speechModels: Record<
  SpeechModelId,
  { readonly name: string; readonly strength: string; readonly download: string }
> = {
  'qwen3-asr': {
    name: 'Qwen3-ASR',
    strength: 'Best all round on Japanese, Chinese and Korean',
    download: '0.9 or 2.2 GB',
  },
  'sensevoice-small': {
    name: 'SenseVoice Small',
    strength: 'Fastest; keeps up without a strong GPU',
    download: '250 MB',
  },
  'whisper-large-v3-turbo': {
    name: 'Whisper large-v3 turbo',
    strength: 'Strong on Japanese and Korean',
    download: '890 MB',
  },
  'fun-asr-mlt-nano': {
    name: 'Fun-ASR MLT Nano',
    strength: 'Strong on Japanese and Chinese',
    download: '890 MB',
  },
}

export const SubtitleDevice = Schema.Literals(['auto', 'gpu', 'cpu'])

export type SubtitleDevice = typeof SubtitleDevice.Type

export const Sensitivity = Schema.Literals(['low', 'normal', 'high'])

export type Sensitivity = typeof Sensitivity.Type

export const SubtitleOverlayMode = Schema.Literals(['both', 'translation'])

export type SubtitleOverlayMode = typeof SubtitleOverlayMode.Type

export const SubtitleSettings = Schema.Struct({
  source: AudioSource,
  outputId: Schema.optional(Schema.String),
  targetLanguage: Schema.String,
  presetId: Schema.String,
  model: SpeechModelId,
  spokenLanguage: Schema.optional(Schema.String),
  device: SubtitleDevice,
  sensitivity: Sensitivity,
  pauseMs: Schema.Int,
  waitForSentences: Schema.Boolean,
  contextLines: Schema.Int,
  overlayMode: SubtitleOverlayMode,
  /** 0 to 3, smallest to largest. */
  textSize: Schema.Int,
  hideFromCapture: Schema.Boolean,
})

export type SubtitleSettings = typeof SubtitleSettings.Type

export const AudioOutput = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  isDefault: Schema.Boolean,
})

export type AudioOutput = typeof AudioOutput.Type

export const AudioApp = Schema.Struct({ pid: Schema.Int, name: Schema.String, path: Schema.String })

export type AudioApp = typeof AudioApp.Type

export const AudioSources = Schema.Struct({
  outputs: Schema.Array(AudioOutput),
  apps: Schema.Array(AudioApp),
  appCapture: Schema.Boolean,
})

export type AudioSources = typeof AudioSources.Type

export const LineStatus = Schema.Literals(['translating', 'translated', 'failed'])

export type LineStatus = typeof LineStatus.Type

export const SubtitleLine = Schema.Struct({
  id: Schema.Int,
  /** Seconds from the start of the session. */
  start: Schema.Finite,
  end: Schema.Finite,
  original: Schema.String,
  language: Schema.String,
  translation: Schema.optional(Schema.String),
  status: LineStatus,
  error: Schema.optional(Schema.String),
})

export type SubtitleLine = typeof SubtitleLine.Type

export const SubtitleStatus = Schema.Literals([
  'stopped',
  'loading-model',
  'listening',
  'paused',
  'failed',
])

export type SubtitleStatus = typeof SubtitleStatus.Type

export const SubtitleState = Schema.Struct({
  status: SubtitleStatus,
  message: Schema.optional(Schema.String),
  sourceName: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  device: Schema.optional(Schema.String),
  partial: Schema.optional(Schema.String),
  recent: Schema.Array(SubtitleLine),
  /** Seconds from the end of speech. */
  textDelay: Schema.optional(Schema.Finite),
  translationDelay: Schema.optional(Schema.Finite),
  slowRecognition: Schema.optional(Schema.Boolean),
  tokens: Schema.Int,
  costUsd: Schema.optional(Schema.Finite),
  overlayVisible: Schema.Boolean,
  overlayLocked: Schema.Boolean,
  overlayMode: SubtitleOverlayMode,
  textSize: Schema.Int,
})

export type SubtitleState = typeof SubtitleState.Type

export const AudioLevel = Schema.Struct({ level: Schema.Finite, speech: Schema.Boolean })

export type AudioLevel = typeof AudioLevel.Type

export class SubtitlesError extends Schema.TaggedError<SubtitlesError>()('SubtitlesError', {
  reason: Schema.Literals(['no-plugin', 'no-preset', 'invalid', 'capture-failed', 'speech-failed']),
  message: Schema.String,
}) {}

export class SubtitlesRpc extends RpcGroup.make(
  Rpc.make('getSubtitleSettings', { success: SubtitleSettings }),
  Rpc.make('saveSubtitleSettings', {
    payload: SubtitleSettings,
    success: SubtitleSettings,
    error: SubtitlesError,
  }),
  Rpc.make('watchAudioSources', { success: AudioSources, error: SubtitlesError, stream: true }),
  Rpc.make('startSubtitles', { error: SubtitlesError }),
  Rpc.make('stopSubtitles'),
  Rpc.make('setSubtitlesPaused', { payload: { paused: Schema.Boolean } }),
  Rpc.make('setSubtitleOverlayVisible', { payload: { visible: Schema.Boolean } }),
  Rpc.make('setSubtitleOverlayLocked', { payload: { locked: Schema.Boolean } }),
  Rpc.make('setSubtitleTextSize', { payload: { textSize: Schema.Int } }),
  Rpc.make('retrySubtitleTranslation', { payload: { lineId: Schema.Int } }),
  Rpc.make('clearSubtitleBacklog'),
  Rpc.make('watchSubtitles', { success: SubtitleState, stream: true }),
  Rpc.make('watchSubtitleBacklog', { success: Schema.Array(SubtitleLine), stream: true }),
  Rpc.make('watchAudioLevel', { success: AudioLevel, stream: true }),
) {}
