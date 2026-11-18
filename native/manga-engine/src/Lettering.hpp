// The lettering renderer (wenbu_manga/skia): HarfBuzz shapes, the layout search picks the font size and
// line breaks, and Skia with DirectWrite draws the glyphs four times larger before LANCZOS brings them back,
// as the plugin's skia-python renderer does.
#pragma once

#include <array>
#include <filesystem>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "Images.hpp"
#include "LetterGeometry.hpp"
#include "LineBreaking.hpp"
#include "Protocol.hpp"

namespace engine {

struct LetterOptions {
    std::filesystem::path fontDir;
    // An installed font from the settings, which runs letter with in place of `fontDir`.
    std::string fontFamily;
    std::filesystem::path fontCache;
    int minFontSize = 12;
    int maxFontSize = 100;
    int supersampling = 4;
    bool border = true;
    std::array<int, 3> borderColor{255, 255, 255};
    // A colour for all text, or nothing to use each block's own.
    std::optional<std::array<int, 3>> textColor;
    bool uppercase = false;
};

// The editor's lettering settings for one block.
struct LetterSettings {
    std::optional<BreakMode> breakMode;
    std::optional<bool> avoidOrphans;
    std::optional<bool> hyphenate;
    std::optional<bool> uppercase;
    std::optional<int> size;
    std::optional<std::filesystem::path> fontDir;
    std::optional<double> leading;
};

struct LetterBlock {
    LetterRegion region;
    std::array<int, 3> fg{0, 0, 0};
    std::array<int, 3> bg{255, 255, 255};
    // Present, even empty, for every block the editor sends; absent in folder runs.
    std::optional<LetterSettings> lettering;
};

// The letter_options of a request: font_dir, min_font_size, max_font_size, supersampling, text_border,
// border_color, text_color and uppercase.
LetterOptions letterOptionsOf(const Json& options);

// Targets the plugin letters horizontally whatever the block's shape (LANGUAGE_ORIENTATION_PRESETS).
bool lettersHorizontally(const std::string& target);

struct BreakCandidate {
    std::vector<std::string> lines;
    int fontSize = 0;
};

class Lettering {
public:
    Lettering();
    ~Lettering();

    Rgb render(const Rgb& page, const Rgb& original, const std::vector<LetterBlock>& blocks, const LetterOptions& options);

    // layout_candidates: balanced, greedy, and balanced in a box 10% narrower on each side.
    std::vector<BreakCandidate> breaks(const Rgb& original, const LetterBlock& block, const LetterOptions& options);

    struct Font;
    struct Family;

private:
    struct Plan;

    Family& familyOf(const std::filesystem::path& folder);
    std::optional<Plan> planBlock(const LetterBlock& block, const LetterBox& box, const std::optional<std::vector<uint8_t>>& mask,
                                  const LetterOptions& options, const std::optional<LineBreaking>& override);
    void letterBlock(Rgb& page, const LetterBlock& block, const Geometry& geometry, const LetterOptions& options);

    std::mutex lock_;
    std::map<std::filesystem::path, std::unique_ptr<Family>> families_;
};

}
