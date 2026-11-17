#include "Pictures.hpp"

#include <algorithm>
#include <cmath>

#include <opencv2/imgproc.hpp>

namespace engine {

namespace {

constexpr int pad = 3;
constexpr double minimumContrast = 40;
constexpr float sameColour = 60;

using Colour = std::array<float, 3>;

const Colour weights{static_cast<float>(0.299), static_cast<float>(0.587), static_cast<float>(0.114)};

struct Area {
    int x1 = 0;
    int y1 = 0;
    int x2 = 0;
    int y2 = 0;

    int width() const { return x2 - x1; }
    int height() const { return y2 - y1; }
};

// int(round(edge)) rounds half to even, as nearbyint does.
Area clipped(const PictureBox& box, int width, int height) {
    const auto edge = [&](size_t i) { return static_cast<int>(std::nearbyint(box[i])); };

    return {std::max(0, edge(0) - pad), std::max(0, edge(1) - pad), std::min(width, edge(2) + pad), std::min(height, edge(3) + pad)};
}

const uint8_t* pixelAt(const Rgba& image, int x, int y) {
    return image.data.data() + (static_cast<size_t>(y) * image.width + x) * 4;
}

// on_gray: composited onto mid gray in float32, so light and dark strokes on transparency both stand out.
std::vector<Colour> onGray(const Rgba& image, const Area& area) {
    std::vector<Colour> region;

    region.reserve(static_cast<size_t>(area.width()) * area.height());

    for (int y = area.y1; y < area.y2; y++) {
        for (int x = area.x1; x < area.x2; x++) {
            const uint8_t* pixel = pixelAt(image, x, y);
            const float alpha = static_cast<float>(pixel[3]) / 255.0f;
            Colour value{};

            for (int c = 0; c < 3; c++) {
                value[c] = static_cast<float>(pixel[c]) * alpha + 128.0f * (1.0f - alpha);
            }

            region.push_back(value);
        }
    }

    return region;
}

// np.median of float32: the middle value, or the float32 mean of the middle two.
float median(std::vector<float> values) {
    const size_t middle = values.size() / 2;

    std::nth_element(values.begin(), values.begin() + middle, values.end());

    const float upper = values[middle];

    if (values.size() % 2 == 1) {
        return upper;
    }

    const float lower = *std::max_element(values.begin(), values.begin() + middle);

    return (lower + upper) / 2.0f;
}

Colour medianColour(const std::vector<Colour>& colours) {
    Colour out{};

    for (int c = 0; c < 3; c++) {
        std::vector<float> channel;

        channel.reserve(colours.size());

        for (const Colour& colour : colours) {
            channel.push_back(colour[c]);
        }

        out[c] = median(std::move(channel));
    }

    return out;
}

Colour ringMedian(const std::vector<Colour>& region, int width, int height) {
    std::vector<Colour> ring;
    const auto at = [&](int x, int y) { return region[static_cast<size_t>(y) * width + x]; };

    for (int x = 0; x < width; x++) {
        ring.push_back(at(x, 0));
        ring.push_back(at(x, height - 1));
    }

    for (int y = 1; y < height - 1; y++) {
        ring.push_back(at(0, y));
        ring.push_back(at(width - 1, y));
    }

    return medianColour(ring);
}

// The luminance of one colour as numpy's dot gives it: float32 products summed in double.
float dotLuminance(const Colour& colour) {
    double sum = 0;

    for (int c = 0; c < 3; c++) {
        sum += static_cast<double>(colour[c] * weights[c]);
    }

    return static_cast<float>(sum);
}

// The luminance of each row of a matrix, as numpy's matrix-vector product gives it, in float32 throughout.
float rowLuminance(const Colour& colour) {
    return colour[0] * weights[0] + colour[1] * weights[1] + colour[2] * weights[2];
}

std::vector<uint8_t> strokes(const Rgba& image, const Area& area) {
    const int width = area.width();
    const int height = area.height();
    std::vector<uint8_t> found(static_cast<size_t>(width) * height, 0);

    if (height < 3 || width < 3) {
        return found;
    }

    const std::vector<Colour> region = onGray(image, area);
    const Colour background = ringMedian(region, width, height);
    cv::Mat distance(height, width, CV_8UC1);

    for (size_t p = 0; p < region.size(); p++) {
        const float d0 = region[p][0] - background[0];
        const float d1 = region[p][1] - background[1];
        const float d2 = region[p][2] - background[2];
        const float norm = std::sqrt(d0 * d0 + d1 * d1 + d2 * d2);

        distance.data[p] = static_cast<uint8_t>(std::clamp(norm, 0.0f, 255.0f));
    }

    cv::Mat ignored;
    const double otsu = cv::threshold(distance, ignored, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    const double limit = std::max(minimumContrast, otsu);

    for (size_t p = 0; p < found.size(); p++) {
        found[p] = distance.data[p] > limit ? 1 : 0;
    }

    return found;
}

std::array<int, 3> colourOf(const Colour& value) {
    return {static_cast<int>(std::nearbyint(value[0])), static_cast<int>(std::nearbyint(value[1])),
            static_cast<int>(std::nearbyint(value[2]))};
}

std::array<int, 3> contrasting(const Colour& background) {
    const double level = 0.299 * background[0] + 0.587 * background[1] + 0.114 * background[2];

    if (level > 140) {
        return {0, 0, 0};
    }

    return {255, 255, 255};
}

// The half of the pixels furthest toward bright or dark, so anti-aliasing doesn't pull a thin stroke toward
// the background.
std::vector<Colour> extreme(const std::vector<Colour>& pixels, bool bright) {
    std::vector<float> levels;

    levels.reserve(pixels.size());

    for (const Colour& pixel : pixels) {
        levels.push_back(rowLuminance(pixel));
    }

    const float middle = median(levels);
    std::vector<Colour> kept;

    for (size_t i = 0; i < pixels.size(); i++) {
        if (bright ? levels[i] >= middle : levels[i] <= middle) {
            kept.push_back(pixels[i]);
        }
    }

    return kept;
}

// np.percentile's linear method, in float64.
double percentile75(std::vector<float> values) {
    std::sort(values.begin(), values.end());

    const double index = 0.75 * static_cast<double>(values.size() - 1);
    const size_t below = static_cast<size_t>(std::floor(index));
    const size_t above = std::min(below + 1, values.size() - 1);
    const double gamma = index - static_cast<double>(below);
    const double a = values[below];
    const double b = values[above];
    const double difference = b - a;

    if (gamma >= 0.5) {
        return b - difference * (1 - gamma);
    }

    return a + difference * gamma;
}

float distanceBetween(const Colour& a, const Colour& b) {
    double sum = 0;

    for (int c = 0; c < 3; c++) {
        const float d = a[c] - b[c];

        sum += static_cast<double>(d * d);
    }

    return std::sqrt(static_cast<float>(sum));
}

}

std::vector<uint8_t> pictureMask(const Rgba& image, const std::vector<PictureBox>& boxes) {
    std::vector<uint8_t> mask(static_cast<size_t>(image.width) * image.height, 0);
    const cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, {7, 7});

    for (const PictureBox& box : boxes) {
        const Area area = clipped(box, image.width, image.height);

        if (area.x2 <= area.x1 || area.y2 <= area.y1) {
            continue;
        }

        std::vector<uint8_t> found = strokes(image, area);
        const auto count = std::count(found.begin(), found.end(), uint8_t{1});

        if (static_cast<double>(count) / static_cast<double>(found.size()) < 0.01) {
            for (int y = area.y1; y < area.y2; y++) {
                std::fill_n(mask.begin() + static_cast<size_t>(y) * image.width + area.x1, area.width(), uint8_t{255});
            }

            continue;
        }

        for (uint8_t& value : found) {
            value *= 255;
        }

        cv::Mat grown;

        cv::dilate(cv::Mat(area.height(), area.width(), CV_8UC1, found.data()), grown, kernel);

        for (int y = 0; y < area.height(); y++) {
            for (int x = 0; x < area.width(); x++) {
                uint8_t& out = mask[static_cast<size_t>(y + area.y1) * image.width + x + area.x1];

                out = std::max(out, grown.at<uint8_t>(y, x));
            }
        }
    }

    return mask;
}

LineColours lineColours(const Rgba& image, const PictureBox& box) {
    const Area area = clipped(box, image.width, image.height);

    if (area.width() < 3 || area.height() < 3) {
        return {{255, 255, 255}, std::nullopt};
    }

    std::vector<uint8_t> found = strokes(image, area);
    std::vector<Colour> rgb;
    size_t count = 0;

    for (int y = area.y1; y < area.y2; y++) {
        for (int x = area.x1; x < area.x2; x++) {
            const uint8_t* pixel = pixelAt(image, x, y);
            uint8_t& stroke = found[static_cast<size_t>(y - area.y1) * area.width() + x - area.x1];

            stroke = stroke != 0 && pixel[3] >= 128 ? 1 : 0;
            count += stroke;
            rgb.push_back({static_cast<float>(pixel[0]), static_cast<float>(pixel[1]), static_cast<float>(pixel[2])});
        }
    }

    const Colour background = ringMedian(onGray(image, area), area.width(), area.height());

    if (count < 4) {
        return {contrasting(background), std::nullopt};
    }

    cv::Mat padded = cv::Mat::zeros(area.height() + 2, area.width() + 2, CV_8UC1);

    cv::Mat(area.height(), area.width(), CV_8UC1, found.data()).copyTo(padded(cv::Rect(1, 1, area.width(), area.height())));

    cv::Mat depth;

    cv::distanceTransform(padded, depth, cv::DIST_L2, 3);

    const auto depthAt = [&](size_t p) {
        return depth.at<float>(static_cast<int>(p / area.width()) + 1, static_cast<int>(p % area.width()) + 1);
    };
    std::vector<float> depths;

    for (size_t p = 0; p < found.size(); p++) {
        if (found[p] != 0) {
            depths.push_back(depthAt(p));
        }
    }

    const double deep = std::max(1.0, percentile75(depths));
    std::vector<Colour> deepest;
    std::vector<Colour> edge;

    for (size_t p = 0; p < found.size(); p++) {
        if (found[p] == 0) {
            continue;
        }

        if (depthAt(p) >= deep) {
            deepest.push_back(rgb[p]);
        }

        if (depthAt(p) <= 1.0f) {
            edge.push_back(rgb[p]);
        }
    }

    const bool bright = dotLuminance(medianColour(deepest)) >= dotLuminance(background);
    const Colour fill = medianColour(extreme(deepest, bright));
    const Colour outline = edge.empty() ? fill : medianColour(extreme(edge, !bright));

    if (distanceBetween(outline, fill) < sameColour) {
        return {colourOf(fill), std::nullopt};
    }

    return {colourOf(fill), colourOf(outline)};
}

bool alphaNeedsInpainting(const Rgba& image, const std::vector<uint8_t>& mask) {
    cv::Mat around;

    cv::dilate(cv::Mat(image.height, image.width, CV_8UC1, const_cast<uint8_t*>(mask.data())), around,
               cv::Mat::ones(13, 13, CV_8UC1));

    for (size_t p = 0; p < mask.size(); p++) {
        if (around.data[p] > 0 && image.data[p * 4 + 3] < 250) {
            return true;
        }
    }

    return false;
}

Rgba mergedPicture(const Rgba& original, const std::vector<uint8_t>& mask, const Rgb& rgb, const std::vector<uint8_t>& alpha) {
    Rgba result = original;

    for (size_t p = 0; p < mask.size(); p++) {
        if (mask[p] == 0) {
            continue;
        }

        for (int c = 0; c < 3; c++) {
            result.data[p * 4 + c] = rgb.data[p * 3 + c];
        }

        uint8_t snapped = alpha[p];

        if (snapped < 10) {
            snapped = 0;
        } else if (snapped > 245) {
            snapped = 255;
        }

        result.data[p * 4 + 3] = snapped;
    }

    return result;
}

}
