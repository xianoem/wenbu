// The Hayai reader's host-side preprocessing (processing_hayai.py and modeling_hayai.py): the NaFlex size
// search, the Pillow resize, 16-pixel patches and the antialiased position-embedding weights.
#pragma once

#include <cstdint>
#include <vector>

#include "Images.hpp"

namespace engine {

constexpr int patchSize = 16;
constexpr int patchBytes = patchSize * patchSize * 3;
constexpr int positionCells = 256;

struct NaFlexSize {
    int height = 0;
    int width = 0;
    int rows = 0;
    int columns = 0;
};

// _naflex_target_size: the largest patch grid within the budget, raised to 64 patches for tiny crops.
NaFlexSize naflexSize(int height, int width, int maxPatches);

struct Patches {
    NaFlexSize size;
    std::vector<uint8_t> pixels;
};

// _decode_and_patchify_u8: patches in row-major order, each 16 rows of 16 RGB pixels.
Patches patchify(const Rgb& crop, int maxPatches);

// _aa_grid_weights: for each patch, its weight on each of the 16 x 16 position embeddings.
std::vector<float> positionWeights(int rows, int columns);

}
