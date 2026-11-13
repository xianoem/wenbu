import { Effect, Schema } from 'effect'
import { unzip } from 'fflate'

export interface ArchiveFile {
  readonly path: string
  readonly data: Uint8Array
}

export class ArchiveError extends Schema.TaggedError<ArchiveError>()('ArchiveError', {
  message: Schema.String,
}) {}

export type ArchiveMapping = (name: string) => string | undefined

const invalid = () => new ArchiveError({ message: 'The download is not a valid archive.' })

export const readZip = (bytes: Uint8Array, mapping: ArchiveMapping) =>
  Effect.callback<ReadonlyArray<ArchiveFile>, ArchiveError>((resume) => {
    const terminate = unzip(
      bytes,
      { filter: (file) => !file.name.endsWith('/') && mapping(file.name) !== undefined },
      (error, entries) => {
        resume(
          error === null
            ? Effect.succeed(
                Object.entries(entries).map(([name, data]) => ({
                  path: mapping(name) ?? name,
                  data,
                })),
              )
            : Effect.fail(invalid()),
        )
      },
    )

    return Effect.sync(terminate)
  })
