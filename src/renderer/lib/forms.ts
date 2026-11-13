import { Cause, Exit, Option, Schema } from 'effect'
import { DetailsError } from '#contract/Details'
import { DownloadError } from '#contract/Downloads'
import { GalleriesError } from '#contract/Galleries'
import { GameGuideError } from '#contract/GameGuide'
import { TranslationError } from '#contract/GameTranslation'
import { LibraryError } from '#contract/Library'
import { LiveControlsError } from '#contract/LiveControls'
import { LlmSettingsError } from '#contract/Llm'
import { MangaError } from '#contract/Manga'
import { NovelsError } from '#contract/Novels'
import { NotEnoughSpace, type SpaceShortfall } from '#contract/Storage'
import { OverlayError } from '#contract/TranslationOverlay'

export interface FormError {
  readonly field: string | undefined
  readonly message: string
}

const isUserError = Schema.is(
  Schema.Union([
    LlmSettingsError,
    LibraryError,
    TranslationError,
    OverlayError,
    LiveControlsError,
    MangaError,
    DownloadError,
    GalleriesError,
    GameGuideError,
    DetailsError,
    NovelsError,
    NotEnoughSpace,
  ]),
)

const isNotEnoughSpace = Schema.is(NotEnoughSpace)

export const formErrorOf = <A, E>(exit: Exit.Exit<A, E>): FormError | undefined => {
  if (Exit.isSuccess(exit)) {
    return undefined
  }

  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))

  if (isUserError(error)) {
    return { field: 'field' in error ? error.field : undefined, message: error.message }
  }

  return { field: undefined, message: 'Something went wrong. Try again.' }
}

export const spaceErrorOf = <A, E>(exit: Exit.Exit<A, E>): SpaceShortfall | undefined => {
  if (Exit.isSuccess(exit)) {
    return undefined
  }

  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))

  return isNotEnoughSpace(error) ? error.shortfall : undefined
}

export const fieldError = (error: FormError | undefined, field: string) =>
  error?.field === field ? error.message : undefined
