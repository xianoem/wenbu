import { useAtomSet } from '@effect/atom-react'
import { HeartbeatIcon, LightningIcon, MoneyIcon, TextAaIcon } from '@phosphor-icons/react'
import type { Exit } from 'effect'
import { useState } from 'react'
import {
  characterSpeeds,
  dialogueFontSizes,
  type HookedControl,
  type LiveControlsState,
} from '#contract/LiveControls'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { ButtonGroup } from '#ui/button-group'
import { Field, FieldContent, FieldTitle } from '#ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '#ui/input-group'
import { Slider } from '#ui/slider'
import { Switch } from '#ui/switch'
import { InGameTextSwitches } from '../../ingametext/InGameTextSwitches'
import {
  resetLiveControlsAtom,
  setCharacterSpeedAtom,
  setDialogueFontSizeAtom,
  setGoldAtom,
  setHpModeAtom,
} from '../liveControls'
import { CommitInput, wholeNumber } from './CommitInput'
import { MemoriesCard } from './MemoriesCard'

const clampFontSize = (size: number) =>
  Math.max(dialogueFontSizes.min, Math.min(dialogueFontSizes.max, Math.round(size)))

function HpModeCard({
  icon,
  title,
  description,
  unavailable,
  checked,
  onCheckedChange,
}: {
  readonly icon: React.ReactNode
  readonly title: string
  readonly description: string
  readonly unavailable: string | undefined
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">
          {unavailable === undefined ? description : `Unavailable: ${unavailable}`}
        </div>
      </div>
      <Switch
        aria-label={title}
        checked={checked}
        disabled={unavailable !== undefined}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

export function GeneralTab({ state }: { readonly state: LiveControlsState }) {
  const setHpMode = useAtomSet(setHpModeAtom, { mode: 'promiseExit' })
  const setGold = useAtomSet(setGoldAtom, { mode: 'promiseExit' })
  const setFontSize = useAtomSet(setDialogueFontSizeAtom, { mode: 'promiseExit' })
  const setSpeed = useAtomSet(setCharacterSpeedAtom, { mode: 'promiseExit' })
  const reset = useAtomSet(resetLiveControlsAtom, { mode: 'promiseExit' })
  const [error, setError] = useState<string | undefined>(undefined)

  const report = async (pending: Promise<Exit.Exit<unknown, unknown>>) =>
    setError(formErrorOf(await pending)?.message)

  const unavailable = (control: HookedControl) =>
    state.unsupported.find((entry) => entry.control === control)?.reason

  const changeFontSize = (size: number) =>
    report(setFontSize({ payload: { size: clampFontSize(size) } }))

  const speedIndex = Math.max(0, characterSpeeds.indexOf(state.characterSpeed))
  const fontUnavailable = unavailable('fontSize')
  const speedUnavailable = unavailable('speed')

  return (
    <div className="space-y-5 p-4">
      {error === undefined ? null : (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <HpModeCard
          icon={<HeartbeatIcon className="size-5 text-muted-foreground" />}
          title="God Mode"
          description="Keep the protagonist at full HP."
          unavailable={unavailable('hpMode')}
          checked={state.hpMode === 'god'}
          onCheckedChange={(checked) =>
            report(setHpMode({ payload: { mode: checked ? 'god' : 'none' } }))
          }
        />
        <HpModeCard
          icon={<LightningIcon className="size-5 text-muted-foreground" />}
          title="Killable Mode"
          description="Set the protagonist to 1 HP."
          unavailable={unavailable('hpMode')}
          checked={state.hpMode === 'killable'}
          onCheckedChange={(checked) =>
            report(setHpMode({ payload: { mode: checked ? 'killable' : 'none' } }))
          }
        />
      </div>

      <MemoriesCard key={String(state.ready)} />

      <Field>
        <FieldTitle className="flex items-center gap-2">
          <MoneyIcon />
          Gold
        </FieldTitle>
        <FieldContent>
          <CommitInput
            value={state.gold}
            label="Gold"
            addon={
              <InputGroupAddon align="inline-end">
                <InputGroupText>max {state.maxGold}</InputGroupText>
              </InputGroupAddon>
            }
            onCommit={(text) => report(setGold({ payload: { gold: wholeNumber(text) } }))}
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldTitle className="flex items-center gap-2">
          <TextAaIcon />
          Dialogue Font Size
        </FieldTitle>
        <FieldContent>
          <ButtonGroup aria-label="Adjust dialogue font size">
            <InputGroup className="min-w-0 flex-1">
              <InputGroupInput
                aria-label="Dialogue font size"
                inputMode="numeric"
                disabled={fontUnavailable !== undefined}
                value={state.dialogueFontSize}
                onChange={(event) => {
                  const value = Number.parseInt(event.currentTarget.value, 10)

                  if (!Number.isNaN(value)) {
                    void changeFontSize(value)
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>px</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <Button
              variant="outline"
              aria-label="Decrease dialogue font size"
              disabled={fontUnavailable !== undefined}
              onClick={() => changeFontSize(state.dialogueFontSize - 1)}
            >
              −
            </Button>
            <Button
              variant="outline"
              aria-label="Increase dialogue font size"
              disabled={fontUnavailable !== undefined}
              onClick={() => changeFontSize(state.dialogueFontSize + 1)}
            >
              +
            </Button>
          </ButtonGroup>
          {fontUnavailable === undefined ? null : (
            <div className="text-xs text-muted-foreground">Unavailable: {fontUnavailable}</div>
          )}
        </FieldContent>
      </Field>

      {state.gameId === undefined ? null : (
        <InGameTextSwitches gameId={state.gameId} unavailable={unavailable} />
      )}

      <Field>
        <FieldTitle>Character Speed</FieldTitle>
        <FieldContent className="gap-3">
          <Slider
            aria-label="Character speed"
            min={0}
            max={characterSpeeds.length - 1}
            step={1}
            disabled={speedUnavailable !== undefined}
            value={[speedIndex]}
            onValueChange={(value) => {
              const index = Array.isArray(value) ? (value[0] ?? speedIndex) : value
              const speed = characterSpeeds[Math.round(index)]

              if (speed !== undefined && speed !== state.characterSpeed) {
                void report(setSpeed({ payload: { speed } }))
              }
            }}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            {characterSpeeds.map((speed) => (
              <span key={speed}>{speed}×</span>
            ))}
          </div>
          {speedUnavailable === undefined ? null : (
            <div className="text-xs text-muted-foreground">Unavailable: {speedUnavailable}</div>
          )}
        </FieldContent>
      </Field>

      <div className="flex justify-end border-t pt-4">
        <Button variant="outline" onClick={() => report(reset({ payload: undefined }))}>
          Reset to original settings
        </Button>
      </div>
    </div>
  )
}
