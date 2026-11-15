// wenbu-manga-cv: full-page image operations for the native manga engine, with the OpenCV build the
// manga plugin used, so results match it exactly. It keeps images by id and answers one request at a
// time over stdin and stdout. It knows nothing about manga: callers pass images and get images back.
//
// Request:  u32 op, u32 param count, f64 params..., u32 buffer count, (u64 size, bytes)...
// Response: u32 status (0 ok, 1 failed), u32 param count, f64 params..., u32 buffer count, (u64 size, bytes)...
//           A failed response carries one buffer with the message.

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <io.h>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>

#include "densecrf.h"

namespace {

enum Op : uint32_t {
    Put = 1,
    Get = 2,
    Drop = 3,
    Resize = 4,
    Bilateral = 5,
    PanelFeatures = 6,
    Crf = 7,
};

using Bytes = std::vector<uint8_t>;

struct Request {
    uint32_t op = 0;
    std::vector<double> params;
    std::vector<Bytes> buffers;
};

struct Response {
    std::vector<double> params;
    std::vector<Bytes> buffers;
};

bool readExact(void* target, size_t size) {
    return size == 0 || std::fread(target, 1, size, stdin) == size;
}

void writeExact(const void* source, size_t size) {
    if (size > 0) {
        std::fwrite(source, 1, size, stdout);
    }
}

template <typename T> T readValue() {
    T value{};

    if (!readExact(&value, sizeof(T))) {
        throw std::runtime_error("end of input");
    }

    return value;
}

template <typename T> void writeValue(T value) {
    writeExact(&value, sizeof(T));
}

Request readRequest() {
    Request request;

    request.op = readValue<uint32_t>();
    request.params.resize(readValue<uint32_t>());

    for (auto& param : request.params) {
        param = readValue<double>();
    }

    request.buffers.resize(readValue<uint32_t>());

    for (auto& buffer : request.buffers) {
        buffer.resize(static_cast<size_t>(readValue<uint64_t>()));

        if (!readExact(buffer.data(), buffer.size())) {
            throw std::runtime_error("end of input");
        }
    }

    return request;
}

void writeResponse(uint32_t status, const Response& response) {
    writeValue<uint32_t>(status);
    writeValue<uint32_t>(static_cast<uint32_t>(response.params.size()));

    for (double param : response.params) {
        writeValue<double>(param);
    }

    writeValue<uint32_t>(static_cast<uint32_t>(response.buffers.size()));

    for (const auto& buffer : response.buffers) {
        writeValue<uint64_t>(buffer.size());
        writeExact(buffer.data(), buffer.size());
    }

    std::fflush(stdout);
}

int param(const Request& request, size_t index) {
    if (index >= request.params.size()) {
        throw std::runtime_error("missing parameter");
    }

    return static_cast<int>(request.params[index]);
}

double real(const Request& request, size_t index) {
    if (index >= request.params.size()) {
        throw std::runtime_error("missing parameter");
    }

    return request.params[index];
}

int typeOf(int channels, int depth) {
    return CV_MAKETYPE(depth == 4 ? CV_32F : CV_8U, channels);
}

Bytes bytesOf(const cv::Mat& mat) {
    cv::Mat continuous = mat.isContinuous() ? mat : mat.clone();
    const auto* start = continuous.ptr<uint8_t>();

    return Bytes(start, start + continuous.total() * continuous.elemSize());
}

std::map<int, cv::Mat> images;

const cv::Mat& image(int id) {
    auto found = images.find(id);

    if (found == images.end()) {
        throw std::runtime_error("unknown image " + std::to_string(id));
    }

    return found->second;
}

// params: id, width, height, channels, bytes per sample (1 or 4); buffer: the pixels.
Response put(const Request& request) {
    const int width = param(request, 1);
    const int height = param(request, 2);
    const int channels = param(request, 3);
    const int depth = param(request, 4);
    const auto& data = request.buffers.at(0);

    if (data.size() != static_cast<size_t>(width) * height * channels * depth) {
        throw std::runtime_error("the pixel buffer does not match its size");
    }

    cv::Mat mat(height, width, typeOf(channels, depth));

    std::memcpy(mat.data, data.data(), data.size());
    images[param(request, 0)] = mat;

    return {};
}

// params: id; returns width, height, channels and the pixels.
Response get(const Request& request) {
    const cv::Mat& mat = image(param(request, 0));

    return {{static_cast<double>(mat.cols), static_cast<double>(mat.rows), static_cast<double>(mat.channels())},
            {bytesOf(mat)}};
}

// params: source, target, width, height, interpolation.
Response resize(const Request& request) {
    cv::Mat out;

    cv::resize(image(param(request, 0)), out, cv::Size(param(request, 2), param(request, 3)), 0, 0,
               param(request, 4));
    images[param(request, 1)] = out;

    return {};
}

// params: source, target, diameter, sigma colour, sigma space.
Response bilateral(const Request& request) {
    cv::Mat out;

    cv::bilateralFilter(image(param(request, 0)), out, param(request, 2), real(request, 3), real(request, 4));
    images[param(request, 1)] = out;

    return {};
}

// What Kumiko reads from a page: the outer contours of its thresholded Sobel edges and its line
// segments. The image is converted as if it were BGR, because Kumiko is handed RGB pixels.
// params: source; returns the contours as int32 (count, then per contour its point count and points)
// and the segments as float32 (x0, y0, x1, y1 each).
Response panelFeatures(const Request& request) {
    cv::Mat gray;

    cv::cvtColor(image(param(request, 0)), gray, cv::COLOR_BGR2GRAY);

    cv::Mat gradX;
    cv::Mat gradY;
    cv::Mat absX;
    cv::Mat absY;
    cv::Mat sobel;
    cv::Mat thresh;

    cv::Sobel(gray, gradX, CV_16S, 1, 0, 3, 1, 0, cv::BORDER_DEFAULT);
    cv::Sobel(gray, gradY, CV_16S, 0, 1, 3, 1, 0, cv::BORDER_DEFAULT);
    cv::convertScaleAbs(gradX, absX);
    cv::convertScaleAbs(gradY, absY);
    cv::addWeighted(absX, 0.5, absY, 0.5, 0, sobel);
    cv::threshold(sobel, thresh, 100, 255, cv::THRESH_BINARY);

    std::vector<std::vector<cv::Point>> contours;

    cv::findContours(thresh, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);

    std::vector<int32_t> packed{static_cast<int32_t>(contours.size())};

    for (const auto& contour : contours) {
        packed.push_back(static_cast<int32_t>(contour.size()));

        for (const auto& point : contour) {
            packed.push_back(point.x);
            packed.push_back(point.y);
        }
    }

    std::vector<cv::Vec4f> lines;

    cv::createLineSegmentDetector(cv::LSD_REFINE_NONE)->detect(gray, lines);

    Bytes contourBytes(packed.size() * sizeof(int32_t));
    Bytes lineBytes(lines.size() * sizeof(cv::Vec4f));

    std::memcpy(contourBytes.data(), packed.data(), contourBytes.size());

    if (!lines.empty()) {
        std::memcpy(lineBytes.data(), lines.data(), lineBytes.size());
    }

    return {{}, {contourBytes, lineBytes}};
}

// pydensecrf's DenseCRF2D with a two-class unary from a 0/255 mask, one Gaussian and one bilateral
// Potts term without normalisation, as the plugin's mask refinement sets it up.
// params: width, height, gaussian sxy, gaussian compat, bilateral sxy, bilateral srgb, bilateral compat,
// iterations; buffers: RGB pixels, mask; returns the refined 0/255 mask.
Response crf(const Request& request) {
    const int width = param(request, 0);
    const int height = param(request, 1);
    const auto& rgb = request.buffers.at(0);
    const auto& mask = request.buffers.at(1);
    const size_t pixels = static_cast<size_t>(width) * height;

    if (rgb.size() != pixels * 3 || mask.size() != pixels) {
        throw std::runtime_error("the CRF buffers do not match their size");
    }

    const float clip = 1e-5f;
    MatrixXf unary(2, static_cast<Eigen::Index>(pixels));

    for (size_t index = 0; index < pixels; ++index) {
        const float on = std::max(static_cast<float>(mask[index]) / 255.0f, clip);
        const float off = std::max(static_cast<float>(static_cast<uint8_t>(~mask[index])) / 255.0f, clip);

        unary(0, static_cast<Eigen::Index>(index)) = -std::log(std::min(off, 1.0f));
        unary(1, static_cast<Eigen::Index>(index)) = -std::log(std::min(on, 1.0f));
    }

    DenseCRF2D model(width, height, 2);

    model.setUnaryEnergy(unary);

    const float gaussian = static_cast<float>(real(request, 2));
    const float bilateralXy = static_cast<float>(real(request, 4));
    const float bilateralRgb = static_cast<float>(real(request, 5));

    model.addPairwiseGaussian(gaussian, gaussian, new PottsCompatibility(static_cast<float>(real(request, 3))),
                              DIAG_KERNEL, NO_NORMALIZATION);
    model.addPairwiseBilateral(bilateralXy, bilateralXy, bilateralRgb, bilateralRgb, bilateralRgb, rgb.data(),
                               new PottsCompatibility(static_cast<float>(real(request, 6))), DIAG_KERNEL,
                               NO_NORMALIZATION);

    const MatrixXf q = model.inference(param(request, 7));
    Bytes out(pixels);

    for (size_t index = 0; index < pixels; ++index) {
        out[index] = q(1, static_cast<Eigen::Index>(index)) > q(0, static_cast<Eigen::Index>(index)) ? 255 : 0;
    }

    return {{}, {out}};
}

Response handle(const Request& request) {
    switch (request.op) {
    case Put:
        return put(request);
    case Get:
        return get(request);
    case Drop:
        images.erase(param(request, 0));
        return {};
    case Resize:
        return resize(request);
    case Bilateral:
        return bilateral(request);
    case PanelFeatures:
        return panelFeatures(request);
    case Crf:
        return crf(request);
    default:
        throw std::runtime_error("unknown operation " + std::to_string(request.op));
    }
}

} // namespace

int main() {
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);

    while (true) {
        Request request;

        try {
            request = readRequest();
        } catch (const std::exception&) {
            return 0;
        }

        try {
            writeResponse(0, handle(request));
        } catch (const std::exception& error) {
            const std::string message = error.what();

            writeResponse(1, {{}, {Bytes(message.begin(), message.end())}});
        }
    }
}
