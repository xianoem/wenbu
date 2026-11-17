#include "Service.hpp"

#include <chrono>
#include <stdexcept>

#include "Runner.hpp"

namespace engine {

namespace {

std::string firstLine(const std::string& message) {
    return message.substr(0, message.find('\n'));
}

}

Service::Service(Events& events, EngineConfig config)
    : events_(events), config_(std::move(config)), ops_(std::make_unique<EngineOps>(config_)) {
    editorThread_ = std::thread([this] { editorLoop(); });
}

Service::~Service() {
    {
        std::scoped_lock guard(editorLock_);

        stopping_ = true;
    }

    editorWake_.notify_one();
    stopRun_ = true;
    stopWarm_ = true;
    failPending("The engine stopped.");

    if (warmThread_.joinable()) {
        warmThread_.join();
    }

    if (editorThread_.joinable()) {
        editorThread_.join();
    }

    if (runThread_.joinable()) {
        runThread_.join();
    }
}

void Service::handle(const Json& message) {
    const std::string type = message.value("type", "");

    if (type == "editor") {
        {
            std::scoped_lock guard(editorLock_);

            editorQueue_.push_back(message);
        }

        editorWake_.notify_one();
    } else if (type == "run") {
        startRun(message);
    } else if (type == "translated") {
        answer(message);
    } else if (type == "warm") {
        startWarm(message);
    } else if (type == "cancel") {
        std::scoped_lock guard(runLock_);

        if (activeRun_ && *activeRun_ == message.value("run", "")) {
            stopRun_ = true;
            failPending("The run was cancelled.");
        }
    }
}

void Service::editorLoop() {
    for (;;) {
        Json message;

        {
            std::unique_lock guard(editorLock_);

            editorWake_.wait(guard, [this] { return stopping_ || !editorQueue_.empty(); });

            if (stopping_) {
                return;
            }

            message = std::move(editorQueue_.front());
            editorQueue_.pop_front();
        }

        editor(message);
    }
}

void Service::editor(const Json& message) {
    const int id = message.value("id", 0);
    bool reset = false;

    {
        std::shared_lock guard(opsLock_);

        try {
            events_.send({{"event", "editor-done"}, {"id", id}, {"result", ops_->editor(message)}});

            return;
        } catch (const std::exception& error) {
            if (!lostDevice(error)) {
                events_.send({{"event", "editor-failed"}, {"id", id}, {"message", firstLine(error.what())}});

                return;
            }

            events_.send({{"event", "editor-failed"},
                          {"id", id},
                          {"message", "The graphics card was reset while this page was processed. Try again."}});
            reset = true;
        }
    }

    std::scoped_lock runGuard(runLock_);

    // Nothing made on a reset device works again, so every session is made anew once no run uses them.
    if (reset && !activeRun_) {
        std::unique_lock guard(opsLock_);

        ops_.reset();
        ops_ = std::make_unique<EngineOps>(config_);
    }
}

void Service::startRun(const Json& message) {
    const std::string run = message.value("run", "");
    std::scoped_lock guard(runLock_);

    if (activeRun_) {
        events_.send({{"event", "run-failed"}, {"run", run}, {"message", "Another run is still going."}});

        return;
    }

    if (runThread_.joinable()) {
        runThread_.join();
    }

    activeRun_ = run;
    stopRun_ = false;
    runThread_ = std::thread([this, message] { runPages(message); });
}

void Service::runPages(const Json& message) {
    const std::string run = message.value("run", "");

    try {
        std::shared_lock guard(opsLock_);
        std::vector<RunPage> pages;

        for (const auto& page : message.value("pages", Json::array())) {
            pages.push_back({pathOf(page.at("source").get<std::string>()), pathOf(page.at("output").get<std::string>())});
        }

        events_.send({{"event", "loading-models"}, {"run", run}});
        events_.send({{"event", "models-loaded"}, {"run", run}, {"device", ops_->runtime().device()}});

        Runner runner(ops_->scanner(), ops_->inpainter(), ops_->lettering());
        const RunResult result = runner.run(
            pages, runSettingsOf(message.value("options", Json::object())),
            [&](Json event) {
                event["run"] = run;
                events_.send(event);
            },
            [&](int page, const std::vector<std::string>& texts) { return translate(run, page, texts); }, stopRun_);

        if (stopRun_) {
            events_.send({{"event", "run-done"}, {"run", run}, {"cancelled", true}});
        } else {
            events_.send({{"event", "run-done"}, {"run", run}, {"cancelled", false}, {"seconds", result.seconds}});
        }
    } catch (const std::exception& error) {
        failPending("The run failed.");
        events_.send({{"event", "run-failed"}, {"run", run}, {"message", firstLine(error.what())}});
    }

    std::scoped_lock guard(runLock_);

    activeRun_.reset();
}

std::vector<std::string> Service::translate(const std::string& run, int page, const std::vector<std::string>& texts) {
    std::future<std::vector<std::string>> answer;
    int id = 0;

    {
        std::scoped_lock guard(pendingLock_);

        if (stopRun_) {
            throw std::runtime_error("The run was cancelled.");
        }

        id = ++nextRequest_;
        answer = pending_[id].get_future();
    }

    events_.send({{"event", "translate"}, {"run", run}, {"id", id}, {"page", page}, {"texts", texts}});

    return answer.get();
}

void Service::answer(const Json& message) {
    std::promise<std::vector<std::string>> promise;

    {
        std::scoped_lock guard(pendingLock_);
        const auto found = pending_.find(message.value("id", 0));

        if (found == pending_.end()) {
            return;
        }

        promise = std::move(found->second);
        pending_.erase(found);
    }

    if (message.contains("error")) {
        promise.set_exception(std::make_exception_ptr(std::runtime_error(message.value("error", std::string("Translation failed.")))));

        return;
    }

    promise.set_value(message.value("translations", std::vector<std::string>{}));
}

// The warm-up compiles every shape before the first page needs it. It runs beside runs and editor requests,
// sharing the GPU, and does nothing once the cache is warm.
void Service::startWarm(const Json& message) {
    std::scoped_lock guard(warmLock_);

    if (warmThread_.joinable()) {
        return;
    }

    warmThread_ = std::thread([this, message] {
        try {
            std::shared_lock guard(opsLock_);
            const Json options = message.value("options", Json::object());
            const auto requested = options.find("inpainting_size");
            const int size = requested != options.end() && requested->is_number() ? requested->get<int>() : 2048;

            if (!ops_->needsWarming(size)) {
                events_.send({{"event", "warm-skipped"}});

                return;
            }

            const auto started = std::chrono::steady_clock::now();
            const bool finished = ops_->warm(
                size, [&](int done, int total) { events_.send({{"event", "warm-progress"}, {"done", done}, {"total", total}}); },
                stopWarm_);

            if (finished) {
                events_.send({{"event", "warm-done"},
                              {"seconds", std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count()}});
            }
        } catch (const std::exception& error) {
            events_.send({{"event", "warm-failed"}, {"message", firstLine(error.what())}});
        }
    });
}

void Service::failPending(const std::string& reason) {
    std::scoped_lock guard(pendingLock_);

    for (auto& [id, promise] : pending_) {
        promise.set_exception(std::make_exception_ptr(std::runtime_error(reason)));
    }

    pending_.clear();
}

}
