import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CaretRightIcon,
  ChatTextIcon,
  FlagBannerIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  SwordIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import {
  defaultGuideSettings,
  type GameFact,
  type GuideHere,
  type GuideSettings,
} from '#contract/GameGuide'
import { Alert, AlertDescription, AlertTitle } from '#ui/alert'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '#ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Spinner } from '#ui/spinner'
import { useLlmSettings } from '../../settings/llm'
import {
  guideIndexAtom,
  guideSettingsAtom,
  guideSettingsKeys,
  saveGuideSettingsAtom,
} from '../guide'
import { type useGuideAsk, useGuideHere, useMapSketch } from '../hooks/useGuide'
import { AnswerCard, RouteChips, SketchWithFacts } from './AnswerCard'
import { FactRow } from './FactRow'

export type GuideView = 'answers' | 'around' | 'next' | 'picked'

type GuideConversation = ReturnType<typeof useGuideAsk>

const NEXT_QUESTION = 'What should I do next?'

const samePreset = '__translation__'

function GuideSettingsPopover({
  settings,
  onClear,
}: {
  readonly settings: GuideSettings
  readonly onClear: () => void
}) {
  const save = useAtomSet(saveGuideSettingsAtom)
  const llm = useLlmSettings()
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []

  const change = (patch: Partial<GuideSettings>) =>
    save({ payload: { settings: { ...settings, ...patch } }, reactivityKeys: guideSettingsKeys })

  return (
    <Popover>
      <PopoverTrigger render={<InputGroupButton size="icon-sm" aria-label="Game Guide settings" />}>
        <GearSixIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3 p-4">
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium">Game Guide</div>
          <div className="text-xs text-muted-foreground">
            The preset that answers your questions.
          </div>
        </div>
        <Select
          items={{
            [samePreset]: 'Same preset as translation',
            ...Object.fromEntries(presets.map((preset) => [preset.id, preset.name])),
          }}
          value={settings.presetId === '' ? samePreset : settings.presetId}
          onValueChange={(value) =>
            change({ presetId: value === null || value === samePreset ? '' : value })
          }
        >
          <SelectTrigger aria-label="Preset" className="h-9 w-full rounded-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={samePreset}>Same preset as translation</SelectItem>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="self-start rounded-full" onClick={onClear}>
          Clear the conversation
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function HereStrip({
  here,
  onAround,
  onNext,
}: {
  readonly here: GuideHere
  readonly onAround: () => void
  readonly onNext: () => void
}) {
  const next = here.next[0]

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-foreground/[0.035] px-3 py-2 text-[13px] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]">
      <Button
        variant="ghost"
        size="xs"
        className="min-w-0 gap-2 px-1 font-medium"
        onClick={onAround}
      >
        <span className="size-2 shrink-0 rounded-full bg-success shadow-[0_0_0_4px_oklch(0.78_0.14_150/0.15)]" />
        <span className="truncate">{here.mapName}</span>
        <span className="font-normal text-muted-foreground">
          {here.x}, {here.y}
        </span>
      </Button>
      <span className="flex-1" />
      {next === undefined ? null : (
        <Button variant="ghost" size="xs" className="min-w-0 gap-1.5 px-1" onClick={onNext}>
          <span className="text-muted-foreground">Next:</span>
          <span className="truncate font-medium">{next.summary}</span>
          <CaretRightIcon className="text-muted-foreground" />
        </Button>
      )}
    </div>
  )
}

function FactListCard({
  title,
  facts,
  empty,
  onBack,
  footer,
}: {
  readonly title: string
  readonly facts: ReadonlyArray<GameFact>
  readonly empty: string
  readonly onBack: () => void
  readonly footer?: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2 rounded-[20px] bg-card p-3 shadow-card">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to answers" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="text-sm font-medium">{title}</span>
      </div>
      {facts.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : null}
      {facts.map((fact) => (
        <FactRow key={fact.id} fact={fact} />
      ))}
      {footer}
    </section>
  )
}

function PickedCard({
  fact,
  onBack,
  onAsk,
}: {
  readonly fact: GameFact
  readonly onBack: () => void
  readonly onAsk: (question: string) => void
}) {
  const place = fact.place

  const target =
    place?.x === undefined || place.y === undefined ? undefined : { x: place.x, y: place.y }

  const sketch = useMapSketch(place?.mapId, target)

  return (
    <section className="flex flex-col gap-3 rounded-[20px] bg-card p-4 shadow-card">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to answers" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">Found in the game's data</div>
          <div className="truncate text-sm font-medium">{fact.subject?.name ?? fact.summary}</div>
        </div>
      </div>
      <SketchWithFacts sketch={sketch} facts={[fact]} />
      {sketch === undefined ? null : <RouteChips route={sketch.route} />}
      <Button
        variant="secondary"
        size="sm"
        className="self-start rounded-full"
        onClick={() => onAsk(`How do I get "${fact.subject?.name ?? fact.summary}"?`)}
      >
        Ask the guide how
      </Button>
    </section>
  )
}

function PendingCard({
  question,
  steps,
}: {
  readonly question: string
  readonly steps: ReadonlyArray<string>
}) {
  return (
    <section className="flex flex-col gap-2 rounded-[20px] bg-card p-4 shadow-card">
      <div className="text-xs text-muted-foreground">You asked</div>
      <div className="text-sm font-medium">{question}</div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        {steps.at(-1) ?? 'Thinking'}…
      </div>
    </section>
  )
}

function Suggestions({
  onAsk,
  onAround,
}: {
  readonly onAsk: (question: string) => void
  readonly onAround: () => void
}) {
  const chip = 'h-7 rounded-full border-input px-3 text-xs font-normal'

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button variant="outline" className={chip} onClick={() => onAsk(NEXT_QUESTION)}>
        <FlagBannerIcon />
        What do I do next?
      </Button>
      <Button variant="outline" className={chip} onClick={onAround}>
        <MapTrifoldIcon />
        What's on this map?
      </Button>
      <Button variant="outline" className={chip} onClick={() => onAsk('Who are the characters?')}>
        <UsersThreeIcon />
        Who are the characters?
      </Button>
      <Button
        variant="outline"
        className={chip}
        onClick={() => onAsk('Explain the dialogue I just saw.')}
      >
        <ChatTextIcon />
        Explain the last dialogue
      </Button>
    </div>
  )
}

function IndexNotice() {
  const index = useAtomValue(guideIndexAtom)

  if (!AsyncResult.isSuccess(index) || index.value.status === 'ready') {
    return null
  }

  if (index.value.status === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertTitle>The guide can't read this game</AlertTitle>
        <AlertDescription>{index.value.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Spinner className="size-3.5" />
      {index.value.message}
    </div>
  )
}

const reveal = (node: HTMLDivElement | null) => node?.scrollIntoView({ block: 'end' })

export function GuideTab({
  guide,
  view,
  onView: setView,
  picked,
  onFind,
}: {
  readonly guide: GuideConversation
  readonly view: GuideView
  readonly onView: (view: GuideView) => void
  readonly picked: GameFact | undefined
  readonly onFind: () => void
}) {
  const [draft, setDraft] = useState('')
  const settingsResult = useAtomValue(guideSettingsAtom)

  const settings = AsyncResult.isSuccess(settingsResult)
    ? settingsResult.value
    : defaultGuideSettings

  const { here, problem: hereProblem } = useGuideHere(true)
  const { answers, pending, problem, ask, clear } = guide

  const submit = (question: string) => {
    setView('answers')
    setDraft('')
    void ask(question)
  }

  const showSuggestions = answers.length === 0 && pending === undefined && view === 'answers'

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 px-4 pt-1 pb-4">
      <IndexNotice />
      {here === undefined ? null : (
        <HereStrip here={here} onAround={() => setView('around')} onNext={() => setView('next')} />
      )}
      {here !== undefined && here.enemies.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-2xl bg-tint-amber/40 p-2">
          <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-tint-amber-foreground">
            <SwordIcon className="size-3.5" />
            In battle
          </div>
          {here.enemies.map((enemy) => (
            <FactRow key={enemy.id} fact={enemy} showPlace={false} />
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,#000_16px)] pt-2">
        {view === 'around' ? (
          <FactListCard
            title={`On ${here?.mapName ?? 'this map'} now`}
            facts={here?.around ?? []}
            empty="Nothing here does anything right now."
            onBack={() => setView('answers')}
          />
        ) : null}
        {view === 'next' ? (
          <FactListCard
            title="What you can do next"
            facts={here?.next ?? []}
            empty="Wenbu found nothing obvious; ask the guide."
            onBack={() => setView('answers')}
            footer={
              <Button
                variant="secondary"
                size="sm"
                className="self-start rounded-full"
                onClick={() => submit(NEXT_QUESTION)}
              >
                Ask the guide to explain
              </Button>
            }
          />
        ) : null}
        {view === 'picked' && picked !== undefined ? (
          <PickedCard fact={picked} onBack={() => setView('answers')} onAsk={submit} />
        ) : null}
        {view === 'answers' ? (
          <>
            {showSuggestions ? (
              <div className="mt-auto flex flex-col gap-1 px-1 pb-1">
                <div className="text-sm font-medium">Ask about this game</div>
                <p className="text-xs text-muted-foreground">
                  Answers come from the game's own data and where you are now. Press Ctrl K to find
                  any item, person or place for free.
                </p>
              </div>
            ) : (
              <div className="flex-1" />
            )}
            {answers.map((answer, position) => (
              <div
                key={answer.id}
                ref={position === answers.length - 1 && pending === undefined ? reveal : undefined}
              >
                <AnswerCard answer={answer} onAskAgain={submit} />
              </div>
            ))}
            {pending === undefined ? null : (
              <div ref={reveal}>
                <PendingCard question={pending.question} steps={pending.steps} />
              </div>
            )}
          </>
        ) : null}
        {problem === undefined && hereProblem === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{problem ?? hereProblem}</AlertDescription>
          </Alert>
        )}
      </div>
      {showSuggestions ? <Suggestions onAsk={submit} onAround={() => setView('around')} /> : null}
      <InputGroup className="h-10 rounded-full pl-1.5">
        <InputGroupAddon>
          <InputGroupButton size="icon-sm" aria-label="Find in the game (Ctrl K)" onClick={onFind}>
            <MagnifyingGlassIcon />
          </InputGroupButton>
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Ask about the game"
          placeholder={answers.length === 0 ? 'Ask about this game…' : 'Ask a follow-up…'}
          value={draft}
          disabled={pending !== undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit(draft)
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <GuideSettingsPopover settings={settings} onClear={() => void clear()} />
          <InputGroupButton
            size="icon-sm"
            variant="default"
            className="rounded-full"
            aria-label="Ask"
            disabled={draft.trim() === '' || pending !== undefined}
            onClick={() => submit(draft)}
          >
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
