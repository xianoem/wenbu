import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  DatabaseIcon,
  MapPinIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { useState } from 'react'
import type { GameFact, GuideAnswer, MapSketch } from '#contract/GameGuide'
import { Button } from '#ui/button'
import { CoinChip, FactRow } from './FactRow'
import { MapSketchView } from './MapSketchView'

const SKETCH_WIDTH = 460

export function RouteChips({ route }: { readonly route: ReadonlyArray<string> }) {
  if (route.length < 2) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="mr-1 text-muted-foreground">Route</span>
      {route.map((step, position) => {
        const last = position === route.length - 1

        return (
          <span key={step} className="inline-flex items-center gap-1">
            {position === 0 ? null : <CaretRightIcon className="size-3 text-muted-foreground" />}
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full px-2',
                last ? 'bg-tint-teal font-medium text-tint-teal-foreground' : 'bg-secondary',
              )}
            >
              {last ? <MapPinIcon weight="fill" className="size-3" /> : null}
              {step}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function SketchWithFacts({
  sketch,
  facts,
}: {
  readonly sketch: MapSketch | undefined
  readonly facts: ReadonlyArray<GameFact>
}) {
  return (
    <div className="flex flex-col gap-2">
      {sketch === undefined || sketch.width === 0 ? null : (
        <MapSketchView sketch={sketch} width={SKETCH_WIDTH} />
      )}
      {sketch === undefined ? null : <RouteChips route={sketch.route} />}
      <div className="-mx-2.5 flex flex-col">
        {facts.map((fact) => (
          <FactRow key={fact.id} fact={fact} />
        ))}
      </div>
    </div>
  )
}

const LIST_LINE = /^\s*[-•*]\s+/

function AnswerText({ text }: { readonly text: string }) {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim() !== '')

  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((block) => {
        const lines = block.split('\n')

        if (lines.every((line) => LIST_LINE.test(line))) {
          return (
            <ul
              key={block}
              className="flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground"
            >
              {lines.map((line) => (
                <li key={line}>{line.replace(LIST_LINE, '')}</li>
              ))}
            </ul>
          )
        }

        return (
          <p key={block} className="whitespace-pre-line">
            {block}
          </p>
        )
      })}
    </div>
  )
}

export function AnswerCard({
  answer,
  onAskAgain,
}: {
  readonly answer: GuideAnswer
  readonly onAskAgain?: (question: string) => void
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const count = answer.facts.length

  return (
    <section className="flex flex-col gap-3 rounded-[20px] bg-card p-4 shadow-card">
      <div>
        <div className="text-xs text-muted-foreground">You asked</div>
        <div className="text-sm font-medium">{answer.question}</div>
      </div>
      <AnswerText text={answer.text} />
      {sourcesOpen ? <SketchWithFacts sketch={answer.sketch} facts={answer.facts} /> : null}
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        {count === 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <DatabaseIcon className="size-3.5" />
            From the game's data
          </span>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            className="-ml-2 gap-1.5 font-normal text-muted-foreground"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            <DatabaseIcon className="size-3.5" />
            {count} {count === 1 ? 'source' : 'sources'}
            {sourcesOpen ? <CaretDownIcon /> : <CaretRightIcon />}
          </Button>
        )}
        <span>·</span>
        <span>
          {answer.modelName} · {answer.seconds.toFixed(1)} s
        </span>
        {answer.costUsd === undefined ? null : (
          <>
            <span>·</span>
            <CoinChip cost={answer.costUsd} />
          </>
        )}
        <span className="flex-1" />
        {onAskAgain === undefined ? null : (
          <Button variant="ghost" size="xs" onClick={() => onAskAgain(answer.question)}>
            <ArrowClockwiseIcon />
            Ask again
          </Button>
        )}
      </div>
    </section>
  )
}
