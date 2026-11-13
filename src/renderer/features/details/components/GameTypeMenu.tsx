import { useAtomSet } from '@effect/atom-react'
import { GameControllerIcon } from '@phosphor-icons/react'
import { GameType } from '#contract/Details'
import { Button } from '#ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { dlsiteListKeys, setFilterAtom, workTypeLabels } from '../details'
import { PickRow } from './TagMenu'

export function GameTypeMenu({ chosen }: { readonly chosen: ReadonlyArray<GameType> }) {
  const setFilter = useAtomSet(setFilterAtom, { mode: 'promiseExit' })

  const toggle = (type: GameType) =>
    setFilter({
      payload: { target: { gameType: type }, chosen: !chosen.includes(type) },
      reactivityKeys: dlsiteListKeys,
    })

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="secondary" size="sm" className="h-8 rounded-full px-3">
            <GameControllerIcon />
            {chosen.length === 0 ? 'Game types' : `Game types · ${chosen.length}`}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-[260px] rounded-[20px] p-4">
        <div className="font-semibold">Game types</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Only games of the types you pick are shown. Pick none to show every type.
        </p>
        <div className="mt-2">
          {GameType.literals.map((type) => (
            <PickRow
              key={type}
              label={workTypeLabels[type]}
              chosen={chosen.includes(type)}
              onToggle={() => void toggle(type)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
