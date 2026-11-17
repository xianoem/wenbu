#include "PySet.hpp"

#include <algorithm>
#include <optional>

namespace engine {

namespace {

constexpr size_t linearProbes = 9;
constexpr int perturbShift = 5;

using Table = std::vector<std::optional<int>>;

void place(Table& slots, int value) {
    const size_t mask = slots.size() - 1;
    size_t index = static_cast<size_t>(value) & mask;
    size_t perturb = static_cast<size_t>(value);

    for (;;) {
        const size_t probes = index + linearProbes <= mask ? linearProbes : 0;

        for (size_t step = 0; step <= probes; step++) {
            if (!slots[index + step]) {
                slots[index + step] = value;

                return;
            }
        }

        perturb >>= perturbShift;
        index = (index * 5 + 1 + perturb) & mask;
    }
}

}

std::vector<int> pySetOrder(const std::vector<int>& inserted) {
    Table table(8);
    size_t fill = 0;

    for (const int value : inserted) {
        if (std::find(table.begin(), table.end(), value) != table.end()) {
            continue;
        }

        place(table, value);
        fill++;

        if (fill * 5 >= (table.size() - 1) * 3) {
            size_t size = 8;

            while (size <= fill * 4) {
                size *= 2;
            }

            Table resized(size);

            for (const auto& kept : table) {
                if (kept) {
                    place(resized, *kept);
                }
            }

            table = std::move(resized);
        }
    }

    std::vector<int> order;

    for (const auto& value : table) {
        if (value) {
            order.push_back(*value);
        }
    }

    return order;
}

}
