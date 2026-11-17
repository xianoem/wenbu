// UTF-8 to code points and back. Invalid bytes become U+FFFD one maximal subpart at a time, as Rust's
// String::from_utf8_lossy (which HuggingFace tokenizers use) and the WHATWG decoder do.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace engine {

std::u32string decodeUtf8(std::string_view bytes);

std::string encodeUtf8(std::u32string_view text);

}
