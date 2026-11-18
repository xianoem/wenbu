// ONNX Runtime for the engine: one backend per process, chosen from the devices ONNX Runtime reports,
// sessions for models, tensors that stay on the GPU between runs, and one thread for all GPU work.
#pragma once

#include <condition_variable>
#include <deque>
#include <filesystem>
#include <functional>
#include <future>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <onnxruntime_cxx_api.h>

namespace engine {

// TensorRT-RTX on NVIDIA RTX 30 and newer when the NVIDIA pack is installed, DirectML on any other
// DirectX 12 GPU, the CPU when there is neither. CUDA and DirectML never share a process: the GPU was
// reset when they did.
enum class Backend { TensorRtRtx, DirectMl, Cpu };

const char* nameOf(Backend backend);

struct RuntimeOptions {
    // The folder of NVIDIA's TensorRT-RTX plugin and the CUDA runtime, or empty.
    std::filesystem::path nvidiaPack;
    // Where TensorRT-RTX keeps compiled models and kernels between runs.
    std::filesystem::path cache;
    // Forces a backend, for tests and for users whose first choice fails.
    std::optional<Backend> backend;
};

// Input shapes for one session. DirectML takes fixed ones as free-dimension overrides, TensorRT-RTX an
// optimisation profile ("name:1x3x2048x1536,other:8x256"): the shape it tunes for, and the smallest and
// largest it accepts (the tuned shape when empty).
struct Shapes {
    std::map<std::string, int64_t> dimensions;
    std::string profile;
    std::string smallest;
    std::string largest;
};

// Urgent work goes before waiting normal work: finding text holds up every page behind it, while LaMa
// runs for pages already finishing.
enum class GpuPriority { Normal, Urgent };

// Runs work on one thread, one task at a time, as the plugin's on_gpu lock does.
class GpuQueue {
public:
    GpuQueue();
    ~GpuQueue();

    template <typename F>
    auto run(F&& work, GpuPriority priority = GpuPriority::Normal) -> decltype(work()) {
        using Result = decltype(work());
        std::packaged_task<Result()> task(std::forward<F>(work));
        std::future<Result> result = task.get_future();

        post([&task] { task(); }, priority);

        return result.get();
    }

    // While a hold lives, only urgent work starts: a reading's many short steps then wait for at most the
    // one LaMa crop already running, instead of for one before each step.
    class Hold {
    public:
        explicit Hold(GpuQueue& queue);
        ~Hold();

        Hold(const Hold&) = delete;
        Hold& operator=(const Hold&) = delete;

    private:
        GpuQueue& queue_;
    };

private:
    void post(std::function<void()> task, GpuPriority priority);

    std::mutex lock_;
    std::condition_variable wake_;
    std::deque<std::function<void()>> urgent_;
    std::deque<std::function<void()>> tasks_;
    int holds_ = 0;
    bool stopping_ = false;
    std::thread thread_;
};

class Runtime {
public:
    explicit Runtime(const RuntimeOptions& options);

    Backend backend() const { return backend_; }
    const std::string& device() const { return device_; }
    const std::filesystem::path& cache() const { return cache_; }
    // The GPU and NVIDIA pack compiled kernels belong to; a cache warmed for others must be warmed again.
    std::string kernelsFor() const { return device_ + "|" + nvidiaStamp_; }

    // A session for a model file, created on the GPU thread. On TensorRT-RTX the model is compiled once
    // into the cache and later sessions load the compiled model.
    Ort::Session session(const std::filesystem::path& model, const Shapes& shapes = {});

    // An uninitialised tensor on the backend's device, for IO binding. TensorRT-RTX allocates it from the
    // environment; DirectML has no shared allocator, so it comes from the session's and must not outlive it.
    Ort::Value deviceTensor(const Ort::Session& session, const std::vector<int64_t>& shape,
                            ONNXTensorElementDataType type);

    // Device memory for binding outputs that ONNX Runtime allocates itself.
    Ort::ConstMemoryInfo deviceMemory() const;

    GpuQueue& gpu() { return gpu_; }

private:
    Ort::SessionOptions sessionOptions(const Shapes& shapes);
    std::filesystem::path compiledPathOf(const std::filesystem::path& model, const Shapes& shapes) const;
    Ort::Session compiledSession(const std::filesystem::path& model, const Shapes& shapes);

    Ort::Env env_;
    Backend backend_ = Backend::Cpu;
    std::optional<Ort::ConstEpDevice> epDevice_;
    Ort::MemoryInfo ownedMemory_{nullptr};
    const OrtMemoryInfo* memory_ = nullptr;
    std::map<const OrtSession*, Ort::Allocator> sessionAllocators_;
    std::string device_;
    std::filesystem::path cache_;
    std::string nvidiaStamp_;
    GpuQueue gpu_;
};

// A model to run on the GPU thread. On DirectML, when <stem>.parts.json lists consecutive parts of it,
// each part is its own session and run: DirectML sends a whole run to the GPU as one submission, and
// Windows resets the GPU when one runs for about 2 seconds.
class Graph {
public:
    Graph(Runtime& runtime, const std::filesystem::path& model, const Shapes& shapes = {});

    std::vector<Ort::Value> run(const std::vector<const char*>& names, const std::vector<const OrtValue*>& values,
                                const std::vector<const char*>& outputs, GpuPriority priority = GpuPriority::Normal);

    size_t parts() const { return parts_.size(); }

private:
    struct Part {
        Ort::Session session;
        std::vector<std::string> inputs;
        std::vector<std::string> outputs;
    };

    Runtime& runtime_;
    std::optional<Ort::Session> whole_;
    std::vector<Part> parts_;
};

// Whether an ONNX Runtime error means the GPU was reset or removed, after which DirectML needs a new device.
bool lostDevice(const std::exception& error);

}
