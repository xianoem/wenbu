#include "CleanPlan.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

#include <opencv2/imgproc.hpp>

#include "DbBoxes.hpp"

namespace engine {

namespace {

constexpr int scanMargin = 6;
constexpr int flat = 8;
constexpr int paperLevel = 200;
constexpr long long largestBubble = 25;
constexpr int paperTolerance = 60;
constexpr std::array<double, 2> bubbleInset = {0.06, 0.05};
constexpr int patchRing = 12;
constexpr float grainLimit = 10;
constexpr double patchTone = 14;

// cv2.dilate with a 3x3 square, `iterations` times: one square of side 2 * iterations + 1, with nothing
// added from outside the image.
cv::Mat dilated(const cv::Mat& source, int iterations) {
    cv::Mat out;

    cv::dilate(source, out, cv::getStructuringElement(cv::MORPH_RECT, cv::Size(2 * iterations + 1, 2 * iterations + 1)));

    return out;
}

Region emptyRegion() {
    return {0, 0, cv::Mat(0, 0, CV_8UC1)};
}

// cv2.dilate of a region that is zero outside its rectangle.
Region dilateRegion(const CleanPage& page, const Region& region, int iterations) {
    if (region.w() == 0) {
        return region;
    }

    const int x = std::max(0, region.x - iterations);
    const int y = std::max(0, region.y - iterations);
    const int r = std::min(page.rgb.width, region.x + region.w() + iterations);
    const int b = std::min(page.rgb.height, region.y + region.h() + iterations);
    cv::Mat padded = cv::Mat::zeros(b - y, r - x, CV_8UC1);

    region.data.copyTo(padded(cv::Rect(region.x - x, region.y - y, region.w(), region.h())));

    return {x, y, dilated(padded, iterations)};
}

uint8_t at(const Region& region, int x, int y) {
    if (x >= region.x && x < region.x + region.w() && y >= region.y && y < region.y + region.h()) {
        return region.data.at<uint8_t>(y - region.y, x - region.x);
    }

    return 0;
}

cv::Mat strokeMask(const cv::Mat& gray) {
    double low = 0;
    double high = 0;

    if (gray.empty()) {
        return cv::Mat(gray.size(), CV_8UC1, cv::Scalar(255));
    }

    cv::minMaxLoc(gray, &low, &high);

    if (high - low < flat) {
        return cv::Mat(gray.size(), CV_8UC1, cv::Scalar(255));
    }

    cv::Mat dark;

    cv::threshold(gray, dark, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);

    if (cv::countNonZero(dark) <= static_cast<double>(dark.total()) / 2) {
        return dilated(dark, 2);
    }

    const cv::Mat light = 255 - dark;

    return dilated(light, 2);
}

std::optional<std::array<double, 2>> scannedColours(const CleanBlock& block) {
    if (!block.fg || !block.bg) {
        return std::nullopt;
    }

    const double text = ((*block.fg)[0] + (*block.fg)[1] + (*block.fg)[2]) / 3.0;
    const double paper = ((*block.bg)[0] + (*block.bg)[1] + (*block.bg)[2]) / 3.0;

    if (std::abs(text - paper) < flat) {
        return std::nullopt;
    }

    return std::array<double, 2>{text, paper};
}

// block_mask: the scan mask around the block, or, for drawn blocks, the text's strokes inside it.
Region blockMask(const CleanPage& page, const cv::Mat& scan, const CleanBlock& block) {
    const int width = page.rgb.width;
    const int height = page.rgb.height;

    if (!block.drawn) {
        const auto [x1, y1, x2, y2] = clipped({block.box[0] - scanMargin, block.box[1] - scanMargin,
                                               block.box[2] + scanMargin, block.box[3] + scanMargin},
                                              width, height);

        if (x2 > x1 && y2 > y1) {
            const cv::Mat data = scan(cv::Rect(x1, y1, x2 - x1, y2 - y1)) >= 127;

            if (cv::countNonZero(data) > 0) {
                return {x1, y1, data};
            }
        }
    }

    const auto [x1, y1, x2, y2] = clipped(block.box, width, height);

    if (x2 <= x1 || y2 <= y1) {
        return emptyRegion();
    }

    const cv::Mat crop = page.gray(cv::Rect(x1, y1, x2 - x1, y2 - y1));
    const std::optional<std::array<double, 2>> colours = scannedColours(block);

    if (!colours) {
        return {x1, y1, strokeMask(crop.clone())};
    }

    cv::Mat text(crop.size(), CV_8UC1);

    for (int y = 0; y < crop.rows; y++) {
        for (int x = 0; x < crop.cols; x++) {
            const double value = crop.at<uint8_t>(y, x);

            text.at<uint8_t>(y, x) = std::abs(value - (*colours)[0]) < std::abs(value - (*colours)[1]) ? 255 : 0;
        }
    }

    return {x1, y1, dilated(text, 2)};
}

// np.median of uint8 values, cast back to uint8 as the plugin does.
uint8_t medianByte(std::vector<uint8_t>& values) {
    if (values.empty()) {
        return 0;
    }

    const size_t middle = values.size() / 2;

    std::nth_element(values.begin(), values.begin() + static_cast<long>(middle), values.end());

    const uint8_t upper = values[middle];

    if (values.size() % 2 == 1) {
        return upper;
    }

    const uint8_t lower = *std::max_element(values.begin(), values.begin() + static_cast<long>(middle));

    return static_cast<uint8_t>((lower + upper) / 2);
}

double medianFloat(std::vector<float>& values) {
    const size_t middle = values.size() / 2;

    std::nth_element(values.begin(), values.begin() + static_cast<long>(middle), values.end());

    const double upper = values[middle];

    if (values.size() % 2 == 1) {
        return upper;
    }

    const double lower = *std::max_element(values.begin(), values.begin() + static_cast<long>(middle));

    return (lower + upper) / 2;
}

struct Flood {
    std::vector<int> pixels;
    int left;
    int top;
    int right;
    int bottom;
};

// cv.floodFill with 4-connectivity over the paper from `seed`. It stops once more than `limit` pixels are
// reached, since the caller then only needs to know the area is too large.
Flood floodPaper(const cv::Mat& paper, int seedX, int seedY, long long limit) {
    const int width = paper.cols;
    const int height = paper.rows;
    const uint8_t* data = paper.data;
    std::vector<uint8_t> marks(static_cast<size_t>(width) * height, 0);
    Flood flood{{}, width, height, -1, -1};
    size_t head = 0;

    const auto visit = [&](int next) {
        if (marks[next] == 0 && data[next] != 0) {
            marks[next] = 1;
            flood.pixels.push_back(next);
        }
    };

    visit(seedY * width + seedX);

    while (head < flood.pixels.size() && static_cast<long long>(head) <= limit) {
        const int p = flood.pixels[head];
        const int x = p % width;
        const int y = p / width;

        head++;
        flood.left = std::min(flood.left, x);
        flood.right = std::max(flood.right, x);
        flood.top = std::min(flood.top, y);
        flood.bottom = std::max(flood.bottom, y);

        if (x > 0) {
            visit(p - 1);
        }

        if (x < width - 1) {
            visit(p + 1);
        }

        if (y > 0) {
            visit(p - width);
        }

        if (y < height - 1) {
            visit(p + width);
        }
    }

    return flood;
}

}

CleanPage::CleanPage(const Rgb& page) : rgb(page) {
    const cv::Mat image(page.height, page.width, CV_8UC3, const_cast<uint8_t*>(page.data.data()));

    cv::cvtColor(image, gray, cv::COLOR_RGB2GRAY);
    seal = std::max(2, page.height / 800);
    paper = 1 - dilated(gray < paperLevel, seal) / 255;
}

std::array<int, 4> clipped(const std::array<double, 4>& box, int width, int height) {
    return {std::max(0, static_cast<int>(roundHalfEven(box[0]))), std::max(0, static_cast<int>(roundHalfEven(box[1]))),
            std::min(width, static_cast<int>(roundHalfEven(box[2]))),
            std::min(height, static_cast<int>(roundHalfEven(box[3])))};
}

std::optional<Bubble> bubbleAround(const CleanPage& page, const std::array<double, 4>& box) {
    const int width = page.rgb.width;
    const int height = page.rgb.height;
    const auto [x1, y1, x2, y2] = clipped(box, width, height);

    if (x2 <= x1 || y2 <= y1) {
        return std::nullopt;
    }

    const int w = x2 - x1;
    const int h = y2 - y1;
    cv::Mat labels;
    cv::Mat stats;
    cv::Mat centroids;
    const int count = cv::connectedComponentsWithStats(page.paper(cv::Rect(x1, y1, w, h)).clone(), labels, stats,
                                                       centroids, 4);

    if (count < 2) {
        return std::nullopt;
    }

    int largest = 1;

    for (int label = 2; label < count; label++) {
        if (stats.at<int>(label, cv::CC_STAT_AREA) > stats.at<int>(largest, cv::CC_STAT_AREA)) {
            largest = label;
        }
    }

    int seedX = -1;
    int seedY = -1;

    for (int y = 0; y < h && seedX < 0; y++) {
        const int* row = labels.ptr<int>(y);

        for (int x = 0; x < w; x++) {
            if (row[x] == largest) {
                seedX = x + x1;
                seedY = y + y1;

                break;
            }
        }
    }

    const long long limit = static_cast<long long>(w) * h * largestBubble;
    const Flood flood = floodPaper(page.paper, seedX, seedY, limit);

    if (static_cast<long long>(flood.pixels.size()) > limit) {
        return std::nullopt;
    }

    Region inside{flood.left, flood.top,
                  cv::Mat::zeros(flood.bottom - flood.top + 1, flood.right - flood.left + 1, CV_8UC1)};
    std::array<std::vector<uint8_t>, 3> channels;

    for (const int p : flood.pixels) {
        inside.data.at<uint8_t>(p / width - inside.y, p % width - inside.x) = 1;

        for (size_t c = 0; c < 3; c++) {
            channels[c].push_back(page.rgb.data[static_cast<size_t>(p) * 3 + c]);
        }
    }

    Region grown = dilateRegion(page, inside, page.seal);
    std::vector<std::vector<cv::Point>> contours;
    cv::Mat filled = cv::Mat::zeros(grown.data.size(), CV_8UC1);

    cv::findContours(grown.data, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
    cv::drawContours(filled, contours, -1, cv::Scalar(255), -1);
    grown.data = filled;

    return Bubble{grown, {medianByte(channels[0]), medianByte(channels[1]), medianByte(channels[2])}};
}

Plan cleanPlan(const CleanPage& page, const std::vector<uint8_t>& scan, const std::vector<CleanBlock>& blocks,
               const std::optional<Rgb>& brush) {
    const int width = page.rgb.width;
    const int height = page.rgb.height;
    const cv::Mat scanMat(height, width, CV_8UC1, const_cast<uint8_t*>(scan.data()));
    Plan plan{page.rgb, std::vector<uint8_t>(static_cast<size_t>(width) * height, 0)};
    const int reach = std::max(3, height / 500);

    const auto keep = [&](size_t p) { return brush && brush->data[p * 3 + 1] >= 127; };

    for (const CleanBlock& block : blocks) {
        const Region text = blockMask(page, scanMat, block);
        const std::optional<Bubble> around = block.fill ? bubbleAround(page, block.box) : std::nullopt;

        if (!around) {
            const Region grown = dilateRegion(page, text, reach);

            for (int row = 0; row < grown.h(); row++) {
                const uint8_t* source = grown.data.ptr<uint8_t>(row);
                uint8_t* target = plan.inpaint.data() + static_cast<size_t>(grown.y + row) * width + grown.x;

                for (int column = 0; column < grown.w(); column++) {
                    target[column] |= source[column];
                }
            }

            continue;
        }

        const Region strokes = dilateRegion(page, text, 2);

        for (int row = 0; row < strokes.h(); row++) {
            for (int column = 0; column < strokes.w(); column++) {
                const int x = strokes.x + column;
                const int y = strokes.y + row;
                const size_t p = static_cast<size_t>(y) * width + x;

                if (strokes.data.at<uint8_t>(row, column) > 0 && at(around->bubble, x, y) > 0 && !keep(p)) {
                    std::copy(around->colour.begin(), around->colour.end(), plan.filled.data.begin() + static_cast<long>(p * 3));
                }
            }
        }
    }

    if (brush) {
        for (size_t p = 0; p < plan.inpaint.size(); p++) {
            if (brush->data[p * 3] >= 127) {
                plan.inpaint[p] = 255;
            }

            if (keep(p)) {
                plan.inpaint[p] = 0;
            }
        }
    }

    return plan;
}

Rgb settlePaper(const CleanPage& page, const Rgb& inpainted, const std::vector<CleanBlock>& blocks,
                const std::vector<uint8_t>& mask) {
    const int width = page.rgb.width;
    Rgb settled = inpainted;

    for (const CleanBlock& block : blocks) {
        const std::optional<Bubble> around = bubbleAround(page, block.box);

        if (!around) {
            continue;
        }

        const Region& bubble = around->bubble;
        const auto& colour = around->colour;

        for (int row = 0; row < bubble.h(); row++) {
            for (int column = 0; column < bubble.w(); column++) {
                const size_t p = static_cast<size_t>(bubble.y + row) * width + bubble.x + column;

                if (bubble.data.at<uint8_t>(row, column) == 0 || mask[p] == 0) {
                    continue;
                }

                const int distance = std::abs(inpainted.data[p * 3] - colour[0]) +
                                     std::abs(inpainted.data[p * 3 + 1] - colour[1]) +
                                     std::abs(inpainted.data[p * 3 + 2] - colour[2]);

                if (distance <= paperTolerance) {
                    std::copy(colour.begin(), colour.end(), settled.data.begin() + static_cast<long>(p * 3));
                }
            }
        }
    }

    return settled;
}

std::optional<std::array<int, 4>> textArea(const CleanPage& page, const std::array<double, 4>& box) {
    const std::optional<Bubble> around = bubbleAround(page, box);

    if (!around) {
        return std::nullopt;
    }

    const Region& bubble = around->bubble;
    int x1 = std::numeric_limits<int>::max();
    int y1 = std::numeric_limits<int>::max();
    int x2 = -1;
    int y2 = -1;

    for (int row = 0; row < bubble.h(); row++) {
        for (int column = 0; column < bubble.w(); column++) {
            if (bubble.data.at<uint8_t>(row, column) != 0) {
                x1 = std::min(x1, bubble.x + column);
                x2 = std::max(x2, bubble.x + column + 1);
                y1 = std::min(y1, bubble.y + row);
                y2 = std::max(y2, bubble.y + row + 1);
            }
        }
    }

    const int dx = static_cast<int>(roundHalfEven((x2 - x1) * bubbleInset[0]));
    const int dy = static_cast<int>(roundHalfEven((y2 - y1) * bubbleInset[1]));

    return std::array<int, 4>{x1 + dx, y1 + dy, x2 - dx, y2 - dy};
}

Rgb blendPatch(const Rgb& base, const Rgb& inpainted, const std::vector<uint8_t>& mask) {
    const int width = base.width;
    const int height = base.height;
    int left = width;
    int right = -1;
    int top = height;
    int bottom = -1;

    for (size_t p = 0; p < mask.size(); p++) {
        if (mask[p] > 0) {
            const int x = static_cast<int>(p % width);
            const int y = static_cast<int>(p / width);

            left = std::min(left, x);
            right = std::max(right, x);
            top = std::min(top, y);
            bottom = std::max(bottom, y);
        }
    }

    if (right < 0) {
        return inpainted;
    }

    std::vector<float> result(inpainted.data.begin(), inpainted.data.end());
    const cv::Mat maskMat(height, width, CV_8UC1, const_cast<uint8_t*>(mask.data()));
    const cv::Mat ring = dilated(maskMat > 0, patchRing);
    std::array<std::vector<float>, 3> ringPixels;
    std::array<std::vector<float>, 3> insidePixels;

    for (size_t p = 0; p < mask.size(); p++) {
        if (mask[p] > 0) {
            for (size_t c = 0; c < 3; c++) {
                insidePixels[c].push_back(result[p * 3 + c]);
            }
        } else if (ring.data[p] > 0) {
            for (size_t c = 0; c < 3; c++) {
                ringPixels[c].push_back(base.data[p * 3 + c]);
            }
        }
    }

    if (!ringPixels[0].empty()) {
        std::array<double, 3> shift{};

        for (size_t c = 0; c < 3; c++) {
            shift[c] = std::min(std::max(medianFloat(ringPixels[c]) - medianFloat(insidePixels[c]), -patchTone), patchTone);
        }

        for (size_t p = 0; p < mask.size(); p++) {
            if (mask[p] > 0) {
                for (size_t c = 0; c < 3; c++) {
                    result[p * 3 + c] = static_cast<float>(result[p * 3 + c] + shift[c]);
                }
            }
        }
    }

    const int span = right - left + 1 + patchRing;
    const int offset = right + span < width ? span : -span;
    constexpr int radius = 8;
    const int stripLeft = std::max(0, left + offset - radius);
    const int stripRight = std::min(width, right + offset + 1 + radius);
    const int stripTop = std::max(0, top - radius);
    const int stripBottom = std::min(height, bottom + 1 + radius);
    const int stripWidth = stripRight - stripLeft;
    const int stripHeight = stripBottom - stripTop;

    if (stripWidth > 0 && stripHeight > 0) {
        cv::Mat strip(stripHeight, stripWidth, CV_32FC3);
        cv::Mat blurred;

        for (int row = 0; row < stripHeight; row++) {
            float* target = strip.ptr<float>(row);
            const uint8_t* source = base.data.data() + (static_cast<size_t>(stripTop + row) * width + stripLeft) * 3;

            for (int column = 0; column < stripWidth * 3; column++) {
                target[column] = source[column];
            }
        }

        cv::GaussianBlur(strip, blurred, cv::Size(0, 0), 2);

        for (size_t p = 0; p < mask.size(); p++) {
            if (mask[p] == 0) {
                continue;
            }

            const int x = ((static_cast<int>(p % width) + offset) % width + width) % width;
            const int y = static_cast<int>(p / width);
            const int sx = x - stripLeft;
            const int sy = y - stripTop;

            if (sx < 0 || sx >= stripWidth || sy < 0 || sy >= stripHeight) {
                continue;
            }

            std::array<float, 3> grain{};
            float largest = 0;

            for (int c = 0; c < 3; c++) {
                grain[c] = strip.ptr<float>(sy)[sx * 3 + c] - blurred.ptr<float>(sy)[sx * 3 + c];
                largest = std::max(largest, std::abs(grain[c]));
            }

            if (largest > grainLimit) {
                continue;
            }

            for (size_t c = 0; c < 3; c++) {
                result[p * 3 + c] += grain[c];
            }
        }
    }

    Rgb out{width, height, std::vector<uint8_t>(result.size())};

    for (size_t i = 0; i < result.size(); i++) {
        out.data[i] = static_cast<uint8_t>(std::min(std::max(result[i], 0.0f), 255.0f));
    }

    return out;
}

}
