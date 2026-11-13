#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

namespace speech
{
    constexpr int sampleRate = 16000;

    class Resampler
    {
    public:
        explicit Resampler(int inputRate);

        void push(const float *samples, size_t count, std::vector<float> &out);

    private:
        double step;
        std::vector<float> taps;
        std::vector<float> history;
        std::vector<float> filtered;
        double position = 0;
    };

    struct Clip
    {
        std::vector<float> samples;
        int rate = 0;
    };

    std::optional<Clip> readWav(const std::wstring &path, std::string &error);

    std::vector<float> to16k(const Clip &clip);

    float rms(const float *samples, size_t count);
}
