#include "Letter.h"

#include <memory>

#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPaint.h"
#include "include/core/SkTextBlob.h"
#include "include/core/SkTypeface.h"
#include "include/ports/SkTypeface_win.h"

struct WenbuTypeface {
    sk_sp<SkTypeface> typeface;
};

namespace {

sk_sp<SkFontMgr> fontManager() {
    static const sk_sp<SkFontMgr> manager = SkFontMgr_New_DirectWrite();

    return manager;
}

SkColor colourOf(const uint8_t rgba[4]) {
    return SkColorSetARGB(rgba[3], rgba[0], rgba[1], rgba[2]);
}

SkFont fontOf(const WenbuTypeface* typeface, float size, bool subpixel) {
    SkFont font(typeface->typeface, size);

    font.setSubpixel(subpixel);
    font.setHinting(SkFontHinting::kNone);

    return font;
}

}

extern "C" {

WenbuTypeface* wenbu_letter_typeface(const uint8_t* data, size_t size) {
    sk_sp<SkTypeface> typeface = fontManager()->makeFromData(SkData::MakeWithCopy(data, size));

    return typeface == nullptr ? nullptr : new WenbuTypeface{std::move(typeface)};
}

void wenbu_letter_typeface_free(WenbuTypeface* typeface) {
    delete typeface;
}

void wenbu_letter_metrics(const WenbuTypeface* typeface, float size, float* ascent, float* descent, float* leading) {
    SkFontMetrics metrics{};

    SkFont(typeface->typeface, size).getMetrics(&metrics);
    *ascent = metrics.fAscent;
    *descent = metrics.fDescent;
    *leading = metrics.fLeading;
}

void wenbu_letter_glyphs(const WenbuTypeface* typeface, const int32_t* codepoints, int count, uint16_t* glyphs) {
    typeface->typeface->unicharsToGlyphs({reinterpret_cast<const SkUnichar*>(codepoints), static_cast<size_t>(count)},
                                         {glyphs, static_cast<size_t>(count)});
}

int wenbu_letter_draw(uint8_t* bgra, int width, int height, const WenbuGlyphRun* runs, int count,
                      const WenbuDrawing* drawing) {
    const SkImageInfo info = SkImageInfo::Make(width, height, kBGRA_8888_SkColorType, kPremul_SkAlphaType);
    std::unique_ptr<SkCanvas> canvas = SkCanvas::MakeRasterDirect(info, bgra, static_cast<size_t>(width) * 4);

    if (canvas == nullptr) {
        return 1;
    }

    const bool rotated = drawing->rotation > 0.01f || drawing->rotation < -0.01f;

    if (rotated) {
        canvas->save();
        canvas->translate(drawing->pivotX, drawing->pivotY);
        canvas->rotate(drawing->rotation);
    }

    SkPaint fill;

    fill.setAntiAlias(true);
    fill.setColor(colourOf(drawing->fill));

    SkPaint stroke;

    stroke.setAntiAlias(true);
    stroke.setColor(colourOf(drawing->stroke));
    stroke.setStyle(SkPaint::kStroke_Style);
    stroke.setStrokeWidth(drawing->strokeWidth);
    stroke.setStrokeJoin(SkPaint::kRound_Join);

    // One text blob per run, as the plugin's allocRunPos and drawTextBlob do.
    for (int index = 0; index < count; ++index) {
        const WenbuGlyphRun& run = runs[index];
        SkTextBlobBuilder builder;
        const auto& buffer = builder.allocRunPos(fontOf(run.typeface, run.size, drawing->subpixel != 0), run.count);

        for (int glyph = 0; glyph < run.count; ++glyph) {
            buffer.glyphs[glyph] = run.glyphs[glyph];
            buffer.points()[glyph] = SkPoint::Make(run.positions[glyph * 2], run.positions[glyph * 2 + 1]);
        }

        const sk_sp<SkTextBlob> blob = builder.make();

        if (blob == nullptr) {
            continue;
        }

        if (drawing->strokeWidth > 0) {
            canvas->drawTextBlob(blob, 0, 0, stroke);
        }

        canvas->drawTextBlob(blob, 0, 0, fill);
    }

    if (rotated) {
        canvas->restore();
    }

    return 0;
}

}
