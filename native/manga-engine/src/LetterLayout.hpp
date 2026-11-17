// The lettering's layout search (wenbu_manga/skia/layout_engine.py): a binary search over font sizes for the
// largest one whose broken lines fit the box, narrowed when lines would cross the balloon's edge.
#pragma once

#include <functional>
#include <optional>
#include <vector>

#include "LetterFonts.hpp"
#include "LineBreaking.hpp"

namespace engine {

struct Measure {
    // The visual width of a line with style markers at a font size, as shape_line measures it.
    std::function<double(const Text&, int)> width;
    std::function<LineMetrics(int)> metrics;
};

struct LayoutLine {
    Text textWithMarkers;
    double width = 0;
};

struct Layout {
    int fontSize = 0;
    std::vector<LayoutLine> lines;
    LineMetrics metrics;
    double maxLineWidth = 0;
    double lineHeight = 0;
};

struct LayoutOptions {
    int minFontSize = 12;
    int maxFontSize = 100;
    double lineSpacing = 1;
    bool hyphenate = true;
    size_t hyphenationMinWordLength = 8;
    bool forceFit = true;
    BreakOptions breaks;
};

// The balloon's mask over the box, and where the safe area starts in it.
struct Balloon {
    const std::vector<uint8_t>* mask = nullptr;
    int width = 0;
    int height = 0;
    int left = 0;
    int top = 0;
};

// find_optimal_layout.
std::optional<Layout> optimalLayout(const Text& text, double maxWidth, double maxHeight, const Measure& measure,
                                    const LayoutOptions& options, const std::optional<Balloon>& balloon, bool hasMask);

}
