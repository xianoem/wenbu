import { useAtomSet } from '@effect/atom-react'
import { Exit } from 'effect'
import type { SwitchEntry, VariableEntry, VariableValue } from '#contract/LiveControls'
import { formErrorOf } from '#lib/forms'
import { Field, FieldContent, FieldTitle } from '#ui/field'
import { Switch } from '#ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { useLiveList } from '../hooks/useLiveList'
import {
  listSwitchesAtom,
  listVariablesAtom,
  setSwitchAtom,
  setVariableAtom,
} from '../liveControls'
import { CommitInput } from './CommitInput'
import { LiveList } from './LiveList'

const entryRowHeight = 58

export const parseVariableValue = (text: string): VariableValue => {
  const trimmed = text.trim()

  if (trimmed === 'true') {
    return true
  }

  if (trimmed === 'false') {
    return false
  }

  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : text
}

const describeValue = (kind: 'Switch' | 'Variable', value: VariableValue) => {
  if (kind === 'Variable') {
    return String(value)
  }

  return value === true ? 'On' : 'Off'
}

function EntryName({
  id,
  kind,
  name,
  value,
}: {
  readonly id: number
  readonly kind: 'Switch' | 'Variable'
  readonly name: string
  readonly value: VariableValue
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div className="truncate text-sm font-medium">{name === '' ? '—' : name}</div>}
      />
      <TooltipContent align="start">
        <span className="flex max-w-sm flex-col gap-0.5 whitespace-normal">
          <span className="font-medium break-words">{name}</span>
          <span className="text-muted-foreground">
            {kind} #{id} · {describeValue(kind, value)}
          </span>
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

const matches = (entry: SwitchEntry | VariableEntry, query: string) =>
  entry.name.toLowerCase().includes(query) || String(entry.id).includes(query)

const keyOf = (entry: SwitchEntry | VariableEntry) => String(entry.id)

function SwitchesPanel() {
  const listSwitches = useAtomSet(listSwitchesAtom, { mode: 'promiseExit' })
  const setSwitch = useAtomSet(setSwitchAtom, { mode: 'promiseExit' })
  const list = useLiveList(listSwitches, (left, right) => left.id === right.id)

  const change = async (entry: SwitchEntry, value: boolean) => {
    const exit = await setSwitch({ payload: { id: entry.id, value } })

    if (Exit.isSuccess(exit)) {
      list.replace(exit.value)

      return
    }

    list.setError(formErrorOf(exit)?.message)
  }

  return (
    <LiveList
      items={list.items}
      status={list.status}
      error={list.error}
      noun="switches"
      rowHeight={entryRowHeight}
      matches={matches}
      rowKey={keyOf}
      className="h-full min-w-0"
      renderRow={(entry) => (
        <div className="flex h-full items-center gap-3 rounded-lg px-3 hover:bg-muted/60">
          <div className="min-w-0 flex-1">
            <EntryName id={entry.id} kind="Switch" name={entry.name} value={entry.value} />
            <div className="text-xs text-muted-foreground">#{entry.id}</div>
          </div>
          <Switch
            aria-label={entry.name}
            checked={entry.value}
            onCheckedChange={(checked) => change(entry, checked)}
          />
        </div>
      )}
    />
  )
}

function VariablesPanel() {
  const listVariables = useAtomSet(listVariablesAtom, { mode: 'promiseExit' })
  const setVariable = useAtomSet(setVariableAtom, { mode: 'promiseExit' })
  const list = useLiveList(listVariables, (left, right) => left.id === right.id)

  const commit = async (entry: VariableEntry, text: string) => {
    const exit = await setVariable({ payload: { id: entry.id, value: parseVariableValue(text) } })

    if (Exit.isSuccess(exit)) {
      list.replace(exit.value)

      return
    }

    list.setError(formErrorOf(exit)?.message)
  }

  return (
    <LiveList
      items={list.items}
      status={list.status}
      error={list.error}
      noun="variables"
      rowHeight={entryRowHeight}
      matches={matches}
      rowKey={keyOf}
      className="h-full min-w-0"
      renderRow={(entry) => (
        <div className="flex h-full items-center gap-3 rounded-lg px-3 hover:bg-muted/60">
          <div className="min-w-0 flex-1">
            <EntryName id={entry.id} kind="Variable" name={entry.name} value={entry.value} />
            <div className="text-xs text-muted-foreground">#{entry.id}</div>
          </div>
          <Field className="w-44 shrink-0 gap-1">
            <FieldTitle className="sr-only">{entry.name} value</FieldTitle>
            <FieldContent>
              <CommitInput
                value={entry.value}
                label={`${entry.name} value`}
                numeric={false}
                onCommit={(text) => commit(entry, text)}
              />
            </FieldContent>
          </Field>
        </div>
      )}
    />
  )
}

export function SwitchesVariablesTab() {
  return (
    <Tabs defaultValue="switches" className="h-full min-h-0 p-4">
      <TabsList className="w-auto">
        <TabsTrigger value="switches">Switches</TabsTrigger>
        <TabsTrigger value="variables">Variables</TabsTrigger>
      </TabsList>
      <TabsContent value="switches" className="flex min-h-0 w-full overflow-hidden">
        <SwitchesPanel />
      </TabsContent>
      <TabsContent value="variables" className="flex min-h-0 w-full overflow-hidden">
        <VariablesPanel />
      </TabsContent>
    </Tabs>
  )
}
