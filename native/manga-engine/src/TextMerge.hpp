// How the manga plugin turns detected text lines into blocks: the 48px OCR's direction vote and line
// order (ocr/common.py, ocr/model_48px.py), the networkx merge (textline_merge), TextBlock's geometry and
// sort_regions. numpy's float32 arithmetic is reproduced where the plugin used it.
#pragma once

#include <array>
#include <vector>

#include "Kumiko.hpp"
#include "Quad.hpp"

namespace engine {

struct Line : Quad {
    // 'h' or 'v', as the OCR assigned it.
    char direction = 'h';
};

struct Block {
    std::vector<Line> lines;
    double fontSize = 0;
    double angle = 0;
    std::array<int, 4> xyxy{};
    bool vertical = false;
};

// TextBlock's font size of one line: the shorter of its two middle lines, in float32.
float fontSizeOf(const Quad& line);

// The 48px OCR's direction pass, then its output order: lines sorted by the width of their 48px crops.
std::vector<Line> assignDirections(const std::vector<Quad>& lines);

// merge_bboxes_text_region and textline_merge.dispatch: blocks of lines, each in reading order.
std::vector<Block> mergeLines(const std::vector<Line>& lines);

// sort_regions: by panel, then within each panel.
std::vector<Block> sortBlocks(const std::vector<Block>& blocks, const std::vector<PanelBox>& panels, bool rtl);

}
