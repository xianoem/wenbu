// Checks the engine against fixtures made from the plugin's own code, and Skia against the plugin's
// skia-python. Usage: wenbu-manga-engine-tests tests/fixtures <fonts folder> [skia reference] [langid model]

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <functional>
#include <numeric>
#include <set>
#include <string>
#include <vector>

#include <cmath>

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#include "CleanPlan.hpp"
#include "DbBoxes.hpp"
#include "Images.hpp"
#include "Inpaint.hpp"
#include "Colours.hpp"
#include "Kumiko.hpp"
#include "LetterGeometry.hpp"
#include "LineBreaking.hpp"
#include "MaskRefine.hpp"
#include "Letter.h"
#include "PillowResize.hpp"
#include "Protocol.hpp"
#include "PySet.hpp"
#include "Quad.hpp"
#include "Reader.hpp"
#include "ReaderInput.hpp"
#include "TextFilter.hpp"
#include "Tokenizer.hpp"
#include "TextMerge.hpp"
#include "Utf8.hpp"
#include "Sha256.hpp"

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    failures += ok ? 0 : 1;
}

engine::Json readJson(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);

    return engine::Json::parse(stream);
}

std::vector<uint8_t> readBytes(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);

    return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}

void pages(const std::filesystem::path& fixtures) {
    for (const auto& [digests, alpha] : {std::pair{"pages.json", engine::Alpha::White},
                                         std::pair{"pages-dropped.json", engine::Alpha::Dropped}}) {
        const engine::Json expected = readJson(fixtures / digests);

        for (const auto& item : expected.items()) {
            const std::string name = item.key();
            const engine::Rgb image = engine::readPage(fixtures / name, alpha);

            check(engine::test::sha256(image.data) == item.value().get<std::string>(),
                  std::string("decodes ") + name + (alpha == engine::Alpha::White ? "" : " dropping alpha") +
                      " like Pillow");
        }
    }
}

void saves(const std::filesystem::path& fixtures) {
    const engine::Rgb image = engine::readPage(fixtures / "page.jpg");
    const std::filesystem::path out = std::filesystem::temp_directory_path() / "wenbu-engine-test.png";

    engine::savePage(out, image, engine::PageFormat::Png, 95);

    const engine::Rgb back = engine::readPage(out);

    check(back.data == image.data && back.width == image.width, "saves a PNG that reads back the same");
    std::filesystem::remove(out);
}

// The map the fixture was made from with the plugin's SegDetectorRepresenter.
cv::Mat syntheticMap() {
    cv::Mat pred = cv::Mat::zeros(120, 160, CV_32FC1);

    const auto rotated = [&](double cx, double cy, double w, double h, double degrees, float value) {
        const double angle = degrees * 3.14159265358979323846 / 180;

        for (int y = 0; y < pred.rows; y++) {
            for (int x = 0; x < pred.cols; x++) {
                const double u = (x - cx) * std::cos(angle) + (y - cy) * std::sin(angle);
                const double v = -(x - cx) * std::sin(angle) + (y - cy) * std::cos(angle);

                if (std::abs(u) <= w / 2 && std::abs(v) <= h / 2) {
                    pred.at<float>(y, x) = value;
                }
            }
        }
    };

    rotated(40, 30, 50, 12, 0, 0.9f);
    rotated(110, 70, 14, 60, 12, 0.8f);
    rotated(50, 95, 30, 9, -20, 0.75f);
    rotated(130, 20, 6, 6, 0, 0.95f);
    rotated(20, 70, 20, 8, 0, 0.6f);

    return pred;
}

std::vector<cv::Point> pointsOf(const engine::Json& list) {
    std::vector<cv::Point> points;

    for (const auto& point : list) {
        points.emplace_back(point[0].get<int>(), point[1].get<int>());
    }

    return points;
}

void detection(const std::filesystem::path& fixtures) {
    const engine::Json expected = readJson(fixtures / "db-boxes.json");
    const std::vector<engine::DbBox> boxes = engine::dbBoxes(syntheticMap(), 160, 120);

    check(boxes.size() == expected.size(), "finds as many DB boxes as the plugin (" + std::to_string(boxes.size()) +
                                               " of " + std::to_string(expected.size()) + ")");

    for (size_t i = 0; i < boxes.size() && i < expected.size(); i++) {
        const std::vector<cv::Point> theirs = pointsOf(expected[i]["pts"]);
        const bool same = std::equal(boxes[i].points.begin(), boxes[i].points.end(), theirs.begin());

        check(same && std::abs(boxes[i].score - expected[i]["score"].get<double>()) < 5e-7,
              "DB box " + std::to_string(i) + " and its score match the plugin");
    }

    for (const auto& box : expected) {
        const engine::Quad line = engine::quad(pointsOf(box["pts"]), box["score"].get<double>());
        const std::vector<cv::Point> sorted = pointsOf(box["sorted"]);

        check(std::equal(line.pts.begin(), line.pts.end(), sorted.begin()) &&
                  line.vertical == box["vertical"].get<bool>() && engine::quadArea(line) == box["area"].get<double>(),
              "orders corners, direction and area like Quadrilateral");
    }

    const std::vector<double> rounded = {engine::roundHalfEven(0.5),  engine::roundHalfEven(1.5),
                                         engine::roundHalfEven(2.5),  engine::roundHalfEven(-0.5),
                                         engine::roundHalfEven(2.4),  engine::roundHalfEven(2.6)};

    check(rounded == std::vector<double>{0, 2, 2, 0, 2, 3}, "rounds halves to the even neighbour, as numpy does");
}

void sets(const std::filesystem::path& fixtures) {
    const engine::Json cases = readJson(fixtures / "py-sets.json");
    size_t same = 0;

    for (const auto& entry : cases) {
        same += engine::pySetOrder(entry["inserted"].get<std::vector<int>>()) == entry["order"].get<std::vector<int>>();
    }

    check(same == cases.size(), "iterates " + std::to_string(same) + " of " + std::to_string(cases.size()) +
                                    " sets of ints in the order CPython 3.11 does");
}

engine::Json boxesOf(const std::vector<engine::PanelBox>& panels) {
    engine::Json boxes = engine::Json::array();

    for (const auto& panel : panels) {
        boxes.push_back({panel.x, panel.y, panel.width, panel.height});
    }

    return boxes;
}

void panels(const std::filesystem::path& fixtures) {
    const engine::Json page = readJson(fixtures / "kumiko-page.json");
    engine::PanelFeatures features;

    for (const auto& contour : page["contours"]) {
        features.contours.push_back(pointsOf(contour));
    }

    const std::vector<float> flat = page["segments"].get<std::vector<float>>();

    for (size_t i = 0; i + 3 < flat.size(); i += 4) {
        features.segments.emplace_back(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
    }

    const int width = page["width"].get<int>();
    const int height = page["height"].get<int>();

    check(boxesOf(engine::findPanels(width, height, features, true)) == page["rtl"],
          "orders panels right to left like the plugin");
    check(boxesOf(engine::findPanels(width, height, features, false)) == page["ltr"],
          "orders panels left to right like the plugin");
}

engine::Json xyxyOf(const std::vector<engine::Block>& blocks) {
    engine::Json boxes = engine::Json::array();

    for (const auto& block : blocks) {
        boxes.push_back(block.xyxy);
    }

    return boxes;
}

void merge(const std::filesystem::path& fixtures) {
    const engine::Json page = readJson(fixtures / "merge-page.json");
    std::vector<engine::PanelBox> boxes;

    for (const auto& panel : page["panels"]) {
        boxes.push_back({panel[0].get<int>(), panel[1].get<int>(), panel[2].get<int>(), panel[3].get<int>()});
    }

    std::vector<engine::Line> theirLines;

    for (const auto& line : page["merge"]["lines"]) {
        engine::Line ours;

        static_cast<engine::Quad&>(ours) = engine::quad(pointsOf(line["pts"]), 1);
        ours.direction = line["direction"].get<std::string>() == "v" ? 'v' : 'h';
        theirLines.push_back(ours);
    }

    const std::vector<engine::Block> merged = engine::mergeLines(theirLines);
    engine::Json regions = engine::Json::array();
    engine::Json expected = engine::Json::array();

    for (const auto& block : merged) {
        engine::Json lines = engine::Json::array();

        for (const auto& line : block.lines) {
            engine::Json points = engine::Json::array();

            for (const auto& point : line.pts) {
                points.push_back({point.x, point.y});
            }

            lines.push_back(points);
        }

        regions.push_back({block.xyxy, static_cast<int>(block.fontSize), lines});
    }

    for (const auto& region : page["merge"]["regions"]) {
        expected.push_back({region["xyxy"], region["fontSize"], region["lines"]});
    }

    check(regions == expected, "merges the OCR lines into the same regions as the plugin");

    std::vector<engine::Block> kept;

    for (const auto& block : merged) {
        const engine::Json box = block.xyxy;

        if (std::find(page["blocks"].begin(), page["blocks"].end(), box) != page["blocks"].end()) {
            kept.push_back(block);
        }
    }

    check(xyxyOf(engine::sortBlocks(kept, boxes, true)) == page["blocks"], "orders the kept blocks by panel like the plugin");

    std::vector<engine::Quad> detected;

    for (const auto& line : page["detected"]) {
        detected.push_back(engine::quad(pointsOf(line), 1));
    }

    check(xyxyOf(engine::sortBlocks(engine::mergeLines(engine::assignDirections(detected)), boxes, true)) == page["blocks"],
          "finds the same blocks from the raw detection lines");
}

engine::Grey greyOf(const std::filesystem::path& file) {
    const cv::Mat mat = cv::imread(file.string(), cv::IMREAD_GRAYSCALE);
    engine::Grey grey{mat.cols, mat.rows, {}};

    grey.data.assign(mat.datastart, mat.dataend);

    return grey;
}

void refinement(const std::filesystem::path& fixtures) {
    const engine::Rgb page = engine::readPage(fixtures / "mask-page.png");
    std::vector<std::array<cv::Point, 4>> lines;

    for (const auto& line : readJson(fixtures / "mask-lines.json")) {
        const std::vector<cv::Point> points = pointsOf(line);

        lines.push_back({points[0], points[1], points[2], points[3]});
    }

    const std::vector<uint8_t> ours = engine::refineMask(page, greyOf(fixtures / "mask-raw.png"), lines);
    const engine::Grey theirs = greyOf(fixtures / "mask-refined.png");
    size_t differing = 0;

    for (size_t i = 0; i < ours.size() && i < theirs.data.size(); i++) {
        differing += ours[i] != theirs.data[i] ? 1 : 0;
    }

    check(ours.size() == theirs.data.size() && differing == 0,
          "refines a page mask exactly as the plugin does (" + std::to_string(differing) + " pixels differ)");

    const std::vector<uint8_t> none = engine::refineMask(page, greyOf(fixtures / "mask-raw.png"), {});

    check(none.size() == ours.size() && std::all_of(none.begin(), none.end(), [](uint8_t value) { return value == 0; }),
          "leaves the mask empty when no text lines are kept");
}

template <typename T> std::string digestOf(const std::vector<T>& values) {
    const auto* bytes = reinterpret_cast<const uint8_t*>(values.data());

    return engine::test::sha256(std::vector<uint8_t>(bytes, bytes + values.size() * sizeof(T)));
}

void resizing(const std::filesystem::path& fixtures) {
    const engine::Rgb source = engine::readPage(fixtures / "resize-source.png");

    const engine::Json expected = readJson(fixtures / "resize.json");

    for (const auto& item : expected.items()) {
        const std::string size = item.key();
        const engine::Json digest = item.value();
        engine::Rgb image;

        if (size == "crop") {
            image = engine::cropImage(source, -5, 10, 40, 80);
        } else {
            const bool lanczos = size.starts_with("lanczos-");
            const std::string dimensions = lanczos ? size.substr(8) : size;
            const size_t x = dimensions.find('x');

            image = engine::pillowResize(source, std::stoi(dimensions.substr(0, x)), std::stoi(dimensions.substr(x + 1)),
                                         lanczos ? engine::Filter::Lanczos : engine::Filter::Bilinear);
        }

        check(engine::test::sha256(image.data) == digest.get<std::string>(), "matches Pillow for " + size);
    }
}

void readerInput(const std::filesystem::path& fixtures) {
    const engine::Rgb source = engine::readPage(fixtures / "resize-source.png");

    for (const auto& entry : readJson(fixtures / "naflex.json")) {
        const auto box = entry["box"].get<std::vector<int>>();
        const int patches = entry["patches"].get<int>();
        const engine::Patches input = engine::patchify(engine::cropImage(source, box[0], box[1], box[2], box[3]), patches);
        const std::vector<float> grid = engine::positionWeights(input.size.rows, input.size.columns);
        const std::vector<int> size = {input.size.height, input.size.width, input.size.rows, input.size.columns};

        check(size == entry["size"].get<std::vector<int>>() &&
                  engine::test::sha256(input.pixels) == entry["pixels"].get<std::string>() &&
                  digestOf(grid) == entry["weights"].get<std::string>(),
              "matches the Hayai processor for " + entry["box"].dump() + " at " + std::to_string(patches) + " patches");
    }
}

void tokens(const std::filesystem::path& fixtures) {
    const engine::Tokenizer tokenizer(fixtures / "tokenizer.json");
    const engine::Json cases = readJson(fixtures / "tokens.json");
    size_t same = 0;

    for (const auto& entry : cases) {
        same += tokenizer.decode(entry["ids"].get<std::vector<int64_t>>()) == entry["text"].get<std::string>();
    }

    check(same == cases.size(), "decodes " + std::to_string(same) + " of " + std::to_string(cases.size()) +
                                    " readings like HuggingFace tokenizers");
}

void filters(const std::filesystem::path& fixtures, const std::filesystem::path& languageModel) {
    const engine::Json cases = readJson(fixtures / "text-filter.json");
    size_t same = 0;

    for (const auto& entry : cases) {
        const std::string fixed = engine::fixBrackets(entry["text"].get<std::string>());

        same += fixed == entry["fixed"].get<std::string>() && engine::isValuableText(fixed) == entry["valuable"].get<bool>();
    }

    check(same == cases.size(), "fixes brackets and judges value like the plugin (" + std::to_string(same) + " of " +
                                    std::to_string(cases.size()) + ")");

    if (languageModel.empty()) {
        return;
    }

    const engine::LanguageId languageId(languageModel);
    const engine::Json languages = readJson(fixtures / "langid.json");
    size_t classified = 0;

    for (const auto& entry : languages) {
        classified += languageId.classify(entry["text"].get<std::string>()) == entry["lang"].get<std::string>();
    }

    check(classified == languages.size(), "classifies languages like py3langid (" + std::to_string(classified) + " of " +
                                              std::to_string(languages.size()) + ")");
}

engine::Rgb stripes(const engine::Colour& ink, const engine::Colour& paper) {
    engine::Rgb page{40, 30, std::vector<uint8_t>(40 * 30 * 3)};

    for (int p = 0; p < 40 * 30; p++) {
        const int x = p % 40;
        const engine::Colour& colour = x % 10 == 4 || x % 10 == 5 ? ink : paper;

        for (int c = 0; c < 3; c++) {
            page.data[static_cast<size_t>(p) * 3 + c] = static_cast<uint8_t>(colour[c]);
        }
    }

    return page;
}

void colours() {
    const engine::BlockColours split = engine::blockColours(stripes({20, 30, 40}, {250, 240, 230}), {0, 0, 40, 30});

    check(split.fg == engine::Colour{20, 30, 40} && split.bg == engine::Colour{250, 240, 230},
          "takes the minority grey side as ink and the rest as paper");
    check(engine::blockColours(stripes({100, 100, 100}, {104, 104, 104}), {0, 0, 40, 30}).bg == engine::Colour{255, 255, 255},
          "falls back to white or black paper when the colours are too close");
}

void repetition() {
    const std::vector<int64_t> phrase = {7, 8, 9, 10};
    std::vector<int64_t> repeated = {1, 2};

    for (int i = 0; i < 4; i++) {
        repeated.insert(repeated.end(), phrase.begin(), phrase.end());
    }

    const auto found = engine::repetitionAt(repeated);

    check(found && found->period == 4 && found->start == 2, "finds a phrase repeated four times over sixteen tokens");

    std::vector<int64_t> distinct(40);

    std::iota(distinct.begin(), distinct.end(), 0);
    check(!engine::repetitionAt({5, 6, 6, 6, 6, 6, 7}) && !engine::repetitionAt({3, 3, 3, 3, 3, 3}) &&
              !engine::repetitionAt(distinct),
          "leaves short laughter and long distinct text alone");

    std::vector<int64_t> stuck = {1};

    stuck.insert(stuck.end(), 16, 9);

    const auto single = engine::repetitionAt(stuck);

    check(single && single->period == 1 && single->start == 1, "stops a single token stuck for sixteen steps");
}

struct CleanScene {
    engine::Rgb page;
    std::vector<uint8_t> mask;
    engine::CleanBlock bubble;
    engine::CleanBlock art;
    engine::CleanBlock outlined;
    engine::CleanBlock shaded;
};

CleanScene cleanScene() {
    constexpr int width = 600;
    constexpr int height = 400;
    cv::Mat image(height, width, CV_8UC3, cv::Scalar(128, 128, 128));
    cv::Mat mask = cv::Mat::zeros(height, width, CV_8UC1);

    cv::ellipse(image, {150, 200}, {100, 120}, 0, 0, 360, cv::Scalar(255, 255, 255), -1);
    cv::ellipse(image, {150, 200}, {100, 120}, 0, 0, 360, cv::Scalar(0, 0, 0), 3);

    for (const int x : {125, 145, 165, 435, 455, 475}) {
        cv::rectangle(image, cv::Rect(x, 175, 6, 50), cv::Scalar(0, 0, 0), -1);
        cv::rectangle(mask, cv::Rect(x - 1, 174, 8, 52), cv::Scalar(255), -1);
    }

    for (int y = 60; y < 340; y++) {
        const int tone = 205 + (y - 60) * 50 / 280;

        cv::line(image, {260, y}, {410, y}, cv::Scalar(tone, tone, tone));
    }

    for (const int x : {310, 330, 350, 435, 455, 475}) {
        const int top = x < 400 ? 175 : 300;

        if (x > 400) {
            cv::rectangle(image, cv::Rect(x - 6, top - 6, 18, 52), cv::Scalar(255, 255, 255), -1);
        }

        cv::rectangle(image, cv::Rect(x, top, 6, 40), cv::Scalar(0, 0, 0), -1);
        cv::rectangle(mask, cv::Rect(x - 1, top - 1, 8, 42), cv::Scalar(255), -1);
    }

    // A closing mark the detector's box missed, joined to the block's text in the mask.
    cv::rectangle(image, cv::Rect(190, 190, 5, 20), cv::Scalar(0, 0, 0), -1);
    cv::rectangle(mask, cv::Rect(189, 189, 7, 22), cv::Scalar(255), -1);
    cv::rectangle(mask, cv::Rect(170, 196, 20, 8), cv::Scalar(255), -1);

    CleanScene scene{{width, height, std::vector<uint8_t>(image.data, image.data + image.total() * 3)},
                     std::vector<uint8_t>(mask.data, mask.data + mask.total()),
                     {},
                     {}};

    scene.bubble.box = {120, 170, 176, 230};
    scene.bubble.fill = true;
    scene.art.box = {430, 170, 486, 230};
    scene.art.fill = true;
    scene.outlined.box = {430, 295, 486, 345};
    scene.shaded.box = {305, 170, 361, 220};

    return scene;
}

void cleanPages() {
    const CleanScene scene = cleanScene();
    const engine::CleanPage page(scene.page);
    std::vector<std::vector<uint8_t>> asked;

    const auto inpaint = [&](const engine::Rgb& image, const std::vector<uint8_t>& mask) {
        engine::Rgb painted = image;

        asked.push_back(mask);

        for (size_t p = 0; p < mask.size(); p++) {
            if (mask[p] > 0) {
                std::fill_n(painted.data.begin() + static_cast<long>(p * 3), 3, uint8_t{128});
            }
        }

        return painted;
    };
    const auto pixel = [](const engine::Rgb& image, int x, int y) {
        const size_t p = (static_cast<size_t>(y) * image.width + x) * 3;

        return std::array<int, 3>{image.data[p], image.data[p + 1], image.data[p + 2]};
    };
    const auto masked = [&](const std::vector<uint8_t>& mask, int x, int y) { return mask[static_cast<size_t>(y) * scene.page.width + x] > 0; };

    const engine::Rgb both = engine::cleanPage(page, scene.mask, {scene.bubble, scene.art}, inpaint);

    check(asked.size() == 1 && !masked(asked[0], 147, 200) && masked(asked[0], 457, 200),
          "leaves only text outside bubbles to LaMa");
    check(pixel(both, 147, 200) == std::array<int, 3>{255, 255, 255} && pixel(both, 457, 200) == std::array<int, 3>{128, 128, 128},
          "fills text in a bubble with its paper and inpaints the rest");

    asked.clear();

    const engine::Rgb bubbleOnly = engine::cleanPage(page, scene.mask, {scene.bubble}, inpaint);

    check(asked.empty() && pixel(bubbleOnly, 147, 200) == std::array<int, 3>{255, 255, 255}, "skips LaMa when every block is in a bubble");

    const std::vector<std::array<double, 4>> reach = engine::textReach(scene.mask, scene.page.width, scene.page.height, {scene.bubble.box, scene.art.box});
    engine::CleanBlock reaching = scene.bubble;

    reaching.reach = reach[0];

    const engine::Rgb marked = engine::cleanPage(page, scene.mask, {reaching}, inpaint);

    check(reach[1] == scene.art.box && pixel(marked, 192, 200) == std::array<int, 3>{255, 255, 255},
          "cleans the text a block's box missed but its mask joins");
    check(engine::holdsBlock(page, scene.bubble.box), "fills a block that sits wholly in a bubble of flat paper");
    check(engine::bubbleAround(page, scene.outlined.box) && !engine::holdsBlock(page, scene.outlined.box), "inpaints outlined text on the art, whose halo is no bubble");
    check(engine::bubbleAround(page, scene.shaded.box) && !engine::holdsBlock(page, scene.shaded.box), "inpaints text on shaded paper, which one colour cannot fill");

    const auto shade = [](const engine::Rgb& image, const std::vector<uint8_t>& mask) {
        engine::Rgb painted = image;

        for (size_t p = 0; p < mask.size(); p++) {
            if (mask[p] > 0) {
                std::fill_n(painted.data.begin() + static_cast<long>(p * 3), 3, uint8_t{240});
            }
        }

        return painted;
    };
    const engine::Rgb shaded = engine::cleanPage(page, scene.mask, {scene.shaded}, shade);

    check(pixel(shaded, 312, 200) == std::array<int, 3>{240, 240, 240}, "keeps the shading LaMa paints back on paper it inpainted");
}

void inpaintCrops(const std::filesystem::path& fixtures) {
    const engine::Rgb mask = engine::readPage(fixtures / "inpaint-mask.png", engine::Alpha::Dropped);
    std::vector<uint8_t> grey(static_cast<size_t>(mask.width) * mask.height);

    for (size_t p = 0; p < grey.size(); p++) {
        grey[p] = mask.data[p * 3];
    }

    engine::Json ours = engine::Json::array();

    for (const auto& box : engine::inpaintCrops(grey, mask.width, mask.height)) {
        ours.push_back(box);
    }

    check(ours == readJson(fixtures / "inpaint-crops.json"), "plans the same LaMa crops as the plugin");
}

void lamaWindows() {
    const std::vector<std::pair<int, int>> sides = {{1, 256},     {256, 256},   {257, 384},   {385, 512},   {700, 768},
                                                    {1000, 1024}, {1025, 1280}, {1537, 1792}, {2048, 2048}, {2049, 2304}};
    bool sidesMatch = true;

    for (const auto& [length, side] : sides) {
        sidesMatch = sidesMatch && engine::modelSide(length) == side;
    }

    check(sidesMatch, "rounds LaMa's input up to steps of 128 to 1024, then of 256");

    const engine::LamaWindow middle = engine::lamaWindow({900, 1400, 1000, 1460}, 2000, 3000, 2048);

    check(middle.model == std::array<int, 2>{256, 256} && middle.scaled == middle.model &&
              middle.region == engine::Box{822, 1302, 1078, 1558},
          "widens a small crop to 256 by 256 of the page around it");

    const engine::LamaWindow corner = engine::lamaWindow({0, 0, 100, 60}, 2000, 3000, 2048);

    check(corner.region == engine::Box{0, 0, 256, 256}, "keeps a widened crop inside the page");

    const engine::LamaWindow small = engine::lamaWindow({0, 0, 300, 200}, 300, 200, 2048);

    check(small.model == std::array<int, 2>{384, 256} && small.scaled == std::array<int, 2>{300, 200} &&
              small.region == engine::Box{0, 0, 300, 200},
          "pads a crop the page cannot widen");

    const engine::LamaWindow large = engine::lamaWindow({500, 1000, 3500, 2000}, 4000, 6000, 2048);

    check(large.model == std::array<int, 2>{2048, 768} && large.scaled[0] == 2048 && large.scaled[1] <= 768 &&
              large.scaled[1] >= 760 && large.region[0] == 500 && large.region[2] == 3500 &&
              large.region[1] <= 1000 && large.region[3] >= 2000,
          "scales a large crop down and widens its short side to 768");

    const std::vector<std::array<int, 2>> shapes = engine::warmShapes(2048);
    const std::set<std::array<int, 2>> distinct(shapes.begin(), shapes.end());
    const std::vector<std::array<int, 2>> smaller = engine::warmShapes(1024);

    check(shapes.size() == 121 && distinct.size() == 121 && shapes.front() == std::array<int, 2>{1280, 2048},
          "warms every LaMa shape once, the most common first");
    const bool fits = std::all_of(smaller.begin(), smaller.end(), [](const auto& shape) { return std::max(shape[0], shape[1]) <= 1024; });

    check(smaller.size() == 49 && fits, "warms only the shapes a smaller inpainting size can take");
}

std::string styleName(engine::Style style) {
    switch (style) {
    case engine::Style::Regular:
        return "regular";
    case engine::Style::Italic:
        return "italic";
    case engine::Style::Bold:
        return "bold";
    case engine::Style::BoldItalic:
        return "bold_italic";
    }

    return "regular";
}

double fixtureWidth(const engine::Text& token) {
    double total = 0;

    for (const char32_t code : token) {
        const bool cjk = (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3040 && code <= 0x30FF) ||
                         (code >= 0x3000 && code <= 0x303F) || (code >= 0xFF00 && code <= 0xFFEF);

        total += cjk ? 14 : 7.5 + static_cast<double>(code % 5);
    }

    return total;
}

engine::Json linesOf(const std::optional<std::vector<engine::Text>>& lines) {
    if (!lines) {
        return nullptr;
    }

    engine::Json out = engine::Json::array();

    for (const auto& line : *lines) {
        out.push_back(engine::encodeUtf8(line));
    }

    return out;
}

void lineBreaking(const std::filesystem::path& fixtures) {
    const engine::Json cases = readJson(fixtures / "line-breaking.json");
    size_t same = 0;
    size_t total = 0;

    for (const auto& entry : cases) {
        const engine::Text text = engine::decodeUtf8(entry["text"].get<std::string>());
        const auto tokens = engine::tokenizeStyledText(text, true);
        engine::Json ourTokens = engine::Json::array();
        engine::Json ourSegments = engine::Json::array();
        std::vector<engine::Text> plain;

        for (const auto& [token, styled] : tokens) {
            ourTokens.push_back({engine::encodeUtf8(token), styled});
            plain.push_back(token);
        }

        for (const auto& [segment, style] : engine::parseStyledSegments(text)) {
            ourSegments.push_back({engine::encodeUtf8(segment), styleName(style)});
        }

        bool ok = ourTokens == entry["tokens"] && ourSegments == entry["segments"];

        for (const auto& item : entry["breaks"].items()) {
            const std::string key = item.key();
            std::vector<std::string> parts;
            size_t start = 0;

            for (size_t dash = key.find('-'); dash != std::string::npos; dash = key.find('-', start)) {
                parts.push_back(key.substr(start, dash - start));
                start = dash + 1;
            }

            parts.push_back(key.substr(start));

            engine::BreakOptions options;

            options.style.mode = parts[0] == "greedy" ? engine::BreakMode::Greedy : engine::BreakMode::Balanced;
            options.style.avoidOrphans = parts[1] == "True";
            options.style.evenOut = parts[2] == "True";
            ok = ok && linesOf(engine::evenedBreaks(plain, std::stod(parts[3]), fixtureWidth, 7, fixtureWidth, options)) == item.value();
        }

        for (const auto& item : entry["hyphen"].items()) {
            const auto parts = engine::tryHyphenateWord(engine::decodeUtf8(item.key()), 8,
                                                        [](const engine::Text& part) { return fixtureWidth(part) <= 120; });

            ok = ok && linesOf(parts) == item.value();
        }

        same += ok ? 1 : 0;
        total++;

        if (!ok) {
            std::printf("     differs: %s\n", entry["text"].get<std::string>().c_str());
        }
    }

    check(same == total, "tokenizes, styles, breaks and hyphenates like the plugin (" + std::to_string(same) + " of " +
                             std::to_string(total) + " texts)");
}

engine::Json countOf(const std::optional<std::vector<uint8_t>>& mask) {
    if (!mask) {
        return nullptr;
    }

    return std::count_if(mask->begin(), mask->end(), [](uint8_t value) { return value > 0; });
}

void letterGeometry(const std::filesystem::path& fixtures) {
    const engine::Rgb page = engine::readPage(fixtures / "letter-page.png");
    const engine::Json expected = readJson(fixtures / "letter-geometry.json");
    std::vector<engine::LetterRegion> regions;
    std::vector<engine::Geometry> geometries;

    for (const auto& entry : expected) {
        engine::LetterRegion region;
        const engine::Json& xyxy = entry["region"]["xyxy"];

        region.xyxy = {xyxy[0].get<double>(), xyxy[1].get<double>(), xyxy[2].get<double>(), xyxy[3].get<double>()};
        region.text = entry["region"]["text"].get<std::string>();
        region.translation = entry["region"]["translation"].get<std::string>();
        region.vertical = entry["region"]["vertical"].get<bool>();
        regions.push_back(region);
        geometries.push_back(engine::renderGeometry(page, region));
    }

    const std::vector<engine::Geometry> constrained = engine::constrainGeometries(regions, geometries);

    for (size_t i = 0; i < expected.size(); i++) {
        const engine::Geometry& settled = constrained[i];
        const auto [x1, y1, x2, y2] = settled.box;
        const auto safe = settled.mask ? engine::safeArea(*settled.mask, x2 - x1, y2 - y1, 5) : std::nullopt;
        const engine::Json ours = {{"box", geometries[i].box},
                                   {"maskSum", countOf(geometries[i].mask)},
                                   {"constrained", settled.box},
                                   {"constrainedSum", countOf(settled.mask)},
                                   {"safe", safe ? engine::Json(*safe) : engine::Json(nullptr)}};
        const engine::Json theirs = {{"box", expected[i]["box"]},
                                     {"maskSum", expected[i]["maskSum"]},
                                     {"constrained", expected[i]["constrained"]},
                                     {"constrainedSum", expected[i]["constrainedSum"]},
                                     {"safe", expected[i]["safe"]}};

        check(ours == theirs, "places lettering for block " + std::to_string(i) + " like the plugin" +
                                  (ours == theirs ? std::string() : " (ours " + ours.dump() + ", plugin " + theirs.dump() + ")"));
    }
}

void metrics(const std::filesystem::path& fonts, const engine::Json& expected) {
    for (const auto& entry : expected["metrics"]) {
        const std::vector<uint8_t> data = readBytes(fonts / engine::pathOf(entry["font"].get<std::string>()));
        WenbuTypeface* typeface = wenbu_letter_typeface(data.data(), data.size());
        float ascent = 0;
        float descent = 0;
        float leading = 0;

        wenbu_letter_metrics(typeface, entry["size"].get<float>(), &ascent, &descent, &leading);
        check(ascent == entry["ascent"].get<float>() && descent == entry["descent"].get<float>() &&
                  leading == entry["leading"].get<float>(),
              "line metrics of " + entry["font"].get<std::string>() + " at " + entry["size"].dump() +
                  " match skia-python");
        wenbu_letter_typeface_free(typeface);
    }
}

void glyphs(const std::filesystem::path& fonts, const engine::Json& expected) {
    for (const auto& entry : expected["drawings"]) {
        const std::vector<uint8_t> data = readBytes(fonts / engine::pathOf(entry["font"].get<std::string>()));
        WenbuTypeface* typeface = wenbu_letter_typeface(data.data(), data.size());
        const std::vector<int32_t> codepoints = entry["codepoints"].get<std::vector<int32_t>>();
        std::vector<uint16_t> ids(codepoints.size());

        wenbu_letter_glyphs(typeface, codepoints.data(), static_cast<int>(codepoints.size()), ids.data());

        const std::vector<float> positions = entry["positions"].get<std::vector<float>>();
        const int width = entry["width"].get<int>();
        const int height = entry["height"].get<int>();
        std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4, 255);

        const WenbuGlyphRun run{typeface, entry["size"].get<float>(), static_cast<int>(ids.size()), ids.data(),
                                positions.data()};

        WenbuDrawing drawing{{26, 26, 26, 255}, {255, 255, 255, 255}, entry["stroke"].get<float>(), 1, 0, 0, 0};

        wenbu_letter_draw(pixels.data(), width, height, &run, 1, &drawing);

        const std::vector<uint8_t> theirs = readBytes(std::filesystem::path(entry["pixels"].get<std::string>()));
        size_t differing = 0;
        int largest = 0;

        for (size_t i = 0; i < pixels.size() && i < theirs.size(); ++i) {
            const int delta = std::abs(int{pixels[i]} - int{theirs[i]});

            differing += delta > 0 ? 1 : 0;
            largest = std::max(largest, delta);
        }

        check(differing == 0, "draws " + entry["label"].get<std::string>() + " like skia-python (" +
                                  std::to_string(differing) + " bytes differ, largest " + std::to_string(largest) + ")");
        wenbu_letter_typeface_free(typeface);
    }
}

}

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: wenbu-manga-engine-tests <fixtures> <fonts> [skia reference json] [langid.bin]\n");

        return 2;
    }

    const std::filesystem::path fixtures = engine::pathOf(argv[1]);
    const std::filesystem::path fonts = engine::pathOf(argv[2]);

    const auto guarded = [](const char* name, const std::function<void()>& run) {
        try {
            run();
        } catch (const std::exception& error) {
            check(false, std::string(name) + " threw: " + error.what());
        }
    };

    guarded("pages", [&] { pages(fixtures); });
    guarded("saves", [&] { saves(fixtures); });
    guarded("detection", [&] { detection(fixtures); });
    guarded("sets", [&] { sets(fixtures); });
    guarded("panels", [&] { panels(fixtures); });
    guarded("merge", [&] { merge(fixtures); });
    guarded("refinement", [&] { refinement(fixtures); });
    guarded("resizing", [&] { resizing(fixtures); });
    guarded("reader input", [&] { readerInput(fixtures); });
    guarded("tokens", [&] { tokens(fixtures); });
    guarded("filters", [&] { filters(fixtures, argc > 4 ? engine::pathOf(argv[4]) : std::filesystem::path()); });
    guarded("colours", [] { colours(); });
    guarded("repetition", [] { repetition(); });
    guarded("clean pages", [&] { cleanPages(); });
    guarded("inpaint crops", [&] { inpaintCrops(fixtures); });
    guarded("LaMa windows", [&] { lamaWindows(); });
    guarded("line breaking", [&] { lineBreaking(fixtures); });
    guarded("letter geometry", [&] { letterGeometry(fixtures); });

    if (argc > 3) {
        const engine::Json skia = readJson(engine::pathOf(argv[3]));

        guarded("metrics", [&] { metrics(fonts, skia); });
        guarded("glyphs", [&] { glyphs(fonts, skia); });
    }

    std::printf("%d failed\n", failures);

    return failures == 0 ? 0 : 1;
}
