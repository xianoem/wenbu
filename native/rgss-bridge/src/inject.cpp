// 32-bit like RGSS games, so LoadLibraryW has the same address in the game as here.

#include <windows.h>

#include <tlhelp32.h>

#include <cstdio>
#include <cwchar>
#include <string>

namespace
{
    int finish(const char *error)
    {
        if (error == nullptr)
        {
            std::printf("{\"ok\":true}\n");

            return 0;
        }

        std::printf("{\"ok\":false,\"error\":\"%s\"}\n", error);

        return 1;
    }

    bool isLoaded(DWORD processId, const wchar_t *dllPath)
    {
        const wchar_t *slash = std::wcsrchr(dllPath, L'\\');
        const wchar_t *name = slash == nullptr ? dllPath : slash + 1;
        HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, processId);

        if (snapshot == INVALID_HANDLE_VALUE)
        {
            return false;
        }

        MODULEENTRY32W entry = {};
        entry.dwSize = sizeof(entry);
        bool found = false;

        for (BOOL more = Module32FirstW(snapshot, &entry); more && !found; more = Module32NextW(snapshot, &entry))
        {
            found = _wcsicmp(entry.szModule, name) == 0;
        }

        CloseHandle(snapshot);

        return found;
    }

    const char *inject(DWORD processId, const wchar_t *dllPath)
    {
        HANDLE process = OpenProcess(
            PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE |
                PROCESS_VM_READ,
            FALSE,
            processId);

        if (process == nullptr)
        {
            return "Could not open the game process. If the game runs as administrator, run Wenbu as administrator too.";
        }

        BOOL selfWow64 = FALSE;
        BOOL targetWow64 = FALSE;
        IsWow64Process(GetCurrentProcess(), &selfWow64);
        IsWow64Process(process, &targetWow64);

        if (selfWow64 && !targetWow64)
        {
            CloseHandle(process);

            return "The game is a 64-bit program, so it is not an RPG Maker XP, VX or VX Ace game.";
        }

        if (isLoaded(processId, dllPath))
        {
            CloseHandle(process);

            return nullptr;
        }

        const SIZE_T size = (std::wcslen(dllPath) + 1) * sizeof(wchar_t);
        void *remote = VirtualAllocEx(process, nullptr, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        const char *error = nullptr;

        if (remote == nullptr || !WriteProcessMemory(process, remote, dllPath, size, nullptr))
        {
            error = "Could not write into the game process.";
        }
        else
        {
            auto loadLibrary = reinterpret_cast<LPTHREAD_START_ROUTINE>(
                GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"));
            HANDLE thread = CreateRemoteThread(process, nullptr, 0, loadLibrary, remote, 0, nullptr);

            if (thread == nullptr)
            {
                error = "Could not start the bridge inside the game.";
            }
            else
            {
                WaitForSingleObject(thread, 15000);
                DWORD loaded = 0;
                GetExitCodeThread(thread, &loaded);
                CloseHandle(thread);

                if (loaded == 0)
                {
                    error = "The game refused to load the bridge.";
                }
            }
        }

        if (remote != nullptr)
        {
            VirtualFreeEx(process, remote, 0, MEM_RELEASE);
        }

        CloseHandle(process);

        return error;
    }
}

int wmain(int argc, wchar_t **argv)
{
    if (argc != 3)
    {
        return finish("Usage: wenbu-rgss-inject <pid> <dll path>");
    }

    const DWORD processId = static_cast<DWORD>(std::wcstoul(argv[1], nullptr, 10));

    return finish(inject(processId, argv[2]));
}
