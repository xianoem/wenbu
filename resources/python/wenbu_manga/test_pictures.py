import numpy as np

from .pictures import alpha_needs_inpainting, line_colours, merged, picture_mask


def label_on_transparency():
    rgba = np.zeros((40, 120, 4), dtype=np.uint8)
    rgba[14:26, 20:100] = [20, 20, 20, 255]
    rgba[16:24, 22:98] = [250, 250, 250, 255]

    return rgba


def text_on_a_plate():
    rgba = np.zeros((40, 120, 4), dtype=np.uint8)
    rgba[:, :] = [90, 60, 30, 255]
    rgba[16:24, 22:98] = [240, 230, 200, 255]

    return rgba


def test_the_mask_covers_the_letters_inside_the_box_and_nothing_outside_it():
    mask = picture_mask(text_on_a_plate(), [[20, 14, 100, 26]])

    assert mask[20, 60] == 255
    assert mask[2, 2] == 0
    assert mask[20, 110] == 0


def test_the_mask_finds_light_and_dark_strokes_on_transparency():
    mask = picture_mask(label_on_transparency(), [[18, 12, 102, 28]])

    assert mask[20, 60] == 255
    assert mask[14, 40] == 255
    assert mask[2, 2] == 0


def test_transparency_is_inpainted_only_when_the_text_sits_on_it():
    assert alpha_needs_inpainting(label_on_transparency(), picture_mask(label_on_transparency(), [[18, 12, 102, 28]]))
    assert not alpha_needs_inpainting(text_on_a_plate(), picture_mask(text_on_a_plate(), [[20, 14, 100, 26]]))


def test_the_cleaned_picture_keeps_every_pixel_outside_the_mask():
    original = text_on_a_plate()
    mask = np.zeros(original.shape[:2], dtype=np.uint8)
    mask[16:24, 22:98] = 255
    rgb = np.full(original.shape[:2] + (3,), 7, dtype=np.uint8)
    alpha = np.full(original.shape[:2], 3, dtype=np.uint8)
    result = merged(original, mask, rgb, alpha)

    assert (result[2, 2] == original[2, 2]).all()
    assert (result[20, 60] == [7, 7, 7, 0]).all()


def test_the_fill_is_the_inner_colour_and_the_outline_the_edge_colour():
    colours = line_colours(label_on_transparency(), [18, 12, 102, 28])

    assert colours["fill"] == [250, 250, 250]
    assert colours["outline"] == [20, 20, 20]


def test_plain_text_has_no_outline():
    colours = line_colours(text_on_a_plate(), [20, 14, 100, 26])

    assert colours["fill"] == [240, 230, 200]
    assert colours["outline"] is None
