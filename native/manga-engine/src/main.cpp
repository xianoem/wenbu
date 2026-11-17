// wenbu-manga-engine: the native manga engine. It speaks the manga worker's protocol on stdin and
// stdout, so core runs it the way it runs the Python worker. With --probe it only reports the backend
// and device it would use, as one JSON line, for checking the NVIDIA pack.

#include <cstdio>
#include <cstring>
#include <exception>

#include "Protocol.hpp"
#include "Runtime.hpp"
#include "Service.hpp"

namespace {

int probe() {
    const engine::Runtime runtime(engine::configFromEnvironment().runtime);
    const engine::Json found = {{"backend", engine::nameOf(runtime.backend())}, {"device", runtime.device()}};

    std::printf("%s\n", found.dump().c_str());

    return 0;
}

}

int main(int argc, char** argv) {
    try {
        if (argc > 1 && std::strcmp(argv[1], "--probe") == 0) {
            return probe();
        }

        engine::Events events;
        engine::Service service(events, engine::configFromEnvironment());

        engine::serve(events, [&](const engine::Json& message) { service.handle(message); });
    } catch (const std::exception& error) {
        std::fprintf(stderr, "%s\n", error.what());

        return 1;
    }

    return 0;
}
