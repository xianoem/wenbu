import json
import os
import re
import shutil
from pathlib import Path
from typing import Iterable, Optional

FONT_EXTENSIONS = {".ttf", ".otf", ".ttc"}

STYLE_FILES = {"regular": "Regular", "bold": "Bold", "italic": "Italic", "bold_italic": "BoldItalic"}


def system_font_dirs() -> list[Path]:
    dirs = [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"]
    local = os.environ.get("LOCALAPPDATA")

    if local:
        dirs.append(Path(local) / "Microsoft" / "Windows" / "Fonts")

    return [folder for folder in dirs if folder.is_dir()]


def style_of(subfamily: str) -> Optional[str]:
    lower = subfamily.lower()
    bold = "bold" in lower
    italic = "italic" in lower or "oblique" in lower

    if bold and italic:
        return "bold_italic"

    if bold:
        return "bold"

    if italic:
        return "italic"

    if lower in ("regular", "normal", "roman", "book", "medium", ""):
        return "regular"

    return None


def faces_of(file: Path) -> Iterable[tuple[int, list[str], str]]:
    from fontTools.ttLib import TTCollection, TTFont

    if file.suffix.lower() == ".ttc":
        count = len(TTCollection(str(file), lazy=True).fonts)
        fonts = ((index, TTFont(str(file), fontNumber=index, lazy=True)) for index in range(count))
    else:
        fonts = ((0, TTFont(str(file), lazy=True)),)

    for index, font in fonts:
        names = font["name"]
        families = [name for name in (names.getDebugName(16), names.getDebugName(1)) if name]
        subfamily = names.getDebugName(17) or names.getDebugName(2) or ""
        font.close()

        yield index, families, subfamily


def indexed(folders: list[Path], cache: Path) -> list[dict]:
    index_file = cache / "index-v2.json"

    try:
        known = json.loads(index_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        known = {}

    faces = []
    fresh = {}

    for folder in folders:
        for file in sorted(folder.iterdir()):
            if file.suffix.lower() not in FONT_EXTENSIONS:
                continue

            stat = file.stat()
            key = str(file)
            stamp = f"{stat.st_size}:{int(stat.st_mtime)}"
            entry = known.get(key)

            if entry is None or entry["stamp"] != stamp:
                try:
                    entry = {"stamp": stamp, "faces": [list(face) for face in faces_of(file)]}
                except Exception:
                    entry = {"stamp": stamp, "faces": []}

            fresh[key] = entry
            faces.extend(
                {"file": key, "index": index, "families": families, "subfamily": subfamily}
                for index, families, subfamily in entry["faces"]
            )

    cache.mkdir(parents=True, exist_ok=True)
    index_file.write_text(json.dumps(fresh), encoding="utf-8")

    return faces


def resolve(family: str, cache: str, folders: Optional[list[Path]] = None) -> str:
    cache_dir = Path(cache)
    wanted = family.strip().casefold()
    styles: dict[str, dict] = {}

    for face in indexed(folders if folders is not None else system_font_dirs(), cache_dir):
        if wanted not in (name.strip().casefold() for name in face["families"]):
            continue

        style = style_of(face["subfamily"])

        if style is not None and style not in styles:
            styles[style] = face

    if not styles:
        raise FileNotFoundError(f"The font “{family}” is not installed. Choose another in Settings › Translation › Manga.")

    if "regular" not in styles:
        styles["regular"] = next(iter(styles.values()))

    target = cache_dir / re.sub(r"[^\w.-]+", "_", family.strip())
    target.mkdir(parents=True, exist_ok=True)

    for style, face in styles.items():
        source = Path(face["file"])
        destination = target / f"{STYLE_FILES[style]}{'.otf' if source.suffix.lower() == '.otf' else '.ttf'}"

        if destination.exists() and destination.stat().st_mtime >= source.stat().st_mtime:
            continue

        if source.suffix.lower() == ".ttc":
            from fontTools.ttLib import TTFont

            font = TTFont(str(source), fontNumber=face["index"])
            font.save(str(destination))
            font.close()
        else:
            shutil.copyfile(source, destination)

    return str(target)
