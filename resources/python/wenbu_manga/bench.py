import argparse
import asyncio
import json
import os
import sys
import time
from collections import defaultdict

from .options import RunOptions
from .save import output_name

STEPS = {
    "_run_detection": "detection",
    "_run_ocr": "ocr",
    "merge": "textline_merge",
    "refine_mask": "mask_refinement",
    "_run_inpainting": "inpainting",
    "letter": "lettering",
}


def placeholder(index: int) -> str:
    return f"Line {index + 1}. This is placeholder text for testing."


def timed(pipeline, timings: dict) -> None:
    for name, label in STEPS.items():
        original = getattr(pipeline, name)

        if asyncio.iscoroutinefunction(original):

            async def step(*args, _original=original, _label=label, **kwargs):
                start = time.perf_counter()

                try:
                    return await _original(*args, **kwargs)
                finally:
                    timings[_label].append(round(time.perf_counter() - start, 3))

        else:

            def step(*args, _original=original, _label=label, **kwargs):
                start = time.perf_counter()

                try:
                    return _original(*args, **kwargs)
                finally:
                    timings[_label].append(round(time.perf_counter() - start, 3))

        setattr(pipeline, name, step)


async def run(pages: str, output: str, options: RunOptions, llm_delay: float) -> None:
    from . import upstream

    upstream.install()

    from .jobs import PageJob
    from .pipeline import Pipeline

    pipeline = Pipeline(options)
    timings: dict = defaultdict(list)
    timed(pipeline, timings)
    await pipeline.load_models()
    names = sorted(name for name in os.listdir(pages) if name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
    jobs = [PageJob(os.path.join(pages, name), os.path.join(output, output_name(name, options))) for name in names]
    regions: dict = {}

    async def translate(index: int, texts: list[str]) -> list[str]:
        regions[names[index]] = texts
        await asyncio.sleep(llm_delay)

        return [placeholder(i) for i in range(len(texts))]

    def report(event: dict) -> None:
        if event["event"] in ("page-done", "page-failed"):
            print(json.dumps(event, ensure_ascii=False), flush=True)

    result = await pipeline.run(jobs, translate, report)
    print(json.dumps(result), flush=True)

    with open(os.path.join(output, "bench.json"), "w", encoding="utf-8") as file:
        json.dump({"result": result, "timings": timings, "regions": regions}, file, ensure_ascii=False, indent=1)


def compare(reference: str, output: str) -> int:
    import numpy as np
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None

    with open(os.path.join(reference, "golden.json"), encoding="utf-8") as file:
        golden = json.load(file)["pages"]

    with open(os.path.join(output, "bench.json"), encoding="utf-8") as file:
        bench = json.load(file)["regions"]

    worst = 0

    for name, page in golden.items():
        stem = os.path.splitext(name)[0] + ".png"
        expected = [region["text"] for region in page["regions"]]
        order = "same order" if bench.get(name, []) == expected else f"ORDER DIFFERS {bench.get(name)} vs {expected}"
        a = np.asarray(Image.open(os.path.join(reference, stem)).convert("RGB"), dtype=np.int16)
        b = np.asarray(Image.open(os.path.join(output, stem)).convert("RGB"), dtype=np.int16)
        diff = np.abs(a - b).max(axis=2)
        changed = int((diff > 0).sum())
        worst = max(worst, int(diff.max()))
        print(f"{name}: {order}, {changed} pixels differ ({changed / diff.size:.4%}), max {int(diff.max())}")

    return worst


def main() -> int:
    parser = argparse.ArgumentParser(prog="wenbu_manga.bench")
    commands = parser.add_subparsers(dest="command", required=True)
    run_parser = commands.add_parser("run")
    run_parser.add_argument("pages")
    run_parser.add_argument("output")
    run_parser.add_argument("--model-dir", required=True)
    run_parser.add_argument("--font-dir", required=True)
    run_parser.add_argument("--llm-delay", type=float, default=0.0, help="seconds each translation request takes")
    run_parser.add_argument("--set", dest="options", action="append", default=[], help="option=value, parsed as JSON when possible")
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("reference")
    compare_parser.add_argument("output")
    args = parser.parse_args()

    if args.command == "compare":
        compare(args.reference, args.output)
        return 0

    overrides = {}

    for item in args.options:
        key, value = item.split("=", 1)

        try:
            overrides[key] = json.loads(value)
        except json.JSONDecodeError:
            overrides[key] = value

    os.makedirs(args.output, exist_ok=True)
    options = RunOptions.parse({"model_dir": args.model_dir, "font_dir": args.font_dir, **overrides})
    asyncio.run(run(args.pages, args.output, options, args.llm_delay))

    return 0


if __name__ == "__main__":
    sys.exit(main())
