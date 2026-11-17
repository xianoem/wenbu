#include "DbBoxes.hpp"

#include <algorithm>
#include <cmath>

#include <clipper.hpp>
#include <opencv2/imgproc.hpp>

namespace engine {

namespace {

constexpr float minSize = 3;

struct MiniBox {
    std::array<cv::Point2f, 4> box;
    float side = 0;
};

// get_mini_boxes: the min-area rectangle's corners ordered top-left, top-right, bottom-right, bottom-left.
MiniBox miniBox(const std::vector<cv::Point>& points) {
    const cv::RotatedRect rect = cv::minAreaRect(points);
    std::array<cv::Point2f, 4> corners;

    rect.points(corners.data());
    std::stable_sort(corners.begin(), corners.end(),
                     [](const cv::Point2f& a, const cv::Point2f& b) { return a.x < b.x; });

    const bool firstLower = corners[1].y > corners[0].y;
    const bool secondLower = corners[3].y > corners[2].y;
    const cv::Point2f first = firstLower ? corners[0] : corners[1];
    const cv::Point2f fourth = firstLower ? corners[1] : corners[0];
    const cv::Point2f second = secondLower ? corners[2] : corners[3];
    const cv::Point2f third = secondLower ? corners[3] : corners[2];

    return {{first, second, third, fourth}, std::min(rect.size.width, rect.size.height)};
}

// box_score_fast: the mean of the map inside the contour's filled outline.
double boxScore(const cv::Mat& pred, const std::vector<cv::Point>& points) {
    int xmin = points[0].x;
    int xmax = points[0].x;
    int ymin = points[0].y;
    int ymax = points[0].y;

    for (const auto& point : points) {
        xmin = std::min(xmin, point.x);
        xmax = std::max(xmax, point.x);
        ymin = std::min(ymin, point.y);
        ymax = std::max(ymax, point.y);
    }

    xmin = std::clamp(xmin, 0, pred.cols - 1);
    xmax = std::clamp(xmax, 0, pred.cols - 1);
    ymin = std::clamp(ymin, 0, pred.rows - 1);
    ymax = std::clamp(ymax, 0, pred.rows - 1);

    cv::Mat mask = cv::Mat::zeros(ymax - ymin + 1, xmax - xmin + 1, CV_8UC1);
    std::vector<cv::Point> shifted;

    for (const auto& point : points) {
        shifted.emplace_back(point.x - xmin, point.y - ymin);
    }

    cv::fillPoly(mask, std::vector<std::vector<cv::Point>>{shifted}, cv::Scalar(1));

    return cv::mean(pred(cv::Rect(xmin, ymin, mask.cols, mask.rows)), mask)[0];
}

// unclip: grows the box by area * ratio / perimeter with Clipper's round joins, as shapely and
// pyclipper do.
std::vector<cv::Point> unclip(const std::array<cv::Point2f, 4>& box, double ratio) {
    double area = 0;
    double length = 0;

    for (size_t i = 0; i < box.size(); i++) {
        const cv::Point2d point = box[i];
        const cv::Point2d next = box[(i + 1) % box.size()];

        area += point.x * next.y - next.x * point.y;
        length += std::hypot(next.x - point.x, next.y - point.y);
    }

    const double distance = std::abs(area) / 2 * ratio / length;
    ClipperLib::Path path;

    for (const auto& point : box) {
        path.emplace_back(static_cast<ClipperLib::cInt>(point.x), static_cast<ClipperLib::cInt>(point.y));
    }

    ClipperLib::ClipperOffset offset(2, 0.25);
    ClipperLib::Paths solution;

    offset.AddPath(path, ClipperLib::jtRound, ClipperLib::etClosedPolygon);
    offset.Execute(solution, distance);

    std::vector<cv::Point> points;

    for (const auto& part : solution) {
        for (const auto& point : part) {
            points.emplace_back(static_cast<int>(point.X), static_cast<int>(point.Y));
        }
    }

    return points;
}

int scaled(float value, int size, int dest) {
    const float ratio = value / static_cast<float>(size) * static_cast<float>(dest);

    return std::clamp(static_cast<int>(roundHalfEven(ratio)), 0, dest);
}

}

double roundHalfEven(double value) {
    const double floor = std::floor(value);
    const double fraction = value - floor;

    if (fraction > 0.5) {
        return floor + 1;
    }

    if (fraction < 0.5) {
        return floor;
    }

    return std::fmod(floor, 2) == 0 ? floor : floor + 1;
}

std::vector<DbBox> dbBoxes(const cv::Mat& pred, int destWidth, int destHeight, const DbOptions& options) {
    cv::Mat bitmap = pred > options.threshold;
    std::vector<std::vector<cv::Point>> contours;
    std::vector<DbBox> boxes;

    cv::findContours(bitmap, contours, cv::RETR_LIST, cv::CHAIN_APPROX_SIMPLE);

    if (contours.size() > options.maxCandidates) {
        contours.resize(options.maxCandidates);
    }

    for (const auto& contour : contours) {
        const MiniBox first = miniBox(contour);

        if (first.side < minSize) {
            continue;
        }

        const double score = boxScore(pred, contour);

        if (options.boxThreshold > score) {
            continue;
        }

        const std::vector<cv::Point> expanded = unclip(first.box, options.unclipRatio);

        if (expanded.empty()) {
            continue;
        }

        const MiniBox second = miniBox(expanded);

        if (second.side < minSize + 2) {
            continue;
        }

        std::array<cv::Point, 4> points;

        for (size_t i = 0; i < points.size(); i++) {
            points[i] = {scaled(second.box[i].x, pred.cols, destWidth), scaled(second.box[i].y, pred.rows, destHeight)};
        }

        const auto start = std::min_element(points.begin(), points.end(), [](const cv::Point& a, const cv::Point& b) {
            return a.x + a.y < b.x + b.y;
        });

        std::rotate(points.begin(), start, points.end());
        boxes.push_back({points, score});
    }

    return boxes;
}

}
