#include "Fonts.hpp"

#include <algorithm>
#include <cctype>
#include <cwctype>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <map>
#include <optional>
#include <stdexcept>
#include <vector>

#include <icu.h>

#include "Images.hpp"
#include "LineBreaking.hpp"
#include "Protocol.hpp"
#include "Utf8.hpp"

namespace engine {

namespace {

using Bytes = std::vector<uint8_t>;

const std::map<std::string, std::string> styleFiles = {
    {"regular", "Regular"}, {"bold", "Bold"}, {"italic", "Italic"}, {"bold_italic", "BoldItalic"}};

uint16_t read16(const Bytes& data, size_t at) {
    return static_cast<uint16_t>((data.at(at) << 8) | data.at(at + 1));
}

uint32_t read32(const Bytes& data, size_t at) {
    return (static_cast<uint32_t>(data.at(at)) << 24) | (static_cast<uint32_t>(data.at(at + 1)) << 16) |
           (static_cast<uint32_t>(data.at(at + 2)) << 8) | data.at(at + 3);
}

Bytes readBytes(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);

    return Bytes((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
}

std::wstring environment(const wchar_t* name) {
    wchar_t* value = nullptr;
    size_t length = 0;

    if (_wdupenv_s(&value, &length, name) != 0 || value == nullptr) {
        return {};
    }

    std::wstring text(value);

    std::free(value);

    return text;
}

std::vector<std::filesystem::path> systemFontDirs() {
    const std::wstring windows = environment(L"WINDIR");
    const std::wstring local = environment(L"LOCALAPPDATA");
    std::vector<std::filesystem::path> candidates = {std::filesystem::path(windows.empty() ? L"C:\\Windows" : windows) / "Fonts"};
    std::vector<std::filesystem::path> folders;

    if (!local.empty()) {
        candidates.push_back(std::filesystem::path(local) / "Microsoft" / "Windows" / "Fonts");
    }

    for (const auto& folder : candidates) {
        std::error_code error;

        if (std::filesystem::is_directory(folder, error)) {
            folders.push_back(folder);
        }
    }

    return folders;
}

std::u16string utf16Of(const std::u32string& text) {
    std::u16string out;

    for (const char32_t c : text) {
        if (c >= 0x10000) {
            out.push_back(static_cast<char16_t>(0xD800 + ((c - 0x10000) >> 10)));
            out.push_back(static_cast<char16_t>(0xDC00 + ((c - 0x10000) & 0x3FF)));
        } else {
            out.push_back(static_cast<char16_t>(c));
        }
    }

    return out;
}

// Python's str.casefold, through ICU's full case folding.
std::u16string folded(const std::string& text) {
    const std::u16string source = utf16Of(decodeUtf8(text));
    std::u16string out(source.size() * 3 + 4, u'\0');
    UErrorCode status = U_ZERO_ERROR;
    const int32_t length = u_strFoldCase(reinterpret_cast<UChar*>(out.data()), static_cast<int32_t>(out.size()),
                                         reinterpret_cast<const UChar*>(source.data()), static_cast<int32_t>(source.size()),
                                         U_FOLD_CASE_DEFAULT, &status);

    out.resize(U_SUCCESS(status) ? static_cast<size_t>(length) : 0);

    return out;
}

// Python's str.strip.
std::string stripped(const std::string& text) {
    const std::u32string points = decodeUtf8(text);
    size_t start = 0;
    size_t end = points.size();

    while (start < end && isSpace(points[start])) {
        start++;
    }

    while (end > start && isSpace(points[end - 1])) {
        end--;
    }

    return encodeUtf8(points.substr(start, end - start));
}

std::optional<std::string> styleOf(const std::string& subfamily) {
    std::string lower = subfamily;

    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    const bool bold = lower.find("bold") != std::string::npos;
    const bool italic = lower.find("italic") != std::string::npos || lower.find("oblique") != std::string::npos;

    if (bold && italic) {
        return "bold_italic";
    }

    if (bold) {
        return "bold";
    }

    if (italic) {
        return "italic";
    }

    for (const char* plain : {"regular", "normal", "roman", "book", "medium", ""}) {
        if (lower == plain) {
            return "regular";
        }
    }

    return std::nullopt;
}

// A name record as fontTools' toUnicode reads it: UTF-16BE for Unicode and Windows, Mac Roman read as Latin-1.
std::optional<std::string> nameText(const Bytes& data, size_t at, size_t length, uint16_t platform, uint16_t encoding) {
    if (at + length > data.size()) {
        return std::nullopt;
    }

    std::u32string text;

    if (platform == 0 || platform == 3) {
        for (size_t i = 0; i + 1 < length; i += 2) {
            const char32_t unit = read16(data, at + i);

            if (unit >= 0xD800 && unit <= 0xDBFF && i + 3 < length) {
                const char32_t low = read16(data, at + i + 2);

                text.push_back(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00));
                i += 2;
            } else {
                text.push_back(unit);
            }
        }

        return encodeUtf8(text);
    }

    if (platform == 1 && encoding == 0) {
        for (size_t i = 0; i < length; i++) {
            text.push_back(data[at + i]);
        }

        return encodeUtf8(text);
    }

    return std::nullopt;
}

// getDebugName: the English name for an id, else any readable one.
std::optional<std::string> debugName(const Bytes& data, size_t nameTable, uint16_t id) {
    const uint16_t count = read16(data, nameTable + 2);
    const size_t strings = nameTable + read16(data, nameTable + 4);
    std::optional<std::string> some;

    for (uint16_t i = 0; i < count; i++) {
        const size_t record = nameTable + 6 + static_cast<size_t>(i) * 12;
        const uint16_t platform = read16(data, record);
        const uint16_t encoding = read16(data, record + 2);
        const uint16_t language = read16(data, record + 4);

        if (read16(data, record + 6) != id) {
            continue;
        }

        const std::optional<std::string> text =
            nameText(data, strings + read16(data, record + 10), read16(data, record + 8), platform, encoding);

        if (!text) {
            continue;
        }

        some = text;

        if ((platform == 1 && language == 0) || (platform == 3 && language == 0x409)) {
            return text;
        }
    }

    return some;
}

struct Face {
    int index = 0;
    std::vector<std::string> families;
    std::string subfamily;
};

// The offsets of the faces in a file: one for a font, several for a collection.
std::vector<size_t> faceOffsets(const Bytes& data) {
    if (data.size() >= 12 && read32(data, 0) == 0x74746366) {
        const uint32_t count = read32(data, 8);
        std::vector<size_t> offsets;

        for (uint32_t i = 0; i < count; i++) {
            offsets.push_back(read32(data, 12 + static_cast<size_t>(i) * 4));
        }

        return offsets;
    }

    return {0};
}

std::optional<size_t> tableOf(const Bytes& data, size_t face, uint32_t tag) {
    const uint16_t count = read16(data, face + 4);

    for (uint16_t i = 0; i < count; i++) {
        const size_t record = face + 12 + static_cast<size_t>(i) * 16;

        if (read32(data, record) == tag) {
            return read32(data, record + 8);
        }
    }

    return std::nullopt;
}

std::vector<Face> facesOf(const std::filesystem::path& file) {
    const Bytes data = readBytes(file);
    std::vector<Face> faces;
    const std::vector<size_t> offsets = faceOffsets(data);

    for (size_t index = 0; index < offsets.size(); index++) {
        const std::optional<size_t> name = tableOf(data, offsets[index], 0x6E616D65);
        Face face{static_cast<int>(index), {}, ""};

        if (name) {
            for (const uint16_t id : {uint16_t{16}, uint16_t{1}}) {
                if (const std::optional<std::string> family = debugName(data, *name, id); family && !family->empty()) {
                    face.families.push_back(*family);
                }
            }

            face.subfamily = debugName(data, *name, 17).value_or(debugName(data, *name, 2).value_or(""));

            if (face.subfamily.empty()) {
                face.subfamily = debugName(data, *name, 2).value_or("");
            }
        }

        faces.push_back(face);
    }

    return faces;
}

// A collection's face as a font file of its own: the same tables, laid out after a new directory.
Bytes extractedFace(const Bytes& data, size_t face) {
    const uint16_t count = read16(data, face + 4);
    Bytes out(data.begin() + static_cast<long>(face), data.begin() + static_cast<long>(face) + 12 + count * 16);
    size_t offset = out.size();

    for (uint16_t i = 0; i < count; i++) {
        const size_t record = face + 12 + static_cast<size_t>(i) * 16;
        const uint32_t from = read32(data, record + 8);
        const uint32_t length = read32(data, record + 12);
        const size_t entry = 12 + static_cast<size_t>(i) * 16;

        out.insert(out.end(), data.begin() + from, data.begin() + from + length);
        out.resize((out.size() + 3) & ~static_cast<size_t>(3), 0);

        for (int b = 0; b < 4; b++) {
            out[entry + 8 + b] = static_cast<uint8_t>((offset >> (24 - 8 * b)) & 0xFF);
        }

        offset = out.size();
    }

    return out;
}

std::string pathKey(const std::filesystem::path& file) {
    const std::u8string text = file.u8string();

    return std::string(text.begin(), text.end());
}

long long seconds(std::filesystem::file_time_type time) {
    return std::chrono::duration_cast<std::chrono::seconds>(std::chrono::clock_cast<std::chrono::system_clock>(time).time_since_epoch())
        .count();
}

struct IndexedFace {
    std::string file;
    Face face;
};

std::vector<IndexedFace> indexed(const std::vector<std::filesystem::path>& folders, const std::filesystem::path& cache) {
    const std::filesystem::path indexFile = cache / "index-v2.json";
    Json known = Json::object();

    try {
        std::ifstream stream(indexFile, std::ios::binary);

        if (stream) {
            known = Json::parse(stream);
        }
    } catch (const std::exception&) {
        known = Json::object();
    }

    Json fresh = Json::object();
    std::vector<IndexedFace> faces;

    for (const auto& folder : folders) {
        std::vector<std::filesystem::path> files;
        std::error_code error;

        for (const auto& entry : std::filesystem::directory_iterator(folder, error)) {
            files.push_back(entry.path());
        }

        // Python sorts Windows paths without regard to case.
        std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) {
            return _wcsicmp(a.wstring().c_str(), b.wstring().c_str()) < 0;
        });

        for (const auto& file : files) {
            std::wstring extension = file.extension().wstring();

            std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });

            if (extension != L".ttf" && extension != L".otf" && extension != L".ttc") {
                continue;
            }

            std::error_code statError;
            const auto size = std::filesystem::file_size(file, statError);
            const auto time = std::filesystem::last_write_time(file, statError);
            const std::string key = pathKey(file);
            const std::string stamp = std::to_string(size) + ":" + std::to_string(seconds(time));
            Json entry = known.contains(key) ? known[key] : Json();

            if (!entry.is_object() || entry.value("stamp", "") != stamp) {
                Json listed = Json::array();

                try {
                    for (const Face& face : facesOf(file)) {
                        listed.push_back({face.index, face.families, face.subfamily});
                    }
                } catch (const std::exception&) {
                    listed = Json::array();
                }

                entry = {{"stamp", stamp}, {"faces", listed}};
            }

            fresh[key] = entry;

            for (const auto& face : entry["faces"]) {
                faces.push_back({key, Face{face[0].get<int>(), face[1].get<std::vector<std::string>>(), face[2].get<std::string>()}});
            }
        }
    }

    std::filesystem::create_directories(cache);
    std::ofstream(indexFile, std::ios::binary) << fresh.dump();

    return faces;
}

// re.sub(r"[^\w.-]+", "_", name)
std::string folderName(const std::string& family) {
    const std::u32string points = decodeUtf8(family);
    std::u32string out;
    bool replacing = false;

    for (const char32_t c : points) {
        const bool kept = c == U'.' || c == U'-' || c == U'_' ||
                          (U_GET_GC_MASK(static_cast<UChar32>(c)) & (U_GC_L_MASK | U_GC_N_MASK)) != 0;

        if (kept) {
            out.push_back(c);
            replacing = false;
        } else if (!replacing) {
            out.push_back(U'_');
            replacing = true;
        }
    }

    return encodeUtf8(out);
}

}

std::filesystem::path resolveFont(const std::string& family, const std::filesystem::path& cache) {
    const std::string name = stripped(family);
    const std::u16string wanted = folded(name);
    std::vector<std::pair<std::string, IndexedFace>> styles;

    for (const IndexedFace& face : indexed(systemFontDirs(), cache)) {
        const bool matches = std::any_of(face.face.families.begin(), face.face.families.end(),
                                         [&](const std::string& candidate) { return folded(stripped(candidate)) == wanted; });
        const std::optional<std::string> style = matches ? styleOf(face.face.subfamily) : std::nullopt;

        if (style && std::none_of(styles.begin(), styles.end(), [&](const auto& entry) { return entry.first == *style; })) {
            styles.emplace_back(*style, face);
        }
    }

    if (styles.empty()) {
        throw std::runtime_error("The font \u201c" + family + "\u201d is not installed. Choose another in Settings \u203a Translation \u203a Manga.");
    }

    if (std::none_of(styles.begin(), styles.end(), [](const auto& entry) { return entry.first == "regular"; })) {
        styles.emplace_back("regular", styles.front().second);
    }

    const std::filesystem::path target = cache / pathOf(folderName(name));

    std::filesystem::create_directories(target);

    for (const auto& [style, face] : styles) {
        const std::filesystem::path source = pathOf(face.file);
        std::wstring extension = source.extension().wstring();

        std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });

        const std::filesystem::path destination = target / (styleFiles.at(style) + (extension == L".otf" ? ".otf" : ".ttf"));
        std::error_code error;

        if (std::filesystem::exists(destination, error) &&
            std::filesystem::last_write_time(destination, error) >= std::filesystem::last_write_time(source, error)) {
            continue;
        }

        if (extension == L".ttc") {
            const Bytes data = readBytes(source);

            writeAtomically(destination, extractedFace(data, faceOffsets(data).at(static_cast<size_t>(face.face.index))));
        } else {
            std::filesystem::copy_file(source, destination, std::filesystem::copy_options::overwrite_existing);
        }
    }

    return target;
}

}
