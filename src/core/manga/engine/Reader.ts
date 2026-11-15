import { Context, Effect, Layer, Path, Semaphore } from 'effect'
import type { InferenceSession, Tensor } from 'onnxruntime-common'
import { MangaError } from '#contract/Manga'
import type { RgbImage } from './Images'
import { Onnx, type Session } from './Onnx'
import { patchify, positionWeights } from './ReaderInput'
import { loadTokenizer } from './Tokenizer'

/**
 * Reads text blocks with Hayai Supernova, exported as static ONNX graphs: a chunk graph runs the vision
 * encoder and the first 25 greedy tokens, a continuation graph 24 more at a time. Each graph has a fixed
 * batch and patch budget, so crops are grouped into buckets and padded.
 */

export interface Reading {
  readonly text: string
  /** Mean log-probability of the chosen tokens, end of text included. */
  readonly confidence: number
  /** The reading stopped because it started repeating itself. */
  readonly repeated: boolean
  /** The reading reached the token limit without ending. */
  readonly capped: boolean
}

const failed = (message: string) => new MangaError({ reason: 'failed', message })

const eos = 16002
const pad = 16000
const maxNew = 192
const patchBytes = 768
const cells = 256
/** Crops larger than this get 512 patches; smaller ones read better at 256. */
const largeCrop = 1024 * 1024

const minRepeats = 4
const minRepeatedTokens = 16
const maxPeriod = 8

/** The period of a run of at least four copies covering sixteen tokens at the end, if there is one. */
export const repetitionAt = (ids: ReadonlyArray<number>) => {
  for (let period = 1; period <= maxPeriod; period += 1) {
    let copies = 1

    while (
      (copies + 1) * period <= ids.length &&
      ids
        .slice(ids.length - (copies + 1) * period, ids.length - copies * period)
        .every((id, index) => id === ids[ids.length - period + index])
    ) {
      copies += 1
    }

    if (copies >= minRepeats && copies * period >= minRepeatedTokens) {
      return { period, start: ids.length - copies * period }
    }
  }

  return undefined
}

interface Bucket {
  readonly patches: number
  readonly batch: number
}

/**
 * Every bucket reads 8 crops at a time. A batch of 16 saved about 0.08 s on a 10–15 bubble page, but
 * each bucket costs two graphs that DirectML takes 12–15 s each to compile, and its own GPU memory.
 */
const batchSize = 8

const bucketsFor = (patches: number, count: number): ReadonlyArray<Bucket> =>
  Array.from({ length: Math.ceil(count / batchSize) }, () => ({ patches, batch: batchSize }))

interface Row {
  readonly ids: Array<number>
  readonly logprobs: Array<number>
  done: boolean
  repeated: boolean
}

export class Reader extends Context.Service<
  Reader,
  {
    readonly read: (
      crops: ReadonlyArray<RgbImage>,
    ) => Effect.Effect<ReadonlyArray<Reading>, MangaError>
  }
>()('wenbu/core/manga/engine/Reader') {
  static readonly layer = Layer.effect(
    Reader,
    Effect.gen(function* () {
      const onnx = yield* Onnx
      const path = yield* Path.Path
      const tokenizer = yield* loadTokenizer(path.join(onnx.models, 'reader-tokenizer.json'))
      const lock = yield* Semaphore.make(1)
      const loaded = new Map<string, { readonly chunk: Session; readonly cont: Session }>()
      const { Tensor: OrtTensor } = onnx.ort

      const sessionsFor = Effect.fnUntraced(function* (bucket: Bucket) {
        const key = `${bucket.patches}-b${bucket.batch}`
        const existing = loaded.get(key)

        if (existing !== undefined) {
          return existing
        }

        const chunk = yield* onnx.session(`reader-chunk-${key}.onnx`)
        const cont = yield* onnx.session(`reader-cont-${key}.onnx`)
        const sessions = { chunk, cont }

        loaded.set(key, sessions)

        return sessions
      })

      const run = (session: Session, feeds: Record<string, Tensor>) =>
        onnx.run(session, feeds, 'Reading failed')

      const output = (outputs: InferenceSession.ReturnType, name: string) => {
        const tensor = outputs[name]

        return tensor === undefined
          ? Effect.fail(failed(`The reader returned no ${name}.`))
          : Effect.succeed(tensor)
      }

      /** Appends one chunk's tokens to the rows still reading, then applies the repetition guard. */
      const absorb = (rows: ReadonlyArray<Row>, tokens: Tensor, logprobs: Tensor) => {
        const width = tokens.dims[1] ?? 0
        // SAFETY: the reader graphs declare tokens as int64 and log-probabilities as float32.
        const ids = tokens.data as BigInt64Array
        // SAFETY: as above.
        const scores = logprobs.data as Float32Array

        rows.forEach((row, index) => {
          for (let step = 0; step < width && !row.done; step += 1) {
            const id = Number(ids[index * width + step] ?? BigInt(pad))

            if (id === pad) {
              row.done = true

              break
            }

            row.ids.push(id)
            row.logprobs.push(scores[index * width + step] ?? 0)

            if (id === eos) {
              row.done = true
            }
          }

          const repetition = row.done ? undefined : repetitionAt(row.ids)

          if (repetition !== undefined) {
            row.ids.splice(repetition.start + repetition.period * 2)
            row.logprobs.splice(repetition.start + repetition.period * 2)
            row.done = true
            row.repeated = true
          }
        })
      }

      const readBatch = Effect.fnUntraced(function* (
        bucket: Bucket,
        crops: ReadonlyArray<RgbImage>,
      ) {
        const { chunk, cont } = yield* sessionsFor(bucket)
        const { patches, batch } = bucket
        const pixels = new Uint8Array(batch * patches * patchBytes)
        const weights = new Float32Array(batch * patches * cells)
        const shapes = new BigInt64Array(batch * 2).fill(1n)
        const active = new Uint8Array(batch)

        crops.forEach((crop, index) => {
          const input = patchify(crop, patches)

          pixels.set(input.pixels, index * patches * patchBytes)
          weights.set(positionWeights(input.size.rows, input.size.columns), index * patches * cells)
          shapes[index * 2] = BigInt(input.size.rows)
          shapes[index * 2 + 1] = BigInt(input.size.columns)
          active[index] = 1
        })

        const rows: Array<Row> = crops.map(() => ({
          ids: [],
          logprobs: [],
          done: false,
          repeated: false,
        }))

        const first = yield* run(chunk, {
          pixels: new OrtTensor('uint8', pixels, [batch, patches, patchBytes]),
          pos_weights: new OrtTensor('float32', weights, [batch, patches, cells]),
          spatial_shapes: new OrtTensor('int64', shapes, [batch, 2]),
          active: new OrtTensor('bool', active, [batch]),
        })

        let tokens = yield* output(first, 'tokens')
        let keys = yield* output(first, 'kc')
        let values = yield* output(first, 'vc')
        const valid = yield* output(first, 'valid_t')

        absorb(rows, tokens, yield* output(first, 'logprobs'))

        let start = tokens.dims[1] ?? maxNew

        while (start < maxNew && rows.some((row) => !row.done)) {
          const width = tokens.dims[1] ?? 1
          // SAFETY: the reader graphs declare tokens as int64.
          const ids = tokens.data as BigInt64Array

          const last = BigInt64Array.from(
            { length: batch },
            (_, index) => ids[index * width + width - 1] ?? BigInt(pad),
          )

          const unfinished = Uint8Array.from({ length: batch }, (_, index) =>
            rows[index]?.done === false ? 1 : 0,
          )

          const next = yield* run(cont, {
            tok: new OrtTensor('int64', last, [batch]),
            start: new OrtTensor('int64', BigInt64Array.of(BigInt(start)), []),
            kc: keys,
            vc: values,
            valid_t: valid,
            unfinished: new OrtTensor('bool', unfinished, [batch]),
          })

          tokens = yield* output(next, 'tokens')
          keys = yield* output(next, 'kc_out')
          values = yield* output(next, 'vc_out')
          absorb(rows, tokens, yield* output(next, 'logprobs'))
          start += tokens.dims[1] ?? maxNew
        }

        return rows.map((row): Reading => ({
          text: tokenizer.decode(row.ids),
          confidence:
            row.logprobs.length === 0
              ? Number.NEGATIVE_INFINITY
              : row.logprobs.reduce((total, value) => total + value, 0) / row.logprobs.length,
          repeated: row.repeated,
          capped: !row.done,
        }))
      })

      const read = Effect.fn('Reader.read')(function* (crops: ReadonlyArray<RgbImage>) {
        const readings: Array<Reading | undefined> = crops.map(() => undefined)

        for (const patches of [256, 512]) {
          const indices = crops.flatMap((crop, index) =>
            crop.width * crop.height >= largeCrop === (patches === 512) ? [index] : [],
          )

          let offset = 0

          for (const bucket of bucketsFor(patches, indices.length)) {
            const group = indices.slice(offset, offset + bucket.batch)

            const results = yield* readBatch(
              bucket,
              group.flatMap((index) => crops[index] ?? []),
            )

            group.forEach((index, position) => {
              readings[index] = results[position]
            })

            offset += bucket.batch
          }
        }

        return readings.map(
          (reading) =>
            reading ?? {
              text: '',
              confidence: Number.NEGATIVE_INFINITY,
              repeated: false,
              capped: false,
            },
        )
      }, lock.withPermits(1))

      // The graphs take half a minute to compile, so the common bucket starts compiling with the engine.
      yield* Effect.forkScoped(
        lock.withPermits(1)(Effect.ignore(sessionsFor({ patches: 256, batch: batchSize }))),
      )

      return Reader.of({ read })
    }),
  )
}
