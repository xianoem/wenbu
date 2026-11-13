import asyncio
import dataclasses
import importlib
import json
import os
import sys
import threading
import traceback
from typing import Any, Optional

from .errors import describe
from .jobs import PageJob
from .options import RunOptions

PROTOCOL_VERSION = 2

EDITOR_OPERATIONS = {"scan": "scan_page", "clean": "clean_page", "render": "render_page", "breaks": "breaks_page"}


class Channel:
    def __init__(self, stream):
        self.stream = stream
        self.lock = threading.Lock()

    def send(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, ensure_ascii=False) + "\n"

        with self.lock:
            self.stream.write(line)
            self.stream.flush()


def claim_stdio():
    """fd 1 goes to stderr because upstream prints to stdout; fd 0 goes to NUL because a blocked stdin read stalls native libraries loading on Windows."""

    sys.stdout.flush()
    incoming = os.fdopen(os.dup(0), "r", encoding="utf-8", newline="\n")
    outgoing = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    null = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null, 0)
    os.close(null)
    os.dup2(sys.stderr.fileno(), 1)
    sys.stdin = open(os.devnull, encoding="utf-8")
    sys.stdout = sys.stderr

    return incoming, outgoing


class Worker:
    def __init__(self, channel: Channel, incoming=None):
        self.channel = channel
        self.incoming = incoming
        self.pipeline = None
        self.run_id: Optional[str] = None
        self.run_task: Optional[asyncio.Task] = None
        self.pending: dict[int, asyncio.Future] = {}
        self.next_request = 0
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.editor_tasks: set[asyncio.Task] = set()

    def send(self, event: dict[str, Any]) -> None:
        self.channel.send(event)

    async def serve(self) -> None:
        self.loop = asyncio.get_running_loop()
        lines: asyncio.Queue = asyncio.Queue()
        threading.Thread(target=self.read_stdin, args=(lines,), daemon=True).start()
        self.send({"event": "ready", "protocol": PROTOCOL_VERSION})

        while True:
            line = await lines.get()

            if line is None:
                break

            try:
                message = json.loads(line)

                if not isinstance(message, dict):
                    raise ValueError("Messages must be JSON objects.")

                await self.handle(message)
            except Exception as error:
                self.send({"event": "error", "message": f"Wenbu sent a message the worker could not read: {error}"})

        if self.run_task is not None:
            self.run_task.cancel()

    def read_stdin(self, lines: asyncio.Queue) -> None:
        for line in self.incoming:
            if line.strip():
                self.loop.call_soon_threadsafe(lines.put_nowait, line)

        self.loop.call_soon_threadsafe(lines.put_nowait, None)

    async def handle(self, message: dict[str, Any]) -> None:
        kind = message.get("type")

        if kind == "run":
            self.start_run(message)
        elif kind == "translated":
            self.answer(message)
        elif kind == "editor":
            task = asyncio.create_task(self.editor(message))
            self.editor_tasks.add(task)
            task.add_done_callback(self.editor_tasks.discard)
        elif kind == "cancel":
            if self.run_task is not None and message.get("run") == self.run_id:
                self.run_task.cancel()
        else:
            raise ValueError(f"Unknown message type {kind!r}.")

    def start_run(self, message: dict[str, Any]) -> None:
        run_id = str(message.get("run", ""))

        if self.run_task is not None and not self.run_task.done():
            self.send({"event": "run-failed", "run": run_id, "message": "Another run is still going."})
            return

        self.run_id = run_id
        self.run_task = asyncio.create_task(self.run(run_id, message))

    async def run(self, run_id: str, message: dict[str, Any]) -> None:
        try:
            options = RunOptions.parse(message.get("options"))
            jobs = parse_pages(message.get("pages"))
        except (TypeError, ValueError) as error:
            self.send({"event": "run-failed", "run": run_id, "message": str(error)})
            return

        def report(event: dict[str, Any]) -> None:
            self.send({**event, "run": run_id})

        try:
            pipeline = await self.prepare(await with_font(options), run_id)
            result = await pipeline.run(jobs, lambda page, texts: self.translate(run_id, page, texts), report)
            self.send({"event": "run-done", "run": run_id, "cancelled": False, **result})
        except asyncio.CancelledError:
            self.fail_pending("The run was cancelled.")
            self.send({"event": "run-done", "run": run_id, "cancelled": True})
        except Exception as error:
            self.fail_pending("The run failed.")
            self.send({"event": "run-failed", "run": run_id, "message": describe(error)})

    async def editor(self, message: dict[str, Any]) -> None:
        request = message.get("id")

        try:
            method = EDITOR_OPERATIONS.get(message.get("op"))

            if method is None:
                raise ValueError(f"Unknown editor operation {message.get('op')!r}.")

            options = await with_font(RunOptions.parse(message.get("options")))
            pipeline = await self.prepare(options, f"editor-{request}")
            result = await getattr(pipeline, method)(message)
            self.send({"event": "editor-done", "id": request, "result": result})
        except asyncio.CancelledError:
            raise
        except Exception as error:
            traceback.print_exc()
            self.send({"event": "editor-failed", "id": request, "message": describe(error)})

    async def prepare(self, options, run_id: str):
        from .pipeline import Pipeline

        current = self.pipeline

        if current is not None and current.options.use_gpu == options.use_gpu and current.options.model_dir == options.model_dir:
            current.reconfigure(options)
            return current

        self.send({"event": "loading-models", "run": run_id})
        pipeline = Pipeline(options)
        await pipeline.load_models()
        self.pipeline = pipeline
        self.send({"event": "models-loaded", "run": run_id, "device": pipeline.device})

        return pipeline

    async def translate(self, run_id: str, page: int, texts: list[str]) -> list[str]:
        self.next_request += 1
        request = self.next_request
        future = self.loop.create_future()
        self.pending[request] = future
        self.send({"event": "translate", "run": run_id, "id": request, "page": page, "texts": texts})

        try:
            return await future
        finally:
            self.pending.pop(request, None)

    def answer(self, message: dict[str, Any]) -> None:
        future = self.pending.get(message.get("id"))

        if future is None or future.done():
            return

        if message.get("error"):
            future.set_exception(TranslationFailed(str(message["error"])))
            return

        translations = message.get("translations")

        if not isinstance(translations, list) or not all(isinstance(text, str) for text in translations):
            future.set_exception(TranslationFailed("Wenbu sent translations that are not a list of strings."))
            return

        future.set_result(translations)

    def fail_pending(self, reason: str) -> None:
        for future in self.pending.values():
            if not future.done():
                future.set_exception(TranslationFailed(reason))


async def with_font(options: RunOptions) -> RunOptions:
    if not options.font_family:
        return options

    from .fonts import resolve

    font_dir = await asyncio.to_thread(resolve, options.font_family, options.font_cache)

    return dataclasses.replace(options, font_dir=font_dir)


class TranslationFailed(Exception):
    pass


def parse_pages(pages: Any) -> list[PageJob]:
    if not isinstance(pages, list) or not all(
        isinstance(page, dict) and isinstance(page.get("source"), str) and isinstance(page.get("output"), str) for page in pages
    ):
        raise ValueError("Pages must be a list of objects with a source and an output path.")

    return [PageJob(page["source"], page["output"]) for page in pages]


def main() -> int:
    incoming, outgoing = claim_stdio()

    from . import upstream

    upstream.install()

    # Loaded before ``ready`` so the first run doesn't wait for torch, scipy and upstream.
    importlib.import_module(".pipeline", __package__)

    from . import workers

    try:
        asyncio.run(Worker(Channel(outgoing), incoming).serve())
    finally:
        workers.stop()

    return 0


if __name__ == "__main__":
    sys.exit(main())
