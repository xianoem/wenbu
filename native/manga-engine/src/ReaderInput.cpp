#include "ReaderInput.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "PillowResize.hpp"

namespace engine {

namespace {

constexpr int minPatches = 64;
constexpr double maxScale = 4;
constexpr int positionSide = 16;

int sideAt(int length, double scale) {
    return std::max(patchSize, static_cast<int>(std::ceil(length * scale / patchSize)) * patchSize);
}

double searchScale(int height, int width, double low, double high, int maxPatches) {
    double lowest = low;
    double highest = high;

    while (highest - lowest >= 1e-5) {
        const double scale = 0.5 * (lowest + highest);

        if ((sideAt(height, scale) / patchSize) * (sideAt(width, scale) / patchSize) <= maxPatches) {
            lowest = scale;
        } else {
            highest = scale;
        }
    }

    return lowest;
}

NaFlexSize sizeAt(int height, int width, double scale) {
    const int th = sideAt(height, scale);
    const int tw = sideAt(width, scale);

    return {th, tw, th / patchSize, tw / patchSize};
}

// One axis of PyTorch's antialiased bilinear interpolation from 16 cells, in float32 like ATen.
std::vector<float> axisWeights(int outSize) {
    const float scale = static_cast<float>(positionSide) / static_cast<float>(outSize);
    const float support = scale >= 1 ? scale : 1.0f;
    const float inverse = scale >= 1 ? 1.0f / scale : 1.0f;
    std::vector<float> weights(static_cast<size_t>(outSize) * positionSide, 0.0f);

    for (int out = 0; out < outSize; out++) {
        const float center = scale * (static_cast<float>(out) + 0.5f);
        const int min = std::max(static_cast<int>(center - support + 0.5f), 0);
        const int count = std::min(static_cast<int>(center + support + 0.5f), positionSide) - min;
        std::vector<float> row;
        float total = 0;

        for (int j = 0; j < count; j++) {
            const float x = std::abs((static_cast<float>(j + min) - center + 0.5f) * inverse);
            const float weight = x < 1 ? 1.0f - x : 0.0f;

            row.push_back(weight);
            total += weight;
        }

        for (int j = 0; j < count; j++) {
            weights[static_cast<size_t>(out) * positionSide + min + j] = total == 0 ? 0 : row[j] / total;
        }
    }

    return weights;
}

}

NaFlexSize naflexSize(int height, int width, int maxPatches) {
    const double scale = searchScale(height, width, 1e-5, maxScale, maxPatches);
    const NaFlexSize size = sizeAt(height, width, scale);

    if (size.rows * size.columns >= minPatches) {
        return size;
    }

    return sizeAt(height, width, searchScale(height, width, scale, 100, std::min(minPatches, maxPatches)));
}

Patches patchify(const Rgb& crop, int maxPatches) {
    Patches patches;

    patches.size = naflexSize(crop.height, crop.width, maxPatches);

    const NaFlexSize& size = patches.size;
    const Rgb image = size.width == crop.width && size.height == crop.height
                          ? crop
                          : pillowResize(crop, size.width, size.height);

    patches.pixels.resize(static_cast<size_t>(size.rows) * size.columns * patchBytes);

    for (int row = 0; row < size.rows; row++) {
        for (int column = 0; column < size.columns; column++) {
            uint8_t* patch = patches.pixels.data() + (static_cast<size_t>(row) * size.columns + column) * patchBytes;

            for (int y = 0; y < patchSize; y++) {
                const size_t from = ((static_cast<size_t>(row) * patchSize + y) * size.width + column * patchSize) * 3;

                std::memcpy(patch + static_cast<size_t>(y) * patchSize * 3, image.data.data() + from, patchSize * 3);
            }
        }
    }

    return patches;
}

std::vector<float> positionWeights(int rows, int columns) {
    const std::vector<float> vertical = axisWeights(rows);
    const std::vector<float> horizontal = axisWeights(columns);
    std::vector<float> weights(static_cast<size_t>(rows) * columns * positionCells, 0.0f);

    for (int row = 0; row < rows; row++) {
        for (int column = 0; column < columns; column++) {
            float* patch = weights.data() + (static_cast<size_t>(row) * columns + column) * positionCells;

            for (int a = 0; a < positionSide; a++) {
                const float wy = vertical[static_cast<size_t>(row) * positionSide + a];

                if (wy == 0) {
                    continue;
                }

                for (int b = 0; b < positionSide; b++) {
                    patch[a * positionSide + b] = wy * horizontal[static_cast<size_t>(column) * positionSide + b];
                }
            }
        }
    }

    return weights;
}

}
