import asyncio

import pytest

from .worker import Worker, parse_pages


class Recorder:
    def __init__(self):
        self.events = []

    def send(self, event):
        self.events.append(event)

    def of(self, name):
        return [event for event in self.events if event["event"] == name]


class FakePipeline:
    def __init__(self, options):
        self.options = options
        self.device = "cpu"

    def reconfigure(self, options):
        self.options = options

    async def run(self, jobs, translate, report):
        done = 0

        for index, job in enumerate(jobs):
            report({"event": "page-started", "page": index, "source": job.source})
            translations = await translate(index, [f"text {index}"])
            report({"event": "page-done", "page": index, "output": job.output, "regions": len(translations)})
            done += 1

        return {"done": done, "failed": 0, "seconds": 0.0}


def worker_with(recorder):
    worker = Worker(recorder)
    worker.loop = asyncio.get_running_loop()

    async def prepare(options, run_id):
        worker.pipeline = worker.pipeline or FakePipeline(options)

        return worker.pipeline

    worker.prepare = prepare

    return worker


OPTIONS = {"font_dir": "fonts", "model_dir": "models"}

PAGES = [{"source": "in/1.jpg", "output": "out/1.png"}, {"source": "in/2.jpg", "output": "out/2.png"}]


async def until(predicate):
    for _ in range(200):
        if predicate():
            return

        await asyncio.sleep(0.01)

    raise AssertionError("timed out")


def test_parse_pages_rejects_missing_paths():
    with pytest.raises(ValueError):
        parse_pages([{"source": "a.jpg"}])


def test_a_run_asks_wenbu_to_translate_each_page_and_reports_the_result():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        await worker.handle({"type": "run", "run": "r1", "options": OPTIONS, "pages": PAGES})

        for page in range(2):
            await until(lambda: len(recorder.of("translate")) > page)
            request = recorder.of("translate")[page]
            assert request["texts"] == [f"text {page}"]
            await worker.handle({"type": "translated", "id": request["id"], "translations": [f"translated {page}"]})

        await until(lambda: recorder.of("run-done"))

        assert recorder.of("run-done")[0] == {"event": "run-done", "run": "r1", "cancelled": False, "done": 2, "failed": 0, "seconds": 0.0}
        assert [event["page"] for event in recorder.of("page-done")] == [0, 1]

    asyncio.run(scenario())


def test_cancel_stops_a_run_that_waits_for_a_translation():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        await worker.handle({"type": "run", "run": "r1", "options": OPTIONS, "pages": PAGES})
        await until(lambda: recorder.of("translate"))
        await worker.handle({"type": "cancel", "run": "r1"})
        await until(lambda: recorder.of("run-done"))

        assert recorder.of("run-done")[0]["cancelled"] is True

    asyncio.run(scenario())


def test_a_translation_error_reaches_the_page():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        worker.pipeline = FakePipeline(OPTIONS)
        failures = []

        async def run(jobs, translate, report):
            try:
                await translate(0, ["text"])
            except Exception as error:
                failures.append(str(error))

            return {"done": 0, "failed": 1, "seconds": 0.0}

        worker.pipeline.run = run
        await worker.handle({"type": "run", "run": "r1", "options": OPTIONS, "pages": PAGES[:1]})
        await until(lambda: recorder.of("translate"))
        await worker.handle({"type": "translated", "id": recorder.of("translate")[0]["id"], "error": "The LLM refused."})
        await until(lambda: recorder.of("run-done"))

        assert failures == ["The LLM refused."]

    asyncio.run(scenario())


def test_bad_options_fail_the_run_without_starting_it():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        await worker.handle({"type": "run", "run": "r1", "options": {**OPTIONS, "inpainting": "magic"}, "pages": PAGES})
        await until(lambda: recorder.of("run-failed"))

        assert "Inpainting" in recorder.of("run-failed")[0]["message"]

    asyncio.run(scenario())


def test_a_second_run_is_refused_while_one_is_going():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        await worker.handle({"type": "run", "run": "r1", "options": OPTIONS, "pages": PAGES})
        await until(lambda: recorder.of("translate"))
        await worker.handle({"type": "run", "run": "r2", "options": OPTIONS, "pages": PAGES})

        assert recorder.of("run-failed")[0]["run"] == "r2"
        await worker.handle({"type": "cancel", "run": "r1"})
        await until(lambda: recorder.of("run-done"))

    asyncio.run(scenario())


class FakeEditorPipeline(FakePipeline):
    async def scan_page(self, message):
        return {"width": 10, "height": 20, "blocks": [{"box": [1, 2, 3, 4], "text": message["source"]}]}

    async def clean_page(self, message):
        raise RuntimeError("LaMa ran out of patience")


def test_an_editor_operation_answers_by_id():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        worker.pipeline = FakeEditorPipeline(OPTIONS)
        await worker.handle({"type": "editor", "id": 3, "op": "scan", "options": OPTIONS, "source": "in/1.jpg", "mask": "m.png"})
        await until(lambda: recorder.of("editor-done"))

        assert recorder.of("editor-done")[0] == {
            "event": "editor-done",
            "id": 3,
            "result": {"width": 10, "height": 20, "blocks": [{"box": [1, 2, 3, 4], "text": "in/1.jpg"}]},
        }

    asyncio.run(scenario())


def test_a_failed_editor_operation_reports_why():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        worker.pipeline = FakeEditorPipeline(OPTIONS)
        await worker.handle({"type": "editor", "id": 4, "op": "clean", "options": OPTIONS})
        await until(lambda: recorder.of("editor-failed"))

        assert recorder.of("editor-failed")[0] == {"event": "editor-failed", "id": 4, "message": "RuntimeError: LaMa ran out of patience"}

    asyncio.run(scenario())


def test_an_unknown_editor_operation_is_refused():
    async def scenario():
        recorder = Recorder()
        worker = worker_with(recorder)
        await worker.handle({"type": "editor", "id": 5, "op": "paint", "options": OPTIONS})
        await until(lambda: recorder.of("editor-failed"))

        assert "paint" in recorder.of("editor-failed")[0]["message"]

    asyncio.run(scenario())
