import cv2
import numpy as np
import pytest

from .editor import blend_patch, clean_plan, cleaning_mask, parse_blocks, settle_paper, stroke_mask, text_area


def page_with_text(size=(400, 300)):
    gray = np.full(size, 255, dtype=np.uint8)
    gray[100:110, 50:90] = 0
    gray[200:210, 150:190] = 0

    return gray


def test_dark_strokes_on_a_light_bubble_become_the_mask():
    crop = np.full((40, 40), 250, dtype=np.uint8)
    crop[15:20, 10:30] = 10
    mask = stroke_mask(crop)

    assert mask[17, 20] == 255
    assert mask[2, 2] == 0


def test_light_strokes_on_a_dark_background_become_the_mask():
    crop = np.full((40, 40), 10, dtype=np.uint8)
    crop[15:20, 10:30] = 250
    mask = stroke_mask(crop)

    assert mask[17, 20] == 255
    assert mask[2, 2] == 0


def test_a_flat_box_is_cleaned_whole():
    assert stroke_mask(np.full((20, 20), 128, dtype=np.uint8)).min() == 255


def test_only_the_scan_mask_inside_kept_boxes_is_cleaned():
    gray = page_with_text()
    scan = np.where(gray < 128, 255, 0).astype(np.uint8)
    mask = cleaning_mask(scan, gray, [{"box": [40, 90, 100, 120], "drawn": False}])

    assert mask[105, 70] == 255
    assert mask[205, 170] == 0


def test_a_drawn_box_adds_its_own_strokes():
    gray = page_with_text()
    scan = np.zeros_like(gray)
    mask = cleaning_mask(scan, gray, [{"box": [140, 190, 200, 220], "drawn": True}])

    assert mask[205, 170] == 255
    assert mask[105, 70] == 0


def test_a_scanned_box_without_a_scan_mask_finds_its_own_strokes():
    gray = page_with_text()
    mask = cleaning_mask(np.zeros_like(gray), gray, [{"box": [40, 90, 100, 120], "drawn": False}])

    assert mask[105, 70] == 255
    assert mask[205, 170] == 0


def test_dense_text_is_found_by_the_scanned_colours():
    gray = np.full((60, 60), 255, dtype=np.uint8)
    gray[10:50, 10:50] = 40
    block = {"box": [5, 5, 55, 55], "drawn": False, "fg": [40, 40, 40], "bg": [255, 255, 255]}
    mask = cleaning_mask(np.zeros_like(gray), gray, [block])

    assert mask[30, 30] == 255
    assert mask[6, 6] == 0


def test_boxes_are_clipped_to_the_page():
    gray = page_with_text()
    mask = cleaning_mask(np.zeros_like(gray), gray, [{"box": [-20, -20, 5000, 5000], "drawn": True}])

    assert mask.shape == gray.shape


def test_blocks_must_have_four_number_boxes():
    with pytest.raises(ValueError):
        parse_blocks([{"box": [1, 2, 3]}])


def bubble_page():
    rgb = np.full((300, 300, 3), 120, dtype=np.uint8)
    cv2.ellipse(rgb, (150, 150), (90, 120), 0, 0, 360, (255, 255, 255), -1)
    cv2.ellipse(rgb, (150, 150), (90, 120), 0, 0, 360, (0, 0, 0), 3)
    rgb[130:140, 120:180] = 0
    rgb[160:170, 125:175] = 0
    scan = np.zeros((300, 300), dtype=np.uint8)
    scan[128:142, 118:182] = 255
    scan[158:172, 123:177] = 255

    return rgb, scan


def test_filling_a_bubble_paints_its_text_with_the_bubble_colour_and_keeps_the_outline():
    rgb, scan = bubble_page()
    filled, mask = clean_plan(rgb, scan, [{"box": [115, 125, 185, 175], "method": "fill"}], None)

    assert (filled[135, 150] == 255).all()
    assert (filled[150, 61] == 0).all()
    assert not mask.any()


def test_a_letter_with_a_hole_at_the_centre_still_fills_the_whole_bubble():
    rgb, scan = bubble_page()
    rgb[140:160, 140:160] = 0
    rgb[147:153, 147:153] = 255
    scan[138:162, 138:162] = 255
    filled, mask = clean_plan(rgb, scan, [{"box": [115, 125, 185, 175], "method": "fill"}], None)

    assert (filled[135, 150] == 255).all()
    assert (filled[145, 145] == 255).all()
    assert not mask.any()


def test_text_outside_any_bubble_falls_back_to_inpainting():
    rgb = np.full((200, 200, 3), 120, dtype=np.uint8)
    rgb[90:100, 60:140] = 0
    scan = np.zeros((200, 200), dtype=np.uint8)
    scan[88:102, 58:142] = 255
    filled, mask = clean_plan(rgb, scan, [{"box": [55, 85, 145, 105], "method": "fill"}], None)

    assert mask[95, 100] == 255
    assert (filled == rgb).all()


def test_brush_adds_to_inpainting_and_the_eraser_takes_back():
    rgb, scan = bubble_page()
    brush = np.zeros((300, 300, 3), dtype=np.uint8)
    brush[20:40, 20:40, 0] = 255
    brush[128:142, 118:150, 1] = 255
    filled, mask = clean_plan(rgb, scan, [{"box": [115, 125, 185, 175], "method": "inpaint"}], brush)

    assert mask[30, 30] == 255
    assert mask[135, 130] == 0
    assert mask[135, 170] == 255


def test_the_text_area_is_the_bubble_inset_from_its_outline():
    rgb, _ = bubble_page()
    area = text_area(rgb, [115, 125, 185, 175])

    assert area is not None
    x1, y1, x2, y2 = area
    assert x1 < 115 and x2 > 185 and y1 < 125 and y2 > 175
    assert x1 > 60 and x2 < 240 and y1 > 30 and y2 < 270


def test_text_outside_any_bubble_keeps_its_own_box():
    rgb = np.full((200, 200, 3), 120, dtype=np.uint8)

    assert text_area(rgb, [55, 85, 145, 105]) is None


def test_inpainting_covers_the_soft_edges_around_the_letters():
    rgb, scan = bubble_page()
    _, mask = clean_plan(rgb, scan, [{"box": [115, 125, 185, 175], "method": "inpaint"}], None)

    assert mask[126, 150] == 255
    assert mask[110, 150] == 0


def test_paper_inpainted_slightly_grey_inside_a_bubble_is_set_back_to_the_paper():
    rgb, scan = bubble_page()
    inpainted = rgb.copy()
    inpainted[128:142, 118:182] = 236
    inpainted[160:170, 125:175] = 40
    mask = np.zeros((300, 300), dtype=np.uint8)
    mask[128:142, 118:182] = 255
    mask[160:170, 125:175] = 255

    settled = settle_paper(inpainted, rgb, [{"box": [115, 125, 185, 175]}], mask)

    assert (settled[135, 150] == 255).all()
    assert (settled[165, 150] == 40).all()
    assert (settled[20, 20] == inpainted[20, 20]).all()


def test_a_brushed_patch_takes_the_tone_and_grain_of_the_paper_around_it():
    noise = np.random.default_rng(1).normal(0, 4, (200, 200, 3))
    base = np.clip(240 + noise, 0, 255).astype(np.uint8)
    inpainted = base.copy()
    inpainted[80:120, 90:110] = 252
    mask = np.zeros((200, 200), dtype=np.uint8)
    mask[80:120, 90:110] = 255

    blended = blend_patch(base, inpainted, mask).astype(float)
    patch = blended[85:115, 93:107]

    assert abs(patch.mean() - 240) < 2
    assert patch.std() > 2


def test_ink_beside_a_brushed_patch_is_not_copied_into_it_as_grain():
    noise = np.random.default_rng(2).normal(0, 3, (200, 200, 3))
    base = np.clip(240 + noise, 0, 255).astype(np.uint8)
    base[95:105, 135:145] = 30
    inpainted = base.copy()
    inpainted[80:120, 90:110] = 240
    mask = np.zeros((200, 200), dtype=np.uint8)
    mask[80:120, 90:110] = 255

    blended = blend_patch(base, inpainted, mask).astype(float)

    assert blended[90:110, 90:110].min() > 220
