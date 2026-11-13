import * as BrowserKeyValueStore from '@effect/platform-browser/BrowserKeyValueStore'
import { Effect, Schema, Stream } from 'effect'
import { Atom } from 'effect/reactivity'
import type { DayRange } from '#contract/Dashboard'
import { Core } from '#lib/rpc'
import { Period, type Ranges } from './periods'

export const periodAtom = Atom.kvs({
  runtime: Atom.runtime(BrowserKeyValueStore.layerLocalStorage),
  key: 'dashboard-period',
  schema: Period,
  defaultValue: (): Period => 'month',
})

export const dismissedAtom = Atom.kvs({
  runtime: Atom.runtime(BrowserKeyValueStore.layerLocalStorage),
  key: 'dashboard-dismissed',
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
})

export const dashboardKeys = ['dashboard']

export const usageAtom = (ranges: Ranges) =>
  Core.query('dashboardUsage', ranges, { reactivityKeys: dashboardKeys })

export const progressAtom = (period: DayRange) =>
  Core.query('translationProgress', { period }, { reactivityKeys: dashboardKeys })

export const attentionAtom = Core.query('dashboardAttention', undefined, {
  reactivityKeys: dashboardKeys,
})

export const resumeDownloadAtom = Core.mutation('resumeDownload')

export const answerDownloadAtom = Core.mutation('answerDownload')

export const signInAtom = Core.mutation('signInToSource')

export const problemCountAtom = Core.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Core

      return client('watchProblemCount', undefined)
    }),
  ),
)
