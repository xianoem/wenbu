// The lettering's text handling (wenbu_manga/skia/text_processing.py): styled segments, tokens that respect
// Japanese line-break rules (kinsoku), hyphenation, and the line breaks themselves (a Knuth-style minimum of
// cubed slack, or greedy), with the balanced mode narrowing the width. Text is in code points.
#pragma once

#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace engine {

using Text = std::u32string;

enum class Style { Regular, Italic, Bold, BoldItalic };

enum class BreakMode { Balanced, Greedy, Manual };

struct LineBreaking {
    BreakMode mode = BreakMode::Balanced;
    bool avoidOrphans = false;
    bool evenOut = false;
};

struct BreakOptions {
    LineBreaking style;
    double badnessExponent = 3;
    double hyphenPenalty = 1000;
    bool detachEllipsis = true;
};

// A run of `*`, `**` or `***` around text, as the pattern (\*{1,3})(.*?)(\1) matches it.
struct StyledRun {
    size_t start = 0;
    size_t length = 0;
    size_t marker = 0;

    Text content(const Text& text) const { return text.substr(start + marker, length - 2 * marker); }
};

// The first styled run at or after `from`, as re.finditer finds them.
std::optional<StyledRun> styledRunFrom(const Text& text, size_t from);

// The styled run a token starts with, as re.match finds it.
std::optional<StyledRun> styledRunAtStart(const Text& text);

std::vector<std::pair<Text, Style>> parseStyledSegments(const Text& text);

// Python's str.isspace.
bool isSpace(char32_t character);

// Python's str.split() without arguments.
std::vector<Text> splitWords(const Text& text);

// tokenize_styled_text: tokens, with styled ones wrapped in their markers.
std::vector<std::pair<Text, bool>> tokenizeStyledText(const Text& text, bool detachEllipsis);

// ^(\W*)((?:\w|-)+)(\W*)$ with Python's \w.
struct HyphenatedWord {
    Text leading;
    Text core;
    Text trailing;
};

std::optional<HyphenatedWord> hyphenatedWord(const Text& text);

// try_hyphenate_word: the split nearest the middle whose halves both fit.
std::optional<std::vector<Text>> tryHyphenateWord(const Text& text, size_t minLength,
                                                  const std::function<bool(const Text&)>& fits);

// ^(\.{2,})[)\]}’”'"]*$
bool isEllipsisToken(const Text& text);

Text joinTokens(const std::vector<Text>& tokens, bool detachEllipsis);

using Width = std::function<double(const Text&)>;

// find_optimal_breaks_dp: the breaks with the least total cubed slack, plus the penalties.
std::optional<std::vector<Text>> optimalBreaks(const std::vector<Text>& tokens, double maxWidth, const Width& tokenWidth,
                                               double spaceWidth, const BreakOptions& options);

// evened_breaks: in balanced mode, the narrowest width that keeps the same number of lines.
std::optional<std::vector<Text>> evenedBreaks(const std::vector<Text>& tokens, double maxWidth, const Width& tokenWidth,
                                              double spaceWidth, const Width& lineWidth, const BreakOptions& options);

}
