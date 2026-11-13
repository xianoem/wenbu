import asyncio
import contextvars
import os
import sys
import types
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Optional

import numpy as np

executor: Optional[ProcessPoolExecutor] = None

prefetched: contextvars.ContextVar[Optional[tuple[np.ndarray, bool, Future]]] = contextvars.ContextVar(
    "prefetched", default=None
)


class ArrayReader:
    def __init__(self, cv):
        self.cv = cv
        self.images: dict[str, np.ndarray] = {}

    def __getattr__(self, name):
        return getattr(self.cv, name)

    def imread(self, filename, *args):
        if filename in self.images:
            return self.images.pop(filename)

        return self.cv.imread(filename, *args)


reader: Optional[ArrayReader] = None


class TolerantPanels(list):
    """Kumiko removes merged panels that may already be gone, which upstream turns into a fallback."""

    def remove(self, value):
        if value in self:
            super().remove(value)


def get_panels(page):
    return page.__dict__["panels"]


def set_panels(page, value):
    page.__dict__["panels"] = value if isinstance(value, TolerantPanels) else TolerantPanels(value)


def tolerate_missing_panels(page_class) -> None:
    page_class.panels = property(get_panels, set_panels)


def light_package(name: str, path: str) -> types.ModuleType:
    package = types.ModuleType(name)
    package.__path__ = [path]
    sys.modules[name] = package

    return package


def start_child(upstream_dir: str) -> None:
    global reader

    root = os.path.join(upstream_dir, "manga_translator")
    light_package("manga_translator", root)
    utils = light_package("manga_translator.utils", os.path.join(root, "utils"))
    light_package("manga_translator.rendering", os.path.join(root, "rendering"))

    import cv2
    import manga_translator.utils.bubble as bubble
    import manga_translator.utils.generic as generic
    import manga_translator.utils.log as log
    import manga_translator.utils.panel.lib.page as page_module
    import manga_translator.utils.textblock as textblock

    for module in (log, generic, textblock):
        utils.__dict__.update({name: getattr(module, name) for name in dir(module) if not name.startswith("_")})

    utils.is_ignore = bubble.is_ignore
    tolerate_missing_panels(page_module.Page)
    reader = ArrayReader(cv2)
    page_module.cv = reader


def find_panels(img: np.ndarray, rtl: bool) -> list:
    from manga_translator.utils.panel.kumikolib import Kumiko

    key = f"<page {os.getpid()}>"
    reader.images[key] = img
    kumiko = Kumiko({"rtl": rtl})
    kumiko.parse_image(key)

    return kumiko.get_infos()[0]["panels"]


def refine_mask(text_regions, img_rgb, mask_raw, dilation_offset: int, ignore_bubble: int, kernel_size: int):
    from manga_translator.mask_refinement import dispatch

    return asyncio.run(dispatch(text_regions, img_rgb, mask_raw, "fit_text", dilation_offset, ignore_bubble, False, kernel_size))


def letter(inpainted, img_rgb, mask, text_regions, render_config, font_dir, alpha, base, source, output, options) -> None:
    from PIL import Image
    from manga_translator.utils.generic import dump_image

    from .save import save_page
    from .skia import dispatch_skia

    rendered = asyncio.run(dispatch_skia(inpainted, img_rgb, text_regions, font_dir, mask, render_config))
    height, width = rendered.shape[:2]
    canvas = Image.new("RGB", (width, height)) if base is None else Image.fromarray(base)
    alpha_image = None if alpha is None else Image.fromarray(alpha)
    save_page(dump_image(canvas, rendered, alpha_image), source, output, options)


def layout(img_rgb, region, font_dir, render_config) -> list:
    from .skia.skia_adapter import layout_candidates

    return layout_candidates(img_rgb, region, font_dir, render_config)


def upstream_dir() -> str:
    import manga_translator

    return os.path.dirname(os.path.dirname(manga_translator.__file__))


def start(count: int) -> ProcessPoolExecutor:
    global executor

    if executor is None:
        executor = ProcessPoolExecutor(max_workers=count, initializer=start_child, initargs=(upstream_dir(),))

    return executor


def submit(function, *args) -> Future:
    global executor

    try:
        return start(default_count()).submit(function, *args)
    except BrokenProcessPool:
        # A child died; a fresh pool keeps upstream from silently falling back to simple reading order.
        executor = None

        return start(default_count()).submit(function, *args)


async def call(function, *args):
    return await asyncio.wrap_future(submit(function, *args))


def default_count() -> int:
    return max(2, min(4, (os.cpu_count() or 4) // 2))


def get_panels_from_array(img_rgb: np.ndarray, rtl: bool = True) -> list:
    early = prefetched.get()

    if early is not None and early[2] is not None and early[0] is img_rgb and early[1] == rtl:
        return early[2].result()

    return submit(find_panels, img_rgb, rtl).result()


def stop() -> None:
    global executor

    if executor is not None:
        executor.shutdown(cancel_futures=True)
        executor = None
