import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { PlayIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Exit, Option } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useState } from 'react'
import type { Game, GameProgram } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { RadioGroup, RadioGroupItem } from '#ui/radio-group'
import {
  dismissLaunchProblemAtom,
  formatBytes,
  launchGameAtom,
  launchProblemAtom,
  libraryKeys,
  setGameProgramAtom,
} from '../library'
import { ToolPill } from './ProgramField'

const secondsLabel = (seconds: number) => (seconds === 1 ? '1 second' : `${seconds} seconds`)

function ProgramRow({
  program,
  note,
}: {
  readonly program: GameProgram
  readonly note: 'suggested' | 'current'
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 has-data-checked:bg-muted">
      <RadioGroupItem value={program.path} />
      <span className="truncate">{program.name}</span>
      {program.tool ? <ToolPill /> : null}
      {note === 'suggested' ? (
        <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-success/12 px-2 text-[11.5px] font-medium text-success">
          <span className="size-1.5 rounded-full bg-current" />
          Likely the game
        </span>
      ) : (
        <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11.5px] font-medium text-muted-foreground">
          Current
        </span>
      )}
      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        {program.sizeBytes > 0 ? formatBytes(program.sizeBytes) : null}
      </span>
    </label>
  )
}

/** Shown only when the last start closed almost at once, or started a tool. */
export function LaunchProblemCard({ game }: { readonly game: Game }) {
  const result = useAtomValue(launchProblemAtom(game.id))
  const setProgram = useAtomSet(setGameProgramAtom, { mode: 'promiseExit' })
  const launch = useAtomSet(launchGameAtom, { mode: 'promiseExit' })
  const dismiss = useAtomSet(dismissLaunchProblemAtom)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  if (!AsyncResult.isSuccess(result) || Option.isNone(result.value)) {
    return null
  }

  const { seconds, program, suggestion } = result.value.value
  const picked = chosen === program.path ? program : suggestion

  const play = async () => {
    if (picked.path !== game.executablePath) {
      const changed = await setProgram({
        payload: { id: game.id, path: picked.path },
        reactivityKeys: libraryKeys,
      })

      if (Exit.isFailure(changed)) {
        setError(formErrorOf(changed)?.message)

        return
      }
    }

    const started = await launch({ payload: { id: game.id }, reactivityKeys: libraryKeys })

    setError(formErrorOf(started)?.message)
  }

  const chooseFile = async () => {
    const file = await window.wenbu.chooseProgram(game.folderPath)

    if (file === undefined) {
      return
    }

    const changed = await setProgram({
      payload: { id: game.id, path: file },
      reactivityKeys: libraryKeys,
    })

    setError(formErrorOf(changed)?.message)
  }

  return (
    <section className="mt-6 flex gap-3.5 rounded-3xl bg-card p-5 shadow-card">
      <WarningCircleIcon className="mt-0.5 size-[22px] shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">The game closed {secondsLabel(seconds)} after it started</h3>
        <p className="mt-1 text-muted-foreground">
          Wenbu started <span className="font-medium text-foreground">{program.name}</span>
          {program.tool
            ? ", which looks like one of the game's tools."
            : ', which may not be the program that runs the game.'}{' '}
          Pick the program that runs the game.
        </p>

        <RadioGroup
          value={picked.path}
          onValueChange={(value) => setChosen(String(value))}
          className="mt-3.5 gap-1"
        >
          <ProgramRow program={suggestion} note="suggested" />
          <ProgramRow program={program} note="current" />
        </RadioGroup>

        {error === undefined ? null : <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-3.5 flex flex-wrap gap-2">
          <Button className="h-9 rounded-full px-4" onClick={() => void play()}>
            <PlayIcon weight="fill" />
            {picked === suggestion ? `Use ${suggestion.name} and play` : 'Play again'}
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-full px-4"
            onClick={() => void chooseFile()}
          >
            Choose another file…
          </Button>
          <Button
            variant="ghost"
            className="h-9 rounded-full px-4 text-muted-foreground"
            onClick={() => dismiss({ payload: { id: game.id } })}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </section>
  )
}
