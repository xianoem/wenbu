#include "ScreenAi.hpp"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <icu.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdlib>
#include <deque>
#include <stdexcept>
#include <thread>
#include <vector>

#include "Protocol.hpp"
#include "Utf8.hpp"

namespace engine {

namespace {

constexpr auto loading = std::chrono::seconds(30);
constexpr auto reading = std::chrono::seconds(60);
constexpr wchar_t helperName[] = L"wenbu-screen-ai-ocr.exe";

struct Unreadable : std::runtime_error {
    Unreadable() : std::runtime_error("Screen AI returned data Wenbu could not read.") {}
};

std::vector<uint8_t> base64Decoded(const std::string& text) {
    std::vector<uint8_t> bytes;
    uint32_t bits = 0;
    int count = 0;
    size_t padding = 0;

    for (const char c : text) {
        int value = -1;

        if (c >= 'A' && c <= 'Z') {
            value = c - 'A';
        } else if (c >= 'a' && c <= 'z') {
            value = c - 'a' + 26;
        } else if (c >= '0' && c <= '9') {
            value = c - '0' + 52;
        } else if (c == '+') {
            value = 62;
        } else if (c == '/') {
            value = 63;
        } else if (c == '=') {
            padding++;

            continue;
        }

        if (value < 0 || padding > 0) {
            throw Unreadable();
        }

        bits = (bits << 6) | static_cast<uint32_t>(value);
        count += 6;

        if (count >= 8) {
            count -= 8;
            bytes.push_back(static_cast<uint8_t>(bits >> count));
        }
    }

    if (padding > 2 || count >= 6) {
        throw Unreadable();
    }

    return bytes;
}

class Wire {
public:
    Wire(const uint8_t* data, size_t size) : at_(data), end_(data + size) {}

    bool done() const { return at_ == end_; }

    uint64_t varint() {
        uint64_t value = 0;

        for (int shift = 0; shift < 64; shift += 7) {
            if (at_ == end_) {
                throw Unreadable();
            }

            const uint8_t byte = *at_++;

            value |= static_cast<uint64_t>(byte & 0x7F) << shift;

            if ((byte & 0x80) == 0) {
                return value;
            }
        }

        throw Unreadable();
    }

    Wire bytes() {
        const uint64_t length = varint();

        if (length > static_cast<uint64_t>(end_ - at_)) {
            throw Unreadable();
        }

        const Wire inner(at_, static_cast<size_t>(length));

        at_ += length;

        return inner;
    }

    std::string text() {
        const Wire inner = bytes();

        return {reinterpret_cast<const char*>(inner.at_), static_cast<size_t>(inner.end_ - inner.at_)};
    }

    void skip(uint32_t type) {
        switch (type) {
        case 0:
            varint();
            break;
        case 1:
            advance(8);
            break;
        case 2:
            bytes();
            break;
        case 5:
            advance(4);
            break;
        default:
            throw Unreadable();
        }
    }

private:
    void advance(size_t count) {
        if (count > static_cast<size_t>(end_ - at_)) {
            throw Unreadable();
        }

        at_ += count;
    }

    const uint8_t* at_;
    const uint8_t* end_;
};

struct Word {
    std::string text;
    bool spaceAfter = false;
};

struct AnnotatedLine {
    std::vector<Word> words;
    std::optional<std::string> text;
    int32_t block = 0;
    int32_t paragraph = 0;
};

Word wordOf(Wire wire) {
    Word word;

    while (!wire.done()) {
        const uint64_t key = wire.varint();
        const uint64_t field = key >> 3;
        const uint32_t type = key & 7;

        if (field == 3 && type == 2) {
            word.text = wire.text();
        } else if (field == 6 && type == 0) {
            word.spaceAfter = wire.varint() != 0;
        } else {
            wire.skip(type);
        }
    }

    return word;
}

AnnotatedLine lineOf(Wire wire) {
    AnnotatedLine line;

    while (!wire.done()) {
        const uint64_t key = wire.varint();
        const uint64_t field = key >> 3;
        const uint32_t type = key & 7;

        if (field == 1 && type == 2) {
            line.words.push_back(wordOf(wire.bytes()));
        } else if (field == 3 && type == 2) {
            line.text = wire.text();
        } else if (field == 5 && type == 0) {
            line.block = static_cast<int32_t>(wire.varint());
        } else if (field == 11 && type == 0) {
            line.paragraph = static_cast<int32_t>(wire.varint());
        } else {
            wire.skip(type);
        }
    }

    return line;
}

// String.prototype.trim's white space and line terminators.
bool jsSpace(char32_t c) {
    return (c >= 0x09 && c <= 0x0D) || c == 0x20 || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
           c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF;
}

std::string trimmed(const std::string& text) {
    const std::u32string points = decodeUtf8(text);
    const auto first = std::find_if_not(points.begin(), points.end(), jsSpace);
    const auto last = std::find_if_not(points.rbegin(), std::make_reverse_iterator(first), jsSpace).base();

    return encodeUtf8(std::u32string(first, last));
}

std::string textOf(const AnnotatedLine& line) {
    if (line.text) {
        return *line.text;
    }

    std::string joined;

    for (const Word& word : line.words) {
        joined += word.text;

        if (word.spaceAfter) {
            joined += ' ';
        }
    }

    return trimmed(joined);
}

bool hasCjk(const std::string& text) {
    for (const char32_t c : decodeUtf8(text)) {
        UErrorCode status = U_ZERO_ERROR;
        const UScriptCode script = uscript_getScript(static_cast<UChar32>(c), &status);

        if (script == USCRIPT_HAN || script == USCRIPT_HIRAGANA || script == USCRIPT_KATAKANA || script == USCRIPT_HANGUL) {
            return true;
        }
    }

    return false;
}

// Command-line quoting that CommandLineToArgvW and the C runtime read back unchanged.
std::wstring quoted(const std::wstring& argument) {
    std::wstring out = L"\"";
    size_t slashes = 0;

    for (const wchar_t c : argument) {
        if (c == L'\\') {
            slashes++;
        } else if (c == L'"') {
            out.append(slashes * 2 + 1, L'\\');
            slashes = 0;
        } else {
            out.append(slashes, L'\\');
            slashes = 0;
        }

        if (c != L'\\') {
            out.push_back(c);
        }
    }

    out.append(slashes * 2, L'\\');
    out.push_back(L'"');

    return out;
}

void closeHandle(HANDLE& handle) {
    if (handle != nullptr && handle != INVALID_HANDLE_VALUE) {
        CloseHandle(handle);
    }

    handle = nullptr;
}

std::vector<uint8_t> frameOf(const Rgba& image) {
    std::vector<uint8_t> frame(8 + image.data.size());
    const auto put = [&](size_t at, uint32_t value) {
        for (int i = 0; i < 4; i++) {
            frame[at + i] = static_cast<uint8_t>(value >> (8 * i));
        }
    };

    put(0, static_cast<uint32_t>(image.width));
    put(4, static_cast<uint32_t>(image.height));
    std::copy(image.data.begin(), image.data.end(), frame.begin() + 8);

    return frame;
}

Rgba rgbaOf(const Rgb& image) {
    Rgba out{image.width, image.height, std::vector<uint8_t>(static_cast<size_t>(image.width) * image.height * 4, 255)};

    for (size_t p = 0; p < static_cast<size_t>(image.width) * image.height; p++) {
        std::copy_n(image.data.begin() + p * 3, 3, out.data.begin() + p * 4);
    }

    return out;
}

bool isInteger(const Json& value) {
    return value.is_number() && std::isfinite(value.get<double>()) && std::trunc(value.get<double>()) == value.get<double>();
}

bool isString(const Json& reply, const char* key) {
    const auto found = reply.find(key);

    return found != reply.end() && found->is_string();
}

// The helper's replies, tried in the order the Reply union lists them.
enum class Reply { Ready, Annotation, Error };

std::optional<Reply> replyOf(const Json& reply) {
    if (!reply.is_object()) {
        return std::nullopt;
    }

    if (reply.value("ready", Json()) == true && isString(reply, "version") && isInteger(reply.value("maxDimension", Json()))) {
        return Reply::Ready;
    }

    if (isString(reply, "annotation")) {
        return Reply::Annotation;
    }

    if (isString(reply, "error")) {
        return Reply::Error;
    }

    return std::nullopt;
}

}

std::string screenAiText(const std::string& annotation) {
    const std::vector<uint8_t> bytes = base64Decoded(annotation);
    Wire wire(bytes.data(), bytes.size());
    std::vector<std::pair<std::pair<int32_t, int32_t>, std::vector<std::string>>> paragraphs;

    while (!wire.done()) {
        const uint64_t key = wire.varint();
        const uint32_t type = key & 7;

        if ((key >> 3) != 2 || type != 2) {
            wire.skip(type);

            continue;
        }

        const AnnotatedLine line = lineOf(wire.bytes());
        const std::pair<int32_t, int32_t> id{line.block, line.paragraph};
        auto found = std::find_if(paragraphs.begin(), paragraphs.end(), [&](const auto& paragraph) { return paragraph.first == id; });

        if (found == paragraphs.end()) {
            found = paragraphs.insert(paragraphs.end(), {id, {}});
        }

        found->second.push_back(textOf(line));
    }

    std::vector<std::string> lines;

    for (const auto& paragraph : paragraphs) {
        lines.insert(lines.end(), paragraph.second.begin(), paragraph.second.end());
    }

    const std::string separator = std::any_of(lines.begin(), lines.end(), hasCjk) ? "" : " ";
    std::string text;

    for (size_t i = 0; i < lines.size(); i++) {
        text += (i > 0 ? separator : "") + lines[i];
    }

    return text;
}

Rgba fitWithin(const Rgba& image, int maxDimension) {
    const double factor = std::min(1.0, static_cast<double>(maxDimension) / std::max(image.width, image.height));

    if (factor >= 1) {
        return image;
    }

    const int width = std::max(1, static_cast<int>(std::floor(image.width * factor)));
    const int height = std::max(1, static_cast<int>(std::floor(image.height * factor)));
    Rgba out{width, height, std::vector<uint8_t>(static_cast<size_t>(width) * height * 4)};

    for (int y = 0; y < height; y++) {
        const int top = static_cast<int>(static_cast<int64_t>(y) * image.height / height);
        const int bottom = std::max(top + 1, static_cast<int>(static_cast<int64_t>(y + 1) * image.height / height));

        for (int x = 0; x < width; x++) {
            const int left = static_cast<int>(static_cast<int64_t>(x) * image.width / width);
            const int right = std::max(left + 1, static_cast<int>(static_cast<int64_t>(x + 1) * image.width / width));
            double sums[4] = {0, 0, 0, 0};

            for (int sourceY = top; sourceY < bottom; sourceY++) {
                for (int sourceX = left; sourceX < right; sourceX++) {
                    const size_t offset = (static_cast<size_t>(sourceY) * image.width + sourceX) * 4;

                    for (int channel = 0; channel < 4; channel++) {
                        sums[channel] += image.data[offset + channel];
                    }
                }
            }

            const double count = static_cast<double>(bottom - top) * (right - left);
            const size_t target = (static_cast<size_t>(y) * width + x) * 4;

            for (int channel = 0; channel < 4; channel++) {
                out.data[target + channel] = static_cast<uint8_t>(std::floor(sums[channel] / count + 0.5));
            }
        }
    }

    return out;
}

struct ScreenAi::Process {
    HANDLE process = nullptr;
    HANDLE job = nullptr;
    HANDLE input = nullptr;
    HANDLE output = nullptr;
    std::thread reader;
    std::mutex lock;
    std::condition_variable changed;
    std::deque<std::string> lines;
    bool ended = false;
    std::filesystem::path folder;
    int maxDimension = 0;

    ~Process() {
        if (process != nullptr) {
            TerminateProcess(process, 1);
        }

        closeHandle(input);

        if (reader.joinable()) {
            reader.join();
        }

        closeHandle(output);
        closeHandle(process);
        closeHandle(job);
    }

    void readLines() {
        std::string pending;
        char buffer[65536];
        DWORD count = 0;
        bool afterReturn = false;

        while (ReadFile(output, buffer, sizeof buffer, &count, nullptr) && count > 0) {
            std::scoped_lock guard(lock);

            for (DWORD i = 0; i < count; i++) {
                const char c = buffer[i];

                if (c == '\n' && afterReturn) {
                    afterReturn = false;

                    continue;
                }

                afterReturn = c == '\r';

                if (c == '\n' || c == '\r') {
                    lines.push_back(std::move(pending));
                    pending.clear();
                } else {
                    pending.push_back(c);
                }
            }

            changed.notify_all();
        }

        std::scoped_lock guard(lock);

        if (!pending.empty()) {
            lines.push_back(std::move(pending));
        }

        ended = true;
        changed.notify_all();
    }

    // The next reply, or nothing when the helper stopped or took longer than `timeout`.
    std::optional<Json> next(std::chrono::seconds timeout) {
        std::unique_lock guard(lock);

        if (!changed.wait_for(guard, timeout, [&] { return !lines.empty() || ended; }) || lines.empty()) {
            return std::nullopt;
        }

        const std::string line = std::move(lines.front());

        lines.pop_front();

        try {
            const Json reply = Json::parse(line);

            return replyOf(reply) ? std::optional<Json>(reply) : std::nullopt;
        } catch (const Json::exception&) {
            return std::nullopt;
        }
    }
};

ScreenAi::ScreenAi(std::filesystem::path helper) : helper_(std::move(helper)) {}

ScreenAi::~ScreenAi() {
    stop();
}

void ScreenAi::stop() {
    process_.reset();
}

void ScreenAi::start(const std::filesystem::path& folder) {
    auto process = std::make_unique<Process>();
    SECURITY_ATTRIBUTES inherited{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE childInput = nullptr;
    HANDLE childOutput = nullptr;
    HANDLE childError = nullptr;

    process->folder = folder;

    if (!CreatePipe(&childInput, &process->input, &inherited, 0) || !CreatePipe(&process->output, &childOutput, &inherited, 0)) {
        closeHandle(childInput);

        throw std::runtime_error("The Screen AI helper could not be started.");
    }

    SetHandleInformation(process->input, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(process->output, HANDLE_FLAG_INHERIT, 0);
    DuplicateHandle(GetCurrentProcess(), GetStdHandle(STD_ERROR_HANDLE), GetCurrentProcess(), &childError, 0, TRUE,
                    DUPLICATE_SAME_ACCESS);

    std::vector<HANDLE> handles{childInput, childOutput};

    if (childError != nullptr) {
        handles.push_back(childError);
    }

    SIZE_T size = 0;

    InitializeProcThreadAttributeList(nullptr, 1, 0, &size);

    std::vector<uint8_t> attributes(size);
    auto* list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
    STARTUPINFOEXW startup{};
    PROCESS_INFORMATION info{};
    std::wstring command = quoted(helper_.wstring()) + L" --resources " + quoted(folder.wstring());

    startup.StartupInfo.cb = sizeof startup;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = childInput;
    startup.StartupInfo.hStdOutput = childOutput;
    startup.StartupInfo.hStdError = childError;

    bool started = false;

    // Only the pipe ends and the error stream are inherited, whatever else the engine has open.
    if (InitializeProcThreadAttributeList(list, 1, 0, &size)) {
        startup.lpAttributeList = list;
        started = UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles.data(),
                                            handles.size() * sizeof(HANDLE), nullptr, nullptr) &&
                  CreateProcessW(helper_.c_str(), command.data(), nullptr, nullptr, TRUE,
                                 CREATE_NO_WINDOW | CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr,
                                 &startup.StartupInfo, &info);
        DeleteProcThreadAttributeList(list);
    }

    closeHandle(childInput);
    closeHandle(childOutput);
    closeHandle(childError);

    if (!started) {
        throw std::runtime_error("The Screen AI helper could not be started.");
    }

    process->process = info.hProcess;

    // The helper is ended with the engine, however the engine ends.
    process->job = CreateJobObjectW(nullptr, nullptr);

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};

    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    if (process->job != nullptr) {
        SetInformationJobObject(process->job, JobObjectExtendedLimitInformation, &limits, sizeof limits);
        AssignProcessToJobObject(process->job, info.hProcess);
    }

    ResumeThread(info.hThread);
    CloseHandle(info.hThread);
    process->reader = std::thread([raw = process.get()] { raw->readLines(); });

    const std::optional<Json> ready = process->next(loading);

    if (!ready || replyOf(*ready) != Reply::Ready) {
        throw std::runtime_error("Screen AI did not start.");
    }

    process->maxDimension = static_cast<int>((*ready)["maxDimension"].get<double>());
    process_ = std::move(process);
}

std::optional<std::string> ScreenAi::read(const std::filesystem::path& folder, const Rgb& image) {
    std::scoped_lock guard(lock_);

    try {
        if (!process_ || process_->folder != folder) {
            stop();
            start(folder);
        }

        const std::vector<uint8_t> frame = frameOf(fitWithin(rgbaOf(image), process_->maxDimension));
        HANDLE input = process_->input;
        std::thread writer([input, &frame] {
            size_t at = 0;
            DWORD written = 0;

            while (at < frame.size() &&
                   WriteFile(input, frame.data() + at, static_cast<DWORD>(std::min<size_t>(frame.size() - at, 1 << 20)), &written,
                             nullptr)) {
                at += written;
            }
        });
        const std::optional<Json> reply = process_->next(reading);

        if (!reply) {
            TerminateProcess(process_->process, 1);
        }

        writer.join();

        if (!reply) {
            stop();

            return std::nullopt;
        }

        if (replyOf(*reply) != Reply::Annotation) {
            return std::nullopt;
        }

        return screenAiText((*reply)["annotation"].get<std::string>());
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::filesystem::path screenAiHelper() {
    std::wstring module(MAX_PATH, L'\0');

    module.resize(GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size())));

    const std::filesystem::path beside = std::filesystem::path(module).parent_path() / helperName;

    if (std::filesystem::exists(beside)) {
        return beside;
    }

    wchar_t* value = nullptr;
    size_t length = 0;

    if (_wdupenv_s(&value, &length, L"WENBU_RESOURCES_DIR") != 0 || value == nullptr) {
        return beside;
    }

    const std::filesystem::path resources(value);

    std::free(value);

    return resources / "native" / "win32-x64" / helperName;
}

}
