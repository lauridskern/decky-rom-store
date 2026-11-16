"""Downloads continue after the plugin stops, against a local server."""

from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.downloader import DownloadManager  # noqa: E402
from backend.httpclient import HttpClient  # noqa: E402
from backend.speeds import SpeedStats, estimate  # noqa: E402

DATA = os.urandom(2 * 1024 * 1024)
RANGES = []


class Slow(BaseHTTPRequestHandler):
    """Serves DATA slowly, honouring Range requests."""

    def log_message(self, *args):  # noqa: D401 - keep the test output quiet
        pass

    def do_GET(self):  # noqa: N802
        start = 0
        wanted = self.headers.get("Range")
        if wanted:
            start = int(wanted.split("=")[1].split("-")[0])
            RANGES.append(start)
        body = DATA[start:]
        self.send_response(206 if wanted else 200)
        self.send_header("Content-Length", str(len(body)))
        if wanted:
            self.send_header("Content-Range", f"bytes {start}-{len(DATA) - 1}/{len(DATA)}")
        self.end_headers()
        try:
            for i in range(0, len(body), 65536):
                self.wfile.write(body[i:i + 65536])
                time.sleep(0.01)
        except (BrokenPipeError, ConnectionResetError):
            pass


class Resume(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/game.zip"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_suspend_and_resume(self):
        async def run():
            folder = tempfile.mkdtemp()
            state = os.path.join(folder, "downloads.json")
            dest = os.path.join(folder, "roms")
            http = HttpClient()
            first = DownloadManager(http, state_path=state)
            job = first.enqueue(title="Game", system="gb", source="x", filename="Game (USA).zip", url=self.url,
                                destination=dest, cover="https://example.invalid/cover.png")
            while job.received < 600_000:
                await asyncio.sleep(0.05)
            await first.suspend_all()
            part = os.path.join(dest, "Game (USA).zip.part")
            size = os.path.getsize(part)
            await asyncio.sleep(0.3)
            self.assertEqual(os.path.getsize(part), size, "nothing writes after suspending")

            second = DownloadManager(http, state_path=state)
            self.assertEqual(second.resume_pending(), 1)
            while second.snapshot()[0]["status"] not in ("done", "error"):
                await asyncio.sleep(0.1)
            final = os.path.join(dest, "Game (USA).zip")
            self.assertEqual(second.snapshot()[0]["status"], "done")
            self.assertEqual(second.snapshot()[0]["cover"], "https://example.invalid/cover.png", "the cover survives a restart")
            with open(final, "rb") as fh:
                self.assertEqual(hashlib.sha1(fh.read()).digest(), hashlib.sha1(DATA).digest())
            self.assertIn(size, RANGES, "continued from the partial file")
            self.assertFalse(os.path.exists(part))

        asyncio.run(run())


class Speeds(unittest.TestCase):
    def test_moving_average_and_small_files(self):
        path = os.path.join(tempfile.mkdtemp(), "speeds.json")
        stats = SpeedStats(path)
        self.assertFalse(stats.record("a", 100_000, 1.0), "small files do not count")
        self.assertTrue(stats.record("a", 10_000_000, 10.0, delay=7.0))  # 1 MB/s
        self.assertTrue(stats.record("a", 10_000_000, 2.0, delay=7.0))   # 5 MB/s
        a = SpeedStats(path).all()["a"]
        self.assertEqual(a["samples"], 2)
        self.assertAlmostEqual(a["speed"], 0.4 * 5_000_000 + 0.6 * 1_000_000)
        self.assertAlmostEqual(estimate(a, 0), 7.0)

    def test_estimate_prefers_the_file_that_is_in_first(self):
        fast_but_slow_start = {"speed": 20_000_000, "delay": 7.0}
        quick_start = {"speed": 2_000_000, "delay": 0.5}
        small, big = 4_000_000, 400_000_000
        self.assertLess(estimate(quick_start, small), estimate(fast_but_slow_start, small))
        self.assertLess(estimate(fast_but_slow_start, big), estimate(quick_start, big))
        self.assertIsNone(estimate({}, small))

    def test_downloads_are_measured(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            async def run():
                folder = tempfile.mkdtemp()
                stats = SpeedStats(os.path.join(folder, "speeds.json"))
                manager = DownloadManager(HttpClient())
                manager.on_measure = lambda job, size, seconds: stats.record(job.source, size, seconds, job.prepare_seconds)
                manager.enqueue(title="G", system="gb", source="romspedia", filename="G.zip",
                                url=f"http://127.0.0.1:{server.server_address[1]}/g.zip",
                                destination=os.path.join(folder, "roms"), prepare_seconds=1.5)
                while manager.snapshot()[0]["status"] not in ("done", "error"):
                    await asyncio.sleep(0.1)
                return stats.all().get("romspedia")

            measured = asyncio.run(run())
            self.assertIsNotNone(measured)
            self.assertGreater(measured["speed"], 0)
            self.assertAlmostEqual(measured["delay"], 1.5)
        finally:
            server.shutdown()
            server.server_close()


class Pages(BaseHTTPRequestHandler):
    """/file: a file. /page: a file host's download page. /cf: a browser check."""

    def log_message(self, *args):  # noqa: D401
        pass

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/zip"):
            import io, zipfile
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as zf:
                zf.writestr("Game/Game (USA).iso", b"x" * 4096)
            body, kind, code, server = buf.getvalue(), "application/zip", 200, "nginx"
        elif self.path.startswith("/page"):
            body, kind, code, server = b"<!DOCTYPE html><html><body>Download</body></html>", "text/html; charset=UTF-8", 200, "nginx"
        elif self.path.startswith("/cf"):
            body, kind, code, server = b"<!DOCTYPE html><html><title>Just a moment...</title></html>", "text/html", 403, "cloudflare"
        else:
            body, kind, code, server = DATA[: 3 * 1024 * 1024], "application/zip", 200, "nginx"
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Server", server)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


class WebPagesAreNotGames(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Pages)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def download(self, path):
        async def run():
            folder = tempfile.mkdtemp()
            manager = DownloadManager(HttpClient())
            manager.enqueue(title="G", system="switch", source="x", filename="G.rar", url=self.base + path,
                            destination=folder)
            while manager.snapshot()[0]["status"] not in ("done", "error"):
                await asyncio.sleep(0.05)
            return manager.snapshot()[0], os.listdir(folder)

        return asyncio.run(run())

    def test_a_download_page_is_an_error_not_a_file(self):
        job, files = self.download("/page")
        self.assertEqual(job["status"], "error")
        self.assertIn("download page", job["error"])
        self.assertNotIn("G.rar", files)

    def test_a_browser_check_is_named(self):
        job, _files = self.download("/cf")
        self.assertEqual(job["status"], "error")
        self.assertIn("browser check", job["error"])

    def test_an_archive_is_unpacked_when_asked(self):
        async def run():
            folder = tempfile.mkdtemp()
            manager = DownloadManager(HttpClient())
            manager.enqueue(title="G", system="psp", source="x", filename="Game (USA).zip", url=self.base + "/zip",
                            destination=folder, extract=True, keep_archive=False)
            while manager.snapshot()[0]["status"] not in ("done", "error"):
                await asyncio.sleep(0.05)
            return manager.snapshot()[0], os.listdir(folder)

        job, files = asyncio.run(run())
        self.assertEqual(job["status"], "done", job)
        self.assertEqual(files, ["Game (USA).iso"], "unpacked, archive gone")
        self.assertTrue(job["path"].endswith("Game (USA).iso"))

    def test_a_file_still_downloads(self):
        job, files = self.download("/file")
        self.assertEqual(job["status"], "done")
        self.assertIn("G.rar", files)

    def test_sample_measures_without_saving(self):
        http = HttpClient()
        result = asyncio.run(http.sample(self.base + "/file", max_bytes=2 * 1024 * 1024, max_seconds=5))
        self.assertGreater(result["bytes"], 0)
        self.assertGreater(result["seconds"], 0)
        with self.assertRaises(Exception) as page:
            asyncio.run(http.sample(self.base + "/page"))
        self.assertIn("download page", str(page.exception))
        with self.assertRaises(Exception) as check:
            asyncio.run(http.sample(self.base + "/cf"))
        self.assertIn("browser check", str(check.exception))


class SpeedTests(unittest.TestCase):
    def test_every_source_is_measured_one_after_the_other(self):
        from backend.models import RomEntry, RomFile
        from backend.speedtest import SpeedTest

        class Fake:
            def __init__(self, sid, fail=None):
                self.id, self.fail, self.asked = sid, fail, 0

            async def search(self, query, limit=40, page=1):
                return [RomEntry(source=self.id, source_id=query, title=f"Game {query}", system="psx", size=5_000_000)]

            async def resolve(self, entry):
                return [RomFile(id="f", filename="Game.zip", url=f"https://{self.id}.invalid/g.zip", size=5_000_000)]

            async def resolve_download(self, rom_file):
                self.asked += 1
                if self.fail:
                    raise RuntimeError(self.fail)
                return rom_file.url

        class Http:
            running = 0

            async def sample(self, url, max_bytes=0, max_seconds=0):
                Http.running += 1
                assert Http.running == 1, "one source at a time"
                await asyncio.sleep(0.01)
                Http.running -= 1
                # The fast one fills its sample early; the slow one runs out of time.
                if "fast" in url:
                    return {"bytes": 4_000_000.0, "seconds": 2.0, "first_byte": 0.2}
                return {"bytes": 1_200_000.0, "seconds": 6.0, "first_byte": 0.2}

        stats = SpeedStats(os.path.join(tempfile.mkdtemp(), "speeds.json"))
        sources = [Fake("fast"), Fake("slow"), Fake("broken", fail="asks for a browser check")]

        async def run():
            test = SpeedTest()
            self.assertTrue(test.start(sources, Http(), lambda sid, r: stats.record_test(
                sid, r.get("bytes", 0), r.get("seconds", 0), r.get("delay", 0), None if r["ok"] else r["error"])))
            self.assertFalse(test.start(sources, Http(), lambda *a: None), "one test at a time")
            while test.running:
                await asyncio.sleep(0.01)
            return test.status()

        status = asyncio.run(run())
        measured = stats.all()
        self.assertAlmostEqual(measured["fast"]["speed"], 2_000_000)
        self.assertAlmostEqual(measured["slow"]["speed"], 200_000)
        self.assertGreater(measured["fast"]["delay"], 0)
        self.assertIn("browser check", measured["broken"]["test_error"])
        self.assertNotIn("speed", measured["broken"])
        self.assertEqual(sorted(status["results"]), ["broken", "fast", "slow"])
        self.assertEqual([s.asked for s in sources], [1, 1, 2], "one link per source; a second game only after a failure")
        self.assertGreater(stats.last_tested(["fast", "slow", "broken"]), 0)
        self.assertEqual(stats.last_tested(["fast", "never"]), 0)


if __name__ == "__main__":
    unittest.main()
