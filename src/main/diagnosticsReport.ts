import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatLogEntry, parseLogText } from '#contract/LogText'
import { listLaunches } from './mainLog'

const exportedLaunches = 2

const logFiles = ['main.log', 'core.log']

const readText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '')

const launchLog = (root: string, id: string) =>
  logFiles
    .flatMap((file) => parseLogText(readText(join(root, id, file))))
    .toSorted((left, right) => left.at - right.at)
    .map((entry) => formatLogEntry(entry))
    .join('\n')

export interface ReportOptions {
  readonly root: string
  readonly about: ReadonlyArray<readonly [label: string, value: string]>
}

export const diagnosticsReport = ({ root, about }: ReportOptions) => {
  const width = Math.max(...about.map(([label]) => label.length))
  const header = about.map(([label, value]) => `${label.padEnd(width)}  ${value}`)

  const launches = listLaunches(root)
    .slice(0, exportedLaunches)
    .map((id) => `== Launch ${id} (UTC) ==\n${launchLog(root, id)}`)

  return [
    'Wenbu diagnostics',
    '',
    ...header,
    '',
    'Times are UTC. Secrets, prompts, game text and your user folder are never written to logs.',
    '',
    ...launches.flatMap((launch) => [launch, '']),
  ].join('\n')
}
