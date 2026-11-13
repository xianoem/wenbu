import {
  Clock,
  Context,
  Crypto,
  DateTime,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { SqlClient, SqlSchema } from 'effect/sql'
import {
  defaultDetectionSettings,
  Detection,
  type DetectionEngine,
  DetectionError,
  type DetectionInput,
  detectionHistoryLimit,
  DetectionSettings,
  DetectionsRpc,
  type DetectionsState,
  type DetectionTranslation,
  type PendingDetection,
  type RgbaImage,
} from '#contract/Detections'
import type { PluginsState } from '#contract/Plugins'
import { LlmClient } from '../llm/LlmClient'
import { PresetReferences } from '../llm/PresetReferences'
import * as SettingsStore from '../platform/SettingsStore'
import { Plugins } from '../plugins/Plugins'
import { GoogleLens } from './GoogleLens'
import { ocrText } from './OcrText'
import { ScreenAiOcr } from './ScreenAiOcr'

const DetectionJson = Schema.fromJsonString(Detection)

const DetectionRow = Schema.Struct({ detection: DetectionJson })

const encodeDetection = Schema.encodeEffect(DetectionJson)

interface Live {
  readonly detections: ReadonlyArray<Detection>
  readonly pending: ReadonlyArray<PendingDetection>
  readonly lastError?: string
}

const engineLabels = { 'screen-ai': 'Chrome Screen AI', 'google-lens': 'Google Lens' } as const

const notReady = (message: string) =>
  new DetectionError({ reason: 'not-ready', message, field: 'engineId' })

const invalid = (field: string, message: string) =>
  new DetectionError({ reason: 'invalid', message, field })

const now = Effect.map(DateTime.now, DateTime.formatIso)

const screenAiEngine = (plugins: PluginsState): DetectionEngine => {
  const plugin = plugins.plugins.find((candidate) => candidate.id === 'screen-ai')
  const base = { id: 'screen-ai', label: engineLabels['screen-ai'], locality: 'local' } as const

  if (plugin === undefined || !plugin.supported) {
    return { ...base, ready: false, detail: 'Chrome Screen AI does not run on this computer.' }
  }

  if (plugin.installed === undefined) {
    return { ...base, ready: false, detail: 'Install Chrome Screen AI in Settings → Plugins.' }
  }

  return plugin.installed.test.passed
    ? { ...base, ready: true }
    : {
        ...base,
        ready: false,
        detail: `Chrome Screen AI failed its test: ${plugin.installed.test.message}`,
      }
}

const sanitize = (settings: DetectionSettings) => {
  const targetLanguage = settings.translation.targetLanguage.trim()

  if (targetLanguage === '') {
    return Effect.fail(invalid('targetLanguage', 'Enter the language to translate into.'))
  }

  const atLeastOne = (value: number) => Math.max(1, Math.round(value))

  return Effect.succeed({
    ...settings,
    concurrentJobs: atLeastOne(settings.concurrentJobs),
    cloudRequestsPerMinute: atLeastOne(settings.cloudRequestsPerMinute),
    translation: {
      presetId: settings.translation.presetId.trim(),
      targetLanguage,
      timeoutSeconds: atLeastOne(settings.translation.timeoutSeconds),
      retryRounds: atLeastOne(settings.translation.retryRounds),
    },
  })
}

export class Detections extends Context.Service<
  Detections,
  {
    readonly state: Stream.Stream<DetectionsState>
    readonly settings: Effect.Effect<DetectionSettings>
    readonly saveSettings: (
      settings: DetectionSettings,
    ) => Effect.Effect<DetectionSettings, DetectionError>
    readonly detect: (
      image: RgbaImage,
      input: DetectionInput,
    ) => Effect.Effect<Detection, DetectionError>
    readonly detectClipboard: (image: RgbaImage) => Effect.Effect<Option.Option<Detection>>
    readonly remove: (id: string) => Effect.Effect<void>
  }
>()('wenbu/core/detections/Detections') {
  static readonly layer = Layer.effect(
    Detections,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plugins = yield* Plugins
      const screenAi = yield* ScreenAiOcr
      const lens = yield* GoogleLens
      const llm = yield* LlmClient
      const crypto = yield* Crypto.Crypto

      const store = SettingsStore.make(
        yield* KeyValueStore.KeyValueStore,
        DetectionSettings,
        defaultDetectionSettings,
      )

      const savedSettings = yield* store
        .get('detections')
        .pipe(Effect.orElseSucceed(() => defaultDetectionSettings))

      const settingsRef = yield* Ref.make(savedSettings)

      const history = yield* SqlSchema.findAll({
        Request: Schema.Number,
        Result: DetectionRow,
        execute: (limit) =>
          sql`SELECT detection FROM detections ORDER BY detected_at DESC LIMIT ${limit}`,
      })(detectionHistoryLimit).pipe(Effect.orDie)

      const live = yield* SubscriptionRef.make<Live>({
        detections: history.map((row) => row.detection),
        pending: [],
      })

      const jobs = yield* Ref.make({
        permits: savedSettings.concurrentJobs,
        semaphore: yield* Semaphore.make(savedSettings.concurrentJobs),
      })

      const lensRequests = yield* Ref.make<ReadonlyArray<number>>([])

      const engines = plugins.state.pipe(
        Stream.map((pluginsState): ReadonlyArray<DetectionEngine> => [
          screenAiEngine(pluginsState),
          { id: 'google-lens', label: engineLabels['google-lens'], locality: 'cloud', ready: true },
        ]),
      )

      const state = Stream.zipLatest(SubscriptionRef.changes(live), engines).pipe(
        Stream.map(([current, available]): DetectionsState => ({
          detections: current.detections,
          pending: current.pending,
          engines: available,
          ...(current.lastError === undefined ? {} : { lastError: current.lastError }),
        })),
      )

      const saveSettings = Effect.fn('Detections.saveSettings')(function* (
        settings: DetectionSettings,
      ) {
        const clean = yield* sanitize(settings)

        yield* Ref.set(settingsRef, clean)
        yield* Effect.orDie(store.set('detections', clean))

        const current = yield* Ref.get(jobs)

        if (current.permits !== clean.concurrentJobs) {
          yield* Ref.set(jobs, {
            permits: clean.concurrentJobs,
            semaphore: yield* Semaphore.make(clean.concurrentJobs),
          })
        }

        return clean
      })

      const waitForLensSlot: Effect.Effect<void> = Effect.gen(function* () {
        const limit = (yield* Ref.get(settingsRef)).cloudRequestsPerMinute
        const time = yield* Clock.currentTimeMillis

        const wait = yield* Ref.modify(lensRequests, (requests) => {
          const recent = requests.filter((at) => at > time - 60_000)

          return recent.length < limit
            ? [0, [...recent, time]]
            : [(recent[0] ?? time) + 60_000 - time, recent]
        })

        if (wait > 0) {
          yield* Effect.sleep(wait)
          yield* waitForLensSlot
        }
      })

      const recognize = Effect.fnUntraced(function* (
        settings: DetectionSettings,
        image: RgbaImage,
      ) {
        if (settings.engineId === undefined) {
          return yield* notReady('Choose a detection engine in Settings → Detections.')
        }

        if (settings.engineId === 'google-lens') {
          yield* waitForLensSlot

          return { engineId: settings.engineId, ocr: yield* lens.recognize(image) }
        }

        const folder = yield* plugins.installedFolder('screen-ai')

        if (Option.isNone(folder)) {
          return yield* notReady('Install Chrome Screen AI in Settings → Plugins.')
        }

        return { engineId: settings.engineId, ocr: yield* screenAi.recognize(folder.value, image) }
      })

      const translate = Effect.fnUntraced(function* (settings: DetectionSettings, text: string) {
        const { presetId, targetLanguage, timeoutSeconds, retryRounds } = settings.translation

        if (presetId === '') {
          return {}
        }

        const presetName = yield* llm.describe(presetId).pipe(
          Effect.map((preset) => preset.presetName),
          Effect.orElseSucceed(() => 'Missing preset'),
        )

        return yield* llm
          .complete({
            presetId,
            feature: 'detections',
            system: 'You translate text found in images. Reply with the translation only.',
            prompt: `Translate this text into ${targetLanguage}. Keep its line breaks.\n\n${text}`,
            timeout: `${timeoutSeconds} seconds`,
          })
          .pipe(
            Effect.retry(Schedule.recurs(retryRounds - 1)),
            Effect.map((completion) => ({
              translatedText: completion.text.trim(),
              translation: { status: 'translated', presetName } satisfies DetectionTranslation,
            })),
            Effect.catch((error) =>
              Effect.succeed({
                translation: {
                  status: 'failed',
                  presetName,
                  error: error.message,
                } satisfies DetectionTranslation,
              }),
            ),
          )
      })

      const save = Effect.fnUntraced(function* (detection: Detection) {
        yield* sql`INSERT INTO detections ${sql.insert({
          id: detection.id,
          detected_at: detection.detectedAt,
          detection: yield* encodeDetection(detection),
        })}`

        yield* sql`DELETE FROM detections WHERE id NOT IN (
          SELECT id FROM detections ORDER BY detected_at DESC LIMIT ${detectionHistoryLimit}
        )`
      }, Effect.orDie)

      const detect = Effect.fn('Detections.detect')(function* (
        image: RgbaImage,
        input: DetectionInput,
      ) {
        if (
          image.width < 1 ||
          image.height < 1 ||
          image.pixels.length !== image.width * image.height * 4
        ) {
          return yield* invalid('image', 'The image could not be read.')
        }

        const settings = yield* Ref.get(settingsRef)
        const id = yield* Effect.orDie(crypto.randomUUIDv7())
        const pending: PendingDetection = { id, input, startedAt: yield* now }

        yield* SubscriptionRef.update(live, ({ lastError: _cleared, ...current }) => ({
          ...current,
          pending: [pending, ...current.pending],
        }))

        const { semaphore } = yield* Ref.get(jobs)

        const work = Effect.gen(function* () {
          const { engineId, ocr } = yield* recognize(settings, image)
          const text = ocrText(ocr)

          if (text === '') {
            return yield* new DetectionError({
              reason: 'failed',
              message: 'No text was detected in the image.',
            })
          }

          const translated = yield* translate(settings, text)

          const detection: Detection = {
            id,
            originalText: text,
            input,
            detectedAt: yield* now,
            engine: { id: engineId, label: engineLabels[engineId] },
            ocr,
            ...translated,
          }

          yield* save(detection)

          yield* Effect.logDebug('Detection made').pipe(
            Effect.annotateLogs({
              engine: engineId,
              input,
              width: image.width,
              height: image.height,
              characters: text.length,
            }),
          )

          yield* SubscriptionRef.update(live, (current) => ({
            ...current,
            detections: [detection, ...current.detections].slice(0, detectionHistoryLimit),
          }))

          return detection
        })

        return yield* semaphore
          .withPermits(1)(work)
          .pipe(
            Effect.tapError((error) =>
              SubscriptionRef.update(live, (current) => ({ ...current, lastError: error.message })),
            ),
            Effect.ensuring(
              SubscriptionRef.update(live, (current) => ({
                ...current,
                pending: current.pending.filter((candidate) => candidate.id !== id),
              })),
            ),
          )
      })

      const detectClipboard = Effect.fn('Detections.detectClipboard')(function* (image: RgbaImage) {
        const settings = yield* Ref.get(settingsRef)

        if (!settings.listenToClipboard || settings.engineId === undefined) {
          return Option.none()
        }

        return yield* Effect.option(detect(image, 'clipboard'))
      })

      const remove = Effect.fn('Detections.remove')(function* (id: string) {
        yield* Effect.orDie(sql`DELETE FROM detections WHERE id = ${id}`)

        yield* SubscriptionRef.update(live, (current) => ({
          ...current,
          detections: current.detections.filter((detection) => detection.id !== id),
        }))
      })

      yield* (yield* PresetReferences).register({
        area: 'Detections',
        uses: (presetIds) =>
          Effect.map(Ref.get(settingsRef), (settings) =>
            presetIds.has(settings.translation.presetId),
          ),
        clear: (presetIds) =>
          Effect.flatMap(Ref.get(settingsRef), (settings) =>
            presetIds.has(settings.translation.presetId)
              ? Effect.orDie(
                  saveSettings({
                    ...settings,
                    translation: { ...settings.translation, presetId: '' },
                  }),
                )
              : Effect.void,
          ),
      })

      return Detections.of({
        state,
        settings: Ref.get(settingsRef),
        saveSettings,
        detect,
        detectClipboard,
        remove,
      })
    }),
  )
}

export const DetectionsRpcLive = DetectionsRpc.toLayer(
  Effect.gen(function* () {
    const detections = yield* Detections

    return DetectionsRpc.of({
      watchDetections: () => detections.state,
      getDetectionSettings: () => detections.settings,
      saveDetectionSettings: (settings) => detections.saveSettings(settings),
      detectImage: (image) => Effect.asVoid(detections.detect(image, 'image')),
      removeDetection: ({ id }) => detections.remove(id),
    })
  }),
)
