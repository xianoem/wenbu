#include "Sources.h"

#include "Json.h"

#include <initguid.h>

#include <audiopolicy.h>
#include <propkeydef.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <shlwapi.h>
#include <tlhelp32.h>

#include <algorithm>
#include <map>
#include <set>

namespace speech
{
    namespace
    {
        template <typename T>
        struct ComPtr
        {
            T *value = nullptr;

            ~ComPtr()
            {
                if (value != nullptr)
                    value->Release();
            }

            T **out() { return &value; }
            T *operator->() const { return value; }
        };

        struct ProcessEntry
        {
            DWORD parent = 0;
            std::wstring exe;
        };

        std::map<DWORD, ProcessEntry> processTable()
        {
            std::map<DWORD, ProcessEntry> table;
            HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);

            if (snapshot == INVALID_HANDLE_VALUE)
                return table;

            PROCESSENTRY32W entry{};
            entry.dwSize = sizeof(entry);

            for (BOOL more = Process32FirstW(snapshot, &entry); more; more = Process32NextW(snapshot, &entry))
                table[entry.th32ProcessID] = {entry.th32ParentProcessID, entry.szExeFile};

            CloseHandle(snapshot);
            return table;
        }

        DWORD topOfProgram(DWORD processId, const std::map<DWORD, ProcessEntry> &table)
        {
            std::set<DWORD> seen;
            DWORD current = processId;

            while (seen.insert(current).second)
            {
                const auto self = table.find(current);
                const auto parent = self == table.end() ? table.end() : table.find(self->second.parent);

                if (parent == table.end() || _wcsicmp(parent->second.exe.c_str(), self->second.exe.c_str()) != 0)
                    break;

                current = self->second.parent;
            }

            return current;
        }

        std::wstring imagePath(DWORD processId)
        {
            HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);

            if (process == nullptr)
                return L"";

            wchar_t buffer[MAX_PATH * 4];
            DWORD size = static_cast<DWORD>(std::size(buffer));
            std::wstring path = QueryFullProcessImageNameW(process, 0, buffer, &size) ? std::wstring(buffer, size) : L"";
            CloseHandle(process);
            return path;
        }

        std::wstring programName(const std::wstring &path, const std::wstring &exe)
        {
            DWORD ignored = 0;
            const DWORD size = path.empty() ? 0 : GetFileVersionInfoSizeW(path.c_str(), &ignored);

            if (size > 0)
            {
                std::vector<BYTE> info(size);

                struct Translation
                {
                    WORD language;
                    WORD codePage;
                };

                Translation *translations = nullptr;
                UINT length = 0;

                if (GetFileVersionInfoW(path.c_str(), 0, size, info.data()) &&
                    VerQueryValueW(info.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<void **>(&translations), &length) && length >= sizeof(Translation))
                {
                    wchar_t key[64];
                    swprintf_s(key, L"\\StringFileInfo\\%04x%04x\\FileDescription", translations[0].language, translations[0].codePage);
                    wchar_t *description = nullptr;

                    if (VerQueryValueW(info.data(), key, reinterpret_cast<void **>(&description), &length) && length > 1)
                        return description;
                }
            }

            std::wstring name = exe;
            const auto dot = name.find_last_of(L'.');
            return dot == std::wstring::npos ? name : name.substr(0, dot);
        }
    }

    std::vector<Output> listOutputs()
    {
        std::vector<Output> outputs;
        ComPtr<IMMDeviceEnumerator> enumerator;

        if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(enumerator.out()))))
            return outputs;

        std::wstring defaultId;
        ComPtr<IMMDevice> defaultDevice;

        if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, defaultDevice.out())))
        {
            LPWSTR id = nullptr;

            if (SUCCEEDED(defaultDevice->GetId(&id)))
            {
                defaultId = id;
                CoTaskMemFree(id);
            }
        }

        ComPtr<IMMDeviceCollection> devices;

        if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, devices.out())))
            return outputs;

        UINT count = 0;
        devices->GetCount(&count);

        for (UINT index = 0; index < count; ++index)
        {
            ComPtr<IMMDevice> device;
            LPWSTR id = nullptr;

            if (FAILED(devices->Item(index, device.out())) || FAILED(device->GetId(&id)))
                continue;

            Output output;
            output.id = id;
            output.isDefault = output.id == defaultId;
            CoTaskMemFree(id);

            ComPtr<IPropertyStore> properties;
            PROPVARIANT name;
            PropVariantInit(&name);

            if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, properties.out())) && SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &name)) && name.vt == VT_LPWSTR)
                output.name = name.pwszVal;

            PropVariantClear(&name);
            outputs.push_back(output);
        }

        return outputs;
    }

    std::vector<App> listApps()
    {
        std::vector<App> apps;
        ComPtr<IMMDeviceEnumerator> enumerator;

        if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(enumerator.out()))))
            return apps;

        ComPtr<IMMDeviceCollection> devices;

        if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, devices.out())))
            return apps;

        const auto table = processTable();
        const DWORD self = GetCurrentProcessId();
        const DWORD wenbu = topOfProgram(self, table);
        std::set<DWORD> listed;
        UINT count = 0;
        devices->GetCount(&count);

        for (UINT index = 0; index < count; ++index)
        {
            ComPtr<IMMDevice> device;
            ComPtr<IAudioSessionManager2> manager;
            ComPtr<IAudioSessionEnumerator> sessions;

            if (FAILED(devices->Item(index, device.out())) ||
                FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(manager.out()))) ||
                FAILED(manager->GetSessionEnumerator(sessions.out())))
                continue;

            int sessionCount = 0;
            sessions->GetCount(&sessionCount);

            for (int at = 0; at < sessionCount; ++at)
            {
                ComPtr<IAudioSessionControl> control;
                ComPtr<IAudioSessionControl2> control2;
                AudioSessionState state = AudioSessionStateInactive;
                DWORD processId = 0;

                if (FAILED(sessions->GetSession(at, control.out())) ||
                    FAILED(control->QueryInterface(IID_PPV_ARGS(control2.out()))) ||
                    control2->IsSystemSoundsSession() == S_OK ||
                    FAILED(control2->GetState(&state)) || state != AudioSessionStateActive ||
                    FAILED(control2->GetProcessId(&processId)) || processId == 0)
                    continue;

                const DWORD top = topOfProgram(processId, table);

                if (top == wenbu || !listed.insert(top).second)
                    continue;

                const auto entry = table.find(top);
                App app;
                app.processId = top;
                app.path = imagePath(top);
                app.name = programName(app.path, entry == table.end() ? L"" : entry->second.exe);
                apps.push_back(app);
            }
        }

        std::sort(apps.begin(), apps.end(), [](const App &left, const App &right)
                  { return _wcsicmp(left.name.c_str(), right.name.c_str()) < 0; });

        return apps;
    }

    std::string sourcesJson(bool appCaptureAvailable)
    {
        std::string outputs;

        for (const auto &output : listOutputs())
            outputs += (outputs.empty() ? "" : ",") + std::string("{\"id\":") + quote(utf8(output.id)) + ",\"name\":" + quote(utf8(output.name)) + ",\"default\":" + (output.isDefault ? "true" : "false") + "}";

        std::string apps;

        for (const auto &app : listApps())
            apps += (apps.empty() ? "" : ",") + std::string("{\"pid\":") + std::to_string(app.processId) + ",\"name\":" + quote(utf8(app.name)) + ",\"path\":" + quote(utf8(app.path)) + "}";

        return "{\"event\":\"sources\",\"outputs\":[" + outputs + "],\"apps\":[" + apps + "],\"appCapture\":" + (appCaptureAvailable ? "true" : "false") + "}";
    }
}
