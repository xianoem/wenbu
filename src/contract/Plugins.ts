import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { SpaceShortfall } from './Storage'

export const PluginId = Schema.Literals([
  'screen-ai',
  'luna-hook',
  'manga-image-translator',
  'qwen3-asr',
  'sensevoice-small',
  'whisper-large-v3-turbo',
  'fun-asr-mlt-nano',
])

export type PluginId = typeof PluginId.Type

export const PluginPlatform = Schema.Literals(['win32', 'linux'])

export const PluginRelease = Schema.Struct({
  version: Schema.String,
  publishedAt: Schema.optional(Schema.String),
  downloadBytes: Schema.optional(Schema.Int),
})

export type PluginRelease = typeof PluginRelease.Type

export const PluginTest = Schema.Struct({
  passed: Schema.Boolean,
  message: Schema.String,
  testedAt: Schema.String,
})

export type PluginTest = typeof PluginTest.Type

export const InstalledPlugin = Schema.Struct({
  version: Schema.String,
  sizeBytes: Schema.Int,
  installedAt: Schema.String,
  test: PluginTest,
})

export type InstalledPlugin = typeof InstalledPlugin.Type

export const InstallStepStatus = Schema.Literals(['pending', 'running', 'done', 'failed'])

export type InstallStepStatus = typeof InstallStepStatus.Type

export const InstallStep = Schema.Struct({
  label: Schema.String,
  status: InstallStepStatus,
  progress: Schema.optional(Schema.Struct({ done: Schema.Finite, total: Schema.Finite })),
  detail: Schema.optional(Schema.String),
})

export type InstallStep = typeof InstallStep.Type

export const PluginInstall = Schema.Struct({
  version: Schema.String,
  running: Schema.Boolean,
  steps: Schema.Array(InstallStep),
  error: Schema.optional(Schema.String),
  space: Schema.optional(SpaceShortfall),
})

export type PluginInstall = typeof PluginInstall.Type

export const Plugin = Schema.Struct({
  id: PluginId,
  name: Schema.String,
  description: Schema.String,
  project: Schema.String,
  license: Schema.String,
  sourceLabel: Schema.String,
  sourceUrl: Schema.String,
  pinned: Schema.optional(Schema.String),
  platforms: Schema.Array(PluginPlatform),
  supported: Schema.Boolean,
  installed: Schema.optional(InstalledPlugin),
  latest: Schema.optional(PluginRelease),
  install: Schema.optional(PluginInstall),
  checkError: Schema.optional(Schema.String),
})

export type Plugin = typeof Plugin.Type

export const PluginsState = Schema.Struct({
  plugins: Schema.Array(Plugin),
  checking: Schema.Boolean,
  checkedAt: Schema.optional(Schema.String),
})

export type PluginsState = typeof PluginsState.Type

export class PluginError extends Schema.TaggedError<PluginError>()('PluginError', {
  reason: Schema.Literals(['unsupported', 'busy', 'unavailable', 'failed']),
  message: Schema.String,
}) {}

const ById = { id: PluginId }

export class PluginsRpc extends RpcGroup.make(
  Rpc.make('watchPlugins', { success: PluginsState, stream: true }),
  Rpc.make('checkPluginUpdates'),
  Rpc.make('installPlugin', { payload: ById, error: PluginError }),
  Rpc.make('cancelPluginInstall', { payload: ById }),
  Rpc.make('removePlugin', { payload: ById, error: PluginError }),
  Rpc.make('testPlugin', { payload: ById, error: PluginError }),
) {}
