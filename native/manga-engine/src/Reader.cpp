#include "Reader.hpp"

#include <algorithm>
#include <array>
#include <limits>
#include <mutex>
#include <stdexcept>

#include <opencv2/core/utility.hpp>

#include "ReaderInput.hpp"

namespace engine {

namespace {

constexpr int64_t eos = 16002;
constexpr int64_t pad = 16000;
constexpr int64_t bos = 16001;
constexpr int64_t batch = 8;
// The model reads at most 192 tokens. The chunk graph gives 25 and each continuation 24, so the last
// continuation's final token is dropped; the step graph checks for repetition at the same token counts.
constexpr size_t firstChunk = 25;
constexpr size_t chunk = 24;
constexpr size_t maxTokens = 192;
// Crops larger than this get 512 patches; smaller ones read better at 256.
constexpr int largeCrop = 1024 * 1024;

constexpr size_t minRepeats = 4;
constexpr size_t minRepeatedTokens = 16;
constexpr size_t maxPeriod = 8;

struct Row {
    std::vector<int64_t> ids;
    std::vector<float> logprobs;
    bool done = false;
    bool repeated = false;

    void take(int64_t id, float logprob) {
        if (done) {
            return;
        }

        if (id == pad) {
            done = true;

            return;
        }

        ids.push_back(id);
        logprobs.push_back(logprob);

        if (id == eos) {
            done = true;
        }
    }

    void guard() {
        if (done) {
            return;
        }

        if (const std::optional<Repetition> repetition = repetitionAt(ids)) {
            ids.resize(repetition->start + repetition->period * 2);
            logprobs.resize(repetition->start + repetition->period * 2);
            done = true;
            repeated = true;
        }
    }
};

struct BatchInput {
    std::vector<uint8_t> pixels;
    std::vector<float> weights;
    std::vector<int64_t> shapes;
    std::vector<uint8_t> active;
};

BatchInput prepare(int patches, const std::vector<const Rgb*>& crops) {
    BatchInput input;

    input.pixels.assign(static_cast<size_t>(batch) * patches * patchBytes, 0);
    input.weights.assign(static_cast<size_t>(batch) * patches * positionCells, 0.0f);
    input.shapes.assign(static_cast<size_t>(batch) * 2, 1);
    input.active.assign(batch, 0);

    cv::parallel_for_(cv::Range(0, static_cast<int>(crops.size())), [&](const cv::Range& range) {
        for (int index = range.start; index < range.end; index++) {
            const Patches patched = patchify(*crops[index], patches);
            const std::vector<float> weights = positionWeights(patched.size.rows, patched.size.columns);

            std::copy(patched.pixels.begin(), patched.pixels.end(),
                      input.pixels.begin() + static_cast<size_t>(index) * patches * patchBytes);
            std::copy(weights.begin(), weights.end(),
                      input.weights.begin() + static_cast<size_t>(index) * patches * positionCells);
            input.shapes[static_cast<size_t>(index) * 2] = patched.size.rows;
            input.shapes[static_cast<size_t>(index) * 2 + 1] = patched.size.columns;
            input.active[index] = 1;
        }
    });

    return input;
}

const Ort::MemoryInfo& cpu() {
    static const Ort::MemoryInfo memory = Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeDefault);

    return memory;
}

template <typename T>
Ort::Value tensorOver(std::vector<T>& data, const std::vector<int64_t>& shape, ONNXTensorElementDataType type) {
    return Ort::Value::CreateTensor(cpu(), data.data(), data.size() * sizeof(T), shape.data(), shape.size(), type);
}

Ort::Value scalar(int64_t& value) {
    return Ort::Value::CreateTensor(cpu(), &value, sizeof(int64_t), nullptr, 0, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64);
}

std::vector<Reading> readingsOf(const std::vector<Row>& rows, const Tokenizer& tokenizer) {
    std::vector<Reading> readings;

    for (const Row& row : rows) {
        double total = 0;

        for (const float logprob : row.logprobs) {
            total += logprob;
        }

        readings.push_back({tokenizer.decode(row.ids),
                            row.logprobs.empty() ? -std::numeric_limits<double>::infinity()
                                                 : total / static_cast<double>(row.logprobs.size()),
                            row.repeated, !row.done});
    }

    return readings;
}

}

std::optional<Repetition> repetitionAt(const std::vector<int64_t>& ids) {
    for (size_t period = 1; period <= maxPeriod; period++) {
        size_t copies = 1;

        while ((copies + 1) * period <= ids.size() &&
               std::equal(ids.end() - static_cast<long>((copies + 1) * period),
                          ids.end() - static_cast<long>(copies * period), ids.end() - static_cast<long>(period))) {
            copies++;
        }

        if (copies >= minRepeats && copies * period >= minRepeatedTokens) {
            return Repetition{period, ids.size() - copies * period};
        }
    }

    return std::nullopt;
}

struct Reader::Graphs {
    int patches = 0;
    // TensorRT-RTX: the prefill and step sessions, bound to device memory.
    std::optional<Ort::Session> first;
    std::optional<Ort::Session> next;
    // Elsewhere: the chunk and continuation graphs, in parts on DirectML.
    std::optional<Graph> chunk;
    std::optional<Graph> cont;
    // TensorRT-RTX only: the key/value caches the prefill fills and the steps swap, and the valid mask.
    std::vector<Ort::Value> cache;
    std::optional<Ort::Value> valid;
};

Reader::Reader(Runtime& runtime, const std::filesystem::path& models)
    : runtime_(runtime), models_(models), tokenizer_(models / "reader-tokenizer.json") {}

Reader::~Reader() = default;

Reader::Graphs& Reader::graphsFor(int patches) {
    if (auto found = graphs_.find(patches); found != graphs_.end()) {
        return *found->second;
    }

    auto graphs = std::make_unique<Graphs>();
    const std::string bucket = std::to_string(patches) + "-b" + std::to_string(batch);

    graphs->patches = patches;

    if (runtime_.backend() == Backend::TensorRtRtx) {
        graphs->first.emplace(runtime_.session(models_ / ("reader-prefill-" + bucket + ".onnx")));
        graphs->next.emplace(runtime_.session(models_ / ("reader-step-" + bucket + ".onnx")));

        const std::vector<int64_t> cacheShape = graphs->next->GetInputTypeInfo(2).GetTensorTypeAndShapeInfo().GetShape();
        const int64_t positions = cacheShape[3];

        for (int i = 0; i < 4; i++) {
            graphs->cache.push_back(runtime_.deviceTensor(*graphs->first, cacheShape, ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT16));
        }

        graphs->valid.emplace(runtime_.deviceTensor(*graphs->first, {batch, positions}, ONNX_TENSOR_ELEMENT_DATA_TYPE_BOOL));
    } else {
        graphs->chunk.emplace(runtime_, models_ / ("reader-chunk-" + bucket + ".onnx"));
        graphs->cont.emplace(runtime_, models_ / ("reader-cont-" + bucket + ".onnx"));
    }

    return *graphs_.emplace(patches, std::move(graphs)).first->second;
}

void Reader::warm() {
    for (const int side : {64, 1100}) {
        read(std::vector<Rgb>(batch, Rgb{side, side, std::vector<uint8_t>(static_cast<size_t>(side) * side * 3, 255)}));
    }
}

std::vector<Reading> Reader::readBatch(int patches, const std::vector<const Rgb*>& crops) {
    Graphs& graphs = graphsFor(patches);
    BatchInput input = prepare(patches, crops);
    const GpuQueue::Hold hold(runtime_.gpu());
    std::vector<Row> rows(crops.size());
    int64_t bosToken = bos;
    std::vector<Ort::Value> feeds;

    feeds.push_back(tensorOver(input.pixels, {batch, patches, patchBytes}, ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT8));
    feeds.push_back(tensorOver(input.weights, {batch, patches, positionCells}, ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT));
    feeds.push_back(tensorOver(input.shapes, {batch, 2}, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64));

    const auto unfinished = [&] {
        std::vector<uint8_t> flags(batch, 0);

        for (size_t i = 0; i < rows.size(); i++) {
            flags[i] = rows[i].done ? 0 : 1;
        }

        return flags;
    };

    const auto anyReading = [&] { return std::any_of(rows.begin(), rows.end(), [](const Row& row) { return !row.done; }); };

    if (runtime_.backend() == Backend::TensorRtRtx) {
        std::vector<int64_t> token(batch, pad);
        size_t current = 0;

        feeds.push_back(scalar(bosToken));

        runtime_.gpu().run([&] {
            Ort::IoBinding binding(*graphs.first);
            const std::array<const char*, 4> names = {"pixels", "pos_weights", "spatial_shapes", "bos"};

            for (size_t i = 0; i < names.size(); i++) {
                binding.BindInput(names[i], feeds[i]);
            }

            binding.BindOutput("first", cpu());
            binding.BindOutput("first_logprob", cpu());
            binding.BindOutput("kc", graphs.cache[0]);
            binding.BindOutput("vc", graphs.cache[1]);
            binding.BindOutput("valid_t", *graphs.valid);
            graphs.first->Run(Ort::RunOptions{nullptr}, binding);
            binding.SynchronizeOutputs();

            const std::vector<Ort::Value> outputs = binding.GetOutputValues();
            const int64_t* ids = outputs[0].GetTensorData<int64_t>();
            const float* logprobs = outputs[1].GetTensorData<float>();

            for (size_t i = 0; i < rows.size(); i++) {
                rows[i].take(ids[i], logprobs[i]);
            }

            std::copy(ids, ids + batch, token.begin());
        }, GpuPriority::Urgent);

        std::array<int64_t, 2> stops = {eos, pad};
        size_t steps = 1;

        while (anyReading() && steps < maxTokens) {
            std::vector<uint8_t> flags = unfinished();
            int64_t step = static_cast<int64_t>(steps);
            const size_t following = current == 0 ? 2 : 0;

            runtime_.gpu().run([&] {
                Ort::IoBinding binding(*graphs.next);
                const int64_t stopShape = 2;
                const Ort::Value tokens = tensorOver(token, {batch}, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64);
                const Ort::Value stepValue = scalar(step);
                const Ort::Value flagsValue = tensorOver(flags, {batch}, ONNX_TENSOR_ELEMENT_DATA_TYPE_BOOL);
                const Ort::Value stopsValue = Ort::Value::CreateTensor(cpu(), stops.data(), sizeof(stops), &stopShape, 1,
                                                                       ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64);

                binding.BindInput("tok", tokens);
                binding.BindInput("step", stepValue);
                binding.BindInput("unfinished", flagsValue);
                binding.BindInput("eos_pad", stopsValue);
                binding.BindInput("kc", graphs.cache[current]);
                binding.BindInput("vc", graphs.cache[current + 1]);
                binding.BindInput("valid_t", *graphs.valid);
                binding.BindOutput("nxt", cpu());
                binding.BindOutput("logprob", cpu());
                binding.BindOutput("kc_out", graphs.cache[following]);
                binding.BindOutput("vc_out", graphs.cache[following + 1]);
                graphs.next->Run(Ort::RunOptions{nullptr}, binding);
                binding.SynchronizeOutputs();

                const std::vector<Ort::Value> outputs = binding.GetOutputValues();
                const int64_t* ids = outputs[0].GetTensorData<int64_t>();
                const float* logprobs = outputs[1].GetTensorData<float>();

                for (size_t i = 0; i < rows.size(); i++) {
                    rows[i].take(ids[i], logprobs[i]);
                }

                std::copy(ids, ids + batch, token.begin());
            }, GpuPriority::Urgent);

            current = following;
            steps++;

            if (steps == maxTokens || (steps >= firstChunk && (steps - firstChunk) % chunk == 0)) {
                for (Row& row : rows) {
                    row.guard();
                }
            }
        }

        return readingsOf(rows, tokenizer_);
    }

    feeds.push_back(tensorOver(input.active, {batch}, ONNX_TENSOR_ELEMENT_DATA_TYPE_BOOL));

    const auto absorb = [&](const Ort::Value& tokens, const Ort::Value& logprobs, size_t before) {
        const size_t width = static_cast<size_t>(tokens.GetTensorTypeAndShapeInfo().GetShape()[1]);
        const size_t kept = std::min(width, maxTokens - before);
        const int64_t* ids = tokens.GetTensorData<int64_t>();
        const float* scores = logprobs.GetTensorData<float>();

        for (size_t i = 0; i < rows.size(); i++) {
            for (size_t step = 0; step < kept && !rows[i].done; step++) {
                rows[i].take(ids[i * width + step], scores[i * width + step]);
            }

            rows[i].guard();
        }

        return width;
    };

    std::vector<Ort::Value> state = graphs.chunk->run({"pixels", "pos_weights", "spatial_shapes", "active"},
                                                      {feeds[0], feeds[1], feeds[2], feeds[3]},
                                                      {"tokens", "kc", "vc", "valid_t", "logprobs"},
                                                      GpuPriority::Urgent);
    Ort::Value tokens = std::move(state[0]);
    Ort::Value keys = std::move(state[1]);
    Ort::Value values = std::move(state[2]);
    Ort::Value valid = std::move(state[3]);
    size_t read = absorb(tokens, state[4], 0);

    while (read < maxTokens && anyReading()) {
        const size_t width = static_cast<size_t>(tokens.GetTensorTypeAndShapeInfo().GetShape()[1]);
        const int64_t* ids = tokens.GetTensorData<int64_t>();
        std::vector<int64_t> last(batch);
        std::vector<uint8_t> flags = unfinished();
        int64_t at = static_cast<int64_t>(read);

        for (int64_t i = 0; i < batch; i++) {
            last[i] = ids[i * width + width - 1];
        }

        const Ort::Value lastTokens = tensorOver(last, {batch}, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64);
        const Ort::Value start = scalar(at);
        const Ort::Value flagsValue = tensorOver(flags, {batch}, ONNX_TENSOR_ELEMENT_DATA_TYPE_BOOL);
        std::vector<Ort::Value> next = graphs.cont->run({"tok", "start", "kc", "vc", "valid_t", "unfinished"},
                                                        {lastTokens, start, keys, values, valid, flagsValue},
                                                        {"tokens", "kc_out", "vc_out", "logprobs"},
                                                        GpuPriority::Urgent);

        tokens = std::move(next[0]);
        keys = std::move(next[1]);
        values = std::move(next[2]);
        read += absorb(tokens, next[3], read);
    }

    return readingsOf(rows, tokenizer_);
}

std::vector<Reading> Reader::read(const std::vector<Rgb>& crops) {
    static std::mutex lock;
    std::scoped_lock guard(lock);

    std::vector<std::optional<Reading>> readings(crops.size());

    for (const int patches : {256, 512}) {
        std::vector<size_t> indices;

        for (size_t i = 0; i < crops.size(); i++) {
            if ((crops[i].width * crops[i].height >= largeCrop) == (patches == 512)) {
                indices.push_back(i);
            }
        }

        for (size_t offset = 0; offset < indices.size(); offset += batch) {
            const size_t end = std::min(indices.size(), offset + static_cast<size_t>(batch));
            std::vector<const Rgb*> group;

            for (size_t i = offset; i < end; i++) {
                group.push_back(&crops[indices[i]]);
            }

            const std::vector<Reading> results = readBatch(patches, group);

            for (size_t i = offset; i < end; i++) {
                readings[indices[i]] = results[i - offset];
            }
        }
    }

    std::vector<Reading> all;

    for (auto& reading : readings) {
        all.push_back(reading ? *reading : Reading{"", -std::numeric_limits<double>::infinity(), false, false});
    }

    return all;
}

}
