import re
from dataclasses import dataclass, fields
from typing import Any

INPAINTING_MODES = ("regions", "page")
OUTPUT_FORMATS = ("png", "webp", "jpeg", "source")


@dataclass(frozen=True)
class RunOptions:
    font_dir: str
    model_dir: str
    font_family: str = ""
    font_cache: str = ""
    use_gpu: bool = True
    source_language: str = "auto"
    target_language: str = "ENG"
    detection_size: int = 2048
    inpainting: str = "regions"
    inpainting_size: int = 2048
    supersampling: int = 4
    min_font_size: int = 12
    max_font_size: int = 100
    text_border: bool = True
    text_color: str = ""
    border_color: str = "FFFFFF"
    uppercase: bool = False
    output_format: str = "png"
    output_quality: int = 95
    pages_ahead: int = 3
    translation_requests: int = 3

    @staticmethod
    def parse(value: Any) -> "RunOptions":
        if not isinstance(value, dict):
            raise ValueError("Run options must be an object.")

        known = {field.name: field for field in fields(RunOptions)}
        unknown = set(value) - set(known)

        if unknown:
            raise ValueError(f"Unknown run options: {', '.join(sorted(unknown))}.")

        options = RunOptions(**value)

        for field in fields(RunOptions):
            current = getattr(options, field.name)

            if not isinstance(current, field.type) or (field.type is int and isinstance(current, bool)):
                raise ValueError(f"Run option {field.name} must be {field.type.__name__}.")

        if options.inpainting not in INPAINTING_MODES:
            raise ValueError(f"Inpainting must be one of {', '.join(INPAINTING_MODES)}.")

        if options.output_format not in OUTPUT_FORMATS:
            raise ValueError(f"Output format must be one of {', '.join(OUTPUT_FORMATS)}.")

        if not 1 <= options.supersampling <= 4:
            raise ValueError("Supersampling must be between 1 and 4.")

        if not 1 <= options.min_font_size <= options.max_font_size:
            raise ValueError("Font sizes must be positive, with the minimum below the maximum.")

        for name in ("text_color", "border_color"):
            value = getattr(options, name)

            if value and not re.fullmatch(r"[0-9A-Fa-f]{6}", value):
                raise ValueError(f"{name} must be a hex colour like 1A1A1A.")

        if options.font_family and not options.font_cache:
            raise ValueError("An installed font needs a font cache folder.")

        if options.pages_ahead < 1 or options.translation_requests < 1:
            raise ValueError("Pages ahead and translation requests must be at least 1.")

        return options
