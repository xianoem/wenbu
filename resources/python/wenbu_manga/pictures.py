from typing import Any

import cv2
import numpy as np

PAD = 3
MIN_CONTRAST = 40
SAME_COLOUR = 60


def clipped(box: list[float], width: int, height: int, pad: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (int(round(edge)) for edge in box)

    return max(0, x1 - pad), max(0, y1 - pad), min(width, x2 + pad), min(height, y2 + pad)


def on_gray(rgba: np.ndarray) -> np.ndarray:
    """Composites onto mid gray so that both light and dark strokes on transparency stand out."""

    alpha = rgba[..., 3:4].astype(np.float32) / 255

    return rgba[..., :3].astype(np.float32) * alpha + 128 * (1 - alpha)


def ring(region: np.ndarray) -> np.ndarray:
    return np.concatenate([region[0], region[-1], region[1:-1, 0], region[1:-1, -1]])


def strokes(rgba: np.ndarray, area: tuple[int, int, int, int]) -> np.ndarray:
    x1, y1, x2, y2 = area
    region = on_gray(rgba[y1:y2, x1:x2])

    if region.shape[0] < 3 or region.shape[1] < 3:
        return np.zeros(region.shape[:2], dtype=bool)

    background = np.median(ring(region), axis=0)
    distance = np.clip(np.linalg.norm(region - background, axis=2), 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(distance, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return distance > max(MIN_CONTRAST, otsu)


def picture_mask(rgba: np.ndarray, boxes: list[list[float]]) -> np.ndarray:
    height, width = rgba.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))

    for box in boxes:
        x1, y1, x2, y2 = clipped(box, width, height, PAD)

        if x2 <= x1 or y2 <= y1:
            continue

        found = strokes(rgba, (x1, y1, x2, y2))

        if found.mean() < 0.01:
            mask[y1:y2, x1:x2] = 255
            continue

        grown = cv2.dilate(found.astype(np.uint8) * 255, kernel)
        mask[y1:y2, x1:x2] = np.maximum(mask[y1:y2, x1:x2], grown)

    return mask


def alpha_needs_inpainting(rgba: np.ndarray, mask: np.ndarray) -> bool:
    around = cv2.dilate(mask, np.ones((13, 13), dtype=np.uint8)) > 0

    return bool((rgba[..., 3][around] < 250).any())


def merged(original: np.ndarray, mask: np.ndarray, rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    result = original.copy()
    inside = mask > 0
    snapped = np.where(alpha < 10, 0, np.where(alpha > 245, 255, alpha)).astype(np.uint8)
    result[..., :3][inside] = rgb[inside]
    result[..., 3][inside] = snapped[inside]

    return result


def colour(value: np.ndarray) -> list[int]:
    return [int(round(channel)) for channel in value]


def contrasting(background: np.ndarray) -> list[int]:
    light = 0.299 * background[0] + 0.587 * background[1] + 0.114 * background[2] > 140

    return [0, 0, 0] if light else [255, 255, 255]


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def extreme(pixels: np.ndarray, bright: bool) -> np.ndarray:
    """The half of the pixels furthest toward bright or dark, so anti-aliasing doesn't pull a thin stroke toward the background."""

    levels = luminance(pixels)
    middle = np.median(levels)

    return pixels[levels >= middle] if bright else pixels[levels <= middle]


def line_colours(rgba: np.ndarray, box: list[float]) -> dict[str, Any]:
    """The fill is the colour at the middle of the strokes; an outline, when there is one, is the colour at their edges."""

    height, width = rgba.shape[:2]
    x1, y1, x2, y2 = clipped(box, width, height, PAD)

    if x2 - x1 < 3 or y2 - y1 < 3:
        return {"fill": [255, 255, 255], "outline": None}

    found = strokes(rgba, (x1, y1, x2, y2)) & (rgba[y1:y2, x1:x2, 3] >= 128)
    rgb = rgba[y1:y2, x1:x2, :3].astype(np.float32)
    background = np.median(ring(on_gray(rgba[y1:y2, x1:x2])), axis=0)

    if found.sum() < 4:
        return {"fill": contrasting(background), "outline": None}

    depth = cv2.distanceTransform(np.pad(found.astype(np.uint8), 1), cv2.DIST_L2, 3)[1:-1, 1:-1]
    deepest = rgb[found & (depth >= max(1.0, np.percentile(depth[found], 75)))]
    bright = luminance(np.median(deepest, axis=0)) >= luminance(background)
    fill = np.median(extreme(deepest, bright), axis=0)
    edge = rgb[found & (depth <= 1.0)]
    outline = np.median(extreme(edge, not bright), axis=0) if len(edge) > 0 else fill

    if np.linalg.norm(outline - fill) < SAME_COLOUR:
        return {"fill": colour(fill), "outline": None}

    return {"fill": colour(fill), "outline": colour(outline)}
