#include "Utf8.hpp"

namespace engine {

std::u32string decodeUtf8(std::string_view bytes) {
    constexpr char32_t replacement = 0xFFFD;
    std::u32string text;
    char32_t point = 0;
    int needed = 0;
    int seen = 0;
    uint8_t lower = 0x80;
    uint8_t upper = 0xBF;

    for (size_t i = 0; i < bytes.size(); i++) {
        const uint8_t byte = static_cast<uint8_t>(bytes[i]);

        if (needed == 0) {
            if (byte <= 0x7F) {
                text.push_back(byte);
            } else if (byte >= 0xC2 && byte <= 0xDF) {
                needed = 1;
                point = byte & 0x1F;
            } else if (byte >= 0xE0 && byte <= 0xEF) {
                lower = byte == 0xE0 ? 0xA0 : 0x80;
                upper = byte == 0xED ? 0x9F : 0xBF;
                needed = 2;
                point = byte & 0x0F;
            } else if (byte >= 0xF0 && byte <= 0xF4) {
                lower = byte == 0xF0 ? 0x90 : 0x80;
                upper = byte == 0xF4 ? 0x8F : 0xBF;
                needed = 3;
                point = byte & 0x07;
            } else {
                text.push_back(replacement);
            }

            continue;
        }

        if (byte < lower || byte > upper) {
            point = 0;
            needed = 0;
            seen = 0;
            lower = 0x80;
            upper = 0xBF;
            text.push_back(replacement);
            i--;

            continue;
        }

        lower = 0x80;
        upper = 0xBF;
        point = (point << 6) | (byte & 0x3F);
        seen++;

        if (seen == needed) {
            text.push_back(point);
            point = 0;
            needed = 0;
            seen = 0;
        }
    }

    if (needed != 0) {
        text.push_back(replacement);
    }

    return text;
}

std::string encodeUtf8(std::u32string_view text) {
    std::string bytes;

    for (const char32_t point : text) {
        if (point < 0x80) {
            bytes.push_back(static_cast<char>(point));
        } else if (point < 0x800) {
            bytes.push_back(static_cast<char>(0xC0 | (point >> 6)));
            bytes.push_back(static_cast<char>(0x80 | (point & 0x3F)));
        } else if (point < 0x10000) {
            bytes.push_back(static_cast<char>(0xE0 | (point >> 12)));
            bytes.push_back(static_cast<char>(0x80 | ((point >> 6) & 0x3F)));
            bytes.push_back(static_cast<char>(0x80 | (point & 0x3F)));
        } else {
            bytes.push_back(static_cast<char>(0xF0 | (point >> 18)));
            bytes.push_back(static_cast<char>(0x80 | ((point >> 12) & 0x3F)));
            bytes.push_back(static_cast<char>(0x80 | ((point >> 6) & 0x3F)));
            bytes.push_back(static_cast<char>(0x80 | (point & 0x3F)));
        }
    }

    return bytes;
}

}
