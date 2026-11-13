from dataclasses import dataclass


@dataclass(frozen=True)
class PageJob:
    source: str
    output: str
