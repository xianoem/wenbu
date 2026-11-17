#include "TextMerge.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <numbers>
#include <numeric>
#include <set>

#include "DbBoxes.hpp"
#include "PySet.hpp"

namespace engine {

namespace {

float f32Norm(int x, int y) {
    const float fx = static_cast<float>(x);
    const float fy = static_cast<float>(y);
    const float squares = fx * fx + fy * fy;

    return std::sqrt(squares);
}

float f32Sum(const std::vector<float>& values, size_t start, size_t count) {
    if (count < 8) {
        float total = 0;

        for (size_t i = 0; i < count; i++) {
            total += values[start + i];
        }

        return total;
    }

    if (count <= 128) {
        std::array<float, 8> r{};

        for (size_t j = 0; j < 8; j++) {
            r[j] = values[start + j];
        }

        size_t i = 8;

        for (; i < count - count % 8; i += 8) {
            for (size_t j = 0; j < 8; j++) {
                r[j] += values[start + i + j];
            }
        }

        float total = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));

        for (; i < count; i++) {
            total += values[start + i];
        }

        return total;
    }

    size_t half = count / 2;

    half -= half % 8;

    return f32Sum(values, start, half) + f32Sum(values, start + half, count - half);
}

// numpy's pairwise sum for float32 arrays, then the float32 division np.mean does.
float f32Mean(const std::vector<float>& values) {
    return f32Sum(values, 0, values.size()) / static_cast<float>(values.size());
}

double mean(const std::vector<double>& values) {
    double total = 0;

    for (const double value : values) {
        total += value;
    }

    return total / static_cast<double>(values.size());
}

double standardDeviation(const std::vector<double>& values) {
    const double average = mean(values);
    std::vector<double> squares;

    for (const double value : values) {
        squares.push_back((value - average) * (value - average));
    }

    return std::sqrt(mean(squares));
}

using Structure = std::array<cv::Point, 4>;

Structure structureOf(const Quad& line) {
    const auto mid = [](const cv::Point& p, const cv::Point& q) {
        return cv::Point(static_cast<int>((p.x + q.x) / 2.0), static_cast<int>((p.y + q.y) / 2.0));
    };
    const auto& [a, b, c, d] = line.pts;

    return {mid(a, b), mid(c, d), mid(b, c), mid(d, a)};
}

struct Vectors {
    cv::Point v1;
    cv::Point v2;
};

Vectors vectorsOf(const Quad& line) {
    const Structure s = structureOf(line);

    return {s[1] - s[0], s[3] - s[2]};
}

float aspectRatio(const Quad& line) {
    const Vectors v = vectorsOf(line);

    return f32Norm(v.v2.x, v.v2.y) / f32Norm(v.v1.x, v.v1.y);
}

cv::Point2f unitV1(const Quad& line) {
    const cv::Point v1 = vectorsOf(line).v1;
    const float norm = f32Norm(v1.x, v1.y);

    return {static_cast<float>(v1.x) / norm, static_cast<float>(v1.y) / norm};
}

cv::Point2f unitV2(const Quad& line) {
    const cv::Point v2 = vectorsOf(line).v2;
    const float norm = f32Norm(v2.x, v2.y);

    return {static_cast<float>(v2.x) / norm, static_cast<float>(v2.y) / norm};
}

double angleOf(const Quad& line) {
    return std::fmod(std::acos(static_cast<double>(unitV1(line).x)) + std::numbers::pi, std::numbers::pi);
}

bool approximatelyAxisAligned(const Quad& line) {
    const cv::Point2f u1 = unitV1(line);
    const cv::Point2f u2 = unitV2(line);

    return std::abs(u1.y) < 0.05 || std::abs(u1.x) < 0.05 || std::abs(u2.y) < 0.05 || std::abs(u2.x) < 0.05;
}

cv::Point2d centroidOf(const Quad& line) {
    const auto& p = line.pts;

    return {(p[0].x + p[1].x + p[2].x + p[3].x) / 4.0, (p[0].y + p[1].y + p[2].y + p[3].y) / 4.0};
}

struct Box {
    int x;
    int y;
    int w;
    int h;
};

Box aabbOf(const Quad& line) {
    int minX = line.pts[0].x;
    int minY = line.pts[0].y;
    int maxX = minX;
    int maxY = minY;

    for (const auto& point : line.pts) {
        minX = std::min(minX, point.x);
        minY = std::min(minY, point.y);
        maxX = std::max(maxX, point.x);
        maxY = std::max(maxY, point.y);
    }

    return {minX, minY, maxX - minX, maxY - minY};
}

double pointSegmentDistance(const cv::Point& p, const cv::Point& a, const cv::Point& b) {
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    const double lengthSquared = dx * dx + dy * dy;
    const double t =
        lengthSquared == 0 ? 0 : std::max(0.0, std::min(1.0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));

    return std::hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

int64_t cross(const cv::Point& o, const cv::Point& a, const cv::Point& b) {
    return static_cast<int64_t>(a.x - o.x) * (b.y - o.y) - static_cast<int64_t>(a.y - o.y) * (b.x - o.x);
}

bool onSegment(const cv::Point& p, const cv::Point& q, const cv::Point& r) {
    return std::min(p.x, q.x) <= r.x && r.x <= std::max(p.x, q.x) && std::min(p.y, q.y) <= r.y &&
           r.y <= std::max(p.y, q.y);
}

bool segmentsCross(const cv::Point& a, const cv::Point& b, const cv::Point& c, const cv::Point& d) {
    const int64_t d1 = cross(c, d, a);
    const int64_t d2 = cross(c, d, b);
    const int64_t d3 = cross(a, b, c);
    const int64_t d4 = cross(a, b, d);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    return (d1 == 0 && onSegment(c, d, a)) || (d2 == 0 && onSegment(c, d, b)) || (d3 == 0 && onSegment(a, b, c)) ||
           (d4 == 0 && onSegment(a, b, d));
}

bool inside(const cv::Point& p, const std::array<cv::Point, 4>& polygon) {
    bool result = false;

    for (size_t i = 0; i < polygon.size(); i++) {
        const cv::Point& a = polygon[i];
        const cv::Point& b = polygon[(i + 1) % polygon.size()];

        if ((a.y > p.y) != (b.y > p.y) &&
            p.x < static_cast<double>(b.x - a.x) * (p.y - a.y) / static_cast<double>(b.y - a.y) + a.x) {
            result = !result;
        }
    }

    return result;
}

// shapely's Polygon.distance: zero when the polygons touch or overlap.
double polygonDistance(const std::array<cv::Point, 4>& first, const std::array<cv::Point, 4>& second) {
    for (size_t i = 0; i < 4; i++) {
        for (size_t j = 0; j < 4; j++) {
            if (segmentsCross(first[i], first[(i + 1) % 4], second[j], second[(j + 1) % 4])) {
                return 0;
            }
        }
    }

    if (inside(first[0], second) || inside(second[0], first)) {
        return 0;
    }

    double best = std::numeric_limits<double>::infinity();

    for (const auto& p : first) {
        for (size_t j = 0; j < 4; j++) {
            best = std::min(best, pointSegmentDistance(p, second[j], second[(j + 1) % 4]));
        }
    }

    for (const auto& p : second) {
        for (size_t i = 0; i < 4; i++) {
            best = std::min(best, pointSegmentDistance(p, first[i], first[(i + 1) % 4]));
        }
    }

    return best;
}

double distanceOf(const cv::Point& a, const cv::Point& b) {
    return std::sqrt(static_cast<double>(a.x - b.x) * (a.x - b.x) + static_cast<double>(a.y - b.y) * (a.y - b.y));
}

// Quadrilateral.distance_impl, which depends on the direction the OCR assigned.
double lineDistance(const Line& self, const Line& other, double rho = 0.5) {
    const double fs = std::max(fontSizeOf(self), fontSizeOf(other));
    const Structure s = structureOf(self);
    const Structure o = structureOf(other);

    if (self.direction == 'h') {
        const double dist1 = hullArea({self.pts[0], self.pts[3], other.pts[0], other.pts[3]}) / fs;
        const double dist2 = hullArea({self.pts[2], self.pts[1], other.pts[2], other.pts[1]}) / fs;
        const double dist3 = hullArea({s[0], s[1], o[0], o[1]}) / fs;
        int pattern = 0;

        if (dist2 < fs * rho && dist2 < dist1) {
            pattern = 1;
        }

        if (dist3 < fs * rho && dist3 < dist1 && dist3 < dist2) {
            pattern = 2;
        }

        if (pattern == 0) {
            return distanceOf(self.pts[0], other.pts[0]);
        }

        if (pattern == 1) {
            return distanceOf(self.pts[1], other.pts[1]);
        }

        return distanceOf(s[0], o[0]);
    }

    const double dist1 = hullArea({self.pts[0], self.pts[1], other.pts[0], other.pts[1]}) / fs;
    const double dist2 = hullArea({self.pts[2], self.pts[3], other.pts[2], other.pts[3]}) / fs;
    const bool top = !(dist2 < fs * rho && dist2 < dist1);

    return top ? distanceOf(self.pts[0], other.pts[0]) : distanceOf(self.pts[2], other.pts[2]);
}

struct Tolerances {
    double ratio = 1.9;
    double discardConnectionGap = 2;
    double charGapTolerance = 0.6;
    double charGapTolerance2 = 1.5;
    double fontSizeRatioTol = 1.5;
    double aspectRatioTol = 2;
};

// quadrilateral_can_merge_region.
bool canMerge(const Quad& a, const Quad& b, const Tolerances& t) {
    const Box b1 = aabbOf(a);
    const Box b2 = aabbOf(b);
    const float charSize = std::min(fontSizeOf(a), fontSizeOf(b));
    const double dist = polygonDistance(a.pts, b.pts);

    if (dist > t.discardConnectionGap * charSize) {
        return false;
    }

    if (std::max(fontSizeOf(a), fontSizeOf(b)) / charSize > t.fontSizeRatioTol) {
        return false;
    }

    if (aspectRatio(a) > t.aspectRatioTol && aspectRatio(b) < 1 / t.aspectRatioTol) {
        return false;
    }

    if (aspectRatio(b) > t.aspectRatioTol && aspectRatio(a) < 1 / t.aspectRatioTol) {
        return false;
    }

    if (approximatelyAxisAligned(a) && approximatelyAxisAligned(b)) {
        if (dist >= charSize * t.charGapTolerance) {
            return false;
        }

        if (std::abs(b1.x + b1.w / 2 - (b2.x + b2.w / 2)) < t.charGapTolerance2) {
            return true;
        }

        if (b1.w > b1.h * t.ratio && b2.h > b2.w * t.ratio) {
            return false;
        }

        if (b2.w > b2.h * t.ratio && b1.h > b1.w * t.ratio) {
            return false;
        }

        if (b1.w > b1.h * t.ratio || b2.w > b2.h * t.ratio) {
            return std::abs(b1.x - b2.x) < charSize * t.charGapTolerance2 ||
                   std::abs(b1.x + b1.w - (b2.x + b2.w)) < charSize * t.charGapTolerance2;
        }

        if (b1.h > b1.w * t.ratio || b2.h > b2.w * t.ratio) {
            return std::abs(b1.y - b2.y) < charSize * t.charGapTolerance2 ||
                   std::abs(b1.y + b1.h - (b2.y + b2.h)) < charSize * t.charGapTolerance2;
        }

        return false;
    }

    if (std::abs(angleOf(a) - angleOf(b)) < 15 * std::numbers::pi / 180) {
        const float fsA = fontSizeOf(a);
        const float fsB = fontSizeOf(b);
        const float fs = std::min(fsA, fsB);

        if (dist > fs * t.charGapTolerance2) {
            return false;
        }

        return std::abs(fsA - fsB) / fs <= 0.25f;
    }

    return false;
}

// networkx's undirected graph: adjacency in insertion order, components as CPython sets.
class Graph {
public:
    explicit Graph(std::vector<int> nodes) : nodes_(std::move(nodes)) {
        for (const int node : nodes_) {
            adjacency_[node];
        }
    }

    void addEdge(int u, int v) {
        std::vector<int>& fromU = adjacency_[u];

        if (std::find(fromU.begin(), fromU.end(), v) == fromU.end()) {
            fromU.push_back(v);
            adjacency_[v].push_back(u);
        }
    }

    // connected_components: each component's members in the order Python iterates the set.
    std::vector<std::vector<int>> components() const {
        std::set<int> seen;
        std::vector<std::vector<int>> found;

        for (const int source : nodes_) {
            if (seen.contains(source)) {
                continue;
            }

            std::vector<int> inserted = {source};
            std::set<int> local = {source};
            std::vector<int> level = {source};

            while (!level.empty()) {
                std::vector<int> next;

                for (const int v : level) {
                    for (const int w : adjacency_.at(v)) {
                        if (!local.contains(w)) {
                            local.insert(w);
                            inserted.push_back(w);
                            next.push_back(w);
                        }
                    }

                    if (local.size() == nodes_.size()) {
                        break;
                    }
                }

                if (local.size() == nodes_.size()) {
                    break;
                }

                level = std::move(next);
            }

            seen.insert(local.begin(), local.end());
            found.push_back(pySetOrder(inserted));
        }

        return found;
    }

private:
    std::vector<int> nodes_;
    std::map<int, std::vector<int>> adjacency_;
};

std::vector<int> indices(size_t count) {
    std::vector<int> all(count);

    std::iota(all.begin(), all.end(), 0);

    return all;
}

int cropWidth(const Line& line) {
    const Vectors v = vectorsOf(line);
    const float ratio = f32Norm(v.v1.x, v.v1.y) / f32Norm(v.v2.x, v.v2.y);
    const double width = line.direction == 'h' ? 48 / static_cast<double>(ratio) : 48 * static_cast<double>(ratio);

    return std::max(static_cast<int>(roundHalfEven(width)), 2);
}

std::vector<std::vector<int>> splitRegion(const std::vector<Line>& lines, const std::vector<int>& members) {
    constexpr double gamma = 0.5;
    constexpr double sigma = 2;

    if (members.size() == 1) {
        return {pySetOrder(members)};
    }

    if (members.size() == 2) {
        const Line& a = lines[members[0]];
        const Line& b = lines[members[1]];
        const double fs = std::max(fontSizeOf(a), fontSizeOf(b));

        if (lineDistance(a, b) < (1 + gamma) * fs && std::abs(angleOf(a) - angleOf(b)) < 0.2 * std::numbers::pi) {
            return {pySetOrder(members)};
        }

        return {{members[0]}, {members[1]}};
    }

    struct Edge {
        int u;
        int v;
        double weight;
    };

    std::vector<Edge> all;

    for (size_t i = 0; i < members.size(); i++) {
        for (size_t j = i + 1; j < members.size(); j++) {
            all.push_back({members[i], members[j], lineDistance(lines[members[i]], lines[members[j]])});
        }
    }

    std::stable_sort(all.begin(), all.end(), [](const Edge& a, const Edge& b) { return a.weight < b.weight; });

    std::map<int, int> parent;

    const auto root = [&](int node) {
        for (;;) {
            const auto up = parent.find(node);

            if (up == parent.end() || up->second == node) {
                return node;
            }

            node = up->second;
        }
    };

    std::vector<Edge> tree;

    for (const Edge& edge : all) {
        if (root(edge.u) != root(edge.v)) {
            tree.push_back(edge);
            parent[root(edge.u)] = root(edge.v);
        }
    }

    std::vector<Edge> descending = tree;

    std::stable_sort(descending.begin(), descending.end(), [](const Edge& a, const Edge& b) { return b.weight < a.weight; });

    std::vector<double> weights;

    for (const Edge& edge : descending) {
        weights.push_back(edge.weight);
    }

    std::vector<float> sizes;

    for (const int index : members) {
        sizes.push_back(fontSizeOf(lines[index]));
    }

    const double fontsize = f32Mean(sizes);
    const double deviation = standardDeviation(weights);
    const double average = mean(weights);
    const double stdThreshold = std::max(0.3 * fontsize + 5, 5.0);
    const Line& b1 = lines[descending[0].u];
    const Line& b2 = lines[descending[0].v];
    const double polyDistance = polygonDistance(b1.pts, b2.pts);
    const cv::Point2d c1 = centroidOf(b1);
    const cv::Point2d c2 = centroidOf(b2);
    const double alignment = std::min(std::abs(c1.x - c2.x), std::abs(c1.y - c2.y));
    const double top = weights[0];

    if ((top <= average + deviation * sigma || top <= fontsize * (1 + gamma)) &&
        (deviation < stdThreshold || (polyDistance == 0 && alignment < 5))) {
        return {pySetOrder(members)};
    }

    Graph rest(members);

    for (size_t i = 1; i < descending.size(); i++) {
        rest.addEdge(descending[i].u, descending[i].v);
    }

    std::vector<std::vector<int>> regions;

    for (const auto& component : rest.components()) {
        const std::vector<std::vector<int>> parts = splitRegion(lines, component);

        regions.insert(regions.end(), parts.begin(), parts.end());
    }

    return regions;
}

bool blockDirection(const std::vector<Line>& lines) {
    double largest = 0;
    double aspect = 1;

    for (const Line& line : lines) {
        int64_t area = 0;

        for (size_t i = 0; i < 4; i++) {
            const cv::Point& point = line.pts[i];
            const cv::Point& next = line.pts[(i + 1) % 4];

            area += static_cast<int64_t>(point.x) * next.y - static_cast<int64_t>(next.x) * point.y;
        }

        const double half = std::abs(static_cast<double>(area)) / 2;

        if (half > largest) {
            largest = half;

            const Box box = aabbOf(line);

            aspect = box.h > 0 ? static_cast<double>(box.w) / box.h : 1;
        }
    }

    return aspect < 1;
}

cv::Point2d centerOf(const Block& block) {
    return {(block.xyxy[0] + block.xyxy[2]) / 2.0, (block.xyxy[1] + block.xyxy[3]) / 2.0};
}

std::vector<Block> simpleSort(const std::vector<Block>& blocks, bool rtl) {
    std::vector<double> xs;
    std::vector<double> ys;

    for (const Block& block : blocks) {
        xs.push_back(centerOf(block).x);
        ys.push_back(centerOf(block).y);
    }

    const bool horizontal = blocks.size() > 1 && standardDeviation(xs) > standardDeviation(ys);
    const auto across = [rtl](const Block& block) { return rtl ? -centerOf(block).x : centerOf(block).x; };
    const auto down = [](const Block& block) { return centerOf(block).y; };
    std::vector<Block> primary = blocks;
    std::vector<Block> sorted;

    if (horizontal) {
        std::stable_sort(primary.begin(), primary.end(), [&](const Block& a, const Block& b) { return across(a) < across(b); });
    } else {
        std::stable_sort(primary.begin(), primary.end(), [&](const Block& a, const Block& b) { return down(a) < down(b); });
    }

    const auto flush = [&](std::vector<Block>& group) {
        if (horizontal) {
            std::stable_sort(group.begin(), group.end(), [&](const Block& a, const Block& b) { return down(a) < down(b); });
        } else {
            std::stable_sort(group.begin(), group.end(), [&](const Block& a, const Block& b) { return across(a) < across(b); });
        }

        sorted.insert(sorted.end(), group.begin(), group.end());
        group.clear();
    };

    std::vector<Block> group;
    std::optional<double> previous;

    for (const Block& block : primary) {
        const double value = horizontal ? centerOf(block).x : centerOf(block).y;

        if (previous && std::abs(value - *previous) > (horizontal ? 20 : 15)) {
            flush(group);
        }

        group.push_back(block);
        previous = value;
    }

    if (!group.empty()) {
        flush(group);
    }

    return sorted;
}

}

float fontSizeOf(const Quad& line) {
    const Vectors v = vectorsOf(line);

    return std::min(f32Norm(v.v2.x, v.v2.y), f32Norm(v.v1.x, v.v1.y));
}

std::vector<Line> assignDirections(const std::vector<Quad>& lines) {
    Graph graph(indices(lines.size()));
    Tolerances tolerances;

    tolerances.aspectRatioTol = 1;

    for (size_t i = 0; i < lines.size(); i++) {
        for (size_t j = i + 1; j < lines.size(); j++) {
            if (canMerge(lines[i], lines[j], tolerances)) {
                graph.addEdge(static_cast<int>(i), static_cast<int>(j));
            }
        }
    }

    std::vector<Line> directed;

    for (const auto& component : graph.components()) {
        size_t vertical = 0;

        for (const int index : component) {
            vertical += lines[index].vertical ? 1 : 0;
        }

        const size_t horizontal = component.size() - vertical;
        char majority = vertical > horizontal ? 'v' : 'h';

        if (vertical == horizontal) {
            majority = lines[component[0]].vertical ? 'v' : 'h';
        }

        struct Keyed {
            int index;
            int key;
        };

        std::vector<Keyed> keyed;

        for (const int index : component) {
            const Box box = aabbOf(lines[index]);

            keyed.push_back({index, majority == 'h' ? box.y + box.h / 2 : -(box.x + box.w)});
        }

        std::stable_sort(keyed.begin(), keyed.end(), [](const Keyed& a, const Keyed& b) { return a.key < b.key; });

        for (const Keyed& entry : keyed) {
            Line line;

            static_cast<Quad&>(line) = lines[entry.index];
            line.direction = majority;
            directed.push_back(line);
        }
    }

    std::stable_sort(directed.begin(), directed.end(),
                     [](const Line& a, const Line& b) { return cropWidth(a) < cropWidth(b); });

    return directed;
}

std::vector<Block> mergeLines(const std::vector<Line>& lines) {
    Graph graph(indices(lines.size()));
    Tolerances tolerances;

    tolerances.aspectRatioTol = 1.3;
    tolerances.fontSizeRatioTol = 2;
    tolerances.charGapTolerance = 1;
    tolerances.charGapTolerance2 = 3;

    for (size_t i = 0; i < lines.size(); i++) {
        for (size_t j = i + 1; j < lines.size(); j++) {
            if (canMerge(lines[i], lines[j], tolerances)) {
                graph.addEdge(static_cast<int>(i), static_cast<int>(j));
            }
        }
    }

    std::vector<Block> blocks;

    for (const auto& component : graph.components()) {
        for (const auto& members : splitRegion(lines, component)) {
            std::vector<Line> entries;
            std::vector<std::pair<char, int>> counts;

            for (const int index : members) {
                entries.push_back(lines[index]);

                auto found = std::find_if(counts.begin(), counts.end(),
                                          [&](const auto& count) { return count.first == lines[index].direction; });

                if (found == counts.end()) {
                    counts.emplace_back(lines[index].direction, 1);
                } else {
                    found->second++;
                }
            }

            std::stable_sort(counts.begin(), counts.end(), [](const auto& a, const auto& b) { return b.second < a.second; });

            char majority = counts[0].first;

            if (counts.size() > 1 && counts[0].second == counts[1].second) {
                double best = -100;

                for (const Line& line : entries) {
                    const double ratio = aspectRatio(line);

                    if (ratio > best) {
                        best = ratio;
                        majority = line.direction;
                    }

                    if (1 / ratio > best) {
                        best = 1 / ratio;
                        majority = line.direction;
                    }
                }
            }

            std::stable_sort(entries.begin(), entries.end(), [majority](const Line& a, const Line& b) {
                return majority == 'h' ? centroidOf(a).y < centroidOf(b).y : centroidOf(b).x < centroidOf(a).x;
            });

            Block block;
            std::vector<double> angles;
            float smallest = std::numeric_limits<float>::infinity();

            block.xyxy = {entries[0].pts[0].x, entries[0].pts[0].y, entries[0].pts[0].x, entries[0].pts[0].y};

            for (const Line& line : entries) {
                angles.push_back(angleOf(line));
                smallest = std::min(smallest, fontSizeOf(line));

                for (const auto& point : line.pts) {
                    block.xyxy[0] = std::min(block.xyxy[0], point.x);
                    block.xyxy[1] = std::min(block.xyxy[1], point.y);
                    block.xyxy[2] = std::max(block.xyxy[2], point.x);
                    block.xyxy[3] = std::max(block.xyxy[3], point.y);
                }
            }

            const double angle = mean(angles) * 180 / std::numbers::pi - 90;

            block.fontSize = std::trunc(static_cast<double>(smallest));
            block.angle = std::abs(angle) < 3 ? 0 : angle;
            block.vertical = blockDirection(entries);
            block.lines = std::move(entries);
            blocks.push_back(std::move(block));
        }
    }

    return blocks;
}

std::vector<Block> sortBlocks(const std::vector<Block>& blocks, const std::vector<PanelBox>& panels, bool rtl) {
    std::vector<std::array<int, 4>> boxes;

    for (const PanelBox& panel : panels) {
        boxes.push_back({panel.x, panel.y, panel.x + panel.width, panel.y + panel.height});
    }

    std::stable_sort(boxes.begin(), boxes.end(), [rtl](const auto& a, const auto& b) {
        if (a[1] != b[1]) {
            return a[1] < b[1];
        }

        return rtl ? b[0] < a[0] : a[0] < b[0];
    });

    const auto indexOf = [&](const Block& block) {
        const cv::Point2d c = centerOf(block);

        for (size_t i = 0; i < boxes.size(); i++) {
            const auto& [x1, y1, x2, y2] = boxes[i];

            if (x1 <= c.x && c.x <= x2 && y1 <= c.y && c.y <= y2) {
                return static_cast<int>(i);
            }
        }

        int best = -1;
        double bestDistance = 0;

        for (size_t i = 0; i < boxes.size(); i++) {
            const auto& [x1, y1, x2, y2] = boxes[i];
            const double dx = std::max({x1 - c.x, 0.0, c.x - x2});
            const double dy = std::max({y1 - c.y, 0.0, c.y - y2});
            const double d = dx * dx + dy * dy;

            if (best < 0 || d < bestDistance) {
                best = static_cast<int>(i);
                bestDistance = d;
            }
        }

        return best;
    };

    std::map<int, std::vector<Block>> grouped;

    for (const Block& block : blocks) {
        grouped[indexOf(block)].push_back(block);
    }

    std::vector<Block> sorted;

    for (const auto& [index, group] : grouped) {
        const std::vector<Block> ordered = simpleSort(group, rtl);

        sorted.insert(sorted.end(), ordered.begin(), ordered.end());
    }

    return sorted;
}

}
