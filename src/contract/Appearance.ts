import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const Theme = Schema.Literals(['system', 'light', 'dark'])

export type Theme = typeof Theme.Type

export class Appearance extends Schema.Class<Appearance>('Appearance')({
  theme: Theme,
}) {}

export class AppearanceRpc extends RpcGroup.make(
  Rpc.make('getAppearance', { success: Appearance }),
  Rpc.make('setAppearance', { payload: Appearance, success: Appearance }),
) {}
