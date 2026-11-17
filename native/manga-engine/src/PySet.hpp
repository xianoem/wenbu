// The order CPython 3.11 iterates a set of small non-negative ints built by adding them in `inserted`
// order. networkx returns connected components as sets, and the plugin's text-line merge depends on that
// order, so this reproduces CPython's open addressing: a hash of int n is n, linear probes of 9 then
// perturbed probing, and a resize to the next power of two above four times the size once a table is
// three-fifths full.
#pragma once

#include <vector>

namespace engine {

std::vector<int> pySetOrder(const std::vector<int>& inserted);

}
