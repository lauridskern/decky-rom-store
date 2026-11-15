"""How fast each provider has been, measured on real downloads.

Every finished download adds a sample for its source: the transfer speed
(bytes over transfer time, without bytes that were resumed from an earlier
attempt) and the start delay (how long the site took to hand out the link: a
form to post, RomsFun's seven-second countdown). Both are moving averages, so
a provider that gets slower or faster is followed within a few downloads.

The game panel uses them to put the file that will finish first on top (see
estimate()); Settings shows them next to each source's health.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, Optional

# A small file is mostly connection setup; it says little about throughput.
MIN_BYTES = 2 * 1024 * 1024
# Weight of the newest sample in the moving average.
ALPHA = 0.4


class SpeedStats:
    def __init__(self, path: Optional[str]):
        self._path = path
        self._lock = threading.Lock()
        self._sources: Dict[str, Dict[str, Any]] = {}
        if path and os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    self._sources = {k: v for k, v in data.items() if isinstance(v, dict)}
            except (OSError, ValueError):
                pass

    def _save(self) -> None:
        if not self._path:
            return
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            temp = self._path + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(self._sources, fh)
            os.replace(temp, self._path)
        except OSError:
            pass

    def record(self, source: str, size: int, seconds: float, delay: float = 0.0) -> bool:
        """Add one finished download; False when it was too small to count."""
        if not source or size < MIN_BYTES or seconds <= 0:
            return False
        speed = size / max(seconds, 0.5)
        with self._lock:
            stats = self._sources.get(source)
            if not stats:
                stats = {"speed": speed, "delay": max(0.0, delay), "samples": 0}
            else:
                stats["speed"] = ALPHA * speed + (1 - ALPHA) * float(stats.get("speed") or speed)
                stats["delay"] = ALPHA * max(0.0, delay) + (1 - ALPHA) * float(stats.get("delay") or 0.0)
            stats["samples"] = int(stats.get("samples") or 0) + 1
            stats["updated"] = time.time()
            self._sources[source] = stats
            self._save()
        return True

    def record_test(self, source: str, size: float, seconds: float, delay: float,
                    error: Optional[str] = None) -> None:
        """Add the result of a speed test (backend/speedtest.py).

        A test reads a few seconds of a real download, so unlike a finished
        download it counts whatever its size: a slow provider sends little in
        that time, and that is the measurement. A failed test keeps the
        earlier figures and only notes the error.
        """
        if not source:
            return
        with self._lock:
            stats = dict(self._sources.get(source) or {})
            stats["tested"] = time.time()
            if error or size <= 0 or seconds <= 0:
                stats["test_error"] = error or "nothing came in"
            else:
                speed = size / seconds
                if stats.get("speed"):
                    stats["speed"] = ALPHA * speed + (1 - ALPHA) * float(stats["speed"])
                    stats["delay"] = ALPHA * max(0.0, delay) + (1 - ALPHA) * float(stats.get("delay") or 0.0)
                else:
                    stats["speed"] = speed
                    stats["delay"] = max(0.0, delay)
                stats["samples"] = int(stats.get("samples") or 0) + 1
                stats["updated"] = time.time()
                stats.pop("test_error", None)
            self._sources[source] = stats
            self._save()

    def last_tested(self, sources) -> float:
        """When the least recently tested of these sources was tested (0: never)."""
        with self._lock:
            return min((float((self._sources.get(s) or {}).get("tested") or 0.0) for s in sources), default=0.0)

    def all(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {k: dict(v) for k, v in self._sources.items()}


def estimate(stats: Dict[str, Any], size: Optional[int]) -> Optional[float]:
    """Seconds until a file of this size is in, from a source's stats."""
    if not stats or not stats.get("speed"):
        return None
    return float(stats.get("delay") or 0.0) + (size or 0) / float(stats["speed"])
