import {
  Cause,
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Semaphore,
} from 'effect'
import { MangaError, type PageStage } from '#contract/Manga'
import { Images, type PageFormat } from './Images'
import { Inpainter } from './Inpaint'
import { Lettering, type LetterBlock, type LetterOptions } from './Lettering'
import { Onnx } from './Onnx'
import { OpenCv } from './OpenCv'
import { Scanner, type FoundBlock } from './Scanner'

/**
 * A folder run, as the plugin's Pipeline.run does it: pages are read ahead, their texts sent for
 * translation in parallel, and translated pages are cleaned with LaMa over the refined mask, lettered
 * and saved, two at a time. GPU work takes turns through the ONNX service.
 */

export type RunReport =
  | { readonly event: 'page-started'; readonly page: number }
  | { readonly event: 'stage'; readonly page: number; readonly stage: PageStage }
  | { readonly event: 'page-done'; readonly page: number; readonly regions: number }
  | { readonly event: 'page-failed'; readonly page: number; readonly message: string }

export interface RunSettings {
  readonly target: string
  readonly screenAi: Option.Option<string>
  readonly inpaintingSize: number
  readonly wholePage: boolean
  readonly format: 'png' | 'jpeg' | 'webp' | 'source'
  readonly quality: number
  readonly pagesAhead: number
  readonly translationRequests: number
  readonly letter: LetterOptions
}

export interface RunPage {
  readonly source: string
  readonly output: string
}

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const finishing = 2

const sourceFormats: Readonly<Record<string, PageFormat>> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
}

/** Targets the plugin letters horizontally whatever the block's shape (LANGUAGE_ORIENTATION_PRESETS). */
const horizontalTargets = new Set([
  'CSY',
  'NLD',
  'ENG',
  'FRA',
  'DEU',
  'HUN',
  'ITA',
  'KOR',
  'PLK',
  'PTB',
  'ROM',
  'RUS',
  'ESP',
  'TRK',
  'UKR',
  'VIN',
  'ARA',
  'FIL',
])

/** TextBlock.direction for 'auto': the largest line decides, taller than wide reads vertically. */
const verticalFor = (found: FoundBlock, target: string) => {
  if (horizontalTargets.has(target)) {
    return false
  }

  let largest = 0
  let vertical = false

  for (const line of found.block.lines) {
    const xs = line.pts.map((point) => point.x)
    const ys = line.pts.map((point) => point.y)
    const width = Math.max(...xs) - Math.min(...xs)
    const height = Math.max(...ys) - Math.min(...ys)
    const area = width * height

    if (area > largest) {
      largest = area
      vertical = height > 0 && width / height < 1
    }
  }

  return vertical
}

export class Runner extends Context.Service<
  Runner,
  {
    readonly run: (
      pages: ReadonlyArray<RunPage>,
      settings: RunSettings,
      report: (event: RunReport) => Effect.Effect<void>,
      translate: (
        page: number,
        texts: ReadonlyArray<string>,
      ) => Effect.Effect<ReadonlyArray<string>, MangaError>,
    ) => Effect.Effect<{ readonly done: number; readonly failed: number; readonly seconds: number }>
  }
>()('wenbu/core/manga/engine/Runner') {
  static readonly layer = Layer.effect(
    Runner,
    Effect.gen(function* () {
      const images = yield* Images
      const scanner = yield* Scanner
      const inpainter = yield* Inpainter
      const lettering = yield* Lettering
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      yield* Onnx

      const { cv } = yield* OpenCv

      /** OpenCV.js throws its C++ exceptions as bare pointers. */
      const describe = (cause: Cause.Cause<unknown>) => {
        const defect = Cause.squash(cause)

        if (Predicate.isNumber(defect)) {
          const message: unknown = cv.exceptionFromPtr(defect)?.msg

          return `OpenCV failed: ${Predicate.isString(message) ? message : defect}`
        }

        return Cause.pretty(cause).split(String.fromCharCode(10))[0] ?? 'The page failed.'
      }

      const formatOf = (settings: RunSettings, source: string): PageFormat =>
        settings.format === 'source'
          ? (sourceFormats[path.extname(source).toLowerCase()] ?? 'png')
          : settings.format

      const run = Effect.fn('Runner.run')(function* (
        pages: ReadonlyArray<RunPage>,
        settings: RunSettings,
        report: (event: RunReport) => Effect.Effect<void>,
        translate: (
          page: number,
          texts: ReadonlyArray<string>,
        ) => Effect.Effect<ReadonlyArray<string>, MangaError>,
      ) {
        const started = yield* Clock.currentTimeMillis
        const finding = yield* Semaphore.make(1)
        const requests = yield* Semaphore.make(settings.translationRequests)
        const finish = yield* Semaphore.make(finishing)
        const counts = { done: 0, failed: 0 }

        /** keep_original: a page without text is copied, or saved in the output format. */
        const keepOriginal = Effect.fnUntraced(function* (page: RunPage) {
          const same =
            path.extname(page.source).toLowerCase() === path.extname(page.output).toLowerCase()

          if (same) {
            yield* fs.makeDirectory(path.dirname(page.output), { recursive: true })

            return yield* fs
              .copyFile(page.source, page.output)
              .pipe(Effect.mapError(() => failed(`The page ${page.output} could not be saved.`)))
          }

          const image = yield* images.read(page.source)

          yield* images.save(page.output, image, formatOf(settings, page.source), settings.quality)
        })

        const process = Effect.fnUntraced(function* (page: RunPage, index: number) {
          yield* report({ event: 'page-started', page: index })

          const found = yield* finding.withPermits(1)(
            Effect.gen(function* () {
              yield* report({ event: 'stage', page: index, stage: 'detecting' })

              const original = yield* images.read(page.source)

              yield* report({ event: 'stage', page: index, stage: 'reading' })

              return {
                original,
                ...(yield* scanner.find(original, settings.target, settings.screenAi)),
              }
            }),
          )

          if (found.blocks.length === 0) {
            yield* finish.withPermits(1)(keepOriginal(page))

            return 0
          }

          yield* report({ event: 'stage', page: index, stage: 'translating' })

          const texts = found.blocks.map((block) => block.text)
          const translations = yield* requests.withPermits(1)(translate(index, texts))

          if (translations.length !== texts.length) {
            return yield* failed(
              `Expected ${texts.length} translations, got ${translations.length}.`,
            )
          }

          return yield* finish.withPermits(1)(
            Effect.gen(function* () {
              yield* report({ event: 'stage', page: index, stage: 'cleaning' })

              const cleaned = yield* inpainter.inpaint(found.original, found.mask, {
                size: settings.inpaintingSize,
                wholePage: settings.wholePage,
              })

              yield* report({ event: 'stage', page: index, stage: 'lettering' })

              const blocks = found.blocks.map((block, at): LetterBlock => ({
                region: {
                  xyxy: block.block.xyxy,
                  text: block.reading.text,
                  translation: translations[at] ?? '',
                  vertical: verticalFor(block, settings.target),
                  angle: block.block.angle,
                },
                fg: block.fg,
                bg: block.bg,
                lettering: undefined,
              }))

              const lettered = yield* lettering.render(
                cleaned,
                found.original,
                blocks,
                settings.letter,
              )

              yield* images.save(
                page.output,
                lettered,
                formatOf(settings, page.source),
                settings.quality,
              )

              return translations.length
            }),
          )
        })

        yield* Effect.forEach(
          pages,
          (page, index) =>
            process(page, index).pipe(
              Effect.matchCauseEffect({
                onSuccess: (regions) => {
                  counts.done += 1

                  return report({ event: 'page-done', page: index, regions })
                },
                onFailure: (cause) => {
                  counts.failed += 1

                  const message = Option.match(Cause.findErrorOption(cause), {
                    onNone: () => describe(cause),
                    onSome: (error) =>
                      Predicate.isTagged(error, 'MangaError') ? error.message : String(error),
                  })

                  return report({ event: 'page-failed', page: index, message })
                },
              }),
            ),
          { concurrency: settings.pagesAhead, discard: true },
        )

        const ended = yield* Clock.currentTimeMillis

        return { ...counts, seconds: (ended - started) / 1000 }
      })

      return Runner.of({ run })
    }),
  )
}
