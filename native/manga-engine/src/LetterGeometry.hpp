// Where lettering goes (wenbu_manga/skia/skia_adapter.py, safe_area.py and upstream's ballon_extractor.py):
// the balloon around a block or an enlarged box, boxes kept apart from each other, and the largest centred
// box that keeps its distance from the balloon's edge.
#pragma once

#include <array>
#include <optional>
#include <string>
#include <vector>

#include "Images.hpp"

namespace engine {

using LetterBox = std::array<int, 4>;

struct LetterRegion {
    std::array<double, 4> xyxy{};
    std::string text;
    std::string translation;
    bool vertical = false;
    std::optional<std::array<double, 4>> textBox;
    // Degrees the lettering turns by, as the block's lines lean.
    double angle = 0;
};

// A box, and a mask the size of the box, 255 inside the balloon, when there is one.
struct Geometry {
    LetterBox box{};
    std::optional<std::vector<uint8_t>> mask;
};

// _resolve_render_geometry: a box the editor moved, else the balloon, else the enlarged block.
Geometry renderGeometry(const Rgb& page, const LetterRegion& region);

// _constrain_render_geometries: overlapping boxes are split halfway between their blocks' centres.
std::vector<Geometry> constrainGeometries(const std::vector<LetterRegion>& regions, const std::vector<Geometry>& geometries);

// calculate_centroid_expansion_box: the largest box centred on the balloon's middle whose pixels stay
// `padding` away from its edge, as x, y, width and height inside the mask.
std::optional<std::array<int, 4>> safeArea(const std::vector<uint8_t>& mask, int width, int height, double padding);

}
