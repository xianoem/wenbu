import io
import logging
import os
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional

from fontTools.ttLib import TTFont

logger = logging.getLogger('skia_render')


class LRUCache:
    def __init__(self, max_size: int = 100):
        self.max_size = max_size
        self.cache = OrderedDict()

    def get(self, key):
        if key in self.cache:
            value = self.cache.pop(key)
            self.cache[key] = value
            return value
        return None

    def put(self, key, value):
        if key in self.cache:
            self.cache.pop(key)
        elif len(self.cache) >= self.max_size:
            self.cache.popitem(last=False)
        self.cache[key] = value

    def __contains__(self, key):
        return key in self.cache

    def __delitem__(self, key):
        if key in self.cache:
            del self.cache[key]


_font_data_cache = LRUCache(max_size=50)
_font_features_cache = LRUCache(max_size=50)
_font_cmap_cache = LRUCache(max_size=50)
_font_variants_cache: Dict[str, Dict[str, Optional[Path]]] = {}

FONT_KEYWORDS = {
    "bold": {"bold", "heavy", "black"},
    "italic": {"italic", "oblique", "slanted", "inclined"},
    "regular": {"regular", "normal", "roman", "medium"},
}


class FontError(Exception):
    pass


class ImageProcessingError(Exception):
    pass


class RenderingError(Exception):
    pass


def get_font_features(font_path: str) -> Dict[str, List[str]]:
    cached_features = _font_features_cache.get(font_path)
    if cached_features is not None:
        return cached_features

    features = {"GSUB": [], "GPOS": []}
    try:
        font = TTFont(font_path, fontNumber=0)

        if (
            "GSUB" in font
            and hasattr(font["GSUB"].table, "FeatureList")
            and font["GSUB"].table.FeatureList
        ):
            features["GSUB"] = sorted(
                [fr.FeatureTag for fr in font["GSUB"].table.FeatureList.FeatureRecord]
            )

        if (
            "GPOS" in font
            and hasattr(font["GPOS"].table, "FeatureList")
            and font["GPOS"].table.FeatureList
        ):
            features["GPOS"] = sorted(
                [fr.FeatureTag for fr in font["GPOS"].table.FeatureList.FeatureRecord]
            )

    except ImportError:
        logger.warning("fontTools not available - font features disabled")
    except Exception as e:
        logger.warning(
            f"Font feature inspection failed for {os.path.basename(font_path)}: {e}"
        )

    _font_features_cache.put(font_path, features)
    return features


def get_font_cmap(font_path: str) -> set:
    cached_cmap = _font_cmap_cache.get(font_path)
    if cached_cmap is not None:
        return cached_cmap

    supported_codepoints: set = set()
    try:
        font = TTFont(font_path, fontNumber=0)
        cmap = font.getBestCmap()
        if cmap:
            supported_codepoints = set(cmap.keys())
    except Exception as e:
        logger.warning(
            f"Failed to extract cmap from {os.path.basename(font_path)}: {e}"
        )

    _font_cmap_cache.put(font_path, supported_codepoints)
    return supported_codepoints


def sanitize_text_for_font(text: str, font_path: str, verbose: bool = False) -> str:
    if not text:
        return text

    supported_codepoints = get_font_cmap(font_path)

    if not supported_codepoints:
        logger.debug(
            f"Could not get cmap for {os.path.basename(font_path)}, skipping sanitization"
        )
        return text

    STYLE_MARKER_CHARS = {"*"}
    WHITESPACE_CHARS = {" ", "\t", "\n", "\r"}

    removed_chars: List[str] = []
    sanitized_chars: List[str] = []

    for char in text:
        codepoint = ord(char)
        if char in STYLE_MARKER_CHARS or char in WHITESPACE_CHARS:
            sanitized_chars.append(char)
        elif codepoint in supported_codepoints:
            sanitized_chars.append(char)
        else:
            removed_chars.append(char)

    if removed_chars:
        unique_removed = sorted(set(removed_chars), key=lambda c: ord(c))
        char_descriptions = [f"'{c}' (U+{ord(c):04X})" for c in unique_removed[:10]]
        if len(unique_removed) > 10:
            char_descriptions.append(f"... and {len(unique_removed) - 10} more")
        logger.info(
            f"Removed {len(removed_chars)} unsupported character(s): "
            f"{', '.join(char_descriptions)}"
        )

    return "".join(sanitized_chars)


def _validate_font_file(font_file: Path, verbose: bool = False) -> bool:
    try:
        font = TTFont(font_file, fontNumber=0)
        if "cmap" not in font or "head" not in font:
            logger.warning(
                f"Font file {font_file.name} appears to be missing required tables"
            )
            return False
        return True
    except Exception as e:
        logger.warning(f"Font file {font_file.name} appears to be corrupt: {e}")
        return False


def find_font_variants(
    font_dir: str, verbose: bool = False
) -> Dict[str, Optional[Path]]:
    resolved_dir = str(Path(font_dir).resolve())
    if resolved_dir in _font_variants_cache:
        return _font_variants_cache[resolved_dir]

    logger.debug(f"Scanning fonts in {os.path.basename(resolved_dir)}")
    font_files: List[Path] = []
    font_variants: Dict[str, Optional[Path]] = {
        "regular": None,
        "italic": None,
        "bold": None,
        "bold_italic": None,
    }
    identified_files: set[Path] = set()

    try:
        font_dir_path = Path(resolved_dir)
        if font_dir_path.exists() and font_dir_path.is_dir():
            font_files = list(font_dir_path.glob("*.ttf")) + list(
                font_dir_path.glob("*.otf")
            )
        else:
            logger.warning(f"Font directory not found: {font_dir_path}")
            _font_variants_cache[resolved_dir] = font_variants
            return font_variants
    except Exception as e:
        logger.warning(f"Font directory access error: {e}")
        _font_variants_cache[resolved_dir] = font_variants
        return font_variants

    if not font_files:
        logger.warning(f"No font files found in {os.path.basename(resolved_dir)}")
        _font_variants_cache[resolved_dir] = font_variants
        return font_variants

    font_files.sort(key=lambda x: len(x.name), reverse=True)

    for font_file in font_files:
        if font_file in identified_files:
            continue
        if not _validate_font_file(font_file, verbose=verbose):
            continue
        stem_lower = font_file.stem.lower()
        is_bold = any(kw in stem_lower for kw in FONT_KEYWORDS["bold"])
        is_italic = any(kw in stem_lower for kw in FONT_KEYWORDS["italic"])
        if is_bold and is_italic and not font_variants["bold_italic"]:
            font_variants["bold_italic"] = font_file
            identified_files.add(font_file)

    for font_file in font_files:
        if font_file in identified_files:
            continue
        if not _validate_font_file(font_file, verbose=verbose):
            continue
        stem_lower = font_file.stem.lower()
        is_bold = any(kw in stem_lower for kw in FONT_KEYWORDS["bold"])
        is_italic = any(kw in stem_lower for kw in FONT_KEYWORDS["italic"])
        if is_bold and not is_italic and not font_variants["bold"]:
            font_variants["bold"] = font_file
            identified_files.add(font_file)
        elif is_italic and not is_bold and not font_variants["italic"]:
            font_variants["italic"] = font_file
            identified_files.add(font_file)

    for font_file in font_files:
        if font_file in identified_files:
            continue
        if not _validate_font_file(font_file, verbose=verbose):
            continue
        stem_lower = font_file.stem.lower()
        is_regular = any(kw in stem_lower for kw in FONT_KEYWORDS["regular"])
        is_bold = any(kw in stem_lower for kw in FONT_KEYWORDS["bold"])
        is_italic = any(kw in stem_lower for kw in FONT_KEYWORDS["italic"])
        if is_regular and not is_bold and not is_italic and not font_variants["regular"]:
            font_variants["regular"] = font_file
            identified_files.add(font_file)

    if not font_variants["regular"]:
        for font_file in font_files:
            if font_file in identified_files:
                continue
            if not _validate_font_file(font_file, verbose=verbose):
                continue
            stem_lower = font_file.stem.lower()
            is_bold = any(kw in stem_lower for kw in FONT_KEYWORDS["bold"])
            is_italic = any(kw in stem_lower for kw in FONT_KEYWORDS["italic"])
            if (
                not is_bold
                and not is_italic
                and not any(kw in stem_lower for kw in FONT_KEYWORDS["regular"])
            ):
                font_name_lower = font_file.name.lower()
                is_likely_specific = any(
                    spec in font_name_lower
                    for spec in [
                        "light", "thin", "condensed", "expanded", "semi",
                        "demi", "extra", "ultra", "book", "medium",
                        "black", "heavy",
                    ]
                )
                if not is_likely_specific:
                    font_variants["regular"] = font_file
                    identified_files.add(font_file)
                    break

    if not font_variants["regular"]:
        first_available = next(
            (f for f in font_files if f not in identified_files), None
        )
        if first_available:
            font_variants["regular"] = first_available
            identified_files.add(first_available)

    if not font_variants["regular"]:
        backup_regular = next(
            (
                f
                for f in [
                    font_variants.get("bold"),
                    font_variants.get("italic"),
                    font_variants.get("bold_italic"),
                ]
                if f
            ),
            None,
        )
        if backup_regular:
            font_variants["regular"] = backup_regular
        elif font_files:
            font_variants["regular"] = font_files[0]

    if not font_variants["regular"]:
        raise FontError(f"No regular font found in directory: {resolved_dir}")
    else:
        found_variants = [
            f"{style}: {path.name}" for style, path in font_variants.items() if path
        ]
        logger.debug(f"Font variants: {', '.join(found_variants)}")

    _font_variants_cache[resolved_dir] = font_variants
    return font_variants


def sanitize_font_data(font_path: str, font_data: bytes) -> bytes:
    try:
        font_file = io.BytesIO(font_data)
        font = TTFont(font_file, fontNumber=0)

        data_was_modified = False

        if "kern" in font:
            try:
                _ = font["kern"].tables[0].kernTable
            except Exception:
                logger.info(
                    f"Detected corrupt kern table in {os.path.basename(font_path)}. Removing it."
                )
                del font["kern"]
                data_was_modified = True

        test_glyph_name = None
        cmap = font.getBestCmap()
        if cmap and ord("M") in cmap:
            test_glyph_name = cmap[ord("M")]

        if test_glyph_name and "glyf" in font and "hmtx" in font:
            glyph = font["glyf"][test_glyph_name]
            advance_width = font["hmtx"][test_glyph_name][0]

            is_italic = (font["head"].macStyle & 0b10) != 0 if "head" in font else False
            tolerance = 1.3 if is_italic else 1.0

            if hasattr(glyph, "xMax") and glyph.xMax > (advance_width * tolerance):
                logger.info(
                    f"Font {os.path.basename(font_path)} has unreliable metrics. Overriding UPM to 1000."
                )
                font["head"].unitsPerEm = 1000
                data_was_modified = True

        if data_was_modified:
            output_bytes = io.BytesIO()
            font.save(output_bytes)
            return output_bytes.getvalue()
        else:
            return font_data

    except Exception as e:
        logger.warning(
            f"Font sanitization failed for {os.path.basename(font_path)}: {e}"
        )
        return font_data


def load_font_data(font_path: str) -> bytes:
    font_data = _font_data_cache.get(font_path)
    if font_data is None:
        try:
            with open(font_path, "rb") as f:
                original_font_data = f.read()

            font_data = sanitize_font_data(font_path, original_font_data)
            _font_data_cache.put(font_path, font_data)
        except Exception as e:
            logger.error(f"Font file read error: {e}")
            raise FontError(f"Failed to load font file: {font_path}") from e

    return font_data


def load_font_family(font_dir: str, verbose: bool = False) -> Dict[str, Optional[str]]:
    variants = find_font_variants(font_dir, verbose=verbose)
    return {style: str(path) if path else None for style, path in variants.items()}
