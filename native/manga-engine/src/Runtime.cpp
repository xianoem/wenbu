#include "Runtime.hpp"

#include "Images.hpp"
#include "Protocol.hpp"

#include <algorithm>
#include <fstream>
#include <map>
#include <cstdio>
#include <stdexcept>

namespace engine {

namespace {

constexpr const char* nvidiaEp = "NvTensorRTRTXExecutionProvider";
constexpr const char* nvidiaLibrary = "onnxruntime_providers_nv_tensorrt_rtx.dll";
constexpr const char* directMlEp = "DmlExecutionProvider";

// Windows' high-performance order of an adapter (0 first), from the device's metadata.
int performanceRank(const Ort::ConstEpDevice& device) {
    const char* rank = device.Device().Metadata().GetValue("DxgiHighPerformanceIndex");

    return rank == nullptr ? 1000 : std::atoi(rank);
}

std::string descriptionOf(const Ort::ConstEpDevice& device) {
    const char* description = device.Device().Metadata().GetValue("Description");

    return description == nullptr ? std::string(device.EpName()) : std::string(description);
}

std::optional<Ort::ConstEpDevice> fastest(const std::vector<Ort::ConstEpDevice>& devices, const char* ep) {
    std::optional<Ort::ConstEpDevice> best;

    for (const auto& device : devices) {
        if (std::string(device.EpName()) == ep && (!best || performanceRank(device) < performanceRank(*best))) {
            best = device;
        }
    }

    return best;
}

int adapterOf(const Ort::ConstEpDevice& device) {
    const char* adapter = device.Device().Metadata().GetValue("DxgiAdapterNumber");

    return adapter == nullptr ? 0 : std::atoi(adapter);
}

std::string stampOf(const std::filesystem::path& file) {
    std::error_code error;
    const auto size = std::filesystem::file_size(file, error);
    const auto time = std::filesystem::last_write_time(file, error).time_since_epoch().count();

    return std::to_string(size) + ":" + std::to_string(time);
}

// FNV-1a, so compiled model names stay the same across builds of the engine.
std::string hashOf(const std::string& text) {
    uint64_t hash = 14695981039346656037ull;

    for (const char c : text) {
        hash = (hash ^ static_cast<uint8_t>(c)) * 1099511628211ull;
    }

    char hex[17];

    std::snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(hash));

    return hex;
}

std::string utf8(const std::filesystem::path& path) {
    const std::u8string text = path.u8string();

    return std::string(text.begin(), text.end());
}

}

const char* nameOf(Backend backend) {
    switch (backend) {
    case Backend::TensorRtRtx:
        return "TensorRT-RTX";
    case Backend::DirectMl:
        return "DirectML";
    case Backend::Cpu:
        return "CPU";
    }

    return "CPU";
}

GpuQueue::GpuQueue() {
    thread_ = std::thread([this] {
        for (;;) {
            std::function<void()> task;

            {
                std::unique_lock guard(lock_);

                wake_.wait(guard, [this] { return stopping_ || !urgent_.empty() || (holds_ == 0 && !tasks_.empty()); });

                if (stopping_ && urgent_.empty() && tasks_.empty()) {
                    return;
                }

                std::deque<std::function<void()>>& next = urgent_.empty() ? tasks_ : urgent_;

                task = std::move(next.front());
                next.pop_front();
            }

            task();
        }
    });
}

GpuQueue::~GpuQueue() {
    {
        std::scoped_lock guard(lock_);

        stopping_ = true;
    }

    wake_.notify_one();
    thread_.join();
}

GpuQueue::Hold::Hold(GpuQueue& queue) : queue_(queue) {
    std::scoped_lock guard(queue_.lock_);

    queue_.holds_++;
}

GpuQueue::Hold::~Hold() {
    {
        std::scoped_lock guard(queue_.lock_);

        queue_.holds_--;
    }

    queue_.wake_.notify_one();
}

void GpuQueue::post(std::function<void()> task, GpuPriority priority) {
    {
        std::scoped_lock guard(lock_);

        (priority == GpuPriority::Urgent ? urgent_ : tasks_).push_back(std::move(task));
    }

    wake_.notify_one();
}

Runtime::Runtime(const RuntimeOptions& options)
    : env_(ORT_LOGGING_LEVEL_WARNING, "wenbu-manga-engine"), cache_(options.cache) {
    const bool wantsNvidia = !options.backend || *options.backend == Backend::TensorRtRtx;
    // Windows looks for a relative library beside the engine, not in the working folder.
    const std::filesystem::path nvidia =
        options.nvidiaPack.empty() ? std::filesystem::path() : std::filesystem::absolute(options.nvidiaPack) / nvidiaLibrary;

    if (wantsNvidia && !nvidia.empty() && std::filesystem::exists(nvidia)) {
        try {
            env_.RegisterExecutionProviderLibrary(nvidiaEp, nvidia.wstring());
            nvidiaStamp_ = stampOf(nvidia);
        } catch (const Ort::Exception& error) {
            std::fprintf(stderr, "The NVIDIA pack could not be loaded: %s\n", error.what());
        }
    }

    const std::vector<Ort::ConstEpDevice> devices = env_.GetEpDevices();

    if (wantsNvidia) {
        epDevice_ = fastest(devices, nvidiaEp);
        backend_ = Backend::TensorRtRtx;
    }

    if (!epDevice_ && (!options.backend || *options.backend == Backend::DirectMl)) {
        epDevice_ = fastest(devices, directMlEp);
        backend_ = Backend::DirectMl;
    }

    if (!epDevice_) {
        backend_ = Backend::Cpu;
        device_ = "CPU";

        return;
    }

    device_ = descriptionOf(*epDevice_);

    // ONNX Runtime 1.24 reports no memory for the DirectML device, so it is named as the DirectML
    // provider names it: by adapter number.
    memory_ = epDevice_->GetMemoryInfo(OrtDeviceMemoryType_DEFAULT);

    if (memory_ == nullptr && backend_ == Backend::DirectMl) {
        ownedMemory_ = Ort::MemoryInfo("DML", OrtDeviceAllocator, adapterOf(*epDevice_), OrtMemTypeDefault);
        memory_ = ownedMemory_;
    }

    if (!cache_.empty()) {
        std::filesystem::create_directories(cache_ / "kernels");
        std::filesystem::create_directories(cache_ / "models");
    }
}

Ort::SessionOptions Runtime::sessionOptions(const Shapes& shapes) {
    Ort::SessionOptions options;

    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

    if (backend_ == Backend::DirectMl) {
        // DirectML needs these: it runs one operator stream and plans its own memory.
        options.DisableMemPattern();
        options.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);

        for (const auto& [name, value] : shapes.dimensions) {
            options.AddFreeDimensionOverrideByName(name.c_str(), value);
        }
    }

    if (epDevice_) {
        std::unordered_map<std::string, std::string> providerOptions;

        if (backend_ == Backend::TensorRtRtx) {
            if (!cache_.empty()) {
                providerOptions["nv_runtime_cache_path"] = utf8(cache_ / "kernels");
            }

            if (!shapes.profile.empty()) {
                providerOptions["nv_profile_min_shapes"] = shapes.smallest.empty() ? shapes.profile : shapes.smallest;
                providerOptions["nv_profile_opt_shapes"] = shapes.profile;
                providerOptions["nv_profile_max_shapes"] = shapes.largest.empty() ? shapes.profile : shapes.largest;
            }
        }

        options.AppendExecutionProvider_V2(env_, {*epDevice_}, providerOptions);
    }

    return options;
}

// The compiled model is named after everything it was compiled from: the model file, the input shapes, the
// device, and the NVIDIA plugin, so a new driver pack or model download compiles again.
std::filesystem::path Runtime::compiledPathOf(const std::filesystem::path& model, const Shapes& shapes) const {
    std::string key = utf8(model.filename()) + "|" + stampOf(model) + "|" + shapes.smallest + "|" + shapes.profile + "|" +
                      shapes.largest + "|" + device_ + "|" + nvidiaStamp_;

    return cache_ / "models" / (model.stem().string() + "-" + hashOf(key) + ".onnx");
}

Ort::Session Runtime::compiledSession(const std::filesystem::path& model, const Shapes& shapes) {
    const std::filesystem::path compiled = compiledPathOf(model, shapes);

    if (std::filesystem::exists(compiled)) {
        try {
            return Ort::Session(env_, compiled.wstring().c_str(), sessionOptions(shapes));
        } catch (const Ort::Exception& error) {
            std::fprintf(stderr, "Compiling %s again: %s\n", model.filename().string().c_str(), error.what());
            std::filesystem::remove(compiled);
        }
    }

    std::filesystem::path partial = compiled;

    partial += ".partial";

    const Ort::SessionOptions options = sessionOptions(shapes);
    Ort::ModelCompilationOptions compilation(env_, options);

    compilation.SetInputModelPath(model.wstring().c_str());
    compilation.SetOutputModelPath(partial.wstring().c_str());
    compilation.SetEpContextEmbedMode(true);
    Ort::ThrowOnError(Ort::CompileModel(env_, compilation));
    std::filesystem::rename(partial, compiled);

    return Ort::Session(env_, compiled.wstring().c_str(), sessionOptions(shapes));
}

Ort::Session Runtime::session(const std::filesystem::path& model, const Shapes& shapes) {
    return gpu_.run([&] {
        if (backend_ == Backend::TensorRtRtx && !cache_.empty()) {
            return compiledSession(model, shapes);
        }

        return Ort::Session(env_, model.wstring().c_str(), sessionOptions(shapes));
    });
}

Ort::ConstMemoryInfo Runtime::deviceMemory() const {
    if (memory_ == nullptr) {
        throw std::runtime_error("There is no GPU to keep tensors on.");
    }

    return Ort::ConstMemoryInfo{memory_};
}

Ort::Value Runtime::deviceTensor(const Ort::Session& session, const std::vector<int64_t>& shape,
                                 ONNXTensorElementDataType type) {
    Ort::UnownedAllocator shared = env_.GetSharedAllocator(deviceMemory());

    if (shared != nullptr) {
        return Ort::Value::CreateTensor(shared, shape.data(), shape.size(), type);
    }

    auto found = sessionAllocators_.find(session);

    if (found == sessionAllocators_.end()) {
        found = sessionAllocators_.emplace(session, Ort::Allocator(session, deviceMemory())).first;
    }

    return Ort::Value::CreateTensor(found->second, shape.data(), shape.size(), type);
}

Graph::Graph(Runtime& runtime, const std::filesystem::path& model, const Shapes& shapes) : runtime_(runtime) {
    std::filesystem::path manifest = model;

    manifest.replace_extension(".parts.json");

    if (runtime.backend() != Backend::DirectMl || !std::filesystem::exists(manifest)) {
        whole_.emplace(runtime.session(model, shapes));

        return;
    }

    std::ifstream file(manifest, std::ios::binary);
    const nlohmann::json listed = nlohmann::json::parse(file);

    for (const auto& part : listed.at("parts")) {
        parts_.push_back({runtime.session(model.parent_path() / pathOf(part.at("file").get<std::string>()), shapes),
                          part.at("inputs").get<std::vector<std::string>>(),
                          part.at("outputs").get<std::vector<std::string>>()});
    }
}

std::vector<Ort::Value> Graph::run(const std::vector<const char*>& names, const std::vector<const OrtValue*>& values,
                                   const std::vector<const char*>& outputs, GpuPriority priority) {
    const OrtApi& api = Ort::GetApi();

    const auto runOne = [&](Ort::Session& session, const std::vector<const char*>& inputNames,
                            const std::vector<const OrtValue*>& inputValues, const std::vector<const char*>& outputNames) {
        std::vector<OrtValue*> results(outputNames.size(), nullptr);

        runtime_.gpu().run(
            [&] {
                Ort::ThrowOnError(api.Run(session, nullptr, inputNames.data(), inputValues.data(), inputNames.size(),
                                          outputNames.data(), outputNames.size(), results.data()));
            },
            priority);

        std::vector<Ort::Value> owned;

        for (OrtValue* result : results) {
            owned.emplace_back(result);
        }

        return owned;
    };

    if (whole_) {
        return runOne(*whole_, names, values, outputs);
    }

    std::map<std::string, const OrtValue*> given;
    std::map<std::string, Ort::Value> made;
    std::map<std::string, size_t> lastUse;

    for (size_t i = 0; i < names.size(); i++) {
        given[names[i]] = values[i];
    }

    for (size_t k = 0; k < parts_.size(); k++) {
        for (const auto& name : parts_[k].inputs) {
            lastUse[name] = k;
        }
    }

    for (const char* output : outputs) {
        lastUse[output] = parts_.size();
    }

    for (size_t k = 0; k < parts_.size(); k++) {
        Part& part = parts_[k];
        std::vector<const char*> inputNames;
        std::vector<const OrtValue*> inputValues;
        std::vector<const char*> outputNames;

        for (const auto& name : part.inputs) {
            const auto fromMade = made.find(name);

            inputNames.push_back(name.c_str());
            inputValues.push_back(fromMade != made.end() ? static_cast<const OrtValue*>(fromMade->second) : given.at(name));
        }

        for (const auto& name : part.outputs) {
            outputNames.push_back(name.c_str());
        }

        std::vector<Ort::Value> results = runOne(part.session, inputNames, inputValues, outputNames);

        for (size_t i = 0; i < results.size(); i++) {
            made.insert_or_assign(part.outputs[i], std::move(results[i]));
        }

        // Large intermediate tensors go as soon as no later part reads them.
        for (auto it = made.begin(); it != made.end();) {
            const auto use = lastUse.find(it->first);

            it = use == lastUse.end() || use->second <= k ? made.erase(it) : std::next(it);
        }
    }

    std::vector<Ort::Value> results;

    for (const char* output : outputs) {
        results.push_back(std::move(made.at(output)));
    }

    return results;
}

bool lostDevice(const std::exception& error) {
    const std::string message = error.what();

    for (const char* code : {"887A0005", "887A0006", "887A0007", "887A0020", "DEVICE_REMOVED", "DEVICE_HUNG"}) {
        if (message.find(code) != std::string::npos) {
            return true;
        }
    }

    return false;
}

}
