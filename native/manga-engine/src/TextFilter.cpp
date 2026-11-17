#include "TextFilter.hpp"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>

#include <icu.h>

#include "Utf8.hpp"

namespace engine {

namespace {

const std::vector<std::pair<char32_t, char32_t>>& bracketPairs() {
    static const std::vector<std::pair<char32_t, char32_t>> pairs = {
        {0x28, 0x29},     {0xFF08, 0xFF09}, {0x5B, 0x5D},     {0x3010, 0x3011}, {0x7B, 0x7D},     {0x3014, 0x3015},
        {0x3008, 0x3009}, {0x300C, 0x300D}, {0xFF02, 0xFF02}, {0x27, 0x27},     {0x201C, 0x201D}, {0x300A, 0x300B},
        {0x300E, 0x300F}, {0x22, 0x22},     {0x301D, 0x301E}, {0xFE41, 0xFE42}, {0xFE43, 0xFE44}, {0x2E02, 0x2E03},
        {0x2E04, 0x2E05}, {0x2E09, 0x2E0A}, {0x2E0C, 0x2E0D}, {0x2E1C, 0x2E1D}, {0x2E20, 0x2E21}, {0x2039, 0x203A},
        {0xAB, 0xBB},     {0xFF1C, 0xFF1E}, {0x3C, 0x3E},
    };

    return pairs;
}

std::optional<char32_t> closingOf(char32_t character) {
    for (const auto& [left, right] : bracketPairs()) {
        if (left == character) {
            return right;
        }
    }

    return std::nullopt;
}

bool isClosing(char32_t character) {
    return std::any_of(bracketPairs().begin(), bracketPairs().end(),
                       [character](const auto& pair) { return pair.second == character; });
}

// Python's str.isspace, whose whitespace is not C's: U+001C to U+001F and U+0085 count, U+FEFF does not.
bool isPythonSpace(char32_t c) {
    return (c >= 0x09 && c <= 0x0D) || (c >= 0x1C && c <= 0x20) || c == 0x85 || c == 0xA0 || c == 0x1680 ||
           (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000;
}

// Python's str.strip().
std::u32string pythonStrip(const std::u32string& text) {
    size_t start = 0;
    size_t end = text.size();

    while (start < end && isPythonSpace(text[start])) {
        start++;
    }

    while (end > start && isPythonSpace(text[end - 1])) {
        end--;
    }

    return text.substr(start, end - start);
}

// Python's str.isdigit beyond decimal digits: superscripts, circled and parenthesised numbers.
bool isOtherDigit(char32_t c) {
    static const std::vector<std::pair<char32_t, char32_t>> ranges = {
        {0xB2, 0xB3},       {0xB9, 0xB9},       {0x1369, 0x1371},   {0x19DA, 0x19DA},   {0x2070, 0x2070},
        {0x2074, 0x2079},   {0x2080, 0x2089},   {0x2460, 0x2468},   {0x2474, 0x247C},   {0x2488, 0x2490},
        {0x24EA, 0x24EA},   {0x24F5, 0x24FD},   {0x24FF, 0x24FF},   {0x2776, 0x277E},   {0x2780, 0x2788},
        {0x278A, 0x2792},   {0x10A40, 0x10A43}, {0x10E60, 0x10E68}, {0x11052, 0x1105A}, {0x1F100, 0x1F10A},
    };

    return std::any_of(ranges.begin(), ranges.end(), [c](const auto& range) { return c >= range.first && c <= range.second; });
}

bool isAsciiPunctuation(char32_t c) {
    return (c >= 0x21 && c <= 0x2F) || (c >= 0x3A && c <= 0x40) || (c >= 0x5B && c <= 0x60) || (c >= 0x7B && c <= 0x7E);
}

// is_valuable_char: not punctuation, control, whitespace or a digit.
bool isValuableCharacter(char32_t c) {
    const uint32_t category = U_GET_GC_MASK(static_cast<UChar32>(c));
    const bool whitespace = c == U' ' || c == U'\t' || c == U'\n' || c == U'\r' || c == 0 || (category & U_GC_ZS_MASK) != 0;

    return !isAsciiPunctuation(c) && (category & U_GC_P_MASK) == 0 && (category & (U_GC_CC_MASK | U_GC_CF_MASK)) == 0 &&
           !whitespace && (category & U_GC_ND_MASK) == 0 && !isOtherDigit(c);
}

// The langid codes langcodes.tag_distance puts at 0 from each Wenbu target language.
const std::map<std::string, std::string>& sameLanguage() {
    static const std::map<std::string, std::string> languages = {
        {"ENG", "en"}, {"JPN", "ja"}, {"KOR", "ko"}, {"FRA", "fr"}, {"DEU", "de"}, {"ITA", "it"},
        {"POL", "pl"}, {"RUS", "ru"}, {"UKR", "uk"}, {"NLD", "nl"}, {"HUN", "hu"}, {"THA", "th"},
        {"IND", "id"}, {"FIL", "tl"}, {"ARA", "ar"}, {"SRP", "sr"}, {"HRV", "hr"},
    };

    return languages;
}

}

std::string fixBrackets(const std::string& text) {
    const std::u32string characters = pythonStrip(decodeUtf8(text));
    const bool hasBrackets = std::any_of(characters.begin(), characters.end(),
                                         [](char32_t c) { return closingOf(c).has_value() || isClosing(c); });

    if (!hasBrackets) {
        return encodeUtf8(characters);
    }

    std::set<size_t> skip;
    std::vector<size_t> open;

    for (size_t i = 0; i < characters.size(); i++) {
        if (closingOf(characters[i])) {
            open.push_back(i);
        } else if (isClosing(characters[i])) {
            if (!open.empty()) {
                open.pop_back();
            } else {
                skip.insert(i);
            }
        }
    }

    skip.insert(open.begin(), open.end());

    std::vector<char32_t> stack;
    std::u32string result;

    for (size_t i = 0; i < characters.size(); i++) {
        if (skip.contains(i)) {
            continue;
        }

        const char32_t character = characters[i];

        if (closingOf(character)) {
            stack.push_back(character);
            result.push_back(character);
        } else if (isClosing(character)) {
            if (!stack.empty()) {
                result.push_back(*closingOf(stack.back()));
                stack.pop_back();
            }
        } else {
            result.push_back(character);
        }
    }

    return encodeUtf8(pythonStrip(result));
}

bool isValuableText(const std::string& text) {
    const std::u32string characters = decodeUtf8(text);

    return std::any_of(characters.begin(), characters.end(), [](char32_t c) { return isValuableCharacter(c); });
}

LanguageId::LanguageId(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);

    if (!stream) {
        throw std::runtime_error("The language model " + file.string() + " could not be read.");
    }

    const std::vector<char> bytes((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
    size_t offset = 0;

    const auto read = [&](void* target, size_t size) {
        if (offset + size > bytes.size()) {
            throw std::runtime_error("The language model " + file.string() + " is not valid.");
        }

        std::memcpy(target, bytes.data() + offset, size);
        offset += size;
    };

    uint32_t header[4];

    read(header, sizeof(header));
    classes_ = header[0];

    const uint32_t features = header[1];
    const uint32_t states = header[2];
    const uint32_t outputs = header[3];

    for (uint32_t i = 0; i < classes_; i++) {
        char name[2];

        read(name, 2);
        std::string code(name, 2);

        std::erase(code, '\0');
        names_.push_back(code);
    }

    priors_.resize(classes_);
    read(priors_.data(), priors_.size() * sizeof(float));
    weights_.resize(static_cast<size_t>(features) * classes_);
    read(weights_.data(), weights_.size() * sizeof(float));
    nextMove_.resize(static_cast<size_t>(states) * 256);
    read(nextMove_.data(), nextMove_.size() * sizeof(uint16_t));
    outputStart_.resize(static_cast<size_t>(states) + 1);
    read(outputStart_.data(), outputStart_.size() * sizeof(uint32_t));
    outputFeatures_.resize(outputs);
    read(outputFeatures_.data(), outputFeatures_.size() * sizeof(uint32_t));
}

std::string LanguageId::classify(const std::string& text) const {
    std::vector<std::pair<uint32_t, int>> counts;
    std::map<uint32_t, size_t> positions;
    uint32_t state = 0;

    for (const char c : text) {
        state = nextMove_[(static_cast<size_t>(state) << 8) + static_cast<uint8_t>(c)];

        for (uint32_t i = outputStart_[state]; i < outputStart_[state + 1]; i++) {
            const uint32_t feature = outputFeatures_[i];
            const auto [found, inserted] = positions.try_emplace(feature, counts.size());

            if (inserted) {
                counts.emplace_back(feature, 1);
            } else {
                counts[found->second].second++;
            }
        }
    }

    size_t best = 0;
    float bestScore = -std::numeric_limits<float>::infinity();

    for (size_t language = 0; language < classes_; language++) {
        double score = 0;

        for (const auto& [feature, count] : counts) {
            score += count * static_cast<double>(weights_[static_cast<size_t>(feature) * classes_ + language]);
        }

        const float total = static_cast<float>(score) + priors_[language];

        if (total > bestScore) {
            best = language;
            bestScore = total;
        }
    }

    return names_.empty() ? std::string() : names_[best];
}

std::optional<std::string> filteredText(const std::string& text, const std::string& target, const LanguageId& languageId) {
    const std::string fixed = fixBrackets(text);

    if (!isValuableText(fixed)) {
        return std::nullopt;
    }

    const auto same = sameLanguage().find(target);

    if (same != sameLanguage().end() && languageId.classify(fixed) == same->second) {
        return std::nullopt;
    }

    return fixed;
}

}
