/* wenbu-letter: Skia (m145, DirectWrite font manager) behind a small C interface. It draws shaped glyph
 * runs onto BGRA pixels the way the manga plugin's skia-python renderer does. Skia carries its own
 * libpng and libjpeg-turbo, so it stays in this DLL, apart from the engine's codecs. */
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef WENBU_LETTER_EXPORTS
#define WENBU_LETTER_API __declspec(dllexport)
#else
#define WENBU_LETTER_API __declspec(dllimport)
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct WenbuTypeface WenbuTypeface;

/* A typeface from font file bytes, or NULL when DirectWrite cannot read them. */
WENBU_LETTER_API WenbuTypeface* wenbu_letter_typeface(const uint8_t* data, size_t size);
WENBU_LETTER_API void wenbu_letter_typeface_free(WenbuTypeface* typeface);

/* Line metrics as Skia reports them: ascent (negative), descent and leading, for a font size. */
WENBU_LETTER_API void wenbu_letter_metrics(const WenbuTypeface* typeface, float size, float* ascent, float* descent,
                                           float* leading);

/* Glyph ids for code points, for tests; the engine shapes with HarfBuzz. */
WENBU_LETTER_API void wenbu_letter_glyphs(const WenbuTypeface* typeface, const int32_t* codepoints, int count,
                                          uint16_t* glyphs);

typedef struct WenbuGlyphRun {
    const WenbuTypeface* typeface;
    float size;
    int count;
    const uint16_t* glyphs;
    /* x, y pairs, one per glyph. */
    const float* positions;
} WenbuGlyphRun;

typedef struct WenbuDrawing {
    /* Unpremultiplied RGBA colours. */
    uint8_t fill[4];
    uint8_t stroke[4];
    /* 0 for no outline; drawn first, with round joins. */
    float strokeWidth;
    int subpixel;
    /* The canvas turns by `rotation` degrees about (pivotX, pivotY) when rotation is not 0. */
    float rotation;
    float pivotX;
    float pivotY;
} WenbuDrawing;

/* Draws the runs onto premultiplied BGRA pixels (rows packed). Returns 0 on success. */
WENBU_LETTER_API int wenbu_letter_draw(uint8_t* bgra, int width, int height, const WenbuGlyphRun* runs, int count,
                                       const WenbuDrawing* drawing);

#ifdef __cplusplus
}
#endif
