import { Schema } from 'effect'

export const WindowAction = Schema.Literals(['minimize', 'maximize', 'close'])

export type WindowAction = typeof WindowAction.Type
