// Region inpainting as the plugin plans it (wenbu_manga/inpainting.py and LaMa's _infer): the mask's
// connected parts become crops with context around them, aligned to 8 pixels and merged where they overlap.
// Unlike the plugin, LaMa (lama_large_512px, exported with dynamic size) sees each crop in a window of the
// page widened to one of a few fixed sizes, because TensorRT-RTX compiles kernels for every new input
// shape. Only the crop's masked pixels change.
#pragma once

#include <array>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <vector>

#include <opencv2/core.hpp>

#include "Images.hpp"
#include "Runtime.hpp"

namespace engine {

using Box = std::array<int, 4>;

// The crops LaMa fills: each connected part of the mask, with context, aligned and merged.
std::vector<Box> inpaintCrops(const std::vector<uint8_t>& mask, int width, int height);

struct FourierTables {
    int k = 0;
    std::vector<float> cw;
    std::vector<float> sw;
    std::vector<float> ch;
    std::vector<float> sh;
    std::vector<float> icw;
    std::vector<float> isw;
};

// The real 2-D DFT tables LaMa's Fourier units multiply by, for features of h by w (an eighth of the crop).
FourierTables fourierTables(int h, int w);

// LaMa's input side for a side of `length` pixels: at least 256, then steps of 128 up to 1024 and of 256
// beyond, which keeps the padding small while TensorRT-RTX compiles a bounded number of shapes.
int modelSide(int length);

// Where LaMa looks for one crop: `region` of the page, centred on the crop and kept inside the page, is
// scaled by `scale` to `scaled` pixels and padded by mirroring to `model`.
struct LamaWindow {
    Box region{};
    double scale = 1;
    std::array<int, 2> scaled{};
    std::array<int, 2> model{};
};

// The window for a crop of a page `width` by `height`, with crops longer than `size` scaled down to it.
LamaWindow lamaWindow(const Box& crop, int width, int height, int size);

struct InpaintOptions {
    // The longest side LaMa sees; larger crops are scaled down first.
    int size = 2048;
    // Inpaints the whole page in one pass instead of crops around the mask.
    bool wholePage = false;
};

class Inpainter {
public:
    Inpainter(Runtime& runtime, std::filesystem::path model);

    Rgb inpaint(const Rgb& image, const std::vector<uint8_t>& mask, const InpaintOptions& options);

    // How many input sizes a crop up to `size` can take.
    static int sizes(int size);

    // Runs LaMa once at every input size a crop up to `size` can take, so TensorRT-RTX has compiled them all
    // before the first page. `next` is asked before each size and stops the warm-up by returning false.
    void warm(int size, const std::function<bool()>& next);

private:
    // LaMa's _infer on one crop's window: the crop's masked pixels in `result` take LaMa's output.
    void fill(const Rgb& image, const std::vector<uint8_t>& mask, const Box& crop, int size, Rgb& result);

    // LaMa on an image and mask of one of the model's sizes; the top-left `width` by `height` of its output.
    cv::Mat paint(const cv::Mat& image, const cv::Mat& mask, int width, int height);

    Graph& lama();

    Runtime& runtime_;
    std::filesystem::path model_;
    std::mutex lock_;
    std::optional<Graph> lama_;
};

}
