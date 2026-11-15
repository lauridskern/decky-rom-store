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

    def test_suspend_and_resume(self):
        async def run():
            folder = tempfile.mkdtemp()
            state = os.path.join(folder, "downloads.json")
            dest = os.path.join(folder, "roms")
            http = HttpClient()
            first = DownloadManager(http, state_path=state)
            job = first.enqueue(title="Game", system="gb", source="x", filename="Game (USA).zip", url=self.url, destination=dest)
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
            with open(final, "rb") as fh:
                self.assertEqual(hashlib.sha1(fh.read()).digest(), hashlib.sha1(DATA).digest())
            self.assertIn(size, RANGES, "continued from the partial file")
            self.assertFalse(os.path.exists(part))

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
