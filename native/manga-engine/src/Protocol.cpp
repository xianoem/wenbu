#include "Protocol.hpp"

#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <iostream>

namespace engine {

void Events::send(const Json& event) {
    // ensure_ascii off: core reads UTF-8, as it does from the Python worker.
    const std::string line = event.dump(-1, ' ', false, Json::error_handler_t::replace) + "\n";
    std::scoped_lock guard(lock_);

    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fflush(stdout);
}

void serve(Events& events, const std::function<void(const Json&)>& handle) {
    // Binary mode keeps Windows from turning \n into \r\n on the way out.
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);

    events.send({{"event", "ready"}, {"protocol", protocolVersion}});

    std::string line;

    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        if (line.empty()) {
            continue;
        }

        const Json message = Json::parse(line, nullptr, false);

        if (message.is_discarded() || !message.is_object()) {
            events.send({{"event", "error"}, {"message", "Wenbu sent a message the engine could not read."}});

            continue;
        }

        handle(message);
    }
}

}
