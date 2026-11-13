#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

struct transcribe_model;
struct transcribe_session;
struct transcribe_vad_session;
struct transcribe_device_info;

namespace speech
{
    std::string deviceType(const transcribe_device_info &info);
    std::string deviceName(const transcribe_device_info &info);

    struct ListenOptions
    {
        std::wstring modelPath;
        std::wstring vadPath;
        std::string language;
        std::string device = "auto";
        double threshold = 0.5;
        int pauseMs = 400;
        bool partials = true;
    };

    using Emit = std::function<void(const std::string &json)>;

    class Listener
    {
    public:
        explicit Listener(Emit emit);
        ~Listener();

        std::optional<std::string> load(const ListenOptions &options);

        void feed(const float *samples, size_t count);

        void setPaused(bool paused);

        void reset();

        void finish();

    private:
        struct Job
        {
            long long id = 0;
            bool partial = false;
            std::vector<float> audio;
            double start = 0;
            double end = 0;
            double speechShare = 1;
            float level = 0;
        };

        Emit emit;
        ListenOptions options;
        transcribe_model *vadModel = nullptr;
        transcribe_vad_session *vad = nullptr;
        transcribe_model *model = nullptr;
        transcribe_session *session = nullptr;

        std::mutex stateLock;
        bool paused = false;
        std::vector<float> audio;
        long long audioStart = 0;
        long long fed = 0;
        long long vadFrames = 0;
        std::vector<float> levelWindow;

        bool speaking = false;
        long long speechStart = 0;
        long long lastSpeech = 0;
        long long nextPartial = 0;
        std::vector<float> utteranceProbs;
        long long nextId = 1;

        std::mutex queueLock;
        std::condition_variable queueChanged;
        std::deque<Job> finals;
        std::optional<Job> pendingPartial;
        bool working = false;
        bool quitting = false;
        std::atomic<bool> partialsEnabled{true};
        int slowPartials = 0;
        std::thread recogniser;

        std::string lockedLanguage;
        std::string candidateLanguage;
        int candidateRuns = 0;
        std::string previousText;
        double previousEnd = -1e9;

        void onProbabilities(const float *probs, int count, long long firstFrame);
        void closeUtterance(long long endSample);
        std::vector<float> slice(long long from, long long to) const;
        void enqueue(Job job);
        void recognise();
        void runJob(Job &job);
        void trimAudio();
    };
}
