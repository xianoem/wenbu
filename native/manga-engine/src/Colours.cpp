#include "Colours.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

#include <opencv2/imgproc.hpp>

namespace engine {

namespace {

constexpr double minimumDifference = 30;

int median(std::vector<int> values) {
    if (values.empty()) {
        return 0;
    }

    std::sort(values.begin(), values.end());

    return values[values.size() / 2];
}

Colour medianColour(const Rgb& page, const std::vector<size_t>& pixels) {
    Colour colour{};

    for (size_t channel = 0; channel < 3; channel++) {
        std::vector<int> values;

        values.reserve(pixels.size());

        for (const size_t p : pixels) {
            values.push_back(page.data[p * 3 + channel]);
        }

        colour[channel] = median(std::move(values));
    }

    return colour;
}

// CIE76 with lightness weighted by 0.392, on OpenCV's 8-bit Lab, as color_difference computes it.
double colourDifference(const Colour& a, const Colour& b) {
    cv::Mat source(1, 2, CV_8UC3);
    cv::Mat lab;

    source.at<cv::Vec3b>(0, 0) = cv::Vec3b(static_cast<uint8_t>(a[0]), static_cast<uint8_t>(a[1]), static_cast<uint8_t>(a[2]));
    source.at<cv::Vec3b>(0, 1) = cv::Vec3b(static_cast<uint8_t>(b[0]), static_cast<uint8_t>(b[1]), static_cast<uint8_t>(b[2]));
    cv::cvtColor(source, lab, cv::COLOR_RGB2Lab);

    const cv::Vec3b first = lab.at<cv::Vec3b>(0, 0);
    const cv::Vec3b second = lab.at<cv::Vec3b>(0, 1);
    const float lightness = static_cast<float>(first[0] - second[0]) * 0.392f;

    return std::hypot(static_cast<double>(lightness), static_cast<double>(first[1] - second[1]),
                      static_cast<double>(first[2] - second[2]));
}

}

BlockColours blockColours(const Rgb& page, const std::array<int, 4>& box) {
    const int x1 = std::max(0, box[0]);
    const int y1 = std::max(0, box[1]);
    const int x2 = std::min(page.width, box[2]);
    const int y2 = std::min(page.height, box[3]);
    const int w = std::max(0, x2 - x1);
    const int h = std::max(0, y2 - y1);

    if (w == 0 || h == 0) {
        return {{0, 0, 0}, {255, 255, 255}};
    }

    cv::Mat grey(h, w, CV_8UC1);

    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            const uint8_t* p = page.data.data() + (static_cast<size_t>(y1 + y) * page.width + x1 + x) * 3;

            grey.at<uint8_t>(y, x) = static_cast<uint8_t>(std::floor(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] + 0.5));
        }
    }

    cv::Mat dark;
    cv::Mat ink;
    cv::Mat grown;

    cv::threshold(grey, dark, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);

    if (cv::countNonZero(dark) <= w * h / 2.0) {
        ink = dark;
    } else {
        cv::bitwise_not(dark, ink);
    }

    cv::dilate(ink, grown, cv::Mat::ones(3, 3, CV_8U), cv::Point(-1, -1), 2);

    std::vector<size_t> inkPixels;
    std::vector<size_t> paperPixels;

    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            const size_t at = static_cast<size_t>(y1 + y) * page.width + x1 + x;

            if (ink.at<uint8_t>(y, x) > 0) {
                inkPixels.push_back(at);
            } else if (grown.at<uint8_t>(y, x) == 0) {
                paperPixels.push_back(at);
            }
        }
    }

    const Colour fg = medianColour(page, inkPixels);
    const Colour bg = medianColour(page, paperPixels);

    if (colourDifference(fg, bg) >= minimumDifference) {
        return {fg, bg};
    }

    return {fg, (fg[0] + fg[1] + fg[2]) / 3.0 <= 127 ? Colour{255, 255, 255} : Colour{0, 0, 0}};
}

}
