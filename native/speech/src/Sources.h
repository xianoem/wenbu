#pragma once

#include <windows.h>

#include <string>
#include <vector>

namespace speech
{
    struct Output
    {
        std::wstring id;
        std::wstring name;
        bool isDefault = false;
    };

    struct App
    {
        DWORD processId = 0;
        std::wstring name;
        std::wstring path;
    };

    std::vector<Output> listOutputs();
    std::vector<App> listApps();

    std::string sourcesJson(bool appCaptureAvailable);
}
