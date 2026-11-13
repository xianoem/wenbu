import importlib.abc
import importlib.machinery
import sys
import types

USED = {
    "colorization": {"common"},
    "detection": {"common", "default", "default_utils", "none"},
    "inpainting": {"common", "inpainting_lama_mpe", "none"},
    "ocr": {"common", "model_48px", "xpos_relative_position"},
    "rendering": {"ballon_extractor"},
    "translators": {"common", "none", "original", "keys"},
    "upscaling": {"common"},
}


CALLED_ON_IMPORT = {
    "manga_translator.translators.selective": {"prepare": lambda *args, **kwargs: None},
}


class Unavailable:
    def __init__(self, *args, **kwargs):
        raise RuntimeError(f"{type(self).__module__}.{type(self).__name__} is not installed with Wenbu.")


class StubModule(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)

        placeholder = type(name, (Unavailable,), {"__module__": self.__name__})

        setattr(self, name, placeholder)

        return placeholder


class StubLoader(importlib.abc.Loader):
    def create_module(self, spec):
        return StubModule(spec.name)

    def exec_module(self, module):
        module.__path__ = []
        module.__dict__.update(CALLED_ON_IMPORT.get(module.__name__, {}))


class StubFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if not is_stubbed(fullname):
            return None

        return importlib.machinery.ModuleSpec(fullname, StubLoader(), is_package=True)


def is_stubbed(fullname: str) -> bool:
    parts = fullname.split(".")

    if len(parts) < 3 or parts[0] != "manga_translator" or parts[1] not in USED:
        return False

    return parts[2] not in USED[parts[1]]


def install() -> None:
    if not any(isinstance(finder, StubFinder) for finder in sys.meta_path):
        sys.meta_path.insert(0, StubFinder())
