import asyncio

import numpy as np

from .inpainting import ALIGN, crops, inpaint_regions


def mask_with(*boxes, size=(1000, 800)):
    mask = np.zeros(size, dtype=np.uint8)

    for x1, y1, x2, y2 in boxes:
        mask[y1:y2, x1:x2] = 255

    return mask


def test_each_text_area_gets_a_crop_with_context_sized_in_multiples_of_eight():
    [(x1, y1, x2, y2)] = crops(mask_with((300, 400, 340, 500)))

    assert x1 < 300 and y1 < 400 and x2 > 340 and y2 > 500
    assert (x2 - x1) % ALIGN == 0 and (y2 - y1) % ALIGN == 0


def test_crops_that_would_overlap_are_merged():
    boxes = crops(mask_with((100, 100, 140, 140), (170, 100, 210, 140)))

    assert len(boxes) == 1


def test_crops_stay_inside_the_page():
    for x1, y1, x2, y2 in crops(mask_with((0, 0, 30, 30), (770, 970, 800, 1000))):
        assert 0 <= x1 < x2 <= 800 and 0 <= y1 < y2 <= 1000


def test_only_crops_are_handed_to_the_inpainter():
    image = np.full((1000, 800, 3), 50, dtype=np.uint8)
    mask = mask_with((300, 400, 340, 500))
    shapes = []

    async def inpaint(crop, crop_mask):
        shapes.append(crop.shape[:2])

        return np.full_like(crop, 200)

    result = asyncio.run(inpaint_regions(image, mask, inpaint))
    [(x1, y1, x2, y2)] = crops(mask)

    assert shapes == [(y2 - y1, x2 - x1)]
    assert (result[y1:y2, x1:x2] == 200).all()
    assert (result[:y1] == 50).all()


def test_a_page_without_text_is_left_alone():
    image = np.zeros((100, 100, 3), dtype=np.uint8)

    async def inpaint(crop, crop_mask):
        raise AssertionError("nothing to inpaint")

    assert (asyncio.run(inpaint_regions(image, np.zeros((100, 100), dtype=np.uint8), inpaint)) == image).all()
