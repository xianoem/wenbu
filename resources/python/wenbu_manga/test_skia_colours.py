import asyncio
import os

import numpy as np
import pytest

# Lettering needs skia-python, HarfBuzz and upstream, which only the plugin's environment has.
pytest.importorskip("skia")
pytest.importorskip("uharfbuzz")
pytest.importorskip("torch")

from . import upstream  # noqa: E402

upstream.install()

from manga_translator.utils import TextBlock  # noqa: E402

from .config import build_config  # noqa: E402
from .options import RunOptions  # noqa: E402
from .skia import dispatch_skia  # noqa: E402

FONTS = os.path.join(os.path.dirname(__file__), "..", "..", "fonts", "Comic Shanns")


def lettered(fg: tuple[int, int, int], border_color: str) -> np.ndarray:
    page = np.full((200, 320, 3), 255, np.uint8)
    config = build_config(RunOptions(font_dir=FONTS, model_dir="", border_color=border_color))
    region = TextBlock(
        [[[20, 20], [300, 20], [300, 180], [20, 180]]],
        texts=["テキスト"],
        font_size=-1,
        fg_color=fg,
        bg_color=(255, 255, 255),
        translation="COLOUR TEST",
        target_lang="ENG",
    )
    region._alignment = config.render.alignment
    region._direction = config.render.direction
    region.wenbu = {}

    return asyncio.run(dispatch_skia(page, page, [region], FONTS, None, config.render))


def test_text_is_drawn_in_the_block_colour():
    rendered = lettered((220, 20, 20), "FFFFFF").reshape(-1, 3).astype(int)
    darkest = rendered[np.argmin(rendered.sum(axis=1))]

    assert darkest[0] > 150
    assert darkest[2] < 80


def test_border_is_drawn_in_the_border_colour():
    rendered = lettered((255, 255, 255), "0000FF").reshape(-1, 3).astype(int)
    coloured = rendered[rendered.sum(axis=1) < 600]

    assert len(coloured) > 0
    assert coloured[:, 2].mean() > coloured[:, 0].mean() + 100
