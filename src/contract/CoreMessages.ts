import { Schema } from 'effect'
import { LogEntry } from './Diagnostics'

export const ClipboardImage = Schema.TaggedStruct('ClipboardImage', {
  width: Schema.Int,
  height: Schema.Int,
  pixels: Schema.Uint8Array,
})

export type ClipboardImage = typeof ClipboardImage.Type

export const WindowBounds = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
})

export type WindowBounds = typeof WindowBounds.Type

export const OverlayWindow = Schema.TaggedStruct('OverlayWindow', {
  open: Schema.Boolean,
  visible: Schema.Boolean,
  locked: Schema.Boolean,
  bounds: Schema.optional(WindowBounds),
})

export type OverlayWindow = typeof OverlayWindow.Type

export const OverlayBounds = Schema.TaggedStruct('OverlayBounds', { bounds: WindowBounds })

export type OverlayBounds = typeof OverlayBounds.Type

export const SubtitleWindow = Schema.TaggedStruct('SubtitleWindow', {
  open: Schema.Boolean,
  visible: Schema.Boolean,
  locked: Schema.Boolean,
  hideFromCapture: Schema.Boolean,
  bounds: Schema.optional(WindowBounds),
})

export type SubtitleWindow = typeof SubtitleWindow.Type

export const SubtitleBounds = Schema.TaggedStruct('SubtitleBounds', { bounds: WindowBounds })

export type SubtitleBounds = typeof SubtitleBounds.Type

export const SubtitleLockToggle = Schema.TaggedStruct('SubtitleLockToggle', {})

export type SubtitleLockToggle = typeof SubtitleLockToggle.Type

export const LiveControlsWindow = Schema.TaggedStruct('LiveControlsWindow', {
  open: Schema.Boolean,
  gameTitle: Schema.optional(Schema.String),
})

export type LiveControlsWindow = typeof LiveControlsWindow.Type

export const SourceSignIn = Schema.TaggedStruct('SourceSignIn', {
  source: Schema.String,
  url: Schema.String,
  sites: Schema.Array(Schema.String),
  storageKeys: Schema.Array(Schema.String),
})

export type SourceSignIn = typeof SourceSignIn.Type

export const SessionCookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
})

export type SessionCookie = typeof SessionCookie.Type

export const SourceSession = Schema.TaggedStruct('SourceSession', {
  source: Schema.String,
  cookies: Schema.Array(SessionCookie),
  userAgent: Schema.String,
  storage: Schema.Record(Schema.String, Schema.String),
  problem: Schema.optional(Schema.String),
})

export type SourceSession = typeof SourceSession.Type

export const SourceSignOut = Schema.TaggedStruct('SourceSignOut', { source: Schema.String })

export type SourceSignOut = typeof SourceSignOut.Type

export const PageFetch = Schema.TaggedStruct('PageFetch', {
  id: Schema.String,
  url: Schema.String,
  interactive: Schema.Boolean,
})

export type PageFetch = typeof PageFetch.Type

export const PageFetched = Schema.TaggedStruct('PageFetched', {
  id: Schema.String,
  status: Schema.Int,
  url: Schema.String,
  body: Schema.String,
  problem: Schema.optional(Schema.String),
})

export type PageFetched = typeof PageFetched.Type

export const MainLogEntry = Schema.TaggedStruct('MainLogEntry', { entry: LogEntry })

export type MainLogEntry = typeof MainLogEntry.Type

/** Core asks for the updater's status when it starts: main may have told an earlier core. */
export const UpdateWatch = Schema.TaggedStruct('UpdateWatch', {})

export type UpdateWatch = typeof UpdateWatch.Type

export const UpdateInstall = Schema.TaggedStruct('UpdateInstall', {})

export type UpdateInstall = typeof UpdateInstall.Type
