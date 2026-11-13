#pragma once

#include <windows.h>

#include <atomic>
#include <functional>
#include <optional>
#include <string>
#include <thread>

namespace speech
{
    struct CaptureTarget
    {
        std::wstring outputId;
        DWORD processId = 0;
    };

    using AudioSink = std::function<void(const float *samples, size_t count)>;

    class Capture
    {
    public:
        ~Capture();

        std::optional<std::string> start(const CaptureTarget &target, AudioSink sink);
        void stop();

        std::optional<std::string> takeFailure();

    private:
        std::thread thread;
        std::atomic<bool> running{false};
        std::atomic<bool> failed{false};
        std::string failure;
    };

    bool appCaptureAvailable();
}
