import {
  type ChangeKind,
  type Release,
  type ReleaseChange,
  releaseAreaOf,
  releaseAreas,
} from '#contract/Updates'

export interface Commit {
  readonly subject: string
  readonly body: string
}

const fieldSeparator = '\u001F'
const commitSeparator = '\u001E'

/** For `git log --format=`: subject and body, split by control characters no message contains. */
export const gitLogFormat = '%s%x1F%b%x1E'

export const parseGitLog = (log: string): ReadonlyArray<Commit> =>
  log
    .split(commitSeparator)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [subject = '', body = ''] = entry.split(fieldSeparator)

      return { subject: subject.trim(), body: body.trim() }
    })

const conventional = /^(feat|fix)(?:\(([^)]+)\))?!?:\s*(.+)$/

const skipTrailer = /^release-note:\s*skip\s*$/im

const kinds: Readonly<Record<string, ChangeKind>> = { feat: 'new', fix: 'fixed' }

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export const changesFrom = (commits: ReadonlyArray<Commit>): ReadonlyArray<ReleaseChange> =>
  commits.flatMap((commit) => {
    const [, type, scope, text] = conventional.exec(commit.subject) ?? []
    const kind = type === undefined ? undefined : kinds[type]

    if (kind === undefined || text === undefined || skipTrailer.test(commit.body)) {
      return []
    }

    return [{ kind, area: releaseAreaOf(scope), text: sentence(text.trim()) }]
  })

export const withRelease = (
  releases: ReadonlyArray<Release>,
  release: Release,
): ReadonlyArray<Release> => [
  release,
  ...releases.filter((existing) => existing.version !== release.version),
]

const section = (title: string, changes: ReadonlyArray<ReleaseChange>) =>
  changes.length === 0
    ? []
    : [
        `## ${title}`,
        '',
        ...changes.map(
          (change) => `- **${releaseAreas[releaseAreaOf(change.area)]}:** ${change.text}`,
        ),
        '',
      ]

export const releaseBody = (release: Release) => {
  const lines = [
    ...section(
      'New',
      release.changes.filter((change) => change.kind === 'new'),
    ),
    ...section(
      'Fixed',
      release.changes.filter((change) => change.kind === 'fixed'),
    ),
  ]

  return lines.length === 0 ? 'Maintenance release.\n' : lines.join('\n')
}
