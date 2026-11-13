#include <windows.h>

#include <fcntl.h>
#include <io.h>
#include <psapi.h>
#include <shellapi.h>
#include <tlhelp32.h>

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace
{
    struct ThreadParam
    {
        DWORD processId;
        uint64_t addr;
        uint64_t ctx;
        uint64_t ctx2;
    };

    enum class HostInfo
    {
        Console,
        Warning,
        EmuWarning,
        EmuConnected,
        EngineType,
    };

    using ProcessEvent = void (*)(DWORD);
    using ThreadCreated = void (*)(const wchar_t *, const char *, ThreadParam, bool);
    using ThreadDestroyed = void (*)(const wchar_t *, const char *, ThreadParam);
    using Output = void (*)(const wchar_t *, const char *, ThreadParam, const wchar_t *);
    using HostInfoHandler = void (*)(HostInfo, const wchar_t *);
    using HookInserted = void (*)(DWORD, uint64_t, const wchar_t *);
    using Embed = void (*)(const wchar_t *, ThreadParam);
    using I18nQuery = wchar_t *(*)(const wchar_t *);
    using EmuGameInfo = void (*)(const wchar_t *, const wchar_t *, const wchar_t *);

    using StartFn = void (*)(ProcessEvent, ProcessEvent, ThreadCreated, ThreadDestroyed, Output, HostInfoHandler, HookInserted, Embed, I18nQuery, EmuGameInfo);
    using SettingsFn = void (*)(int, int, int, int, bool);
    using PidFn = void (*)(DWORD);
    using CheckIfNeedInjectFn = bool (*)(DWORD);
    using InsertHookCodeFn = void (*)(DWORD, const wchar_t *);
    using InsertPcHooksFn = void (*)(DWORD, int);

    struct Luna
    {
        StartFn start = nullptr;
        SettingsFn settings = nullptr;
        PidFn connectProcess = nullptr;
        PidFn detachProcess = nullptr;
        CheckIfNeedInjectFn checkIfNeedInject = nullptr;
        InsertHookCodeFn insertHookCode = nullptr;
        InsertPcHooksFn insertPcHooks = nullptr;
    };

    Luna luna;
    std::filesystem::path pluginFolder;
    std::mutex outputLock;
    std::mutex stateLock;
    std::set<DWORD> connectedProcesses;

    std::string utf8(const std::wstring &value)
    {
        if (value.empty())
            return "";

        const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        std::string result(static_cast<size_t>(size), '\0');
        WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
        return result;
    }

    std::wstring wide(const std::string &value)
    {
        if (value.empty())
            return L"";

        const int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
        std::wstring result(static_cast<size_t>(size), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size);
        return result;
    }

    // Hook names arrive as narrow strings: UTF-8 from newer engines, the ANSI code page from older ones.
    std::string hookName(const char *value)
    {
        if (value == nullptr)
            return "";

        const UINT codePage = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, nullptr, 0) > 0 ? CP_UTF8 : CP_ACP;
        const int size = MultiByteToWideChar(codePage, 0, value, -1, nullptr, 0);

        if (size <= 1)
            return "";

        std::wstring result(static_cast<size_t>(size - 1), L'\0');
        MultiByteToWideChar(codePage, 0, value, -1, result.data(), size);
        return utf8(result);
    }

    std::string quote(const std::string &value)
    {
        std::string result = "\"";

        for (const unsigned char ch : value)
        {
            if (ch == '"')
                result += "\\\"";
            else if (ch == '\\')
                result += "\\\\";
            else if (ch == '\n')
                result += "\\n";
            else if (ch == '\r')
                result += "\\r";
            else if (ch == '\t')
                result += "\\t";
            else if (ch < 0x20)
            {
                char escaped[8];
                std::snprintf(escaped, sizeof(escaped), "\\u%04x", ch);
                result += escaped;
            }
            else
                result += static_cast<char>(ch);
        }

        return result + "\"";
    }

    std::string hex(uint64_t value)
    {
        std::ostringstream stream;
        stream << std::hex << value;
        return stream.str();
    }

    std::string threadKey(ThreadParam tp)
    {
        return std::to_string(tp.processId) + ":" + hex(tp.addr) + ":" + hex(tp.ctx) + ":" + hex(tp.ctx2);
    }

    void send(const std::string &json)
    {
        std::lock_guard<std::mutex> lock(outputLock);
        std::fwrite(json.data(), 1, json.size(), stdout);
        std::fputc('\n', stdout);
        std::fflush(stdout);
    }

    void log(const char *level, const std::string &message)
    {
        send(std::string("{\"event\":\"log\",\"level\":\"") + level + "\",\"message\":" + quote(message) + "}");
    }

    std::string windowsError(DWORD code)
    {
        wchar_t *buffer = nullptr;
        const DWORD size = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, code, 0, reinterpret_cast<wchar_t *>(&buffer), 0, nullptr);

        if (size == 0 || buffer == nullptr)
            return "Windows error " + std::to_string(code);

        std::wstring message(buffer, size);
        LocalFree(buffer);

        while (!message.empty() && (message.back() == L'\n' || message.back() == L'\r' || message.back() == L' ' || message.back() == L'.'))
            message.pop_back();

        return utf8(message) + " (" + std::to_string(code) + ")";
    }

    struct Failure
    {
        std::string reason;
        std::string message;
    };

    struct Handle
    {
        HANDLE value = nullptr;
        explicit Handle(HANDLE handle) : value(handle) {}
        Handle(const Handle &) = delete;
        Handle &operator=(const Handle &) = delete;
        ~Handle()
        {
            if (value != nullptr && value != INVALID_HANDLE_VALUE)
                CloseHandle(value);
        }
    };

    std::optional<std::vector<char>> readFile(const std::filesystem::path &path)
    {
        std::ifstream file(path, std::ios::binary);

        if (!file)
            return std::nullopt;

        return std::vector<char>(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    }

    template <typename T>
    std::optional<T> readAt(const std::vector<char> &bytes, size_t offset)
    {
        if (offset + sizeof(T) > bytes.size())
            return std::nullopt;

        T value;
        std::memcpy(&value, bytes.data() + offset, sizeof(T));
        return value;
    }

    // A 64-bit process can't resolve WOW64 kernel32 exports, so LoadLibraryW's RVA is read from SysWOW64\kernel32.dll on disk.
    std::optional<uint32_t> loadLibraryRva32()
    {
        wchar_t systemFolder[MAX_PATH];

        if (GetSystemWow64DirectoryW(systemFolder, MAX_PATH) == 0)
            return std::nullopt;

        const auto bytes = readFile(std::filesystem::path(systemFolder) / L"kernel32.dll");

        if (!bytes)
            return std::nullopt;

        const auto peOffset = readAt<LONG>(*bytes, offsetof(IMAGE_DOS_HEADER, e_lfanew));

        if (!peOffset)
            return std::nullopt;

        const auto headers = readAt<IMAGE_NT_HEADERS32>(*bytes, static_cast<size_t>(*peOffset));

        if (!headers || headers->Signature != IMAGE_NT_SIGNATURE || headers->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR32_MAGIC)
            return std::nullopt;

        const auto exports = headers->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT];
        const size_t sections = static_cast<size_t>(*peOffset) + offsetof(IMAGE_NT_HEADERS32, OptionalHeader) + headers->FileHeader.SizeOfOptionalHeader;

        const auto fileOffset = [&](uint32_t rva) -> std::optional<size_t>
        {
            for (WORD index = 0; index < headers->FileHeader.NumberOfSections; ++index)
            {
                const auto section = readAt<IMAGE_SECTION_HEADER>(*bytes, sections + index * sizeof(IMAGE_SECTION_HEADER));

                if (!section)
                    return std::nullopt;

                if (rva >= section->VirtualAddress && rva < section->VirtualAddress + section->SizeOfRawData)
                    return static_cast<size_t>(rva - section->VirtualAddress + section->PointerToRawData);
            }

            return std::nullopt;
        };

        const auto directoryOffset = fileOffset(exports.VirtualAddress);

        if (!directoryOffset)
            return std::nullopt;

        const auto directory = readAt<IMAGE_EXPORT_DIRECTORY>(*bytes, *directoryOffset);
        const auto names = directory ? fileOffset(directory->AddressOfNames) : std::nullopt;
        const auto ordinals = directory ? fileOffset(directory->AddressOfNameOrdinals) : std::nullopt;
        const auto functions = directory ? fileOffset(directory->AddressOfFunctions) : std::nullopt;

        if (!names || !ordinals || !functions)
            return std::nullopt;

        for (DWORD index = 0; index < directory->NumberOfNames; ++index)
        {
            const auto nameRva = readAt<uint32_t>(*bytes, *names + index * 4);
            const auto nameOffset = nameRva ? fileOffset(*nameRva) : std::nullopt;

            if (!nameOffset || std::strcmp(bytes->data() + *nameOffset, "LoadLibraryW") != 0)
                continue;

            const auto ordinal = readAt<uint16_t>(*bytes, *ordinals + index * 2);
            const auto rva = ordinal ? readAt<uint32_t>(*bytes, *functions + *ordinal * 4) : std::nullopt;

            if (!rva || (*rva >= exports.VirtualAddress && *rva < exports.VirtualAddress + exports.Size))
                return std::nullopt;

            return *rva;
        }

        return std::nullopt;
    }

    std::optional<uintptr_t> kernel32Base32(HANDLE process)
    {
        // Right after a launch the game may not have loaded kernel32 yet.
        for (int attempt = 0; attempt < 50; ++attempt)
        {
            HMODULE modules[1024];
            DWORD needed = 0;

            if (EnumProcessModulesEx(process, modules, sizeof(modules), &needed, LIST_MODULES_32BIT))
            {
                for (DWORD index = 0; index < needed / sizeof(HMODULE); ++index)
                {
                    wchar_t name[MAX_PATH];

                    if (GetModuleBaseNameW(process, modules[index], name, MAX_PATH) > 0 && _wcsicmp(name, L"kernel32.dll") == 0)
                        return reinterpret_cast<uintptr_t>(modules[index]);
                }
            }

            Sleep(100);
        }

        return std::nullopt;
    }

    std::optional<Failure> inject(DWORD pid, const std::filesystem::path &dll)
    {
        Handle process(OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ, FALSE, pid));

        if (process.value == nullptr)
        {
            const DWORD error = GetLastError();

            if (error == ERROR_ACCESS_DENIED)
                return Failure{"elevated", "The game runs as administrator."};

            return Failure{"failed", "The game's process could not be opened: " + windowsError(error) + "."};
        }

        BOOL wow64 = FALSE;
        IsWow64Process(process.value, &wow64);

        LPTHREAD_START_ROUTINE loadLibrary = nullptr;

        if (wow64)
        {
            const auto base = kernel32Base32(process.value);
            const auto rva = loadLibraryRva32();

            if (!base || !rva)
                return Failure{"failed", "LoadLibraryW could not be found in the 32-bit game."};

            loadLibrary = reinterpret_cast<LPTHREAD_START_ROUTINE>(*base + *rva);
        }
        else
        {
            loadLibrary = reinterpret_cast<LPTHREAD_START_ROUTINE>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"));
        }

        const std::wstring path = std::filesystem::absolute(dll).wstring();
        const SIZE_T bytes = (path.size() + 1) * sizeof(wchar_t);
        void *remote = VirtualAllocEx(process.value, nullptr, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);

        if (remote == nullptr)
            return Failure{"failed", "Memory in the game could not be reserved: " + windowsError(GetLastError()) + "."};

        std::optional<Failure> failure;

        if (!WriteProcessMemory(process.value, remote, path.c_str(), bytes, nullptr))
        {
            failure = Failure{"failed", "The game's memory could not be written: " + windowsError(GetLastError()) + "."};
        }
        else
        {
            Handle thread(CreateRemoteThread(process.value, nullptr, 0, loadLibrary, remote, 0, nullptr));

            if (thread.value == nullptr)
            {
                failure = Failure{"failed", "LunaHook could not be started in the game: " + windowsError(GetLastError()) + "."};
            }
            else if (WaitForSingleObject(thread.value, 15000) != WAIT_OBJECT_0)
            {
                failure = Failure{"failed", "LunaHook took too long to load. An antivirus may be blocking it."};
            }
            else
            {
                DWORD loaded = 0;
                GetExitCodeThread(thread.value, &loaded);

                if (loaded == 0)
                    failure = Failure{"failed", "The game refused to load " + utf8(dll.filename().wstring()) + ". An antivirus may be blocking it."};
            }
        }

        VirtualFreeEx(process.value, remote, 0, MEM_RELEASE);
        return failure;
    }

    std::filesystem::path hookDllFor(DWORD pid)
    {
        Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
        BOOL wow64 = FALSE;

        if (process.value != nullptr)
            IsWow64Process(process.value, &wow64);

        return pluginFolder / (wow64 ? L"LunaHook32.dll" : L"LunaHook64.dll");
    }

    std::optional<Failure> attach(DWORD pid)
    {
        luna.connectProcess(pid);

        if (!luna.checkIfNeedInject(pid))
            return std::nullopt;

        return inject(pid, hookDllFor(pid));
    }

    std::wstring selfPath()
    {
        wchar_t path[MAX_PATH];
        GetModuleFileNameW(nullptr, path, MAX_PATH);
        return path;
    }

    std::optional<Failure> injectElevated(DWORD pid)
    {
        const std::wstring self = selfPath();
        const std::wstring parameters = L"--inject " + std::to_wstring(pid) + L" --dll \"" + hookDllFor(pid).wstring() + L"\"";

        SHELLEXECUTEINFOW info{};
        info.cbSize = sizeof(info);
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE;
        info.lpVerb = L"runas";
        info.lpFile = self.c_str();
        info.lpParameters = parameters.c_str();
        info.nShow = SW_HIDE;

        if (!ShellExecuteExW(&info))
        {
            const DWORD error = GetLastError();

            if (error == ERROR_CANCELLED)
                return Failure{"cancelled", "Administrator access was declined."};

            return Failure{"failed", "Wenbu could not ask for administrator access: " + windowsError(error) + "."};
        }

        Handle process(info.hProcess);
        WaitForSingleObject(process.value, 30000);

        DWORD exitCode = 1;
        GetExitCodeProcess(process.value, &exitCode);

        if (exitCode != 0)
            return Failure{"failed", "LunaHook could not be loaded into the game, even as administrator."};

        return std::nullopt;
    }

    void onConnected(DWORD pid)
    {
        {
            std::lock_guard<std::mutex> lock(stateLock);
            connectedProcesses.insert(pid);
        }

        luna.insertPcHooks(pid, 0);
        luna.insertPcHooks(pid, 1);
        send("{\"event\":\"connected\",\"pid\":" + std::to_string(pid) + "}");
    }

    void onDisconnected(DWORD pid)
    {
        {
            std::lock_guard<std::mutex> lock(stateLock);
            connectedProcesses.erase(pid);
        }

        send("{\"event\":\"disconnected\",\"pid\":" + std::to_string(pid) + "}");
    }

    void onThreadCreated(const wchar_t *code, const char *name, ThreadParam tp, bool)
    {
        send("{\"event\":\"thread\",\"thread\":" + quote(threadKey(tp)) + ",\"pid\":" + std::to_string(tp.processId) + ",\"ctx\":" + quote(hex(tp.ctx)) + ",\"ctx2\":" + quote(hex(tp.ctx2)) + ",\"code\":" + quote(utf8(code == nullptr ? L"" : code)) + ",\"name\":" + quote(hookName(name)) + "}");
    }

    void onThreadDestroyed(const wchar_t *, const char *, ThreadParam tp)
    {
        send("{\"event\":\"removed\",\"thread\":" + quote(threadKey(tp)) + "}");
    }

    void onOutput(const wchar_t *, const char *, ThreadParam tp, const wchar_t *text)
    {
        send("{\"event\":\"text\",\"thread\":" + quote(threadKey(tp)) + ",\"text\":" + quote(utf8(text == nullptr ? L"" : text)) + "}");
    }

    void onHostInfo(HostInfo type, const wchar_t *message)
    {
        if (type == HostInfo::EngineType && message != nullptr)
            log("info", "Game engine: " + utf8(message) + ".");
    }

    void onHookInserted(DWORD, uint64_t, const wchar_t *) {}

    void onEmbed(const wchar_t *, ThreadParam) {}

    wchar_t *onI18nQuery(const wchar_t *) { return nullptr; }

    void onEmuGameInfo(const wchar_t *, const wchar_t *, const wchar_t *) {}

    template <typename T>
    bool resolve(HMODULE module, const char *name, T &target, std::vector<std::string> &missing)
    {
        target = reinterpret_cast<T>(GetProcAddress(module, name));

        if (target == nullptr)
            missing.push_back(name);

        return target != nullptr;
    }

    std::optional<std::string> loadLuna()
    {
        HMODULE module = LoadLibraryW((pluginFolder / L"LunaHost64.dll").c_str());

        if (module == nullptr)
            return "LunaHost64.dll could not be loaded: " + windowsError(GetLastError()) + ".";

        std::vector<std::string> missing;
        resolve(module, "Luna_Start", luna.start, missing);
        resolve(module, "Luna_Settings", luna.settings, missing);
        resolve(module, "Luna_ConnectProcess", luna.connectProcess, missing);
        resolve(module, "Luna_DetachProcess", luna.detachProcess, missing);
        resolve(module, "Luna_CheckIfNeedInject", luna.checkIfNeedInject, missing);
        resolve(module, "Luna_InsertHookCode", luna.insertHookCode, missing);
        resolve(module, "Luna_InsertPCHooks", luna.insertPcHooks, missing);

        if (missing.empty())
            return std::nullopt;

        std::string names;

        for (const auto &name : missing)
            names += (names.empty() ? "" : ", ") + name;

        return "This LunaHook release is not compatible with Wenbu. Missing: " + names + ".";
    }

    class Command
    {
    public:
        explicit Command(const std::string &line) : text(line) { parse(); }

        std::optional<std::string> string(const std::string &key) const
        {
            const auto found = strings.find(key);
            return found == strings.end() ? std::nullopt : std::optional<std::string>(found->second);
        }

        std::optional<long long> number(const std::string &key) const
        {
            const auto found = numbers.find(key);
            return found == numbers.end() ? std::nullopt : std::optional<long long>(found->second);
        }

    private:
        const std::string &text;
        size_t at = 0;
        std::map<std::string, std::string> strings;
        std::map<std::string, long long> numbers;

        void skipSpace()
        {
            while (at < text.size() && std::isspace(static_cast<unsigned char>(text[at])))
                ++at;
        }

        bool consume(char expected)
        {
            skipSpace();

            if (at >= text.size() || text[at] != expected)
                return false;

            ++at;
            return true;
        }

        std::optional<unsigned> hex4()
        {
            if (at + 4 > text.size())
                return std::nullopt;

            unsigned value = 0;

            for (int index = 0; index < 4; ++index)
            {
                const char ch = text[at++];
                value <<= 4;

                if (ch >= '0' && ch <= '9')
                    value |= static_cast<unsigned>(ch - '0');
                else if (ch >= 'a' && ch <= 'f')
                    value |= static_cast<unsigned>(ch - 'a' + 10);
                else if (ch >= 'A' && ch <= 'F')
                    value |= static_cast<unsigned>(ch - 'A' + 10);
                else
                    return std::nullopt;
            }

            return value;
        }

        std::optional<std::string> parseString()
        {
            if (!consume('"'))
                return std::nullopt;

            std::wstring result;
            std::string run;

            const auto flush = [&]()
            {
                result += wide(run);
                run.clear();
            };

            while (at < text.size())
            {
                const char ch = text[at++];

                if (ch == '"')
                {
                    flush();
                    return utf8(result);
                }

                if (ch != '\\')
                {
                    run += ch;
                    continue;
                }

                if (at >= text.size())
                    return std::nullopt;

                const char escape = text[at++];

                if (escape == 'u')
                {
                    const auto code = hex4();

                    if (!code)
                        return std::nullopt;

                    flush();
                    result += static_cast<wchar_t>(*code);
                    continue;
                }

                const std::string simple = "\"\\/bfnrt";
                const std::string decoded = "\"\\/\b\f\n\r\t";
                const auto position = simple.find(escape);

                if (position == std::string::npos)
                    return std::nullopt;

                run += decoded[position];
            }

            return std::nullopt;
        }

        void parse()
        {
            if (!consume('{'))
                return;

            while (true)
            {
                const auto key = parseString();

                if (!key || !consume(':'))
                    return;

                skipSpace();

                if (at < text.size() && text[at] == '"')
                {
                    const auto value = parseString();

                    if (!value)
                        return;

                    strings[*key] = *value;
                }
                else
                {
                    char *end = nullptr;
                    const char *start = text.c_str() + at;
                    numbers[*key] = std::strtoll(start, &end, 10);

                    if (end == start)
                        return;

                    at += static_cast<size_t>(end - start);
                }

                if (!consume(','))
                    return;
            }
        }
    };

    void reply(long long id, const std::optional<Failure> &failure)
    {
        if (!failure)
        {
            send("{\"id\":" + std::to_string(id) + "}");
            return;
        }

        send("{\"id\":" + std::to_string(id) + ",\"reason\":" + quote(failure->reason) + ",\"error\":" + quote(failure->message) + "}");
    }

    void handle(const std::string &line)
    {
        const Command command(line);
        const auto id = command.number("id").value_or(0);
        const auto op = command.string("op").value_or("");
        const auto pid = static_cast<DWORD>(command.number("pid").value_or(0));

        if (op == "attach")
        {
            std::thread([id, pid]() { reply(id, attach(pid)); }).detach();
            return;
        }

        if (op == "elevate")
        {
            std::thread([id, pid]() { reply(id, injectElevated(pid)); }).detach();
            return;
        }

        if (op == "detach")
        {
            luna.detachProcess(pid);
            reply(id, std::nullopt);
            return;
        }

        if (op == "insertHook")
        {
            luna.insertHookCode(pid, wide(command.string("code").value_or("")).c_str());
            reply(id, std::nullopt);
            return;
        }

        reply(id, Failure{"failed", "Unknown command " + op + "."});
    }

    int host()
    {
        if (const auto error = loadLuna())
        {
            send("{\"event\":\"error\",\"message\":" + quote(*error) + "}");
            return 1;
        }

        luna.settings(200, 932, 3000, 1000000, false);
        luna.start(onConnected, onDisconnected, onThreadCreated, onThreadDestroyed, onOutput, onHostInfo, onHookInserted, onEmbed, onI18nQuery, onEmuGameInfo);
        send("{\"event\":\"ready\"}");

        std::string line;

        while (std::getline(std::cin, line))
        {
            if (!line.empty() && line.back() == '\r')
                line.pop_back();

            if (line == "quit")
                break;

            if (!line.empty())
                handle(line);
        }

        std::set<DWORD> connected;
        {
            std::lock_guard<std::mutex> lock(stateLock);
            connected = connectedProcesses;
        }

        for (const DWORD pid : connected)
            luna.detachProcess(pid);

        return 0;
    }

    int check()
    {
        const auto error = loadLuna();
        send(error.value_or("LunaHook loaded."));
        return error ? 1 : 0;
    }

    int processes()
    {
        Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));

        if (snapshot.value == INVALID_HANDLE_VALUE)
        {
            send("{\"error\":" + quote(windowsError(GetLastError())) + "}");
            return 1;
        }

        PROCESSENTRY32W entry{};
        entry.dwSize = sizeof(entry);
        std::string list;

        for (BOOL more = Process32FirstW(snapshot.value, &entry); more; more = Process32NextW(snapshot.value, &entry))
        {
            std::wstring path;
            Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID));

            if (process.value != nullptr)
            {
                wchar_t buffer[MAX_PATH * 4];
                DWORD size = static_cast<DWORD>(std::size(buffer));

                if (QueryFullProcessImageNameW(process.value, 0, buffer, &size))
                    path.assign(buffer, size);
            }

            list += (list.empty() ? "" : ",") + std::string("{\"pid\":") + std::to_string(entry.th32ProcessID) + ",\"parent\":" + std::to_string(entry.th32ParentProcessID) + ",\"name\":" + quote(utf8(entry.szExeFile)) + ",\"path\":" + quote(utf8(path)) + "}";
        }

        send("{\"processes\":[" + list + "]}");
        return 0;
    }

    std::optional<std::wstring> argument(int argc, wchar_t **argv, const std::wstring &name)
    {
        for (int index = 1; index < argc - 1; ++index)
        {
            if (name == argv[index])
                return argv[index + 1];
        }

        return std::nullopt;
    }

    bool flag(int argc, wchar_t **argv, const std::wstring &name)
    {
        for (int index = 1; index < argc; ++index)
        {
            if (name == argv[index])
                return true;
        }

        return false;
    }
}

int wmain(int argc, wchar_t **argv)
{
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);

    if (flag(argc, argv, L"--processes"))
        return processes();

    const auto injectPid = argument(argc, argv, L"--inject");
    const auto dll = argument(argc, argv, L"--dll");

    if (injectPid && dll)
        return inject(static_cast<DWORD>(std::wcstoul(injectPid->c_str(), nullptr, 10)), *dll) ? 1 : 0;

    const auto plugin = argument(argc, argv, L"--plugin");

    if (!plugin)
    {
        send("{\"error\":\"Pass --plugin <folder>, --processes or --inject <pid> --dll <path>.\"}");
        return 2;
    }

    pluginFolder = *plugin;

    return flag(argc, argv, L"--check") ? check() : host();
}
