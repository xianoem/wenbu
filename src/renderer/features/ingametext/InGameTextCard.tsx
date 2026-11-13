import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { type Exit, Option } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import { type InGameTextSettings, defaultInGameTextSettings } from '#contract/InGameText'
import type { Game } from '#contract/Library'
import { type HookedControl, supportsLiveControls } from '#contract/LiveControls'
import { formErrorOf } from '#lib/forms'
import { inGameTextReviewAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Checkbox } from '#ui/checkbox'
import { Switch } from '#ui/switch'
import { liveControlsAtom } from '../livecontrols/liveControls'
import {
  inGameTextSettingsAtom,
  inGameTextSummaryAtom,
  saveInGameTextSettingsAtom,
  settingsKeys,
} from './inGameText'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function Row({
  title,
  description,
  checked,
  disabled = false,
  onCheckedChange,
  children,
}: {
  readonly title: string
  readonly description: React.ReactNode
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly children?: React.ReactNode
}) {
  return (
    <div className="border-t py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">{title}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        </div>
        <Switch
          aria-label={title}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {children}
    </div>
  )
}

export function InGameTextCard({ game }: { readonly game: Game }) {
  const settingsResult = useAtomValue(inGameTextSettingsAtom(game.id))
  const summaryResult = useAtomValue(inGameTextSummaryAtom(game.id))
  const live = useAtomValue(liveControlsAtom)
  const save = useAtomSet(saveInGameTextSettingsAtom, { mode: 'promiseExit' })
  const openReview = useAtomSet(inGameTextReviewAtom)
  const [error, setError] = useState<string | undefined>(undefined)

  if (!supportsLiveControls(game.engine)) {
    return null
  }

  const loaded = AsyncResult.isSuccess(settingsResult)
  const settings = loaded ? settingsResult.value : defaultInGameTextSettings
  const summary = AsyncResult.isSuccess(summaryResult) ? summaryResult.value : undefined
  const state = AsyncResult.isSuccess(live) ? Option.some(live.value) : Option.none()

  const unavailable = (control: HookedControl) =>
    Option.getOrUndefined(
      Option.flatMap(state, (current) =>
        current.gameId === game.id
          ? Option.fromNullishOr(
              current.unsupported.find((entry) => entry.control === control)?.reason,
            )
          : Option.none(),
      ),
    )

  const report = async (pending: Promise<Exit.Exit<unknown, unknown>>) =>
    setError(formErrorOf(await pending)?.message)

  const change = (next: Partial<InGameTextSettings>) =>
    report(
      save({
        payload: { gameId: game.id, settings: { ...settings, ...next } },
        reactivityKeys: settingsKeys(game.id),
      }),
    )

  const wrapUnavailable = unavailable('wordWrap')
  const menusUnavailable = unavailable('inGameText')

  const wrapDescription =
    wrapUnavailable === undefined
      ? 'Breaks lines between words, so you can keep a comfortable font size.'
      : `Unavailable: ${wrapUnavailable}`

  const menusDescription =
    menusUnavailable === undefined
      ? 'Text switches to its translation the first time the game shows it.'
      : `Unavailable: ${menusUnavailable}`

  return (
    <section className="mt-4 rounded-3xl bg-card p-5 shadow-card">
      <h2 className="text-[15px] font-semibold tracking-tight">In-game text</h2>
      <p className="mt-1.5 mb-2 text-muted-foreground">
        Menus and options the script translation can’t reach.
      </p>

      <Row
        title="Translate menus and UI while playing"
        description={menusDescription}
        checked={settings.uiText}
        disabled={!loaded}
        onCheckedChange={(uiText) => change({ uiText })}
      />
      <Row
        title="Wrap long dialogue lines"
        description={wrapDescription}
        checked={settings.wordWrap}
        disabled={!loaded}
        onCheckedChange={(wordWrap) => change({ wordWrap })}
      >
        {settings.wordWrap ? (
          <label className="mt-2.5 flex items-center gap-2 text-[13px] text-muted-foreground">
            <Checkbox
              checked={settings.reflow}
              onCheckedChange={(reflow) => change({ reflow: reflow === true })}
            />
            Reflow each message into one paragraph before wrapping
          </label>
        ) : null}
      </Row>

      {summary?.notice === undefined ? null : (
        <p className="border-t pt-3 text-[13px] text-warning">{summary.notice}</p>
      )}

      {error === undefined ? null : (
        <p className="border-t pt-3 text-[13px] text-destructive">{error}</p>
      )}

      {summary === undefined || summary.strings === 0 ? null : (
        <div className="flex items-center gap-3 border-t pt-3">
          <span className="flex-1 text-[13px] text-muted-foreground">
            {plural(summary.strings, 'string')}
            {summary.tooLong === 0 ? null : (
              <>
                {' · '}
                <span className="text-warning">{summary.tooLong} too long</span>
              </>
            )}
          </span>
          <Button
            variant="outline"
            className="h-8 rounded-full px-4"
            onClick={() => openReview(game.id)}
          >
            Review
          </Button>
        </div>
      )}
    </section>
  )
}
