import dataclasses
import logging
import os
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

from manga_translator.rendering.ballon_extractor import extract_ballon_region
from .font_manager import RenderingError
from .text_processing import LineBreaking, line_breaking
from .text_renderer import SkiaRenderingConfig, render_text_skia

logger = logging.getLogger('skia_render')

MIN_BALLOON_AREA_RATIO = 1.15
FALLBACK_MIN_EXPAND_RATIO = 1.35
FALLBACK_MAX_EXPAND_RATIO = 2.75
RENDER_BOX_GAP = 2
MIN_RENDER_BOX_SIZE = 4


def _extract_region_mask(
    _full_mask: Optional[np.ndarray],
    x1: int, y1: int, x2: int, y2: int,
) -> Optional[np.ndarray]:
    """ctx.mask is the narrow inpainting mask, not the bubble interior the safe-area algorithm expects, so a solid rectangle is used."""
    h = y2 - y1
    w = x2 - x1
    if w <= 0 or h <= 0:
        return None
    return np.full((h, w), 255, dtype=np.uint8)


def _clip_bbox(
    bbox: Tuple[float, float, float, float], img_shape: Tuple[int, ...]
) -> Tuple[int, int, int, int]:
    img_h, img_w = img_shape[:2]
    x1, y1, x2, y2 = bbox
    x1 = int(max(0, min(round(x1), img_w - 1)))
    y1 = int(max(0, min(round(y1), img_h - 1)))
    x2 = int(max(x1 + 1, min(round(x2), img_w)))
    y2 = int(max(y1 + 1, min(round(y2), img_h)))
    return x1, y1, x2, y2


def _bbox_overlaps(
    a: Tuple[int, int, int, int],
    b: Tuple[int, int, int, int],
    gap: int = 0,
) -> bool:
    return not (
        a[2] + gap <= b[0]
        or b[2] + gap <= a[0]
        or a[3] + gap <= b[1]
        or b[3] + gap <= a[1]
    )


def _region_center(region) -> Tuple[float, float]:
    x1, y1, x2, y2 = [float(v) for v in region.xyxy]
    return (x1 + x2) / 2.0, (y1 + y2) / 2.0


def _safe_bbox(
    bbox: Tuple[int, int, int, int],
    fallback: Tuple[int, int, int, int],
) -> Tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    if x2 - x1 >= MIN_RENDER_BOX_SIZE and y2 - y1 >= MIN_RENDER_BOX_SIZE:
        return bbox
    return fallback


def _crop_mask_to_bbox(
    mask: Optional[np.ndarray],
    old_bbox: Tuple[int, int, int, int],
    new_bbox: Tuple[int, int, int, int],
) -> Optional[np.ndarray]:
    if mask is None:
        return None

    nx1, ny1, nx2, ny2 = new_bbox
    new_w = nx2 - nx1
    new_h = ny2 - ny1
    if new_w <= 0 or new_h <= 0:
        return None

    ox1, oy1, ox2, oy2 = old_bbox
    ix1 = max(ox1, nx1)
    iy1 = max(oy1, ny1)
    ix2 = min(ox2, nx2)
    iy2 = min(oy2, ny2)
    if ix2 <= ix1 or iy2 <= iy1:
        return np.full((new_h, new_w), 255, dtype=np.uint8)

    cropped = np.zeros((new_h, new_w), dtype=np.uint8)
    src_x1 = ix1 - ox1
    src_y1 = iy1 - oy1
    src_x2 = ix2 - ox1
    src_y2 = iy2 - oy1
    dst_x1 = ix1 - nx1
    dst_y1 = iy1 - ny1
    dst_x2 = ix2 - nx1
    dst_y2 = iy2 - ny1
    cropped[dst_y1:dst_y2, dst_x1:dst_x2] = mask[src_y1:src_y2, src_x1:src_x2]
    return cropped


def _text_length(text: str) -> int:
    return len("".join(str(text or "").split()))


def _fallback_expand_ratio(region) -> float:
    source_len = max(1, _text_length(getattr(region, "text_raw", region.text)))
    translated_len = _text_length(getattr(region, "translation", ""))
    growth = max(0.0, (translated_len - source_len) / source_len)
    ratio = FALLBACK_MIN_EXPAND_RATIO + growth * 0.45
    return min(FALLBACK_MAX_EXPAND_RATIO, max(FALLBACK_MIN_EXPAND_RATIO, ratio))


def _expand_region_bbox(
    region, img_shape: Tuple[int, ...]
) -> Tuple[int, int, int, int]:
    x1, y1, x2, y2 = [float(v) for v in region.xyxy]
    width = max(1.0, x2 - x1)
    height = max(1.0, y2 - y1)
    cx = x1 + width / 2.0
    cy = y1 + height / 2.0
    expand = _fallback_expand_ratio(region)

    if getattr(region, "horizontal", False):
        expand_x = expand
        expand_y = max(1.15, min(expand, 1.55))
    elif getattr(region, "vertical", False):
        expand_x = max(1.15, min(expand, 1.55))
        expand_y = expand
    else:
        expand_x = expand_y = expand

    new_w = width * expand_x
    new_h = height * expand_y
    return _clip_bbox(
        (cx - new_w / 2.0, cy - new_h / 2.0, cx + new_w / 2.0, cy + new_h / 2.0),
        img_shape,
    )


def _balloon_enlarge_ratio(region) -> float:
    try:
        w, h = region.xywh[2], region.xywh[3]
        if w <= 0 or h <= 0:
            return FALLBACK_MIN_EXPAND_RATIO
        aspect_expand = max(w / h, h / w) * 1.5
        return float(min(max(aspect_expand, FALLBACK_MIN_EXPAND_RATIO), 3.0))
    except Exception:
        return FALLBACK_MIN_EXPAND_RATIO


def _extract_balloon_render_geometry(
    original_img: Optional[np.ndarray], region
) -> Tuple[Optional[Tuple[int, int, int, int]], Optional[np.ndarray]]:
    if original_img is None:
        return None, None

    try:
        balloon_mask, xyxy = extract_ballon_region(
            original_img,
            region.xywh,
            enlarge_ratio=_balloon_enlarge_ratio(region),
            verbose=False,
        )
        if balloon_mask is None or not np.any(balloon_mask):
            return None, None

        bbox = _clip_bbox(tuple(xyxy), original_img.shape)
        x1, y1, x2, y2 = bbox
        region_x1, region_y1, region_x2, region_y2 = [int(v) for v in region.xyxy]
        region_area = max(1, (region_x2 - region_x1) * (region_y2 - region_y1))
        bbox_area = max(1, (x2 - x1) * (y2 - y1))

        if bbox_area < region_area * MIN_BALLOON_AREA_RATIO:
            return None, None

        expected_h = y2 - y1
        expected_w = x2 - x1
        if balloon_mask.shape[:2] != (expected_h, expected_w):
            balloon_mask = cv2.resize(
                balloon_mask,
                (expected_w, expected_h),
                interpolation=cv2.INTER_NEAREST,
            )
        balloon_mask = (balloon_mask > 0).astype(np.uint8) * 255
        return bbox, balloon_mask
    except Exception as e:
        logger.debug(f"Balloon extraction failed for Skia region: {e}")
        return None, None


def _resolve_render_geometry(
    original_img: Optional[np.ndarray],
    region,
    full_mask: Optional[np.ndarray],
) -> Tuple[Tuple[int, int, int, int], Optional[np.ndarray]]:
    moved = _lettering_of(region).get("textBox")

    if moved:
        shape = original_img.shape if original_img is not None else (int(moved[3]) + 1, int(moved[2]) + 1)

        return _clip_bbox(tuple(moved), shape), None

    bbox, cleaned_mask = _extract_balloon_render_geometry(original_img, region)
    if bbox is not None and cleaned_mask is not None:
        return bbox, cleaned_mask

    img_shape = (
        original_img.shape if original_img is not None
        else full_mask.shape if full_mask is not None
        else (max(1, int(region.xyxy[3])), max(1, int(region.xyxy[2])))
    )
    bbox = _expand_region_bbox(region, img_shape)
    return bbox, _extract_region_mask(full_mask, *bbox)


def _constrain_render_geometries(
    regions: List,
    geometries: List[Tuple[Tuple[int, int, int, int], Optional[np.ndarray]]],
) -> List[Tuple[Tuple[int, int, int, int], Optional[np.ndarray]]]:
    if len(geometries) < 2:
        return geometries

    original_boxes = [bbox for bbox, _ in geometries]
    boxes = list(original_boxes)
    centers = [_region_center(region) for region in regions]

    for _ in range(3):
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if not _bbox_overlaps(boxes[i], boxes[j], RENDER_BOX_GAP):
                    continue

                cix, ciy = centers[i]
                cjx, cjy = centers[j]
                if abs(cix - cjx) >= abs(ciy - cjy):
                    split = int(round((cix + cjx) / 2.0))
                    if cix <= cjx:
                        new_i = (
                            boxes[i][0],
                            boxes[i][1],
                            min(boxes[i][2], split - RENDER_BOX_GAP),
                            boxes[i][3],
                        )
                        new_j = (
                            max(boxes[j][0], split + RENDER_BOX_GAP),
                            boxes[j][1],
                            boxes[j][2],
                            boxes[j][3],
                        )
                    else:
                        new_i = (
                            max(boxes[i][0], split + RENDER_BOX_GAP),
                            boxes[i][1],
                            boxes[i][2],
                            boxes[i][3],
                        )
                        new_j = (
                            boxes[j][0],
                            boxes[j][1],
                            min(boxes[j][2], split - RENDER_BOX_GAP),
                            boxes[j][3],
                        )
                else:
                    split = int(round((ciy + cjy) / 2.0))
                    if ciy <= cjy:
                        new_i = (
                            boxes[i][0],
                            boxes[i][1],
                            boxes[i][2],
                            min(boxes[i][3], split - RENDER_BOX_GAP),
                        )
                        new_j = (
                            boxes[j][0],
                            max(boxes[j][1], split + RENDER_BOX_GAP),
                            boxes[j][2],
                            boxes[j][3],
                        )
                    else:
                        new_i = (
                            boxes[i][0],
                            max(boxes[i][1], split + RENDER_BOX_GAP),
                            boxes[i][2],
                            boxes[i][3],
                        )
                        new_j = (
                            boxes[j][0],
                            boxes[j][1],
                            boxes[j][2],
                            min(boxes[j][3], split - RENDER_BOX_GAP),
                        )

                new_i = _safe_bbox(new_i, boxes[i])
                new_j = _safe_bbox(new_j, boxes[j])
                if new_i != boxes[i] or new_j != boxes[j]:
                    boxes[i] = new_i
                    boxes[j] = new_j
                    changed = True

        if not changed:
            break

    constrained = []
    for (old_bbox, old_mask), new_bbox in zip(geometries, boxes):
        new_mask = old_mask
        if new_bbox != old_bbox:
            new_mask = _crop_mask_to_bbox(old_mask, old_bbox, new_bbox)
        constrained.append((new_bbox, new_mask))
    return constrained


def _get_bubble_color_bgr(region) -> tuple:
    try:
        _, bg = region.get_font_colors(bgr=True)
        return tuple(int(c) for c in bg)
    except Exception:
        return (255, 255, 255)


def _get_text_color_rgb(region, render_config) -> Optional[tuple]:
    if render_config.font_color_fg is not None:
        return render_config.font_color_fg
    try:
        fg, _ = region.get_font_colors(bgr=False)
        return tuple(int(c) for c in fg)
    except Exception:
        return None


def _hex_color_to_rgb(value: Optional[str], fallback: Tuple[int, int, int]) -> Tuple[int, int, int]:
    if not value:
        return fallback

    color = str(value).strip().lstrip("#")
    if len(color) != 6:
        return fallback

    try:
        return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback


async def dispatch_skia(
    img_inpainted: np.ndarray,
    img_rgb: np.ndarray,
    text_regions: List,
    font_path: Optional[str],
    mask: Optional[np.ndarray],
    render_config,
) -> np.ndarray:
    text_regions = [r for r in text_regions if r.translation]
    if not text_regions:
        return img_inpainted

    font_dir = _resolve_font_dir(font_path, render_config)
    skia_config = _skia_config(render_config, font_dir)

    pil_image = Image.fromarray(
        cv2.cvtColor(img_inpainted, cv2.COLOR_BGR2RGB)
    ).convert("RGBA")

    geometries = [
        _resolve_render_geometry(img_rgb, region, mask)
        for region in text_regions
    ]
    geometries = _constrain_render_geometries(text_regions, geometries)

    for i, (region, (bbox, cleaned_mask)) in enumerate(zip(text_regions, geometries)):
        try:
            pil_image = _render_single_region(
                pil_image,
                region,
                bbox,
                cleaned_mask,
                skia_config,
                render_config,
                font_dir,
                i,
            )
        except RenderingError as e:
            logger.warning(f"Skia render failed for region {i}: {e}")
        except Exception as e:
            logger.error(f"Unexpected Skia render error for region {i}: {e}")

    result_rgb = np.array(pil_image.convert("RGB"))
    return cv2.cvtColor(result_rgb, cv2.COLOR_RGB2BGR)


def _skia_config(render_config, font_dir: str) -> SkiaRenderingConfig:
    return SkiaRenderingConfig(
        font_dir=font_dir,
        max_font_size=render_config.skia_max_font_size,
        min_font_size=render_config.skia_min_font_size,
        line_spacing_mult=render_config.line_spacing if render_config.line_spacing else 1.0,
        use_subpixel_rendering=render_config.skia_use_subpixel,
        font_hinting=render_config.skia_font_hinting,
        use_ligatures=render_config.skia_use_ligatures,
        hyphenate_before_scaling=not render_config.no_hyphenation,
        supersampling_factor=render_config.skia_supersampling,
        outline_width=render_config.skia_outline_width,
        border_enabled=getattr(render_config, "skia_border", True),
        border_color_rgb=_hex_color_to_rgb(
            getattr(render_config, "skia_border_color", "FFFFFF"),
            (255, 255, 255),
        ),
        force_fit=render_config.skia_force_fit,
    )


def _lettering_of(region) -> dict:
    return getattr(region, "wenbu", None) or {}


EDITOR_PADDING = 0.02


def _region_config(skia_config: SkiaRenderingConfig, lettering: dict) -> SkiaRenderingConfig:
    changes = {}

    if lettering:
        changes["padding_ratio"] = EDITOR_PADDING

    if lettering.get("fontDir"):
        changes["font_dir"] = str(lettering["fontDir"])

    if lettering.get("size"):
        changes["min_font_size"] = changes["max_font_size"] = int(lettering["size"])

    if lettering.get("leading"):
        changes["line_spacing_mult"] = float(lettering["leading"])

    if "hyphenate" in lettering:
        changes["hyphenate_before_scaling"] = bool(lettering["hyphenate"])

    return dataclasses.replace(skia_config, **changes)


def _breaking_of(lettering: dict) -> LineBreaking:
    if not lettering:
        return line_breaking.get()

    mode = str(lettering.get("breakMode", "balanced"))

    return LineBreaking(mode, bool(lettering.get("avoidOrphans", True)), even_out=mode == "balanced")


def _translation_of(region, render_config) -> str:
    lettering = _lettering_of(region)
    translation = region.get_translation_for_rendering()
    uppercase = lettering.get("uppercase", render_config.uppercase)

    if lettering.get("breakMode") != "manual":
        translation = " ".join(translation.split())

    if uppercase:
        return translation.upper()

    if render_config.lowercase:
        return translation.lower()

    return translation


def layout_candidates(img_rgb: np.ndarray, region, font_path: Optional[str], render_config) -> list:
    font_dir = _resolve_font_dir(font_path, render_config)
    lettering = _lettering_of(region)
    font_dir = str(lettering.get("fontDir") or font_dir)
    config = _region_config(_skia_config(render_config, font_dir), lettering)
    (x1, y1, x2, y2), _ = _resolve_render_geometry(img_rgb, region, None)
    narrow = int((x2 - x1) * 0.1)
    text = " ".join(_translation_of(region, render_config).split())
    tries = [("balanced", (x1, y1, x2, y2)), ("greedy", (x1, y1, x2, y2)), ("balanced", (x1 + narrow, y1, x2 - narrow, y2))]
    candidates = []

    for mode, bbox in tries:
        token = line_breaking.set(LineBreaking(mode, bool(lettering.get("avoidOrphans", True)), even_out=mode == "balanced"))

        try:
            laid_out = render_text_skia(Image.new("RGBA", (1, 1)), text, bbox, font_dir, config=config, layout_only=True)
        except RenderingError:
            continue
        finally:
            line_breaking.reset(token)

        lines = laid_out.info.get("lines", [])

        if lines and all(candidate["lines"] != lines for candidate in candidates):
            candidates.append({"lines": lines, "fontSize": int(laid_out.info.get("font_size", 0))})

    return candidates


def _render_single_region(
    pil_image: Image.Image,
    region,
    bbox: Tuple[int, int, int, int],
    cleaned_mask: Optional[np.ndarray],
    skia_config: SkiaRenderingConfig,
    render_config,
    font_dir: str,
    region_idx: int,
) -> Image.Image:
    lettering = _lettering_of(region)
    token = line_breaking.set(_breaking_of(lettering))

    try:
        return _render_lettered_region(
            pil_image,
            region,
            bbox,
            cleaned_mask,
            _region_config(skia_config, lettering),
            render_config,
            str(lettering.get("fontDir") or font_dir),
            region_idx,
        )
    finally:
        line_breaking.reset(token)


def _render_lettered_region(
    pil_image: Image.Image,
    region,
    bbox: Tuple[int, int, int, int],
    cleaned_mask: Optional[np.ndarray],
    skia_config: SkiaRenderingConfig,
    render_config,
    font_dir: str,
    region_idx: int,
) -> Image.Image:
    bubble_color_bgr = _get_bubble_color_bgr(region)
    text_color_rgb = _get_text_color_rgb(region, render_config)

    rotation_deg = float(region.angle) if region.angle != 0 else 0.0

    translation = _translation_of(region, render_config)

    return render_text_skia(
        pil_image=pil_image,
        text=translation,
        bbox=bbox,
        font_dir=font_dir,
        cleaned_mask=cleaned_mask,
        bubble_color_bgr=bubble_color_bgr,
        config=skia_config,
        raise_on_safe_error=False,
        verbose=False,
        bubble_id=str(region_idx + 1),
        rotation_deg=rotation_deg,
        text_color_rgb=text_color_rgb,
    )


def _resolve_font_dir(font_path: Optional[str], render_config) -> str:
    if render_config.skia_font_dir:
        return render_config.skia_font_dir

    if font_path:
        if os.path.isdir(font_path):
            return font_path
        parent = os.path.dirname(font_path)
        if parent and os.path.isdir(parent):
            return parent

    from manga_translator.utils import BASE_PATH
    return os.path.join(BASE_PATH, 'fonts')
