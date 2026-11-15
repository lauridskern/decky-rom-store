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


if __name__ == "__main__":
    unittest.main()
