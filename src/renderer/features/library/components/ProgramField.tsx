import { useAtomValue } from '@effect/atom-react'
import { FolderOpenIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import type { Game, GameProgram } from '#contract/Library'
import { Field, FieldError, FieldLabel } from '#ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '#ui/select'
import { formatBytes, gameProgramsAtom } from '../library'

const browse = 'choose-another-file'

export function ToolPill() {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-warning/12 px-2 text-[11.5px] font-medium text-warning">
      <span className="size-1.5 rounded-full bg-current" />
      Tool
    </span>
  )
}

const withChosen = (programs: ReadonlyArray<GameProgram>, chosen: string) =>
  programs.some((program) => program.path.toLowerCase() === chosen.toLowerCase())
    ? programs
    : [...programs, { path: chosen, name: chosen, sizeBytes: 0, tool: false }]

export function ProgramField({
  game,
  value,
  error,
  onChange,
}: {
  readonly game: Game
  readonly value: string
  readonly error: string | undefined
  readonly onChange: (path: string) => void
}) {
  const result = useAtomValue(gameProgramsAtom(game.id))
  const listed = AsyncResult.isSuccess(result) ? result.value : []
  const programs = withChosen(listed, value)
  const names = Object.fromEntries(programs.map((program) => [program.path, program.name]))

  const choose = async (picked: string | null) => {
    if (picked !== browse) {
      onChange(picked ?? value)

      return
    }

    const file = await window.wenbu.chooseProgram(game.folderPath)

    if (file !== undefined) {
      onChange(file)
    }
  }

  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel>Program</FieldLabel>
      <Select items={names} value={value} onValueChange={(picked) => void choose(picked)}>
        <SelectTrigger aria-label="Program" className="w-full">
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {programs.map((program) => (
            <SelectItem key={program.path} value={program.path}>
              <span className="truncate">{program.name}</span>
              {program.tool ? <ToolPill /> : null}
              {program.sizeBytes > 0 ? (
                <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(program.sizeBytes)}
                </span>
              ) : null}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={browse}>
            <FolderOpenIcon />
            Choose another file…
          </SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[12.5px] text-muted-foreground">
        Play and the Translation Overlay both start this file.
      </p>
      <FieldError>{error}</FieldError>
    </Field>
  )
}
