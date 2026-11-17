// Game picture cleaning (wenbu_manga/pictures.py): the strokes inside each line's box are found against the
// box's border, grown into the mask to inpaint, and their fill and outline colours measured. Transparency is
// inpainted apart from colour, so text on a transparent label leaves transparency behind.
#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <vector>

#include "Images.hpp"

namespace engine {

using PictureBox = std::array<double, 4>;

struct LineColours {
    std::array<int, 3> fill{};
    std::optional<std::array<int, 3>> outline;
};

std::vector<uint8_t> pictureMask(const Rgba& image, const std::vector<PictureBox>& boxes);

LineColours lineColours(const Rgba& image, const PictureBox& box);

// Whether any pixel near the mask is less than opaque.
bool alphaNeedsInpainting(const Rgba& image, const std::vector<uint8_t>& mask);

// The picture with the inpainted colour and transparency inside the mask, near-clear and near-opaque snapped.
Rgba mergedPicture(const Rgba& original, const std::vector<uint8_t>& mask, const Rgb& rgb, const std::vector<uint8_t>& alpha);

}
