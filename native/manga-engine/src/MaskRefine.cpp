#include "MaskRefine.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <set>

#include <opencv2/imgproc.hpp>

#include "densecrf.h"

namespace engine {

namespace {

using Polygon = std::vector<cv::Point2d>;

double shoelace(const Polygon& polygon) {
    double area = 0;

    for (size_t i = 0; i < polygon.size(); i++) {
        const cv::Point2d& point = polygon[i];
        const cv::Point2d& next = polygon[(i + 1) % polygon.size()];

        area += point.x * next.y - next.x * point.y;
    }

    return std::abs(area) / 2;
}

// The area of a polygon clipped to an axis-aligned rectangle (Sutherland-Hodgman), as shapely's
// intersection area is for a convex line and a rectangle.
double clippedArea(const Polygon& polygon, double x1, double y1, double x2, double y2) {
    Polygon output = polygon;

    const auto clip = [&](auto inside, auto cut) {
        const Polygon input = output;

        output.clear();

        for (size_t i = 0; i < input.size(); i++) {
            const cv::Point2d& current = input[i];
            const cv::Point2d& previous = input[(i + input.size() - 1) % input.size()];

            if (inside(current)) {
                if (!inside(previous)) {
                    output.push_back(cut(previous, current));
                }

                output.push_back(current);
            } else if (inside(previous)) {
                output.push_back(cut(previous, current));
            }
        }
    };

    const auto atX = [](double x) {
        return [x](const cv::Point2d& a, const cv::Point2d& b) {
            return cv::Point2d(x, a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
        };
    };

    const auto atY = [](double y) {
        return [y](const cv::Point2d& a, const cv::Point2d& b) {
            return cv::Point2d(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y), y);
        };
    };

    clip([x1](const cv::Point2d& p) { return p.x >= x1; }, atX(x1));
    clip([x2](const cv::Point2d& p) { return p.x <= x2; }, atX(x2));
    clip([y1](const cv::Point2d& p) { return p.y >= y1; }, atY(y1));
    clip([y2](const cv::Point2d& p) { return p.y <= y2; }, atY(y2));

    return output.size() < 3 ? 0 : shoelace(output);
}

double pointPolygonDistance(const cv::Point2d& p, const Polygon& polygon) {
    bool inside = false;
    double best = std::numeric_limits<double>::infinity();

    for (size_t i = 0; i < polygon.size(); i++) {
        const cv::Point2d& a = polygon[i];
        const cv::Point2d& b = polygon[(i + 1) % polygon.size()];

        if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside;
        }

        const double dx = b.x - a.x;
        const double dy = b.y - a.y;
        const double lengthSquared = dx * dx + dy * dy;
        const double t =
            lengthSquared == 0 ? 0 : std::max(0.0, std::min(1.0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));

        best = std::min(best, std::hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }

    return inside ? 0 : best;
}

// Quadrilateral.font_size: its middle lines are cast to int before the float32 norms.
float fontSizeOf(const QuadF& line) {
    const auto mid = [](const cv::Point2d& p, const cv::Point2d& q) {
        return cv::Point(static_cast<int>((p.x + q.x) / 2), static_cast<int>((p.y + q.y) / 2));
    };
    const auto norm = [](const cv::Point& v) {
        const float x = static_cast<float>(v.x);
        const float y = static_cast<float>(v.y);
        const float squares = x * x + y * y;

        return std::sqrt(squares);
    };
    const auto& [a, b, c, d] = line.pts;

    return std::min(norm(mid(d, a) - mid(b, c)), norm(mid(c, d) - mid(a, b)));
}

struct Rect {
    int x;
    int y;
    int w;
    int h;
};

// extend_rect: grows a rectangle by `size` on every side, kept inside the image.
Rect extendRect(int x, int y, int w, int h, int maxX, int maxY, int size) {
    const int x1 = std::max(x - size, 0);
    const int y1 = std::max(y - size, 0);

    return {x1, y1, std::min(w + size * 2, maxX - x1 - 1), std::min(h + size * 2, maxY - y1 - 1)};
}

// Quadrilateral.aabb.xywh, cast to int32 as BBox does.
Rect xywhOf(const QuadF& line) {
    double minX = line.pts[0].x;
    double minY = line.pts[0].y;
    double maxX = minX;
    double maxY = minY;

    for (const auto& point : line.pts) {
        minX = std::min(minX, point.x);
        minY = std::min(minY, point.y);
        maxX = std::max(maxX, point.x);
        maxY = std::max(maxY, point.y);
    }

    return {static_cast<int>(minX), static_cast<int>(minY), static_cast<int>(maxX - minX), static_cast<int>(maxY - minY)};
}

cv::Mat dilated(const cv::Mat& source, int size) {
    cv::Mat out;

    cv::dilate(source, out, cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(size, size)));

    return out;
}

// refine_mask: pydensecrf's DenseCRF2D with a two-class unary from a 0/255 mask, one Gaussian and one
// bilateral Potts term without normalisation.
cv::Mat refined(const cv::Mat& rgb, const cv::Mat& mask) {
    const int width = rgb.cols;
    const int height = rgb.rows;
    const Eigen::Index pixels = static_cast<Eigen::Index>(width) * height;
    const cv::Mat image = rgb.isContinuous() ? rgb : rgb.clone();
    const float clip = 1e-5f;
    MatrixXf unary(2, pixels);

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            const uint8_t value = mask.at<uint8_t>(y, x);
            const float on = std::max(static_cast<float>(value) / 255.0f, clip);
            const float off = std::max(static_cast<float>(static_cast<uint8_t>(~value)) / 255.0f, clip);
            const Eigen::Index index = static_cast<Eigen::Index>(y) * width + x;

            unary(0, index) = -std::log(std::min(off, 1.0f));
            unary(1, index) = -std::log(std::min(on, 1.0f));
        }
    }

    DenseCRF2D model(width, height, 2);

    model.setUnaryEnergy(unary);
    model.addPairwiseGaussian(1, 1, new PottsCompatibility(3), DIAG_KERNEL, NO_NORMALIZATION);
    model.addPairwiseBilateral(23, 23, 7, 7, 7, image.data, new PottsCompatibility(20), DIAG_KERNEL, NO_NORMALIZATION);

    const MatrixXf q = model.inference(5);
    cv::Mat out(height, width, CV_8UC1);

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            const Eigen::Index index = static_cast<Eigen::Index>(y) * width + x;

            out.at<uint8_t>(y, x) = q(1, index) > q(0, index) ? 255 : 0;
        }
    }

    return out;
}

// np.argmax and np.argmin over float32: the first best, or the first NaN when there is one.
template <typename Better> size_t firstBest(const std::vector<float>& values, Better better) {
    size_t best = 0;

    for (size_t i = 0; i < values.size(); i++) {
        if (std::isnan(values[i])) {
            return i;
        }

        if (better(values[i], values[best])) {
            best = i;
        }
    }

    return best;
}

}

std::vector<uint8_t> refineMask(const Rgb& page, const Grey& rawMask, const std::vector<std::array<cv::Point, 4>>& lines,
                                const RefineOptions& options) {
    // The plugin never refines a page without text lines; there is nothing to give each part to.
    if (lines.empty()) {
        return std::vector<uint8_t>(static_cast<size_t>(page.width) * page.height, 0);
    }

    const double scale =
        std::max(std::min((rawMask.height - page.height / 3.0) / rawMask.height, 1.0), 0.5);
    const int width = static_cast<int>(page.width * scale);
    const int height = static_cast<int>(page.height * scale);
    const cv::Mat pageMat(page.height, page.width, CV_8UC3, const_cast<uint8_t*>(page.data.data()));
    const cv::Mat rawMat(rawMask.height, rawMask.width, CV_8UC1, const_cast<uint8_t*>(rawMask.data.data()));
    cv::Mat scaled;
    cv::Mat filtered;
    cv::Mat mask;

    cv::resize(pageMat, scaled, cv::Size(width, height), 0, 0, cv::INTER_LINEAR);
    cv::bilateralFilter(scaled, filtered, 17, 80, 80);
    cv::resize(rawMat, mask, cv::Size(width, height), 0, 0, cv::INTER_LINEAR);
    mask = (mask > 0);

    std::vector<QuadF> textlines;

    for (const auto& pts : lines) {
        std::vector<cv::Point2d> points;

        for (const auto& point : pts) {
            points.emplace_back(point.x * scale, point.y * scale);
        }

        textlines.push_back(quad(points, 0));
    }

    for (const QuadF& line : textlines) {
        const Rect box = xywhOf(line);

        cv::rectangle(mask, cv::Point(box.x, box.y), cv::Point(box.x + box.w, box.y + box.h), cv::Scalar(0), 1);
    }

    cv::Mat labels;
    cv::Mat stats;
    cv::Mat centroids;
    const int count = cv::connectedComponentsWithStats(mask, labels, stats, centroids);
    std::vector<Polygon> polygons;
    std::vector<double> areas;

    for (const QuadF& line : textlines) {
        polygons.emplace_back(line.pts.begin(), line.pts.end());
        areas.push_back(shoelace(polygons.back()));
    }

    std::vector<std::set<int>> assigned(textlines.size());
    std::vector<std::optional<std::array<int, 4>>> rects(textlines.size());
    bool valid = false;

    for (int label = 1; label < count; label++) {
        const int x1 = stats.at<int>(label, cv::CC_STAT_LEFT);
        const int y1 = stats.at<int>(label, cv::CC_STAT_TOP);
        const int w1 = stats.at<int>(label, cv::CC_STAT_WIDTH);
        const int h1 = stats.at<int>(label, cv::CC_STAT_HEIGHT);
        const int area1 = stats.at<int>(label, cv::CC_STAT_AREA);

        if (area1 <= 9) {
            continue;
        }

        std::vector<float> ratios;
        std::vector<float> distances;

        for (size_t i = 0; i < textlines.size(); i++) {
            ratios.push_back(static_cast<float>(clippedArea(polygons[i], x1, y1, x1 + w1, y1 + h1) /
                                                std::min(static_cast<double>(area1), areas[i])));
            distances.push_back(static_cast<float>(pointPolygonDistance({x1 + w1 / 2.0, y1 + h1 / 2.0}, polygons[i])));
        }

        size_t target = firstBest(ratios, [](float a, float b) { return a > b; });

        if (area1 >= areas[target]) {
            continue;
        }

        if (ratios[target] <= 1e-2) {
            target = firstBest(distances, [](float a, float b) { return a < b; });

            const double unit = std::max(std::min({static_cast<double>(fontSizeOf(textlines[target])),
                                                   static_cast<double>(w1), static_cast<double>(h1)}),
                                         10.0);

            if (distances[target] >= 0.5 * unit) {
                continue;
            }
        }

        assigned[target].insert(label);

        const std::array<int, 4> box = {x1, y1, x1 + w1, y1 + h1};

        rects[target] = rects[target] ? std::array<int, 4>{std::min((*rects[target])[0], box[0]),
                                                           std::min((*rects[target])[1], box[1]),
                                                           std::max((*rects[target])[2], box[2]),
                                                           std::max((*rects[target])[3], box[3])}
                                      : box;
        valid = true;
    }

    // Each line's part is refined and grown on its own, so lines run in parallel and are joined in order.
    struct Grown {
        cv::Rect where;
        cv::Mat mask;
    };

    std::vector<std::optional<Grown>> grownLines(textlines.size());

    const auto refineLine = [&](size_t i) -> std::optional<Grown> {
        if (!rects[i]) {
            return std::nullopt;
        }

        const auto [rx, ry, rr, rb] = *rects[i];
        const double textSize = std::min({static_cast<double>(rr - rx), static_cast<double>(rb - ry),
                                          static_cast<double>(fontSizeOf(textlines[i]))});
        const Rect region = extendRect(rx, ry, rr - rx, rb - ry, width, height, static_cast<int>(textSize * 0.1));
        const int dilateSize =
            std::max(static_cast<int>(std::floor(static_cast<int>((textSize + options.dilationOffset) * 0.3) / 2.0)) * 2 + 1, 3);

        if (region.w <= 0 || region.h <= 0) {
            return std::nullopt;
        }

        const Rect around = extendRect(region.x, region.y, region.w, region.h, width, height,
                                       static_cast<int>(std::ceil(dilateSize / 2.0)));
        cv::Mat cc(around.h, around.w, CV_8UC1);

        for (int row = 0; row < around.h; row++) {
            const int* source = labels.ptr<int>(around.y + row) + around.x;
            uint8_t* target = cc.ptr<uint8_t>(row);

            for (int column = 0; column < around.w; column++) {
                target[column] = assigned[i].contains(source[column]) ? 255 : 0;
            }
        }

        const cv::Rect inner(region.x - around.x, region.y - around.y, region.w, region.h);

        refined(filtered(cv::Rect(region.x, region.y, region.w, region.h)), cc(inner).clone()).copyTo(cc(inner));

        return Grown{cv::Rect(around.x, around.y, around.w, around.h), dilated(cc, dilateSize)};
    };

    if (valid) {
        cv::parallel_for_(cv::Range(0, static_cast<int>(textlines.size())), [&](const cv::Range& range) {
            for (int i = range.start; i < range.end; i++) {
                grownLines[i] = refineLine(static_cast<size_t>(i));
            }
        });
    }

    cv::Mat combined = cv::Mat::zeros(height, width, CV_8UC1);

    for (const auto& grown : grownLines) {
        if (grown) {
            cv::Mat target = combined(grown->where);

            cv::bitwise_or(target, grown->mask, target);
        }
    }

    const cv::Mat finished = valid ? dilated(combined, options.kernelSize) : combined;
    cv::Mat full;

    cv::resize(finished, full, cv::Size(page.width, page.height), 0, 0, cv::INTER_LINEAR);

    std::vector<uint8_t> out(static_cast<size_t>(page.width) * page.height);

    for (int y = 0; y < page.height; y++) {
        const uint8_t* row = full.ptr<uint8_t>(y);

        for (int x = 0; x < page.width; x++) {
            out[static_cast<size_t>(y) * page.width + x] = row[x] > 0 ? 255 : 0;
        }
    }

    return out;
}

}
