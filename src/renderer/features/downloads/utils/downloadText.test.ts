import { describe, expect, it } from '@effect/vitest'
import { DownloadJob } from '#contract/Downloads'
import {
  activeMeta,
  formatTimeLeft,
  pastMeta,
  problemText,
  questionText,
  resumeLabel,
} from './downloadText'

const job = (patch: Partial<DownloadJob> = {}) =>
  DownloadJob.make({
    id: 'a',
    url: 'https://nhentai.net/g/1/',
    source: 'nhentai',
    title: 'Gallery',
    status: 'running',
    attempt: 1,
    pages: { total: 120, done: 34 },
    bytes: 2_097_152,
    reducedQuality: false,
    createdAt: '2026-10-24T10:00:00.000Z',
    ...patch,
  })

describe('downloadText', () => {
  it('describes a running download by pages, size, speed and time left', () => {
    expect(activeMeta(job({ bytesPerSecond: 1_048_576, secondsLeft: 95 }))).toEqual([
      '34/120 pages',
      '2.0 MB',
      '1.0 MB/s',
      '1m 35s left',
    ])
  })

  it('shows what a download is doing instead, such as waiting for the network', () => {
    expect(activeMeta(job({ activity: 'Network lost · trying again in 12 s' }))).toEqual([
      'Network lost · trying again in 12 s',
    ])

    expect(activeMeta(job({ status: 'queued' }))).toEqual(['Waiting for a free slot'])
  })

  it('says how far an interrupted download got', () => {
    expect(pastMeta(job({ status: 'interrupted', pages: { total: 200, done: 41 } }))).toBe(
      'Interrupted · 41 of 200',
    )
  })

  it('words the reduced-quality question', () => {
    expect(questionText({ reason: 'not-enough-gp', remaining: 86 })).toEqual({
      title: 'Not enough GP for original quality',
      detail: 'The other 86 pages will download at reduced quality (1280px).',
    })
  })

  it('offers to resume only when pages are saved', () => {
    expect(resumeLabel(job({ status: 'failed' }))).toBe('Resume')
    expect(resumeLabel(job({ status: 'failed', pages: { done: 0 } }))).toBe('Retry')
  })

  it('calls a download stopped by a full drive paused', () => {
    const space = { drive: 'C:\\', neededBytes: 0, freeBytes: 0 }

    expect(problemText({ reason: 'disk', message: 'Full.', space })).toBe(
      'Paused, not enough space on C:',
    )

    expect(problemText({ reason: 'network', message: 'Offline.' })).toBe('Offline.')
  })

  it('formats long waits in hours', () => {
    expect(formatTimeLeft(3720)).toBe('1h 2m left')
  })
})
