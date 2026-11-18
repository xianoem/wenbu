// The Manga Editor's cleaning plan (wenbu_manga/editor.py): which pixels are filled with the bubble's
// paper colour, which go to LaMa, how inpainted paper settles to the bubble's colour, the text area inside
// a bubble, and how a brushed patch is blended into the page.
#pragma once

#include <array>
#include <functional>
#include <optional>
#include <vector>

#include <opencv2/core.hpp>

#include "Images.hpp"

namespace engine {

struct CleanBlock {
    std::array<double, 4> box{};
    bool drawn = false;
    // "fill" or "inpaint".
    bool fill = false;
    std::optional<std::array<int, 3>> fg;
    std::optional<std::array<int, 3>> bg;
    // Where the block's scanned text lies, when it reaches past the box.
    std::optional<std::array<double, 4>> reach;
};

// A page-sized mask that is zero outside one rectangle.
struct Region {
    int x = 0;
    int y = 0;
    cv::Mat data;

    int w() const { return data.cols; }
    int h() const { return data.rows; }
};

// Everything the plan reads off a page, computed once.
class CleanPage {
public:
    explicit CleanPage(const Rgb& rgb);

    const Rgb& rgb;
    cv::Mat gray;
    // 1 where the page is paper (lighter than 200 and away from ink), 0 elsewhere.
    cv::Mat paper;
    int seal = 2;
};

struct Bubble {
    // The filled outline of the bubble.
    Region bubble;
    std::array<uint8_t, 3> colour{};
};

std::array<int, 4> clipped(const std::array<double, 4>& box, int width, int height);

// bubble_around: the paper-coloured area the block sits in, if it is a bubble and not the page.
std::optional<Bubble> bubbleAround(const CleanPage& page, const std::array<double, 4>& box);

struct Plan {
    Rgb filled;
    std::vector<uint8_t> inpaint;
};

// clean_plan: the page with fill-cleaned bubbles painted, and the mask left for LaMa. `brush` is the
// brush image at page size: red marks pixels to inpaint, green pixels to keep.
Plan cleanPlan(const CleanPage& page, const std::vector<uint8_t>& scan, const std::vector<CleanBlock>& blocks,
               const std::optional<Rgb>& brush);

// settle_paper: inpainted pixels close to a bubble's paper colour become exactly that colour.
Rgb settlePaper(const CleanPage& page, const Rgb& inpainted, const std::vector<CleanBlock>& blocks,
                const std::vector<uint8_t>& mask);

using Inpaint = std::function<Rgb(const Rgb& image, const std::vector<uint8_t>& mask)>;

// The plan carried out, with LaMa only for what the plan leaves to it.
Rgb cleanPage(const CleanPage& page, const std::vector<uint8_t>& scan, const std::vector<CleanBlock>& blocks,
              const Inpaint& inpaint);

// text_area: the bubble around a block, inset, where lettering may go.
std::optional<std::array<int, 4>> textArea(const CleanPage& page, const std::array<double, 4>& box);

// Each box grown over the parts of the mask it touches, so a mark the detector's box missed is still cleaned.
std::vector<std::array<double, 4>> textReach(const std::vector<uint8_t>& mask, int width, int height,
                                             const std::vector<std::array<double, 4>>& boxes);

// Each box's text area, kept only when its bubble holds no other box: a frame around a whole page of
// narration is no bubble to letter in.
std::vector<std::optional<std::array<int, 4>>> ownTextAreas(const CleanPage& page, const std::vector<std::array<double, 4>>& boxes);

// blend_patch: a brushed patch takes the tone of the ring around it and the paper grain from beside it.
Rgb blendPatch(const Rgb& base, const Rgb& inpainted, const std::vector<uint8_t>& mask);

}
