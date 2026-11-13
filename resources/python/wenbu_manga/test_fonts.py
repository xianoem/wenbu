import os
from pathlib import Path

import pytest

from .fonts import resolve, style_of

BUNDLED = Path(__file__).resolve().parents[2] / "fonts"


def test_styles_come_from_the_subfamily_name():
    assert style_of("Regular") == "regular"
    assert style_of("Bold Italic") == "bold_italic"
    assert style_of("Oblique") == "italic"
    assert style_of("Condensed Light") is None


def test_a_family_is_laid_out_in_a_folder_of_its_own(tmp_path):
    folder = resolve("comic shanns", str(tmp_path / "cache"), [BUNDLED / "Anime Ace", BUNDLED / "Comic Shanns"])

    assert sorted(os.listdir(folder)) == ["Regular.ttf"]
    assert (Path(folder) / "Regular.ttf").read_bytes() == (BUNDLED / "Comic Shanns" / "comic shanns 2.ttf").read_bytes()


def test_the_index_is_reused(tmp_path):
    cache = tmp_path / "cache"
    resolve("Comic Shanns", str(cache), [BUNDLED / "Comic Shanns"])

    assert (cache / "index-v2.json").exists()
    assert resolve("Comic Shanns", str(cache), [BUNDLED / "Comic Shanns"])


def test_a_missing_family_says_so(tmp_path):
    with pytest.raises(FileNotFoundError, match="not installed"):
        resolve("No Such Font", str(tmp_path), [BUNDLED / "Anime Ace"])
