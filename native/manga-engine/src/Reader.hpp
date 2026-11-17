// Reads text blocks with Hayai Supernova from static ONNX graphs, eight crops at a time, with 256 or 512
// patches each. On TensorRT-RTX a prefill graph reads the crops and gives the first token, then a step
// graph gives one token at a time with its key/value cache kept on the GPU. Elsewhere a chunk graph gives
// the first 25 tokens and a continuation graph 24 more at a time (the step graph's plain attention reset
// the GPU on DirectML).
#pragma once

#include <filesystem>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "Images.hpp"
#include "Runtime.hpp"
#include "Tokenizer.hpp"

namespace engine {

struct Reading {
    std::string text;
    // Mean log-probability of the chosen tokens, end of text included.
    double confidence = 0;
    // The reading stopped because it started repeating itself.
    bool repeated = false;
    // The reading reached the token limit without ending.
    bool capped = false;
};

struct Repetition {
    size_t period = 0;
    size_t start = 0;
};

// The period of a run of at least four copies covering sixteen tokens at the end, if there is one.
std::optional<Repetition> repetitionAt(const std::vector<int64_t>& ids);

class Reader {
public:
    Reader(Runtime& runtime, const std::filesystem::path& models);
    ~Reader();

    std::vector<Reading> read(const std::vector<Rgb>& crops);

    // Reads full batches of blank crops at both patch sizes, so TensorRT-RTX has compiled every kernel.
    void warm();

private:
    struct Graphs;

    Graphs& graphsFor(int patches);
    std::vector<Reading> readBatch(int patches, const std::vector<const Rgb*>& crops);

    Runtime& runtime_;
    std::filesystem::path models_;
    Tokenizer tokenizer_;
    std::map<int, std::unique_ptr<Graphs>> graphs_;
};

}
