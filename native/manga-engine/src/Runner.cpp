#include "Runner.hpp"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <mutex>
#include <semaphore>
#include <stdexcept>
#include <thread>

#include "CleanPlan.hpp"
#include "Fonts.hpp"
#include "PillowResize.hpp"

namespace engine {

namespace {

// LaMa crops take turns on the GPU, so a third finishing page letters and saves on the CPU meanwhile.
constexpr int finishing = 3;

struct Stopped : std::runtime_error {
    Stopped() : std::runtime_error("The run was cancelled.") {}
};

class Permit {
public:
    explicit Permit(std::counting_semaphore<>& semaphore) : semaphore_(semaphore) { semaphore_.acquire(); }
    ~Permit() { semaphore_.release(); }

    Permit(const Permit&) = delete;
    Permit& operator=(const Permit&) = delete;

private:
    std::counting_semaphore<>& semaphore_;
};

std::wstring extensionOf(const std::filesystem::path& file) {
    std::wstring extension = file.extension().wstring();

    std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });

    return extension;
}

PageFormat formatOf(const RunSettings& settings, const std::filesystem::path& source) {
    switch (settings.format) {
    case OutputFormat::Jpeg:
        return PageFormat::Jpeg;
    case OutputFormat::Webp:
        return PageFormat::Webp;
    case OutputFormat::Png:
        return PageFormat::Png;
    case OutputFormat::Source:
        break;
    }

    const std::wstring extension = extensionOf(source);

    if (extension == L".jpg" || extension == L".jpeg") {
        return PageFormat::Jpeg;
    }

    return extension == L".webp" ? PageFormat::Webp : PageFormat::Png;
}

// TextBlock.direction for 'auto': the largest line decides, taller than wide reads vertically.
bool verticalFor(const FoundBlock& found, const std::string& target) {
    if (lettersHorizontally(target)) {
        return false;
    }

    int largest = 0;
    bool vertical = false;

    for (const Line& line : found.block.lines) {
        int minX = line.pts[0].x;
        int maxX = minX;
        int minY = line.pts[0].y;
        int maxY = minY;

        for (const auto& point : line.pts) {
            minX = std::min(minX, point.x);
            maxX = std::max(maxX, point.x);
            minY = std::min(minY, point.y);
            maxY = std::max(maxY, point.y);
        }

        const int width = maxX - minX;
        const int height = maxY - minY;

        if (width * height > largest) {
            largest = width * height;
            vertical = height > 0 && static_cast<double>(width) / height < 1;
        }
    }

    return vertical;
}

// keep_original: a page without text is copied, or saved in the output format.
void keepOriginal(const RunPage& page, const RunSettings& settings) {
    if (extensionOf(page.source) == extensionOf(page.output)) {
        std::filesystem::create_directories(page.output.parent_path());
        std::filesystem::copy_file(page.source, page.output, std::filesystem::copy_options::overwrite_existing);

        return;
    }

    savePage(page.output, readPage(page.source), formatOf(settings, page.source), settings.quality);
}

std::array<double, 4> boxOf(const FoundBlock& found) {
    const auto [x1, y1, x2, y2] = found.block.xyxy;

    return {static_cast<double>(x1), static_cast<double>(y1), static_cast<double>(x2), static_cast<double>(y2)};
}

std::vector<CleanBlock> fillBlocks(const Found& found, const std::vector<std::array<double, 4>>& boxes, const Rgb& page) {
    const std::vector<std::array<double, 4>> reach = textReach(found.mask, page.width, page.height, boxes);
    std::vector<CleanBlock> cleaning;

    for (size_t index = 0; index < found.blocks.size(); index++) {
        CleanBlock block;

        block.box = boxes[index];
        block.reach = reach[index];
        block.fill = true;
        block.fg = found.blocks[index].colours.fg;
        block.bg = found.blocks[index].colours.bg;
        cleaning.push_back(block);
    }

    return cleaning;
}

std::string firstLine(const std::string& message) {
    return message.substr(0, message.find('\n'));
}

}

RunSettings runSettingsOf(const Json& options) {
    RunSettings settings;
    const auto number = [&](const char* key, int fallback) {
        const auto found = options.find(key);

        return found != options.end() && found->is_number() ? static_cast<int>(found->get<double>()) : fallback;
    };
    const auto text = [&](const char* key) {
        const auto found = options.find(key);

        return found != options.end() && found->is_string() ? found->get<std::string>() : std::string();
    };
    const std::string format = text("output_format");

    settings.target = text("target_language").empty() ? "ENG" : text("target_language");
    settings.inpaintingSize = number("inpainting_size", 2048);
    settings.wholePage = text("inpainting") == "page";
    settings.quality = number("output_quality", 95);
    settings.pagesAhead = std::max(1, number("pages_ahead", 3));
    settings.translationRequests = std::max(1, number("translation_requests", 3));
    settings.letter = letterOptionsOf(options);

    // with_font: in a run, an installed font takes the place of the font folder; the editor only uses the
    // fonts its blocks name.
    if (!settings.letter.fontFamily.empty()) {
        settings.letter.fontDir = resolveFont(settings.letter.fontFamily, settings.letter.fontCache);
    }

    settings.screenAi = pathOf(text("screen_ai"));

    if (format == "jpeg") {
        settings.format = OutputFormat::Jpeg;
    } else if (format == "webp") {
        settings.format = OutputFormat::Webp;
    } else if (format == "source") {
        settings.format = OutputFormat::Source;
    }

    return settings;
}

Runner::Runner(Scanner& scanner, Inpainter& inpainter, Lettering& lettering)
    : scanner_(scanner), inpainter_(inpainter), lettering_(lettering) {}

RunResult Runner::run(const std::vector<RunPage>& pages, const RunSettings& settings, const RunReport& report,
                      const Translate& translate, const std::atomic<bool>& stop) {
    const auto started = std::chrono::steady_clock::now();
    std::mutex finding;
    std::counting_semaphore<> requests(settings.translationRequests);
    std::counting_semaphore<> finish(finishing);
    std::atomic<size_t> next{0};
    std::atomic<int> done{0};
    std::atomic<int> failed{0};

    const auto checkStop = [&] {
        if (stop) {
            throw Stopped();
        }
    };

    const auto stage = [&](size_t index, const char* name) {
        checkStop();
        report({{"event", "stage"}, {"page", index}, {"stage", name}});
    };

    const auto process = [&](size_t index) {
        const RunPage& page = pages[index];
        PageWithAlpha read;
        Found found;

        report({{"event", "page-started"}, {"page", index}});

        stage(index, "detecting");
        read = readPageWithAlpha(page.source);

        // Decoding, the detector's filter and the panels need no model, so they run before the page's turn.
        const PreparedPage prepared = Scanner::prepare(read.rgb);

        {
            std::scoped_lock guard(finding);

            stage(index, "reading");
            found = scanner_.find(prepared, settings.target, settings.screenAi);
        }

        if (found.blocks.empty()) {
            Permit permit(finish);

            checkStop();
            keepOriginal(page, settings);

            return 0;
        }

        stage(index, "translating");

        std::vector<std::string> texts;

        for (const FoundBlock& block : found.blocks) {
            texts.push_back(block.text);
        }

        std::vector<std::string> translations;

        {
            Permit permit(requests);

            translations = translate(static_cast<int>(index), texts);
        }

        if (translations.size() != texts.size()) {
            throw std::runtime_error("Expected " + std::to_string(texts.size()) + " translations, got " +
                                     std::to_string(translations.size()) + ".");
        }

        Permit permit(finish);

        stage(index, "cleaning");

        const Rgb& original = read.rgb;
        const CleanPage paper(original);
        std::vector<std::array<double, 4>> boxes;

        for (const FoundBlock& block : found.blocks) {
            boxes.push_back(boxOf(block));
        }

        const std::vector<CleanBlock> cleaning = fillBlocks(found, boxes, original);
        const Rgb cleaned = cleanPage(paper, found.mask, cleaning, [&](const Rgb& image, const std::vector<uint8_t>& mask) {
            return inpainter_.inpaint(image, mask, {settings.inpaintingSize, settings.wholePage});
        });
        const std::vector<std::optional<std::array<int, 4>>> areas = ownTextAreas(paper, boxes);

        stage(index, "lettering");

        std::vector<LetterBlock> blocks;

        for (size_t at = 0; at < found.blocks.size(); at++) {
            const FoundBlock& block = found.blocks[at];
            LetterBlock letter;

            for (size_t i = 0; i < 4; i++) {
                letter.region.xyxy[i] = block.block.xyxy[i];
            }

            letter.region.text = block.reading.text;
            letter.region.translation = translations[at];
            letter.region.vertical = verticalFor(block, settings.target);
            letter.region.angle = block.block.angle;
            letter.fg = block.colours.fg;
            letter.bg = block.colours.bg;

            if (const std::optional<std::array<int, 4>>& area = areas[at]) {
                letter.region.textBox = std::array<double, 4>{static_cast<double>((*area)[0]), static_cast<double>((*area)[1]),
                                                              static_cast<double>((*area)[2]), static_cast<double>((*area)[3])};
                letter.lettering = LetterSettings{};
            }

            blocks.push_back(letter);
        }

        const Rgb lettered = lettering_.render(cleaned, original, blocks, settings.letter);

        if (read.original) {
            saveRgba(page.output, restoredAlpha(*read.original, lettered), formatOf(settings, page.source), settings.quality);
        } else {
            savePage(page.output, lettered, formatOf(settings, page.source), settings.quality);
        }

        return static_cast<int>(translations.size());
    };

    const auto worker = [&] {
        for (size_t index = next++; index < pages.size() && !stop; index = next++) {
            try {
                const int regions = process(index);

                done++;
                report({{"event", "page-done"}, {"page", index}, {"regions", regions}});
            } catch (const std::exception& error) {
                if (stop) {
                    return;
                }

                failed++;
                report({{"event", "page-failed"}, {"page", index}, {"message", firstLine(error.what())}});
            }
        }
    };

    std::vector<std::thread> workers;
    // One page more than can finish keeps finding text while the rest finish.
    const size_t count = std::min(pages.size(), static_cast<size_t>(std::max(settings.pagesAhead, finishing + 1)));

    for (size_t i = 0; i < count; i++) {
        workers.emplace_back(worker);
    }

    for (std::thread& thread : workers) {
        thread.join();
    }

    return {done, failed, std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count()};
}

}
