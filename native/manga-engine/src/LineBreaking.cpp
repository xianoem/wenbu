#include "LineBreaking.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

#include <icu.h>

namespace engine {

namespace {

const Text notAtStart = U"、。，．！？）】」』〕〉》，．！？）］｝,.)!?;:…‥ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ";
const Text notAtEnd = U"（【「『〔〈《（［｛([";
const Text closers = U")]}’”'\"";

bool contains(const Text& set, char32_t character) {
    return set.find(character) != Text::npos;
}

bool isHangul(char32_t code) {
    return (code >= 0xAC00 && code <= 0xD7AF) || (code >= 0x1100 && code <= 0x11FF) || (code >= 0x3130 && code <= 0x318F);
}

bool isCjk(char32_t code) {
    static const std::vector<std::pair<char32_t, char32_t>> ranges = {
        {0x4E00, 0x9FFF}, {0x3400, 0x4DBF}, {0x20000, 0x2CEAF}, {0xF900, 0xFAFF}, {0x3040, 0x309F}, {0x30A0, 0x30FF},
        {0x31F0, 0x31FF}, {0xAC00, 0xD7AF}, {0x1100, 0x11FF},   {0x3130, 0x318F}, {0x3000, 0x303F}, {0xFF00, 0xFFEF},
    };

    return std::any_of(ranges.begin(), ranges.end(),
                       [code](const auto& range) { return code >= range.first && code <= range.second; });
}

// A CJK character that is not Hangul: one that may break on its own.
bool isCjkOnly(char32_t code) {
    return isCjk(code) && !isHangul(code);
}

// Python's \w in str patterns: letters, numbers and the underscore.
bool isWordCharacter(char32_t c) {
    return c == U'_' || (U_GET_GC_MASK(static_cast<UChar32>(c)) & (U_GC_L_MASK | U_GC_N_MASK)) != 0;
}

Style styleOf(size_t marker) {
    if (marker == 3) {
        return Style::BoldItalic;
    }

    return marker == 2 ? Style::Bold : Style::Italic;
}

std::optional<StyledRun> styledRunAt(const Text& text, size_t start) {
    size_t stars = 0;

    while (start + stars < text.size() && stars < 3 && text[start + stars] == U'*') {
        stars++;
    }

    // \*{1,3} tries its longest run first; (.*?) then takes as little as it can, and Python's `.` stops at
    // a newline.
    for (size_t marker = stars; marker >= 1; marker--) {
        for (size_t end = start + marker; end + marker <= text.size(); end++) {
            if (end > start + marker && text[end - 1] == U'\n') {
                break;
            }

            if (text.compare(end, marker, text, start, marker) == 0) {
                return StyledRun{start, end + marker - start, marker};
            }
        }
    }

    return std::nullopt;
}

// ^(.*?)((\.{2,})[)\]}’”'"]*)$ : the start of the trailing ellipsis, if there is one.
std::optional<size_t> trailingEllipsis(const Text& text) {
    for (size_t start = 0; start < text.size(); start++) {
        if (isEllipsisToken(text.substr(start))) {
            return start;
        }
    }

    return std::nullopt;
}

std::vector<Text> splitCjkAware(const Text& text, bool detachEllipsis) {
    std::vector<Text> tokens;
    Text current;

    for (const char32_t character : text) {
        if (isSpace(character)) {
            if (!current.empty()) {
                tokens.push_back(current);
                current.clear();
            }
        } else if (isCjkOnly(character)) {
            if (contains(notAtStart, character)) {
                if (!current.empty()) {
                    current += character;
                } else if (!tokens.empty()) {
                    tokens.back() += character;
                } else {
                    current = Text(1, character);
                }
            } else if (contains(notAtEnd, character)) {
                if (!current.empty()) {
                    tokens.push_back(current);
                }

                current = Text(1, character);
            } else if (current.empty()) {
                tokens.push_back(Text(1, character));
            } else if (contains(notAtEnd, current.back())) {
                tokens.push_back(current + character);
                current.clear();
            } else {
                tokens.push_back(current);
                tokens.push_back(Text(1, character));
                current.clear();
            }
        } else {
            current += character;
        }
    }

    if (!current.empty()) {
        tokens.push_back(current);
    }

    if (!detachEllipsis) {
        return tokens;
    }

    std::vector<Text> detached;

    for (const Text& token : tokens) {
        const std::optional<size_t> start = trailingEllipsis(token);

        if (start && *start > 0) {
            detached.push_back(token.substr(0, *start));
            detached.push_back(token.substr(*start));
        } else {
            detached.push_back(token);
        }
    }

    return detached;
}

Text styledContent(const Text& token) {
    const std::optional<StyledRun> run = styledRunAtStart(token);

    return run ? run->content(token) : token;
}

bool isCjkToken(const Text& token) {
    const Text content = styledContent(token);

    return !content.empty() && std::all_of(content.begin(), content.end(), [](char32_t c) { return isCjkOnly(c); });
}

bool needsSpaceBetween(const Text& left, const Text& right, bool detachEllipsis) {
    if (isCjkToken(left) && isCjkToken(right)) {
        return false;
    }

    return !(detachEllipsis && isEllipsisToken(styledContent(right)));
}

std::pair<Text, Text> splitWithHyphen(const Text& base, size_t index) {
    const char32_t before = index > 0 ? base[index - 1] : 0;
    Text left;
    Text right;

    if (base[index] == U'-') {
        left = base.substr(0, index + 1);
        right = base.substr(index + 1);
    } else if (before == U'-') {
        left = base.substr(0, index);
        right = base.substr(index);
    } else {
        left = base.substr(0, index) + U"-";
        right = base.substr(index);
    }

    if (!left.empty() && left.back() == U'-' && !right.empty() && right.front() == U'-') {
        right = right.substr(1);
    }

    return {left, right};
}

std::optional<std::vector<Text>> greedyBreaks(const std::vector<Text>& tokens, const std::vector<double>& widths,
                                              double maxWidth, double spaceWidth, bool detachEllipsis) {
    std::vector<std::vector<Text>> lines;
    double width = 0;

    for (size_t index = 0; index < tokens.size(); index++) {
        const double tokenWidth = widths[index];

        if (!lines.empty()) {
            const double gap = needsSpaceBetween(lines.back().back(), tokens[index], detachEllipsis) ? spaceWidth : 0;

            if (width + gap + tokenWidth <= maxWidth) {
                lines.back().push_back(tokens[index]);
                width += gap + tokenWidth;

                continue;
            }
        }

        if (tokenWidth > maxWidth) {
            return std::nullopt;
        }

        lines.push_back({tokens[index]});
        width = tokenWidth;
    }

    std::vector<Text> joined;

    for (const auto& line : lines) {
        joined.push_back(joinTokens(line, detachEllipsis));
    }

    return joined;
}

bool endsWithHyphen(const Text& token) {
    if (!token.empty() && token.back() == U'-') {
        return true;
    }

    const std::optional<StyledRun> run = styledRunAtStart(token);

    if (!run) {
        return false;
    }

    const Text content = run->content(token);

    return !content.empty() && content.back() == U'-';
}

}

std::optional<StyledRun> styledRunFrom(const Text& text, size_t from) {
    for (size_t start = from; start < text.size(); start++) {
        if (text[start] == U'*') {
            if (std::optional<StyledRun> run = styledRunAt(text, start)) {
                return run;
            }
        }
    }

    return std::nullopt;
}

std::optional<StyledRun> styledRunAtStart(const Text& text) {
    return text.empty() || text[0] != U'*' ? std::nullopt : styledRunAt(text, 0);
}

std::vector<std::pair<Text, Style>> parseStyledSegments(const Text& text) {
    std::vector<std::pair<Text, Style>> segments;
    size_t lastEnd = 0;

    for (std::optional<StyledRun> run = styledRunFrom(text, 0); run; run = styledRunFrom(text, run->start + run->length)) {
        if (run->start > lastEnd) {
            segments.emplace_back(text.substr(lastEnd, run->start - lastEnd), Style::Regular);
        }

        segments.emplace_back(run->content(text), styleOf(run->marker));
        lastEnd = run->start + run->length;
    }

    if (lastEnd < text.size()) {
        segments.emplace_back(text.substr(lastEnd), Style::Regular);
    }

    std::erase_if(segments, [](const auto& segment) { return segment.first.empty(); });

    return segments;
}

bool isSpace(char32_t c) {
    return (c >= 0x09 && c <= 0x0D) || (c >= 0x1C && c <= 0x20) || c == 0x85 || c == 0xA0 || c == 0x1680 ||
           (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000;
}

std::vector<Text> splitWords(const Text& text) {
    std::vector<Text> words;
    Text current;

    for (const char32_t character : text) {
        if (isSpace(character)) {
            if (!current.empty()) {
                words.push_back(current);
                current.clear();
            }
        } else {
            current += character;
        }
    }

    if (!current.empty()) {
        words.push_back(current);
    }

    return words;
}

std::vector<std::pair<Text, bool>> tokenizeStyledText(const Text& text, bool detachEllipsis) {
    std::vector<std::pair<Text, bool>> tokens;
    size_t lastEnd = 0;

    for (std::optional<StyledRun> run = styledRunFrom(text, 0); run; run = styledRunFrom(text, run->start + run->length)) {
        if (run->start > lastEnd) {
            for (const Text& word : splitCjkAware(text.substr(lastEnd, run->start - lastEnd), detachEllipsis)) {
                tokens.emplace_back(word, false);
            }
        }

        const Text marker(run->marker, U'*');
        const Text content = run->content(text);

        if (!content.empty()) {
            for (const Text& word : splitCjkAware(content, detachEllipsis)) {
                tokens.emplace_back(marker + word + marker, true);
            }
        }

        lastEnd = run->start + run->length;
    }

    if (lastEnd < text.size()) {
        for (const Text& word : splitCjkAware(text.substr(lastEnd), detachEllipsis)) {
            tokens.emplace_back(word, false);
        }
    }

    return tokens;
}

std::optional<HyphenatedWord> hyphenatedWord(const Text& text) {
    const auto inCore = [](char32_t c) { return c == U'-' || isWordCharacter(c); };
    size_t lead = 0;

    while (lead < text.size() && !isWordCharacter(text[lead])) {
        lead++;
    }

    // (\W*) takes as much as it can, then gives back; ((?:\w|-)+) likewise, and (\W*)$ takes the rest.
    for (size_t leading = lead + 1; leading-- > 0;) {
        size_t run = 0;

        while (leading + run < text.size() && inCore(text[leading + run])) {
            run++;
        }

        for (size_t core = run; core >= 1; core--) {
            const size_t rest = leading + core;

            if (std::none_of(text.begin() + static_cast<long>(rest), text.end(), [](char32_t c) { return isWordCharacter(c); })) {
                return HyphenatedWord{text.substr(0, leading), text.substr(leading, core), text.substr(rest)};
            }
        }
    }

    return std::nullopt;
}

std::optional<std::vector<Text>> tryHyphenateWord(const Text& text, size_t minLength,
                                                  const std::function<bool(const Text&)>& fits) {
    const std::optional<HyphenatedWord> word = hyphenatedWord(text);

    if (!word) {
        return std::nullopt;
    }

    const Text& core = word->core;

    if (core.size() < minLength) {
        return std::nullopt;
    }

    const size_t middle = core.size() / 2;

    if (core.find(U'-') != Text::npos) {
        std::vector<size_t> positions;

        for (size_t i = 0; i < core.size(); i++) {
            if (core[i] == U'-') {
                positions.push_back(i);
            }
        }

        std::stable_sort(positions.begin(), positions.end(), [middle](size_t a, size_t b) {
            return std::abs(static_cast<long>(a) - static_cast<long>(middle)) <
                   std::abs(static_cast<long>(b) - static_cast<long>(middle));
        });

        for (const size_t position : positions) {
            if (position == 0 || position >= core.size() - 1) {
                continue;
            }

            const Text left = word->leading + core.substr(0, position + 1);
            const Text right = core.substr(position + 1) + word->trailing;

            if (fits(left) && fits(right)) {
                return std::vector<Text>{left, right};
            }
        }
    }

    std::vector<size_t> candidates;
    const size_t span = std::max(middle, core.size() - middle);

    for (size_t distance = 0; distance < span; distance++) {
        const long leftIndex = static_cast<long>(middle) - static_cast<long>(distance);
        const size_t rightIndex = middle + distance;
        const long last = static_cast<long>(core.size()) - 2;

        if (leftIndex >= 2 && leftIndex < last) {
            candidates.push_back(static_cast<size_t>(leftIndex));
        }

        if (rightIndex >= 2 && static_cast<long>(rightIndex) < last && static_cast<long>(rightIndex) != leftIndex) {
            candidates.push_back(rightIndex);
        }
    }

    for (const size_t index : candidates) {
        const auto [leftPart, rightPart] = splitWithHyphen(core, index);
        const Text left = word->leading + leftPart;
        const Text right = rightPart + word->trailing;

        if (fits(left) && fits(right)) {
            return std::vector<Text>{left, right};
        }
    }

    return std::nullopt;
}

bool isEllipsisToken(const Text& text) {
    size_t dots = 0;

    while (dots < text.size() && text[dots] == U'.') {
        dots++;
    }

    return dots >= 2 && std::all_of(text.begin() + static_cast<long>(dots), text.end(),
                                    [](char32_t c) { return contains(closers, c); });
}

Text joinTokens(const std::vector<Text>& tokens, bool detachEllipsis) {
    Text line;

    for (size_t index = 0; index < tokens.size(); index++) {
        if (index > 0 && needsSpaceBetween(tokens[index - 1], tokens[index], detachEllipsis)) {
            line += U' ';
        }

        line += tokens[index];
    }

    return line;
}

std::optional<std::vector<Text>> optimalBreaks(const std::vector<Text>& tokens, double maxWidth, const Width& tokenWidth,
                                               double spaceWidth, const BreakOptions& options) {
    if (tokens.empty()) {
        return std::vector<Text>{};
    }

    std::vector<double> widths;

    for (const Text& token : tokens) {
        widths.push_back(tokenWidth(token));
    }

    if (options.style.mode == BreakMode::Greedy) {
        return greedyBreaks(tokens, widths, maxWidth, spaceWidth, options.detachEllipsis);
    }

    const double orphanPenalty = options.style.avoidOrphans ? std::pow(maxWidth, options.badnessExponent) : 0;
    const size_t count = tokens.size();
    std::vector<double> cost(count + 1, std::numeric_limits<double>::infinity());
    std::vector<size_t> path(count + 1, 0);

    cost[0] = 0;

    for (size_t end = 1; end <= count; end++) {
        double lineWidth = 0;

        for (size_t start = end; start-- > 0;) {
            if (start < end - 1 && needsSpaceBetween(tokens[start], tokens[start + 1], options.detachEllipsis)) {
                lineWidth += spaceWidth;
            }

            lineWidth += widths[start];

            if (lineWidth > maxWidth) {
                break;
            }

            double badness = std::pow(maxWidth - lineWidth, options.badnessExponent);

            if (endsWithHyphen(tokens[end - 1])) {
                badness += options.hyphenPenalty;
            }

            if (end == count && start == end - 1 && start > 0) {
                badness += orphanPenalty;
            }

            const double total = cost[start] + badness;

            if (total < cost[end]) {
                cost[end] = total;
                path[end] = start;
            }
        }
    }

    if (!std::isfinite(cost[count])) {
        return std::nullopt;
    }

    std::vector<Text> lines;

    for (size_t end = count; end > 0; end = path[end]) {
        lines.insert(lines.begin(), joinTokens(std::vector<Text>(tokens.begin() + static_cast<long>(path[end]),
                                                                 tokens.begin() + static_cast<long>(end)),
                                               options.detachEllipsis));
    }

    return lines;
}

std::optional<std::vector<Text>> evenedBreaks(const std::vector<Text>& tokens, double maxWidth, const Width& tokenWidth,
                                              double spaceWidth, const Width& lineWidth, const BreakOptions& options) {
    const std::optional<std::vector<Text>> lines = optimalBreaks(tokens, maxWidth, tokenWidth, spaceWidth, options);

    if (!lines || lines->size() < 2 || options.style.mode != BreakMode::Balanced || !options.style.evenOut) {
        return lines;
    }

    double low = 0;
    double high = maxWidth;
    std::vector<Text> best = *lines;

    for (int step = 0; step < 10; step++) {
        const double width = (low + high) / 2;
        const std::optional<std::vector<Text>> tried = optimalBreaks(tokens, width, tokenWidth, spaceWidth, options);
        bool fits = tried && tried->size() == lines->size();

        if (fits) {
            for (const Text& line : *tried) {
                fits = fits && lineWidth(line) <= width;
            }
        }

        if (fits) {
            best = *tried;
            high = width;
        } else {
            low = width;
        }
    }

    return best;
}

}
