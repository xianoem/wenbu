#pragma once

#include <windows.h>

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <optional>
#include <string>

namespace speech
{
    inline std::string utf8(const std::wstring &value)
    {
        if (value.empty())
            return "";

        const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        std::string result(static_cast<size_t>(size), '\0');
        WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
        return result;
    }

    inline std::wstring wide(const std::string &value)
    {
        if (value.empty())
            return L"";

        const int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
        std::wstring result(static_cast<size_t>(size), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size);
        return result;
    }

    inline std::string quote(const std::string &value)
    {
        std::string result = "\"";

        for (const unsigned char ch : value)
        {
            if (ch == '"')
                result += "\\\"";
            else if (ch == '\\')
                result += "\\\\";
            else if (ch == '\n')
                result += "\\n";
            else if (ch == '\r')
                result += "\\r";
            else if (ch == '\t')
                result += "\\t";
            else if (ch < 0x20)
            {
                char escaped[8];
                std::snprintf(escaped, sizeof(escaped), "\\u%04x", ch);
                result += escaped;
            }
            else
                result += static_cast<char>(ch);
        }

        return result + "\"";
    }

    inline std::string number(double value)
    {
        char buffer[32];
        std::snprintf(buffer, sizeof(buffer), "%.6g", value);
        return buffer;
    }

    class Command
    {
    public:
        explicit Command(const std::string &line) : text(line) { parse(); }

        std::optional<std::string> string(const std::string &key) const
        {
            const auto found = strings.find(key);
            return found == strings.end() ? std::nullopt : std::optional<std::string>(found->second);
        }

        std::optional<double> number(const std::string &key) const
        {
            const auto found = numbers.find(key);
            return found == numbers.end() ? std::nullopt : std::optional<double>(found->second);
        }

    private:
        const std::string &text;
        size_t at = 0;
        std::map<std::string, std::string> strings;
        std::map<std::string, double> numbers;

        void skipSpace()
        {
            while (at < text.size() && std::isspace(static_cast<unsigned char>(text[at])))
                ++at;
        }

        bool consume(char expected)
        {
            skipSpace();

            if (at >= text.size() || text[at] != expected)
                return false;

            ++at;
            return true;
        }

        std::optional<unsigned> hex4()
        {
            if (at + 4 > text.size())
                return std::nullopt;

            unsigned value = 0;

            for (int index = 0; index < 4; ++index)
            {
                const char ch = text[at++];
                value <<= 4;

                if (ch >= '0' && ch <= '9')
                    value |= static_cast<unsigned>(ch - '0');
                else if (ch >= 'a' && ch <= 'f')
                    value |= static_cast<unsigned>(ch - 'a' + 10);
                else if (ch >= 'A' && ch <= 'F')
                    value |= static_cast<unsigned>(ch - 'A' + 10);
                else
                    return std::nullopt;
            }

            return value;
        }

        std::optional<std::string> parseString()
        {
            if (!consume('"'))
                return std::nullopt;

            std::wstring result;
            std::string run;

            const auto flush = [&]()
            {
                result += wide(run);
                run.clear();
            };

            while (at < text.size())
            {
                const char ch = text[at++];

                if (ch == '"')
                {
                    flush();
                    return utf8(result);
                }

                if (ch != '\\')
                {
                    run += ch;
                    continue;
                }

                if (at >= text.size())
                    return std::nullopt;

                const char escape = text[at++];

                if (escape == 'u')
                {
                    const auto code = hex4();

                    if (!code)
                        return std::nullopt;

                    flush();
                    result += static_cast<wchar_t>(*code);
                    continue;
                }

                const std::string simple = "\"\\/bfnrt";
                const std::string decoded = "\"\\/\b\f\n\r\t";
                const auto position = simple.find(escape);

                if (position == std::string::npos)
                    return std::nullopt;

                run += decoded[position];
            }

            return std::nullopt;
        }

        void parse()
        {
            if (!consume('{'))
                return;

            while (true)
            {
                const auto key = parseString();

                if (!key || !consume(':'))
                    return;

                skipSpace();

                if (at < text.size() && text[at] == '"')
                {
                    const auto value = parseString();

                    if (!value)
                        return;

                    strings[*key] = *value;
                }
                else
                {
                    char *end = nullptr;
                    const char *start = text.c_str() + at;
                    numbers[*key] = std::strtod(start, &end);

                    if (end == start)
                        return;

                    at += static_cast<size_t>(end - start);
                }

                if (!consume(','))
                    return;
            }
        }
    };
}
