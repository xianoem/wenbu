// A folder run, as the plugin's Pipeline.run does it: pages are read ahead, their texts sent for translation
// in parallel, and translated pages are cleaned with LaMa over the refined mask, lettered and saved, two at a
// time. GPU work takes turns on the GPU thread.
#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

#include "Inpaint.hpp"
#include "Lettering.hpp"
#include "Protocol.hpp"
#include "Scanner.hpp"

namespace engine {

enum class OutputFormat { Png, Jpeg, Webp, Source };

struct RunSettings {
    std::string target = "ENG";
    int inpaintingSize = 2048;
    bool wholePage = false;
    OutputFormat format = OutputFormat::Png;
    int quality = 95;
    int pagesAhead = 3;
    int translationRequests = 3;
    LetterOptions letter;
    // Screen AI's folder, for a second reading of blocks the reader could not finish; empty without it.
    std::filesystem::path screenAi;
};

RunSettings runSettingsOf(const Json& options);

struct RunPage {
    std::filesystem::path source;
    std::filesystem::path output;
};

struct RunResult {
    int done = 0;
    int failed = 0;
    double seconds = 0;
};

// The run's events without the run id: page-started, stage, page-done and page-failed.
using RunReport = std::function<void(Json)>;

// Sends a page's texts for translation and waits for the answer; throws when it fails or the run stops.
using Translate = std::function<std::vector<std::string>(int page, const std::vector<std::string>& texts)>;

class Runner {
public:
    Runner(Scanner& scanner, Inpainter& inpainter, Lettering& lettering);

    // Pages not started once `stop` is set are skipped.
    RunResult run(const std::vector<RunPage>& pages, const RunSettings& settings, const RunReport& report,
                  const Translate& translate, const std::atomic<bool>& stop);

private:
    Scanner& scanner_;
    Inpainter& inpainter_;
    Lettering& lettering_;
};

}
