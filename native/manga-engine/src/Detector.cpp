#include "Detector.hpp"

#include <algorithm>
#include <cstring>
#include <stdexcept>

#include <opencv2/imgproc.hpp>

#include "DbBoxes.hpp"

namespace engine {

namespace {

constexpr int detectSize = 2048;
constexpr int multiple = 256;
constexpr int minimumSide = 400;

// _add_border: small pages sit in the top-left corner of a black square.
cv::Mat withBorder(const cv::Mat& image) {
    const int side = std::max({image.cols, image.rows, minimumSide});
    cv::Mat square = cv::Mat::zeros(side, side, CV_8UC3);

    image.copyTo(square(cv::Rect(0, 0, image.cols, image.rows)));

    return square;
}

int padOf(int size) {
    return size % multiple == 0 ? 0 : multiple - size % multiple;
}

Grey greyOf(const cv::Mat& mat) {
    Grey grey{mat.cols, mat.rows, std::vector<uint8_t>(static_cast<size_t>(mat.cols) * mat.rows)};

    for (int y = 0; y < mat.rows; y++) {
        std::memcpy(grey.data.data() + static_cast<size_t>(y) * mat.cols, mat.ptr(y), mat.cols);
    }

    return grey;
}

}

Detector::Detector(Runtime& runtime, std::filesystem::path model) : runtime_(runtime), model_(std::move(model)) {}

// TensorRT-RTX compiles one engine for every page size; DirectML gets a session per size with its
// dimensions fixed.
Ort::Session& Detector::sessionFor(int height, int width) {
    const bool ranged = runtime_.backend() == Backend::TensorRtRtx;
    const std::pair<int, int> key = ranged ? std::pair{0, 0} : std::pair{height, width};
    std::scoped_lock guard(lock_);

    if (auto found = sessions_.find(key); found != sessions_.end()) {
        return found->second;
    }

    Shapes shapes;

    if (ranged) {
        shapes.smallest = "image:1x3x" + std::to_string(multiple) + "x" + std::to_string(multiple);
        shapes.profile = "image:1x3x2048x1536";
        shapes.largest = "image:1x3x" + std::to_string(detectSize) + "x" + std::to_string(detectSize);
    } else {
        shapes.dimensions = {{"height", height}, {"width", width}};
    }

    return sessions_.emplace(key, runtime_.session(model_, shapes)).first->second;
}

int Detector::shapes() {
    return 2 * (detectSize / multiple) - 1;
}

void Detector::warm(const std::function<bool()>& next) {
    // Pages are scaled to 2048 on their long side, and their short side is padded to a multiple of 256.
    for (int side = multiple; side <= detectSize; side += multiple) {
        for (const bool tall : {true, false}) {
            if (side == detectSize && !tall) {
                continue;
            }

            // Twice the size, so a short side of 256 stays above 400 pixels and is not squared.
            const int width = 2 * (tall ? side : detectSize);
            const int height = 2 * (tall ? detectSize : side);

            if (!next()) {
                return;
            }

            detect({width, height, std::vector<uint8_t>(static_cast<size_t>(width) * height * 3, 255)});
        }
    }
}

DetectorInput Detector::prepare(const Rgb& page) {
    const cv::Mat pageMat(page.height, page.width, CV_8UC3, const_cast<uint8_t*>(page.data.data()));
    const bool bordered = std::min(page.width, page.height) < minimumSide;
    const cv::Mat image = bordered ? withBorder(pageMat) : pageMat;
    DetectorInput input;

    input.pageWidth = page.width;
    input.pageHeight = page.height;
    input.square = bordered ? image.cols : 0;
    input.ratio = static_cast<double>(detectSize) / std::max(image.rows, image.cols);

    const int targetHeight = static_cast<int>(roundHalfEven(image.rows * input.ratio));
    const int targetWidth = static_cast<int>(roundHalfEven(image.cols * input.ratio));
    cv::Mat filtered;
    cv::Mat small;

    cv::bilateralFilter(image, filtered, 17, 80, 80);
    cv::resize(filtered, small, cv::Size(targetWidth, targetHeight), 0, 0, cv::INTER_LINEAR);

    input.padHeight = padOf(targetHeight);
    input.padWidth = padOf(targetWidth);
    input.height = targetHeight + input.padHeight;
    input.width = targetWidth + input.padWidth;

    const size_t plane = static_cast<size_t>(input.height) * input.width;

    input.pixels.assign(3 * plane, -1.0f);

    for (int y = 0; y < targetHeight; y++) {
        const uint8_t* row = small.ptr<uint8_t>(y);

        for (int x = 0; x < targetWidth; x++) {
            for (int channel = 0; channel < 3; channel++) {
                input.pixels[channel * plane + static_cast<size_t>(y) * input.width + x] =
                    static_cast<float>(row[x * 3 + channel]) / 127.5f - 1.0f;
            }
        }
    }

    return input;
}

Detection Detector::detect(const DetectorInput& prepared) {
    const bool bordered = prepared.square > 0;
    const double ratio = prepared.ratio;
    const int width = prepared.width;
    const int height = prepared.height;
    const int padWidth = prepared.padWidth;
    const int padHeight = prepared.padHeight;
    std::vector<float> pixels = prepared.pixels;
    const Ort::MemoryInfo cpu = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeDefault);
    const std::array<int64_t, 4> shape = {1, 3, height, width};
    const Ort::Value input = Ort::Value::CreateTensor<float>(cpu, pixels.data(), pixels.size(), shape.data(), 4);
    const char* inputNames[] = {"image"};
    const char* outputNames[] = {"db", "mask"};

    Ort::Session& session = sessionFor(height, width);

    std::vector<Ort::Value> outputs = runtime_.gpu().run(
        [&] { return session.Run(Ort::RunOptions{nullptr}, inputNames, &input, 1, outputNames, 2); },
        GpuPriority::Urgent);

    const cv::Mat shrink(height, width, CV_32FC1, outputs[0].GetTensorMutableData<float>());
    const double scale = 1 / ratio;
    Detection detection;

    for (const DbBox& box : dbBoxes(shrink, width, height)) {
        std::vector<cv::Point> points;

        for (const auto& point : box.points) {
            points.emplace_back(static_cast<int>(point.x * scale), static_cast<int>(point.y * scale));
        }

        Quad line = quad(points, box.score);

        if (quadArea(line) > 16) {
            detection.lines.push_back(line);
        }
    }

    const cv::Mat maskSource(height / 2, width / 2, CV_32FC1, outputs[1].GetTensorMutableData<float>());
    cv::Mat maskFull;

    cv::resize(maskSource, maskFull, cv::Size(width, height), 0, 0, cv::INTER_LINEAR);

    const int keptHeight = padHeight > 0 ? height - padHeight : height;
    const int keptWidth = padHeight == 0 && padWidth > 0 ? width - padWidth : width;
    cv::Mat raw(keptHeight, keptWidth, CV_8UC1);

    for (int y = 0; y < keptHeight; y++) {
        const float* source = maskFull.ptr<float>(y);
        uint8_t* target = raw.ptr<uint8_t>(y);

        for (int x = 0; x < keptWidth; x++) {
            target[x] = static_cast<uint8_t>(std::clamp(source[x] * 255.0f, 0.0f, 255.0f));
        }
    }

    if (!bordered) {
        detection.rawMask = greyOf(raw);

        return detection;
    }

    // _remove_border: lines past the page go, the rest are clamped to it, and the mask is stretched to
    // the bordered page and cut back to the original.
    std::vector<Quad> kept;

    for (const Quad& line : detection.lines) {
        int minX = line.pts[0].x;
        int minY = line.pts[0].y;

        for (const auto& point : line.pts) {
            minX = std::min(minX, point.x);
            minY = std::min(minY, point.y);
        }

        if (minX >= prepared.pageWidth && minY >= prepared.pageHeight) {
            continue;
        }

        std::vector<cv::Point> clamped;

        for (const auto& point : line.pts) {
            clamped.emplace_back(std::clamp(point.x, 0, prepared.pageWidth), std::clamp(point.y, 0, prepared.pageHeight));
        }

        kept.push_back(quad(clamped, line.score));
    }

    cv::Mat stretched;

    cv::resize(raw, stretched, cv::Size(prepared.square, prepared.square), 0, 0, cv::INTER_LINEAR);
    detection.lines = std::move(kept);
    detection.rawMask = greyOf(stretched(cv::Rect(0, 0, prepared.pageWidth, prepared.pageHeight)));

    return detection;
}

}
