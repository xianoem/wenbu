#include "Audio.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>

namespace speech
{
    namespace
    {
        constexpr double pi = 3.14159265358979323846;
        constexpr int tapCount = 63;

        std::vector<float> lowPass(int inputRate)
        {
            std::vector<float> taps(tapCount);
            const double cutoff = 7200.0 / inputRate;
            const int middle = tapCount / 2;
            double sum = 0;

            for (int index = 0; index < tapCount; ++index)
            {
                const int offset = index - middle;
                const double sinc = offset == 0 ? 2 * cutoff : std::sin(2 * pi * cutoff * offset) / (pi * offset);
                const double window = 0.42 - 0.5 * std::cos(2 * pi * index / (tapCount - 1)) + 0.08 * std::cos(4 * pi * index / (tapCount - 1));
                taps[index] = static_cast<float>(sinc * window);
                sum += taps[index];
            }

            for (float &tap : taps)
                tap = static_cast<float>(tap / sum);

            return taps;
        }

        uint32_t readU32(const char *bytes)
        {
            uint32_t value = 0;
            std::memcpy(&value, bytes, 4);
            return value;
        }

        uint16_t readU16(const char *bytes)
        {
            uint16_t value = 0;
            std::memcpy(&value, bytes, 2);
            return value;
        }
    }

    Resampler::Resampler(int inputRate) : step(static_cast<double>(inputRate) / sampleRate)
    {
        if (inputRate != sampleRate)
        {
            taps = lowPass(inputRate);
            history.assign(tapCount - 1, 0.0f);
        }
    }

    void Resampler::push(const float *samples, size_t count, std::vector<float> &out)
    {
        if (taps.empty())
        {
            out.insert(out.end(), samples, samples + count);
            return;
        }

        for (size_t index = 0; index < count; ++index)
        {
            history.push_back(samples[index]);
            float sum = 0;
            const size_t base = history.size() - taps.size();

            for (size_t tap = 0; tap < taps.size(); ++tap)
                sum += taps[tap] * history[base + tap];

            filtered.push_back(sum);
        }

        history.erase(history.begin(), history.end() - static_cast<std::ptrdiff_t>(taps.size() - 1));

        while (position + 1 < static_cast<double>(filtered.size()))
        {
            const size_t whole = static_cast<size_t>(position);
            const float fraction = static_cast<float>(position - static_cast<double>(whole));
            out.push_back(filtered[whole] + (filtered[whole + 1] - filtered[whole]) * fraction);
            position += step;
        }

        const size_t consumed = static_cast<size_t>(position);
        filtered.erase(filtered.begin(), filtered.begin() + static_cast<std::ptrdiff_t>(std::min(consumed, filtered.size())));
        position -= static_cast<double>(consumed);
    }

    std::optional<Clip> readWav(const std::wstring &path, std::string &error)
    {
        std::ifstream file(path, std::ios::binary);

        if (!file)
        {
            error = "The file could not be opened.";
            return std::nullopt;
        }

        const std::string bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

        if (bytes.size() < 12 || bytes.compare(0, 4, "RIFF") != 0 || bytes.compare(8, 4, "WAVE") != 0)
        {
            error = "The file is not a WAV file.";
            return std::nullopt;
        }

        uint16_t format = 0;
        uint16_t channels = 0;
        uint32_t rate = 0;
        uint16_t bits = 0;
        const char *data = nullptr;
        size_t dataSize = 0;

        for (size_t at = 12; at + 8 <= bytes.size();)
        {
            const std::string id = bytes.substr(at, 4);
            const size_t size = readU32(bytes.data() + at + 4);
            const char *body = bytes.data() + at + 8;
            const size_t available = std::min(size, bytes.size() - at - 8);

            if (id == "fmt " && available >= 16)
            {
                format = readU16(body);
                channels = readU16(body + 2);
                rate = readU32(body + 4);
                bits = readU16(body + 14);

                if (format == 0xFFFE && available >= 26)
                    format = readU16(body + 24);
            }
            else if (id == "data")
            {
                data = body;
                dataSize = available;
            }

            at += 8 + size + (size % 2);
        }

        const bool pcm = format == 1 && (bits == 16 || bits == 24 || bits == 32);
        const bool floating = format == 3 && bits == 32;

        if (data == nullptr || channels == 0 || rate == 0 || (!pcm && !floating))
        {
            error = "The WAV file is not 16, 24 or 32-bit PCM or 32-bit float.";
            return std::nullopt;
        }

        const size_t width = bits / 8;
        const size_t frames = dataSize / (width * channels);
        Clip clip;
        clip.rate = static_cast<int>(rate);
        clip.samples.resize(frames);

        for (size_t frame = 0; frame < frames; ++frame)
        {
            double sum = 0;

            for (size_t channel = 0; channel < channels; ++channel)
            {
                const char *sample = data + (frame * channels + channel) * width;

                if (floating)
                {
                    float value = 0;
                    std::memcpy(&value, sample, 4);
                    sum += value;
                }
                else if (bits == 16)
                    sum += static_cast<int16_t>(readU16(sample)) / 32768.0;
                else if (bits == 24)
                {
                    const int32_t value = (static_cast<uint8_t>(sample[0]) << 8) | (static_cast<uint8_t>(sample[1]) << 16) | (static_cast<int8_t>(sample[2]) * 16777216);
                    sum += value / 2147483648.0;
                }
                else
                    sum += static_cast<int32_t>(readU32(sample)) / 2147483648.0;
            }

            clip.samples[frame] = static_cast<float>(sum / channels);
        }

        return clip;
    }

    std::vector<float> to16k(const Clip &clip)
    {
        std::vector<float> out;
        Resampler resampler(clip.rate);
        resampler.push(clip.samples.data(), clip.samples.size(), out);
        return out;
    }

    float rms(const float *samples, size_t count)
    {
        if (count == 0)
            return 0;

        double sum = 0;

        for (size_t index = 0; index < count; ++index)
            sum += static_cast<double>(samples[index]) * samples[index];

        return static_cast<float>(std::sqrt(sum / static_cast<double>(count)));
    }
}
