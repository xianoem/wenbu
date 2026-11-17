// The worker protocol the Python manga worker speaks (version 2): one JSON object per line, requests on
// stdin and events on stdout. Logs go to stderr.
#pragma once

#include <functional>
#include <mutex>
#include <string>

#include <json.hpp>

namespace engine {

using Json = nlohmann::json;

inline constexpr int protocolVersion = 2;

// Writes events to stdout, one per line, from any thread.
class Events {
public:
    void send(const Json& event);

private:
    std::mutex lock_;
};

// Reads requests until stdin closes. Lines that are not JSON objects are reported as an `error` event.
void serve(Events& events, const std::function<void(const Json&)>& handle);

}
