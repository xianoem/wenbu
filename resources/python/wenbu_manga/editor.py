from typing import Any, Optional

import cv2
import numpy as np

SCAN_MARGIN = 6

FLAT = 8


def parse_blocks(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("Blocks must be a list.")

    for block in value:
        box = block.get("box") if isinstance(block, dict) else None

        if not isinstance(box, list) or len(box) != 4 or not all(isinstance(edge, (int, float)) for edge in box):
            raise ValueError("Each block needs a box of four numbers.")

    return value


def clipped(box: list[float], width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (int(round(edge)) for edge in box)

    return max(0, x1), max(0, y1), min(width, x2), min(height, y2)


def stroke_mask(gray: np.ndarray) -> np.ndarray:
    if gray.size == 0 or int(gray.max()) - int(gray.min()) < FLAT:
        return np.full(gray.shape, 255, dtype=np.uint8)

    _, dark = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    strokes = dark if np.count_nonzero(dark) <= dark.size / 2 else cv2.bitwise_not(dark)

    return cv2.dilate(strokes, np.ones((3, 3), np.uint8), iterations=2)


def block_mask(scan: np.ndarray, gray: np.ndarray, block: dict[str, Any]) -> np.ndarray:
    height, width = gray.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)

    if not block.get("drawn"):
        x1, y1, x2, y2 = block["box"]
        x1, y1, x2, y2 = clipped([x1 - SCAN_MARGIN, y1 - SCAN_MARGIN, x2 + SCAN_MARGIN, y2 + SCAN_MARGIN], width, height)

        if x2 > x1 and y2 > y1:
            mask[y1:y2, x1:x2] = np.where(scan[y1:y2, x1:x2] >= 127, 255, 0).astype(np.uint8)

        if mask.any():
            return mask

    x1, y1, x2, y2 = clipped(block["box"], width, height)

    if x2 > x1 and y2 > y1:
        crop = gray[y1:y2, x1:x2]
        colours = scanned_colours(block)
        mask[y1:y2, x1:x2] = stroke_mask(crop) if colours is None else colour_mask(crop, *colours)

    return mask


def scanned_colours(block: dict[str, Any]) -> Optional[tuple[float, float]]:
    fg, bg = block.get("fg"), block.get("bg")

    if not isinstance(fg, list) or not isinstance(bg, list) or len(fg) != 3 or len(bg) != 3:
        return None

    text, paper = float(np.mean(fg)), float(np.mean(bg))

    return None if abs(text - paper) < FLAT else (text, paper)


def colour_mask(gray: np.ndarray, text: float, paper: float) -> np.ndarray:
    strokes = np.where(np.abs(gray - text) < np.abs(gray - paper), 255, 0).astype(np.uint8)

    return cv2.dilate(strokes, np.ones((3, 3), np.uint8), iterations=2)


def cleaning_mask(scan: np.ndarray, gray: np.ndarray, blocks: list[dict[str, Any]]) -> np.ndarray:
    mask = np.zeros(gray.shape[:2], dtype=np.uint8)

    for block in blocks:
        mask |= block_mask(scan, gray, block)

    return mask


PAPER = 200

LARGEST_BUBBLE = 25


def bubble_around(rgb: np.ndarray, gray: np.ndarray, box: list[float]):
    height, width = gray.shape[:2]
    x1, y1, x2, y2 = clipped(box, width, height)

    if x2 <= x1 or y2 <= y1:
        return None

    # Dilating the ink seals breaks in the outline that would let the paper leak out.
    seal = max(2, height // 800)
    ink = cv2.dilate((gray < PAPER).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=seal)
    paper = (1 - ink).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(paper[y1:y2, x1:x2], connectivity=4)

    if count < 2:
        return None

    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.nonzero(labels == largest)
    seed = (int(xs[0]) + x1, int(ys[0]) + y1)
    flood = np.zeros((height + 2, width + 2), dtype=np.uint8)
    cv2.floodFill(paper, flood, seed, 1, flags=4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY)
    inside = flood[1:-1, 1:-1]

    if np.count_nonzero(inside) > (x2 - x1) * (y2 - y1) * LARGEST_BUBBLE:
        return None

    grown = cv2.dilate(inside, np.ones((3, 3), np.uint8), iterations=seal)
    contours, _ = cv2.findContours(grown, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    bubble = np.zeros_like(inside)
    cv2.drawContours(bubble, contours, -1, 255, thickness=-1)
    colour = np.median(rgb[inside > 0], axis=0).astype(np.uint8)

    return bubble, colour


def grown(mask: np.ndarray) -> np.ndarray:
    reach = max(3, mask.shape[0] // 500)

    return cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=reach)


def clean_plan(rgb: np.ndarray, scan: np.ndarray, blocks: list[dict[str, Any]], brush: Optional[np.ndarray]):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    filled = rgb.copy()
    inpaint = np.zeros(gray.shape, dtype=np.uint8)
    keep = np.zeros(gray.shape, dtype=bool) if brush is None else brush[..., 1] >= 127

    for block in blocks:
        text = block_mask(scan, gray, block)
        around = bubble_around(rgb, gray, block["box"]) if block.get("method") == "fill" else None

        if around is None:
            inpaint |= grown(text)
            continue

        bubble, colour = around
        paint = (cv2.dilate(text, np.ones((3, 3), np.uint8), iterations=2) > 0) & (bubble > 0) & ~keep
        filled[paint] = colour

    if brush is not None:
        inpaint[brush[..., 0] >= 127] = 255

    inpaint[keep] = 0

    return filled, inpaint


BUBBLE_INSET = (0.06, 0.05)


def text_area(rgb: np.ndarray, box: list[float]) -> Optional[list[int]]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    around = bubble_around(rgb, gray, box)

    if around is None:
        return None

    ys, xs = np.nonzero(around[0])
    x1, y1, x2, y2 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    dx, dy = round((x2 - x1) * BUBBLE_INSET[0]), round((y2 - y1) * BUBBLE_INSET[1])

    return [x1 + dx, y1 + dy, x2 - dx, y2 - dy]


PAPER_TOLERANCE = 60


def settle_paper(inpainted: np.ndarray, original: np.ndarray, blocks: list[dict[str, Any]], mask: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(original, cv2.COLOR_RGB2GRAY)
    settled = inpainted.copy()

    for block in blocks:
        around = bubble_around(original, gray, block["box"])

        if around is None:
            continue

        bubble, colour = around
        distance = np.abs(inpainted.astype(np.int32) - colour.astype(np.int32)).sum(axis=2)
        paper = (bubble > 0) & (mask > 0) & (distance <= PAPER_TOLERANCE)
        settled[paper] = colour

    return settled


PATCH_RING = 12

GRAIN_LIMIT = 10

PATCH_TONE = 14


def blend_patch(base: np.ndarray, inpainted: np.ndarray, mask: np.ndarray) -> np.ndarray:
    if not mask.any():
        return inpainted

    inside = mask > 0
    kernel = np.ones((3, 3), np.uint8)
    ring = (cv2.dilate(mask, kernel, iterations=PATCH_RING) > 0) & ~inside
    result = inpainted.astype(np.float32)
    source = base.astype(np.float32)

    if ring.any():
        shift = np.median(source[ring], axis=0) - np.median(result[inside], axis=0)
        result[inside] += np.clip(shift, -PATCH_TONE, PATCH_TONE)

    grain = source - cv2.GaussianBlur(source, (0, 0), 2)
    grain[np.abs(grain).max(axis=2) > GRAIN_LIMIT] = 0
    ys, xs = np.nonzero(inside)
    width = int(xs.max() - xs.min()) + 1 + PATCH_RING
    offset = width if int(xs.max()) + width < mask.shape[1] else -width
    beside = np.roll(grain, -offset, axis=1)
    result[inside] += beside[inside]

    return np.clip(result, 0, 255).astype(np.uint8)
