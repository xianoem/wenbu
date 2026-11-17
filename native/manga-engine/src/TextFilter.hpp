// The plugin's text filters after reading (manga_translator.py, _run_textline_merge): unpaired brackets
// are dropped and mismatched ones fixed, then a block is skipped when nothing in it is worth translating
// or when langid says it is already in the target language.
#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace engine {

// The bracket repair: unpaired brackets go, a closing bracket of the wrong kind is replaced.
std::string fixBrackets(const std::string& text);

// is_valuable_text: something in it is not punctuation, control, whitespace or a digit.
bool isValuableText(const std::string& text);

// py3langid's naive Bayes classifier over byte n-grams, read from the exported model file.
class LanguageId {
public:
    explicit LanguageId(const std::filesystem::path& file);

    std::string classify(const std::string& text) const;

private:
    uint32_t classes_ = 0;
    std::vector<std::string> names_;
    std::vector<float> priors_;
    std::vector<float> weights_;
    std::vector<uint16_t> nextMove_;
    std::vector<uint32_t> outputStart_;
    std::vector<uint32_t> outputFeatures_;
};

// The text a block keeps after the plugin's filters, or nothing when the block is dropped.
std::optional<std::string> filteredText(const std::string& text, const std::string& target, const LanguageId& languageId);

}
