// manga-image-translator's mask refinement ("fit_text", mask_refinement/__init__.py and complete_mask):
// connected parts of the detector's mask are given to the text line they belong to, each line's part is
// refined with a dense CRF on the bilateral-filtered page and dilated, and the union is scaled back to the
// page.
#pragma once

#include <array>
#include <vector>

#include "Detector.hpp"
#include "Images.hpp"

namespace engine {

struct RefineOptions {
    int dilationOffset = 0;
    int kernelSize = 3;
};

// The refined text mask at the page's size, 255 on text. `lines` are the kept blocks' text lines in page
// coordinates.
std::vector<uint8_t> refineMask(const Rgb& page, const Grey& rawMask, const std::vector<std::array<cv::Point, 4>>& lines,
                                const RefineOptions& options = {});

}
