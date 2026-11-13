import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Console, DateTime, Effect, FileSystem, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { Release } from '#contract/Updates'
import {
  changesFrom,
  gitLogFormat,
  parseGitLog,
  releaseBody,
  withRelease,
} from '../src/core/updates/CommitNotes.ts'

const notesPath = 'src/core/updates/releaseNotes.json'
const packagePath = 'package.json'

const usage = [
  'pnpm release <patch|minor|major|x.y.z>   write the notes, bump, commit, tag and push',
  'pnpm release <...> --dry-run             show the notes without changing anything',
  'pnpm release body [x.y.z]                print the GitHub release text for a version',
].join('\n')

class ReleaseError extends Schema.TaggedError<ReleaseError>()('ReleaseError', {
  message: Schema.String,
}) {}

const Releases = Schema.fromJsonString(Schema.Array(Release))

const PackageVersion = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))

const run = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, { stderr: 'inherit' }))
      const output = yield* Stream.mkString(Stream.decodeText(handle.stdout))

      if ((yield* handle.exitCode) !== 0) {
        return yield* new ReleaseError({ message: `${command} ${args.join(' ')} failed` })
      }

      return output.trim()
    }),
  )
})

const git = (...args: ReadonlyArray<string>) => run('git', args)

const nextVersion = Effect.fnUntraced(function* (current: string, bump: string) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump
  }

  const [major = 0, minor = 0, patch = 0] = current.split('.').map((part) => Number(part))

  if (bump === 'major') {
    return `${major + 1}.0.0`
  }

  if (bump === 'minor') {
    return `${major}.${minor + 1}.0`
  }

  if (bump === 'patch') {
    return `${major}.${minor}.${patch + 1}`
  }

  return yield* new ReleaseError({ message: usage })
})

const readReleases = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  return yield* Schema.decodeEffect(Releases)(yield* fs.readFileString(notesPath))
})

const printBody = Effect.fnUntraced(function* (wanted: string | undefined) {
  const fs = yield* FileSystem.FileSystem
  const releases = yield* readReleases

  const version =
    wanted ??
    (yield* Schema.decodeEffect(PackageVersion)(yield* fs.readFileString(packagePath))).version

  const release = releases.find((candidate) => candidate.version === version.replace(/^v/, ''))

  if (release === undefined) {
    return yield* new ReleaseError({ message: `There are no release notes for ${version}.` })
  }

  yield* Console.log(releaseBody(release))
})

const release = Effect.fnUntraced(function* (bump: string, dryRun: boolean) {
  const fs = yield* FileSystem.FileSystem
  const packageJson = yield* fs.readFileString(packagePath)
  const current = (yield* Schema.decodeEffect(PackageVersion)(packageJson)).version
  const version = yield* nextVersion(current, bump)
  const tag = `v${version}`

  if ((yield* git('tag', '--list', tag)) !== '') {
    return yield* new ReleaseError({ message: `${tag} already exists.` })
  }

  const lastTag = (yield* git('tag', '--list', 'v*', '--sort=-v:refname')).split(/\r?\n/)[0] ?? ''
  const range = lastTag === '' ? 'HEAD' : `${lastTag}..HEAD`
  const log = yield* git('log', range, `--format=${gitLogFormat}`)

  const notes = {
    version,
    date: DateTime.formatIso(yield* DateTime.now).slice(0, 10),
    changes: changesFrom(parseGitLog(log)),
  }

  yield* Console.log(`Wenbu ${version} (since ${lastTag === '' ? 'the first commit' : lastTag})\n`)
  yield* Console.log(releaseBody(notes))

  if (dryRun) {
    return
  }

  if ((yield* git('status', '--porcelain')) !== '') {
    return yield* new ReleaseError({ message: 'Commit or stash your changes before releasing.' })
  }

  if ((yield* git('rev-parse', '--abbrev-ref', 'HEAD')) !== 'main') {
    return yield* new ReleaseError({ message: 'Releases are cut from main.' })
  }

  const releases = withRelease(yield* readReleases, notes)
  const encoded = yield* Schema.encodeEffect(Schema.Array(Release))(releases)

  yield* fs.writeFileString(notesPath, `${JSON.stringify(encoded, undefined, 2)}\n`)

  yield* fs.writeFileString(
    packagePath,
    packageJson.replace(`"version": "${current}"`, `"version": "${version}"`),
  )

  yield* git('add', notesPath, packagePath)
  yield* git('commit', '-m', `chore(release): ${tag}`)
  yield* git('tag', tag)
  yield* git('push', 'origin', 'main', tag)

  yield* Console.log(`Pushed ${tag}. The Release workflow builds the installer and publishes it.`)
})

const program = Effect.gen(function* () {
  const [command, ...rest] = process.argv.slice(2)

  if (command === undefined) {
    return yield* new ReleaseError({ message: usage })
  }

  if (command === 'body') {
    return yield* printBody(rest[0])
  }

  return yield* release(command, rest.includes('--dry-run'))
})

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTag('ReleaseError', (error) =>
      Effect.andThen(
        Console.error(error.message),
        Effect.sync(() => {
          process.exitCode = 1
        }),
      ),
    ),
    Effect.provide(NodeServices.layer),
  ),
)
