#include "Capture.h"

#include "Audio.h"

#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>

#include <chrono>
#include <future>
#include <vector>

namespace speech
{
    namespace
    {
        constexpr int captureRate = 48000;
        constexpr REFERENCE_TIME bufferDuration = 200 * 10000;

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

        class ActivationHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject
        {
        public:
            HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            HRESULT result = E_FAIL;
            IAudioClient *client = nullptr;

            ~ActivationHandler() { CloseHandle(done); }

            STDMETHODIMP QueryInterface(REFIID riid, void **out) override
            {
                if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler))
                {
                    *out = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
                    return S_OK;
                }

                if (riid == __uuidof(IAgileObject))
                {
                    *out = static_cast<IAgileObject *>(this);
                    return S_OK;
                }

                *out = nullptr;
                return E_NOINTERFACE;
            }

            // The handler lives on the stack of the call that waits for it.
            STDMETHODIMP_(ULONG) AddRef() override { return 2; }
            STDMETHODIMP_(ULONG) Release() override { return 1; }

            STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *operation) override
            {
                HRESULT activated = E_FAIL;
                IUnknown *unknown = nullptr;
                result = operation->GetActivateResult(&activated, &unknown);

                if (SUCCEEDED(result))
                    result = activated;

                if (SUCCEEDED(result))
                    result = unknown->QueryInterface(IID_PPV_ARGS(&client));

                if (unknown != nullptr)
                    unknown->Release();

                SetEvent(done);
                return S_OK;
            }
        };

        std::string hresult(const char *what, HRESULT code)
        {
            char buffer[96];
            std::snprintf(buffer, sizeof(buffer), "%s failed (0x%08lX).", what, static_cast<unsigned long>(code));
            return buffer;
        }

        HRESULT activateProcessLoopback(DWORD processId, IAudioClient **client)
        {
            AUDIOCLIENT_ACTIVATION_PARAMS params = {};
            params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
            params.ProcessLoopbackParams.TargetProcessId = processId;
            params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

            PROPVARIANT variant = {};
            variant.vt = VT_BLOB;
            variant.blob.cbSize = sizeof(params);
            variant.blob.pBlobData = reinterpret_cast<BYTE *>(&params);

            ActivationHandler handler;
            ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
            const HRESULT started = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &variant, &handler, operation.out());

            if (FAILED(started))
                return started;

            if (WaitForSingleObject(handler.done, 10000) != WAIT_OBJECT_0)
                return HRESULT_FROM_WIN32(ERROR_TIMEOUT);

            *client = handler.client;
            return handler.result;
        }

        HRESULT activateDevice(const std::wstring &outputId, IAudioClient **client)
        {
            ComPtr<IMMDeviceEnumerator> enumerator;
            HRESULT result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(enumerator.out()));

            if (FAILED(result))
                return result;

            ComPtr<IMMDevice> device;
            result = outputId.empty() ? enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.out()) : enumerator->GetDevice(outputId.c_str(), device.out());

            if (FAILED(result))
                return result;

            return device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(client));
        }

        WAVEFORMATEX captureFormat()
        {
            WAVEFORMATEX format = {};
            format.wFormatTag = WAVE_FORMAT_PCM;
            format.nChannels = 2;
            format.nSamplesPerSec = captureRate;
            format.wBitsPerSample = 16;
            format.nBlockAlign = 4;
            format.nAvgBytesPerSec = captureRate * 4;
            return format;
        }
    }

    Capture::~Capture() { stop(); }

    std::optional<std::string> Capture::start(const CaptureTarget &target, AudioSink sink)
    {
        stop();
        running = true;
        failed = false;
        failure.clear();

        std::promise<std::optional<std::string>> ready;
        auto started = ready.get_future();

        thread = std::thread([this, target, sink = std::move(sink), ready = std::move(ready)]() mutable
                             {
            CoInitializeEx(nullptr, COINIT_MULTITHREADED);

            const auto fail = [&](std::string message)
            {
                ready.set_value(std::move(message));
                running = false;
                CoUninitialize();
            };

            ComPtr<IAudioClient> client;
            const bool app = target.processId != 0;
            HRESULT result = app ? activateProcessLoopback(target.processId, client.out()) : activateDevice(target.outputId, client.out());

            if (FAILED(result))
                return fail(hresult(app ? "Capturing the app" : "Opening the output device", result));

            WAVEFORMATEX format = captureFormat();
            const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
            result = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, bufferDuration, 0, &format, nullptr);

            if (FAILED(result))
                return fail(hresult("Starting the capture", result));

            ComPtr<IAudioCaptureClient> capture;
            result = client->GetService(IID_PPV_ARGS(capture.out()));

            if (SUCCEEDED(result))
                result = client->Start();

            if (FAILED(result))
                return fail(hresult("Starting the capture", result));

            HANDLE process = app ? OpenProcess(SYNCHRONIZE, FALSE, target.processId) : nullptr;
            ready.set_value(std::nullopt);

            Resampler resampler(captureRate);
            std::vector<float> mono;
            std::vector<float> converted;
            const auto began = std::chrono::steady_clock::now();
            long long produced = 0;

            while (running)
            {
                Sleep(10);

                if (process != nullptr && WaitForSingleObject(process, 0) == WAIT_OBJECT_0)
                {
                    failure = "The app closed.";
                    failed = true;
                    break;
                }

                UINT32 packet = 0;

                while (SUCCEEDED(result = capture->GetNextPacketSize(&packet)) && packet > 0)
                {
                    BYTE *data = nullptr;
                    UINT32 frames = 0;
                    DWORD bufferFlags = 0;
                    result = capture->GetBuffer(&data, &frames, &bufferFlags, nullptr, nullptr);

                    if (FAILED(result))
                        break;

                    const auto *pcm = reinterpret_cast<const int16_t *>(data);
                    const bool silent = (bufferFlags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
                    mono.resize(frames);

                    for (UINT32 frame = 0; frame < frames; ++frame)
                        mono[frame] = silent ? 0.0f : (pcm[frame * 2] + pcm[frame * 2 + 1]) / 65536.0f;

                    capture->ReleaseBuffer(frames);
                    converted.clear();
                    resampler.push(mono.data(), mono.size(), converted);
                    produced += static_cast<long long>(converted.size());

                    if (!converted.empty())
                        sink(converted.data(), converted.size());
                }

                if (FAILED(result))
                {
                    failure = result == AUDCLNT_E_DEVICE_INVALIDATED ? "The output device went away." : hresult("Capturing", result);
                    failed = true;
                    break;
                }

                // Loopback delivers nothing while nothing plays; fill the gap so speech can end.
                const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
                const long long expected = static_cast<long long>(elapsed * sampleRate);

                if (expected - produced > sampleRate / 10)
                {
                    converted.assign(static_cast<size_t>(expected - produced - sampleRate / 20), 0.0f);
                    produced += static_cast<long long>(converted.size());
                    sink(converted.data(), converted.size());
                }
            }

            client->Stop();

            if (process != nullptr)
                CloseHandle(process);

            CoUninitialize(); });

        auto error = started.get();

        if (error)
            stop();

        return error;
    }

    void Capture::stop()
    {
        running = false;

        if (thread.joinable())
            thread.join();
    }

    std::optional<std::string> Capture::takeFailure()
    {
        if (!failed.exchange(false))
            return std::nullopt;

        return failure;
    }

    bool appCaptureAvailable()
    {
        ComPtr<IAudioClient> client;
        return SUCCEEDED(activateProcessLoopback(GetCurrentProcessId(), client.out()));
    }
}
