#include "Tokenizer.hpp"

#include <fstream>
#include <map>
#include <stdexcept>

#include "Protocol.hpp"
#include "Utf8.hpp"

namespace engine {

namespace {

// GPT-2's bytes_to_unicode, reversed: each printable stand-in character back to its byte.
const std::map<char32_t, uint8_t>& byteOfCharacter() {
    static const std::map<char32_t, uint8_t> table = [] {
        std::map<char32_t, uint8_t> built;
        char32_t shifted = 0;

        for (int byte = 0; byte < 256; byte++) {
            const bool printable =
                (byte >= 0x21 && byte <= 0x7e) || (byte >= 0xa1 && byte <= 0xac) || (byte >= 0xae && byte <= 0xff);

            if (printable) {
                built[static_cast<char32_t>(byte)] = static_cast<uint8_t>(byte);
            } else {
                built[256 + shifted] = static_cast<uint8_t>(byte);
                shifted++;
            }
        }

        return built;
    }();

    return table;
}

}

Tokenizer::Tokenizer(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);

    if (!stream) {
        throw std::runtime_error("The reader's tokenizer " + file.string() + " could not be read.");
    }

    const Json parsed = Json::parse(stream);

    for (const auto& [token, id] : parsed.at("model").at("vocab").items()) {
        tokens_[id.get<int64_t>()] = decodeUtf8(token);
    }

    for (const auto& added : parsed.at("added_tokens")) {
        const int64_t id = added.at("id").get<int64_t>();

        tokens_[id] = decodeUtf8(added.at("content").get<std::string>());

        if (added.at("special").get<bool>()) {
            special_.insert(id);
        }
    }
}

std::string Tokenizer::decode(const std::vector<int64_t>& ids) const {
    const auto& table = byteOfCharacter();
    std::string bytes;

    for (const int64_t id : ids) {
        if (special_.contains(id)) {
            continue;
        }

        const auto token = tokens_.find(id);

        if (token == tokens_.end()) {
            continue;
        }

        for (const char32_t character : token->second) {
            if (const auto byte = table.find(character); byte != table.end()) {
                bytes.push_back(static_cast<char>(byte->second));
            }
        }
    }

    return encodeUtf8(decodeUtf8(bytes));
}

}
