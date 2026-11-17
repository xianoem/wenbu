#include "Scanner.hpp"

#include <future>

#include "CleanPlan.hpp"
#include "Kumiko.hpp"
#include "MaskRefine.hpp"
#include "PillowResize.hpp"

namespace engine {

namespace {

constexpr bool rightToLeft = true;
// Readings whose mean token log-probability is below this are noise, not text.
constexpr double minimumConfidence = -1;

std::array<int, 4> boxOf(const Block& block) {
    return block.xyxy;
}

// The reader loops on long, wide horizontal text.
bool needsScreenAi(const Block& block, const Reading& reading) {
    return !block.vertical && (reading.repeated || reading.capped);
}

}

Scanner::Scanner(Runtime& runtime, const std::filesystem::path& models)
    : detector_(runtime, models / "detect.onnx"), reader_(runtime, models), languageId_(models / "langid.bin"),
      screenAi_(screenAiHelper()) {}

PreparedPage Scanner::prepare(const Rgb& page) {
    PreparedPage prepared;

    // Panels only read the page, so their features are found on another thread meanwhile.
    prepared.page = &page;
    prepared.features = std::async(std::launch::async, [&page] { return panelFeatures(page); }).share();
    prepared.detector = Detector::prepare(page);

    return prepared;
}

Found Scanner::find(const Rgb& page, const std::string& target, const std::filesystem::path& screenAi) {
    return find(prepare(page), target, screenAi);
}

Found Scanner::find(const PreparedPage& prepared, const std::string& target, const std::filesystem::path& screenAi) {
    const Rgb& page = *prepared.page;
    const Detection detection = detector_.detect(prepared.detector);
    Found found;

    if (detection.lines.empty()) {
        prepared.features.wait();
        found.mask.assign(static_cast<size_t>(page.width) * page.height, 0);

        return found;
    }

    const PanelFeatures& panelFeatures = prepared.features.get();
    const std::vector<PanelBox> panels = findPanels(page.width, page.height, panelFeatures, rightToLeft);
    const std::vector<Block> blocks = sortBlocks(mergeLines(assignDirections(detection.lines)), panels, rightToLeft);

    std::vector<Rgb> crops;

    for (const Block& block : blocks) {
        const auto [x1, y1, x2, y2] = block.xyxy;

        crops.push_back(cropImage(page, std::max(0, x1), std::max(0, y1), std::min(page.width, x2), std::min(page.height, y2)));
    }

    std::vector<Reading> readings = reader_.read(crops);

    for (size_t i = 0; i < blocks.size() && !screenAi.empty(); i++) {
        if (!needsScreenAi(blocks[i], readings[i])) {
            continue;
        }

        if (const std::optional<std::string> text = screenAi_.read(screenAi, crops[i])) {
            readings[i] = {*text, 0, false, false};
        }
    }

    std::vector<std::array<cv::Point, 4>> lines;

    for (size_t i = 0; i < blocks.size(); i++) {
        if (readings[i].confidence < minimumConfidence) {
            continue;
        }

        const std::optional<std::string> text = filteredText(readings[i].text, target, languageId_);

        if (!text) {
            continue;
        }

        for (const Line& line : blocks[i].lines) {
            lines.push_back(line.pts);
        }

        found.blocks.push_back({blocks[i], *text, readings[i], blockColours(page, boxOf(blocks[i]))});
    }

    found.mask = refineMask(page, detection.rawMask, lines);

    return found;
}

Json Scanner::scan(const std::filesystem::path& source, const std::filesystem::path& maskFile, const std::string& target,
                   const std::filesystem::path& screenAi) {
    const Rgb page = readPage(source);
    const Found found = find(page, target, screenAi);

    saveGrey(maskFile, page.width, page.height, found.mask);

    Json blocks = Json::array();

    if (found.blocks.empty()) {
        return {{"width", page.width}, {"height", page.height}, {"blocks", blocks}};
    }

    const CleanPage plan(page);

    for (const FoundBlock& block : found.blocks) {
        const std::array<int, 4> box = boxOf(block.block);
        const std::optional<std::array<int, 4>> area =
            textArea(plan, {static_cast<double>(box[0]), static_cast<double>(box[1]), static_cast<double>(box[2]),
                            static_cast<double>(box[3])});

        blocks.push_back({{"box", box},
                          {"area", area ? Json(*area) : Json(nullptr)},
                          {"text", block.text},
                          {"fg", block.colours.fg},
                          {"bg", block.colours.bg},
                          {"fontSize", static_cast<int>(block.block.fontSize)},
                          {"vertical", block.block.vertical},
                          {"confidence", block.reading.confidence}});
    }

    return {{"width", page.width}, {"height", page.height}, {"blocks", blocks}};
}

}
