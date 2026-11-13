#include "Audio.h"
#include "Capture.h"
#include "Json.h"
#include "Listener.h"
#include "Sources.h"

#include <transcribe.h>

#include <objbase.h>

#include <fcntl.h>
#include <io.h>

#include <atomic>
#include <cstdio>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace
{
    constexpr int protocol = 1;

    std::mutex outputLock;

    void send(const std::string &json)
    {
        std::lock_guard<std::mutex> lock(outputLock);
        std::fwrite(json.data(), 1, json.size(), stdout);
        std::fputc('\n', stdout);
        std::fflush(stdout);
    }

    void error(const std::string &message)
    {
        send("{\"event\":\"error\",\"message\":" + speech::quote(message) + "}");
    }

    void logToStderr(transcribe_log_level level, const char *message, void *)
    {
        if (level == TRANSCRIBE_LOG_LEVEL_WARN || level == TRANSCRIBE_LOG_LEVEL_ERROR)
            std::fputs(message, stderr);
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

    int devices()
    {
        transcribe_init_backends_default();
        std::string list;

        for (int index = 0; index < transcribe_device_count(); ++index)
        {
            struct transcribe_device_info info;
            transcribe_device_info_init(&info);

            if (transcribe_device_get_info(transcribe_device_get(index), &info) != TRANSCRIBE_OK)
                continue;

            list += (list.empty() ? "" : ",") + std::string("{\"name\":") + speech::quote(speech::deviceName(info)) +
                    ",\"kind\":" + speech::quote(info.kind == nullptr ? "" : info.kind) +
                    ",\"type\":" + speech::quote(speech::deviceType(info)) +
                    ",\"memory\":" + std::to_string(info.memory_total) + "}";
        }

        send("{\"devices\":[" + list + "]}");
        return 0;
    }

    int file(const std::wstring &path, speech::ListenOptions options)
    {
        std::string problem;
        const auto clip = speech::readWav(path, problem);

        if (!clip)
        {
            error(problem);
            return 1;
        }

        speech::Listener listener(send);

        if (const auto failure = listener.load(options))
        {
            error(*failure);
            return 1;
        }

        const auto audio = speech::to16k(*clip);
        const size_t chunk = speech::sampleRate / 50;

        for (size_t at = 0; at < audio.size(); at += chunk)
            listener.feed(audio.data() + at, std::min(chunk, audio.size() - at));

        // Trailing silence lets the last utterance end the way it would live.
        const std::vector<float> silence(speech::sampleRate, 0.0f);
        listener.feed(silence.data(), silence.size());
        listener.finish();
        send("{\"event\":\"done\"}");
        return 0;
    }

    speech::CaptureTarget targetOf(const speech::Command &command)
    {
        speech::CaptureTarget target;
        target.processId = static_cast<DWORD>(command.number("pid").value_or(0));
        target.outputId = speech::wide(command.string("output").value_or(""));
        return target;
    }

    class Host
    {
    public:
        int run()
        {
            send("{\"event\":\"ready\",\"protocol\":" + std::to_string(protocol) + "}");

            std::thread watcher([this]()
                                { watch(); });

            std::string line;

            while (std::getline(std::cin, line))
            {
                if (!line.empty() && line.back() == '\r')
                    line.pop_back();

                if (line.empty())
                    continue;

                if (!handle(speech::Command(line)))
                    break;
            }

            running = false;
            watcher.join();
            capture.stop();
            listener.reset();
            send("{\"event\":\"stopped\"}");
            return 0;
        }

    private:
        speech::Capture capture;
        std::unique_ptr<speech::Listener> listener;
        std::atomic<bool> running{true};

        bool handle(const speech::Command &command)
        {
            const auto op = command.string("op").value_or("");

            if (op == "sources")
                send(speech::sourcesJson(speech::appCaptureAvailable()));
            else if (op == "start")
                start(command);
            else if (op == "set-source")
                setSource(command);
            else if (op == "pause" && listener)
                listener->setPaused(true);
            else if (op == "resume" && listener)
                listener->setPaused(false);
            else if (op == "stop")
                return false;
            else
                error("Unknown command " + op + ".");

            return true;
        }

        void start(const speech::Command &command)
        {
            if (listener)
            {
                error("A session is already running.");
                return;
            }

            speech::ListenOptions options;
            options.modelPath = speech::wide(command.string("model").value_or(""));
            options.vadPath = speech::wide(command.string("vad").value_or(""));
            options.language = command.string("language").value_or("");
            options.device = command.string("device").value_or("auto");
            options.threshold = command.number("threshold").value_or(0.5);
            options.pauseMs = static_cast<int>(command.number("pause").value_or(400));
            options.partials = command.number("partials").value_or(1) != 0;

            listener = std::make_unique<speech::Listener>(send);

            if (const auto failure = listener->load(options))
            {
                listener.reset();
                error(*failure);
                return;
            }

            beginCapture(targetOf(command));
        }

        void setSource(const speech::Command &command)
        {
            if (!listener)
                return;

            capture.stop();
            listener->reset();
            beginCapture(targetOf(command));
        }

        void beginCapture(const speech::CaptureTarget &target)
        {
            auto *sink = listener.get();
            const auto failure = capture.start(target, [sink](const float *samples, size_t count)
                                               { sink->feed(samples, count); });

            if (failure)
                send("{\"event\":\"capture-failed\",\"message\":" + speech::quote(*failure) + "}");
            else
                send("{\"event\":\"listening\"}");
        }

        void watch()
        {
            while (running)
            {
                Sleep(250);

                if (const auto failure = capture.takeFailure())
                    send("{\"event\":\"capture-failed\",\"message\":" + speech::quote(*failure) + "}");
            }
        }
    };
}

int wmain(int argc, wchar_t **argv)
{
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    transcribe_log_set(logToStderr, nullptr);

    if (flag(argc, argv, L"--sources"))
    {
        send(speech::sourcesJson(speech::appCaptureAvailable()));
        return 0;
    }

    if (flag(argc, argv, L"--devices"))
        return devices();

    if (const auto input = argument(argc, argv, L"--input"))
    {
        speech::ListenOptions options;
        options.modelPath = argument(argc, argv, L"--model").value_or(L"");
        options.vadPath = argument(argc, argv, L"--vad").value_or(L"");
        options.language = speech::utf8(argument(argc, argv, L"--language").value_or(L""));
        options.device = speech::utf8(argument(argc, argv, L"--device").value_or(L"auto"));
        options.partials = !flag(argc, argv, L"--no-partials");
        return file(*input, options);
    }

    Host host;
    return host.run();
}
