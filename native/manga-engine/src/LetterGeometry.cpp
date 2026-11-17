#include "LetterGeometry.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

#include <opencv2/imgproc.hpp>

#include "DbBoxes.hpp"
#include "LineBreaking.hpp"
#include "PillowResize.hpp"
#include "Utf8.hpp"

namespace engine {

namespace {

constexpr double minBalloonAreaRatio = 1.15;
constexpr double fallbackMinExpand = 1.35;
constexpr double fallbackMaxExpand = 2.75;
constexpr int renderBoxGap = 2;
constexpr int minRenderBox = 4;

int rounded(double value) {
    return static_cast<int>(roundHalfEven(value));
}

LetterBox clipBox(const std::array<double, 4>& box, int width, int height) {
    const int x1 = std::max(0, std::min(rounded(box[0]), width - 1));
    const int y1 = std::max(0, std::min(rounded(box[1]), height - 1));
    const int x2 = std::max(x1 + 1, std::min(rounded(box[2]), width));
    const int y2 = std::max(y1 + 1, std::min(rounded(box[3]), height));

    return {x1, y1, x2, y2};
}

bool overlaps(const LetterBox& a, const LetterBox& b, int gap) {
    return !(a[2] + gap <= b[0] || b[2] + gap <= a[0] || a[3] + gap <= b[1] || b[3] + gap <= a[1]);
}

// The text's length without whitespace, in code points as Python counts it.
double textLength(const std::string& text) {
    const std::u32string points = decodeUtf8(text);

    return static_cast<double>(std::count_if(points.begin(), points.end(), [](char32_t c) { return !isSpace(c) && c != 0xFEFF; }));
}

double fallbackExpandRatio(const LetterRegion& region) {
    const double source = std::max(1.0, textLength(region.text));
    const double growth = std::max(0.0, (textLength(region.translation) - source) / source);

    return std::min(fallbackMaxExpand, std::max(fallbackMinExpand, fallbackMinExpand + growth * 0.45));
}

// _expand_region_bbox: the block grown by how much longer the translation is, mostly along its lines.
LetterBox expandedBox(const LetterRegion& region, int width, int height) {
    const auto [x1, y1, x2, y2] = region.xyxy;
    const double w = std::max(1.0, x2 - x1);
    const double h = std::max(1.0, y2 - y1);
    const double cx = x1 + w / 2;
    const double cy = y1 + h / 2;
    const double expand = fallbackExpandRatio(region);
    const double across = std::max(1.15, std::min(expand, 1.55));
    const double newW = w * (region.vertical ? across : expand);
    const double newH = h * (region.vertical ? expand : across);

    return clipBox({cx - newW / 2, cy - newH / 2, cx + newW / 2, cy + newH / 2}, width, height);
}

double balloonEnlargeRatio(const LetterRegion& region) {
    const double w = region.xyxy[2] - region.xyxy[0];
    const double h = region.xyxy[3] - region.xyxy[1];

    if (w <= 0 || h <= 0) {
        return fallbackMinExpand;
    }

    return std::min(std::max(std::max(w / h, h / w) * 1.5, fallbackMinExpand), 3.0);
}

// The larger root of a x² + b x + c, as numpy.roots finds it.
double largerRoot(double a, double b, double c) {
    const double discriminant = std::sqrt(b * b - 4 * a * c);

    return std::max((-b + discriminant) / (2 * a), (-b - discriminant) / (2 * a));
}

// enlarge_window: grows the box so its area is `ratio` times larger, keeping its aspect.
LetterBox enlargeWindow(const LetterBox& box, int width, int height, double ratio, double aspect) {
    const auto [x1, y1, x2, y2] = box;
    const int w = x2 - x1;
    const int h = y2 - y1;

    if (w <= 0 || h <= 0) {
        return {0, 0, 0, 0};
    }

    const double root = largerRoot(aspect, w + h * aspect, (1 - ratio) * w * h);
    const int half = rounded(root / 2);
    const int deltaW = std::min({x1, width - x2, static_cast<int>(std::trunc(half * aspect))});
    const int delta = std::min({y1, height - y2, half});
    const auto clamp = [](int value, int limit) { return std::min(std::max(value, 0), limit - 1); };

    return {clamp(x1 - deltaW, width), clamp(y1 - delta, height), clamp(x2 + deltaW, width), clamp(y2 + delta, height)};
}

struct BalloonFound {
    cv::Mat mask;
    LetterBox box;
};

cv::Mat wrappedSubtract(int from, const cv::Mat& source) {
    cv::Mat out(source.size(), CV_8UC1);

    for (int y = 0; y < source.rows; y++) {
        for (int x = 0; x < source.cols; x++) {
            out.at<uint8_t>(y, x) = static_cast<uint8_t>(from - source.at<uint8_t>(y, x));
        }
    }

    return out;
}

// extract_ballon_region: the balloon around a block, found from the edges around it.
BalloonFound balloonRegion(const Rgb& page, const LetterRegion& region) {
    const int rx = static_cast<int>(std::trunc(region.xyxy[0]));
    const int ry = static_cast<int>(std::trunc(region.xyxy[1]));
    const int rw = static_cast<int>(std::trunc(region.xyxy[2])) - rx;
    const int rh = static_cast<int>(std::trunc(region.xyxy[3])) - ry;
    const double ratio = balloonEnlargeRatio(region);
    const LetterBox box = ratio > 1 ? enlargeWindow({rx, ry, rx + rw, ry + rh}, page.width, page.height, ratio,
                                                    static_cast<double>(rh) / rw)
                                    : LetterBox{rx, ry, rx + rw, ry + rh};
    const Rgb cropped = cropImage(page, box[0], box[1], box[2], box[3]);
    const cv::Mat crop = cv::Mat(cropped.height, cropped.width, CV_8UC3, const_cast<uint8_t*>(cropped.data.data())).clone();
    const int oriH = crop.rows;
    const int oriW = crop.cols;
    double scale = 1;

    if (oriH > 300 && oriW > 300) {
        scale = 0.6;
    } else if (oriH < 120 || oriW < 120) {
        scale = 1.4;
    }

    cv::Mat image;

    if (scale == 1) {
        image = crop;
    } else {
        cv::resize(crop, image, cv::Size(static_cast<int>(oriW * scale), static_cast<int>(oriH * scale)), 0, 0, cv::INTER_AREA);
    }

    const int h = image.rows;
    const int w = image.cols;
    const double area = static_cast<double>(h) * w;
    cv::Mat blurred;
    cv::Mat edges;

    // The plugin passes cv2.BORDER_DEFAULT where sigmaX goes, so the blur's sigma is 4.
    cv::GaussianBlur(image, blurred, cv::Size(3, 3), cv::BORDER_DEFAULT, 0, cv::BORDER_DEFAULT);
    cv::Canny(blurred, edges, 70, 140, 3, true);
    cv::rectangle(edges, cv::Point(0, 0), cv::Point(w - 1, h - 1), cv::Scalar(255, 255, 255), 1, cv::LINE_8);

    std::vector<std::vector<cv::Point>> contours;
    std::vector<cv::Vec4i> hierarchy;

    cv::findContours(edges, contours, hierarchy, cv::RETR_CCOMP, cv::CHAIN_APPROX_NONE);

    cv::Mat balloon(h, w, CV_8UC1, cv::Scalar(0));
    double smallest = std::numeric_limits<double>::infinity();
    cv::Mat mask = cv::Mat::zeros(h, w, CV_8UC1);
    const cv::Point seed(w / 2, h / 2);
    const cv::Scalar tolerance(10, 10, 10);

    for (int index = 0; index < static_cast<int>(contours.size()); index++) {
        const cv::Rect rect = cv::boundingRect(contours[index]);

        if (static_cast<double>(rect.width) * rect.height < area * 0.4) {
            continue;
        }

        cv::drawContours(mask, contours, index, cv::Scalar(255), 2);

        cv::Mat copy = mask.clone();

        cv::rectangle(mask, cv::Point(0, 0), cv::Point(w - 1, h - 1), cv::Scalar(255, 255, 255), 1, cv::LINE_8);

        const int filled = cv::floodFill(copy, seed, cv::Scalar(127), nullptr, tolerance, tolerance, 4);

        if (filled <= area * 0.3) {
            cv::drawContours(mask, contours, index, cv::Scalar(0), 2);
        }

        if (filled < smallest && filled > area * 0.3) {
            smallest = filled;
            balloon = copy;
        }
    }

    // numpy's uint8 subtraction wraps around, which keeps the outline apart from the filled inside.
    cv::Mat dilated;

    cv::dilate(wrappedSubtract(127, balloon), dilated, cv::Mat::ones(3, 3, CV_8U), cv::Point(-1, -1), 1);

    const int balloonArea = cv::floodFill(dilated, seed, cv::Scalar(30), nullptr, tolerance, tolerance, 4);
    cv::Mat binary;

    cv::threshold(wrappedSubtract(30, dilated), binary, 1, 255, cv::THRESH_BINARY);
    cv::bitwise_not(binary, binary);

    const int boxKernel = static_cast<int>(std::trunc(std::sqrt(static_cast<double>(balloonArea)) / 30));

    if (boxKernel > 1) {
        const cv::Mat square = cv::Mat::ones(boxKernel, boxKernel, CV_8U);

        cv::dilate(binary, binary, square, cv::Point(-1, -1), 1);
        cv::erode(binary, binary, square, cv::Point(-1, -1), 1);
    }

    cv::Mat result;

    if (scale == 1) {
        result = binary;
    } else {
        cv::resize(binary, result, cv::Size(oriW, oriH), 0, 0, cv::INTER_LINEAR);
    }

    return {result, box};
}

// _extract_balloon_render_geometry: the balloon's box and mask, when the balloon is clearly larger than the block.
std::optional<Geometry> balloonGeometry(const Rgb& page, const LetterRegion& region) {
    BalloonFound found;

    // The plugin falls back to the enlarged box when OpenCV throws here, on a block at the page's edge say.
    try {
        found = balloonRegion(page, region);
    } catch (const std::exception&) {
        return std::nullopt;
    }

    if (cv::countNonZero(found.mask) == 0) {
        return std::nullopt;
    }

    const LetterBox box = clipBox({static_cast<double>(found.box[0]), static_cast<double>(found.box[1]),
                                   static_cast<double>(found.box[2]), static_cast<double>(found.box[3])},
                                  page.width, page.height);
    const auto [x1, y1, x2, y2] = box;
    const double regionArea = std::max(1.0, (std::trunc(region.xyxy[2]) - std::trunc(region.xyxy[0])) *
                                                (std::trunc(region.xyxy[3]) - std::trunc(region.xyxy[1])));

    if (std::max(1, (x2 - x1) * (y2 - y1)) < regionArea * minBalloonAreaRatio) {
        return std::nullopt;
    }

    cv::Mat mask = found.mask;

    if (mask.rows != y2 - y1 || mask.cols != x2 - x1) {
        cv::Mat resized;

        cv::resize(mask, resized, cv::Size(x2 - x1, y2 - y1), 0, 0, cv::INTER_NEAREST);
        mask = resized;
    }

    const cv::Mat binary = mask > 0;

    return Geometry{box, std::vector<uint8_t>(binary.datastart, binary.dataend)};
}

std::optional<std::vector<uint8_t>> cropMask(const std::optional<std::vector<uint8_t>>& mask, const LetterBox& from,
                                             const LetterBox& to) {
    if (!mask) {
        return std::nullopt;
    }

    const int w = to[2] - to[0];
    const int h = to[3] - to[1];

    if (w <= 0 || h <= 0) {
        return std::nullopt;
    }

    const int ix1 = std::max(from[0], to[0]);
    const int iy1 = std::max(from[1], to[1]);
    const int ix2 = std::min(from[2], to[2]);
    const int iy2 = std::min(from[3], to[3]);

    if (ix2 <= ix1 || iy2 <= iy1) {
        return std::vector<uint8_t>(static_cast<size_t>(w) * h, 255);
    }

    std::vector<uint8_t> cropped(static_cast<size_t>(w) * h, 0);
    const int fromW = from[2] - from[0];

    for (int y = iy1; y < iy2; y++) {
        for (int x = ix1; x < ix2; x++) {
            cropped[static_cast<size_t>(y - to[1]) * w + x - to[0]] = (*mask)[static_cast<size_t>(y - from[1]) * fromW + x - from[0]];
        }
    }

    return cropped;
}

}

Geometry renderGeometry(const Rgb& page, const LetterRegion& region) {
    if (region.textBox) {
        return {clipBox(*region.textBox, page.width, page.height), std::nullopt};
    }

    if (std::optional<Geometry> balloon = balloonGeometry(page, region)) {
        return *balloon;
    }

    const LetterBox box = expandedBox(region, page.width, page.height);

    return {box, std::vector<uint8_t>(static_cast<size_t>(box[2] - box[0]) * (box[3] - box[1]), 255)};
}

std::vector<Geometry> constrainGeometries(const std::vector<LetterRegion>& regions, const std::vector<Geometry>& geometries) {
    if (geometries.size() < 2) {
        return geometries;
    }

    std::vector<LetterBox> boxes;
    std::vector<std::array<double, 2>> centres;

    for (const Geometry& geometry : geometries) {
        boxes.push_back(geometry.box);
    }

    for (const LetterRegion& region : regions) {
        centres.push_back({(region.xyxy[0] + region.xyxy[2]) / 2, (region.xyxy[1] + region.xyxy[3]) / 2});
    }

    const auto safe = [](const LetterBox& box, const LetterBox& fallback) {
        return box[2] - box[0] >= minRenderBox && box[3] - box[1] >= minRenderBox ? box : fallback;
    };

    for (int round = 0; round < 3; round++) {
        bool changed = false;

        for (size_t i = 0; i < boxes.size(); i++) {
            for (size_t j = i + 1; j < boxes.size(); j++) {
                const LetterBox a = boxes[i];
                const LetterBox b = boxes[j];

                if (!overlaps(a, b, renderBoxGap)) {
                    continue;
                }

                const auto [cix, ciy] = centres[i];
                const auto [cjx, cjy] = centres[j];
                LetterBox nextA;
                LetterBox nextB;

                if (std::abs(cix - cjx) >= std::abs(ciy - cjy)) {
                    const int split = rounded((cix + cjx) / 2);

                    if (cix <= cjx) {
                        nextA = {a[0], a[1], std::min(a[2], split - renderBoxGap), a[3]};
                        nextB = {std::max(b[0], split + renderBoxGap), b[1], b[2], b[3]};
                    } else {
                        nextA = {std::max(a[0], split + renderBoxGap), a[1], a[2], a[3]};
                        nextB = {b[0], b[1], std::min(b[2], split - renderBoxGap), b[3]};
                    }
                } else {
                    const int split = rounded((ciy + cjy) / 2);

                    if (ciy <= cjy) {
                        nextA = {a[0], a[1], a[2], std::min(a[3], split - renderBoxGap)};
                        nextB = {b[0], std::max(b[1], split + renderBoxGap), b[2], b[3]};
                    } else {
                        nextA = {a[0], std::max(a[1], split + renderBoxGap), a[2], a[3]};
                        nextB = {b[0], b[1], b[2], std::min(b[3], split - renderBoxGap)};
                    }
                }

                nextA = safe(nextA, a);
                nextB = safe(nextB, b);

                if (nextA != a || nextB != b) {
                    boxes[i] = nextA;
                    boxes[j] = nextB;
                    changed = true;
                }
            }
        }

        if (!changed) {
            break;
        }
    }

    std::vector<Geometry> constrained;

    for (size_t index = 0; index < geometries.size(); index++) {
        const Geometry& geometry = geometries[index];

        constrained.push_back(boxes[index] == geometry.box
                                  ? geometry
                                  : Geometry{boxes[index], cropMask(geometry.mask, geometry.box, boxes[index])});
    }

    return constrained;
}

std::optional<std::array<int, 4>> safeArea(const std::vector<uint8_t>& mask, int width, int height, double padding) {
    if (std::none_of(mask.begin(), mask.end(), [](uint8_t value) { return value > 0; })) {
        return std::nullopt;
    }

    cv::Mat padded = cv::Mat::zeros(height + 2, width + 2, CV_8UC1);

    cv::Mat(height, width, CV_8UC1, const_cast<uint8_t*>(mask.data())).copyTo(padded(cv::Rect(1, 1, width, height)));

    cv::Mat distances;

    cv::distanceTransform(padded, distances, cv::DIST_L2, cv::DIST_MASK_PRECISE);

    const auto distance = [&](int x, int y) { return distances.at<float>(y + 1, x + 1); };
    std::vector<uint8_t> safe(static_cast<size_t>(width) * height, 0);
    double m00 = 0;
    double m10 = 0;
    double m01 = 0;
    float maxValue = -std::numeric_limits<float>::infinity();
    int maxX = 0;
    int maxY = 0;

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            const float value = distance(x, y);

            if (value > maxValue) {
                maxValue = value;
                maxX = x;
                maxY = y;
            }

            if (value >= padding) {
                safe[static_cast<size_t>(y) * width + x] = 255;
                m00 += 255;
                m10 += 255.0 * x;
                m01 += 255.0 * y;
            }
        }
    }

    if (m00 == 0) {
        return std::nullopt;
    }

    double centreX = m10 / m00;
    double centreY = m01 / m00;
    const int clampedX = std::max(0, std::min(rounded(centreX), width - 1));
    const int clampedY = std::max(0, std::min(rounded(centreY), height - 1));

    if (distance(clampedX, clampedY) < maxValue * 0.7) {
        centreX = maxX;
        centreY = maxY;
    }

    int cx = rounded(centreX);
    int cy = rounded(centreY);
    const auto at = [&](int x, int y) { return safe[static_cast<size_t>(y) * width + x]; };

    if (cy < 0 || cy >= height || cx < 0 || cx >= width || at(cx, cy) != 255) {
        double best = std::numeric_limits<double>::infinity();

        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                if (at(x, y) == 255) {
                    const double d = std::sqrt((y - centreY) * (y - centreY) + (x - centreX) * (x - centreX));

                    if (d < best) {
                        best = d;
                        cx = x;
                        cy = y;
                    }
                }
            }
        }

        centreX = cx;
        centreY = cy;
    }

    int left = 0;
    int right = width - cx;
    int up = 0;
    int down = height - cy;

    for (int x = cx - 1; x >= 0; x--) {
        if (at(x, cy) == 0) {
            left = x;

            break;
        }
    }

    for (int x = cx; x < width; x++) {
        if (at(x, cy) == 0) {
            right = x - cx;

            break;
        }
    }

    for (int y = cy - 1; y >= 0; y--) {
        if (at(cx, y) == 0) {
            up = y;

            break;
        }
    }

    for (int y = cy; y < height; y++) {
        if (at(cx, y) == 0) {
            down = y - cy;

            break;
        }
    }

    const int minWidth = std::min(cx - left, right);
    const int minHeight = std::min(cy - up, down);
    const int safeWidth = 2 * std::max(0, minWidth > 1 ? minWidth - 1 : minWidth);
    const int safeHeight = 2 * std::max(0, minHeight > 1 ? minHeight - 1 : minHeight);

    if (safeWidth <= 0 || safeHeight <= 0) {
        return std::nullopt;
    }

    const int boxX = rounded(centreX - safeWidth / 2.0);
    const int boxY = rounded(centreY - safeHeight / 2.0);

    if (boxX < 0 || boxY < 0 || boxX + safeWidth > width || boxY + safeHeight > height) {
        return std::nullopt;
    }

    return std::array<int, 4>{boxX, boxY, safeWidth, safeHeight};
}

}
