import { assert, describe, it } from '@effect/vitest'
import { ConnectionFailed, GameUpdated, LinesSkipped, RunStopped } from '#contract/Dashboard'
import { DownloadJob } from '#contract/Downloads'
import { MangaRun } from '#contract/Manga'
import {
  dismissalKey,
  dismissalsAfter,
  noticeSummary,
  noticesOf,
  runningOf,
  undismissed,
} from './notices'

const job = (id: string, status: DownloadJob['status'], title = 'Snowfall Express') =>
  DownloadJob.make({
    id,
    url: `https://hitomi.la/${id}`,
    source: 'hitomi',
    title,
    status,
    attempt: 1,
    pages: { total: 146, done: 88 },
    bytes: 0,
    reducedQuality: false,
    createdAt: '2026-10-28T10:00:00.000Z',
  })

const mangaRun = (id: string, status: MangaRun['status'], startedAt: string) =>
  MangaRun.make({
    id,
    folder: 'D:\\Manga\\Paper Cranes',
    outputFolder: 'D:\\Manga\\Paper Cranes\\translated',
    status,
    startedAt,
    presetName: 'Fast',
    targetLanguage: 'ENG',
    pages: { total: 72, done: 41, failed: 0, skipped: 0 },
    usage: { inputTokens: 0, outputTokens: 0 },
    problems: [],
  })

describe('notices', () => {
  it('lists stored and live Attention Items, with skipped lines after the urgent ones', () => {
    const notices = noticesOf({
      items: [
        new LinesSkipped({ gameId: 'silver', title: 'Silver Promise', lines: 78 }),
        new RunStopped({
          gameId: 'dawn',
          title: 'Labyrinth of Dawn',
          status: 'partial',
          stoppedAtLimit: true,
          linesLeft: 3412,
          at: '2026-10-21T10:00:00.000Z',
        }),
        new GameUpdated({
          gameId: 'garden',
          title: "The Witch's Garden",
          lines: 214,
          at: '2026-10-25',
        }),
        new ConnectionFailed({ connectionId: 'c1', name: 'DeepSeek' }),
      ],
      downloads: {
        jobs: [job('a', 'failed', 'Summer at Kamogawa'), job('b', 'running'), job('c', 'finished')],
        accounts: [{ source: 'exhentai', status: 'expired' }],
      },
      drives: [
        { drive: 'C:\\', freeBytes: 6.1 * 1024 ** 3, totalBytes: 500 * 1024 ** 3, level: 'low' },
        { drive: 'D:\\', freeBytes: 400 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, level: 'ok' },
      ],
      problems: {
        warnings: 5,
        errors: 3,
        lastError: { at: 1, feature: 'overlay', message: 'Lost the game window' },
      },
    })

    assert.deepStrictEqual(
      notices.map((notice) => notice.title),
      [
        'Labyrinth of Dawn stopped at its spending limit',
        "The Witch's Garden was updated",
        'DeepSeek failed its connection check',
        'Summer at Kamogawa stopped downloading',
        'Signed out of ExHentai',
        'Silver Promise kept 78 lines in the original',
        'Drive C: has 6.1 GB free',
        '3 errors logged since Wenbu started',
      ],
    )

    assert.strictEqual(
      noticeSummary(notices),
      'a run stopped at its limit, a game update, a failed connection, a failed download, a signed-out source, skipped lines, low space, 3 errors',
    )
  })

  it("counts only each manga folder's latest run", () => {
    const notices = noticesOf({
      items: [],
      mangaRuns: [
        mangaRun('old', 'failed', '2026-10-01T10:00:00.000Z'),
        mangaRun('new', 'translated', '2026-10-02T10:00:00.000Z'),
      ],
    })

    assert.lengthOf(notices, 0)
  })

  it('adds up notices of the same kind in the summary', () => {
    const notices = noticesOf({
      items: [],
      downloads: { jobs: [job('a', 'failed'), job('b', 'interrupted')], accounts: [] },
    })

    assert.strictEqual(noticeSummary(notices), '2 failed downloads')
  })

  it('lists running translations, manga runs and downloads with their progress', () => {
    const running = runningOf({
      mangaRuns: [mangaRun('m', 'running', '2026-10-29T10:00:00.000Z')],
      downloads: { jobs: [job('b', 'running'), job('c', 'finished')], accounts: [] },
    })

    assert.deepStrictEqual(
      running.map((work) => [work.title, work.detail, work.progress]),
      [
        ['Paper Cranes', 'Manga translation · 41 of 72 pages', 41 / 72],
        ['Snowfall Express', 'Download · Hitomi · 88 of 146 pages', 88 / 146],
      ],
    )
  })

  it('hides a dismissed notice until its problem changes', () => {
    const skipped = (lines: number) =>
      noticesOf({ items: [new LinesSkipped({ gameId: 'silver', title: 'Silver Promise', lines })] })

    const errors = (count: number) =>
      noticesOf({ items: [], problems: { warnings: 0, errors: count } })

    const dismissed = [...skipped(78), ...errors(3)].map((notice) => dismissalKey(notice))

    assert.lengthOf(undismissed(skipped(78), dismissed), 0)
    assert.lengthOf(undismissed(errors(3), dismissed), 0)
    assert.lengthOf(undismissed(skipped(80), dismissed), 1)
    assert.lengthOf(undismissed(errors(4), dismissed), 1)
  })

  it('forgets dismissals of notices that are gone', () => {
    const before = noticesOf({ items: [], problems: { warnings: 0, errors: 3 } })
    const now = noticesOf({ items: [], problems: { warnings: 0, errors: 4 } })
    const dismissed = before.map((notice) => dismissalKey(notice))

    assert.deepStrictEqual(
      dismissalsAfter(now, dismissed, now),
      now.map((notice) => dismissalKey(notice)),
    )
  })
})
