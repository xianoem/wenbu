import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  ArrowUpIcon,
  ChatCircleTextIcon,
  CheckIcon,
  CopyIcon,
  PushPinIcon,
  SparkleIcon,
  SpeakerHighIcon,
  StopIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OpenGeneralSettings } from '#contract/Background'
import { isTyping } from '#lib/isTyping'
import { Button } from '#ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '#ui/input-group'
import { ScrollArea } from '#ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Skeleton } from '#ui/skeleton'
import logo from '../../../../build/icon.png'
import { useApplyTheme } from '../appearance/appearance'
import { llmSettingsAtom, useLlmSettings } from '../settings/llm'
import { OriginalText } from './components/OriginalText'
import { ReplyText } from './components/ReplyText'
import {
  explainQuestion,
  type QuickState,
  quickTranslateKeys,
  quickTranslateSettingsAtom,
  saveQuickTranslateSettingsAtom,
  useQuickTranslation,
} from './quickTranslate'

const followDistance = 80

const popupParts = '[role="listbox"], [role="option"], [role="menu"]'

const inPopup = (target: EventTarget | null) =>
  target instanceof Element && target.closest(popupParts) !== null

const onControl = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(`button, a, [role="combobox"], ${popupParts}`) !== null

function Kbd({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-foreground/[0.07] px-1.5 font-sans text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  )
}

function Hint({ keys, label }: { readonly keys: string; readonly label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <Kbd>{keys}</Kbd>
      {label}
    </span>
  )
}

function LanguagePill({ state }: { readonly state: QuickState }) {
  if (state.language === undefined) {
    return state.translating ? (
      <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs font-medium text-muted-foreground">
        Detecting language
      </span>
    ) : null
  }

  if (state.language.toLowerCase() === 'english') {
    return (
      <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs font-medium">
        Already English
      </span>
    )
  }

  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs font-medium">
      {state.language}
      <span className="font-normal text-muted-foreground">detected</span>
      <ArrowRightIcon className="size-3" />
      English
    </span>
  )
}

const noPreset = 'none'

function PresetPicker({ onPicked }: { readonly onPicked: () => void }) {
  const settings = useAtomValue(quickTranslateSettingsAtom)
  const llm = useLlmSettings()
  const save = useAtomSet(saveQuickTranslateSettingsAtom, { mode: 'promiseExit' })
  const presets = AsyncResult.isSuccess(llm) ? llm.value.presets : []

  if (!AsyncResult.isSuccess(settings)) {
    return null
  }

  const saved = settings.value

  const pick = (value: string | null) => {
    if (value === null || value === noPreset || value === saved.presetId) {
      return
    }

    void save({ payload: { ...saved, presetId: value }, reactivityKeys: quickTranslateKeys }).then(
      onPicked,
    )
  }

  return (
    <Select
      items={{
        [noPreset]: 'Choose a model',
        ...Object.fromEntries(presets.map((preset) => [preset.id, preset.name])),
      }}
      value={saved.presetId === '' ? noPreset : saved.presetId}
      onValueChange={pick}
    >
      <SelectTrigger
        aria-label="Quick Translate model"
        className="app-no-drag h-6 gap-1 rounded-full border-0 bg-transparent px-2 text-xs text-muted-foreground hover:text-foreground dark:bg-transparent"
      >
        <SparkleIcon className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="app-no-drag">
        {presets.map((preset) => (
          <SelectItem key={preset.id} value={preset.id}>
            {preset.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Problem({
  message,
  needsModel,
  onRetry,
}: {
  readonly message: string
  readonly needsModel: boolean
  readonly onRetry: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3 text-[13.5px]">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex flex-1 flex-col gap-2">
        <p>{message}</p>
        {needsModel ? (
          <Button
            size="sm"
            className="w-fit rounded-full px-3"
            onClick={() => window.wenbu.openApp(OpenGeneralSettings.make({}))}
          >
            Open settings
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="w-fit rounded-full px-3"
            onClick={onRetry}
          >
            <ArrowsClockwiseIcon />
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}

function TranslationText({ state }: { readonly state: QuickState }) {
  if (state.translation === '' && state.translating) {
    return (
      <div className="flex flex-col gap-2.5 pt-1.5 pb-1">
        <Skeleton className="h-4 w-11/12 rounded-full" />
        <Skeleton className="h-4 w-4/5 rounded-full" />
        <Skeleton className="h-4 w-2/5 rounded-full" />
      </div>
    )
  }

  return (
    <p className="text-[18px] leading-[1.6] font-medium tracking-[-0.005em] whitespace-pre-wrap select-text">
      {state.translation.trim()}
    </p>
  )
}

function Conversation({ state }: { readonly state: QuickState }) {
  const last = state.turns.at(-1)
  const waiting = state.answering && last?.role === 'user'

  return (
    <div className="mt-5 flex flex-col gap-3.5">
      {state.turns.map((turn) =>
        turn.role === 'user' ? (
          <div
            key={turn.id}
            className="max-w-[78%] self-end rounded-[16px_16px_4px_16px] bg-secondary px-3.5 py-2 text-[13.5px] leading-normal select-text"
          >
            {turn.label ?? turn.text}
          </div>
        ) : (
          <ReplyText key={turn.id} text={turn.text} />
        ),
      )}
      {waiting ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-3/4 rounded-full" />
          <Skeleton className="h-3.5 w-1/2 rounded-full" />
        </div>
      ) : null}
    </div>
  )
}

function useCopy() {
  const [copied, setCopied] = useState(false)

  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })

  return { copied, copy }
}

function useSpeech() {
  const [speaking, setSpeaking] = useState(false)

  const stop = () => {
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  const speak = (text: string) => {
    if (speaking) {
      stop()

      return
    }

    const utterance = new SpeechSynthesisUtterance(text)

    utterance.lang = 'en-US'
    utterance.addEventListener('end', () => setSpeaking(false))
    utterance.addEventListener('error', () => setSpeaking(false))
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  return { speaking, speak, stop }
}

export function QuickTranslateCard() {
  useApplyTheme()

  const { state, translate, ask, retry, stop } = useQuickTranslation()
  const refreshSettings = useAtomRefresh(quickTranslateSettingsAtom)
  const refreshLlm = useAtomRefresh(llmSettingsAtom)
  const root = useRef<HTMLDivElement | null>(null)
  const viewport = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const [opened, setOpened] = useState(0)
  const [asking, setAsking] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [question, setQuestion] = useState('')
  const { copied, copy } = useCopy()
  const speech = useSpeech()
  const turnCount = useRef(0)

  const ready = state.translation.trim() !== '' && !state.translating
  const talking = asking || state.turns.length > 0
  const translation = state.translation.trim()

  useEffect(
    () =>
      window.wenbu.onQuickTranslate((shown) => {
        refreshSettings()
        refreshLlm()
        setAsking(false)
        setPinned(false)
        setQuestion('')
        translate(shown.id, shown.text)
        setOpened((count) => count + 1)
      }),
    [refreshLlm, refreshSettings, translate],
  )

  useLayoutEffect(() => {
    if (opened > 0 && root.current !== null) {
      viewport.current?.scrollTo({ top: 0 })
      window.wenbu.resizeQuickTranslate(root.current.offsetHeight)
    }
  }, [opened])

  useEffect(() => {
    const element = root.current

    if (element === null) {
      return
    }

    const observer = new ResizeObserver(() =>
      window.wenbu.resizeQuickTranslate(element.offsetHeight),
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const changed = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        window.speechSynthesis.cancel()

        return
      }

      requestAnimationFrame(() => requestAnimationFrame(() => window.wenbu.quickTranslatePainted()))
    }

    document.addEventListener('visibilitychange', changed)

    return () => document.removeEventListener('visibilitychange', changed)
  }, [stop])

  useEffect(() => {
    const element = viewport.current
    const asked = state.turns.length > turnCount.current && state.turns.at(-1)?.role === 'user'

    turnCount.current = state.turns.length

    if (element === null || state.turns.length === 0) {
      return
    }

    const nearEnd = element.scrollHeight - element.scrollTop - element.clientHeight < followDistance

    if (asked || nearEnd) {
      element.scrollTo({ top: element.scrollHeight })
    }
  }, [state.turns])

  const startAsking = () => {
    setAsking(true)
    requestAnimationFrame(() => input.current?.focus())
  }

  const pin = () => {
    const next = !pinned

    setPinned(next)
    window.wenbu.pinQuickTranslate(next)
  }

  const send = (event: FormEvent) => {
    event.preventDefault()

    if (question.trim() === '' || state.answering) {
      return
    }

    ask(question)
    setQuestion('')
  }

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!inPopup(event.target)) {
          window.wenbu.hideQuickTranslate()
        }

        return
      }

      if (isTyping(event.target) || onControl(event.target)) {
        return
      }

      if (event.key === 'Enter' && ready) {
        copy(translation)

        return
      }

      if (event.key === 'Tab' && ready) {
        event.preventDefault()
        startAsking()
      }
    }

    window.addEventListener('keydown', keyDown)

    return () => window.removeEventListener('keydown', keyDown)
  })

  return (
    <div ref={root} className="p-4">
      <div className="flex w-[740px] flex-col overflow-hidden rounded-[20px] bg-popover text-popover-foreground shadow-[0_24px_48px_-12px_rgb(0_0_0/0.6),0_8px_16px_-8px_rgb(0_0_0/0.5),0_0_0_1px_oklch(1_0_0/0.08)]">
        <header className="app-drag flex shrink-0 items-center justify-between gap-2 px-3.5 pt-3.5 pb-2.5 pl-[18px] select-none">
          <div className="flex min-w-0 items-center gap-2">
            <img src={logo} alt="" className="size-[22px] rounded-[7px]" />
            <LanguagePill state={state} />
            <PresetPicker onPicked={retry} />
          </div>
          <div className="app-no-drag flex items-center gap-1">
            {talking ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy the translation"
                className="rounded-full text-muted-foreground"
                disabled={!ready}
                onClick={() => copy(translation)}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={pinned ? 'Unpin' : 'Pin open'}
              aria-pressed={pinned}
              className={cn(
                'rounded-full text-muted-foreground',
                pinned && 'bg-secondary text-foreground',
              )}
              onClick={pin}
            >
              <PushPinIcon weight={pinned ? 'fill' : 'regular'} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="rounded-full text-muted-foreground"
              onClick={() => window.wenbu.hideQuickTranslate()}
            >
              <XIcon />
            </Button>
          </div>
        </header>

        <ScrollArea viewport={{ ref: viewport, className: 'max-h-[476px]' }}>
          <div className="px-[22px] pt-1 pb-[18px] pr-[30px]">
            <TranslationText state={state} />
            {state.text.trim() === '' ? null : <OriginalText text={state.text} />}
            {state.turns.length > 0 ? <Conversation state={state} /> : null}
            {state.problem === undefined ? null : (
              <div className="mt-4">
                <Problem
                  message={state.problem.message}
                  needsModel={state.problem.needsModel}
                  onRetry={retry}
                />
              </div>
            )}
          </div>
        </ScrollArea>

        <footer className="app-drag flex shrink-0 items-center justify-between gap-2.5 border-t border-border px-3.5 pt-3 pb-3.5 select-none">
          {talking ? (
            <form className="flex flex-1 items-center gap-2.5" onSubmit={send}>
              <InputGroup className="app-no-drag h-[38px] flex-1 rounded-full pl-2">
                <InputGroupInput
                  ref={input}
                  value={question}
                  placeholder="Ask about this text…"
                  aria-label="Ask about this text"
                  onChange={(event) => setQuestion(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="submit"
                    size="icon-xs"
                    variant="default"
                    aria-label="Ask"
                    className="size-7 rounded-full"
                    disabled={question.trim() === '' || state.answering}
                  >
                    <ArrowUpIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <Hint keys="Esc" />
            </form>
          ) : (
            <>
              <div className="app-no-drag flex items-center gap-1.5">
                <Button
                  size="sm"
                  className="rounded-full px-3"
                  disabled={!ready}
                  onClick={() => copy(translation)}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full px-3"
                  disabled={!ready}
                  onClick={() => ask(explainQuestion, 'Explain')}
                >
                  <SparkleIcon />
                  Explain
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full px-3"
                  disabled={!ready}
                  onClick={startAsking}
                >
                  <ChatCircleTextIcon />
                  Ask
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full px-3"
                  disabled={!ready}
                  onClick={() => speech.speak(translation)}
                >
                  {speech.speaking ? <StopIcon /> : <SpeakerHighIcon />}
                  {speech.speaking ? 'Stop' : 'Listen'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full px-3 text-muted-foreground"
                  disabled={state.translating}
                  onClick={retry}
                >
                  <ArrowsClockwiseIcon />
                  Again
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <Hint keys="Enter" label="Copy" />
                <Hint keys="Tab" label="Ask" />
                <Hint keys="Esc" />
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
