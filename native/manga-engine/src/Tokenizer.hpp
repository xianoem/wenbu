// Decoding for the Hayai reader's byte-level BPE tokenizer (tokenizer.json, HuggingFace tokenizers):
// special tokens are skipped, the rest map back from GPT-2's byte-to-character table to UTF-8.
#pragma once

#include <cstdint>
#include <filesystem>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

namespace engine {

class Tokenizer {
public:
    explicit Tokenizer(const std::filesystem::path& file);

    std::string decode(const std::vector<int64_t>& ids) const;

private:
    std::unordered_map<int64_t, std::u32string> tokens_;
    std::set<int64_t> special_;
};

}
