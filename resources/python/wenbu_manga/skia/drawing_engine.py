import logging
import os
import threading
from typing import Dict, Optional, Tuple

import cv2
import numpy as np
import skia
import uharfbuzz as hb
from PIL import Image

from .font_manager import LRUCache, FontError, RenderingError, load_font_data
from .layout_engine import shape_line
from .text_processing import is_rtl_script, parse_styled_segments

logger = logging.getLogger('skia_render')

_typeface_cache = LRUCache(max_size=50)
_hb_face_cache = LRUCache(max_size=50)
_font_cache_lock = threading.RLock()


def load_font_resources(
    font_path: str,
) -> Tuple[bytes, skia.Typeface, hb.Face]:
    try:
        font_data = load_font_data(font_path)
    except FontError:
        raise

    with _font_cache_lock:
        typeface = _typeface_cache.get(font_path)
        if typeface is None:
            skia_data = skia.Data.MakeWithoutCopy(font_data)
            typeface = skia.Typeface.MakeFromData(skia_data)
            if typeface is None:
                logger.error(
                    f"Skia typeface load failed: {os.path.basename(font_path)}"
                )
                raise FontError(
                    f"Failed to create Skia typeface from font: {font_path}"
                )
            _typeface_cache.put(font_path, typeface)

        hb_face = _hb_face_cache.get(font_path)
        if hb_face is None:
            try:
                hb_face = hb.Face(font_data)
                _hb_face_cache.put(font_path, hb_face)
            except Exception as e:
                logger.error(
                    f"HarfBuzz face load failed: {os.path.basename(font_path)}: {e}"
                )
                if font_path in _typeface_cache:
                    del _typeface_cache[font_path]
                raise FontError(
                    f"Failed to create HarfBuzz face from font: {font_path}"
                ) from e

    return font_data, typeface, hb_face


def pil_to_skia_surface(pil_image: Image.Image) -> Tuple[skia.Surface, np.ndarray]:
    try:
        rgba = np.asarray(pil_image if pil_image.mode == "RGBA" else pil_image.convert("RGBA"))
        # Skia's native order on this platform; RGBA blends text edges slightly differently.
        pixels = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
        surface = skia.Surface(pixels, skia.kBGRA_8888_ColorType, skia.kPremul_AlphaType)
        return surface, pixels
    except Exception as e:
        raise RenderingError("PIL to Skia conversion failed") from e


def skia_surface_to_pil(pixels: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(pixels, cv2.COLOR_BGRA2RGBA), "RGBA")


def draw_layout(
    surface: skia.Surface,
    layout_data: Dict,
    target_center_x: float,
    target_center_y: float,
    loaded_typefaces: Dict[str, Optional[skia.Typeface]],
    loaded_hb_faces: Dict[str, Optional[hb.Face]],
    regular_typeface: skia.Typeface,
    regular_hb_face: hb.Face,
    features_to_enable: Dict[str, bool],
    text_color: int,
    use_subpixel_rendering: bool,
    font_hinting: str,
    outline_width: float = 0.0,
    verbose: bool = False,
    pre_translate_x: float = 0.0,
    pre_translate_y: float = 0.0,
    pre_rotate_deg: float = 0.0,
    text_background_color: Optional[int] = None,
    outline_color: Optional[int] = None,
) -> bool:
    try:
        final_font_size = layout_data["font_size"]
        final_lines_data = layout_data["lines"]
        final_metrics = layout_data["metrics"]
        final_max_line_width = layout_data["max_line_width"]
        final_line_height = layout_data["line_height"]

        for line_data in final_lines_data:
            line_data["segments"] = parse_styled_segments(
                line_data["text_with_markers"]
            )

        hinting_map = {
            "none": skia.FontHinting.kNone,
            "slight": skia.FontHinting.kSlight,
            "normal": skia.FontHinting.kNormal,
            "full": skia.FontHinting.kFull,
        }
        skia_hinting = hinting_map.get(font_hinting.lower(), skia.FontHinting.kNone)

        paint = skia.Paint(AntiAlias=True, Color=text_color)

        outline_paint = None
        if outline_width > 0:
            if outline_color is None:
                r = skia.ColorGetR(text_color)
                g = skia.ColorGetG(text_color)
                b = skia.ColorGetB(text_color)
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                outline_color = skia.ColorBLACK if lum >= 80 else skia.ColorWHITE

            outline_paint = skia.Paint(
                AntiAlias=True,
                Color=outline_color,
                Style=skia.Paint.kStroke_Style,
                StrokeWidth=outline_width,
                StrokeJoin=skia.Paint.kRound_Join,
            )

        block_start_x = target_center_x - final_max_line_width / 2.0

        num_lines = len(final_lines_data)
        if num_lines > 0:
            total_visual_height = (
                (num_lines - 1) * final_line_height
                - final_metrics.fAscent
                + final_metrics.fDescent
            )
            block_top_y = target_center_y - (total_visual_height / 2.0)
            first_baseline_y = block_top_y - final_metrics.fAscent
        else:
            first_baseline_y = (
                target_center_y - (final_metrics.fAscent + final_metrics.fDescent) / 2.0
            )

        with surface as canvas:
            need_transform = (
                abs(pre_translate_x) > 1e-3
                or abs(pre_translate_y) > 1e-3
                or abs(pre_rotate_deg) > 1e-3
            )
            if need_transform:
                canvas.save()
                if abs(pre_translate_x) > 1e-3 or abs(pre_translate_y) > 1e-3:
                    canvas.translate(float(pre_translate_x), float(pre_translate_y))
                if abs(pre_rotate_deg) > 1e-3:
                    canvas.rotate(float(pre_rotate_deg))

            bg_paint = None
            if text_background_color is not None:
                bg_paint = skia.Paint(AntiAlias=False, Color=text_background_color)

            current_baseline_y = first_baseline_y
            for i, line_data in enumerate(final_lines_data):
                line_width_measured = line_data["width"]

                line_start_x = (
                    block_start_x + (final_max_line_width - line_width_measured) / 2.0
                )
                cursor_x = line_start_x

                if bg_paint is not None:
                    pad_x = final_font_size * 0.1
                    pad_y = final_font_size * 0.05
                    rect = skia.Rect.MakeXYWH(
                        line_start_x - pad_x,
                        current_baseline_y + final_metrics.fAscent - pad_y,
                        line_width_measured + 2 * pad_x,
                        -final_metrics.fAscent + final_metrics.fDescent + 2 * pad_y,
                    )
                    canvas.drawRect(rect, bg_paint)

                segments = line_data.get("segments", [])

                is_line_rtl = is_rtl_script(line_data.get("text_with_markers", ""))
                if is_line_rtl:
                    cursor_x = line_start_x + line_width_measured

                for segment_text, style_name in segments:
                    typeface_to_use = None
                    hb_face_to_use = None

                    if style_name == "bold_italic":
                        typeface_to_use = loaded_typefaces.get("bold_italic")
                        hb_face_to_use = loaded_hb_faces.get("bold_italic")
                        if not typeface_to_use or not hb_face_to_use:
                            typeface_to_use = loaded_typefaces.get("bold")
                            hb_face_to_use = loaded_hb_faces.get("bold")
                        if not typeface_to_use or not hb_face_to_use:
                            typeface_to_use = loaded_typefaces.get("italic")
                            hb_face_to_use = loaded_hb_faces.get("italic")
                        if not typeface_to_use or not hb_face_to_use:
                            typeface_to_use = regular_typeface
                            hb_face_to_use = regular_hb_face
                    elif style_name == "bold":
                        typeface_to_use = loaded_typefaces.get("bold")
                        hb_face_to_use = loaded_hb_faces.get("bold")
                        if not typeface_to_use or not hb_face_to_use:
                            typeface_to_use = regular_typeface
                            hb_face_to_use = regular_hb_face
                    elif style_name == "italic":
                        typeface_to_use = loaded_typefaces.get("italic")
                        hb_face_to_use = loaded_hb_faces.get("italic")
                        if not typeface_to_use or not hb_face_to_use:
                            typeface_to_use = regular_typeface
                            hb_face_to_use = regular_hb_face
                    else:
                        typeface_to_use = regular_typeface
                        hb_face_to_use = regular_hb_face

                    if not typeface_to_use or not hb_face_to_use:
                        continue

                    skia_font_segment = skia.Font(typeface_to_use, final_font_size)
                    skia_font_segment.setSubpixel(use_subpixel_rendering)
                    skia_font_segment.setHinting(skia_hinting)

                    hb_font_segment = hb.Font(hb_face_to_use)
                    hb_font_segment.ptem = float(final_font_size)
                    hb_scale = int(final_font_size * 64)
                    hb_font_segment.scale = (hb_scale, hb_scale)

                    try:
                        infos, positions, seg_direction = shape_line(
                            segment_text, hb_font_segment, features_to_enable
                        )
                        if not infos:
                            continue
                    except Exception:
                        continue

                    builder = skia.TextBlobBuilder()
                    glyph_ids = [info.codepoint for info in infos]
                    skia_point_positions = []
                    segment_cursor_x = 0

                    HB_26_6_SCALE_FACTOR = 64.0

                    segment_width_calculated = (
                        sum(pos.x_advance for pos in positions) / HB_26_6_SCALE_FACTOR
                    )

                    if is_line_rtl:
                        cursor_x -= segment_width_calculated
                        segment_start_x = cursor_x
                    else:
                        segment_start_x = cursor_x

                    for _, pos in zip(infos, positions):
                        glyph_x = (
                            segment_start_x
                            + segment_cursor_x
                            + (pos.x_offset / HB_26_6_SCALE_FACTOR)
                        )
                        glyph_y = current_baseline_y - (
                            pos.y_offset / HB_26_6_SCALE_FACTOR
                        )
                        skia_point_positions.append(skia.Point(glyph_x, glyph_y))

                        segment_cursor_x += pos.x_advance / HB_26_6_SCALE_FACTOR

                    try:
                        _ = builder.allocRunPos(
                            skia_font_segment, glyph_ids, skia_point_positions
                        )

                        text_blob = builder.make()
                        if text_blob:
                            if outline_paint:
                                canvas.drawTextBlob(text_blob, 0, 0, outline_paint)
                            canvas.drawTextBlob(text_blob, 0, 0, paint)

                            if not is_line_rtl:
                                cursor_x += segment_width_calculated

                    except Exception as e:
                        logger.warning(f"Skia rendering error for '{segment_text}': {e}")
                        if not is_line_rtl:
                            cursor_x += segment_width_calculated

                current_baseline_y += final_line_height

            if need_transform:
                canvas.restore()

        return True

    except Exception as e:
        logger.error(f"Drawing failed: {e}")
        return False
