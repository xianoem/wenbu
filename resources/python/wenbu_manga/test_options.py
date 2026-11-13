import pytest

from .options import RunOptions
from .save import output_name
from .upstream import is_stubbed

BASE = {"font_dir": "fonts", "model_dir": "models"}


def test_defaults_match_the_old_pipeline_except_for_region_inpainting():
    options = RunOptions.parse(BASE)

    assert (options.detection_size, options.inpainting_size, options.supersampling) == (2048, 2048, 4)
    assert (options.min_font_size, options.max_font_size) == (12, 100)
    assert options.inpainting == "regions"


@pytest.mark.parametrize(
    "change",
    [{"inpainting": "magic"}, {"text_color": "#000000"}, {"border_color": "white"}, {"supersampling": 8}, {"min_font_size": 50, "max_font_size": 20}, {"pages_ahead": 0}, {"detection_size": True}, {"colour": "red"}],
)
def test_bad_options_are_refused(change):
    with pytest.raises(ValueError):
        RunOptions.parse({**BASE, **change})


def test_output_names_follow_the_chosen_format():
    assert output_name("C:/in/page 01.jpg", RunOptions.parse(BASE)) == "page 01.png"
    assert output_name("C:/in/page.webp", RunOptions.parse({**BASE, "output_format": "source"})) == "page.webp"
    assert output_name("C:/in/page.bmp", RunOptions.parse({**BASE, "output_format": "source"})) == "page.png"
    assert output_name("C:/in/page.png", RunOptions.parse({**BASE, "output_format": "jpeg"})) == "page.jpg"


def test_only_unused_upstream_modules_are_stubbed():
    assert is_stubbed("manga_translator.translators.deepl")
    assert is_stubbed("manga_translator.detection.ctd")
    assert not is_stubbed("manga_translator.detection.default")
    assert not is_stubbed("manga_translator.inpainting.inpainting_lama_mpe")
    assert not is_stubbed("manga_translator.utils.textblock")
    assert not is_stubbed("manga_translator.translators")
