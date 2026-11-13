#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
using LibraryHandle = HMODULE;
#else
#include <dlfcn.h>
using LibraryHandle = void *;
#endif

namespace
{

struct SkColorInfo
{
    void *colorSpace;
    int32_t colorType;
    int32_t alphaType;
};

struct SkISize
{
    int32_t width;
    int32_t height;
};

struct SkImageInfo
{
    SkColorInfo colorInfo;
    SkISize dimensions;
};

struct SkPixmap
{
    void *pixels;
    size_t rowBytes;
    SkImageInfo info;
};

struct SkBitmap
{
    void *pixelRef;
    SkPixmap pixmap;
    uint32_t flags;
};

constexpr int32_t kRGBA8888 = 4;
constexpr int32_t kOpaque = 1;

using GetFileContentSize = uint32_t (*)(const char *);
using GetFileContent = void (*)(const char *, uint32_t, void *);
using SetFileContentFunctions = void (*)(GetFileContentSize, GetFileContent);
using InitOCRUsingCallback = bool (*)();
using SetOCRLightMode = void (*)(bool);
using GetMaxImageDimension = uint32_t (*)();
using GetLibraryVersion = void (*)(uint32_t *, uint32_t *);
using PerformOCR = void *(*)(const SkBitmap *, uint32_t *);
using FreeLibraryAllocatedCharArray = void (*)(void *);

std::filesystem::path resourceDir;

uint32_t fileContentSize(const char *relativePath)
{
    std::error_code error;
    const auto size = std::filesystem::file_size(resourceDir / std::filesystem::u8path(relativePath), error);

    return error ? 0 : static_cast<uint32_t>(size);
}

void fileContent(const char *relativePath, uint32_t size, void *target)
{
    std::ifstream input(resourceDir / std::filesystem::u8path(relativePath), std::ios::binary);

    if (input && target != nullptr)
    {
        input.read(static_cast<char *>(target), size);
    }
}

std::string jsonString(const std::string &value)
{
    std::string output = "\"";

    for (const unsigned char ch : value)
    {
        if (ch == '"' || ch == '\\')
        {
            output += '\\';
            output += static_cast<char>(ch);
        }
        else if (ch < 0x20)
        {
            char escaped[8];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", ch);
            output += escaped;
        }
        else
        {
            output += static_cast<char>(ch);
        }
    }

    return output + "\"";
}

std::string base64(const uint8_t *data, size_t length)
{
    static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string output;
    output.reserve((length + 2) / 3 * 4);

    for (size_t index = 0; index < length; index += 3)
    {
        const uint32_t a = data[index];
        const uint32_t b = index + 1 < length ? data[index + 1] : 0;
        const uint32_t c = index + 2 < length ? data[index + 2] : 0;
        const uint32_t triple = (a << 16) | (b << 8) | c;

        output += alphabet[(triple >> 18) & 0x3F];
        output += alphabet[(triple >> 12) & 0x3F];
        output += index + 1 < length ? alphabet[(triple >> 6) & 0x3F] : '=';
        output += index + 2 < length ? alphabet[triple & 0x3F] : '=';
    }

    return output;
}

void reply(const std::string &json)
{
    std::cout << json << '\n' << std::flush;
}

void replyError(const std::string &message)
{
    reply("{\"error\":" + jsonString(message) + "}");
}

LibraryHandle openLibrary()
{
#ifdef _WIN32
    SetDllDirectoryW(resourceDir.wstring().c_str());
    return LoadLibraryW((resourceDir / L"chrome_screen_ai.dll").wstring().c_str());
#else
    return dlopen((resourceDir / "libchromescreenai.so").string().c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
}

template <typename Function>
Function symbol(LibraryHandle library, const char *name)
{
#ifdef _WIN32
    return reinterpret_cast<Function>(GetProcAddress(library, name));
#else
    return reinterpret_cast<Function>(dlsym(library, name));
#endif
}

bool readExactly(void *target, size_t size)
{
    std::cin.read(static_cast<char *>(target), static_cast<std::streamsize>(size));

    return static_cast<size_t>(std::cin.gcount()) == size;
}

uint32_t littleEndian(const uint8_t *bytes)
{
    return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (static_cast<uint32_t>(bytes[3]) << 24);
}

}

int main(int argc, char **argv)
{
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    for (int index = 1; index + 1 < argc; ++index)
    {
        if (std::string(argv[index]) == "--resources")
        {
            resourceDir = std::filesystem::u8path(argv[index + 1]);
        }
    }

    if (resourceDir.empty())
    {
        replyError("Missing --resources.");
        return 2;
    }

    const LibraryHandle library = openLibrary();

    if (library == nullptr)
    {
        replyError("The Screen AI library could not be loaded.");
        return 3;
    }

    const auto setFileContentFunctions = symbol<SetFileContentFunctions>(library, "SetFileContentFunctions");
    const auto initOcr = symbol<InitOCRUsingCallback>(library, "InitOCRUsingCallback");
    const auto setLightMode = symbol<SetOCRLightMode>(library, "SetOCRLightMode");
    const auto maxImageDimension = symbol<GetMaxImageDimension>(library, "GetMaxImageDimension");
    const auto libraryVersion = symbol<GetLibraryVersion>(library, "GetLibraryVersion");
    const auto performOcr = symbol<PerformOCR>(library, "PerformOCR");
    const auto freeResult = symbol<FreeLibraryAllocatedCharArray>(library, "FreeLibraryAllocatedCharArray");

    if (!setFileContentFunctions || !initOcr || !setLightMode || !maxImageDimension || !performOcr || !freeResult)
    {
        replyError("The Screen AI library is missing functions Wenbu needs.");
        return 4;
    }

    setFileContentFunctions(fileContentSize, fileContent);

    if (!initOcr())
    {
        replyError("Screen AI could not load its OCR models.");
        return 5;
    }

    setLightMode(false);

    uint32_t major = 0;
    uint32_t minor = 0;

    if (libraryVersion)
    {
        libraryVersion(&major, &minor);
    }

    reply("{\"ready\":true,\"version\":\"" + std::to_string(major) + "." + std::to_string(minor) +
          "\",\"maxDimension\":" + std::to_string(maxImageDimension()) + "}");

    std::vector<uint8_t> pixels;

    for (;;)
    {
        uint8_t header[8];

        if (!readExactly(header, sizeof header))
        {
            return 0;
        }

        const uint32_t width = littleEndian(header);
        const uint32_t height = littleEndian(header + 4);
        pixels.resize(static_cast<size_t>(width) * height * 4);

        if (!readExactly(pixels.data(), pixels.size()))
        {
            replyError("The image ended early.");
            return 6;
        }

        SkBitmap bitmap{};
        bitmap.pixmap.pixels = pixels.data();
        bitmap.pixmap.rowBytes = static_cast<size_t>(width) * 4;
        bitmap.pixmap.info.colorInfo.colorType = kRGBA8888;
        bitmap.pixmap.info.colorInfo.alphaType = kOpaque;
        bitmap.pixmap.info.dimensions.width = static_cast<int32_t>(width);
        bitmap.pixmap.info.dimensions.height = static_cast<int32_t>(height);

        uint32_t length = 0;
        void *result = performOcr(&bitmap, &length);

        if (result == nullptr)
        {
            replyError("Screen AI returned no result.");
            continue;
        }

        reply("{\"annotation\":\"" + base64(static_cast<const uint8_t *>(result), length) + "\"}");
        freeResult(result);
    }
}
