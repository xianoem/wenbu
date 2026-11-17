// Pillow's Image.resize with BILINEAR or LANCZOS on 8-bit RGB (libImaging/Resample.c): the filter is
// widened by the scale when shrinking, coefficients are in 22-bit fixed point, and a horizontal pass runs
// before a vertical one.
#pragma once

#include "Images.hpp"

namespace engine {

enum class Filter { Bilinear, Lanczos };

Rgb pillowResize(const Rgb& image, int width, int height, Filter filter = Filter::Bilinear);

// Image.crop with integer edges; parts outside the image are black, as in Pillow.
Rgb cropImage(const Rgb& image, int left, int top, int right, int bottom);

}
