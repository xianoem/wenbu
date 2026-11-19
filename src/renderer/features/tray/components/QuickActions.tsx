import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { ImageIcon, StopIcon, SubtitlesIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { useRef, useState } from 'react'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { detectImageAtom } from '../../detections/detections'
import { imagePixels } from '../../detections/utils/imagePixels'
import { startSubtitlesAtom, stopSubtitlesAtom, subtitlesAtom } from '../../subtitles/subtitles'

const subtitlesRunning = new Set(['loading-model', 'listening', 'paused'])

export function QuickActions({ canDetect }: { readonly canDetect: boolean }) {
  const subtitles = useAtomValue(subtitlesAtom)
  const start = useAtomSet(startSubtitlesAtom, { mode: 'promiseExit' })
  const stop = useAtomSet(stopSubtitlesAtom)
  const detect = useAtomSet(detectImageAtom, { mode: 'promiseExit' })
  const [error, setError] = useState<string | undefined>(undefined)
  const file = useRef<HTMLInputElement | null>(null)

  const listening = AsyncResult.isSuccess(subtitles) && subtitlesRunning.has(subtitles.value.status)

  const toggleSubtitles = async () => {
    setError(undefined)

    if (listening) {
      stop({ payload: undefined })

      return
    }

    const exit = await start({ payload: undefined })

    if (Exit.isFailure(exit)) {
      setError(formErrorOf(exit)?.message)
    }
  }

  const translate = async (picked: File | undefined) => {
    if (picked === undefined) {
      return
    }

    setError(undefined)

    const image = await imagePixels(picked).catch(() => undefined)

    if (image === undefined) {
      setError('The file is not an image Wenbu can read.')

      return
    }

    const exit = await detect({ payload: image })

    if (Exit.isFailure(exit)) {
      setError(formErrorOf(exit)?.message)
    }
  }

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-8 flex-1 justify-start rounded-full px-3 font-medium"
          onClick={() => void toggleSubtitles()}
        >
          {listening ? <StopIcon weight="fill" /> : <SubtitlesIcon />}
          {listening ? 'Stop Live Subtitles' : 'Start Live Subtitles'}
        </Button>
        {canDetect ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 flex-1 justify-start rounded-full px-3 font-medium"
            onClick={() => file.current?.click()}
          >
            <ImageIcon />
            Translate an image
          </Button>
        ) : null}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void translate(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {error === undefined ? null : <p className="px-3 text-xs text-destructive">{error}</p>}
    </section>
  )
}
