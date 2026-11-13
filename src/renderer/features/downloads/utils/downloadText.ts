import type { DownloadJob, DownloadProblem, DownloadQuestion } from '#contract/Downloads'
import { driveLabel } from '#contract/Storage'
import { formatBytes, formatMoment } from '#lib/format'

export const formatSpeed = (bytesPerSecond: number | undefined) =>
  bytesPerSecond === undefined || bytesPerSecond <= 0
    ? undefined
    : `${formatBytes(bytesPerSecond)}/s`

export const formatTimeLeft = (seconds: number | undefined) => {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return undefined
  }

  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}s left`
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s left`
  }

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m left`
}

export const percentOf = (job: DownloadJob) =>
  job.pages.total === undefined || job.pages.total === 0
    ? undefined
    : (job.pages.done / job.pages.total) * 100

export const pageCount = (job: DownloadJob) =>
  job.pages.total === undefined ? undefined : `${job.pages.done} / ${job.pages.total}`

export const activeMeta = (job: DownloadJob): ReadonlyArray<string> => {
  if (job.status === 'queued') {
    return ['Waiting for a free slot']
  }

  if (job.activity !== undefined) {
    return [job.activity]
  }

  return [
    job.pages.total === undefined ? undefined : `${job.pages.done}/${job.pages.total} pages`,
    job.bytes > 0 ? formatBytes(job.bytes) : undefined,
    formatSpeed(job.bytesPerSecond),
    formatTimeLeft(job.secondsLeft),
  ].filter((part) => part !== undefined)
}

const when = (job: DownloadJob) => formatMoment(job.finishedAt ?? job.createdAt)

export const pastMeta = (job: DownloadJob) => {
  const progress = job.pages.total === undefined ? '' : ` · ${job.pages.done} of ${job.pages.total}`

  if (job.status === 'interrupted') {
    return `Interrupted${progress}`
  }

  if (job.status === 'cancelled') {
    return `Cancelled${progress}`
  }

  if (job.status === 'failed') {
    return `Stopped${progress} · ${when(job)}`
  }

  return [`${job.pages.done} pages`, formatBytes(job.bytes), when(job)].join(' · ')
}

export const questionText = (question: DownloadQuestion) => ({
  title:
    question.reason === 'not-enough-gp'
      ? 'Not enough GP for original quality'
      : 'Not signed in to ExHentai',
  detail: `The other ${question.remaining} ${question.remaining === 1 ? 'page' : 'pages'} will download at reduced quality (1280px).`,
})

export const resumeLabel = (job: DownloadJob) => (job.pages.done > 0 ? 'Resume' : 'Retry')

export const problemText = (problem: DownloadProblem) =>
  problem.space === undefined
    ? problem.message
    : `Paused, not enough space on ${driveLabel(problem.space.drive)}`
