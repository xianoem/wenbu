// Pages in and out, read the way the manga worker's load_image reads them and saved the way its
// save_page saves them.
#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace engine {

// Packed 8-bit RGB, row-major.
struct Rgb {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> data;
};

// What happens to transparency: White composites onto white as load_image does for pages, Dropped
// discards it as Pillow's convert('RGB') does for masks and brush strokes.
enum class Alpha { White, Dropped };

enum class PageFormat { Png, Jpeg, Webp };

// Packed 8-bit RGBA, row-major.
struct Rgba {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> data;
};

struct PageWithAlpha {
    Rgb rgb;
    // The page as convert('RGBA') gives it, for RGBA and palette pages, whose transparency load_image keeps.
    std::optional<Rgba> original;
};

// Reads a JPEG, PNG or WebP page. Throws std::runtime_error with a message for the user.
Rgb readPage(const std::filesystem::path& file, Alpha alpha = Alpha::White);

// load_image: the page on white, and its alpha when it has one.
PageWithAlpha readPageWithAlpha(const std::filesystem::path& file);

// Pillow's convert('RGBA').
Rgba readRgba(const std::filesystem::path& file);

// dump_image: a processed page pasted over the original through the original's alpha, so transparency
// survives a run.
Rgba restoredAlpha(const Rgba& original, const Rgb& page);

// RGBA as PNG or WebP; JPEG drops the alpha, as Pillow's convert('RGB') does.
void saveRgba(const std::filesystem::path& file, const Rgba& image, PageFormat format, int quality);

// Encodes as PNG (zlib level 1), JPEG (full-resolution colour) or WebP (lossless at quality 100), and
// writes through a .partial file so a reader never sees half a page.
void savePage(const std::filesystem::path& file, const Rgb& image, PageFormat format, int quality);

// One grey channel as PNG (zlib level 1), as the editor reads masks.
void saveGrey(const std::filesystem::path& file, int width, int height, const std::vector<uint8_t>& data);

// Writes through a .partial file so a reader never sees half a file.
void writeAtomically(const std::filesystem::path& file, const std::vector<uint8_t>& encoded);

// A path from the protocol's UTF-8 strings.
std::filesystem::path pathOf(const std::string& utf8);

}
