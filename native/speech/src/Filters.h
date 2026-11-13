#pragma once

#include <optional>
#include <string>

namespace speech
{
    struct Heard
    {
        std::string text;
        double seconds = 0;
        double speechShare = 1;
        float level = 0;
    };

    struct Previous
    {
        std::string text;
        double secondsAgo = 1e9;
    };

    std::optional<std::string> dropReason(const Heard &heard, const Previous &previous);
}
