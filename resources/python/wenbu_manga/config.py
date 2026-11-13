from typing import Optional

from manga_translator.config import (
    Config,
    DetectorConfig,
    InpainterConfig,
    RenderConfig,
    TranslatorConfig,
)

from .options import RunOptions


class WenbuRenderConfig(RenderConfig):
    line_spacing: Optional[float] = None
    skia_max_font_size: int = 100
    skia_min_font_size: int = 12
    skia_use_subpixel: bool = True
    skia_font_hinting: str = "none"
    skia_use_ligatures: bool = False
    skia_supersampling: int = 4
    skia_outline_width: float = 0.0
    skia_border: bool = True
    skia_border_color: str = "FFFFFF"
    skia_force_fit: bool = True
    skia_font_dir: Optional[str] = None


class WenbuConfig(Config):
    render: WenbuRenderConfig = WenbuRenderConfig()


def build_config(options: RunOptions) -> WenbuConfig:
    return WenbuConfig(
        render=WenbuRenderConfig(
            uppercase=options.uppercase,
            font_color=options.text_color or None,
            skia_max_font_size=options.max_font_size,
            skia_min_font_size=options.min_font_size,
            skia_supersampling=options.supersampling,
            skia_border=options.text_border,
            skia_border_color=options.border_color or "FFFFFF",
            skia_font_dir=options.font_dir,
        ),
        translator=TranslatorConfig(translator="none", target_lang=options.target_language),
        detector=DetectorConfig(detection_size=options.detection_size),
        inpainter=InpainterConfig(inpainting_size=options.inpainting_size),
        kernel_size=3,
    )
