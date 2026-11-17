// Screen AI's second reading (detections/ScreenAiOcr.ts): the helper is started for a Screen AI folder,
// sent each image as a width, a height and RGBA bytes, and answers a JSON line holding the protobuf
// VisualAnnotation, whose lines become the text.
#pragma once

#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

#include "Images.hpp"

namespace engine {

// The text of a base64 VisualAnnotation: lines grouped by block and paragraph, joined without spaces when
// one holds Han, kana or Hangul.
std::string screenAiText(const std::string& annotation);

// fitWithin: the box average that brings the larger side down to `maxDimension`.
Rgba fitWithin(const Rgba& image, int maxDimension);

class ScreenAi {
public:
    // `helper` is wenbu-screen-ai-ocr.exe.
    explicit ScreenAi(std::filesystem::path helper);
    ~ScreenAi();

    ScreenAi(const ScreenAi&) = delete;
    ScreenAi& operator=(const ScreenAi&) = delete;

    // The text Screen AI reads in the image, or nothing when it fails.
    std::optional<std::string> read(const std::filesystem::path& folder, const Rgb& image);

private:
    struct Process;

    void start(const std::filesystem::path& folder);
    void stop();

    std::filesystem::path helper_;
    std::mutex lock_;
    std::unique_ptr<Process> process_;
};

// The helper next to the engine, or in WENBU_RESOURCES_DIR's native folder.
std::filesystem::path screenAiHelper();

}
