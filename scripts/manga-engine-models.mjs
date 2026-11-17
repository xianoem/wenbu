// Writes the manifest the Wenbu Manga Engine plugin downloads its models by: each file of a release
// folder with its size and SHA-256. Upload the same files to the GitHub release named by the tag.
//
//   node scripts/manga-engine-models.mjs <release folder> <release tag>
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [folder, release] = process.argv.slice(2)

if (folder === undefined || release === undefined) {
  process.stderr.write(
    'usage: node scripts/manga-engine-models.mjs <release folder> <release tag>\n',
  )

  process.exit(2)
}

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')

    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })

const files = await Promise.all(
  readdirSync(folder)
    .toSorted()
    .map(async (name) => {
      const file = join(folder, name)

      return { name, bytes: statSync(file).size, sha256: await sha256(file) }
    }),
)

const target = join(
  import.meta.dirname,
  '..',
  'src',
  'core',
  'plugins',
  'definitions',
  'mangaEngineModels.json',
)

writeFileSync(target, `${JSON.stringify({ release, files }, null, 2)}\n`)

process.stdout.write(
  `${files.length} files, ${files.reduce((total, file) => total + file.bytes, 0)} bytes → ${target}\n`,
)
