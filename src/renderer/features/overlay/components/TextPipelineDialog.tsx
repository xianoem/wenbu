import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Exit, Match } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useState } from 'react'
import {
  defaultTextPipeline,
  type DedupeCharacters,
  type DedupeWholeText,
  type KeepLines,
  type StringReplacement,
  type TextPipeline,
  type TextPipelineResult,
  type TextProcessor,
  type TextReplacementRule,
} from '#contract/TranslationOverlay'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import { Input } from '#ui/input'
import { ScrollArea } from '#ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Spinner } from '#ui/spinner'
import { Switch } from '#ui/switch'
import { Textarea } from '#ui/textarea'
import {
  overlayGameAtom,
  overlayGameKeys,
  previewTextPipelineAtom,
  resetTextPipelineAtom,
  saveTextPipelineAtom,
} from '../overlay'

interface ProcessorMeta {
  readonly title: string
  readonly description: string
}

const meta = (title: string, description: string): ProcessorMeta => ({ title, description })

const metaOf = (processor: TextProcessor): ProcessorMeta =>
  Match.valueTags(processor, {
    StringReplacement: () =>
      meta('String replacement', 'Replace literal text or regular-expression matches.'),
    RemoveNonShiftJis: () =>
      meta(
        'Remove non-Shift-JIS characters',
        'Discard characters that cannot round-trip through Shift-JIS.',
      ),
    RemoveControlCharacters: () =>
      meta(
        'Remove control characters',
        'Remove invisible control codes while preserving tabs and line breaks.',
      ),
    RemoveAsciiPunctuation: () =>
      meta('Remove ASCII punctuation', 'Remove Latin-style punctuation characters.'),
    KeepJapaneseQuotes: () =>
      meta('Keep Japanese quoted text', 'Keep text from the first 「 through the last 」.'),
    RemoveBraces: () =>
      meta(
        'Remove braces and furigana markup',
        'Strip common brace-based annotation and furigana formats.',
      ),
    KeepLines: () => meta('Keep lines', 'Keep a fixed number of lines from the start or end.'),
    DedupeCharacters: () =>
      meta(
        'Deduplicate repeated characters',
        'Collapse repeated glyph runs such as 響響響 into 響.',
      ),
    DedupeWholeText: () =>
      meta(
        'Deduplicate repeated whole text',
        'Collapse a complete sentence repeated multiple times.',
      ),
    DedupeVariableSegments: () =>
      meta(
        'Deduplicate variable segments',
        'Collapse adjacent repeated chunks whose lengths vary.',
      ),
    RecoverShrinkingSuffix: () =>
      meta(
        'Recover shrinking suffix redraws',
        'Recover text emitted as progressively shorter suffixes.',
      ),
    RecoverGrowingPrefix: () =>
      meta(
        'Recover growing prefix redraws',
        'Recover text emitted as progressively longer prefixes.',
      ),
    RemoveAngleTags: () =>
      meta('Remove angle-bracket tags', 'Strip HTML-like tags such as <name>.'),
    RemoveLineBreaks: () => meta('Remove line breaks', 'Join non-empty lines with spaces.'),
    RemoveNumbers: () => meta('Remove numbers', 'Remove ASCII digits.'),
    RemoveLatinLetters: () => meta('Remove Latin letters', 'Remove A–Z and a–z characters.'),
  })

const atLeastOne = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10)

  return Number.isNaN(parsed) ? fallback : Math.max(1, parsed)
}

function ReplacementRules({
  processor,
  onChange,
}: {
  readonly processor: StringReplacement
  readonly onChange: (processor: StringReplacement) => void
}) {
  const updateRule = (id: string, update: Partial<TextReplacementRule>) =>
    onChange({
      ...processor,
      rules: processor.rules.map((rule) => (rule.id === id ? { ...rule, ...update } : rule)),
    })

  return (
    <div className="space-y-2">
      {processor.rules.map((rule, position) => (
        <div key={rule.id} className="space-y-2 rounded-lg border border-border p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input
              aria-label={`Replacement ${position + 1} match`}
              value={rule.key}
              placeholder="Match"
              onChange={(event) => updateRule(rule.id, { key: event.currentTarget.value })}
            />
            <Input
              aria-label={`Replacement ${position + 1} value`}
              value={rule.value}
              placeholder="Replacement"
              onChange={(event) => updateRule(rule.id, { value: event.currentTarget.value })}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete replacement ${position + 1}`}
              onClick={() =>
                onChange({
                  ...processor,
                  rules: processor.rules.filter((candidate) => candidate.id !== rule.id),
                })
              }
            >
              <TrashIcon />
            </Button>
          </div>
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-2">
              <Switch
                checked={rule.regex}
                aria-label={`Replacement ${position + 1} regular expression`}
                onCheckedChange={(regex) => updateRule(rule.id, { regex })}
              />
              Regular expression
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={rule.escape}
                aria-label={`Replacement ${position + 1} decode escapes`}
                onCheckedChange={(escape) => updateRule(rule.id, { escape })}
              />
              Decode escapes
            </label>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          onChange({
            ...processor,
            rules: [
              ...processor.rules,
              { id: crypto.randomUUID(), regex: false, escape: false, key: '', value: '' },
            ],
          })
        }
      >
        <PlusIcon />
        Add replacement
      </Button>
    </div>
  )
}

function KeepLinesOptions({
  processor,
  onChange,
}: {
  readonly processor: KeepLines
  readonly onChange: (processor: KeepLines) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        type="number"
        min={1}
        aria-label="Line count"
        value={processor.count}
        onChange={(event) =>
          onChange({ ...processor, count: atLeastOne(event.currentTarget.value, 1) })
        }
      />
      <Select
        items={{ start: 'From start', end: 'From end' }}
        value={processor.from}
        onValueChange={(from) =>
          onChange({ ...processor, from: from === 'start' ? 'start' : 'end' })
        }
      >
        <SelectTrigger aria-label="Keep lines from">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="start">From start</SelectItem>
          <SelectItem value="end">From end</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function RepeatCount({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: number
  readonly onChange: (value: number) => void
}) {
  return (
    <label className="block max-w-52 space-y-1 text-xs">
      <span className="text-muted-foreground">Repeat count (1 = auto)</span>
      <Input
        type="number"
        min={1}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(atLeastOne(event.currentTarget.value, 1))}
      />
    </label>
  )
}

function DedupeCharactersOptions({
  processor,
  onChange,
}: {
  readonly processor: DedupeCharacters
  readonly onChange: (processor: DedupeCharacters) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <RepeatCount
        label="Character repeat count"
        value={processor.repeatCount}
        onChange={(repeatCount) => onChange({ ...processor, repeatCount })}
      />
      <label className="flex items-center gap-2 self-end rounded-lg border border-border px-3 py-2">
        <Switch
          checked={processor.preserveNonRepeated}
          aria-label="Preserve non-repeated characters"
          onCheckedChange={(preserveNonRepeated) => onChange({ ...processor, preserveNonRepeated })}
        />
        <span className="text-xs">Preserve non-repeated text</span>
      </label>
    </div>
  )
}

function DedupeWholeTextOptions({
  processor,
  onChange,
}: {
  readonly processor: DedupeWholeText
  readonly onChange: (processor: DedupeWholeText) => void
}) {
  return (
    <RepeatCount
      label="Whole text repeat count"
      value={processor.repeatCount}
      onChange={(repeatCount) => onChange({ ...processor, repeatCount })}
    />
  )
}

function ProcessorOptions({
  processor,
  onChange,
}: {
  readonly processor: TextProcessor
  readonly onChange: (processor: TextProcessor) => void
}) {
  return Match.value(processor).pipe(
    Match.tag('StringReplacement', (current) => (
      <ReplacementRules processor={current} onChange={onChange} />
    )),
    Match.tag('KeepLines', (current) => (
      <KeepLinesOptions processor={current} onChange={onChange} />
    )),
    Match.tag('DedupeCharacters', (current) => (
      <DedupeCharactersOptions processor={current} onChange={onChange} />
    )),
    Match.tag('DedupeWholeText', (current) => (
      <DedupeWholeTextOptions processor={current} onChange={onChange} />
    )),
    Match.orElse(() => null),
  )
}

const moved = (pipeline: TextPipeline, position: number, offset: -1 | 1): TextPipeline => {
  const target = position + offset
  const processors = [...pipeline.processors]
  const [processor] = processors.splice(position, 1)

  if (processor === undefined || target < 0 || target > processors.length) {
    return pipeline
  }

  processors.splice(target, 0, processor)

  return { processors }
}

const previewText = (preview: TextPipelineResult | undefined, previewing: boolean) => {
  if (preview !== undefined) {
    return preview.text
  }

  return previewing ? 'Processing…' : 'Enter sample text to preview.'
}

interface Preview {
  readonly draft: TextPipeline
  readonly sample: string
  readonly result: TextPipelineResult | undefined
}

function PipelineEditor({
  gameId,
  gameTitle,
  saved,
  initialText,
  onClose,
}: {
  readonly gameId: string
  readonly gameTitle: string
  readonly saved: TextPipeline
  readonly initialText: string
  readonly onClose: () => void
}) {
  const save = useAtomSet(saveTextPipelineAtom, { mode: 'promiseExit' })
  const reset = useAtomSet(resetTextPipelineAtom, { mode: 'promiseExit' })
  const runPreview = useAtomSet(previewTextPipelineAtom, { mode: 'promiseExit' })
  const [draft, setDraft] = useState(saved)
  const [sample, setSample] = useState(initialText)
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const enabledCount = draft.processors.filter((processor) => processor.enabled).length

  const previewing = preview?.draft !== draft || preview.sample !== sample
  const result = preview?.result

  useEffect(() => {
    let current = true

    void runPreview({ payload: { text: sample, pipeline: draft } }).then((exit) => {
      if (current) {
        setPreview({ draft, sample, result: Exit.isSuccess(exit) ? exit.value : undefined })
      }
    })

    return () => {
      current = false
    }
  }, [draft, sample, runPreview])

  const updateProcessor = (updated: TextProcessor) =>
    setDraft((pipeline) => ({
      processors: pipeline.processors.map((processor) =>
        processor.id === updated.id ? updated : processor,
      ),
    }))

  const submit = async () => {
    setSaving(true)

    const exit = await save({
      payload: { gameId, pipeline: draft },
      reactivityKeys: overlayGameKeys,
    })

    setSaving(false)
    setError(formErrorOf(exit)?.message)

    if (Exit.isSuccess(exit)) {
      onClose()
    }
  }

  const restoreDefaults = async () => {
    setDraft(defaultTextPipeline)

    setError(
      formErrorOf(await reset({ payload: { gameId }, reactivityKeys: overlayGameKeys }))?.message,
    )
  }

  const failedSteps = result?.steps.filter((step) => step.error !== undefined) ?? []

  return (
    <DialogContent className="flex max-h-[calc(100vh-2rem)] min-w-200 flex-col p-0">
      <DialogHeader className="px-5 pt-5">
        <DialogTitle>Text processing</DialogTitle>
        <DialogDescription>
          {gameTitle} · {enabledCount} enabled. Processors run from top to bottom before scoring,
          duplicate suppression, caching, and translation.
        </DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 gap-4 px-5 lg:grid-cols-[1.2fr_0.8fr]">
        <ScrollArea className="min-h-0 overflow-hidden rounded-xl border border-border">
          <div className="space-y-2 p-3">
            {draft.processors.map((processor, position) => {
              const { title, description } = metaOf(processor)

              return (
                <div key={processor.id} className="space-y-3 rounded-xl bg-muted/50 p-3">
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={processor.enabled}
                      aria-label={`Enable ${title}`}
                      onCheckedChange={(enabled) => updateProcessor({ ...processor, enabled })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{title}</div>
                      <div className="text-xs text-muted-foreground">{description}</div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Move ${title} up`}
                        disabled={position === 0}
                        onClick={() => setDraft((pipeline) => moved(pipeline, position, -1))}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Move ${title} down`}
                        disabled={position === draft.processors.length - 1}
                        onClick={() => setDraft((pipeline) => moved(pipeline, position, 1))}
                      >
                        <ArrowDownIcon />
                      </Button>
                    </div>
                  </div>
                  {processor.enabled ? (
                    <ProcessorOptions processor={processor} onChange={updateProcessor} />
                  ) : null}
                </div>
              )
            })}
          </div>
        </ScrollArea>

        <div className="flex min-h-0 flex-col gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium">Raw hook text</span>
            <Textarea
              value={sample}
              className="min-h-32 resize-y font-mono text-xs"
              onChange={(event) => setSample(event.currentTarget.value)}
            />
          </label>
          <div className="min-h-32 flex-1 rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium">
              Processed preview
              {previewing ? <Spinner data-icon="inline-end" /> : null}
            </div>
            <div className="text-sm whitespace-pre-wrap">{previewText(result, previewing)}</div>
            {failedSteps.length === 0 ? null : (
              <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-destructive">
                {failedSteps.map((step) => (
                  <div key={step.processorId}>
                    {step.processorId}: {step.error}
                  </div>
                ))}
              </div>
            )}
          </div>
          {error === undefined ? null : <div className="text-xs text-destructive">{error}</div>}
        </div>
      </div>

      <DialogFooter className="mx-0 mb-0">
        <Button variant="outline" disabled={saving} onClick={restoreDefaults}>
          Reset defaults
        </Button>
        <Button disabled={saving} onClick={submit}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Save for this game
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function TextPipelineDialog({
  gameId,
  gameTitle,
  initialText,
  onClose,
}: {
  readonly gameId: string
  readonly gameTitle: string
  readonly initialText: string
  readonly onClose: () => void
}) {
  const overlayGame = useAtomValue(overlayGameAtom(gameId))

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      {AsyncResult.isSuccess(overlayGame) ? (
        <PipelineEditor
          gameId={gameId}
          gameTitle={gameTitle}
          saved={overlayGame.value.pipeline}
          initialText={initialText}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  )
}
