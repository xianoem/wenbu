import logging
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import skia
from PIL import Image

from .drawing_engine import (
    draw_layout,
    load_font_resources,
    pil_to_skia_surface,
    skia_surface_to_pil,
)
from .font_manager import (
    FontError,
    ImageProcessingError,
    RenderingError,
    find_font_variants,
    get_font_features,
    sanitize_text_for_font,
)
from .layout_engine import find_optimal_layout
from .safe_area import calculate_centroid_expansion_box
from .text_processing import parse_styled_segments

logger = logging.getLogger('skia_render')

GRAYSCALE_MIDPOINT = 128
FALLBACK_PADDING_RATIO = 0.08
DEFAULT_BORDER_WIDTH = 2.0


@dataclass
class SkiaRenderingConfig:
    font_dir: str = "./fonts"
    max_font_size: int = 40
    min_font_size: int = 8
    line_spacing_mult: float = 1.0
    use_subpixel_rendering: bool = False
    font_hinting: str = "none"
    use_ligatures: bool = False
    hyphenate_before_scaling: bool = True
    hyphen_penalty: float = 1000.0
    hyphenation_min_word_length: int = 8
    badness_exponent: float = 3.0
    padding_pixels: float = 5.0
    outline_width: float = 0.0
    border_enabled: bool = True
    border_color_rgb: Tuple[int, int, int] = (255, 255, 255)
    supersampling_factor: int = 4
    detach_trailing_ellipsis: bool = True
    force_fit: bool = True
    padding_ratio: float = FALLBACK_PADDING_RATIO


def render_text_skia(
    pil_image: Image.Image,
    text: str,
    bbox: Tuple[int, int, int, int],
    font_dir: str,
    cleaned_mask: Optional[np.ndarray] = None,
    bubble_color_bgr: Optional[Tuple[int, int, int]] = (255, 255, 255),
    config: Optional[SkiaRenderingConfig] = None,
    raise_on_safe_error: bool = False,
    verbose: bool = False,
    bubble_id: Optional[str] = None,
    rotation_deg: float = 0.0,
    vertical_stack: bool = False,
    text_color_rgb: Optional[Tuple[int, int, int]] = None,
    text_background_color: Optional[Tuple[int, int, int]] = None,
    layout_only: bool = False,
) -> Image.Image:
    x1, y1, x2, y2 = bbox
    bubble_width = x2 - x1
    bubble_height = y2 - y1

    if bubble_width <= 0 or bubble_height <= 0:
        raise RenderingError(f"Invalid bounding box dimensions: {bbox}")

    normalized_text = text.replace("\u2014", "-")
    clean_text = "\n".join(" ".join(line.split()) for line in normalized_text.splitlines() if line.strip())
    if not clean_text:
        return pil_image

    if vertical_stack:
        import unicodedata

        def _is_separator_or_space(ch: str) -> bool:
            try:
                cat = unicodedata.category(ch)
            except Exception:
                return ch.isspace()
            return ch.isspace() or (len(cat) > 0 and cat[0] == "Z")

        stacked_chars = [ch for ch in clean_text if not _is_separator_or_space(ch)]
        layout_text = "\n".join(stacked_chars)
    else:
        layout_text = clean_text

    if config is None:
        config = SkiaRenderingConfig()

    border_width = (
        config.outline_width if config.outline_width > 0 else DEFAULT_BORDER_WIDTH
    ) if config.border_enabled else 0.0
    border_color = skia.Color(
        config.border_color_rgb[0],
        config.border_color_rgb[1],
        config.border_color_rgb[2],
    )

    layout_box_top_left = None
    safe_area_result = None
    safe_area_fallback_logged = False
    if cleaned_mask is not None:
        try:
            safe_area_result = calculate_centroid_expansion_box(
                cleaned_mask, padding_pixels=config.padding_pixels, verbose=verbose
            )
        except ImageProcessingError:
            safe_area_result = None
            if raise_on_safe_error:
                raise
            safe_area_fallback_logged = True

    if safe_area_result is not None:
        guaranteed_box, _ = safe_area_result
        box_x, box_y, box_w, box_h = guaranteed_box
        layout_box_top_left = (box_x, box_y)
        max_render_width = float(box_w)
        max_render_height = float(box_h)
        target_center_x = x1 + box_x + box_w / 2.0
        target_center_y = y1 + box_y + box_h / 2.0
    else:
        max_render_width = bubble_width * (1 - 2 * config.padding_ratio)
        max_render_height = bubble_height * (1 - 2 * config.padding_ratio)

        if max_render_width <= 0 or max_render_height <= 0:
            max_render_width = max(1.0, float(bubble_width))
            max_render_height = max(1.0, float(bubble_height))

        target_center_x = x1 + bubble_width / 2.0
        target_center_y = y1 + bubble_height / 2.0

    try:
        font_variants = find_font_variants(font_dir, verbose=verbose)
        regular_font_path = font_variants.get("regular")
    except FontError as e:
        raise RenderingError(f"Font loading failed: {e}") from e

    layout_text = sanitize_text_for_font(
        layout_text, str(regular_font_path), verbose=verbose
    )
    if not layout_text.strip():
        return pil_image

    try:
        _, regular_typeface, regular_hb_face = load_font_resources(
            str(regular_font_path)
        )
    except FontError as e:
        raise RenderingError(f"Font resource loading failed: {e}") from e

    available_features = get_font_features(str(regular_font_path))
    features_to_enable = {
        "kern": "kern" in available_features["GPOS"],
        "liga": config.use_ligatures and "liga" in available_features["GSUB"],
        "calt": "calt" in available_features["GSUB"],
    }

    preload_hb_faces = {"regular": regular_hb_face}
    for style_key in ["italic", "bold", "bold_italic"]:
        style_path = font_variants.get(style_key)
        if style_path:
            _, _typeface, _hb_face = load_font_resources(str(style_path))
            if _hb_face:
                preload_hb_faces[style_key] = _hb_face

    try:
        layout_data = find_optimal_layout(
            layout_text,
            max_render_width,
            max_render_height,
            regular_hb_face,
            regular_typeface,
            preload_hb_faces,
            features_to_enable,
            config.min_font_size,
            config.max_font_size,
            config.line_spacing_mult,
            False if vertical_stack else config.hyphenate_before_scaling,
            config.hyphen_penalty,
            config.hyphenation_min_word_length,
            config.badness_exponent,
            verbose,
            bubble_id,
            cleaned_mask,
            layout_box_top_left,
            config.detach_trailing_ellipsis,
            config.force_fit,
        )
    except RenderingError as e:
        raise RenderingError(f"Layout optimization failed: {e}") from e

    if layout_only:
        result = Image.new("RGBA", (1, 1))
        result.info["font_size"] = layout_data["font_size"]
        result.info["lines"] = [line["text_with_markers"] for line in layout_data["lines"]]
        return result

    required_styles = {"regular"} | {
        style for _, style in parse_styled_segments(clean_text)
    }

    loaded_typefaces = {"regular": regular_typeface}
    loaded_hb_faces = {"regular": regular_hb_face}

    for style in ["italic", "bold", "bold_italic"]:
        if style in required_styles:
            font_path = font_variants.get(style)
            if font_path:
                _, typeface, hb_face = load_font_resources(str(font_path))
                if typeface and hb_face:
                    loaded_typefaces[style] = typeface
                    loaded_hb_faces[style] = hb_face

    text_color = skia.ColorBLACK
    if text_color_rgb is not None:
        text_color = skia.Color(text_color_rgb[0], text_color_rgb[1], text_color_rgb[2])
    elif bubble_color_bgr is not None:
        try:
            bg_brightness = (
                bubble_color_bgr[0] + bubble_color_bgr[1] + bubble_color_bgr[2]
            ) / 3.0
            text_color = (
                skia.ColorWHITE
                if bg_brightness < GRAYSCALE_MIDPOINT
                else skia.ColorBLACK
            )
        except Exception:
            text_color = skia.ColorBLACK

    skia_bg_color = None
    if text_background_color is not None:
        skia_bg_color = skia.Color(
            text_background_color[0],
            text_background_color[1],
            text_background_color[2],
        )

    has_rotation = rotation_deg and abs(rotation_deg) > 0.01

    img_width, img_height = pil_image.size
    crop_x1 = max(0, x1)
    crop_y1 = max(0, y1)
    crop_x2 = min(img_width, x2)
    crop_y2 = min(img_height, y2)

    cropped_region = pil_image.crop((crop_x1, crop_y1, crop_x2, crop_y2))
    crop_width = crop_x2 - crop_x1
    crop_height = crop_y2 - crop_y1

    factor = max(1, config.supersampling_factor)
    scaled_width = int(crop_width * factor)
    scaled_height = int(crop_height * factor)
    upscaled_region = (
        cropped_region
        if factor == 1
        else cropped_region.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)
    )

    scaled_target_center_x = (target_center_x - crop_x1) * factor
    scaled_target_center_y = (target_center_y - crop_y1) * factor

    scaled_layout_data = layout_data.copy()
    scaled_layout_data["font_size"] = layout_data["font_size"] * factor
    scaled_layout_data["line_height"] = layout_data["line_height"] * factor
    scaled_layout_data["max_line_width"] = layout_data["max_line_width"] * factor

    for line_data in scaled_layout_data["lines"]:
        line_data["width"] = line_data["width"] * factor

    original_metrics = layout_data["metrics"]

    class _ScaledMetrics:
        def __init__(self, original, scale_factor):
            self.fAscent = original.fAscent * scale_factor
            self.fDescent = original.fDescent * scale_factor
            if hasattr(original, "fLeading"):
                self.fLeading = original.fLeading * scale_factor

    scaled_layout_data["metrics"] = _ScaledMetrics(original_metrics, factor)

    try:
        scaled_surface, scaled_pixels = pil_to_skia_surface(upscaled_region)
    except RenderingError as e:
        raise RenderingError(f"Scaled surface preparation failed: {e}") from e

    success = draw_layout(
        scaled_surface,
        scaled_layout_data,
        0.0 if has_rotation else scaled_target_center_x,
        0.0 if has_rotation else scaled_target_center_y,
        loaded_typefaces,
        loaded_hb_faces,
        regular_typeface,
        regular_hb_face,
        features_to_enable,
        text_color,
        config.use_subpixel_rendering,
        config.font_hinting,
        border_width * factor,
        verbose,
        pre_translate_x=float(scaled_target_center_x) if has_rotation else 0.0,
        pre_translate_y=float(scaled_target_center_y) if has_rotation else 0.0,
        pre_rotate_deg=float(rotation_deg) if has_rotation else 0.0,
        text_background_color=skia_bg_color,
        outline_color=border_color,
    )

    if not success:
        raise RenderingError("Text drawing failed")

    try:
        scaled_pil_result = skia_surface_to_pil(scaled_pixels)
    except RenderingError as e:
        raise RenderingError(f"Scaled conversion failed: {e}") from e

    downscaled_result = (
        scaled_pil_result
        if factor == 1
        else scaled_pil_result.resize((crop_width, crop_height), Image.Resampling.LANCZOS)
    )

    pil_image.paste(downscaled_result, (crop_x1, crop_y1))
    pil_image.info["font_size"] = layout_data["font_size"]
    return pil_image
