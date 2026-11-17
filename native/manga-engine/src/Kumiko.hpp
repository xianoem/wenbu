// Kumiko 1.x as manga-image-translator vendors it (utils/panel/lib): panels in reading order. Python's
// quirks are kept on purpose: panels compare equal within a tenth of their size, `list.remove` and
// `list.index` use that equality, `min` and `max` keep the first best, and the sort is CPython's with
// Panel.__lt__.
#pragma once

#include <vector>

#include <opencv2/core.hpp>

#include "Images.hpp"

namespace engine {

struct PanelBox {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

// What Kumiko reads from a page: the outer contours of its thresholded Sobel edges and its line segments.
struct PanelFeatures {
    std::vector<std::vector<cv::Point>> contours;
    std::vector<cv::Vec4f> segments;
};

PanelFeatures panelFeatures(const Rgb& page);

std::vector<PanelBox> findPanels(int width, int height, const PanelFeatures& features, bool rtl);

}
