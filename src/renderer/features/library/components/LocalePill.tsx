import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { CaretDownIcon, GlobeHemisphereEastIcon } from '@phosphor-icons/react'
import { Schema } from 'effect'
import { type Game, GameLocale, localeLabels, startLocaleOf } from '#contract/Library'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { isPluginReady, pluginsAtom } from '../../plugins/plugins'
import { libraryKeys, setLaunchLocaleAtom } from '../library'

const isGameLocale = Schema.is(GameLocale)

export const automaticHint = (game: Game, lunaHookReady: boolean) => {
  if (!game.needsJapaneseLocale) {
    return 'Starts in the system locale.'
  }

  return lunaHookReady
    ? 'Made for Japanese Windows. Starts with Ntleas.'
    : 'Made for Japanese Windows. Install LunaHook from Plugins to start it in Japanese.'
}

export function LocalePill({
  game,
  className,
  onError,
}: {
  readonly game: Game
  readonly className: string
  readonly onError: (message: string | undefined) => void
}) {
  const setLocale = useAtomSet(setLaunchLocaleAtom, { mode: 'promiseExit' })
  const lunaHookReady = isPluginReady(useAtomValue(pluginsAtom), 'luna-hook')
  const japanese = startLocaleOf(game, lunaHookReady) !== 'system'
  const waitingForPlugin = game.locale === 'auto' && game.needsJapaneseLocale && !lunaHookReady

  const choose = async (locale: GameLocale) => {
    const exit = await setLocale({ payload: { id: game.id, locale }, reactivityKeys: libraryKeys })

    onError(formErrorOf(exit)?.message)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={japanese ? `${className} bg-white/22` : `${className} px-3`}
            aria-label={`Launch locale: ${japanese ? 'Japanese' : 'system'}`}
          >
            <GlobeHemisphereEastIcon />
            {japanese ? 'Japanese' : null}
            {waitingForPlugin ? <span className="size-2 rounded-full bg-warning" /> : null}
            <CaretDownIcon className="size-3.5 opacity-70" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80 rounded-2xl p-1.5">
        <DropdownMenuRadioGroup
          value={game.locale}
          onValueChange={(value) => (isGameLocale(value) ? void choose(value) : undefined)}
        >
          <DropdownMenuRadioItem value="auto" className="items-start rounded-[10px] px-2.5 py-2">
            <div>
              <div className="font-medium">{localeLabels.auto}</div>
              <div className="text-[12.5px] text-muted-foreground">
                {automaticHint(game, lunaHookReady)}
              </div>
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="rounded-[10px] px-2.5 py-2">
            {localeLabels.system}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="ntleas"
            disabled={!lunaHookReady}
            className="rounded-[10px] px-2.5 py-2"
          >
            {localeLabels.ntleas}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="locale-remulator"
            disabled={!lunaHookReady}
            className="rounded-[10px] px-2.5 py-2"
          >
            {localeLabels['locale-remulator']}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
