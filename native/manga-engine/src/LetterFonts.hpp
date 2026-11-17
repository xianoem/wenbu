// Fonts as the lettering loads them (wenbu_manga/skia/font_manager.py): which file in a folder is the
// regular, bold and italic face, the plugin's clean-up of the font data before shaping and drawing, and the
// line metrics Skia reports through DirectWrite.
#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <optional>
#include <vector>

#include "LineBreaking.hpp"

namespace engine {

// find_font_variants: `files` are the folder's .ttf then .otf files in directory order.
std::map<Style, std::filesystem::path> fontVariants(const std::vector<std::filesystem::path>& files);

struct GlyphMetrics {
    // The glyph for "M" in the best cmap, if the font has one.
    std::optional<uint32_t> glyphOfM;
    // That glyph's right edge, in font units.
    std::function<std::optional<int>(uint32_t)> xMax;
    std::function<int(uint32_t)> advance;
};

// sanitize_font_data: drops the legacy `kern` table, and sets 1000 units per em when "M" draws past its
// advance.
std::vector<uint8_t> sanitizedFont(const std::vector<uint8_t>& data, const GlyphMetrics& metrics);

struct LineMetrics {
    // Negative, above the baseline.
    double ascent = 0;
    double descent = 0;
    double leading = 0;
};

LineMetrics lineMetrics(const std::vector<uint8_t>& data, double size);

}
