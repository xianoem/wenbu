#include "PillowResize.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <numbers>

#include <opencv2/core.hpp>

namespace engine {

namespace {

constexpr int precisionBits = 32 - 8 - 2;
constexpr int half = 1 << (precisionBits - 1);

double triangle(double x) {
    const double distance = std::abs(x);

    return distance < 1 ? 1 - distance : 0;
}

double sinc(double x) {
    return x == 0 ? 1 : std::sin(x * std::numbers::pi) / (x * std::numbers::pi);
}

double lanczos(double x) {
    return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
}

struct Coefficients {
    int size = 0;
    std::vector<int> bounds;
    std::vector<int> weights;
};

Coefficients coefficientsOf(int inSize, int outSize, Filter filter) {
    const double reach = filter == Filter::Lanczos ? 3 : 1;
    const double scale = static_cast<double>(inSize) / outSize;
    const double filterScale = std::max(scale, 1.0);
    const double inverse = 1 / filterScale;
    const double support = reach * filterScale;
    Coefficients coefficients;

    coefficients.size = static_cast<int>(std::ceil(support)) * 2 + 1;
    coefficients.bounds.resize(static_cast<size_t>(outSize) * 2);
    coefficients.weights.resize(static_cast<size_t>(outSize) * coefficients.size);

    std::vector<double> row(coefficients.size);

    for (int out = 0; out < outSize; out++) {
        const double center = (out + 0.5) * scale;
        const int min = std::max(0, static_cast<int>(center - support + 0.5));
        const int count = std::min(inSize, static_cast<int>(center + support + 0.5)) - min;
        double total = 0;

        std::fill(row.begin(), row.end(), 0.0);

        for (int x = 0; x < count; x++) {
            const double position = (x + min - center + 0.5) * inverse;
            const double weight = filter == Filter::Lanczos ? lanczos(position) : triangle(position);

            row[x] = weight;
            total += weight;
        }

        for (int x = 0; x < count; x++) {
            const double weight = total == 0 ? row[x] : row[x] / total;

            coefficients.weights[static_cast<size_t>(out) * coefficients.size + x] =
                weight < 0 ? static_cast<int>(-0.5 + weight * (1 << precisionBits))
                           : static_cast<int>(0.5 + weight * (1 << precisionBits));
        }

        coefficients.bounds[static_cast<size_t>(out) * 2] = min;
        coefficients.bounds[static_cast<size_t>(out) * 2 + 1] = count;
    }

    return coefficients;
}

uint8_t clip8(int value) {
    const int shifted = value >> precisionBits;

    if (shifted < 0) {
        return 0;
    }

    return static_cast<uint8_t>(shifted > 255 ? 255 : shifted);
}

Rgb horizontal(const Rgb& image, int width, Filter filter) {
    const Coefficients c = coefficientsOf(image.width, width, filter);
    Rgb out{width, image.height, std::vector<uint8_t>(static_cast<size_t>(width) * image.height * 3)};

    cv::parallel_for_(cv::Range(0, image.height), [&](const cv::Range& rows) {
        for (int y = rows.start; y < rows.end; y++) {
            const uint8_t* row = image.data.data() + static_cast<size_t>(y) * image.width * 3;

            for (int x = 0; x < width; x++) {
                const int min = c.bounds[static_cast<size_t>(x) * 2];
                const int count = c.bounds[static_cast<size_t>(x) * 2 + 1];
                const int* weights = c.weights.data() + static_cast<size_t>(x) * c.size;

                for (int channel = 0; channel < 3; channel++) {
                    int sum = half;

                    for (int k = 0; k < count; k++) {
                        sum += row[(min + k) * 3 + channel] * weights[k];
                    }

                    out.data[(static_cast<size_t>(y) * width + x) * 3 + channel] = clip8(sum);
                }
            }
        }
    });

    return out;
}

Rgb vertical(const Rgb& image, int height, Filter filter) {
    const Coefficients c = coefficientsOf(image.height, height, filter);
    const size_t stride = static_cast<size_t>(image.width) * 3;
    Rgb out{image.width, height, std::vector<uint8_t>(stride * height)};

    cv::parallel_for_(cv::Range(0, height), [&](const cv::Range& rows) {
        for (int y = rows.start; y < rows.end; y++) {
            const int min = c.bounds[static_cast<size_t>(y) * 2];
            const int count = c.bounds[static_cast<size_t>(y) * 2 + 1];
            const int* weights = c.weights.data() + static_cast<size_t>(y) * c.size;

            for (size_t column = 0; column < stride; column++) {
                int sum = half;

                for (int k = 0; k < count; k++) {
                    sum += image.data[(min + k) * stride + column] * weights[k];
                }

                out.data[y * stride + column] = clip8(sum);
            }
        }
    });

    return out;
}

}

Rgb pillowResize(const Rgb& image, int width, int height, Filter filter) {
    const Rgb wide = width == image.width ? image : horizontal(image, width, filter);

    return height == image.height ? wide : vertical(wide, height, filter);
}

Rgb cropImage(const Rgb& image, int left, int top, int right, int bottom) {
    const int width = right - left;
    const int height = bottom - top;
    Rgb out{width, height, std::vector<uint8_t>(static_cast<size_t>(std::max(0, width * height * 3)))};

    for (int y = std::max(top, 0); y < std::min(bottom, image.height); y++) {
        const int from = std::max(left, 0);
        const int to = std::min(right, image.width);

        if (to > from) {
            std::memcpy(out.data.data() + (static_cast<size_t>(y - top) * width + from - left) * 3,
                        image.data.data() + (static_cast<size_t>(y) * image.width + from) * 3,
                        static_cast<size_t>(to - from) * 3);
        }
    }

    return out;
}

}
