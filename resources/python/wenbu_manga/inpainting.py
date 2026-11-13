from typing import Awaitable, Callable

import cv2
import numpy as np

Box = tuple[int, int, int, int]
Inpaint = Callable[[np.ndarray, np.ndarray], Awaitable[np.ndarray]]

MIN_CONTEXT = 48
ALIGN = 8


def text_boxes(mask: np.ndarray) -> list[Box]:
    count, _, stats, _ = cv2.connectedComponentsWithStats((mask >= 127).astype(np.uint8), connectivity=8)

    return [(int(x), int(y), int(x + w), int(y + h)) for x, y, w, h, _ in stats[1:count]]


def with_context(box: Box, width: int, height: int) -> Box:
    x1, y1, x2, y2 = box
    margin = max(MIN_CONTEXT, max(x2 - x1, y2 - y1) // 2)

    return aligned((max(0, x1 - margin), max(0, y1 - margin), min(width, x2 + margin), min(height, y2 + margin)), width, height)


def aligned(box: Box, width: int, height: int) -> Box:
    """Grows a box to multiples of 8 so LaMa doesn't resample the crop."""

    x1, y1, x2, y2 = box
    left, right = grow(x1, x2, width)
    top, bottom = grow(y1, y2, height)

    return left, top, right, bottom


def grow(start: int, end: int, limit: int) -> tuple[int, int]:
    target = -(-(end - start) // ALIGN) * ALIGN

    if target > limit:
        return start, end

    end = min(limit, start + target)

    return end - target, end


def overlaps(a: Box, b: Box) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def merged(boxes: list[Box], width: int, height: int) -> list[Box]:
    pending = list(boxes)
    done: list[Box] = []

    while pending:
        box = pending.pop()
        absorbed = True

        while absorbed:
            absorbed = False

            for other in done + pending:
                if overlaps(box, other):
                    box = aligned((min(box[0], other[0]), min(box[1], other[1]), max(box[2], other[2]), max(box[3], other[3])), width, height)
                    (done if other in done else pending).remove(other)
                    absorbed = True
                    break

        done.append(box)

    return sorted(done, key=lambda box: (box[1], box[0]))


def crops(mask: np.ndarray) -> list[Box]:
    height, width = mask.shape[:2]

    return merged([with_context(box, width, height) for box in text_boxes(mask)], width, height)


async def inpaint_regions(image: np.ndarray, mask: np.ndarray, inpaint: Inpaint) -> np.ndarray:
    result = image.copy()

    for x1, y1, x2, y2 in crops(mask):
        result[y1:y2, x1:x2] = await inpaint(image[y1:y2, x1:x2], mask[y1:y2, x1:x2])

    return result
