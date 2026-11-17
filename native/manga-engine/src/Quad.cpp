#include "Quad.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace engine {

namespace {

template <typename T> std::vector<size_t> stableArgsort(const std::vector<T>& values) {
    std::vector<size_t> order(values.size());

    std::iota(order.begin(), order.end(), 0);
    std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return values[a] < values[b]; });

    return order;
}

template <typename P> std::vector<P> pick(const std::vector<P>& points, const std::vector<size_t>& order) {
    std::vector<P> picked;

    for (const size_t index : order) {
        picked.push_back(points[index]);
    }

    return picked;
}

template <typename P> std::vector<decltype(P::x)> xsOf(const std::vector<P>& points) {
    std::vector<decltype(P::x)> xs;

    for (const auto& point : points) {
        xs.push_back(point.x);
    }

    return xs;
}

template <typename P> std::vector<decltype(P::y)> ysOf(const std::vector<P>& points) {
    std::vector<decltype(P::y)> ys;

    for (const auto& point : points) {
        ys.push_back(point.y);
    }

    return ys;
}

int64_t cross(const cv::Point& o, const cv::Point& a, const cv::Point& b) {
    return static_cast<int64_t>(a.x - o.x) * (b.y - o.y) - static_cast<int64_t>(a.y - o.y) * (b.x - o.x);
}

template <typename P> BasicQuad<P> sorted(const std::vector<P>& input, double score) {
    std::vector<P> pairs;

    for (const auto& a : input) {
        for (const auto& b : input) {
            pairs.push_back(a - b);
        }
    }

    std::vector<double> lengths;

    for (const auto& vector : pairs) {
        lengths.push_back(std::hypot(vector.x, vector.y));
    }

    const std::vector<size_t> order = stableArgsort(lengths);
    const P first = pairs[order[8]];
    const P second = pairs[order[10]];
    const P aligned = first.x * second.x + first.y * second.y < 0 ? -first : first;
    const double structureX = std::abs((aligned.x + second.x) / 2.0);
    const double structureY = std::abs((aligned.y + second.y) / 2.0);
    BasicQuad<P> line;

    line.score = score;
    line.vertical = structureX <= structureY;

    if (line.vertical) {
        const std::vector<P> byY = pick(input, stableArgsort(ysOf(input)));
        const std::vector<P> top(byY.begin(), byY.begin() + 2);
        const std::vector<P> bottom(byY.begin() + 2, byY.end());
        const std::vector<size_t> topOrder = stableArgsort(xsOf(top));
        std::vector<size_t> bottomOrder = stableArgsort(xsOf(bottom));

        std::reverse(bottomOrder.begin(), bottomOrder.end());
        line.pts = {top[topOrder[0]], top[topOrder[1]], bottom[bottomOrder[0]], bottom[bottomOrder[1]]};

        return line;
    }

    const std::vector<P> byX = pick(input, stableArgsort(xsOf(input)));
    std::vector<P> left = {byX[0], byX[1]};
    std::vector<P> right = {byX[2], byX[3]};
    const auto byHeight = [](const P& a, const P& b) { return a.y < b.y; };

    std::stable_sort(left.begin(), left.end(), byHeight);
    std::stable_sort(right.begin(), right.end(), byHeight);
    line.pts = {left[0], right[0], right[1], left[1]};

    return line;
}

}

Quad quad(const std::vector<cv::Point>& input, double score) {
    return sorted(input, score);
}

QuadF quad(const std::vector<cv::Point2d>& input, double score) {
    return sorted(input, score);
}

double hullArea(const std::vector<cv::Point>& points) {
    std::vector<cv::Point> sorted = points;

    std::stable_sort(sorted.begin(), sorted.end(),
                     [](const cv::Point& a, const cv::Point& b) { return a.x == b.x ? a.y < b.y : a.x < b.x; });

    if (sorted.size() < 3) {
        return 0;
    }

    const auto build = [](const std::vector<cv::Point>& list) {
        std::vector<cv::Point> hull;

        for (const auto& point : list) {
            while (hull.size() >= 2 && cross(hull[hull.size() - 2], hull.back(), point) <= 0) {
                hull.pop_back();
            }

            hull.push_back(point);
        }

        hull.pop_back();

        return hull;
    };

    std::vector<cv::Point> hull = build(sorted);
    std::vector<cv::Point> reversed(sorted.rbegin(), sorted.rend());
    const std::vector<cv::Point> upper = build(reversed);

    hull.insert(hull.end(), upper.begin(), upper.end());

    int64_t area = 0;

    for (size_t i = 0; i < hull.size(); i++) {
        const cv::Point& point = hull[i];
        const cv::Point& next = hull[(i + 1) % hull.size()];

        area += static_cast<int64_t>(point.x) * next.y - static_cast<int64_t>(next.x) * point.y;
    }

    return std::abs(static_cast<double>(area)) / 2;
}

double quadArea(const Quad& line) {
    return hullArea(std::vector<cv::Point>(line.pts.begin(), line.pts.end()));
}

}
