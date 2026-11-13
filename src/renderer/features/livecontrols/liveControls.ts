import { Effect, Stream } from 'effect'
import { Core } from '#lib/rpc'

export const liveControlsAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchLiveControls', undefined)
    }),
  ),
)

export const retryLiveControlsAtom = Core.mutation('retryLiveControls')

export const setHpModeAtom = Core.mutation('setHpMode')

export const setGoldAtom = Core.mutation('setGold')

export const setDialogueFontSizeAtom = Core.mutation('setDialogueFontSize')

export const setCharacterSpeedAtom = Core.mutation('setCharacterSpeed')

export const resetLiveControlsAtom = Core.mutation('resetLiveControls')

export const listActorsAtom = Core.mutation('listActors')

export const getActorAtom = Core.mutation('getActor')

export const setActorStatAtom = Core.mutation('setActorStat')

export const listInventoryAtom = Core.mutation('listInventory')

export const setInventoryQuantityAtom = Core.mutation('setInventoryQuantity')

export const listSwitchesAtom = Core.mutation('listSwitches')

export const setSwitchAtom = Core.mutation('setSwitch')

export const listVariablesAtom = Core.mutation('listVariables')

export const setVariableAtom = Core.mutation('setVariable')

export const findMemoriesAtom = Core.mutation('findMemories')

export const unlockMemoriesAtom = Core.mutation('unlockMemories')
