// manga-image-translator's SegDetectorRepresenter.boxes_from_bitmap: text-line boxes from DBNet's
// probability map.
#pragma once

#include <array>
#include <vector>

#include <opencv2/core.hpp>

namespace engine {

struct DbOptions {
    float threshold = 0.5f;
    double boxThreshold = 0.7;
    double unclipRatio = 2.3;
    size_t maxCandidates = 1000;
};

struct DbBox {
    std::array<cv::Point, 4> points;
    double score = 0;
};

// numpy's round: halves go to the even neighbour.
double roundHalfEven(double value);

// Boxes from a CV_32FC1 probability map, in the coordinates of a destWidth × destHeight image.
std::vector<DbBox> dbBoxes(const cv::Mat& pred, int destWidth, int destHeight, const DbOptions& options = {});

}
