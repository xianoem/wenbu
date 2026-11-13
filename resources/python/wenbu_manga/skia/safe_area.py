import logging
from typing import Tuple

import cv2
import numpy as np

from .font_manager import ImageProcessingError

logger = logging.getLogger('skia_render')


def calculate_centroid_expansion_box(
    cleaned_mask: np.ndarray, padding_pixels: float = 5.0, verbose: bool = False
) -> Tuple[Tuple[int, int, int, int], Tuple[float, float]]:
    if cleaned_mask is None or not np.any(cleaned_mask):
        raise ImageProcessingError("Invalid or empty mask provided")

    try:
        padded_mask = np.zeros(
            (cleaned_mask.shape[0] + 2, cleaned_mask.shape[1] + 2), dtype=np.uint8
        )
        padded_mask[1:-1, 1:-1] = cleaned_mask
        distance_map_padded = cv2.distanceTransform(
            padded_mask, cv2.DIST_L2, cv2.DIST_MASK_PRECISE
        )
        distance_map = distance_map_padded[1:-1, 1:-1]
        safe_area_mask = (distance_map >= padding_pixels).astype(np.uint8) * 255

        if not np.any(safe_area_mask):
            raise ImageProcessingError("Failed to create safe area mask")

        moments = cv2.moments(safe_area_mask)

        if moments["m00"] == 0:
            raise ImageProcessingError("Safe area mask has no area")

        centroid_x = moments["m10"] / moments["m00"]
        centroid_y = moments["m01"] / moments["m00"]

        _, max_val, _, max_loc = cv2.minMaxLoc(distance_map)

        cx_int, cy_int = int(round(centroid_x)), int(round(centroid_y))
        mask_h, mask_w = safe_area_mask.shape

        cx_int = max(0, min(cx_int, mask_w - 1))
        cy_int = max(0, min(cy_int, mask_h - 1))

        dist_at_centroid = distance_map[cy_int, cx_int]

        if dist_at_centroid < max_val * 0.70:
            centroid_x, centroid_y = float(max_loc[0]), float(max_loc[1])

        centroid = (centroid_x, centroid_y)

        cx, cy = int(round(centroid_x)), int(round(centroid_y))
        mask_h, mask_w = safe_area_mask.shape

        if (
            cy < 0
            or cy >= mask_h
            or cx < 0
            or cx >= mask_w
            or safe_area_mask[cy, cx] != 255
        ):
            safe_pixels = np.argwhere(safe_area_mask == 255)
            if safe_pixels.size == 0:
                raise ImageProcessingError("No safe pixels found in safe_area_mask")
            distances = np.sqrt(
                (safe_pixels[:, 0] - centroid_y) ** 2
                + (safe_pixels[:, 1] - centroid_x) ** 2
            )
            nearest_idx = np.argmin(distances)
            cy, cx = safe_pixels[nearest_idx]
            centroid_x, centroid_y = float(cx), float(cy)
            centroid = (centroid_x, centroid_y)

        left_zeros = np.where(safe_area_mask[cy, 0:cx] == 0)[0]
        dist_to_left_edge = cx - (left_zeros.max() if left_zeros.size > 0 else 0)

        right_zeros = np.where(safe_area_mask[cy, cx:] == 0)[0]
        dist_to_right_edge = right_zeros.min() if right_zeros.size > 0 else mask_w - cx

        up_zeros = np.where(safe_area_mask[0:cy, cx] == 0)[0]
        dist_to_top_edge = cy - (up_zeros.max() if up_zeros.size > 0 else 0)

        down_zeros = np.where(safe_area_mask[cy:, cx] == 0)[0]
        dist_to_bottom_edge = down_zeros.min() if down_zeros.size > 0 else mask_h - cy

        min_width_dist = min(dist_to_left_edge, dist_to_right_edge)
        min_height_dist = min(dist_to_top_edge, dist_to_bottom_edge)
        safe_width_base = min_width_dist - 1 if min_width_dist > 1 else min_width_dist
        safe_height_base = (
            min_height_dist - 1 if min_height_dist > 1 else min_height_dist
        )
        max_safe_width = 2 * max(0, safe_width_base)
        max_safe_height = 2 * max(0, safe_height_base)

        if max_safe_width <= 0 or max_safe_height <= 0:
            raise ImageProcessingError("Failed to create safe area mask")

        box_x_float = centroid_x - max_safe_width / 2.0
        box_y_float = centroid_y - max_safe_height / 2.0

        box_x = int(round(box_x_float))
        box_y = int(round(box_y_float))

        guaranteed_box = (box_x, box_y, max_safe_width, max_safe_height)

        if (
            box_x >= 0
            and box_y >= 0
            and box_x + max_safe_width <= mask_w
            and box_y + max_safe_height <= mask_h
        ):
            return guaranteed_box, centroid
        else:
            raise ImageProcessingError("Failed to create safe area mask")

    except ImageProcessingError:
        raise
    except (cv2.error, ValueError, IndexError, ZeroDivisionError, OverflowError) as e:
        logger.warning(f"Safe area calculation error: {e}")
    except Exception as e:
        logger.warning(f"Safe area calculation failed: {e}")

    raise ImageProcessingError("Safe area calculation failed")
