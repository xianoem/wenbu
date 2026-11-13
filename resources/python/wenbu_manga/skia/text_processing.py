import contextvars
import re
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

import numpy as np

STYLE_PATTERN = re.compile(r"(\*{1,3})(.*?)(\1)")


@dataclass(frozen=True)
class LineBreaking:
    mode: str = "balanced"
    avoid_orphans: bool = True
    even_out: bool = False


line_breaking: contextvars.ContextVar[LineBreaking] = contextvars.ContextVar(
    "line_breaking", default=LineBreaking(avoid_orphans=False)
)


def is_rtl_script(text: str) -> bool:
    rtl_count = 0
    ltr_count = 0
    for ch in text:
        cp = ord(ch)
        if ch.isspace() or ch in ("*",):
            continue
        if (
            0x0600 <= cp <= 0x06FF
            or 0x0750 <= cp <= 0x077F
            or 0x08A0 <= cp <= 0x08FF
            or 0xFB50 <= cp <= 0xFDFF
            or 0xFE70 <= cp <= 0xFEFF
        ):
            rtl_count += 1
        elif 0x0590 <= cp <= 0x05FF or 0xFB1D <= cp <= 0xFB4F:
            rtl_count += 1
        elif 0x0780 <= cp <= 0x07BF:
            rtl_count += 1
        elif 0x07C0 <= cp <= 0x07FA:
            rtl_count += 1
        else:
            ltr_count += 1
    return rtl_count > ltr_count


def is_latin_style_language(language_name: str) -> bool:
    latin_style_languages = {
        "english", "french", "spanish", "german", "italian", "portuguese",
        "dutch", "polish", "czech", "swedish", "danish", "norwegian",
        "finnish", "hungarian", "romanian", "turkish", "vietnamese",
        "indonesian", "malay", "tagalog",
    }
    return language_name.lower() in latin_style_languages


def _is_hangul_character(char: str) -> bool:
    if len(char) != 1:
        return False
    code = ord(char)
    return (
        (0xAC00 <= code <= 0xD7AF)
        or (0x1100 <= code <= 0x11FF)
        or (0x3130 <= code <= 0x318F)
    )


def is_cjk_character(char: str) -> bool:
    if len(char) != 1:
        return False
    code = ord(char)
    return (
        (0x4E00 <= code <= 0x9FFF)
        or (0x3400 <= code <= 0x4DBF)
        or (0x20000 <= code <= 0x2CEAF)
        or (0xF900 <= code <= 0xFAFF)
        or (0x3040 <= code <= 0x309F)
        or (0x30A0 <= code <= 0x30FF)
        or (0x31F0 <= code <= 0x31FF)
        or (0xAC00 <= code <= 0xD7AF)
        or (0x1100 <= code <= 0x11FF)
        or (0x3130 <= code <= 0x318F)
        or (0x3000 <= code <= 0x303F)
        or (0xFF00 <= code <= 0xFFEF)
    )


def parse_styled_segments(text: str) -> List[Tuple[str, str]]:
    segments = []
    last_end = 0
    for match in STYLE_PATTERN.finditer(text):
        start, end = match.span()
        marker = match.group(1)
        content = match.group(2)

        if start > last_end:
            segments.append((text[last_end:start], "regular"))

        style = "regular"
        if len(marker) == 3:
            style = "bold_italic"
        elif len(marker) == 2:
            style = "bold"
        elif len(marker) == 1:
            style = "italic"

        segments.append((content, style))
        last_end = end

    if last_end < len(text):
        segments.append((text[last_end:], "regular"))

    return [(txt, style) for txt, style in segments if txt]


KINSOKU_NOT_AT_START = set(
    "、。，．！？）】」』〕〉》，．！？）］｝,.)!?;:…‥ー"
    "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ"
)
KINSOKU_NOT_AT_END = set("（【「『〔〈《（［｛([")


def _split_with_cjk_awareness(
    text: str, detach_trailing_ellipsis: bool = True
) -> List[str]:
    tokens: List[str] = []
    current_token = ""

    for char in text:
        if char.isspace():
            if current_token:
                tokens.append(current_token)
                current_token = ""
        elif is_cjk_character(char) and not _is_hangul_character(char):
            if char in KINSOKU_NOT_AT_START:
                if current_token:
                    current_token += char
                elif tokens:
                    tokens[-1] += char
                else:
                    current_token = char
            elif char in KINSOKU_NOT_AT_END:
                if current_token:
                    tokens.append(current_token)
                current_token = char
            else:
                if current_token:
                    if current_token[-1] in KINSOKU_NOT_AT_END:
                        current_token += char
                        tokens.append(current_token)
                        current_token = ""
                    else:
                        tokens.append(current_token)
                        current_token = ""
                        tokens.append(char)
                else:
                    tokens.append(char)
        else:
            current_token += char

    if current_token:
        tokens.append(current_token)

    if detach_trailing_ellipsis:
        final_tokens = []
        ellipsis_re = re.compile(r"^(.*?)((\.{2,})[\)\]\}\u2019\u201D\'\"]*)$")
        for t in tokens:
            m = ellipsis_re.match(t)
            if m and m.group(1):
                final_tokens.append(m.group(1))
                final_tokens.append(m.group(2))
            else:
                final_tokens.append(t)
        return final_tokens

    return tokens


def tokenize_styled_text(
    text: str, detach_trailing_ellipsis: bool = True
) -> List[Tuple[str, bool]]:
    tokens: List[Tuple[str, bool]] = []
    last_end = 0
    for match in STYLE_PATTERN.finditer(text):
        start, end = match.span()
        if start > last_end:
            preceding = text[last_end:start]
            for w in _split_with_cjk_awareness(preceding, detach_trailing_ellipsis):
                tokens.append((w, False))

        marker = match.group(1)
        content = match.group(2)
        if content:
            for w in _split_with_cjk_awareness(content, detach_trailing_ellipsis):
                tokens.append((f"{marker}{w}{marker}", True))

        last_end = end

    if last_end < len(text):
        trailing = text[last_end:]
        for w in _split_with_cjk_awareness(trailing, detach_trailing_ellipsis):
            tokens.append((w, False))

    return tokens


def try_hyphenate_word(
    word_str: str,
    min_word_length: int,
    width_test_func: Callable[[str], bool],
) -> Optional[List[str]]:
    match = re.match(r"^(\W*)([\w\-]+)(\W*)$", word_str)
    if not match:
        return None

    leading_punc, core_word, trailing_punc = match.groups()

    if len(core_word) < min_word_length:
        return None

    def _split_with_single_hyphen(base: str, idx: int) -> Tuple[str, str]:
        ch_before = base[idx - 1] if idx > 0 else ""
        ch_at = base[idx] if idx < len(base) else ""
        if ch_at == "-":
            left = base[: idx + 1]
            right = base[idx + 1 :]
        elif ch_before == "-":
            left = base[:idx]
            right = base[idx:]
        else:
            left = base[:idx] + "-"
            right = base[idx:]
        if left.endswith("-") and right.startswith("-"):
            right = right[1:]
        return left, right

    if "-" in core_word:
        hyphen_positions = [i for i, ch in enumerate(core_word) if ch == "-"]
        mid = len(core_word) // 2
        hyphen_positions.sort(key=lambda i: abs(i - mid))
        for pos in hyphen_positions:
            if pos <= 0 or pos >= len(core_word) - 1:
                continue
            left_part = core_word[: pos + 1]
            right_part = core_word[pos + 1 :]

            final_left_part = leading_punc + left_part
            final_right_part = right_part + trailing_punc

            if width_test_func(final_left_part) and width_test_func(final_right_part):
                return [final_left_part, final_right_part]

    mid = len(core_word) // 2
    candidate_indices: List[int] = []
    max_d = max(mid, len(core_word) - mid)
    for d in range(0, max_d):
        left_idx = mid - d
        right_idx = mid + d
        if 2 <= left_idx < len(core_word) - 2:
            candidate_indices.append(left_idx)
        if 2 <= right_idx < len(core_word) - 2 and right_idx != left_idx:
            candidate_indices.append(right_idx)

    for idx in candidate_indices:
        left_part, right_part = _split_with_single_hyphen(core_word, idx)

        final_left_part = leading_punc + left_part
        final_right_part = right_part + trailing_punc

        if width_test_func(final_left_part) and width_test_func(final_right_part):
            return [final_left_part, final_right_part]

    return None


def _is_cjk_token(token: str) -> bool:
    match = STYLE_PATTERN.match(token)
    content = match.group(2) if match else token
    return len(content) > 0 and all(
        is_cjk_character(c) and not _is_hangul_character(c) for c in content
    )


def _needs_space_between(
    left_token: str, right_token: str, detach_trailing_ellipsis: bool = True
) -> bool:
    if _is_cjk_token(left_token) and _is_cjk_token(right_token):
        return False

    if detach_trailing_ellipsis:
        match = STYLE_PATTERN.match(right_token)
        r_content = match.group(2) if match else right_token
        if re.match(r"^(\.{2,})[\)\]\}\u2019\u201D\'\"]*$", r_content):
            return False

    return True


def _join_tokens_smart(tokens: List[str], detach_trailing_ellipsis: bool = True) -> str:
    if not tokens:
        return ""
    result = tokens[0]
    for i in range(1, len(tokens)):
        if _needs_space_between(tokens[i - 1], tokens[i], detach_trailing_ellipsis):
            result += " " + tokens[i]
        else:
            result += tokens[i]
    return result


def _greedy_breaks(
    tokens: List[str],
    token_w: List[float],
    max_width: float,
    space_width: float,
    detach_trailing_ellipsis: bool,
) -> Optional[List[str]]:
    lines: List[List[str]] = []
    width = 0.0

    for token, token_width in zip(tokens, token_w):
        if lines:
            gap = space_width if _needs_space_between(lines[-1][-1], token, detach_trailing_ellipsis) else 0.0

            if width + gap + token_width <= max_width:
                lines[-1].append(token)
                width += gap + token_width
                continue

        if token_width > max_width:
            return None

        lines.append([token])
        width = token_width

    return [_join_tokens_smart(line, detach_trailing_ellipsis) for line in lines]


def evened_breaks(
    tokens: List[str],
    max_width: float,
    word_width_func: Callable[[str], float],
    space_width: float,
    line_width_func: Callable[[str], float],
    *rest,
) -> Optional[List[str]]:
    lines = find_optimal_breaks_dp(tokens, max_width, word_width_func, space_width, *rest)
    style = line_breaking.get()

    if not lines or len(lines) < 2 or style.mode != "balanced" or not style.even_out:
        return lines

    low, high, best = 0.0, max_width, lines

    for _ in range(10):
        width = (low + high) / 2
        tried = find_optimal_breaks_dp(tokens, width, word_width_func, space_width, *rest)

        if tried and len(tried) == len(lines) and max(line_width_func(line) for line in tried) <= width:
            best, high = tried, width
        else:
            low = width

    return best


def find_optimal_breaks_dp(
    tokens: List[str],
    max_width: float,
    word_width_func: Callable[[str], float],
    space_width: float,
    badness_exponent: float = 3.0,
    hyphen_penalty: float = 1000.0,
    detach_trailing_ellipsis: bool = True,
) -> Optional[List[str]]:
    try:
        if not tokens:
            return []

        token_w: List[float] = [word_width_func(t) for t in tokens]
        style = line_breaking.get()

        if style.mode == "greedy":
            return _greedy_breaks(tokens, token_w, max_width, space_width, detach_trailing_ellipsis)

        orphan_penalty = pow(max_width, badness_exponent) if style.avoid_orphans else 0.0
        N = len(tokens)
        min_cost: List[float] = [float("inf")] * (N + 1)
        path: List[int] = [0] * (N + 1)
        min_cost[0] = 0.0

        for i in range(1, N + 1):
            line_width = 0.0
            for j in range(i - 1, -1, -1):
                if j < i - 1:
                    if _needs_space_between(
                        tokens[j], tokens[j + 1], detach_trailing_ellipsis
                    ):
                        line_width += space_width
                line_width += token_w[j]

                if line_width > max_width:
                    break

                slack = max_width - line_width
                badness = pow(slack, badness_exponent)

                last_token = tokens[i - 1] if i > 0 else ""
                ends_with_hyphen = last_token.endswith("-")
                if not ends_with_hyphen:
                    styled_match = STYLE_PATTERN.match(last_token)
                    if styled_match:
                        ends_with_hyphen = styled_match.group(2).endswith("-")
                if ends_with_hyphen:
                    badness += hyphen_penalty

                if i == N and j == i - 1 and j > 0:
                    badness += orphan_penalty

                total_cost = min_cost[j] + badness
                if total_cost < min_cost[i]:
                    min_cost[i] = total_cost
                    path[i] = j

        if not np.isfinite(min_cost[N]):
            return None

        lines: List[str] = []
        current_break = N
        while current_break > 0:
            prev_break = path[current_break]
            line = _join_tokens_smart(
                tokens[prev_break:current_break], detach_trailing_ellipsis
            )
            lines.insert(0, line)
            current_break = prev_break

        return lines

    except Exception:
        return None
