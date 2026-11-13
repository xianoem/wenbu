import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Exit } from 'effect'
import { useState } from 'react'
import { type Game, type GameLocale, localeLabels } from '#contract/Library'
import { fieldError, type FormError, formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '#ui/field'
import { Input } from '#ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/select'
import { Textarea } from '#ui/textarea'
import { isPluginReady, pluginsAtom } from '../../plugins/plugins'
import { libraryKeys, setLaunchLocaleAtom, updateGameAtom } from '../library'
import { automaticHint } from './LocalePill'

const hintOf = (locale: GameLocale, game: Game, lunaHookReady: boolean) => {
  if (locale === 'auto') {
    return automaticHint(game, lunaHookReady)
  }

  return lunaHookReady
    ? 'Some games only run on a Japanese system. Play and the Translation Overlay both use this.'
    : 'Install LunaHook from Plugins to start games in a Japanese locale.'
}

export function EditGameDialog({
  game,
  onClose,
}: {
  readonly game: Game
  readonly onClose: () => void
}) {
  const update = useAtomSet(updateGameAtom, { mode: 'promiseExit' })
  const [title, setTitle] = useState(game.title)
  const [notes, setNotes] = useState(game.notes ?? '')
  const setLocale = useAtomSet(setLaunchLocaleAtom, { mode: 'promiseExit' })
  const [locale, setLocaleDraft] = useState<GameLocale>(game.locale)
  const [error, setError] = useState<FormError | undefined>(undefined)
  const lunaHookReady = isPluginReady(useAtomValue(pluginsAtom), 'luna-hook')

  const save = async () => {
    const exit = await update({
      payload: { id: game.id, title, notes },
      reactivityKeys: libraryKeys,
    })

    const localeExit =
      Exit.isSuccess(exit) && locale !== game.locale
        ? await setLocale({ payload: { id: game.id, locale }, reactivityKeys: libraryKeys })
        : exit

    setError(formErrorOf(exit) ?? formErrorOf(localeExit))

    if (Exit.isSuccess(exit) && Exit.isSuccess(localeExit)) {
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            The name and notes are yours; the game folder stays as it is.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-4">
          <Field data-invalid={fieldError(error, 'title') !== undefined}>
            <FieldLabel htmlFor="game-title">Name</FieldLabel>
            <Input
              id="game-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <FieldError>{fieldError(error, 'title')}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="game-notes">Notes</FieldLabel>
            <Textarea
              id="game-notes"
              value={notes}
              placeholder="Walkthrough links, save locations, anything worth remembering"
              className="min-h-28"
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>Start the game in</FieldLabel>
            <Select
              items={localeLabels}
              value={locale}
              onValueChange={(value) => setLocaleDraft(value ?? locale)}
            >
              <SelectTrigger aria-label="Start the game in" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{localeLabels.auto}</SelectItem>
                <SelectItem value="system">{localeLabels.system}</SelectItem>
                <SelectItem value="ntleas" disabled={!lunaHookReady}>
                  {localeLabels.ntleas}
                </SelectItem>
                <SelectItem value="locale-remulator" disabled={!lunaHookReady}>
                  {localeLabels['locale-remulator']}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12.5px] text-muted-foreground">
              {hintOf(locale, game, lunaHookReady)}
            </p>
          </Field>

          {error !== undefined && error.field === undefined ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : null}
        </FieldGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
