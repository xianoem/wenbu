import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { CaretUpDownIcon, CheckIcon, PuzzlePieceIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { AsyncResult } from 'effect/reactivity'
import type { Plugin } from '#contract/Plugins'
import { SpeechModelId, speechModels } from '#contract/Subtitles'
import { screenAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { pluginMarks } from '../plugins/pluginMarks'
import { installPluginAtom, pluginsAtom } from '../plugins/plugins'

const isReady = (plugin: Plugin | undefined) => plugin?.installed?.test.passed === true

function ModelMark({ id, small }: { readonly id: SpeechModelId; readonly small?: boolean }) {
  const { Icon, className } = pluginMarks[id]

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center',
        small === true ? 'size-5 rounded-md' : 'size-7 rounded-lg',
        className,
      )}
    >
      <Icon className={small === true ? 'size-3' : 'size-4'} />
    </span>
  )
}

function ModelText({ id, detail }: { readonly id: SpeechModelId; readonly detail: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-medium">{speechModels[id].name}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  )
}

const installLabel = (plugin: Plugin | undefined) => {
  if (plugin?.install?.running === true) {
    return 'Installing'
  }

  if (plugin?.install?.error !== undefined || plugin?.installed !== undefined) {
    return 'Fix'
  }

  return 'Install'
}

export function SpeechModelMenu({
  value,
  onChange,
}: {
  readonly value: SpeechModelId
  readonly onChange: (model: SpeechModelId) => void
}) {
  const result = useAtomValue(pluginsAtom)
  const install = useAtomSet(installPluginAtom)
  const setScreen = useAtomSet(screenAtom)
  const plugins = AsyncResult.isSuccess(result) ? result.value.plugins : []
  const pluginOf = (id: SpeechModelId) => plugins.find((plugin) => plugin.id === id)
  const installed = SpeechModelId.literals.filter((id) => isReady(pluginOf(id)))
  const more = SpeechModelId.literals.filter((id) => !isReady(pluginOf(id)))

  const installModel = (id: SpeechModelId) => {
    if (pluginOf(id)?.install?.running !== true) {
      install({ payload: { id } })
    }

    setScreen('plugins')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label="Speech model"
            className="h-9 w-64 justify-start gap-2 rounded-full px-3 font-normal"
          />
        }
      >
        <ModelMark id={value} small />
        <span className="flex-1 truncate text-left">{speechModels[value].name}</span>
        <CaretUpDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        {installed.length === 0 ? null : (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Installed</DropdownMenuLabel>
            {installed.map((id) => (
              <DropdownMenuItem key={id} className="gap-2.5" onClick={() => onChange(id)}>
                <ModelMark id={id} />
                <ModelText id={id} detail={speechModels[id].strength} />
                {id === value ? <CheckIcon /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {installed.length === 0 || more.length === 0 ? null : <DropdownMenuSeparator />}
        {more.length === 0 ? null : (
          <DropdownMenuGroup>
            <DropdownMenuLabel>More models</DropdownMenuLabel>
            {more.map((id) => (
              <DropdownMenuItem key={id} className="gap-2.5" onClick={() => installModel(id)}>
                <ModelMark id={id} />
                <ModelText
                  id={id}
                  detail={`${speechModels[id].strength} · ${speechModels[id].download}`}
                />
                <span className="rounded-full bg-foreground/7 px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                  {installLabel(pluginOf(id))}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2.5 text-muted-foreground"
          onClick={() => setScreen('plugins')}
        >
          <span className="grid size-7 place-items-center">
            <PuzzlePieceIcon />
          </span>
          Manage in Plugins
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
