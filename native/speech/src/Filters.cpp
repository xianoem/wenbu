#include "Filters.h"

#include <algorithm>
#include <cstdint>
#include <vector>

namespace speech
{
    namespace
    {
        std::vector<char32_t> codepoints(const std::string &text)
        {
            std::vector<char32_t> out;

            for (size_t at = 0; at < text.size();)
            {
                const auto lead = static_cast<unsigned char>(text[at]);
                const int length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
                char32_t value = length == 1 ? lead : lead & (0x3F >> (length - 1));

                for (int extra = 1; extra < length && at + extra < text.size(); ++extra)
                    value = (value << 6) | (static_cast<unsigned char>(text[at + extra]) & 0x3F);

                out.push_back(value);
                at += static_cast<size_t>(length);
            }

            return out;
        }

        bool isFiller(char32_t ch)
        {
            if (ch < 0x80)
                return !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'));

            return (ch >= 0x2000 && ch <= 0x206F) || (ch >= 0x3000 && ch <= 0x303F) || (ch >= 0xFF00 && ch <= 0xFF0F) ||
                   (ch >= 0xFF1A && ch <= 0xFF20) || (ch >= 0xFF3B && ch <= 0xFF40) || (ch >= 0xFF5B && ch <= 0xFF65) || ch == 0x30FB;
        }

        std::vector<char32_t> letters(const std::string &text)
        {
            std::vector<char32_t> kept;

            for (const char32_t ch : codepoints(text))
            {
                if (!isFiller(ch))
                    kept.push_back(ch >= 'A' && ch <= 'Z' ? ch + 32 : ch);
            }

            return kept;
        }

        bool loops(const std::vector<char32_t> &text)
        {
            for (size_t unit = 1; unit <= 12; ++unit)
            {
                for (size_t start = 0; start + unit * 5 <= text.size(); ++start)
                {
                    size_t repeats = 1;

                    while (start + unit * (repeats + 1) <= text.size() &&
                           std::equal(text.begin() + static_cast<std::ptrdiff_t>(start), text.begin() + static_cast<std::ptrdiff_t>(start + unit), text.begin() + static_cast<std::ptrdiff_t>(start + unit * repeats)))
                        ++repeats;

                    if (repeats > 4)
                        return true;
                }
            }

            return false;
        }

        const char *const stockPhrases[] = {
            "ご視聴ありがとうございました",
            "ご視聴ありがとうございます",
            "チャンネル登録",
            "字幕by",
            "最後までご視聴",
            "请不吝点赞订阅",
            "点赞订阅",
            "谢谢观看",
            "字幕由",
            "구독과좋아요",
            "시청해주셔서감사합니다",
            "thanksforwatching",
            "pleasesubscribe",
        };

        bool contains(const std::vector<char32_t> &text, const std::vector<char32_t> &phrase)
        {
            return !phrase.empty() && std::search(text.begin(), text.end(), phrase.begin(), phrase.end()) != text.end();
        }
    }

    std::optional<std::string> dropReason(const Heard &heard, const Previous &previous)
    {
        const auto text = letters(heard.text);

        if (text.empty())
            return "empty";

        if (heard.speechShare < 0.3)
            return "mostly not speech";

        if (loops(text))
            return "repeats itself";

        if (heard.seconds < 3 || heard.level < 0.02f)
        {
            for (const char *phrase : stockPhrases)
            {
                if (contains(text, letters(phrase)))
                    return "stock phrase";
            }
        }

        if (previous.secondsAgo < 3 && text == letters(previous.text))
            return "same as the previous line";

        return std::nullopt;
    }
}
