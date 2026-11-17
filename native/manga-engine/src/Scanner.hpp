// The Manga Editor's scan: text lines are detected, merged into blocks and put in reading order by panel;
// each block is read, blocks the plugin's filters or a weak reading reject are dropped, and the refined
// text mask is made for the remaining ones. Horizontal blocks the reader could not finish are read again by
// Screen AI when its folder is given.
#pragma once

#include <filesystem>
#include <future>
#include <string>
#include <vector>

#include "Colours.hpp"
#include "Detector.hpp"
#include "Kumiko.hpp"
#include "Protocol.hpp"
#include "Reader.hpp"
#include "ScreenAi.hpp"
#include "TextFilter.hpp"
#include "TextMerge.hpp"

namespace engine {

struct FoundBlock {
    Block block;
    std::string text;
    Reading reading;
    BlockColours colours;
};

struct Found {
    std::vector<FoundBlock> blocks;
    // The refined text mask at page size, 255 on text.
    std::vector<uint8_t> mask;
};

// A page's work before its turn to find text: the detector's input, and its panels' features on their own
// thread.
struct PreparedPage {
    const Rgb* page = nullptr;
    DetectorInput detector;
    std::shared_future<PanelFeatures> features;
};

class Scanner {
public:
    Scanner(Runtime& runtime, const std::filesystem::path& models);

    // The blocks and refined mask of a page already in memory, as a folder run needs them. An empty
    // `screenAi` folder leaves the reader's readings as they are.
    Found find(const Rgb& page, const std::string& target, const std::filesystem::path& screenAi);

    // Starts the work on `page` that needs no model; the page must outlive the result.
    static PreparedPage prepare(const Rgb& page);

    Found find(const PreparedPage& prepared, const std::string& target, const std::filesystem::path& screenAi);

    // The editor's scan op: writes the mask to `maskFile` and returns the blocks.
    Json scan(const std::filesystem::path& source, const std::filesystem::path& maskFile, const std::string& target,
              const std::filesystem::path& screenAi);

    Reader& reader() { return reader_; }
    Detector& detector() { return detector_; }

private:
    Detector detector_;
    Reader reader_;
    LanguageId languageId_;
    ScreenAi screenAi_;
};

}
