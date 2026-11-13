// Ruby is not thread-safe, so source runs through RGSSEval on the game's own thread, from a WH_GETMESSAGE hook.

#include <windows.h>

#include <psapi.h>

#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace
{
    using RgssEval = int(__cdecl *)(const char *);

    struct Request
    {
        uint32_t id;
        std::string code;
    };

    HMODULE g_module = nullptr;
    HWND g_window = nullptr;
    RgssEval g_eval = nullptr;
    std::string g_engine;
    std::string g_failure;
    
    UINT g_wakeMessage = 0;

    std::mutex g_lock;
    std::deque<Request> g_requests;
    std::vector<char> g_outbox;
    HANDLE g_outboxReady = nullptr;

    bool g_draining = false;
    uint32_t g_current = 0;
    bool g_replied = false;

    void appendUint(std::vector<char> &out, uint32_t value)
    {
        const auto *bytes = reinterpret_cast<const char *>(&value);
        out.insert(out.end(), bytes, bytes + 4);
    }

    void respond(uint32_t id, bool ok, const char *data, size_t length)
    {
        {
            std::lock_guard<std::mutex> guard(g_lock);
            appendUint(g_outbox, id);
            appendUint(g_outbox, ok ? 1 : 0);
            appendUint(g_outbox, static_cast<uint32_t>(length));
            g_outbox.insert(g_outbox.end(), data, data + length);
        }

        SetEvent(g_outboxReady);
    }

    void respond(uint32_t id, bool ok, const std::string &text)
    {
        respond(id, ok, text.data(), text.size());
    }

    // RGSSEval's calling convention is undocumented, so the stack pointer is restored around the call.
    int callEval(RgssEval eval, const char *code)
    {
        int result = 0;

        __asm {
            mov esi, esp
            push code
            call eval
            mov esp, esi
            mov result, eax
        }

        return result;
    }

    void drain()
    {
        if (g_draining || g_eval == nullptr)
        {
            return;
        }

        g_draining = true;

        for (;;)
        {
            Request request;

            {
                std::lock_guard<std::mutex> guard(g_lock);

                if (g_requests.empty())
                {
                    break;
                }

                request = std::move(g_requests.front());
                g_requests.pop_front();
            }

            g_current = request.id;
            g_replied = false;
            callEval(g_eval, request.code.c_str());

            if (!g_replied)
            {
                respond(request.id, false, std::string("The game did not answer."));
            }
        }

        g_current = 0;
        g_draining = false;
    }

    LRESULT CALLBACK onMessage(int code, WPARAM wParam, LPARAM lParam)
    {
        if (code == HC_ACTION)
        {
            drain();
        }

        return CallNextHookEx(nullptr, code, wParam, lParam);
    }

    BOOL CALLBACK findGameWindow(HWND window, LPARAM found)
    {
        DWORD processId = 0;
        GetWindowThreadProcessId(window, &processId);

        if (processId != GetCurrentProcessId())
        {
            return TRUE;
        }

        wchar_t className[64] = {};
        GetClassNameW(window, className, 64);

        if (lstrcmpW(className, L"RGSS Player") == 0)
        {
            *reinterpret_cast<HWND *>(found) = window;

            return FALSE;
        }

        return TRUE;
    }

    std::string moduleName(HMODULE module)
    {
        char name[MAX_PATH] = {};
        GetModuleBaseNameA(GetCurrentProcess(), module, name, MAX_PATH);

        return name;
    }

    bool findEngine()
    {
        HMODULE modules[1024];
        DWORD needed = 0;

        if (!EnumProcessModules(GetCurrentProcess(), modules, sizeof(modules), &needed))
        {
            return false;
        }

        for (DWORD index = 0; index < needed / sizeof(HMODULE) && index < 1024; index++)
        {
            auto eval = reinterpret_cast<RgssEval>(GetProcAddress(modules[index], "RGSSEval"));

            if (eval != nullptr)
            {
                g_eval = eval;
                g_engine = moduleName(modules[index]);

                return true;
            }
        }

        return false;
    }

    void initialize()
    {
        for (int attempt = 0; attempt < 300 && (g_window == nullptr || g_eval == nullptr); attempt++)
        {
            if (g_window == nullptr)
            {
                EnumWindows(findGameWindow, reinterpret_cast<LPARAM>(&g_window));
            }

            if (g_eval == nullptr)
            {
                findEngine();
            }

            if (g_window == nullptr || g_eval == nullptr)
            {
                Sleep(100);
            }
        }

        if (g_eval == nullptr)
        {
            g_failure = "This game does not run on the standard RPG Maker player (no RGSSEval).";
        }
        else if (g_window == nullptr)
        {
            g_failure = "The game window did not appear.";
        }
        else
        {
            const DWORD thread = GetWindowThreadProcessId(g_window, nullptr);

            if (SetWindowsHookExW(WH_GETMESSAGE, onMessage, g_module, thread) == nullptr)
            {
                g_failure = "Could not hook the game's message loop.";
            }
        }
    }

    bool writeAll(HANDLE pipe, const std::vector<char> &bytes)
    {
        OVERLAPPED overlapped = {};
        overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        DWORD written = 0;
        bool ok = WriteFile(pipe, bytes.data(), static_cast<DWORD>(bytes.size()), nullptr, &overlapped) ||
                  GetLastError() == ERROR_IO_PENDING;

        ok = ok && GetOverlappedResult(pipe, &overlapped, &written, TRUE) && written == bytes.size();
        CloseHandle(overlapped.hEvent);

        return ok;
    }

    uint32_t readUint(const std::vector<char> &bytes, size_t offset)
    {
        uint32_t value = 0;
        memcpy(&value, bytes.data() + offset, 4);

        return value;
    }

    bool takeRequests(std::vector<char> &input)
    {
        bool received = false;

        while (input.size() >= 8)
        {
            const uint32_t id = readUint(input, 0);
            const uint32_t length = readUint(input, 4);

            if (input.size() < 8 + static_cast<size_t>(length))
            {
                break;
            }

            {
                std::lock_guard<std::mutex> guard(g_lock);
                g_requests.push_back({id, std::string(input.data() + 8, length)});
            }

            input.erase(input.begin(), input.begin() + 8 + length);
            received = true;
        }

        return received;
    }

    void serve(HANDLE pipe)
    {
        {
            std::lock_guard<std::mutex> guard(g_lock);
            g_requests.clear();
            g_outbox.clear();
        }

        if (g_failure.empty())
        {
            respond(0, true, g_engine);
        }
        else
        {
            respond(0, false, g_failure);
        }

        OVERLAPPED overlapped = {};
        overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        std::vector<char> input;
        char buffer[65536];
        bool reading = false;

        for (;;)
        {
            if (!reading)
            {
                ResetEvent(overlapped.hEvent);

                if (!ReadFile(pipe, buffer, sizeof(buffer), nullptr, &overlapped) &&
                    GetLastError() != ERROR_IO_PENDING)
                {
                    break;
                }

                reading = true;
            }

            HANDLE events[] = {overlapped.hEvent, g_outboxReady};
            const DWORD signaled = WaitForMultipleObjects(2, events, FALSE, INFINITE);

            if (signaled == WAIT_OBJECT_0)
            {
                DWORD read = 0;
                reading = false;

                if (!GetOverlappedResult(pipe, &overlapped, &read, FALSE) || read == 0)
                {
                    break;
                }

                input.insert(input.end(), buffer, buffer + read);

                if (takeRequests(input) && g_failure.empty())
                {
                    PostMessageW(g_window, g_wakeMessage, 0, 0);
                }
            }
            else if (signaled == WAIT_OBJECT_0 + 1)
            {
                std::vector<char> outgoing;

                {
                    std::lock_guard<std::mutex> guard(g_lock);
                    outgoing.swap(g_outbox);
                }

                if (!outgoing.empty() && !writeAll(pipe, outgoing))
                {
                    break;
                }
            }
            else
            {
                break;
            }
        }

        CancelIo(pipe);
        CloseHandle(overlapped.hEvent);
    }

    DWORD WINAPI run(LPVOID)
    {
        const std::wstring name = L"\\\\.\\pipe\\wenbu-rgss-" + std::to_wstring(GetCurrentProcessId());

        // Windows removes a hook when the thread that set it exits, so this thread sets it and lives on.
        initialize();

        for (;;)
        {
            HANDLE pipe = CreateNamedPipeW(
                name.c_str(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65536,
                65536,
                0,
                nullptr);

            if (pipe == INVALID_HANDLE_VALUE)
            {
                Sleep(1000);
                continue;
            }

            OVERLAPPED overlapped = {};
            overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            DWORD ignored = 0;
            const bool connected =
                ConnectNamedPipe(pipe, &overlapped)
                    ? true
                    : GetLastError() == ERROR_PIPE_CONNECTED ||
                          (GetLastError() == ERROR_IO_PENDING &&
                           GetOverlappedResult(pipe, &overlapped, &ignored, TRUE));

            CloseHandle(overlapped.hEvent);

            if (connected)
            {
                serve(pipe);
            }

            DisconnectNamedPipe(pipe);
            CloseHandle(pipe);
        }
    }
}

extern "C" void __stdcall wenbu_reply(uint32_t id, uint32_t ok, const char *data, uint32_t length)
{
    if (id == g_current)
    {
        g_replied = true;
    }

    respond(id, ok != 0, data, length);
}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH)
    {
        g_module = module;
        DisableThreadLibraryCalls(module);
        g_outboxReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        g_wakeMessage = RegisterWindowMessageW(L"WenbuRgssWake");

        HANDLE thread = CreateThread(nullptr, 0, run, nullptr, 0, nullptr);

        if (thread != nullptr)
        {
            CloseHandle(thread);
        }
    }

    return TRUE;
}
