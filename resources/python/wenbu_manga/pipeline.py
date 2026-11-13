import asyncio
import gc
import os
import shutil
import time
from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

import cv2
import numpy as np
import torch
from PIL import Image

from manga_translator.inpainting import dispatch as dispatch_inpainting
from manga_translator.mode.local import MangaTranslatorLocal
from manga_translator.utils import Context, TextBlock, load_image

from . import patches, workers
from .config import WenbuConfig, build_config
from .editor import blend_patch, clean_plan, parse_blocks, settle_paper, text_area
from .errors import describe
from .inpainting import inpaint_regions
from .jobs import PageJob
from .options import RunOptions
from .save import save_page

Translate = Callable[[int, list[str]], Awaitable[list[str]]]
Report = Callable[[dict[str, Any]], None]

GC_EVERY = 5

FINISHING = 2


@dataclass
class Page:
    index: int
    job: PageJob
    image: Optional[Image.Image] = None
    ctx: Optional[Context] = None
    panels: Optional[Future] = None
    texts: list[str] = field(default_factory=list)


def run_sync(coroutine_function, *args):
    """Upstream's steps are async functions that block, so each runs on a worker thread's own loop."""

    loop = asyncio.new_event_loop()

    try:
        return loop.run_until_complete(coroutine_function(*args))
    finally:
        loop.close()


class Pipeline(MangaTranslatorLocal):
    def __init__(self, options: RunOptions):
        patches.apply()
        super().__init__(
            {
                "use_gpu": options.use_gpu,
                "model_dir": options.model_dir,
                "font_path": options.font_dir,
                "kernel_size": 3,
                "ignore_errors": False,
                "models_ttl": 0,
                "verbose": False,
                "input": [],
            }
        )
        self.options = options
        self.config = build_config(options)
        self.gpu = asyncio.Semaphore(1)
        self.pages_since_gc = 0

    def _setup_log_file(self) -> None:
        self._log_file_path = None

    def reconfigure(self, options: RunOptions) -> None:
        self.options = options
        self.config = build_config(options)
        self.font_path = options.font_dir

    async def load_models(self) -> None:
        from manga_translator.detection import prepare as prepare_detection
        from manga_translator.inpainting import prepare as prepare_inpainting
        from manga_translator.ocr import prepare as prepare_ocr

        await prepare_detection(self.config.detector.detector)
        await prepare_ocr(self.config.ocr.ocr, self.device)
        await prepare_inpainting(self.config.inpainter.inpainter, self.device)

    async def _run_textline_merge(self, config: WenbuConfig, ctx: Context):
        token = patches.merge_results.set({})

        try:
            return await super()._run_textline_merge(config, ctx)
        finally:
            patches.merge_results.reset(token)

    def merge(self, page: Page):
        token = workers.prefetched.set((page.ctx.img_rgb, self.config.render.rtl, page.panels))

        try:
            return run_sync(self._run_textline_merge, self.config, page.ctx)
        finally:
            workers.prefetched.reset(token)

    async def _run_inpainting(self, config: WenbuConfig, ctx: Context):
        inpaint = lambda image, mask: dispatch_inpainting(
            config.inpainter.inpainter, image, mask, config.inpainter, config.inpainter.inpainting_size, self.device, False
        )

        if self.options.inpainting == "page":
            return await inpaint(ctx.img_rgb, ctx.mask)

        return await inpaint_regions(ctx.img_rgb, ctx.mask, inpaint)

    async def refine_mask(self, ctx: Context):
        config = self.config

        return await workers.call(
            workers.refine_mask, ctx.text_regions, ctx.img_rgb, ctx.mask_raw, config.mask_dilation_offset, config.ocr.ignore_bubble, self.kernel_size
        )

    async def letter(self, page: Page) -> None:
        ctx = page.ctx
        alpha = None if ctx.img_alpha is None else np.asarray(ctx.img_alpha)
        base = None if alpha is None else np.asarray(ctx.input.convert("RGBA"))

        await workers.call(
            workers.letter,
            ctx.img_inpainted,
            ctx.img_rgb,
            ctx.mask,
            ctx.text_regions,
            self.config.render,
            self.font_path,
            alpha,
            base,
            page.job.source,
            page.job.output,
            self.options,
        )

    async def on_gpu(self, step, ctx: Context):
        async with self.gpu:
            return await asyncio.to_thread(run_sync, step, self.config, ctx)

    async def read(self, page: Page) -> None:
        def load():
            image = Image.open(page.job.source)
            image.load()

            return image

        page.image = await asyncio.to_thread(load)
        ctx = Context()
        ctx.input = page.image
        ctx.result = None
        ctx.img_colorized = page.image
        ctx.upscaled = page.image
        ctx.img_rgb, ctx.img_alpha = await asyncio.to_thread(load_image, page.image)
        page.ctx = ctx

        if not self.config.force_simple_sort:
            page.panels = workers.submit(workers.find_panels, ctx.img_rgb, self.config.render.rtl)

    async def find_text(self, page: Page, report: Report) -> None:
        ctx = page.ctx
        report({"event": "stage", "page": page.index, "stage": "detecting"})
        ctx.textlines, ctx.mask_raw, ctx.mask = await self.on_gpu(self._run_detection, ctx)

        if not ctx.textlines:
            ctx.text_regions = []
            return

        report({"event": "stage", "page": page.index, "stage": "reading"})
        ctx.textlines = await self.on_gpu(self._run_ocr, ctx)

        if not ctx.textlines:
            ctx.text_regions = []
            return

        ctx.text_regions = await asyncio.to_thread(self.merge, page)
        page.texts = [region.text for region in ctx.text_regions]

    async def finish(self, page: Page, translations: list[str], report: Report) -> None:
        ctx = page.ctx
        config = self.config

        for region, translation in zip(ctx.text_regions, translations):
            region.translation = translation
            region.target_lang = config.translator.target_lang
            region._alignment = config.render.alignment
            region._direction = config.render.direction

        if ctx.mask is None:
            ctx.mask = await self.refine_mask(ctx)

        report({"event": "stage", "page": page.index, "stage": "cleaning"})
        ctx.img_inpainted = await self.on_gpu(self._run_inpainting, ctx)
        report({"event": "stage", "page": page.index, "stage": "lettering"})
        await self.letter(page)

    async def keep_original(self, page: Page) -> None:
        source, output = page.job.source, page.job.output

        os.makedirs(os.path.dirname(output), exist_ok=True)

        if os.path.splitext(source)[1].lower() == os.path.splitext(output)[1].lower():
            await asyncio.to_thread(shutil.copyfile, source, output)
            return

        await asyncio.to_thread(save_page, page.image, source, output, self.options)

    def release(self, page: Page) -> None:
        if page.image is not None:
            page.image.close()

        if page.panels is not None:
            page.panels.cancel()

        page.image = None
        page.ctx = None
        page.panels = None
        self.pages_since_gc += 1

        if self.pages_since_gc >= GC_EVERY:
            self.pages_since_gc = 0
            gc.collect()

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    async def scan_page(self, message: dict[str, Any]) -> dict[str, Any]:
        source, mask_path = text_field(message, "source"), text_field(message, "mask")
        page = Page(0, PageJob(source, ""))

        try:
            await self.read(page)
            await self.find_text(page, lambda event: None)
            ctx = page.ctx
            height, width = ctx.img_rgb.shape[:2]

            if not ctx.text_regions:
                await asyncio.to_thread(save_mask, np.zeros((height, width), dtype=np.uint8), mask_path)

                return {"width": width, "height": height, "blocks": []}

            if ctx.mask is None:
                ctx.mask = await self.refine_mask(ctx)

            await asyncio.to_thread(save_mask, ctx.mask, mask_path)

            blocks = [scanned_block(region, ctx.img_rgb) for region in ctx.text_regions]

            return {"width": width, "height": height, "blocks": blocks}
        finally:
            self.release(page)

    async def clean_page(self, message: dict[str, Any]) -> dict[str, Any]:
        source, output = text_field(message, "source"), text_field(message, "output")
        mask_path = message.get("mask") if isinstance(message.get("mask"), str) else ""
        brush_path = message.get("brush") if isinstance(message.get("brush"), str) else ""
        blocks = parse_blocks(message.get("blocks"))
        img_rgb, _ = await asyncio.to_thread(open_rgb, source)
        scan = await asyncio.to_thread(open_mask, mask_path, img_rgb.shape)
        brush = await asyncio.to_thread(open_brush, brush_path, img_rgb.shape)
        filled, mask = await asyncio.to_thread(clean_plan, img_rgb, scan, blocks, brush)

        if not mask.any():
            await asyncio.to_thread(save_png, filled, output)

            return {}

        ctx = Context()
        ctx.img_rgb = filled
        ctx.mask = mask
        cleaned = await self.on_gpu(self._run_inpainting, ctx)
        cleaned = await asyncio.to_thread(settle_paper, cleaned, img_rgb, blocks, mask)

        if brush is not None:
            stroke = np.where(brush[..., 0] >= 127, 255, 0).astype(np.uint8)
            cleaned = await asyncio.to_thread(blend_patch, img_rgb, cleaned, stroke)

        await asyncio.to_thread(save_png, cleaned, output)

        return {}

    async def render_page(self, message: dict[str, Any]) -> dict[str, Any]:
        source, output = text_field(message, "source"), text_field(message, "output")
        cleaned_path = message.get("cleaned") if isinstance(message.get("cleaned"), str) else ""
        blocks = [block for block in parse_blocks(message.get("blocks")) if str(block.get("translation", "")).strip()]
        original = await asyncio.to_thread(open_image, source)

        try:
            img_rgb, alpha = await asyncio.to_thread(load_image, original)
            base_rgb = img_rgb

            if cleaned_path and os.path.exists(cleaned_path):
                base_rgb, _ = await asyncio.to_thread(open_rgb, cleaned_path)

            regions = [self.region_of(block, img_rgb) for block in blocks]
            alpha_array = None if alpha is None else np.asarray(alpha)
            base = None if alpha is None else np.asarray(original.convert("RGBA"))

            await workers.call(
                workers.letter,
                base_rgb,
                img_rgb,
                None,
                regions,
                self.config.render,
                self.font_path,
                alpha_array,
                base,
                source,
                output,
                self.options,
            )
        finally:
            original.close()

        return {}

    def region_of(self, block: dict[str, Any], rgb: np.ndarray) -> TextBlock:
        x1, y1, x2, y2 = (int(round(edge)) for edge in block["box"])
        region = TextBlock(
            [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]],
            texts=[str(block.get("text") or " ")],
            font_size=float(block.get("fontSize") or -1),
            fg_color=tuple(block.get("fg") or (0, 0, 0)),
            bg_color=tuple(block.get("bg") or (255, 255, 255)),
            translation=str(block["translation"]),
            target_lang=self.config.translator.target_lang,
        )
        region._alignment = self.config.render.alignment
        region._direction = self.config.render.direction
        lettering = dict(block.get("lettering") or {})

        if lettering.get("fontFamily"):
            from .fonts import resolve

            lettering["fontDir"] = resolve(str(lettering["fontFamily"]), self.options.font_cache)

        if "textBox" not in lettering:
            area = text_area(rgb, block["box"])

            if area is not None:
                lettering["textBox"] = area

        region.wenbu = lettering

        return region

    async def breaks_page(self, message: dict[str, Any]) -> dict[str, Any]:
        source = text_field(message, "source")
        [block] = parse_blocks(message.get("blocks"))
        img_rgb, _ = await asyncio.to_thread(open_rgb, source)
        candidates = await workers.call(workers.layout, img_rgb, self.region_of(block, img_rgb), self.font_path, self.config.render)

        return {"candidates": candidates}

    async def run(self, jobs: list[PageJob], translate: Translate, report: Report) -> dict[str, int]:
        started = time.perf_counter()
        in_flight = asyncio.Semaphore(self.options.pages_ahead)
        requests = asyncio.Semaphore(self.options.translation_requests)
        ready: asyncio.Queue = asyncio.Queue()
        counts = {"done": 0, "failed": 0}
        tasks: set[asyncio.Task] = set()

        def failed(page: Page, error: BaseException) -> None:
            counts["failed"] += 1
            report({"event": "page-failed", "page": page.index, "message": describe(error)})

        async def translated(page: Page) -> None:
            try:
                report({"event": "stage", "page": page.index, "stage": "translating"})

                async with requests:
                    translations = await translate(page.index, page.texts)

                if len(translations) != len(page.texts):
                    raise ValueError(f"Expected {len(page.texts)} translations, got {len(translations)}.")

                await ready.put((page, translations))
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failed(page, error)
                await ready.put((page, None))

        async def produce() -> None:
            for index, job in enumerate(jobs):
                await in_flight.acquire()
                page = Page(index, job)
                report({"event": "page-started", "page": index, "source": job.source})

                try:
                    await self.read(page)
                    await self.find_text(page, report)
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    failed(page, error)
                    await ready.put((page, None))
                    continue

                if not page.texts:
                    await ready.put((page, []))
                    continue

                task = asyncio.create_task(translated(page))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

        remaining = len(jobs)

        async def consume() -> None:
            nonlocal remaining

            while remaining > 0:
                remaining -= 1
                page, translations = await ready.get()

                try:
                    if translations is None:
                        continue

                    if translations:
                        await self.finish(page, translations, report)
                    else:
                        await self.keep_original(page)

                    counts["done"] += 1
                    report({"event": "page-done", "page": page.index, "output": page.job.output, "regions": len(translations)})
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    failed(page, error)
                finally:
                    self.release(page)
                    in_flight.release()

        try:
            await asyncio.gather(produce(), *(consume() for _ in range(FINISHING)))
        finally:
            for task in tasks:
                task.cancel()

        return {**counts, "seconds": round(time.perf_counter() - started, 3)}



def text_field(message: dict[str, Any], name: str) -> str:
    value = message.get(name)

    if not isinstance(value, str) or value == "":
        raise ValueError(f"The editor operation needs a {name} path.")

    return value


def open_image(path: str) -> Image.Image:
    image = Image.open(path)
    image.load()

    return image


def open_rgb(path: str):
    image = open_image(path)

    try:
        return load_image(image)
    finally:
        image.close()


def open_mask(path: str, shape) -> np.ndarray:
    if not path or not os.path.exists(path):
        return np.zeros(shape[:2], dtype=np.uint8)

    with Image.open(path) as image:
        mask = np.asarray(image.convert("L"))

    return mask if mask.shape == shape[:2] else cv2.resize(mask, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)


def open_brush(path: str, shape) -> Optional[np.ndarray]:
    if not path or not os.path.exists(path):
        return None

    with Image.open(path) as image:
        brush = np.asarray(image.convert("RGB"))

    return brush if brush.shape[:2] == shape[:2] else cv2.resize(brush, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)


def save_mask(mask: np.ndarray, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    partial = path + ".partial"
    Image.fromarray(mask.astype(np.uint8)).save(partial, format="PNG", compress_level=1)
    os.replace(partial, path)


def save_png(rgb: np.ndarray, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    partial = path + ".partial"
    Image.fromarray(rgb).save(partial, format="PNG", compress_level=1)
    os.replace(partial, path)


def scanned_block(region, rgb: np.ndarray) -> dict[str, Any]:
    fg, bg = region.get_font_colors()
    box = [int(edge) for edge in region.xyxy]

    return {
        "box": box,
        "area": text_area(rgb, box),
        "text": region.text,
        "fg": [int(channel) for channel in fg],
        "bg": [int(channel) for channel in bg],
        "fontSize": int(region.font_size),
        "vertical": bool(region.vertical),
    }
