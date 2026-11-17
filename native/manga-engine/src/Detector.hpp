// manga-image-translator's default detector (DBNet ResNet34), without its rearranged path for tall strips.
#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <mutex>
#include <vector>

#include "Images.hpp"
#include "Quad.hpp"
#include "Runtime.hpp"

namespace engine {

struct Grey {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> data;
};

struct Detection {
    std::vector<Quad> lines;
    // The detector's text mask, at the page's size for small pages and at the detection size otherwise.
    Grey rawMask;
};

// The detector's input for a page: filtered, scaled to 2048 on its long side and padded. It needs no model,
// so a run makes it before the page's turn to find text.
struct DetectorInput {
    int pageWidth = 0;
    int pageHeight = 0;
    // Small pages sit in a black square of this side.
    int square = 0;
    double ratio = 1;
    int width = 0;
    int height = 0;
    int padWidth = 0;
    int padHeight = 0;
    std::vector<float> pixels;
};

class Detector {
public:
    Detector(Runtime& runtime, std::filesystem::path model);

    static DetectorInput prepare(const Rgb& page);

    Detection detect(const DetectorInput& input);

    Detection detect(const Rgb& page) { return detect(prepare(page)); }

    // How many input shapes pages can give.
    static int shapes();

    // Detects on a blank page of every input shape a page can give, so TensorRT-RTX has compiled them all.
    // `next` is asked before each shape and stops the warm-up by returning false.
    void warm(const std::function<bool()>& next);

private:
    Ort::Session& sessionFor(int height, int width);

    Runtime& runtime_;
    std::filesystem::path model_;
    std::mutex lock_;
    std::map<std::pair<int, int>, Ort::Session> sessions_;
};

}
