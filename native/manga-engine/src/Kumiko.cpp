#include "Kumiko.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <memory>
#include <numbers>
#include <optional>
#include <string>

#include <opencv2/imgproc.hpp>

#include "DbBoxes.hpp"

namespace engine {

namespace {

struct Dot {
    int x = 0;
    int y = 0;

    bool operator==(const Dot&) const = default;
};

class Segment;

std::vector<Segment> unionAll(std::vector<Segment> segments);

class Segment {
public:
    Dot a;
    Dot b;

    Segment(Dot first, Dot second) : a(first), b(second) {}

    bool equals(const Segment& other) const {
        return (a == other.a && b == other.b) || (a == other.b && b == other.a);
    }

    double dist() const {
        return std::sqrt(static_cast<double>(distX()) * distX() + static_cast<double>(distY()) * distY());
    }

    int distX(bool keepSign = false) const {
        const int dist = b.x - a.x;

        return keepSign ? dist : std::abs(dist);
    }

    int distY(bool keepSign = false) const {
        const int dist = b.y - a.y;

        return keepSign ? dist : std::abs(dist);
    }

    int left() const { return std::min(a.x, b.x); }
    int top() const { return std::min(a.y, b.y); }
    int right() const { return std::max(a.x, b.x); }
    int bottom() const { return std::max(a.y, b.y); }

    Dot center() const {
        return {static_cast<int>(left() + distX() / 2.0), static_cast<int>(top() + distY() / 2.0)};
    }

    bool mayContain(const Dot& dot) const {
        return dot.x >= left() && dot.x <= right() && dot.y >= top() && dot.y <= bottom();
    }

    double angle() const {
        return distX() == 0 ? std::numbers::pi / 2 : std::atan(static_cast<double>(distY()) / distX());
    }

    bool angleOkWith(const Segment& other) const {
        const double angle = std::abs(this->angle() - other.angle()) * 180 / std::numbers::pi;

        return angle < 10 || std::abs(angle - 180) < 10;
    }

    Dot projectedPoint(const Dot& p) const {
        const int abX = b.x - a.x;
        const int abY = b.y - a.y;

        if (abX == 0 && abY == 0) {
            return a;
        }

        const double factor = (static_cast<double>(p.x - a.x) * abX + static_cast<double>(p.y - a.y) * abY) /
                              (static_cast<double>(abX) * abX + static_cast<double>(abY) * abY);

        return {static_cast<int>(roundHalfEven(a.x + factor * abX)), static_cast<int>(roundHalfEven(a.y + factor * abY))};
    }

    std::optional<Segment> intersect(const Segment& other) const {
        const double gutter = std::max(dist(), other.dist()) * 5 / 100;

        if (!angleOkWith(other)) {
            return std::nullopt;
        }

        if (right() < other.left() - gutter || left() > other.right() + gutter || bottom() < other.top() - gutter ||
            top() > other.bottom() + gutter) {
            return std::nullopt;
        }

        const double distC = Segment(other.a, projectedPoint(other.a)).dist();
        const double distD = Segment(other.b, projectedPoint(other.b)).dist();

        if ((distC + distD) / 2 > gutter) {
            return std::nullopt;
        }

        std::vector<Dot> sorted = {a, b, other.a, other.b};

        std::stable_sort(sorted.begin(), sorted.end(),
                         [](const Dot& p, const Dot& q) { return p.x + p.y < q.x + q.y; });

        return Segment(sorted[1], sorted[2]);
    }

    std::optional<Segment> unite(const Segment& other) const {
        const std::optional<Segment> overlap = intersect(other);

        if (!overlap) {
            return std::nullopt;
        }

        std::vector<Dot> dots = {a, b, other.a, other.b};

        for (const Dot& removed : {overlap->a, overlap->b}) {
            dots.erase(std::find(dots.begin(), dots.end(), removed));
        }

        return Segment(dots[0], dots[1]);
    }

    std::vector<Segment> intersectAll(const std::vector<Segment>& segments) const {
        std::vector<Segment> matches;

        for (const auto& segment : segments) {
            if (std::optional<Segment> found = intersect(segment)) {
                matches.push_back(*found);
            }
        }

        return unionAll(std::move(matches));
    }

    static Segment alongPolygon(const std::vector<Dot>& polygon, int start, int end) {
        const int size = static_cast<int>(polygon.size());
        const auto at = [&](int index) { return polygon[((index % size) + size) % size]; };
        Segment split(at(start), at(end));
        int i = start;
        int j = end;

        for (;;) {
            i--;

            const Segment add(at(i), at(i + 1));

            if (!add.angleOkWith(split)) {
                break;
            }

            split = Segment(add.a, split.b);
        }

        for (;;) {
            j++;

            const Segment add(at(j - 1), at(j));

            if (!add.angleOkWith(split)) {
                break;
            }

            split = Segment(split.a, add.b);
        }

        return split;
    }
};

bool contains(const std::vector<Segment>& list, const Segment& segment) {
    return std::any_of(list.begin(), list.end(), [&](const Segment& item) { return item.equals(segment); });
}

std::vector<Segment> unionAll(std::vector<Segment> segments) {
    bool merged = true;
    std::vector<Segment> result;

    while (merged) {
        merged = false;
        result.clear();

        std::vector<Segment> used;

        for (size_t i = 0; i < segments.size(); i++) {
            const Segment& s1 = segments[i];

            for (size_t j = i + 1; j < segments.size(); j++) {
                const Segment& s2 = segments[j];

                if (contains(used, s2)) {
                    continue;
                }

                if (std::optional<Segment> s3 = s1.unite(s2)) {
                    merged = true;
                    result.push_back(*s3);
                    used.push_back(s1);
                    used.push_back(s2);

                    break;
                }
            }

            if (!contains(used, s1)) {
                result.push_back(s1);
            }
        }

        segments = result;
    }

    return result;
}

enum class Edge { X, Y, R, B };

class Panel;

using PanelPtr = std::shared_ptr<Panel>;

struct Page {
    int width = 0;
    int height = 0;
    bool rtl = true;
    double smallRatio = 0.1;
    std::vector<Segment> segments;
    std::vector<PanelPtr> panels;
};

template <typename Key> PanelPtr firstMax(const std::vector<PanelPtr>& items, Key key) {
    PanelPtr best;

    for (const auto& item : items) {
        if (!best || key(*item) > key(*best)) {
            best = item;
        }
    }

    return best;
}

template <typename Key> PanelPtr firstMin(const std::vector<PanelPtr>& items, Key key) {
    PanelPtr best;

    for (const auto& item : items) {
        if (!best || key(*item) < key(*best)) {
            best = item;
        }
    }

    return best;
}

struct Split;

class Panel : public std::enable_shared_from_this<Panel> {
public:
    Page* page = nullptr;
    int x = 0;
    int y = 0;
    int r = 0;
    int b = 0;
    bool splittable = true;
    std::optional<std::vector<Dot>> polygon;

    Panel(Page* owner, int left, int top, int width, int height, bool canSplit = true)
        : page(owner), x(left), y(top), r(left + width), b(top + height), splittable(canSplit) {}

    // cv::boundingRect for integer points: the width and height count both edges.
    Panel(Page* owner, std::vector<Dot> points, bool canSplit = true) : page(owner), splittable(canSplit) {
        int minX = points[0].x;
        int minY = points[0].y;
        int maxX = points[0].x;
        int maxY = points[0].y;

        for (const auto& point : points) {
            minX = std::min(minX, point.x);
            minY = std::min(minY, point.y);
            maxX = std::max(maxX, point.x);
            maxY = std::max(maxY, point.y);
        }

        x = minX;
        y = minY;
        r = maxX + 1;
        b = maxY + 1;
        polygon = std::move(points);
    }

    static PanelPtr fromXyrb(Page* owner, int left, int top, int right, int bottom) {
        return std::make_shared<Panel>(owner, left, top, right - left, bottom - top);
    }

    int w() const { return r - x; }
    int h() const { return b - y; }
    double wt() const { return w() / 10.0; }
    double ht() const { return h() / 10.0; }

    std::string key() const {
        return std::to_string(x) + "x" + std::to_string(y) + "-" + std::to_string(r) + "x" + std::to_string(b);
    }

    int& at(Edge edge) {
        switch (edge) {
        case Edge::X:
            return x;
        case Edge::Y:
            return y;
        case Edge::R:
            return r;
        case Edge::B:
            return b;
        }

        return x;
    }

    int valueAt(Edge edge) const { return const_cast<Panel*>(this)->at(edge); }

    Segment diagonal() const { return Segment({x, y}, {r, b}); }

    bool equals(const Panel& other) const {
        return std::abs(x - other.x) < wt() && std::abs(y - other.y) < ht() && std::abs(r - other.r) < wt() &&
               std::abs(b - other.b) < ht();
    }

    bool lessThan(const Panel& other) const {
        if (other.y >= b - ht() && other.y >= y - ht()) {
            return true;
        }

        if (y >= other.b - ht() && y >= other.y - ht()) {
            return false;
        }

        if (other.x >= r - wt() && other.x >= x - wt()) {
            return !page->rtl;
        }

        if (x >= other.r - wt() && x >= other.x - wt()) {
            return page->rtl;
        }

        return true;
    }

    long long area() const { return static_cast<long long>(w()) * h(); }

    bool isSmall(double extraRatio = 1) const {
        return w() < page->width * page->smallRatio * extraRatio || h() < page->height * page->smallRatio * extraRatio;
    }

    bool isVerySmall() const { return isSmall(1.0 / 10); }

    PanelPtr overlapPanel(const Panel& other) const {
        if (x > other.r || other.x > r || y > other.b || other.y > b) {
            return nullptr;
        }

        const int left = std::max(x, other.x);
        const int top = std::max(y, other.y);
        const int right = std::min(r, other.r);
        const int bottom = std::min(b, other.b);

        return std::make_shared<Panel>(page, left, top, right - left, bottom - top);
    }

    bool overlaps(const Panel& other) const {
        const PanelPtr overlap = overlapPanel(other);

        if (!overlap) {
            return false;
        }

        const long long smallest = std::min(area(), other.area());

        return smallest == 0 || static_cast<double>(overlap->area()) / smallest > 0.1;
    }

    bool contains(const Panel& other) const {
        const PanelPtr overlap = overlapPanel(other);

        if (!overlap) {
            return false;
        }

        return static_cast<double>(overlap->area()) / other.area() > 0.5;
    }

    bool sameRow(const Panel& other) const {
        const bool thisFirst = !(other.y < y);
        const Panel& above = thisFirst ? *this : other;
        const Panel& below = thisFirst ? other : *this;

        if (below.y > above.b) {
            return false;
        }

        if (below.b < above.b) {
            return true;
        }

        const int minHeight = std::min(above.h(), below.h());

        return minHeight == 0 || static_cast<double>(std::min(above.b, below.b) - below.y) / minHeight >= 1.0 / 3;
    }

    bool sameCol(const Panel& other) const {
        const bool thisFirst = !(other.x < x);
        const Panel& left = thisFirst ? *this : other;
        const Panel& right = thisFirst ? other : *this;

        if (right.x > left.r) {
            return false;
        }

        if (right.r < left.r) {
            return true;
        }

        const int minWidth = std::min(left.w(), right.w());

        return minWidth == 0 || static_cast<double>(std::min(left.r, right.r) - right.x) / minWidth >= 1.0 / 3;
    }

    std::vector<PanelPtr> panelsWhere(const std::function<bool(const Panel&)>& keep) const {
        std::vector<PanelPtr> found;

        for (const auto& panel : page->panels) {
            if (keep(*panel)) {
                found.push_back(panel);
            }
        }

        return found;
    }

    PanelPtr findTopPanel() const {
        return firstMax(panelsWhere([&](const Panel& p) { return p.b <= y && p.sameCol(*this); }),
                        [](const Panel& p) { return p.b; });
    }

    PanelPtr findBottomPanel() const {
        return firstMin(panelsWhere([&](const Panel& p) { return p.y >= b && p.sameCol(*this); }),
                        [](const Panel& p) { return p.y; });
    }

    std::vector<PanelPtr> findAllLeftPanels() const {
        return panelsWhere([&](const Panel& p) { return p.r <= x && p.sameRow(*this); });
    }

    PanelPtr findLeftPanel() const { return firstMax(findAllLeftPanels(), [](const Panel& p) { return p.r; }); }

    std::vector<PanelPtr> findAllRightPanels() const {
        return panelsWhere([&](const Panel& p) { return p.x >= r && p.sameRow(*this); });
    }

    PanelPtr findRightPanel() const { return firstMin(findAllRightPanels(), [](const Panel& p) { return p.x; }); }

    PanelPtr findNeighbourPanel(Edge direction) const {
        switch (direction) {
        case Edge::X:
            return findLeftPanel();
        case Edge::Y:
            return findTopPanel();
        case Edge::R:
            return findRightPanel();
        case Edge::B:
            return findBottomPanel();
        }

        return nullptr;
    }

    PanelPtr groupWith(const Panel& other) const {
        const int left = std::min(x, other.x);
        const int top = std::min(y, other.y);

        return std::make_shared<Panel>(page, left, top, std::max(r, other.r) - left, std::max(b, other.b) - top);
    }

    PanelPtr merge(const PanelPtr& other);

    bool isClose(const Panel& other) const {
        const double c1x = x + w() / 2.0;
        const double c1y = y + h() / 2.0;
        const double c2x = other.x + other.w() / 2.0;
        const double c2y = other.y + other.h() / 2.0;

        return std::abs(c1x - c2x) <= (w() + other.w()) * 0.75 && std::abs(c1y - c2y) <= (h() + other.h()) * 0.75;
    }

    bool bumpsInto(const std::vector<PanelPtr>& others) const;

    bool containsSegment(const Segment& segment) const {
        return overlaps(*fromXyrb(nullptr, segment.left(), segment.top(), segment.right(), segment.bottom()));
    }

    const std::vector<Segment>& getSegments() {
        if (!segmentsCache_) {
            segmentsCache_.emplace();

            for (const auto& segment : page->segments) {
                if (containsSegment(segment)) {
                    segmentsCache_->push_back(segment);
                }
            }
        }

        return *segmentsCache_;
    }

    std::optional<Split> split();

private:
    std::optional<Split> cachedSplit();

    std::optional<std::vector<Segment>> segmentsCache_;
};

// Python's `==` on panels: identity first, then the left operand's fuzzy __eq__.
bool pyEquals(const Panel& item, const Panel& value) {
    return &item == &value || item.equals(value);
}

bool pyIn(const Panel& value, const std::vector<PanelPtr>& list) {
    return std::any_of(list.begin(), list.end(), [&](const PanelPtr& item) { return pyEquals(*item, value); });
}

// Wenbu's TolerantPanels.remove: drops the first equal panel, if there is one.
void pyRemove(std::vector<PanelPtr>& list, const Panel& value) {
    const auto found =
        std::find_if(list.begin(), list.end(), [&](const PanelPtr& item) { return pyEquals(*item, value); });

    if (found != list.end()) {
        list.erase(found);
    }
}

long pyIndex(const std::vector<PanelPtr>& list, const Panel& value) {
    const auto found =
        std::find_if(list.begin(), list.end(), [&](const PanelPtr& item) { return pyEquals(*item, value); });

    return found == list.end() ? -1 : static_cast<long>(found - list.begin());
}

std::vector<PanelPtr> without(const std::vector<PanelPtr>& panels, const std::vector<PanelPtr>& excluded) {
    std::vector<PanelPtr> kept;

    for (const auto& panel : panels) {
        if (!pyIn(*panel, excluded)) {
            kept.push_back(panel);
        }
    }

    return kept;
}

bool Panel::bumpsInto(const std::vector<PanelPtr>& others) const {
    return std::any_of(others.begin(), others.end(),
                       [&](const PanelPtr& other) { return !pyEquals(*other, *this) && overlaps(*other); });
}

PanelPtr Panel::merge(const PanelPtr& other) {
    std::vector<PanelPtr> possible = {shared_from_this()};

    if (other->x < x) {
        possible.push_back(fromXyrb(page, other->x, y, r, b));
    }

    if (other->r > r) {
        for (const auto& pp : std::vector<PanelPtr>(possible)) {
            possible.push_back(fromXyrb(page, pp->x, pp->y, other->r, pp->b));
        }
    }

    if (other->y < y) {
        for (const auto& pp : std::vector<PanelPtr>(possible)) {
            possible.push_back(fromXyrb(page, pp->x, other->y, pp->r, pp->b));
        }
    }

    if (other->b > b) {
        for (const auto& pp : std::vector<PanelPtr>(possible)) {
            possible.push_back(fromXyrb(page, pp->x, pp->y, pp->r, other->b));
        }
    }

    const std::vector<PanelPtr> others = without(page->panels, {shared_from_this(), other});
    std::vector<PanelPtr> allowed;

    for (const auto& p : possible) {
        if (!p->bumpsInto(others)) {
            allowed.push_back(p);
        }
    }

    const PanelPtr best = firstMax(allowed, [](const Panel& p) { return p.area(); });

    return best ? best : shared_from_this();
}

struct Split {
    PanelPtr first;
    PanelPtr second;
    Segment segment;
    double coveredDist = 0;

    Split(Panel& panel, PanelPtr one, PanelPtr two, Segment along)
        : first(std::move(one)), second(std::move(two)), segment(along) {
        for (const auto& matching : segment.intersectAll(panel.getSegments())) {
            coveredDist += matching.dist();
        }
    }

    double coverage() const {
        const double dist = segment.dist();

        return dist == 0 ? 0 : coveredDist / dist;
    }
};

std::optional<Split> Panel::split() {
    if (!splittable) {
        return std::nullopt;
    }

    std::optional<Split> found = cachedSplit();

    if (!found) {
        splittable = false;
    }

    return found;
}

std::optional<Split> Panel::cachedSplit() {
    if (!polygon || isSmall(2)) {
        return std::nullopt;
    }

    constexpr int minHops = 3;
    const int maxDistX = static_cast<int>(w() / 3.0);
    const int maxDistY = static_cast<int>(h() / 3.0);
    const double maxDiagonal = std::sqrt(static_cast<double>(maxDistX) * maxDistX + static_cast<double>(maxDistY) * maxDistY);
    const double dotsAlongLinesDist = maxDiagonal / 5;
    const double minDistBetweenDotsX = maxDistX / 10.0;
    const double minDistBetweenDotsY = maxDistY / 10.0;
    std::vector<Dot> original = *polygon;
    std::vector<Dot> points;

    for (size_t i = 0; i < original.size(); i++) {
        const size_t j = (i + 1) % original.size();
        const Dot dot1 = original[i];
        const Dot dot2 = original[j];
        const Segment seg(dot1, dot2);

        if (seg.distX() < minDistBetweenDotsX && seg.distY() < minDistBetweenDotsY) {
            original[j] = seg.center();

            continue;
        }

        points.push_back(dot1);

        std::vector<Dot> addDots;

        if (seg.dist() < dotsAlongLinesDist * 2) {
            continue;
        }

        for (size_t k = 0; k < original.size(); k++) {
            if (std::abs(static_cast<long>(k) - static_cast<long>(i)) < minHops) {
                continue;
            }

            const Dot projected = seg.projectedPoint(original[k]);

            if (!seg.mayContain(projected)) {
                continue;
            }

            const Segment project(original[k], projected);

            if (project.distX() > maxDistX || project.distY() > maxDistY) {
                continue;
            }

            addDots.push_back(projected);
        }

        const double alphaX = std::acos(seg.distX(true) / seg.dist());
        const double alphaY = std::asin(seg.distY(true) / seg.dist());
        const int distX = static_cast<int>(std::cos(alphaX) * dotsAlongLinesDist);
        const int distY = static_cast<int>(std::sin(alphaY) * dotsAlongLinesDist);

        addDots.push_back({dot1.x + distX, dot1.y + distY});
        addDots.push_back({dot2.x - distX, dot2.y - distY});
        std::stable_sort(addDots.begin(), addDots.end(), [&](const Dot& p, const Dot& q) {
            return Segment(dot1, p).dist() < Segment(dot1, q).dist();
        });
        points.insert(points.end(), addDots.begin(), addDots.end());
    }

    original = points;
    points.clear();

    for (size_t i = 0; i < original.size(); i++) {
        const size_t j = (i + 1) % original.size();
        const Dot dot1 = original[i];
        const Segment seg(dot1, original[j]);

        if (seg.distX() < minDistBetweenDotsX && seg.distY() < minDistBetweenDotsY) {
            original[j] = seg.center();

            continue;
        }

        points.push_back(dot1);
    }

    std::vector<std::pair<int, int>> nearby;
    const int count = static_cast<int>(points.size());

    for (int i = 0; i < count - minHops; i++) {
        for (int j = i + minHops; j < count; j++) {
            const Segment seg(points[i], points[j]);

            if (seg.distX() <= maxDistX && seg.distY() <= maxDistY) {
                nearby.emplace_back(i, j);
            }
        }
    }

    if (nearby.empty()) {
        return std::nullopt;
    }

    std::vector<Split> splits;

    for (const auto& [first, last] : nearby) {
        const int poly1Length = count - last + first;
        const int poly2Length = last - first;

        if (std::min(poly1Length, poly2Length) <= 2) {
            continue;
        }

        std::vector<Dot> poly1;
        std::vector<Dot> poly2;

        for (int i = 0; i < count; i++) {
            if (i <= first || i > last) {
                poly1.push_back(points[i]);
            } else {
                poly2.push_back(points[i]);
            }
        }

        const PanelPtr panel1 = std::make_shared<Panel>(page, std::move(poly1));
        const PanelPtr panel2 = std::make_shared<Panel>(page, std::move(poly2));

        if (panel1->isSmall() || panel2->isSmall()) {
            continue;
        }

        if (pyEquals(*panel1, *this) || pyEquals(*panel2, *this)) {
            continue;
        }

        if (panel1->overlaps(*panel2)) {
            continue;
        }

        Split split(*this, panel1, panel2, Segment::alongPolygon(points, first, last));

        if (std::none_of(splits.begin(), splits.end(),
                         [&](const Split& existing) { return existing.segment.equals(split.segment); })) {
            splits.push_back(std::move(split));
        }
    }

    const Split* best = nullptr;

    for (const auto& split : splits) {
        if (split.coverage() > 0.5 && (best == nullptr || split.coveredDist > best->coveredDist)) {
            best = &split;
        }
    }

    return best == nullptr ? std::nullopt : std::optional<Split>(*best);
}

// CPython's list.sort with Panel.__lt__ as the only comparison. Below 64 items, which a page never
// reaches, TimSort is its first run (count_run, reversed when strictly descending) extended by binary
// insertion; this sorts longer lists the same way rather than merging runs.
void pySort(std::vector<PanelPtr>& list) {
    const size_t n = list.size();

    if (n < 2) {
        return;
    }

    const auto less = [](const PanelPtr& p, const PanelPtr& q) { return p->lessThan(*q); };
    size_t run = 2;

    if (less(list[1], list[0])) {
        while (run < n && less(list[run], list[run - 1])) {
            run++;
        }

        std::reverse(list.begin(), list.begin() + static_cast<long>(run));
    } else {
        while (run < n && !less(list[run], list[run - 1])) {
            run++;
        }
    }

    for (size_t start = run; start < n; start++) {
        const PanelPtr pivot = list[start];
        size_t low = 0;
        size_t high = start;

        while (low < high) {
            const size_t middle = low + ((high - low) >> 1);

            if (less(pivot, list[middle])) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }

        for (size_t p = start; p > low; p--) {
            list[p] = list[p - 1];
        }

        list[low] = pivot;
    }
}

void groupSmallPanels(Page& page) {
    std::vector<PanelPtr> small;

    for (const auto& panel : page.panels) {
        if (panel->isSmall()) {
            small.push_back(panel);
        }
    }

    struct Entry {
        std::string key;
        PanelPtr panel;
        int id;
    };

    std::vector<Entry> groups;
    int groupId = 0;

    const auto find = [&](const std::string& key) -> long {
        const auto found = std::find_if(groups.begin(), groups.end(), [&](const Entry& entry) { return entry.key == key; });

        return found == groups.end() ? -1 : static_cast<long>(found - groups.begin());
    };

    const auto set = [&](const PanelPtr& panel, int id) {
        const long existing = find(panel->key());

        if (existing >= 0) {
            groups[existing].panel = panel;
            groups[existing].id = id;
        } else {
            groups.push_back({panel->key(), panel, id});
        }
    };

    for (size_t i = 0; i < small.size(); i++) {
        const PanelPtr& p1 = small[i];

        for (size_t j = i + 1; j < small.size(); j++) {
            const PanelPtr& p2 = small[j];

            if (pyEquals(*p1, *p2) || !p1->isClose(*p2)) {
                continue;
            }

            const long g1 = find(p1->key());
            const long g2 = find(p2->key());

            if (g1 < 0 && g2 < 0) {
                groupId++;
                set(p1, groupId);
                set(p2, groupId);
            } else if (g1 >= 0 && g2 < 0) {
                set(p2, groups[g1].id);
            } else if (g2 >= 0 && g1 < 0) {
                set(p1, groups[g2].id);
            } else if (g1 >= 0 && g2 >= 0 && groups[g1].id != groups[g2].id) {
                // Python re-reads groups[p2] on every step, so entries after p2 keep their old group.
                for (auto& entry : groups) {
                    if (entry.id == groups[g2].id) {
                        entry.id = groups[g1].id;
                    }
                }
            }
        }
    }

    std::vector<std::pair<int, std::vector<PanelPtr>>> grouped;

    for (const auto& entry : groups) {
        auto found = std::find_if(grouped.begin(), grouped.end(), [&](const auto& group) { return group.first == entry.id; });

        if (found == grouped.end()) {
            grouped.push_back({entry.id, {entry.panel}});
        } else {
            found->second.push_back(entry.panel);
        }
    }

    for (const auto& [id, members] : grouped) {
        std::vector<cv::Point> points;

        for (const auto& member : members) {
            for (const auto& dot : *member->polygon) {
                points.emplace_back(dot.x, dot.y);
            }
        }

        std::vector<cv::Point> hull;

        cv::convexHull(points, hull, false, true);

        std::vector<Dot> hullDots;

        for (const auto& point : hull) {
            hullDots.push_back({point.x, point.y});
        }

        page.panels.push_back(std::make_shared<Panel>(&page, std::move(hullDots), false));

        for (const auto& member : members) {
            pyRemove(page.panels, *member);
        }
    }
}

void splitPanels(Page& page) {
    bool didSplit = true;

    while (didSplit) {
        didSplit = false;

        std::vector<PanelPtr> bySize = page.panels;

        std::stable_sort(bySize.begin(), bySize.end(),
                         [](const PanelPtr& p, const PanelPtr& q) { return q->area() < p->area(); });

        for (const auto& panel : bySize) {
            if (std::optional<Split> split = panel->split()) {
                didSplit = true;
                pyRemove(page.panels, *panel);
                page.panels.push_back(split->first);
                page.panels.push_back(split->second);

                break;
            }
        }
    }
}

void dropSmall(Page& page) {
    std::erase_if(page.panels, [](const PanelPtr& panel) { return panel->isSmall(); });
}

void mergePanels(Page& page) {
    std::vector<PanelPtr> toRemove;

    for (size_t i = 0; i < page.panels.size(); i++) {
        PanelPtr p1 = page.panels[i];

        for (size_t j = i + 1; j < page.panels.size(); j++) {
            PanelPtr p2 = page.panels[j];

            if (p1->contains(*p2)) {
                toRemove.push_back(p2);
                p1 = p1->merge(p2);
            } else if (p2->contains(*p1)) {
                toRemove.push_back(p1);
                p2 = p2->merge(p1);
            }
        }
    }

    std::vector<std::string> seen;

    for (const auto& panel : toRemove) {
        const std::string key = panel->key();

        if (std::find(seen.begin(), seen.end(), key) == seen.end()) {
            seen.push_back(key);
            pyRemove(page.panels, *panel);
        }
    }
}

void deoverlapPanels(Page& page) {
    for (const auto& p1 : page.panels) {
        for (const auto& p2 : page.panels) {
            if (pyEquals(*p1, *p2)) {
                continue;
            }

            const PanelPtr overlap = p1->overlapPanel(*p2);

            if (!overlap) {
                continue;
            }

            if (overlap->w() < overlap->h() && p1->r == overlap->r) {
                p1->r = overlap->x;
                p2->x = overlap->r;

                continue;
            }

            if (overlap->w() > overlap->h() && p1->b == overlap->b) {
                p1->b = overlap->y;
                p2->y = overlap->b;
            }
        }
    }
}

struct Gutters {
    int x;
    int y;

    int at(Edge edge) const {
        switch (edge) {
        case Edge::X:
            return x;
        case Edge::Y:
            return y;
        case Edge::R:
            return -x;
        case Edge::B:
            return -y;
        }

        return x;
    }
};

Gutters actualGutters(const Page& page) {
    std::vector<int> gutterX;
    std::vector<int> gutterY;

    for (const auto& p : page.panels) {
        if (const PanelPtr left = p->findLeftPanel()) {
            gutterX.push_back(p->x - left->r);
        }

        if (const PanelPtr top = p->findTopPanel()) {
            gutterY.push_back(p->y - top->b);
        }
    }

    return {gutterX.empty() ? 1 : *std::min_element(gutterX.begin(), gutterX.end()),
            gutterY.empty() ? 1 : *std::min_element(gutterY.begin(), gutterY.end())};
}

Edge opposite(Edge edge) {
    switch (edge) {
    case Edge::X:
        return Edge::R;
    case Edge::R:
        return Edge::X;
    case Edge::Y:
        return Edge::B;
    case Edge::B:
        return Edge::Y;
    }

    return Edge::X;
}

void expandPanels(Page& page) {
    const Gutters gutters = actualGutters(page);

    for (const auto& p : page.panels) {
        for (const Edge d : {Edge::X, Edge::Y, Edge::R, Edge::B}) {
            const PanelPtr neighbour = p->findNeighbourPanel(d);
            const bool start = d == Edge::X || d == Edge::Y;
            int newCoord = -1;

            if (neighbour) {
                newCoord = neighbour->valueAt(opposite(d)) + gutters.at(d);
            } else {
                const auto key = [d](const Panel& panel) { return panel.valueAt(d); };
                const PanelPtr extreme = start ? firstMin(page.panels, key) : firstMax(page.panels, key);

                newCoord = extreme ? extreme->valueAt(d) : -1;
            }

            if (newCoord != -1 && ((!start && newCoord > p->valueAt(d)) || (start && newCoord < p->valueAt(d)))) {
                p->at(d) = newCoord;
            }
        }
    }
}

void groupBigPanels(Page& page) {
    bool grouped = true;

    while (grouped) {
        grouped = false;

        for (size_t i = 0; i < page.panels.size() && !grouped; i++) {
            const PanelPtr p1 = page.panels[i];

            for (size_t j = i + 1; j < page.panels.size(); j++) {
                const PanelPtr p2 = page.panels[j];
                const PanelPtr p3 = p1->groupWith(*p2);

                if (p3->bumpsInto(without(page.panels, {p1, p2}))) {
                    continue;
                }

                const double limit = p3->diagonal().dist() / 5;
                const bool crossing = std::any_of(page.segments.begin(), page.segments.end(), [&](const Segment& segment) {
                    return p3->containsSegment(segment) && segment.dist() > limit;
                });

                if (crossing) {
                    continue;
                }

                page.panels.push_back(p3);
                pyRemove(page.panels, *p1);
                pyRemove(page.panels, *p2);
                grouped = true;

                break;
            }
        }
    }
}

void fixPanelsNumbering(Page& page) {
    int changes = 1;

    while (changes > 0) {
        changes = 0;

        for (size_t i = 0; i < page.panels.size() && changes == 0; i++) {
            const PanelPtr p = page.panels[i];
            std::vector<PanelPtr> before = {p->findTopPanel()};
            const std::vector<PanelPtr> sideways = page.rtl ? p->findAllRightPanels() : p->findAllLeftPanels();

            before.insert(before.end(), sideways.begin(), sideways.end());

            for (const auto& neighbour : before) {
                if (!neighbour) {
                    continue;
                }

                const long position = pyIndex(page.panels, *neighbour);

                if (static_cast<long>(i) < position) {
                    changes++;

                    const PanelPtr moved = page.panels[i];

                    page.panels.erase(page.panels.begin() + static_cast<long>(i));
                    page.panels.insert(page.panels.begin() + position, moved);

                    break;
                }
            }
        }
    }
}

}

// The image is converted as if it were BGR, because Kumiko is handed RGB pixels.
PanelFeatures panelFeatures(const Rgb& page) {
    const cv::Mat image(page.height, page.width, CV_8UC3, const_cast<uint8_t*>(page.data.data()));
    cv::Mat gray;
    cv::Mat gradX;
    cv::Mat gradY;
    cv::Mat absX;
    cv::Mat absY;
    cv::Mat sobel;
    cv::Mat thresh;
    PanelFeatures features;

    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    cv::Sobel(gray, gradX, CV_16S, 1, 0, 3, 1, 0, cv::BORDER_DEFAULT);
    cv::Sobel(gray, gradY, CV_16S, 0, 1, 3, 1, 0, cv::BORDER_DEFAULT);
    cv::convertScaleAbs(gradX, absX);
    cv::convertScaleAbs(gradY, absY);
    cv::addWeighted(absX, 0.5, absY, 0.5, 0, sobel);
    cv::threshold(sobel, thresh, 100, 255, cv::THRESH_BINARY);
    cv::findContours(thresh, features.contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
    cv::createLineSegmentDetector(cv::LSD_REFINE_NONE)->detect(gray, features.segments);

    return features;
}

std::vector<PanelBox> findPanels(int width, int height, const PanelFeatures& features, bool rtl) {
    Page page;

    page.width = width;
    page.height = height;
    page.rtl = rtl;

    double minDist = std::min(width, height) * page.smallRatio;
    std::vector<Segment> segments;

    for (bool first = true; first || segments.size() > 500; first = false) {
        segments.clear();

        for (const auto& line : features.segments) {
            const int x0 = static_cast<int>(roundHalfEven(line[0]));
            const int y0 = static_cast<int>(roundHalfEven(line[1]));
            const int x1 = static_cast<int>(roundHalfEven(line[2]));
            const int y1 = static_cast<int>(roundHalfEven(line[3]));

            if (std::sqrt(static_cast<double>(x0 - x1) * (x0 - x1) + static_cast<double>(y0 - y1) * (y0 - y1)) >= minDist) {
                segments.emplace_back(Dot{x0, y0}, Dot{x1, y1});
            }
        }

        if (features.segments.empty()) {
            break;
        }

        minDist *= 1.1;
    }

    page.segments = unionAll(std::move(segments));

    for (const auto& contour : features.contours) {
        std::vector<cv::Point> approx;

        cv::approxPolyDP(contour, approx, 0.001 * cv::arcLength(contour, true), true);

        std::vector<Dot> polygon;

        for (const auto& point : approx) {
            polygon.push_back({point.x, point.y});
        }

        auto panel = std::make_shared<Panel>(&page, std::move(polygon));

        if (!panel->isVerySmall()) {
            page.panels.push_back(std::move(panel));
        }
    }

    groupSmallPanels(page);
    splitPanels(page);
    dropSmall(page);
    mergePanels(page);
    deoverlapPanels(page);
    dropSmall(page);
    pySort(page.panels);
    expandPanels(page);

    if (page.panels.empty()) {
        page.panels.push_back(std::make_shared<Panel>(&page, 0, 0, width, height));
    }

    groupBigPanels(page);
    fixPanelsNumbering(page);

    std::vector<PanelBox> boxes;

    for (const auto& p : page.panels) {
        boxes.push_back({p->x, p->y, p->w(), p->h()});
    }

    return boxes;
}

}
