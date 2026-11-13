import { useAtomSet } from '@effect/atom-react'
import { PackageIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import type { InventoryEntry, InventoryKind } from '#contract/LiveControls'
import { formErrorOf } from '#lib/forms'
import { Badge } from '#ui/badge'
import { Field, FieldContent, FieldTitle } from '#ui/field'
import { useLiveList } from '../hooks/useLiveList'
import { listInventoryAtom, setInventoryQuantityAtom } from '../liveControls'
import { CommitInput, wholeNumber } from './CommitInput'
import { LiveList } from './LiveList'

const inventoryRowHeight = 70

const kindLabels: Record<InventoryKind, string> = {
  item: 'Item',
  weapon: 'Weapon',
  armor: 'Armor',
}

const keyOf = (entry: InventoryEntry) => `${entry.kind}:${entry.id}`

const matches = (entry: InventoryEntry, query: string) =>
  entry.name.toLowerCase().includes(query) ||
  entry.kind.includes(query) ||
  String(entry.id).includes(query)

export function InventoryTab() {
  const listInventory = useAtomSet(listInventoryAtom, { mode: 'promiseExit' })
  const setQuantity = useAtomSet(setInventoryQuantityAtom, { mode: 'promiseExit' })
  const list = useLiveList(listInventory, (left, right) => keyOf(left) === keyOf(right))

  const commit = async (entry: InventoryEntry, quantity: number) => {
    const exit = await setQuantity({ payload: { kind: entry.kind, id: entry.id, quantity } })

    if (Exit.isSuccess(exit)) {
      list.replace(exit.value)
      list.setError(undefined)

      return
    }

    list.setError(formErrorOf(exit)?.message)
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      {list.error !== undefined && list.status !== 'failed' ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {list.error}
        </div>
      ) : null}
      <LiveList
        items={list.items}
        status={list.status}
        error={list.error}
        noun="inventory entries"
        rowHeight={inventoryRowHeight}
        matches={matches}
        rowKey={keyOf}
        renderRow={(entry) => (
          <div className="flex h-full items-center gap-3 rounded-lg px-3 hover:bg-muted/60">
            <PackageIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{entry.name}</span>
                <Badge variant="outline">{kindLabels[entry.kind]}</Badge>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                #{entry.id}
                {entry.description === '' ? '' : ` - ${entry.description}`}
              </div>
            </div>
            <Field className="w-24 gap-1">
              <FieldTitle className="sr-only">{entry.name} quantity</FieldTitle>
              <FieldContent>
                <CommitInput
                  value={entry.quantity}
                  label={`${entry.name} quantity`}
                  onCommit={(text) => commit(entry, wholeNumber(text))}
                />
              </FieldContent>
            </Field>
          </div>
        )}
      />
    </div>
  )
}
