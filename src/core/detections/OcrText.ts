import type { OcrResult } from '#contract/Detections'

export const ocrText = (ocr: OcrResult) =>
  ocr.paragraphs
    .map((paragraph) =>
      paragraph.lines
        .map((line) => line.text.trim())
        .filter((line) => line !== '')
        .join('\n'),
    )
    .filter((paragraph) => paragraph !== '')
    .join('\n\n')
