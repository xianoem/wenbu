import os

from PIL import Image

from .options import RunOptions

# zlib level 1 instead of Pillow's 6: still lossless, several times faster on 26 MP pages.
PNG_COMPRESSION = 1

SOURCE_FORMATS = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp"}

EXTENSIONS = {"png": ".png", "webp": ".webp", "jpeg": ".jpg"}


def output_format(source: str, options: RunOptions) -> str:
    if options.output_format != "source":
        return options.output_format

    return SOURCE_FORMATS.get(os.path.splitext(source)[1].lower(), "png")


def output_name(source: str, options: RunOptions) -> str:
    stem = os.path.splitext(os.path.basename(source))[0]

    return stem + EXTENSIONS[output_format(source, options)]


def save_page(image: Image.Image, source: str, output: str, options: RunOptions) -> None:
    os.makedirs(os.path.dirname(output), exist_ok=True)
    fmt = output_format(source, options)
    partial = output + ".partial"

    if fmt == "jpeg":
        image.convert("RGB").save(partial, format="JPEG", quality=options.output_quality, subsampling=0)
    elif fmt == "webp":
        lossless = options.output_quality >= 100
        image.save(partial, format="WEBP", lossless=lossless, quality=options.output_quality, method=4)
    else:
        image.save(partial, format="PNG", compress_level=PNG_COMPRESSION)

    os.replace(partial, output)
