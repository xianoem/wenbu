import { Effect, Option, Path } from 'effect'
import { bundledFonts, type MangaSettings } from '#contract/Manga'
import { readManifest } from '../plugins/definitions/MangaImageTranslator'

export interface MangaFolders {
  readonly resources: string
  readonly dataDir: string
}

const fontOptions = (settings: MangaSettings, folders: MangaFolders, path: Path.Path) =>
  bundledFonts.some((font) => font === settings.font)
    ? { font_dir: path.join(folders.resources, 'fonts', settings.font) }
    : {
        font_dir: path.join(folders.resources, 'fonts', bundledFonts[0]),
        font_family: settings.font,
        font_cache: path.join(folders.dataDir, 'manga-fonts'),
      }

export const workerOptions = Effect.fn('MangaOptions.workerOptions')(function* (
  settings: MangaSettings,
  plugin: string,
  folders: MangaFolders,
) {
  const path = yield* Path.Path
  const manifest = yield* readManifest(plugin)

  const gpu = Option.match(manifest, {
    onNone: () => false,
    onSome: (found) => found.torchBackend !== 'cpu',
  })

  return {
    model_dir: path.join(plugin, 'models'),
    ...fontOptions(settings, folders, path),
    use_gpu: settings.useGpu && gpu,
    target_language: settings.targetLanguage,
    detection_size: settings.detectionSize,
    inpainting: settings.inpainting,
    inpainting_size: settings.inpaintingSize,
    supersampling: settings.supersampling,
    min_font_size: settings.minFontSize,
    max_font_size: settings.maxFontSize,
    text_color: settings.textColor === 'auto' ? '' : settings.textColor.slice(1),
    text_border: settings.textBorder,
    border_color: settings.borderColor.slice(1),
    uppercase: settings.uppercase,
    output_format: settings.outputFormat === 'jpeg' ? 'jpeg' : settings.outputFormat,
    output_quality: settings.outputQuality,
    pages_ahead: settings.pagesAhead,
    translation_requests: settings.parallelRequests,
  }
})
