#include "Inpaint.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <numbers>
#include <tuple>

#include <opencv2/imgproc.hpp>

#include "DbBoxes.hpp"

namespace engine {

namespace {

constexpr int minContext = 48;
constexpr int align = 8;

// LaMa's input shapes (width, height) by how often the crops of 44 manga pages met them, most common first.
constexpr std::array<std::array<int, 2>, 53> commonShapes = {{
    {1280, 2048}, {512, 768}, {640, 896}, {896, 1280}, {512, 640}, {768, 1280}, {896, 2048}, {384, 640}, {640, 1024},
    {768, 2048}, {1024, 2048}, {384, 512}, {640, 768}, {1792, 2048}, {1536, 2048}, {1280, 1536}, {1024, 1792},
    {768, 1024}, {512, 896}, {1024, 1536}, {768, 896}, {896, 896}, {1536, 1280}, {768, 1536}, {896, 1792},
    {640, 1280}, {1536, 1536}, {768, 1792}, {2048, 1792}, {1024, 1280}, {1280, 1280}, {2048, 1536}, {384, 768},
    {384, 384}, {256, 384}, {1024, 1024}, {1280, 1792}, {896, 768}, {1536, 512}, {256, 256}, {1792, 1536},
    {1024, 896}, {512, 1280}, {896, 1536}, {640, 1536}, {2048, 896}, {1536, 1792}, {2048, 2048}, {1792, 1792},
    {1792, 1280}, {512, 1536}, {640, 640}, {1280, 1024}}};

std::pair<int, int> grow(int start, int end, int limit) {
    const int target = static_cast<int>(std::ceil(static_cast<double>(end - start) / align)) * align;

    if (target > limit) {
        return {start, end};
    }

    const int stop = std::min(limit, start + target);

    return {stop - target, stop};
}

Box aligned(const Box& box, int width, int height) {
    const auto [left, right] = grow(box[0], box[2], width);
    const auto [top, bottom] = grow(box[1], box[3], height);

    return {left, top, right, bottom};
}

Box withContext(const Box& box, int width, int height) {
    const auto [x1, y1, x2, y2] = box;
    const int margin = std::max(minContext, std::max(x2 - x1, y2 - y1) / 2);

    return aligned({std::max(0, x1 - margin), std::max(0, y1 - margin), std::min(width, x2 + margin),
                    std::min(height, y2 + margin)},
                   width, height);
}

bool overlaps(const Box& a, const Box& b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

std::vector<Box> merged(const std::vector<Box>& boxes, int width, int height) {
    std::vector<Box> pending = boxes;
    std::vector<Box> done;

    while (!pending.empty()) {
        Box box = pending.back();
        bool absorbed = true;

        pending.pop_back();

        while (absorbed) {
            absorbed = false;

            std::vector<Box> others = done;

            others.insert(others.end(), pending.begin(), pending.end());

            for (const Box& other : others) {
                if (!overlaps(box, other)) {
                    continue;
                }

                box = aligned({std::min(box[0], other[0]), std::min(box[1], other[1]), std::max(box[2], other[2]),
                               std::max(box[3], other[3])},
                              width, height);

                // Python's `other in done` and `list.remove` compare boxes by value, not identity.
                std::vector<Box>& list = std::find(done.begin(), done.end(), other) != done.end() ? done : pending;

                list.erase(std::find(list.begin(), list.end(), other));
                absorbed = true;

                break;
            }
        }

        done.push_back(box);
    }

    std::stable_sort(done.begin(), done.end(), [](const Box& a, const Box& b) { return a[1] == b[1] ? a[0] < b[0] : a[1] < b[1]; });

    return done;
}

cv::Mat resized(const cv::Mat& source, int width, int height, bool exact) {
    cv::Mat out;

    cv::resize(source, out, cv::Size(width, height), 0, 0, exact ? cv::INTER_LINEAR_EXACT : cv::INTER_LINEAR);

    return out;
}

// `extent` pixels of a side `limit` long, centred on start to end where the page allows.
std::pair<int, int> widened(int start, int end, int extent, int limit) {
    const int from = std::clamp(start - (extent - (end - start)) / 2, 0, limit - extent);

    return {from, from + extent};
}

int scaledLength(int length, double scale) {
    return std::max(1, static_cast<int>(roundHalfEven(length * scale)));
}

}

int modelSide(int length) {
    if (length <= 256) {
        return 256;
    }

    const int step = length <= 1024 ? 128 : 256;

    return (length + step - 1) / step * step;
}

LamaWindow lamaWindow(const Box& crop, int width, int height, int size) {
    const auto [x1, y1, x2, y2] = crop;
    const int w = x2 - x1;
    const int h = y2 - y1;
    LamaWindow window;

    if (std::max(w, h) > size) {
        window.scale = static_cast<double>(size) / std::max(w, h);
    }

    const bool scaled = window.scale < 1;

    window.model = {modelSide(scaled ? scaledLength(w, window.scale) : w), modelSide(scaled ? scaledLength(h, window.scale) : h)};

    const auto extent = [&](int length, int side, int limit) {
        const int wanted = scaled ? static_cast<int>(std::floor(side / window.scale)) : side;

        return std::min(limit, std::max(length, wanted));
    };
    const int regionWidth = extent(w, window.model[0], width);
    const int regionHeight = extent(h, window.model[1], height);
    const auto [left, right] = widened(x1, x2, regionWidth, width);
    const auto [top, bottom] = widened(y1, y2, regionHeight, height);

    window.region = {left, top, right, bottom};

    if (scaled) {
        window.scaled = {std::min(window.model[0], scaledLength(regionWidth, window.scale)),
                         std::min(window.model[1], scaledLength(regionHeight, window.scale))};
    } else {
        window.scaled = {regionWidth, regionHeight};
    }

    return window;
}

std::vector<Box> inpaintCrops(const std::vector<uint8_t>& mask, int width, int height) {
    const cv::Mat binary = cv::Mat(height, width, CV_8UC1, const_cast<uint8_t*>(mask.data())) >= 127;
    cv::Mat labels;
    cv::Mat stats;
    cv::Mat centroids;
    const int count = cv::connectedComponentsWithStats(binary / 255, labels, stats, centroids, 8);
    std::vector<Box> boxes;

    for (int label = 1; label < count; label++) {
        const int x = stats.at<int>(label, cv::CC_STAT_LEFT);
        const int y = stats.at<int>(label, cv::CC_STAT_TOP);

        boxes.push_back(withContext(
            {x, y, x + stats.at<int>(label, cv::CC_STAT_WIDTH), y + stats.at<int>(label, cv::CC_STAT_HEIGHT)}, width,
            height));
    }

    return merged(boxes, width, height);
}

FourierTables fourierTables(int h, int w) {
    FourierTables tables;
    const int k = w / 2 + 1;
    const double scale = 1 / std::sqrt(static_cast<double>(h) * w);

    tables.k = k;
    tables.cw.resize(static_cast<size_t>(w) * k);
    tables.sw.resize(static_cast<size_t>(w) * k);
    tables.icw.resize(static_cast<size_t>(k) * w);
    tables.isw.resize(static_cast<size_t>(k) * w);
    tables.ch.resize(static_cast<size_t>(h) * h);
    tables.sh.resize(static_cast<size_t>(h) * h);

    for (int x = 0; x < w; x++) {
        for (int f = 0; f < k; f++) {
            const double angle = (static_cast<double>((x * f) % w) * 2 * std::numbers::pi) / w;
            const double weight = f == 0 || (w % 2 == 0 && f == w / 2) ? 1 : 2;

            tables.cw[static_cast<size_t>(x) * k + f] = static_cast<float>(std::cos(angle) * scale);
            tables.sw[static_cast<size_t>(x) * k + f] = static_cast<float>(std::sin(angle) * scale);
            tables.icw[static_cast<size_t>(f) * w + x] = static_cast<float>(std::cos(angle) * weight * scale);
            tables.isw[static_cast<size_t>(f) * w + x] = static_cast<float>(std::sin(angle) * weight * scale);
        }
    }

    for (int y = 0; y < h; y++) {
        for (int v = 0; v < h; v++) {
            const double angle = (static_cast<double>((y * v) % h) * 2 * std::numbers::pi) / h;

            tables.ch[static_cast<size_t>(y) * h + v] = static_cast<float>(std::cos(angle));
            tables.sh[static_cast<size_t>(y) * h + v] = static_cast<float>(std::sin(angle));
        }
    }

    return tables;
}

Inpainter::Inpainter(Runtime& runtime, std::filesystem::path model) : runtime_(runtime), model_(std::move(model)) {}

Graph& Inpainter::lama() {
    std::scoped_lock guard(lock_);

    if (!lama_) {
        lama_.emplace(runtime_, model_);
    }

    return *lama_;
}

void Inpainter::fill(const Rgb& image, const std::vector<uint8_t>& mask, const Box& crop, int size, Rgb& result) {
    const LamaWindow window = lamaWindow(crop, image.width, image.height, size);
    const auto [left, top, right, bottom] = window.region;
    const auto [scaledWidth, scaledHeight] = window.scaled;
    const auto [modelWidth, modelHeight] = window.model;
    const cv::Rect area(left, top, right - left, bottom - top);
    cv::Mat region = cv::Mat(image.height, image.width, CV_8UC3, const_cast<uint8_t*>(image.data.data()))(area);
    cv::Mat regionMask = cv::Mat(image.height, image.width, CV_8UC1, const_cast<uint8_t*>(mask.data()))(area);

    if (window.scale < 1) {
        region = resized(region, scaledWidth, scaledHeight, true);
        regionMask = resized(regionMask, scaledWidth, scaledHeight, true);
    }

    // Past the page's edge LaMa sees the page mirrored, as context and never as a hole.
    cv::Mat padded;
    cv::Mat paddedMask;

    cv::copyMakeBorder(region, padded, 0, modelHeight - scaledHeight, 0, modelWidth - scaledWidth, cv::BORDER_REFLECT);
    cv::copyMakeBorder(regionMask, paddedMask, 0, modelHeight - scaledHeight, 0, modelWidth - scaledWidth,
                       cv::BORDER_CONSTANT, cv::Scalar(0));

    cv::Mat painted = paint(padded, paddedMask, scaledWidth, scaledHeight);

    if (window.scale < 1) {
        painted = resized(painted, area.width, area.height, false);
    }

    const auto [x1, y1, x2, y2] = crop;

    for (int y = y1; y < y2; y++) {
        const uint8_t* row = painted.ptr<uint8_t>(y - top);

        for (int x = x1; x < x2; x++) {
            const size_t p = static_cast<size_t>(y) * image.width + x;

            if (mask[p] >= 127) {
                std::memcpy(result.data.data() + p * 3, row + (x - left) * 3, 3);
            }
        }
    }
}

cv::Mat Inpainter::paint(const cv::Mat& image, const cv::Mat& mask, int width, int height) {
    const int modelWidth = image.cols;
    const int modelHeight = image.rows;
    const size_t plane = static_cast<size_t>(modelWidth) * modelHeight;
    std::vector<float> pixels(3 * plane);
    std::vector<float> holes(plane);

    for (int y = 0; y < modelHeight; y++) {
        const uint8_t* imageRow = image.ptr<uint8_t>(y);
        const uint8_t* maskRow = mask.ptr<uint8_t>(y);

        for (int x = 0; x < modelWidth; x++) {
            const size_t p = static_cast<size_t>(y) * modelWidth + x;
            const float hole = static_cast<float>(maskRow[x]) / 255.0f >= 0.5f ? 1.0f : 0.0f;

            holes[p] = hole;

            for (int c = 0; c < 3; c++) {
                pixels[c * plane + p] = static_cast<float>(imageRow[x * 3 + c]) / 255.0f * (1.0f - hole);
            }
        }
    }

    const int fh = modelHeight / align;
    const int fw = modelWidth / align;
    FourierTables tables = fourierTables(fh, fw);
    const Ort::MemoryInfo cpu = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeDefault);
    const auto tensor = [&](std::vector<float>& data, std::vector<int64_t> shape) {
        return Ort::Value::CreateTensor<float>(cpu, data.data(), data.size(), shape.data(), shape.size());
    };
    std::vector<Ort::Value> inputs;

    inputs.push_back(tensor(pixels, {1, 3, modelHeight, modelWidth}));
    inputs.push_back(tensor(holes, {1, 1, modelHeight, modelWidth}));
    inputs.push_back(tensor(tables.cw, {fw, tables.k}));
    inputs.push_back(tensor(tables.sw, {fw, tables.k}));
    inputs.push_back(tensor(tables.ch, {fh, fh}));
    inputs.push_back(tensor(tables.sh, {fh, fh}));
    inputs.push_back(tensor(tables.icw, {tables.k, fw}));
    inputs.push_back(tensor(tables.isw, {tables.k, fw}));

    const std::vector<const char*> names = {"image", "mask", "cw", "sw", "ch", "sh", "icw", "isw"};
    std::vector<const OrtValue*> values;

    for (const Ort::Value& input : inputs) {
        values.push_back(input);
    }

    const std::vector<Ort::Value> outputs = lama().run(names, values, {"output"});

    const float* output = outputs[0].GetTensorData<float>();
    cv::Mat painted(height, width, CV_8UC3);

    for (int y = 0; y < height; y++) {
        uint8_t* row = painted.ptr<uint8_t>(y);

        for (int x = 0; x < width; x++) {
            const size_t p = static_cast<size_t>(y) * modelWidth + x;

            for (int c = 0; c < 3; c++) {
                row[x * 3 + c] = static_cast<uint8_t>(static_cast<int>(output[c * plane + p] * 255.0f));
            }
        }
    }

    return painted;
}

std::vector<std::array<int, 2>> warmShapes(int size) {
    std::vector<std::array<int, 2>> shapes;

    for (int height = 256; height <= modelSide(size); height = modelSide(height + 1)) {
        for (int width = 256; width <= modelSide(size); width = modelSide(width + 1)) {
            shapes.push_back({width, height});
        }
    }

    const auto order = [](const std::array<int, 2>& shape) {
        const auto rank = std::find(commonShapes.begin(), commonShapes.end(), shape) - commonShapes.begin();

        return std::tuple(rank, std::max(shape[0], shape[1]), shape[0] * shape[1]);
    };

    std::stable_sort(shapes.begin(), shapes.end(), [&](const auto& a, const auto& b) { return order(a) < order(b); });

    return shapes;
}

int Inpainter::sizes(int size) {
    return static_cast<int>(warmShapes(size).size());
}

void Inpainter::warm(int size, const std::function<bool()>& next) {
    for (const auto& [width, height] : warmShapes(size)) {
        if (!next()) {
            return;
        }

        paint(cv::Mat::zeros(height, width, CV_8UC3), cv::Mat::zeros(height, width, CV_8UC1), width, height);
    }
}

Rgb Inpainter::inpaint(const Rgb& image, const std::vector<uint8_t>& mask, const InpaintOptions& options) {
    const std::vector<Box> crops =
        options.wholePage ? std::vector<Box>{{0, 0, image.width, image.height}} : inpaintCrops(mask, image.width, image.height);

    Rgb result = image;

    for (const Box& crop : crops) {
        fill(image, mask, crop, options.size, result);
    }

    return result;
}

}
