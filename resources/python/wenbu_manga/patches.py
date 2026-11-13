import contextvars
import functools

import torch
from PIL import Image, ImageFile

import manga_translator.manga_translator as upstream_translator
import manga_translator.utils.textblock as upstream_textblock
from manga_translator.utils.panel.lib.page import Page

from . import workers

merge_results: contextvars.ContextVar[dict | None] = contextvars.ContextVar("merge_results", default=None)


def merge_once(original):
    @functools.wraps(original)
    async def dispatch(textlines, width, height, *args, **kwargs):
        cache = merge_results.get()

        if cache is None:
            return await original(textlines, width, height, *args, **kwargs)

        key = (id(textlines), width, height)

        if key not in cache:
            cache[key] = await original(textlines, width, height, *args, **kwargs)

        return cache[key]

    return dispatch


def apply() -> None:
    if getattr(apply, "done", False):
        return

    Image.MAX_IMAGE_PIXELS = None
    ImageFile.LOAD_TRUNCATED_IMAGES = True

    # Each call costs about 0.2 s on Windows, and upstream asks several times per page.
    torch.cuda.is_available = functools.cache(torch.cuda.is_available)

    workers.tolerate_missing_panels(Page)
    upstream_translator.dispatch_textline_merge = merge_once(upstream_translator.dispatch_textline_merge)
    upstream_textblock.get_panels_from_array = workers.get_panels_from_array
    apply.done = True
