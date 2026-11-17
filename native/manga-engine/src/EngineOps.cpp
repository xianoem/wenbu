#include "EngineOps.hpp"

#include <cctype>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <set>
#include <stdexcept>

#include <opencv2/imgproc.hpp>

#include "CleanPlan.hpp"
#include "DbBoxes.hpp"
#include "Fonts.hpp"
#include "Pictures.hpp"
#include "Utf8.hpp"

namespace engine {

namespace {

constexpr int defaultInpaintingSize = 2048;

// An environment variable read as UTF-16, so folders with any characters in their names work.
std::wstring environment(const wchar_t* name) {
    wchar_t* value = nullptr;
    size_t length = 0;

    if (_wdupenv_s(&value, &length, name) != 0 || value == nullptr) {
        return {};
    }

    std::wstring text(value);

    std::free(value);

    return text;
}

std::string stringOf(const Json& object, const char* key) {
    const auto found = object.find(key);

    return found != object.end() && found->is_string() ? found->get<std::string>() : std::string();
}

std::string required(const Json& request, const char* key, const char* name) {
    const std::string value = stringOf(request, key);

    if (value.empty()) {
        throw std::runtime_error(std::string("The ") + name + " path is missing.");
    }

    return value;
}

bool exists(const std::string& file) {
    std::error_code error;

    return !file.empty() && std::filesystem::exists(pathOf(file), error);
}

// cv2.resize with INTER_NEAREST, as the worker does when a mask or brush has another size.
std::vector<uint8_t> fitted(const std::vector<uint8_t>& data, int channels, int width, int height, const Rgb& page) {
    if (width == page.width && height == page.height) {
        return data;
    }

    const cv::Mat source(height, width, channels == 3 ? CV_8UC3 : CV_8UC1, const_cast<uint8_t*>(data.data()));
    cv::Mat target;

    cv::resize(source, target, cv::Size(page.width, page.height), 0, 0, cv::INTER_NEAREST);

    return std::vector<uint8_t>(target.datastart, target.dataend);
}

// open_mask: a missing file is an empty mask; Pillow's convert('L') in fixed point otherwise.
std::vector<uint8_t> readMask(const std::string& file, const Rgb& page) {
    if (!exists(file)) {
        return std::vector<uint8_t>(static_cast<size_t>(page.width) * page.height, 0);
    }

    const Rgb image = readPage(pathOf(file), Alpha::Dropped);
    std::vector<uint8_t> luma(static_cast<size_t>(image.width) * image.height);

    for (size_t p = 0; p < luma.size(); p++) {
        luma[p] = static_cast<uint8_t>(
            (image.data[p * 3] * 19595 + image.data[p * 3 + 1] * 38470 + image.data[p * 3 + 2] * 7471 + 0x8000) >> 16);
    }

    return fitted(luma, 1, image.width, image.height, page);
}

// open_brush: red marks pixels to inpaint, green pixels to keep.
std::optional<Rgb> readBrush(const std::string& file, const Rgb& page) {
    if (!exists(file)) {
        return std::nullopt;
    }

    const Rgb image = readPage(pathOf(file), Alpha::Dropped);

    return Rgb{page.width, page.height, fitted(image.data, 3, image.width, image.height, page)};
}

std::optional<std::array<int, 3>> colourOf(const Json& block, const char* key) {
    const auto found = block.find(key);

    if (found == block.end() || !found->is_array() || found->size() != 3) {
        return std::nullopt;
    }

    return std::array<int, 3>{(*found)[0].get<int>(), (*found)[1].get<int>(), (*found)[2].get<int>()};
}

std::vector<CleanBlock> cleanBlocksOf(const Json& request) {
    std::vector<CleanBlock> blocks;

    if (!request.contains("blocks")) {
        return blocks;
    }

    for (const auto& block : request["blocks"]) {
        CleanBlock clean;
        const Json& box = block.at("box");

        clean.box = {box[0].get<double>(), box[1].get<double>(), box[2].get<double>(), box[3].get<double>()};
        clean.drawn = block.value("drawn", false);
        clean.fill = stringOf(block, "method") == "fill";
        clean.fg = colourOf(block, "fg");
        clean.bg = colourOf(block, "bg");
        blocks.push_back(clean);
    }

    return blocks;
}

InpaintOptions inpaintOptionsOf(const Json& request) {
    const Json options = request.value("options", Json::object());
    InpaintOptions inpainting;

    if (options.contains("inpainting_size") && options["inpainting_size"].is_number()) {
        inpainting.size = options["inpainting_size"].get<int>();
    } else {
        inpainting.size = defaultInpaintingSize;
    }

    inpainting.wholePage = stringOf(options, "inpainting") == "page";

    return inpainting;
}

// parse_blocks: a list of blocks, each with a box of four numbers.
std::vector<PictureBox> pictureBoxesOf(const Json& request) {
    const auto blocks = request.find("blocks");

    if (blocks == request.end() || !blocks->is_array()) {
        throw std::runtime_error("Blocks must be a list.");
    }

    std::vector<PictureBox> boxes;

    for (const Json& block : *blocks) {
        const auto box = block.is_object() ? block.find("box") : block.end();

        if (!block.is_object() || box == block.end() || !box->is_array() || box->size() != 4 ||
            !std::all_of(box->begin(), box->end(), [](const Json& edge) { return edge.is_number(); })) {
            throw std::runtime_error("Each block needs a box of four numbers.");
        }

        boxes.push_back({(*box)[0].get<double>(), (*box)[1].get<double>(), (*box)[2].get<double>(), (*box)[3].get<double>()});
    }

    return boxes;
}

std::optional<BreakMode> breakModeOf(const std::string& mode) {
    if (mode == "balanced") {
        return BreakMode::Balanced;
    }

    if (mode == "greedy") {
        return BreakMode::Greedy;
    }

    if (mode == "manual") {
        return BreakMode::Manual;
    }

    return std::nullopt;
}

template <typename T> std::optional<T> optionalOf(const Json& object, const char* key) {
    const auto found = object.find(key);

    if (found == object.end() || found->is_null()) {
        return std::nullopt;
    }

    return found->get<T>();
}

std::array<double, 4> boxOf(const Json& box) {
    return {box[0].get<double>(), box[1].get<double>(), box[2].get<double>(), box[3].get<double>()};
}

// region_of: a one-line block, lettered in its bubble's text area unless the editor moved it.
LetterBlock letterBlockOf(const Json& request, const Json& block, const CleanPage& plan) {
    const std::array<double, 4> box = boxOf(block.at("box"));
    const Json options = request.value("options", Json::object());
    const bool horizontal = lettersHorizontally(stringOf(options, "target_language"));
    const Json lettering = block.value("lettering", Json::object());
    LetterBlock letter;
    LetterSettings settings;

    for (size_t i = 0; i < 4; i++) {
        letter.region.xyxy[i] = roundHalfEven(box[i]);
    }

    letter.region.text = block.contains("text") ? block["text"].get<std::string>() : " ";
    letter.region.translation = stringOf(block, "translation");
    letter.region.vertical = !horizontal && letter.region.xyxy[2] - letter.region.xyxy[0] < letter.region.xyxy[3] - letter.region.xyxy[1];

    if (lettering.contains("textBox")) {
        letter.region.textBox = boxOf(lettering["textBox"]);
    } else if (const std::optional<std::array<int, 4>> area = textArea(plan, box)) {
        letter.region.textBox = std::array<double, 4>{static_cast<double>((*area)[0]), static_cast<double>((*area)[1]),
                                                      static_cast<double>((*area)[2]), static_cast<double>((*area)[3])};
    }

    for (const char* key : {"fg", "bg"}) {
        const auto colour = block.find(key);
        std::array<int, 3>& target = std::string(key) == "fg" ? letter.fg : letter.bg;

        for (size_t c = 0; c < 3; c++) {
            if (colour != block.end() && colour->is_array() && colour->size() > c) {
                target[c] = (*colour)[c].get<int>();
            }
        }
    }

    settings.breakMode = breakModeOf(stringOf(lettering, "breakMode"));
    settings.avoidOrphans = optionalOf<bool>(lettering, "avoidOrphans");
    settings.hyphenate = optionalOf<bool>(lettering, "hyphenate");
    settings.uppercase = optionalOf<bool>(lettering, "uppercase");
    settings.size = optionalOf<int>(lettering, "size");
    settings.leading = optionalOf<double>(lettering, "leading");

    if (!stringOf(lettering, "fontDir").empty()) {
        settings.fontDir = pathOf(stringOf(lettering, "fontDir"));
    }

    // region_of: a block's installed font, resolved into the font cache.
    if (!stringOf(lettering, "fontFamily").empty()) {
        settings.fontDir = resolveFont(stringOf(lettering, "fontFamily"), pathOf(stringOf(options, "font_cache")));
    }

    // The plugin keeps a block's lettering only when it holds something, and so letters a block without
    // settings or a text area with its wider fallback padding.
    if (!lettering.empty() || letter.region.textBox) {
        letter.lettering = settings;
    }

    return letter;
}

std::optional<Backend> backendOf(const std::wstring& name) {
    if (name == L"trt") {
        return Backend::TensorRtRtx;
    }

    if (name == L"dml") {
        return Backend::DirectMl;
    }

    if (name == L"cpu") {
        return Backend::Cpu;
    }

    return std::nullopt;
}

}

EngineConfig configFromEnvironment() {
    EngineConfig config;
    const std::wstring backend = environment(L"WENBU_MANGA_BACKEND");

    config.folder = environment(L"WENBU_MANGA_ENGINE_DIR");
    config.runtime.nvidiaPack = environment(L"WENBU_NVIDIA_PACK");
    config.runtime.cache = environment(L"WENBU_MANGA_CACHE");
    config.runtime.backend = backendOf(backend);

    return config;
}

EngineOps::EngineOps(const EngineConfig& config) : models_(config.folder / "models"), runtime_(config.runtime) {
    scanner_ = std::make_unique<Scanner>(runtime_, models_);
    inpainter_ = std::make_unique<Inpainter>(runtime_, models_ / "lama.onnx");
}

Json EngineOps::clean(const Json& request) {
    const std::filesystem::path output = pathOf(required(request, "output", "output"));
    const Rgb original = readPage(pathOf(stringOf(request, "source")));
    const std::vector<uint8_t> scan = readMask(stringOf(request, "mask"), original);
    const std::optional<Rgb> brush = readBrush(stringOf(request, "brush"), original);
    const std::vector<CleanBlock> blocks = cleanBlocksOf(request);
    const CleanPage page(original);
    const Plan plan = cleanPlan(page, scan, blocks, brush);

    if (std::none_of(plan.inpaint.begin(), plan.inpaint.end(), [](uint8_t value) { return value > 0; })) {
        savePage(output, plan.filled, PageFormat::Png, 0);

        return Json::object();
    }

    Rgb cleaned = settlePaper(page, inpainter_->inpaint(plan.filled, plan.inpaint, inpaintOptionsOf(request)), blocks, plan.inpaint);

    if (brush) {
        std::vector<uint8_t> stroke(static_cast<size_t>(original.width) * original.height);

        for (size_t p = 0; p < stroke.size(); p++) {
            stroke[p] = brush->data[p * 3] >= 127 ? 255 : 0;
        }

        cleaned = blendPatch(original, cleaned, stroke);
    }

    savePage(output, cleaned, PageFormat::Png, 0);

    return Json::object();
}

// TensorRT-RTX compiles kernels for each new input shape; the warm op meets every shape pages can give, so
// a run never waits on a compile. The kernels are saved when the engine ends.
namespace {

constexpr int warmVersion = 1;

std::filesystem::path warmMarker(const Runtime& runtime) {
    return runtime.cache() / "warmed.json";
}

}

bool EngineOps::needsWarming(int size) const {
    if (runtime_.backend() != Backend::TensorRtRtx || runtime_.cache().empty()) {
        return false;
    }

    std::ifstream file(warmMarker(runtime_), std::ios::binary);

    if (!file) {
        return true;
    }

    const Json marker = Json::parse(file, nullptr, false);

    return !marker.is_object() || marker.value("version", 0) != warmVersion ||
           marker.value("kernels", std::string()) != runtime_.kernelsFor() || marker.value("size", 0) < size;
}

bool EngineOps::warm(int size, const std::function<void(int done, int total)>& progress, const std::atomic<bool>& stop) {
    const int total = Detector::shapes() + 1 + Inpainter::sizes(size);
    int done = 0;
    const auto next = [&] {
        if (stop) {
            return false;
        }

        progress(done++, total);

        return true;
    };

    scanner_->detector().warm(next);

    if (next()) {
        scanner_->reader().warm();
    }

    inpainter_->warm(size, next);

    if (stop) {
        return false;
    }

    progress(total, total);

    const Json marker = {{"version", warmVersion}, {"kernels", runtime_.kernelsFor()}, {"size", size}};
    const std::string text = marker.dump();

    writeAtomically(warmMarker(runtime_), std::vector<uint8_t>(text.begin(), text.end()));

    return true;
}

// The warm-up as an editor request, for development tools.
Json EngineOps::warmOp(const Json& request) {
    const int size = inpaintOptionsOf(request).size;
    const auto started = std::chrono::steady_clock::now();
    const std::atomic<bool> never{false};
    const bool needed = needsWarming(size);

    if (needed) {
        warm(size, [](int, int) {}, never);
    }

    return {{"warmed", needed}, {"seconds", std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count()}};
}

// clean_picture: colour and transparency are inpainted apart, so text on a transparent label leaves
// transparency behind.
Json EngineOps::picture(const Json& request) {
    const std::filesystem::path output = pathOf(required(request, "output", "output"));
    const Rgba original = readRgba(pathOf(stringOf(request, "source")));
    const std::vector<PictureBox> boxes = pictureBoxesOf(request);
    const std::vector<uint8_t> mask = pictureMask(original, boxes);
    Json lines = Json::array();

    for (const PictureBox& box : boxes) {
        const LineColours colours = lineColours(original, box);

        lines.push_back({{"fill", colours.fill}, {"outline", colours.outline ? Json(*colours.outline) : Json(nullptr)}});
    }

    if (std::none_of(mask.begin(), mask.end(), [](uint8_t value) { return value > 0; })) {
        saveRgba(output, original, PageFormat::Png, 0);

        return {{"lines", lines}};
    }

    const InpaintOptions inpainting = inpaintOptionsOf(request);
    const size_t pixels = static_cast<size_t>(original.width) * original.height;
    Rgb colour{original.width, original.height, std::vector<uint8_t>(pixels * 3)};
    std::vector<uint8_t> alpha(pixels);

    for (size_t p = 0; p < pixels; p++) {
        std::copy_n(original.data.begin() + p * 4, 3, colour.data.begin() + p * 3);
        alpha[p] = original.data[p * 4 + 3];
    }

    const Rgb rgb = inpainter_->inpaint(colour, mask, inpainting);

    if (alphaNeedsInpainting(original, mask)) {
        Rgb grey{original.width, original.height, std::vector<uint8_t>(pixels * 3)};

        for (size_t p = 0; p < pixels; p++) {
            std::fill_n(grey.data.begin() + p * 3, 3, alpha[p]);
        }

        const Rgb inpainted = inpainter_->inpaint(grey, mask, inpainting);

        for (size_t p = 0; p < pixels; p++) {
            alpha[p] = static_cast<uint8_t>((inpainted.data[p * 3] + inpainted.data[p * 3 + 1] + inpainted.data[p * 3 + 2]) / 3);
        }
    }

    saveRgba(output, mergedPicture(original, mask, rgb, alpha), PageFormat::Png, 0);

    return {{"lines", lines}};
}

Json EngineOps::render(const Json& request) {
    const std::filesystem::path output = pathOf(required(request, "output", "output"));
    const PageWithAlpha read = readPageWithAlpha(pathOf(stringOf(request, "source")));
    const Rgb& original = read.rgb;
    const std::string cleaned = stringOf(request, "cleaned");
    const Rgb base = exists(cleaned) ? readPage(pathOf(cleaned)) : original;
    const CleanPage plan(original);
    std::vector<LetterBlock> blocks;

    for (const auto& block : request.value("blocks", Json::array())) {
        const Text translation = decodeUtf8(stringOf(block, "translation"));

        if (std::any_of(translation.begin(), translation.end(), [](char32_t c) { return !isSpace(c) && c != 0xFEFF; })) {
            blocks.push_back(letterBlockOf(request, block, plan));
        }
    }

    const Rgb lettered = lettering_.render(base, original, blocks, letterOptionsOf(request.value("options", Json::object())));

    if (read.original) {
        saveRgba(output, restoredAlpha(*read.original, lettered), PageFormat::Png, 0);
    } else {
        savePage(output, lettered, PageFormat::Png, 0);
    }

    return Json::object();
}

Json EngineOps::breaks(const Json& request) {
    const Json blocks = request.value("blocks", Json::array());

    if (blocks.empty()) {
        throw std::runtime_error("Line breaks need one block.");
    }

    const Rgb original = readPage(pathOf(stringOf(request, "source")));
    LetterBlock letter = letterBlockOf(request, blocks[0], CleanPage(original));
    const std::vector<Text> words = splitWords(decodeUtf8(letter.region.translation));
    Text translation;

    for (size_t i = 0; i < words.size(); i++) {
        translation += (i == 0 ? Text() : Text(U" ")) + words[i];
    }

    letter.region.translation = encodeUtf8(translation);

    Json candidates = Json::array();

    for (const BreakCandidate& candidate :
         lettering_.breaks(original, letter, letterOptionsOf(request.value("options", Json::object())))) {
        candidates.push_back({{"lines", candidate.lines}, {"fontSize", candidate.fontSize}});
    }

    return {{"candidates", candidates}};
}

Json EngineOps::editor(const Json& request) {
    const std::string op = stringOf(request, "op");

    if (op == "clean") {
        return clean(request);
    }

    if (op == "render") {
        return render(request);
    }

    if (op == "breaks") {
        return breaks(request);
    }

    if (op == "warm") {
        return warmOp(request);
    }

    if (op == "picture") {
        return picture(request);
    }

    if (op == "scan") {
        const Json options = request.value("options", Json::object());
        const std::string target = stringOf(options, "target_language");

        return scanner_->scan(pathOf(stringOf(request, "source")), pathOf(required(request, "mask", "mask")),
                              target.empty() ? "ENG" : target, pathOf(stringOf(options, "screen_ai")));
    }

    throw std::runtime_error("The native engine cannot " + op + " pages yet.");
}

}
