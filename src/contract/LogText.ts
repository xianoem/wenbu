import { DateTime, Option, Schema } from 'effect'
import { type LogEntry, LogLevel, LogProcess } from './Diagnostics'

const quoted = '"(?:[^"\\\\]|\\\\.)*"'

const headPattern = new RegExp(`^(\\S+) (\\S+) +(\\S+) (\\S+) (${quoted})(.*)$`)

const fieldPattern = new RegExp(` ([^\\s=]+)=(${quoted}|\\S+)`, 'g')

const causeIndent = '    '

const decodeString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String))

const decodeLevel = Schema.decodeUnknownOption(LogLevel)

const decodeProcess = Schema.decodeUnknownOption(LogProcess)

const bareValue = /^[^\s"=]+$/

const formatValue = (value: string) => (bareValue.test(value) ? value : JSON.stringify(value))

const formatProcess = (entry: LogEntry) =>
  entry.run > 0 ? `${entry.process}#${entry.run}` : entry.process

const token = (value: string) => value.replaceAll(/[\s=]+/g, '-') || '-'

export const formatLogEntry = (entry: LogEntry) => {
  const time = DateTime.formatIso(DateTime.makeUnsafe(entry.at))

  const fields = Object.entries(entry.fields).map(
    ([key, value]) => ` ${token(key)}=${formatValue(value)}`,
  )

  const head = `${time} ${entry.level.toUpperCase().padEnd(5)} ${formatProcess(entry)} ${token(entry.feature)} ${JSON.stringify(entry.message)}${fields.join('')}`

  if (entry.cause === undefined) {
    return head
  }

  const cause = entry.cause.split('\n').map((line) => `${causeIndent}${line}`)

  return [head, ...cause].join('\n')
}

const parseProcess = (text: string) => {
  const [name = '', run = '0'] = text.split('#')

  return Option.map(decodeProcess(name), (process) => ({ process, run: Number(run) || 0 }))
}

const parseFields = (text: string) => {
  const fields: Record<string, string> = {}

  for (const [, key = '', value = ''] of text.matchAll(fieldPattern)) {
    fields[key] = value.startsWith('"') ? Option.getOrElse(decodeString(value), () => value) : value
  }

  return fields
}

const parseHead = (line: string): Option.Option<LogEntry> => {
  const match = headPattern.exec(line)

  if (match === null) {
    return Option.none()
  }

  const [, time = '', level = '', process = '', feature = '', message = '', rest = ''] = match

  return Option.gen(function* () {
    const at = DateTime.toEpochMillis(yield* DateTime.make(time))

    return {
      at,
      level: yield* decodeLevel(level.toLowerCase()),
      ...(yield* parseProcess(process)),
      feature,
      message: yield* decodeString(message),
      fields: parseFields(rest),
    }
  })
}

export const parseLogText = (text: string): Array<LogEntry> => {
  const entries: Array<LogEntry> = []

  for (const line of text.split(/\r?\n/)) {
    const entry = entries.at(-1)

    if (line.startsWith(causeIndent) && entry !== undefined) {
      const cause = line.slice(causeIndent.length)

      entries[entries.length - 1] = {
        ...entry,
        cause: entry.cause === undefined ? cause : `${entry.cause}\n${cause}`,
      }

      continue
    }

    const parsed = parseHead(line)

    if (Option.isSome(parsed)) {
      entries.push(parsed.value)
    }
  }

  return entries
}

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const redactHome = (home: string, text: string) => {
  if (home === '') {
    return text
  }

  const pattern = home
    .split(/[\\/]+/)
    .map((part) => escapeRegExp(part))
    .join('[\\\\/]')

  return text.replaceAll(new RegExp(pattern, 'gi'), '%USERPROFILE%')
}
