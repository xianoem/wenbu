#include "Lettering.hpp"

#include <algorithm>
#include <cmath>
#include <cwctype>
#include <fstream>
#include <cctype>
#include <set>
#include <stdexcept>

#include <hb-ot.h>
#include <hb.h>
#include <icu.h>

#include "Fonts.hpp"
#include "LetterFonts.hpp"
#include "LetterLayout.hpp"
#include "PillowResize.hpp"
#include "Utf8.hpp"
#include "letter/Letter.h"

namespace engine {

namespace {

// Targets the plugin letters horizontally whatever the block's shape (LANGUAGE_ORIENTATION_PRESETS).
const std::set<std::string> horizontalTargets = {"CSY", "NLD", "ENG", "FRA", "DEU", "HUN", "ITA", "KOR", "PLK",
                                                 "PTB", "ROM", "RUS", "ESP", "TRK", "UKR", "VIN", "ARA", "FIL"};

std::optional<std::array<int, 3>> hexColour(const Json& options, const char* key) {
    const auto found = options.find(key);
    const std::string value = found != options.end() && found->is_string() ? found->get<std::string>() : std::string();

    if (value.size() != 6 || !std::all_of(value.begin(), value.end(), [](char c) { return std::isxdigit(static_cast<unsigned char>(c)); })) {
        return std::nullopt;
    }

    return std::array<int, 3>{std::stoi(value.substr(0, 2), nullptr, 16), std::stoi(value.substr(2, 2), nullptr, 16),
                              std::stoi(value.substr(4, 2), nullptr, 16)};
}

int numberOf(const Json& options, const char* key, int fallback) {
    const auto found = options.find(key);

    return found != options.end() && found->is_number() ? static_cast<int>(found->get<double>()) : fallback;
}

}

LetterOptions letterOptionsOf(const Json& options) {
    LetterOptions letter;
    const auto font = options.find("font_dir");

    letter.fontDir = font != options.end() && font->is_string() ? pathOf(font->get<std::string>()) : std::filesystem::path();
    letter.minFontSize = numberOf(options, "min_font_size", 12);
    letter.maxFontSize = numberOf(options, "max_font_size", 100);
    letter.supersampling = numberOf(options, "supersampling", 4);
    letter.border = !(options.contains("text_border") && options["text_border"] == false);
    letter.borderColor = hexColour(options, "border_color").value_or(std::array<int, 3>{255, 255, 255});
    letter.textColor = hexColour(options, "text_color");
    letter.uppercase = options.contains("uppercase") && options["uppercase"] == true;

    const auto family = options.find("font_family");

    if (family != options.end() && family->is_string() && !family->get<std::string>().empty()) {
        const auto cache = options.find("font_cache");

        if (cache == options.end() || !cache->is_string() || cache->get<std::string>().empty()) {
            throw std::runtime_error("An installed font needs a font cache folder.");
        }

        letter.fontFamily = family->get<std::string>();
        letter.fontCache = pathOf(cache->get<std::string>());
    }

    return letter;
}

bool lettersHorizontally(const std::string& target) {
    return horizontalTargets.contains(target);
}

namespace {

constexpr double defaultBorderWidth = 2;
constexpr double editorPadding = 0.02;
constexpr double fallbackPadding = 0.08;
constexpr double safePadding = 5;

std::vector<uint8_t> readBytes(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);

    if (!stream) {
        throw std::runtime_error("The font " + file.string() + " could not be read.");
    }

    return std::vector<uint8_t>((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
}

std::set<std::string> featureTags(hb_face_t* face, hb_tag_t table) {
    std::set<std::string> tags;
    unsigned int start = 0;

    for (;;) {
        hb_tag_t batch[64];
        unsigned int count = 64;

        hb_ot_layout_table_get_feature_tags(face, table, start, &count, batch);

        for (unsigned int i = 0; i < count; i++) {
            char name[5] = {};

            hb_tag_to_string(batch[i], name);
            tags.insert(name);
        }

        if (count < 64) {
            return tags;
        }

        start += count;
    }
}

// Python's str.splitlines: \r\n counts as one break.
std::vector<Text> splitLines(const Text& text) {
    static const Text breaks = U"\n\x0b\x0c\r\x1c\x1d\x1e\x85  ";
    std::vector<Text> lines;
    Text current;
    char32_t previous = 0;

    for (const char32_t character : text) {
        const bool isBreak = breaks.find(character) != Text::npos;

        if (isBreak && !(character == U'\n' && previous == U'\r')) {
            lines.push_back(current);
            current.clear();
        } else if (!isBreak) {
            current += character;
        }

        previous = character;
    }

    if (!current.empty()) {
        lines.push_back(current);
    }

    return lines;
}

Text joined(const std::vector<Text>& words, const Text& separator) {
    Text text;

    for (size_t i = 0; i < words.size(); i++) {
        text += (i == 0 ? Text() : separator) + words[i];
    }

    return text;
}

Text upper(const Text& text) {
    std::u16string utf16;

    for (const char32_t c : text) {
        if (c >= 0x10000) {
            utf16.push_back(static_cast<char16_t>(0xD800 + ((c - 0x10000) >> 10)));
            utf16.push_back(static_cast<char16_t>(0xDC00 + ((c - 0x10000) & 0x3FF)));
        } else {
            utf16.push_back(static_cast<char16_t>(c));
        }
    }

    UErrorCode status = U_ZERO_ERROR;
    std::u16string result(utf16.size() * 3 + 4, u'\0');
    const int32_t length = u_strToUpper(reinterpret_cast<UChar*>(result.data()), static_cast<int32_t>(result.size()),
                                        reinterpret_cast<const UChar*>(utf16.data()), static_cast<int32_t>(utf16.size()),
                                        "", &status);

    if (U_FAILURE(status)) {
        return text;
    }

    result.resize(static_cast<size_t>(length));

    Text out;

    for (size_t i = 0; i < result.size(); i++) {
        const char16_t unit = result[i];

        if (unit >= 0xD800 && unit <= 0xDBFF && i + 1 < result.size()) {
            out.push_back(0x10000 + ((static_cast<char32_t>(unit) - 0xD800) << 10) + (result[i + 1] - 0xDC00));
            i++;
        } else {
            out.push_back(unit);
        }
    }

    return out;
}

// is_rtl_script: more Arabic, Hebrew, Syriac-area or N'Ko characters than others, spaces and markers aside.
bool isRightToLeft(const Text& text) {
    int rightToLeft = 0;
    int leftToRight = 0;

    for (const char32_t c : text) {
        if (isSpace(c) || c == U'*') {
            continue;
        }

        const bool arabic = (c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) || (c >= 0x08A0 && c <= 0x08FF) ||
                            (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF);
        const bool hebrew = (c >= 0x0590 && c <= 0x05FF) || (c >= 0xFB1D && c <= 0xFB4F);
        const bool other = (c >= 0x0780 && c <= 0x07BF) || (c >= 0x07C0 && c <= 0x07FA);

        if (arabic || hebrew || other) {
            rightToLeft++;
        } else {
            leftToRight++;
        }
    }

    return rightToLeft > leftToRight;
}

// JavaScript's String.prototype.trim, as the editor decides whether a block has a translation.
bool blank(const std::string& text) {
    const Text points = decodeUtf8(text);

    return std::all_of(points.begin(), points.end(), [](char32_t c) { return isSpace(c) || c == 0xFEFF; });
}

}

struct Lettering::Font {
    std::vector<uint8_t> data;
    hb_blob_t* blob = nullptr;
    hb_face_t* face = nullptr;
    WenbuTypeface* typeface = nullptr;
    std::set<char32_t> codepoints;
    std::set<std::string> gpos;
    std::set<std::string> gsub;

    explicit Font(const std::filesystem::path& file) {
        std::vector<uint8_t> raw = readBytes(file);
        hb_blob_t* rawBlob = hb_blob_create(reinterpret_cast<const char*>(raw.data()), static_cast<unsigned int>(raw.size()),
                                            HB_MEMORY_MODE_READONLY, nullptr, nullptr);
        hb_face_t* rawFace = hb_face_create(rawBlob, 0);
        hb_font_t* rawFont = hb_font_create(rawFace);
        const int upem = static_cast<int>(hb_face_get_upem(rawFace));
        GlyphMetrics metrics;
        hb_codepoint_t glyph = 0;

        hb_font_set_scale(rawFont, upem, upem);

        if (hb_font_get_nominal_glyph(rawFont, U'M', &glyph)) {
            metrics.glyphOfM = glyph;
        }

        metrics.xMax = [rawFont](uint32_t id) -> std::optional<int> {
            hb_glyph_extents_t extents;

            if (!hb_font_get_glyph_extents(rawFont, id, &extents)) {
                return std::nullopt;
            }

            return extents.x_bearing + extents.width;
        };
        metrics.advance = [rawFont](uint32_t id) { return static_cast<int>(hb_font_get_glyph_h_advance(rawFont, id)); };
        data = sanitizedFont(raw, metrics);
        hb_font_destroy(rawFont);
        hb_face_destroy(rawFace);
        hb_blob_destroy(rawBlob);

        blob = hb_blob_create(reinterpret_cast<const char*>(data.data()), static_cast<unsigned int>(data.size()),
                              HB_MEMORY_MODE_READONLY, nullptr, nullptr);
        face = hb_face_create(blob, 0);
        typeface = wenbu_letter_typeface(data.data(), data.size());

        if (typeface == nullptr) {
            throw std::runtime_error("The font " + file.string() + " could not be read.");
        }

        hb_set_t* set = hb_set_create();
        hb_codepoint_t codepoint = HB_SET_VALUE_INVALID;

        hb_face_collect_unicodes(face, set);

        while (hb_set_next(set, &codepoint)) {
            codepoints.insert(codepoint);
        }

        hb_set_destroy(set);
        gpos = featureTags(face, HB_OT_TAG_GPOS);
        gsub = featureTags(face, HB_OT_TAG_GSUB);
    }

    ~Font() {
        wenbu_letter_typeface_free(typeface);
        hb_face_destroy(face);
        hb_blob_destroy(blob);
    }

    Font(const Font&) = delete;
    Font& operator=(const Font&) = delete;

    std::vector<hb_feature_t> features() const {
        const auto feature = [](const char* tag, bool on) {
            return hb_feature_t{hb_tag_from_string(tag, 4), on ? 1u : 0u, HB_FEATURE_GLOBAL_START, HB_FEATURE_GLOBAL_END};
        };

        return {feature("kern", gpos.contains("kern")), feature("liga", false), feature("calt", gsub.contains("calt"))};
    }

    struct Shaped {
        std::vector<uint16_t> glyphs;
        std::vector<hb_glyph_position_t> positions;
    };

    Shaped shape(const Text& text, double size, const std::vector<hb_feature_t>& features) const {
        hb_font_t* font = hb_font_create(face);
        const int scale = static_cast<int>(std::trunc(size * 64));
        hb_buffer_t* buffer = hb_buffer_create();
        const std::string utf8 = encodeUtf8(text);
        Shaped shaped;
        unsigned int count = 0;

        hb_font_set_scale(font, scale, scale);
        hb_buffer_add_utf8(buffer, utf8.data(), static_cast<int>(utf8.size()), 0, static_cast<int>(utf8.size()));
        hb_buffer_guess_segment_properties(buffer);
        hb_shape(font, buffer, features.data(), static_cast<unsigned int>(features.size()));

        const hb_glyph_info_t* infos = hb_buffer_get_glyph_infos(buffer, &count);
        const hb_glyph_position_t* positions = hb_buffer_get_glyph_positions(buffer, &count);

        for (unsigned int i = 0; i < count; i++) {
            shaped.glyphs.push_back(static_cast<uint16_t>(infos[i].codepoint));
            shaped.positions.push_back(positions[i]);
        }

        hb_buffer_destroy(buffer);
        hb_font_destroy(font);

        return shaped;
    }
};

struct Lettering::Family {
    std::unique_ptr<Font> regular;
    std::map<Style, std::unique_ptr<Font>> styled;

    // The font a measured segment uses: its own style when the family has it, else the regular.
    const Font& measured(Style style) const {
        const auto found = styled.find(style);

        return found != styled.end() ? *found->second : *regular;
    }

    // The font a drawn segment uses; bold italic falls back to bold, then italic.
    const Font& drawn(Style style) const {
        if (style == Style::BoldItalic) {
            for (const Style fallback : {Style::BoldItalic, Style::Bold, Style::Italic}) {
                if (const auto found = styled.find(fallback); found != styled.end()) {
                    return *found->second;
                }
            }

            return *regular;
        }

        return measured(style);
    }
};

struct Lettering::Plan {
    Layout layout;
    const Family* family = nullptr;
    std::vector<hb_feature_t> features;
    double centreX = 0;
    double centreY = 0;
};

Lettering::Lettering() = default;

Lettering::~Lettering() = default;

Lettering::Family& Lettering::familyOf(const std::filesystem::path& folder) {
    std::scoped_lock guard(lock_);

    if (const auto found = families_.find(folder); found != families_.end()) {
        return *found->second;
    }

    std::vector<std::filesystem::path> ttf;
    std::vector<std::filesystem::path> otf;
    std::error_code error;

    for (const auto& entry : std::filesystem::directory_iterator(folder, error)) {
        std::wstring extension = entry.path().extension().wstring();

        std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });

        if (extension == L".ttf") {
            ttf.push_back(entry.path());
        } else if (extension == L".otf") {
            otf.push_back(entry.path());
        }
    }

    if (error) {
        throw std::runtime_error("The font folder " + folder.string() + " could not be read.");
    }

    ttf.insert(ttf.end(), otf.begin(), otf.end());

    const std::map<Style, std::filesystem::path> variants = fontVariants(ttf);

    if (!variants.contains(Style::Regular)) {
        throw std::runtime_error("No font was found in " + folder.string() + ".");
    }

    auto family = std::make_unique<Family>();

    family->regular = std::make_unique<Font>(variants.at(Style::Regular));

    for (const Style style : {Style::Italic, Style::Bold, Style::BoldItalic}) {
        if (const auto file = variants.find(style); file != variants.end()) {
            family->styled[style] = std::make_unique<Font>(file->second);
        }
    }

    return *families_.emplace(folder, std::move(family)).first->second;
}

std::optional<Lettering::Plan> Lettering::planBlock(const LetterBlock& block, const LetterBox& box,
                                                    const std::optional<std::vector<uint8_t>>& mask,
                                                    const LetterOptions& options, const std::optional<LineBreaking>& override) {
    const std::optional<LetterSettings>& lettering = block.lettering;
    const auto [x1, y1, x2, y2] = box;
    const int boxWidth = x2 - x1;
    const int boxHeight = y2 - y1;

    if (boxWidth <= 0 || boxHeight <= 0) {
        return std::nullopt;
    }

    const bool uppercase = lettering && lettering->uppercase ? *lettering->uppercase : options.uppercase;
    Text translation = decodeUtf8(block.region.translation);

    if (!lettering || lettering->breakMode.value_or(BreakMode::Balanced) != BreakMode::Manual) {
        translation = joined(splitWords(translation), U" ");
    }

    if (uppercase) {
        translation = upper(translation);
    }

    std::replace(translation.begin(), translation.end(), U'—', U'-');

    std::vector<Text> kept;

    for (const Text& line : splitLines(translation)) {
        const std::vector<Text> words = splitWords(line);

        if (!words.empty()) {
            kept.push_back(joined(words, U" "));
        }
    }

    const Text text = joined(kept, U"\n");

    if (text.empty()) {
        return std::nullopt;
    }

    const Family& family = familyOf(lettering && lettering->fontDir ? *lettering->fontDir : options.fontDir);
    const Font& regular = *family.regular;
    Text layoutText;

    for (const char32_t character : text) {
        if (character == U'*' || character == U' ' || character == U'\t' || character == U'\n' || character == U'\r' ||
            regular.codepoints.contains(character)) {
            layoutText += character;
        }
    }

    if (splitWords(layoutText).empty()) {
        return std::nullopt;
    }

    const double padding = lettering ? editorPadding : fallbackPadding;
    const std::optional<std::array<int, 4>> safe =
        mask ? safeArea(*mask, boxWidth, boxHeight, safePadding) : std::nullopt;
    double maxWidth = 0;
    double maxHeight = 0;
    double centreX = 0;
    double centreY = 0;

    if (!safe) {
        maxWidth = boxWidth * (1 - 2 * padding);
        maxHeight = boxHeight * (1 - 2 * padding);

        if (maxWidth <= 0 || maxHeight <= 0) {
            maxWidth = std::max(1, boxWidth);
            maxHeight = std::max(1, boxHeight);
        }

        centreX = x1 + boxWidth / 2.0;
        centreY = y1 + boxHeight / 2.0;
    } else {
        const auto [sx, sy, sw, sh] = *safe;

        maxWidth = sw;
        maxHeight = sh;
        centreX = x1 + sx + sw / 2.0;
        centreY = y1 + sy + sh / 2.0;
    }

    const std::vector<hb_feature_t> features = regular.features();
    auto widths = std::make_shared<std::map<std::pair<int, Text>, double>>();
    Measure measure;

    measure.width = [&family, &features, widths](const Text& line, int size) {
        const auto key = std::pair{size, line};

        if (const auto cached = widths->find(key); cached != widths->end()) {
            return cached->second;
        }

        double advance = 0;
        std::optional<double> first;
        double last = 0;

        for (const auto& [segment, style] : parseStyledSegments(line)) {
            const Font::Shaped shaped = family.measured(style).shape(segment, size, features);

            if (shaped.positions.empty()) {
                continue;
            }

            for (const auto& position : shaped.positions) {
                advance += position.x_advance;
            }

            if (!first) {
                first = shaped.positions.front().x_offset;
            }

            last = shaped.positions.back().x_offset;
        }

        const double width = (advance + (last - first.value_or(0))) / 64;

        widths->emplace(key, width);

        return width;
    };
    measure.metrics = [&regular](int size) { return lineMetrics(regular.data, size); };

    LineBreaking breaking;

    if (override) {
        breaking = *override;
    } else if (lettering) {
        breaking.mode = lettering->breakMode.value_or(BreakMode::Balanced);
        breaking.avoidOrphans = lettering->avoidOrphans.value_or(true);
        breaking.evenOut = breaking.mode == BreakMode::Balanced;
    }

    LayoutOptions layoutOptions;
    const std::optional<int> size = lettering ? lettering->size : std::nullopt;

    layoutOptions.minFontSize = size.value_or(options.minFontSize);
    layoutOptions.maxFontSize = size.value_or(options.maxFontSize);
    layoutOptions.lineSpacing = lettering && lettering->leading ? *lettering->leading : 1;
    layoutOptions.hyphenate = lettering && lettering->hyphenate ? *lettering->hyphenate : true;
    layoutOptions.breaks = BreakOptions{breaking, 3, 1000, true};

    std::optional<Balloon> balloon;

    if (safe && mask) {
        balloon = Balloon{&*mask, boxWidth, boxHeight, (*safe)[0], (*safe)[1]};
    }

    std::optional<Layout> layout = optimalLayout(layoutText, maxWidth, maxHeight, measure, layoutOptions, balloon, mask.has_value());

    if (!layout) {
        return std::nullopt;
    }

    return Plan{*layout, &family, features, centreX, centreY};
}

void Lettering::letterBlock(Rgb& page, const LetterBlock& block, const Geometry& geometry, const LetterOptions& options) {
    const auto [x1, y1, x2, y2] = geometry.box;
    const std::optional<Plan> plan = planBlock(block, geometry.box, geometry.mask, options, std::nullopt);

    if (!plan) {
        return;
    }

    const int cx1 = std::max(0, x1);
    const int cy1 = std::max(0, y1);
    const int cx2 = std::min(page.width, x2);
    const int cy2 = std::min(page.height, y2);
    const int cropWidth = cx2 - cx1;
    const int cropHeight = cy2 - cy1;
    const int factor = std::max(1, options.supersampling);
    const Rgb region = cropImage(page, cx1, cy1, cx2, cy2);
    const Rgb large = factor == 1 ? region : pillowResize(region, cropWidth * factor, cropHeight * factor, Filter::Lanczos);
    std::vector<uint8_t> bgra(static_cast<size_t>(large.width) * large.height * 4);

    for (size_t p = 0; p < static_cast<size_t>(large.width) * large.height; p++) {
        bgra[p * 4] = large.data[p * 3 + 2];
        bgra[p * 4 + 1] = large.data[p * 3 + 1];
        bgra[p * 4 + 2] = large.data[p * 3];
        bgra[p * 4 + 3] = 255;
    }

    // draw_layout: the lines centred on the target, each line centred in the widest, laid around the origin
    // when the canvas turns.
    const Layout& layout = plan->layout;
    const double fontSize = static_cast<double>(layout.fontSize) * factor;
    const double ascent = layout.metrics.ascent * factor;
    const double descent = layout.metrics.descent * factor;
    const double lineHeight = layout.lineHeight * factor;
    const double maxLineWidth = layout.maxLineWidth * factor;
    const double rotation = block.region.angle;
    const bool rotated = std::abs(rotation) > 0.01;
    const double centreX = (plan->centreX - cx1) * factor;
    const double centreY = (plan->centreY - cy1) * factor;
    const double originX = rotated ? 0 : centreX;
    const double originY = rotated ? 0 : centreY;
    const double blockLeft = originX - maxLineWidth / 2;
    const double totalHeight = (static_cast<double>(layout.lines.size()) - 1) * lineHeight - ascent + descent;
    double baseline = originY - totalHeight / 2 - ascent;
    std::vector<std::vector<uint16_t>> glyphs;
    std::vector<std::vector<float>> points;
    std::vector<const Font*> fonts;

    for (const LayoutLine& line : layout.lines) {
        // A right-to-left line starts at its right edge, and each segment goes to the left of the last.
        const bool rightToLeft = isRightToLeft(line.textWithMarkers);
        double cursor = blockLeft + (maxLineWidth - line.width * factor) / 2 + (rightToLeft ? line.width * factor : 0);

        for (const auto& [segment, style] : parseStyledSegments(line.textWithMarkers)) {
            const Font& font = plan->family->drawn(style);
            const Font::Shaped shaped = font.shape(segment, fontSize, plan->features);

            if (shaped.glyphs.empty()) {
                continue;
            }

            double width = 0;

            for (const auto& position : shaped.positions) {
                width += position.x_advance / 64.0;
            }

            if (rightToLeft) {
                cursor -= width;
            }

            std::vector<float> at;
            double advance = 0;

            for (const auto& position : shaped.positions) {
                at.push_back(static_cast<float>(cursor + advance + position.x_offset / 64.0));
                at.push_back(static_cast<float>(baseline - position.y_offset / 64.0));
                advance += position.x_advance / 64.0;
            }

            glyphs.push_back(shaped.glyphs);
            points.push_back(std::move(at));
            fonts.push_back(&font);

            if (!rightToLeft) {
                cursor += width;
            }
        }

        baseline += lineHeight;
    }

    std::vector<WenbuGlyphRun> runs;

    for (size_t i = 0; i < glyphs.size(); i++) {
        runs.push_back({fonts[i]->typeface, static_cast<float>(fontSize), static_cast<int>(glyphs[i].size()), glyphs[i].data(),
                        points[i].data()});
    }

    const std::array<int, 3> colour = options.textColor.value_or(block.fg);
    WenbuDrawing drawing{};

    for (int c = 0; c < 3; c++) {
        drawing.fill[c] = static_cast<uint8_t>(colour[c]);
        drawing.stroke[c] = static_cast<uint8_t>(options.borderColor[c]);
    }

    drawing.fill[3] = 255;
    drawing.stroke[3] = 255;
    drawing.strokeWidth = options.border ? static_cast<float>(defaultBorderWidth * factor) : 0;
    drawing.subpixel = 1;
    drawing.rotation = rotated ? static_cast<float>(rotation) : 0;
    drawing.pivotX = static_cast<float>(centreX);
    drawing.pivotY = static_cast<float>(centreY);

    if (!runs.empty() && wenbu_letter_draw(bgra.data(), large.width, large.height, runs.data(), static_cast<int>(runs.size()), &drawing) != 0) {
        return;
    }

    Rgb drawn{large.width, large.height, std::vector<uint8_t>(static_cast<size_t>(large.width) * large.height * 3)};

    for (size_t p = 0; p < static_cast<size_t>(large.width) * large.height; p++) {
        drawn.data[p * 3] = bgra[p * 4 + 2];
        drawn.data[p * 3 + 1] = bgra[p * 4 + 1];
        drawn.data[p * 3 + 2] = bgra[p * 4];
    }

    const Rgb small = factor == 1 ? drawn : pillowResize(drawn, cropWidth, cropHeight, Filter::Lanczos);

    for (int row = 0; row < cropHeight; row++) {
        std::copy(small.data.begin() + static_cast<long>(row) * cropWidth * 3, small.data.begin() + static_cast<long>(row + 1) * cropWidth * 3,
                  page.data.begin() + (static_cast<long>(cy1 + row) * page.width + cx1) * 3);
    }
}

Rgb Lettering::render(const Rgb& page, const Rgb& original, const std::vector<LetterBlock>& blocks, const LetterOptions& options) {
    std::vector<const LetterBlock*> shown;
    std::vector<LetterRegion> regions;
    std::vector<Geometry> geometries;

    for (const LetterBlock& block : blocks) {
        if (!blank(block.region.translation)) {
            shown.push_back(&block);
            regions.push_back(block.region);
            geometries.push_back(renderGeometry(original, block.region));
        }
    }

    if (shown.empty()) {
        return page;
    }

    const std::vector<Geometry> constrained = constrainGeometries(regions, geometries);
    Rgb result = page;

    for (size_t index = 0; index < shown.size(); index++) {
        letterBlock(result, *shown[index], constrained[index], options);
    }

    return result;
}

std::vector<BreakCandidate> Lettering::breaks(const Rgb& original, const LetterBlock& block, const LetterOptions& options) {
    const LetterBox box = renderGeometry(original, block.region).box;
    const auto [x1, y1, x2, y2] = box;
    const int narrow = static_cast<int>(std::trunc((x2 - x1) * 0.1));
    const bool avoidOrphans = block.lettering && block.lettering->avoidOrphans ? *block.lettering->avoidOrphans : true;
    const std::vector<std::pair<BreakMode, LetterBox>> tries = {
        {BreakMode::Balanced, box}, {BreakMode::Greedy, box}, {BreakMode::Balanced, {x1 + narrow, y1, x2 - narrow, y2}}};
    std::vector<BreakCandidate> candidates;

    for (const auto& [mode, tried] : tries) {
        const std::optional<Plan> plan =
            planBlock(block, tried, std::nullopt, options, LineBreaking{mode, avoidOrphans, mode == BreakMode::Balanced});

        if (!plan || plan->layout.lines.empty()) {
            continue;
        }

        std::vector<std::string> lines;

        for (const LayoutLine& line : plan->layout.lines) {
            lines.push_back(encodeUtf8(line.textWithMarkers));
        }

        if (std::none_of(candidates.begin(), candidates.end(), [&](const BreakCandidate& candidate) { return candidate.lines == lines; })) {
            candidates.push_back({lines, plan->layout.fontSize});
        }
    }

    return candidates;
}

}
