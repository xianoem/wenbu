import importlib.util
import os

# The skia package imports upstream on load; the breaker itself needs only numpy.
spec = importlib.util.spec_from_file_location(
    "text_processing", os.path.join(os.path.dirname(__file__), "skia", "text_processing.py")
)
text_processing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(text_processing)

LineBreaking = text_processing.LineBreaking


def breaks(words, width, style):
    token = text_processing.line_breaking.set(style)

    try:
        return text_processing.find_optimal_breaks_dp(words, width, lambda word: float(len(word)), 1.0)
    finally:
        text_processing.line_breaking.reset(token)


def test_balanced_lines_come_out_even():
    words = ["you're", "really", "going", "through", "with", "it?"]

    assert breaks(words, 14, LineBreaking("balanced", avoid_orphans=False)) == ["you're really", "going through", "with it?"]


def test_greedy_fills_each_line_before_the_next():
    lines = breaks(["aaaa", "bb", "cc", "dddddd"], 10, LineBreaking("greedy", avoid_orphans=False))

    assert lines == ["aaaa bb cc", "dddddd"]


def test_balanced_avoids_a_single_word_on_the_last_line():
    assert breaks(["hello", "there", "world"], 11, LineBreaking("balanced", avoid_orphans=True)) == ["hello", "there world"]


def evened(words, width, style):
    token = text_processing.line_breaking.set(style)

    try:
        return text_processing.evened_breaks(words, width, lambda word: float(len(word)), 1.0, lambda line: float(len(line)))
    finally:
        text_processing.line_breaking.reset(token)


def test_evened_lines_use_the_narrowest_measure_that_keeps_the_line_count():
    words = "and launched an immediate assault on the enemy base before dawn".split()
    full = breaks(words, 30, LineBreaking("balanced", avoid_orphans=False))
    even = evened(words, 30, LineBreaking("balanced", avoid_orphans=False, even_out=True))

    assert full == ["and launched an immediate", "assault on the enemy", "base before dawn"]
    assert even == ["and launched an", "immediate assault on the", "enemy base before dawn"]


def test_greedy_lines_are_never_evened():
    words = ["the", "divatron", "x", "team", "tracked", "down", "the", "plant"]
    style = LineBreaking("greedy", avoid_orphans=False, even_out=True)

    assert evened(words, 30, style) == breaks(words, 30, style)
