// The worker protocol's side of the engine: editor requests run one at a time on their own thread, a folder
// run on another, the warm-up on a third, and the stdin loop stays free for translations and cancels while
// they work.
#pragma once

#include <atomic>
#include <condition_variable>
#include <deque>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <thread>

#include "EngineOps.hpp"
#include "Protocol.hpp"

namespace engine {

class Service {
public:
    Service(Events& events, EngineConfig config);
    ~Service();

    void handle(const Json& message);

private:
    void editorLoop();
    void editor(const Json& message);
    void startRun(const Json& message);
    void runPages(const Json& message);
    std::vector<std::string> translate(const std::string& run, int page, const std::vector<std::string>& texts);
    void answer(const Json& message);
    void failPending(const std::string& reason);
    void startWarm(const Json& message);

    Events& events_;
    EngineConfig config_;

    // Shared by editor requests and runs; held alone only to make every session anew after a GPU reset.
    std::shared_mutex opsLock_;
    std::unique_ptr<EngineOps> ops_;

    std::mutex editorLock_;
    std::condition_variable editorWake_;
    std::deque<Json> editorQueue_;
    bool stopping_ = false;
    std::thread editorThread_;

    std::mutex runLock_;
    std::optional<std::string> activeRun_;
    std::atomic<bool> stopRun_{false};
    std::thread runThread_;

    std::mutex warmLock_;
    std::atomic<bool> stopWarm_{false};
    std::thread warmThread_;

    std::mutex pendingLock_;
    std::map<int, std::promise<std::vector<std::string>>> pending_;
    int nextRequest_ = 0;
};

}
