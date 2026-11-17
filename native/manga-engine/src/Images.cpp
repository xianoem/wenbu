#include "Images.hpp"

#include <array>
#include <cmath>
#include <cstring>
#include <fstream>
#include <optional>
#include <stdexcept>

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <png.h>

namespace engine {

namespace {

using Bytes = std::vector<uint8_t>;

[[noreturn]] void fail(const std::string& message) {
    throw std::runtime_error(message);
}

std::string nameOf(const std::filesystem::path& file) {
    const std::u8string name = file.u8string();

    return std::string(name.begin(), name.end());
}

Bytes readFile(const std::filesystem::path& file) {
    std::ifstream stream(file, std::ios::binary);

    if (!stream) {
        fail("The page " + nameOf(file) + " could not be read.");
    }

    return Bytes(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}

// Pillow's paste onto white through an alpha mask: DIV255(white * (255 - a) + value * a).
uint8_t onWhite(int value, int alpha) {
    const int tmp = 255 * (255 - alpha) + value * alpha + 128;

    return static_cast<uint8_t>(((tmp >> 8) + tmp) >> 8);
}

bool isPng(const Bytes& bytes) {
    return bytes.size() > 8 && bytes[0] == 0x89 && bytes[1] == 'P' && bytes[2] == 'N';
}

struct PngReader {
    const Bytes& bytes;
    size_t offset = 8;
};

void readChunk(png_structp png, png_bytep target, png_size_t size) {
    auto* reader = static_cast<PngReader*>(png_get_io_ptr(png));

    if (reader->offset + size > reader->bytes.size()) {
        png_error(png, "truncated");
    }

    std::memcpy(target, reader->bytes.data() + reader->offset, size);
    reader->offset += size;
}

// A decoded page as Pillow's convert('RGBA') gives it, and the mode Pillow opened it in.
enum class Mode { Grey, GreyAlpha, Palette, Rgb, Rgba };

struct Decoded {
    int width = 0;
    int height = 0;
    Bytes rgba;
    Mode mode = Mode::Rgb;
};

// PNG through libpng: palette entries with tRNS alpha, grey below 8 bits scaled to 0..255, 16-bit samples
// keeping the high byte.
Decoded decodePng(const Bytes& bytes, const std::string& name) {
    png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, nullptr, nullptr, nullptr);
    png_infop info = png_create_info_struct(png);
    PngReader reader{bytes};

    if (setjmp(png_jmpbuf(png))) {
        png_destroy_read_struct(&png, &info, nullptr);
        fail("The page " + name + " is not a readable PNG.");
    }

    png_set_read_fn(png, &reader, readChunk);
    png_set_sig_bytes(png, 8);
    png_read_info(png, info);

    const int width = static_cast<int>(png_get_image_width(png, info));
    const int height = static_cast<int>(png_get_image_height(png, info));
    const int depth = png_get_bit_depth(png, info);
    const int colourType = png_get_color_type(png, info);
    const int channels = png_get_channels(png, info);

    png_set_interlace_handling(png);
    png_read_update_info(png, info);

    const size_t rowBytes = png_get_rowbytes(png, info);
    Bytes raw(rowBytes * height);
    std::vector<png_bytep> rows(height);

    for (int y = 0; y < height; ++y) {
        rows[y] = raw.data() + rowBytes * y;
    }

    png_read_image(png, rows.data());

    std::array<std::array<uint8_t, 4>, 256> palette{};

    if (colourType == PNG_COLOR_TYPE_PALETTE) {
        png_colorp entries = nullptr;
        int count = 0;

        png_get_PLTE(png, info, &entries, &count);

        for (int index = 0; index < count && index < 256; ++index) {
            palette[index] = {entries[index].red, entries[index].green, entries[index].blue, 255};
        }

        png_bytep alphas = nullptr;
        int alphaCount = 0;

        if (png_get_tRNS(png, info, &alphas, &alphaCount, nullptr) != 0) {
            for (int index = 0; index < alphaCount && index < 256; ++index) {
                palette[index][3] = alphas[index];
            }
        }
    }

    png_destroy_read_struct(&png, &info, nullptr);

    Decoded image{width, height, Bytes(static_cast<size_t>(width) * height * 4), Mode::Rgb};

    if (colourType == PNG_COLOR_TYPE_PALETTE) {
        image.mode = Mode::Palette;
    } else if (channels == 1) {
        image.mode = Mode::Grey;
    } else if (channels == 2) {
        image.mode = Mode::GreyAlpha;
    } else if (channels == 4) {
        image.mode = Mode::Rgba;
    }

    const auto packed = [&](int x, int y) {
        const int bit = x * depth;
        const uint8_t byte = raw[rowBytes * y + bit / 8];

        return (byte >> (8 - depth - bit % 8)) & ((1 << depth) - 1);
    };

    // 16-bit samples are big-endian, so the high byte comes first.
    const auto sample = [&](int y, int index) { return raw[rowBytes * y + (depth == 16 ? index * 2 : index)]; };

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            uint8_t* out = &image.rgba[(static_cast<size_t>(y) * width + x) * 4];

            if (image.mode == Mode::Palette) {
                std::memcpy(out, palette[depth < 8 ? packed(x, y) : sample(y, x)].data(), 4);

                continue;
            }

            if (channels < 3) {
                const int grey = depth < 8 ? static_cast<int>(std::lround(packed(x, y) * 255.0 / ((1 << depth) - 1)))
                                           : sample(y, x * channels);

                out[0] = out[1] = out[2] = static_cast<uint8_t>(grey);
                out[3] = channels == 2 ? sample(y, x * channels + 1) : 255;

                continue;
            }

            for (int c = 0; c < 3; ++c) {
                out[c] = sample(y, x * channels + c);
            }

            out[3] = channels == 4 ? sample(y, x * channels + 3) : 255;
        }
    }

    return image;
}

// JPEG through libjpeg-turbo and WebP through libwebp, as Pillow decodes them.
Decoded decodeOther(const Bytes& bytes, const std::string& name) {
    const cv::Mat buffer(1, static_cast<int>(bytes.size()), CV_8UC1, const_cast<uint8_t*>(bytes.data()));
    const cv::Mat decoded = cv::imdecode(buffer, cv::IMREAD_UNCHANGED | cv::IMREAD_IGNORE_ORIENTATION);

    if (decoded.empty() || decoded.depth() != CV_8U) {
        fail("The page " + name + " could not be decoded.");
    }

    const int channels = decoded.channels();
    Decoded image{decoded.cols, decoded.rows, Bytes(static_cast<size_t>(decoded.cols) * decoded.rows * 4), Mode::Rgb};

    if (channels == 1) {
        image.mode = Mode::Grey;
    } else if (channels == 4) {
        image.mode = Mode::Rgba;
    }

    for (int y = 0; y < decoded.rows; ++y) {
        const uint8_t* row = decoded.ptr<uint8_t>(y);

        for (int x = 0; x < decoded.cols; ++x) {
            uint8_t* out = &image.rgba[(static_cast<size_t>(y) * decoded.cols + x) * 4];
            const uint8_t* in = row + x * channels;

            if (channels == 1) {
                out[0] = out[1] = out[2] = in[0];
                out[3] = 255;

                continue;
            }

            // OpenCV hands back BGR or BGRA.
            out[0] = in[2];
            out[1] = in[1];
            out[2] = in[0];
            out[3] = channels == 4 ? in[3] : 255;
        }
    }

    return image;
}

Decoded decode(const std::filesystem::path& file) {
    const Bytes bytes = readFile(file);
    const std::string name = nameOf(file);

    return isPng(bytes) ? decodePng(bytes, name) : decodeOther(bytes, name);
}

// load_image keeps transparency for RGBA and palette pages only; grey with alpha goes through convert('RGB').
bool keepsAlpha(Mode mode) {
    return mode == Mode::Rgba || mode == Mode::Palette;
}

Rgb rgbOf(const Decoded& image, Alpha alphaMode) {
    const size_t pixels = static_cast<size_t>(image.width) * image.height;
    Rgb rgb{image.width, image.height, Bytes(pixels * 3)};
    const bool composite = alphaMode == Alpha::White && keepsAlpha(image.mode);

    for (size_t p = 0; p < pixels; ++p) {
        const int alpha = composite ? image.rgba[p * 4 + 3] : 255;

        for (int c = 0; c < 3; ++c) {
            rgb.data[p * 3 + c] = onWhite(image.rgba[p * 4 + c], alpha);
        }
    }

    return rgb;
}

}

std::filesystem::path pathOf(const std::string& utf8) {
    return std::filesystem::path(std::u8string(utf8.begin(), utf8.end()));
}

Rgb readPage(const std::filesystem::path& file, Alpha alpha) {
    return rgbOf(decode(file), alpha);
}

PageWithAlpha readPageWithAlpha(const std::filesystem::path& file) {
    const Decoded image = decode(file);
    PageWithAlpha page{rgbOf(image, Alpha::White), std::nullopt};

    if (keepsAlpha(image.mode)) {
        page.original = Rgba{image.width, image.height, image.rgba};
    }

    return page;
}

Rgba readRgba(const std::filesystem::path& file) {
    Decoded image = decode(file);

    return {image.width, image.height, std::move(image.rgba)};
}

Rgba restoredAlpha(const Rgba& original, const Rgb& page) {
    Rgba result{page.width, page.height, Bytes(static_cast<size_t>(page.width) * page.height * 4)};

    // dump_image: the page pasted over the original through its alpha, as Pillow's paste blends every band.
    const auto blend = [](int in, int out, int mask) {
        const int tmp = (in - out) * mask + 128;

        return static_cast<uint8_t>(out + (((tmp >> 8) + tmp) >> 8));
    };

    for (size_t p = 0; p < static_cast<size_t>(page.width) * page.height; ++p) {
        const uint8_t alpha = original.data[p * 4 + 3];

        for (int c = 0; c < 3; ++c) {
            result.data[p * 4 + c] = blend(page.data[p * 3 + c], original.data[p * 4 + c], alpha);
        }

        result.data[p * 4 + 3] = alpha;
    }

    return result;
}

// PNG at zlib level 1, JPEG with full-resolution colour, or WebP, lossless at quality 100, of BGR or BGRA.
void encodeAndSave(const std::filesystem::path& file, const cv::Mat& pixels, PageFormat format, int quality) {
    std::vector<int> parameters;
    std::string extension;

    switch (format) {
    case PageFormat::Png:
        extension = ".png";
        parameters = {cv::IMWRITE_PNG_COMPRESSION, 1};
        break;
    case PageFormat::Jpeg:
        extension = ".jpg";
        parameters = {cv::IMWRITE_JPEG_QUALITY, quality, cv::IMWRITE_JPEG_SAMPLING_FACTOR,
                      cv::IMWRITE_JPEG_SAMPLING_FACTOR_444};
        break;
    case PageFormat::Webp:
        extension = ".webp";
        // Above 100, OpenCV encodes lossless, as Pillow does at quality 100.
        parameters = {cv::IMWRITE_WEBP_QUALITY, quality >= 100 ? 101 : quality};
        break;
    }

    Bytes encoded;

    if (!cv::imencode(extension, pixels, encoded, parameters)) {
        fail("The page could not be encoded.");
    }

    writeAtomically(file, encoded);
}

void savePage(const std::filesystem::path& file, const Rgb& image, PageFormat format, int quality) {
    cv::Mat bgr;

    cv::cvtColor(cv::Mat(image.height, image.width, CV_8UC3, const_cast<uint8_t*>(image.data.data())), bgr, cv::COLOR_RGB2BGR);
    encodeAndSave(file, bgr, format, quality);
}

void saveRgba(const std::filesystem::path& file, const Rgba& image, PageFormat format, int quality) {
    const cv::Mat rgba(image.height, image.width, CV_8UC4, const_cast<uint8_t*>(image.data.data()));
    cv::Mat converted;

    cv::cvtColor(rgba, converted, format == PageFormat::Jpeg ? cv::COLOR_RGBA2BGR : cv::COLOR_RGBA2BGRA);
    encodeAndSave(file, converted, format, quality);
}

void saveGrey(const std::filesystem::path& file, int width, int height, const std::vector<uint8_t>& data) {
    const cv::Mat grey(height, width, CV_8UC1, const_cast<uint8_t*>(data.data()));
    Bytes encoded;

    if (!cv::imencode(".png", grey, encoded, {cv::IMWRITE_PNG_COMPRESSION, 1})) {
        fail("The mask could not be encoded.");
    }

    writeAtomically(file, encoded);
}

void writeAtomically(const std::filesystem::path& file, const std::vector<uint8_t>& encoded) {
    std::filesystem::create_directories(file.parent_path());

    std::filesystem::path partial = file;

    partial += ".partial";

    {
        std::ofstream stream(partial, std::ios::binary | std::ios::trunc);

        stream.write(reinterpret_cast<const char*>(encoded.data()), static_cast<std::streamsize>(encoded.size()));

        if (!stream) {
            fail("The page could not be saved.");
        }
    }

    std::filesystem::rename(partial, file);
}

}
