import { useAtomSet } from '@effect/atom-react'
import { DesktopIcon, type Icon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { Schema } from 'effect'
import { Appearance, Theme } from '#contract/Appearance'
import { Button } from '#ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#ui/dropdown-menu'
import { setAppearanceAtom, useTheme } from './appearance'

const themes = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: DesktopIcon },
] as const satisfies ReadonlyArray<{ value: Theme; label: string; Icon: Icon }>

const isTheme = Schema.is(Theme)

export function ThemeMenu() {
  const theme = useTheme()
  const setAppearance = useAtomSet(setAppearanceAtom)
  const current = themes.find((option) => option.value === theme) ?? themes[2]

  const choose = (value: string) => {
    if (isTheme(value)) {
      setAppearance({ payload: Appearance.make({ theme: value }), reactivityKeys: ['appearance'] })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Theme: ${current.label}`}
            title="Theme"
            className="size-7 text-muted-foreground"
          />
        }
      >
        <current.Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={choose}>
          {themes.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
