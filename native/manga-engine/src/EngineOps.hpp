// The Manga Editor's operations on one page, as the worker protocol asks for them: scan, clean, render and
// breaks; picture is not ported yet.
#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <memory>

#include "Inpaint.hpp"
#include "Lettering.hpp"
#include "Protocol.hpp"
#include "Runtime.hpp"
#include "Scanner.hpp"

namespace engine {

struct EngineConfig {
    // The engine folder; models are in its `models` folder.
    std::filesystem::path folder;
    RuntimeOptions runtime;
};

// Reads WENBU_MANGA_ENGINE_DIR, and for development WENBU_MANGA_BACKEND (trt, dml or cpu),
// WENBU_NVIDIA_PACK and WENBU_MANGA_CACHE.
EngineConfig configFromEnvironment();

class EngineOps {
public:
    explicit EngineOps(const EngineConfig& config);

    // The result of an editor request; throws std::runtime_error with a message for the user.
    Json editor(const Json& request);

    Runtime& runtime() { return runtime_; }

    // Whether the warm-up would compile anything: TensorRT-RTX with a cache that was not warmed for this
    // GPU, NVIDIA pack and inpainting size.
    bool needsWarming(int size) const;

    // Compiles every shape pages up to inpainting `size` can give, reporting each step, and marks the
    // cache warm when it finishes. `stop` ends it between steps; returns whether it finished.
    bool warm(int size, const std::function<void(int done, int total)>& progress, const std::atomic<bool>& stop);
    Scanner& scanner() { return *scanner_; }
    Inpainter& inpainter() { return *inpainter_; }
    Lettering& lettering() { return lettering_; }

private:
    Json clean(const Json& request);
    Json render(const Json& request);
    Json picture(const Json& request);
    Json warmOp(const Json& request);
    Json breaks(const Json& request);

    std::filesystem::path models_;
    Runtime runtime_;
    std::unique_ptr<Scanner> scanner_;
    std::unique_ptr<Inpainter> inpainter_;
    Lettering lettering_;
};

}
