import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const windows = process.platform === 'win32'
const exe = windows ? '.exe' : ''

// The RGSS bridge is 32-bit because RPG Maker XP, VX and VX Ace games are.
const helpers = [
  { name: 'screen-ai-ocr', outputs: [`wenbu-screen-ai-ocr${exe}`] },
  ...(windows
    ? [
        { name: 'luna-hook', outputs: ['wenbu-luna-hook.exe'] },
        { name: 'keys', outputs: ['wenbu-keys.exe'] },
        {
          name: 'manga-engine',
          outputs: [
            'wenbu-manga-engine.exe',
            'wenbu-letter.dll',
            'onnxruntime.dll',
            'onnxruntime_providers_shared.dll',
            'DirectML.dll',
            'msvcp140.dll',
            'vcruntime140.dll',
            'vcruntime140_1.dll',
          ],
          licenses: true,
        },
        { name: 'speech', outputs: ['wenbu-speech.exe'], vulkan: true },
        {
          name: 'rgss-bridge',
          arch: 'Win32',
          outputs: ['wenbu-rgss.dll', 'wenbu-rgss-inject.exe'],
        },
      ]
    : []),
]

const target = `${process.platform}-${process.arch}`
const outDir = join(root, 'resources', 'native', target)

const visualStudioCmake = [
  'C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe',
  'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe',
]

const onPath = spawnSync('cmake', ['--version'], { stdio: 'ignore' }).status === 0

const findCmake = () => {
  const found = onPath
    ? 'cmake'
    : windows
      ? visualStudioCmake.find((candidate) => existsSync(candidate))
      : undefined

  if (found === undefined) {
    throw new Error(
      'CMake was not found. Install it, or Visual Studio Build Tools 2022 on Windows.',
    )
  }

  return found
}

const cmake = findCmake()

mkdirSync(outDir, { recursive: true })

for (const helper of helpers) {
  const arch = helper.arch ?? 'x64'
  const source = join(root, 'native', helper.name)
  const build = join(source, 'build', windows ? `win32-${arch}` : target)

  if (helper.vulkan && process.env.VULKAN_SDK === undefined) {
    throw new Error(
      `${helper.name} needs the Vulkan SDK. Install it (winget install KhronosGroup.VulkanSDK) and open a new terminal.`,
    )
  }

  const generator = windows ? ['-A', arch] : []

  execFileSync(cmake, ['-S', source, '-B', build, ...generator, '-DCMAKE_BUILD_TYPE=Release'], {
    stdio: 'inherit',
  })

  execFileSync(cmake, ['--build', build, '--config', 'Release'], { stdio: 'inherit' })

  for (const name of helper.outputs) {
    const built = windows ? join(build, 'Release', name) : join(build, name)

    copyFileSync(built, join(outDir, name))
    process.stdout.write(`Built ${join(outDir, name)}\n`)
  }

  if (helper.licenses) {
    cpSync(join(build, 'Release', 'licenses'), join(outDir, 'licenses'), { recursive: true })
  }
}

// WOLF RPG games are unpacked by UberWolf and their text read and patched by WolfTL. Both are MIT
// licensed; their pinned release builds are checked against these hashes.
const wolfTools = [
  {
    repo: 'Sinflower/UberWolf',
    tag: 'v0.6.4',
    asset: 'UberWolfCli.exe',
    sha256: '0c9645733ae9544df11ee0c859a7f2cb51aa547d5d13f7935cb480bdab96fb3a',
    licenses: [
      'LICENSE',
      '3rdParty/CLI11/LICENSE',
      '3rdParty/lz4/LICENSE',
      '3rdParty/nlohmann/LICENSE.MIT',
    ],
  },
  {
    repo: 'Sinflower/WolfTL',
    tag: 'v0.6.2',
    asset: 'WolfTL.exe',
    sha256: 'a66ffcdb8efa6340b6003cb0afe0cb2bcf3aba5c14499d0b67f8fb868bcfc276',
    licenses: [
      'LICENSE',
      'WolfTL/3rdParty/CLI11/LICENSE',
      'WolfTL/3rdParty/lz4/LICENSE',
      'WolfTL/3rdParty/nlohmann/LICENSE.MIT',
    ],
  },
]

const download = async (url) => {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${url} could not be downloaded: ${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

const wolfDir = join(outDir, 'wolf')
const wolfLicenseDir = join(outDir, 'licenses', 'wolf-tools')

const fetchLicense = async (tool, name, license) => {
  const text = await download(
    `https://raw.githubusercontent.com/${tool.repo}/${tool.tag}/${license}`,
  )

  const parts = license.split('/')
  const label = parts.length > 1 ? parts.at(-2) : name

  writeFileSync(join(wolfLicenseDir, `${name}-${label}-${parts.at(-1)}.txt`), text)
}

const fetchWolfTool = async (tool) => {
  const name = tool.repo.split('/')[1]

  const bytes = await download(
    `https://github.com/${tool.repo}/releases/download/${tool.tag}/${tool.asset}`,
  )

  const hash = createHash('sha256').update(bytes).digest('hex')

  if (hash !== tool.sha256) {
    throw new Error(`${tool.asset} ${tool.tag} does not match its pinned hash (got ${hash}).`)
  }

  writeFileSync(join(wolfDir, tool.asset), bytes)
  process.stdout.write(`Fetched ${join(wolfDir, tool.asset)}\n`)

  await Promise.all(tool.licenses.map((license) => fetchLicense(tool, name, license)))
}

if (windows) {
  mkdirSync(wolfDir, { recursive: true })
  mkdirSync(wolfLicenseDir, { recursive: true })

  await Promise.all(wolfTools.map((tool) => fetchWolfTool(tool)))
}

// pydensecrf publishes no Windows wheels, and users can't be expected to have a C++ compiler.
const pydensecrfCommit = '2723c7fa4f2ead16ae1ce3d8afe977724bb8f87f'

if (windows) {
  const build = join(root, 'native', 'pydensecrf', 'build')
  const archive = join(build, 'pydensecrf.zip')

  const response = await fetch(
    `https://github.com/lucasb-eyer/pydensecrf/archive/${pydensecrfCommit}.zip`,
  )

  if (!response.ok) {
    throw new Error(`pydensecrf could not be downloaded: ${response.status}`)
  }

  rmSync(build, { recursive: true, force: true })
  mkdirSync(build, { recursive: true })
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
  execFileSync('tar', ['-xf', archive, '-C', build], { stdio: 'inherit' })

  execFileSync(
    'uv',
    [
      'build',
      '--wheel',
      '--python',
      '3.11',
      '--out-dir',
      join(outDir, 'wheels'),
      join(build, `pydensecrf-${pydensecrfCommit}`),
    ],
    { stdio: 'inherit' },
  )
}
