import { useAtomSet } from '@effect/atom-react'
import { UserIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Exit } from 'effect'
import { useState } from 'react'
import type { Actor, ActorSummary } from '#contract/LiveControls'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Field, FieldContent, FieldTitle } from '#ui/field'
import { ScrollArea } from '#ui/scroll-area'
import { useLiveList } from '../hooks/useLiveList'
import { getActorAtom, listActorsAtom, setActorStatAtom } from '../liveControls'
import { CommitInput, wholeNumber } from './CommitInput'
import { LiveList } from './LiveList'

const actorRowHeight = 58

const nickname = (actor: ActorSummary) => (actor.nickname === '' ? '' : ` - ${actor.nickname}`)

const matches = (actor: ActorSummary, query: string) =>
  actor.name.toLowerCase().includes(query) ||
  actor.nickname.toLowerCase().includes(query) ||
  String(actor.id).includes(query)

type ActorStatus = 'idle' | 'loading' | 'failed'

export function ActorsTab() {
  const listActors = useAtomSet(listActorsAtom, { mode: 'promiseExit' })
  const getActor = useAtomSet(getActorAtom, { mode: 'promiseExit' })
  const setActorStat = useAtomSet(setActorStatAtom, { mode: 'promiseExit' })
  const list = useLiveList(listActors, (left, right) => left.id === right.id)
  const [selected, setSelected] = useState<Actor | undefined>(undefined)
  const [status, setStatus] = useState<ActorStatus>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  const show = (exit: Exit.Exit<Actor, unknown>) => {
    if (Exit.isSuccess(exit)) {
      setSelected(exit.value)
      setStatus('idle')
      setError(undefined)

      return
    }

    setStatus('failed')
    setError(formErrorOf(exit)?.message)
  }

  const select = async (actorId: number) => {
    setStatus('loading')
    show(await getActor({ payload: { actorId } }))
  }

  const commit = async (actorId: number, key: string, value: number) => {
    setStatus('loading')
    show(await setActorStat({ payload: { actorId, key, value } }))
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(220px,0.9fr)_minmax(280px,1.1fr)] gap-3 p-4">
      <LiveList
        items={list.items}
        status={list.status}
        error={list.error}
        noun="actors"
        rowHeight={actorRowHeight}
        matches={matches}
        rowKey={(actor) => String(actor.id)}
        renderRow={(actor) => (
          <Button
            variant="ghost"
            aria-label={`Edit ${actor.name}`}
            className={cn(
              'h-full w-full justify-start gap-3 rounded-lg px-3 text-left',
              selected?.id === actor.id && 'bg-muted text-foreground',
            )}
            onClick={() => select(actor.id)}
          >
            <UserIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{actor.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                #{actor.id}
                {nickname(actor)}
              </span>
            </span>
          </Button>
        )}
      />

      <ScrollArea className="h-full min-h-0 rounded-xl border bg-card">
        <section className="p-4">
          {selected === undefined ? (
            <div className="flex min-h-72 items-center justify-center text-center text-sm text-muted-foreground">
              {error ?? 'Select an actor to edit live values.'}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold">{selected.name}</div>
                <div className="text-xs text-muted-foreground">
                  Actor #{selected.id}
                  {nickname(selected)}
                </div>
              </div>
              <div className="flex items-center justify-between border-y py-2">
                <div className="text-sm font-medium">Actor Values</div>
                <div className="text-xs text-muted-foreground">
                  {status === 'loading' ? 'Applying...' : 'Enter applies'}
                </div>
              </div>
              {error !== undefined && status === 'failed' ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                  {error}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                {selected.stats.map((stat) => (
                  <Field key={stat.key} className="gap-1.5">
                    <FieldTitle className="text-xs">{stat.label}</FieldTitle>
                    <FieldContent>
                      <CommitInput
                        value={stat.value}
                        label={`Actor ${stat.label}`}
                        onCommit={(text) => commit(selected.id, stat.key, wholeNumber(text))}
                      />
                    </FieldContent>
                  </Field>
                ))}
              </div>
            </div>
          )}
        </section>
      </ScrollArea>
    </div>
  )
}
