// Text and paper colours of a block, taken from the page: inside the block, Otsu's threshold splits the
// grey levels and the smaller side is the ink. Paper is what stays after the ink is grown by two pixels.
// The plugin's rule for colours too close to tell apart (get_font_colors) then applies.
#pragma once

#include <array>
#include <cstdint>

#include "Images.hpp"

namespace engine {

using Colour = std::array<int, 3>;

struct BlockColours {
    Colour fg;
    Colour bg;
};

BlockColours blockColours(const Rgb& page, const std::array<int, 4>& box);

}
