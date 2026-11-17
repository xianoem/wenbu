#include "LetterFonts.hpp"

#include <algorithm>
#include <cmath>
#include <cwctype>
#include <set>
#include <string>

namespace engine {

namespace {

const std::vector<std::wstring> boldWords = {L"bold", L"heavy", L"black"};
const std::vector<std::wstring> italicWords = {L"italic", L"oblique", L"slanted", L"inclined"};
const std::vector<std::wstring> regularWords = {L"regular", L"normal", L"roman", L"medium"};
const std::vector<std::wstring> specificWords = {L"light", L"thin",  L"condensed", L"expanded", L"semi",  L"demi",
                                                 L"extra", L"ultra", L"book",      L"medium",   L"black", L"heavy"};

std::wstring lower(std::wstring text) {
    std::transform(text.begin(), text.end(), text.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });

    return text;
}

bool has(const std::wstring& text, const std::vector<std::wstring>& words) {
    return std::any_of(words.begin(), words.end(), [&](const std::wstring& word) { return text.find(word) != std::wstring::npos; });
}

uint16_t read16(const std::vector<uint8_t>& data, size_t at) {
    return static_cast<uint16_t>((data[at] << 8) | data[at + 1]);
}

int16_t readSigned16(const std::vector<uint8_t>& data, size_t at) {
    return static_cast<int16_t>(read16(data, at));
}

uint32_t read32(const std::vector<uint8_t>& data, size_t at) {
    return (static_cast<uint32_t>(data[at]) << 24) | (static_cast<uint32_t>(data[at + 1]) << 16) |
           (static_cast<uint32_t>(data[at + 2]) << 8) | data[at + 3];
}

void write16(std::vector<uint8_t>& data, size_t at, uint16_t value) {
    data[at] = static_cast<uint8_t>(value >> 8);
    data[at + 1] = static_cast<uint8_t>(value & 0xFF);
}

struct TableEntry {
    std::string tag;
    uint32_t offset;
    uint32_t length;
    size_t record;
};

std::vector<TableEntry> tablesOf(const std::vector<uint8_t>& data) {
    std::vector<TableEntry> tables;
    const uint16_t count = read16(data, 4);

    for (uint16_t index = 0; index < count; index++) {
        const size_t record = 12 + static_cast<size_t>(index) * 16;

        tables.push_back({std::string(data.begin() + static_cast<long>(record), data.begin() + static_cast<long>(record) + 4),
                          read32(data, record + 8), read32(data, record + 12), record});
    }

    return tables;
}

const TableEntry* find(const std::vector<TableEntry>& tables, const char* tag) {
    const auto found = std::find_if(tables.begin(), tables.end(), [tag](const TableEntry& table) { return table.tag == tag; });

    return found == tables.end() ? nullptr : &*found;
}

// A copy of the font with the table directory entry for `tag` left out; table data stays where it was.
std::vector<uint8_t> withoutTable(const std::vector<uint8_t>& data, const char* tag) {
    const std::vector<TableEntry> tables = tablesOf(data);
    std::vector<TableEntry> kept;

    std::copy_if(tables.begin(), tables.end(), std::back_inserter(kept), [tag](const TableEntry& table) { return table.tag != tag; });

    std::vector<uint8_t> out = data;
    const uint16_t power = static_cast<uint16_t>(1u << static_cast<unsigned>(std::floor(std::log2(std::max<size_t>(1, kept.size())))));

    write16(out, 4, static_cast<uint16_t>(kept.size()));
    write16(out, 6, static_cast<uint16_t>(power * 16));
    write16(out, 8, static_cast<uint16_t>(std::log2(power)));
    write16(out, 10, static_cast<uint16_t>(kept.size() * 16 - power * 16));

    for (size_t index = 0; index < kept.size(); index++) {
        std::copy(data.begin() + static_cast<long>(kept[index].record), data.begin() + static_cast<long>(kept[index].record) + 16,
                  out.begin() + 12 + static_cast<long>(index) * 16);
    }

    return out;
}

}

std::map<Style, std::filesystem::path> fontVariants(const std::vector<std::filesystem::path>& files) {
    std::vector<std::filesystem::path> ordered = files;
    std::map<Style, std::filesystem::path> found;
    std::set<std::filesystem::path> taken;

    std::stable_sort(ordered.begin(), ordered.end(), [](const auto& a, const auto& b) {
        return a.filename().wstring().size() > b.filename().wstring().size();
    });

    const auto stemOf = [](const std::filesystem::path& file) { return lower(file.stem().wstring()); };

    const auto take = [&](Style style, const std::filesystem::path& file) {
        found[style] = file;
        taken.insert(file);
    };

    for (const auto& file : ordered) {
        const std::wstring stem = stemOf(file);

        if (!taken.contains(file) && has(stem, boldWords) && has(stem, italicWords) && !found.contains(Style::BoldItalic)) {
            take(Style::BoldItalic, file);
        }
    }

    for (const auto& file : ordered) {
        const std::wstring stem = stemOf(file);
        const bool bold = has(stem, boldWords);
        const bool italic = has(stem, italicWords);

        if (taken.contains(file)) {
            continue;
        }

        if (bold && !italic && !found.contains(Style::Bold)) {
            take(Style::Bold, file);
        } else if (italic && !bold && !found.contains(Style::Italic)) {
            take(Style::Italic, file);
        }
    }

    for (const auto& file : ordered) {
        const std::wstring stem = stemOf(file);

        if (!taken.contains(file) && has(stem, regularWords) && !has(stem, boldWords) && !has(stem, italicWords) &&
            !found.contains(Style::Regular)) {
            take(Style::Regular, file);
        }
    }

    if (!found.contains(Style::Regular)) {
        for (const auto& file : ordered) {
            const std::wstring stem = stemOf(file);

            if (!taken.contains(file) && !has(stem, boldWords) && !has(stem, italicWords) && !has(stem, regularWords) &&
                !has(lower(file.filename().wstring()), specificWords)) {
                take(Style::Regular, file);

                break;
            }
        }
    }

    if (!found.contains(Style::Regular)) {
        for (const auto& file : ordered) {
            if (!taken.contains(file)) {
                take(Style::Regular, file);

                break;
            }
        }
    }

    if (!found.contains(Style::Regular)) {
        for (const Style backup : {Style::Bold, Style::Italic, Style::BoldItalic}) {
            if (found.contains(backup)) {
                found[Style::Regular] = found[backup];

                break;
            }
        }

        if (!found.contains(Style::Regular) && !ordered.empty()) {
            found[Style::Regular] = ordered[0];
        }
    }

    return found;
}

std::vector<uint8_t> sanitizedFont(const std::vector<uint8_t>& data, const GlyphMetrics& metrics) {
    const std::vector<TableEntry> tables = tablesOf(data);
    const TableEntry* head = find(tables, "head");
    std::vector<uint8_t> out = find(tables, "kern") != nullptr ? withoutTable(data, "kern") : data;

    if (head == nullptr || !metrics.glyphOfM || find(tables, "glyf") == nullptr) {
        return out;
    }

    const bool italic = (read16(data, head->offset + 44) & 0b10) != 0;
    const std::optional<int> xMax = metrics.xMax(*metrics.glyphOfM);

    if (xMax && *xMax > metrics.advance(*metrics.glyphOfM) * (italic ? 1.3 : 1)) {
        write16(out, head->offset + 18, 1000);
    }

    return out;
}

LineMetrics lineMetrics(const std::vector<uint8_t>& data, double size) {
    const std::vector<TableEntry> tables = tablesOf(data);
    const TableEntry* head = find(tables, "head");
    const TableEntry* os2 = find(tables, "OS/2");
    const TableEntry* hhea = find(tables, "hhea");
    const double unitsPerEm = head == nullptr ? 1000 : read16(data, head->offset + 18);

    const auto scaled = [&](int units) {
        const float product = static_cast<float>(size * units);

        return static_cast<double>(static_cast<float>(product / unitsPerEm));
    };

    if (os2 != nullptr) {
        if ((read16(data, os2->offset + 62) & 0x80) != 0) {
            return {-scaled(readSigned16(data, os2->offset + 68)), scaled(-readSigned16(data, os2->offset + 70)),
                    scaled(readSigned16(data, os2->offset + 72))};
        }

        return {-scaled(read16(data, os2->offset + 74)), scaled(read16(data, os2->offset + 76)), 0};
    }

    if (hhea == nullptr) {
        return {-size, 0, 0};
    }

    return {-scaled(readSigned16(data, hhea->offset + 4)), scaled(-readSigned16(data, hhea->offset + 6)),
            scaled(readSigned16(data, hhea->offset + 8))};
}

}
