// manga-image-translator's Quadrilateral: one detected text line. Its corners are integers as the
// detector gives them, or floats once mask refinement scales them.
#pragma once

#include <array>
#include <vector>

#include <opencv2/core/types.hpp>

namespace engine {

template <typename P> struct BasicQuad {
    std::array<P, 4> pts;
    bool vertical = false;
    double score = 0;
};

using Quad = BasicQuad<cv::Point>;
using QuadF = BasicQuad<cv::Point2d>;

// sort_pnts: orders the corners and tells whether the line runs vertically.
Quad quad(const std::vector<cv::Point>& points, double score);
QuadF quad(const std::vector<cv::Point2d>& points, double score);

// The area of the points' convex hull, as shapely's MultiPoint(...).convex_hull.area.
double hullArea(const std::vector<cv::Point>& points);

double quadArea(const Quad& line);

}
