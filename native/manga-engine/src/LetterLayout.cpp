#include "LetterLayout.hpp"

#include <algorithm>
#include <cmath>

namespace engine {

namespace {

bool allOf(const Text& text, const Text& set) {
    return !text.empty() && std::all_of(text.begin(), text.end(), [&](char32_t c) { return set.find(c) != Text::npos; });
}

// ^[,.;:!?…]+$ and ^[)\]}’”'"]+$
bool isTrailingPunctuation(const Text& text) {
    return allOf(text, U",.;:!?…");
}

bool isCloser(const Text& text) {
    return allOf(text, U")]}’”'\"");
}

std::vector<Text> glueTrailingPunctuation(const std::vector<Text>& tokens, bool detach) {
    std::vector<Text> glued;

    for (const Text& token : tokens) {
        const std::optional<StyledRun> run = styledRunAtStart(token);
        const Text content = run ? run->content(token) : token;

        if (detach && isEllipsisToken(content)) {
            glued.push_back(token);
        } else if (!glued.empty() && (isTrailingPunctuation(content) || isCloser(content))) {
            glued.back() += token;
        } else {
            glued.push_back(token);
        }
    }

    return glued;
}

std::vector<Text> splitOnNewlines(const Text& text) {
    std::vector<Text> parts;
    size_t start = 0;

    for (size_t at = text.find(U'\n'); at != Text::npos; at = text.find(U'\n', start)) {
        parts.push_back(text.substr(start, at - start));
        start = at + 1;
    }

    parts.push_back(text.substr(start));

    return parts;
}

struct Fit {
    std::vector<LayoutLine> lines;
    LineMetrics metrics;
    double maxLineWidth = 0;
    double lineHeight = 0;
};

std::optional<Fit> fitAt(int size, const Text& text, double maxWidth, double maxHeight, const Measure& measure,
                         const LayoutOptions& options, bool forceFit) {
    const LineMetrics metrics = measure.metrics(size);
    double lineHeight = (-metrics.ascent + metrics.descent + metrics.leading) * options.lineSpacing;

    if (lineHeight <= 0) {
        lineHeight = size * 1.2 * options.lineSpacing;
    }

    const auto settle = [&](const std::vector<Text>& texts) -> std::optional<Fit> {
        Fit fit{{}, metrics, 0, lineHeight};

        for (const Text& line : texts) {
            fit.lines.push_back({line, measure.width(line, size)});
            fit.maxLineWidth = std::max(fit.maxLineWidth, fit.lines.back().width);
        }

        const double height = -metrics.ascent + metrics.descent + (static_cast<double>(texts.size()) - 1) * lineHeight;

        if (forceFit || (fit.maxLineWidth <= maxWidth && height <= maxHeight)) {
            return fit;
        }

        return std::nullopt;
    };

    if (text.find(U'\n') != Text::npos) {
        return settle(splitOnNewlines(text));
    }

    const bool detach = options.breaks.detachEllipsis;
    std::vector<Text> augmented;

    for (const auto& [token, isStyled] : tokenizeStyledText(text, detach)) {
        if (!options.hyphenate) {
            augmented.push_back(token);

            continue;
        }

        Text marker;
        Text core = token;

        if (isStyled) {
            const std::optional<StyledRun> run = styledRunAtStart(token);

            if (!run) {
                augmented.push_back(token);

                continue;
            }

            marker = Text(run->marker, U'*');
            core = run->content(token);
        }

        const std::optional<HyphenatedWord> word = hyphenatedWord(core);
        const size_t length = word ? word->core.size() : core.size();

        if (length <= options.hyphenationMinWordLength || measure.width(token, size) <= maxWidth) {
            augmented.push_back(token);

            continue;
        }

        const auto wrap = [&](const Text& part) { return marker.empty() ? part : marker + part + marker; };
        const std::optional<std::vector<Text>> parts =
            tryHyphenateWord(core, options.hyphenationMinWordLength,
                             [&](const Text& part) { return measure.width(wrap(part), size) <= maxWidth; });

        if (!parts) {
            augmented.push_back(token);
        } else {
            for (const Text& part : *parts) {
                augmented.push_back(wrap(part));
            }
        }
    }

    const std::vector<Text> words = glueTrailingPunctuation(augmented, detach);
    const Width width = [&](const Text& line) { return measure.width(line, size); };
    const std::optional<std::vector<Text>> broken =
        evenedBreaks(words, maxWidth, width, measure.width(U" ", size), width, options.breaks);

    if (broken && !broken->empty()) {
        return settle(*broken);
    }

    if (!forceFit) {
        return std::nullopt;
    }

    std::vector<Text> single;

    for (const Text& word : words) {
        single.push_back(joinTokens({word}, detach));
    }

    return settle(single);
}

// _check_collision: whether a line's corners, centred in the box, fall outside the balloon mask.
bool collides(const std::vector<LayoutLine>& lines, const Balloon& balloon, double lineHeight, double maxWidth,
              double maxHeight) {
    double y = balloon.top + (maxHeight - static_cast<double>(lines.size()) * lineHeight) / 2;

    for (const LayoutLine& line : lines) {
        const double x = balloon.left + (maxWidth - line.width) / 2;
        const int y1 = static_cast<int>(std::trunc(y));
        const int y2 = static_cast<int>(std::trunc(y + lineHeight));
        const int x1 = static_cast<int>(std::trunc(x));
        const int x2 = static_cast<int>(std::trunc(x + line.width));

        for (const auto& [px, py] : {std::pair{x1, y1}, std::pair{x2, y1}, std::pair{x1, y2}, std::pair{x2, y2}}) {
            const int cx = std::max(0, std::min(px, balloon.width - 1));
            const int cy = std::max(0, std::min(py, balloon.height - 1));

            if ((*balloon.mask)[static_cast<size_t>(cy) * balloon.width + cx] == 0) {
                return true;
            }
        }

        y += lineHeight;
    }

    return false;
}

}

std::optional<Layout> optimalLayout(const Text& text, double maxWidth, double maxHeight, const Measure& measure,
                                    const LayoutOptions& options, const std::optional<Balloon>& balloon, bool hasMask) {
    Text clean;

    if (text.find(U'\n') != Text::npos || text.find(U'\r') != Text::npos) {
        for (size_t i = 0; i < text.size(); i++) {
            if (text[i] == U'\r') {
                clean += U'\n';

                if (i + 1 < text.size() && text[i + 1] == U'\n') {
                    i++;
                }
            } else {
                clean += text[i];
            }
        }
    } else {
        const std::vector<Text> words = splitWords(text);

        for (size_t i = 0; i < words.size(); i++) {
            clean += (i == 0 ? Text() : Text(U" ")) + words[i];
        }
    }

    if (clean.empty()) {
        return std::nullopt;
    }

    std::optional<Layout> best;
    int low = options.minFontSize;
    int high = options.maxFontSize;

    while (low <= high) {
        const int middle = static_cast<int>(std::floor((low + high) / 2.0));

        if (middle == 0) {
            break;
        }

        bool succeeded = false;
        double width = maxWidth;

        for (int squeeze = 0; squeeze < (hasMask ? 3 : 1); squeeze++) {
            const std::optional<Fit> fit = fitAt(middle, clean, width, maxHeight, measure, options, false);

            if (!fit) {
                break;
            }

            if (balloon && collides(fit->lines, *balloon, fit->lineHeight, width, maxHeight)) {
                width *= 0.9;

                continue;
            }

            best = Layout{middle, fit->lines, fit->metrics, fit->maxLineWidth, fit->lineHeight};
            succeeded = true;

            break;
        }

        if (succeeded) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (best) {
        return best;
    }

    if (!options.forceFit) {
        return std::nullopt;
    }

    const std::optional<Fit> fallback = fitAt(options.minFontSize, clean, maxWidth, maxHeight, measure, options, true);

    if (!fallback) {
        return std::nullopt;
    }

    return Layout{options.minFontSize, fallback->lines, fallback->metrics, fallback->maxLineWidth, fallback->lineHeight};
}

}
