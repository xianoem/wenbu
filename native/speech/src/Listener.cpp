#include "Listener.h"

#include "Audio.h"
#include "Filters.h"
#include "Json.h"

#include <transcribe.h>
#include <transcribe/vad.h>

#include <algorithm>
#include <chrono>

namespace speech
{
    namespace
    {
        constexpr int frameSamples = 512;
        constexpr long long padSamples = sampleRate / 5;
        constexpr long long minimumSamples = sampleRate / 4;
        constexpr long long longestSamples = sampleRate * 6;
        constexpr long long splitWindowSamples = sampleRate * 2;
        constexpr long long breathAfterSamples = sampleRate * 5 / 2;
        constexpr long long breathSamples = sampleRate / 5;
        constexpr long long partialEverySamples = sampleRate;
        constexpr long long keptSamples = sampleRate * 30;
        constexpr long long levelSamples = sampleRate / 10;
        constexpr int languageLockRuns = 5;
        constexpr double slowPartialMs = 700;
        constexpr int slowPartialsAllowed = 3;

        std::string statusText(const char *what, transcribe_status status)
        {
            return std::string(what) + ": " + transcribe_status_string(status) + ".";
        }

        // Laptops list their integrated GPU first, with shared memory that makes it look the biggest.
        transcribe_device_t bestGpu()
        {
            transcribe_device_t best = nullptr;
            int bestRank = 0;
            uint64_t bestMemory = 0;

            for (int index = 0; index < transcribe_device_count(); ++index)
            {
                const transcribe_device_t device = transcribe_device_get(index);
                struct transcribe_device_info info;
                transcribe_device_info_init(&info);

                if (device == nullptr || transcribe_device_get_info(device, &info) != TRANSCRIBE_OK)
                    continue;

                const int rank = info.device_type == TRANSCRIBE_DEVICE_TYPE_GPU ? 2 : info.device_type == TRANSCRIBE_DEVICE_TYPE_IGPU ? 1 : 0;

                if (rank > bestRank || (rank == bestRank && rank > 0 && info.memory_total > bestMemory))
                {
                    best = device;
                    bestRank = rank;
                    bestMemory = info.memory_total;
                }
            }

            return best;
        }

        double seconds(long long samples) { return static_cast<double>(samples) / sampleRate; }
    }

    std::string deviceType(const transcribe_device_info &info)
    {
        switch (info.device_type)
        {
        case TRANSCRIBE_DEVICE_TYPE_GPU:
            return "gpu";
        case TRANSCRIBE_DEVICE_TYPE_IGPU:
            return "integrated";
        case TRANSCRIBE_DEVICE_TYPE_ACCEL:
            return "accelerator";
        default:
            return "cpu";
        }
    }

    std::string deviceName(const transcribe_device_info &info)
    {
        std::string name = info.description == nullptr ? (info.kind == nullptr ? "" : info.kind) : info.description;

        while (!name.empty() && name.back() == ' ')
            name.pop_back();

        return name;
    }

    Listener::Listener(Emit emitEvent) : emit(std::move(emitEvent)) {}

    Listener::~Listener()
    {
        {
            std::lock_guard<std::mutex> lock(queueLock);
            quitting = true;
        }

        queueChanged.notify_all();

        if (recogniser.joinable())
            recogniser.join();

        transcribe_session_free(session);
        transcribe_model_free(model);
        transcribe_vad_session_free(vad);
        transcribe_model_free(vadModel);
    }

    std::optional<std::string> Listener::load(const ListenOptions &listenOptions)
    {
        options = listenOptions;
        partialsEnabled = options.partials;
        transcribe_init_backends_default();

        struct transcribe_model_load_params cpu;
        transcribe_model_load_params_init(&cpu);
        cpu.backend = TRANSCRIBE_BACKEND_CPU;

        transcribe_status status = transcribe_model_load_file(utf8(options.vadPath).c_str(), &cpu, &vadModel);

        if (status != TRANSCRIBE_OK)
            return statusText("Loading the voice detector", status);

        status = transcribe_vad_session_init(vadModel, nullptr, &vad);

        if (status != TRANSCRIBE_OK)
            return statusText("Starting the voice detector", status);

        emit("{\"event\":\"loading-model\"}");
        const auto began = std::chrono::steady_clock::now();

        struct transcribe_model_load_params params = cpu;
        const transcribe_device_t gpu = options.device == "cpu" ? nullptr : bestGpu();

        if (gpu != nullptr)
        {
            params.backend = TRANSCRIBE_BACKEND_AUTO;
            params.device = gpu;
        }

        status = transcribe_model_load_file(utf8(options.modelPath).c_str(), &params, &model);

        if (status == TRANSCRIBE_ERR_BACKEND && options.device != "cpu")
        {
            emit("{\"event\":\"log\",\"message\":\"The GPU could not load the model; using the CPU.\"}");
            status = transcribe_model_load_file(utf8(options.modelPath).c_str(), &cpu, &model);
        }

        if (status != TRANSCRIBE_OK)
            return statusText("Loading the speech model", status);

        status = transcribe_session_init(model, nullptr, &session);

        if (status != TRANSCRIBE_OK)
            return statusText("Starting the speech model", status);

        // The GPU prepares its kernels on first use; doing it now keeps the first lines from lagging.
        for (const int warmSamples : {sampleRate, sampleRate * 6})
        {
            const std::vector<float> silence(static_cast<size_t>(warmSamples), 0.0f);
            transcribe_run(session, silence.data(), warmSamples, nullptr);
        }

        struct transcribe_device_info info;
        transcribe_device_info_init(&info);
        transcribe_device_get_info(transcribe_model_device(model), &info);

        const auto loadSeconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();

        emit("{\"event\":\"model-loaded\",\"device\":" + quote(deviceName(info)) + ",\"type\":" + quote(deviceType(info)) + ",\"seconds\":" + number(loadSeconds) + "}");

        recogniser = std::thread([this]()
                                 { recognise(); });

        return std::nullopt;
    }

    void Listener::feed(const float *samples, size_t count)
    {
        std::lock_guard<std::mutex> lock(stateLock);

        if (paused)
            return;

        audio.insert(audio.end(), samples, samples + count);
        fed += static_cast<long long>(count);

        levelWindow.insert(levelWindow.end(), samples, samples + count);

        while (static_cast<long long>(levelWindow.size()) >= levelSamples)
        {
            const float level = rms(levelWindow.data(), static_cast<size_t>(levelSamples));
            levelWindow.erase(levelWindow.begin(), levelWindow.begin() + levelSamples);
            emit("{\"event\":\"level\",\"rms\":" + number(level) + ",\"speech\":" + (speaking ? "true" : "false") + "}");
        }

        if (transcribe_vad_stream_feed(vad, samples, static_cast<int>(count)) == TRANSCRIBE_OK)
        {
            struct transcribe_vad_result result;
            transcribe_vad_result_init(&result);
            transcribe_vad_get_result(vad, &result);

            if (result.n_probs > 0)
                onProbabilities(transcribe_vad_probs(vad), result.n_probs, result.first_frame);
        }

        trimAudio();
    }

    void Listener::onProbabilities(const float *probs, int count, long long firstFrame)
    {
        const double threshold = options.threshold;
        const double negative = std::max(threshold - 0.15, 0.01);
        const long long pause = static_cast<long long>(options.pauseMs) * sampleRate / 1000;

        for (int index = 0; index < count; ++index)
        {
            const float probability = probs[index];
            const long long frameEnd = vadFrames + (firstFrame + index + 1) * frameSamples;

            if (!speaking)
            {
                if (probability >= threshold)
                {
                    speaking = true;
                    speechStart = frameEnd - frameSamples;
                    lastSpeech = frameEnd;
                    nextPartial = speechStart + partialEverySamples;
                    utteranceProbs.assign(1, probability);
                }

                continue;
            }

            utteranceProbs.push_back(probability);

            if (probability >= negative)
                lastSpeech = frameEnd;

            const long long needed = frameEnd - speechStart > breathAfterSamples ? std::min(pause, breathSamples) : pause;

            if (frameEnd - lastSpeech >= needed)
            {
                closeUtterance(lastSpeech);
                continue;
            }

            if (frameEnd - speechStart >= longestSamples)
            {
                const size_t window = static_cast<size_t>(splitWindowSamples / frameSamples);
                const size_t from = utteranceProbs.size() > window ? utteranceProbs.size() - window : 1;
                size_t cut = from;
                float quietest = 2;

                for (size_t at = from; at + 2 < utteranceProbs.size(); ++at)
                {
                    const float average = (utteranceProbs[at] + utteranceProbs[at + 1] + utteranceProbs[at + 2]) / 3;

                    if (average < quietest)
                    {
                        quietest = average;
                        cut = at + 1;
                    }
                }

                const long long cutSample = speechStart + static_cast<long long>(cut) * frameSamples;
                const std::vector<float> kept(utteranceProbs.begin() + static_cast<std::ptrdiff_t>(cut), utteranceProbs.end());
                utteranceProbs.resize(cut);
                closeUtterance(cutSample);
                speaking = true;
                speechStart = cutSample;
                nextPartial = speechStart + partialEverySamples;
                utteranceProbs = kept;
                continue;
            }

            if (partialsEnabled && frameEnd >= nextPartial)
            {
                Job job;
                job.id = nextId;
                job.partial = true;
                job.audio = slice(speechStart - padSamples, frameEnd);
                enqueue(std::move(job));
                nextPartial = frameEnd + partialEverySamples;
            }
        }
    }

    void Listener::closeUtterance(long long endSample)
    {
        speaking = false;

        if (endSample - speechStart < minimumSamples)
            return;

        const double threshold = options.threshold;
        const auto spoken = std::count_if(utteranceProbs.begin(), utteranceProbs.end(), [threshold](float probability)
                                          { return probability >= threshold; });

        Job job;
        job.id = nextId++;
        job.start = seconds(std::max(speechStart - padSamples, 0LL));
        job.end = seconds(std::min(endSample + padSamples, fed));
        job.audio = slice(speechStart - padSamples, endSample + padSamples);
        job.speechShare = utteranceProbs.empty() ? 1 : static_cast<double>(spoken) / static_cast<double>(utteranceProbs.size());
        job.level = rms(job.audio.data(), job.audio.size());
        enqueue(std::move(job));
    }

    std::vector<float> Listener::slice(long long from, long long to) const
    {
        from = std::max(from, audioStart);
        to = std::min(to, fed);

        if (to <= from)
            return {};

        return std::vector<float>(audio.begin() + (from - audioStart), audio.begin() + (to - audioStart));
    }

    void Listener::trimAudio()
    {
        long long keepFrom = fed - keptSamples;

        if (speaking)
            keepFrom = std::min(keepFrom, speechStart - padSamples);

        if (keepFrom <= audioStart)
            return;

        audio.erase(audio.begin(), audio.begin() + (keepFrom - audioStart));
        audioStart = keepFrom;
    }

    void Listener::setPaused(bool value)
    {
        {
            std::lock_guard<std::mutex> lock(stateLock);
            paused = value;
        }

        if (value)
            reset();
    }

    void Listener::reset()
    {
        std::lock_guard<std::mutex> lock(stateLock);
        transcribe_vad_stream_reset(vad);
        vadFrames = fed;
        speaking = false;
        utteranceProbs.clear();
        levelWindow.clear();
    }

    void Listener::finish()
    {
        {
            std::lock_guard<std::mutex> lock(stateLock);

            if (transcribe_vad_stream_flush(vad) == TRANSCRIBE_OK)
            {
                struct transcribe_vad_result result;
                transcribe_vad_result_init(&result);
                transcribe_vad_get_result(vad, &result);

                if (result.n_probs > 0)
                    onProbabilities(transcribe_vad_probs(vad), result.n_probs, result.first_frame);
            }

            if (speaking)
                closeUtterance(lastSpeech);
        }

        std::unique_lock<std::mutex> lock(queueLock);
        queueChanged.wait(lock, [this]()
                          { return finals.empty() && !pendingPartial && !working; });
    }

    void Listener::enqueue(Job job)
    {
        {
            std::lock_guard<std::mutex> lock(queueLock);

            if (job.partial)
            {
                if (working || !finals.empty())
                    return;

                pendingPartial = std::move(job);
            }
            else
            {
                pendingPartial.reset();
                finals.push_back(std::move(job));
            }
        }

        queueChanged.notify_all();
    }

    void Listener::recognise()
    {
        while (true)
        {
            Job job;

            {
                std::unique_lock<std::mutex> lock(queueLock);
                queueChanged.wait(lock, [this]()
                                  { return quitting || !finals.empty() || pendingPartial; });

                if (quitting)
                    return;

                if (!finals.empty())
                {
                    job = std::move(finals.front());
                    finals.pop_front();
                }
                else
                {
                    job = std::move(*pendingPartial);
                    pendingPartial.reset();
                }

                working = true;
            }

            runJob(job);

            {
                std::lock_guard<std::mutex> lock(queueLock);
                working = false;
            }

            queueChanged.notify_all();
        }
    }

    void Listener::runJob(Job &job)
    {
        if (job.audio.empty())
            return;

        struct transcribe_run_params params;
        transcribe_run_params_init(&params);
        const std::string language = options.language.empty() ? lockedLanguage : options.language;
        params.language = language.empty() ? nullptr : language.c_str();

        const auto began = std::chrono::steady_clock::now();
        const transcribe_status status = transcribe_run(session, job.audio.data(), static_cast<int>(job.audio.size()), &params);
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - began).count();

        if (status != TRANSCRIBE_OK)
        {
            emit("{\"event\":\"error\",\"message\":" + quote(statusText("Recognising speech", status)) + "}");
            return;
        }

        const char *full = transcribe_full_text(session);
        const char *detected = transcribe_detected_language(session);
        const std::string text = full == nullptr ? "" : full;
        // With a language hint the model reports no language, so the hint stands in for it.
        const bool reported = detected != nullptr && *detected != 0;
        const std::string spoken = reported ? detected : language;

        if (job.partial)
        {
            slowPartials = ms > slowPartialMs ? slowPartials + 1 : 0;

            if (slowPartials >= slowPartialsAllowed)
            {
                partialsEnabled = false;
                emit("{\"event\":\"partials-off\",\"ms\":" + number(ms) + "}");
            }

            emit("{\"event\":\"partial\",\"id\":" + std::to_string(job.id) + ",\"text\":" + quote(text) + "}");
            return;
        }

        Heard heard;
        heard.text = text;
        heard.seconds = job.end - job.start;
        heard.speechShare = job.speechShare;
        heard.level = job.level;
        const auto reason = dropReason(heard, Previous{previousText, job.start - previousEnd});

        if (reason)
        {
            emit("{\"event\":\"dropped\",\"id\":" + std::to_string(job.id) + ",\"reason\":" + quote(*reason) + ",\"ms\":" + number(ms) + "}");
            return;
        }

        previousText = text;
        previousEnd = job.end;

        if (options.language.empty() && reported)
        {
            candidateRuns = spoken == candidateLanguage ? candidateRuns + 1 : 1;
            candidateLanguage = spoken;

            if (candidateRuns >= languageLockRuns)
                lockedLanguage = spoken;
        }

        struct transcribe_timings timings;
        transcribe_timings_init(&timings);
        transcribe_get_timings(session, &timings);

        emit("{\"event\":\"utterance\",\"id\":" + std::to_string(job.id) + ",\"text\":" + quote(text) + ",\"language\":" + quote(spoken) +
             ",\"start\":" + number(job.start) + ",\"end\":" + number(job.end) + ",\"ms\":" + number(ms) +
             ",\"encodeMs\":" + number(timings.encode_ms) + ",\"decodeMs\":" + number(timings.decode_ms) + "}");
    }
}
