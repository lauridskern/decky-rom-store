"""Speed test: how fast each provider delivers, before you download anything.

The game page puts the file that should be in first on top, from each
provider's measured speed and start delay (backend/speeds.py). Real downloads
measure only the providers you happen to use; this measures all of them.

For every enabled source, one after the other (in parallel they would share
the line and measure each other): search it for a common title, take a game
with a real file, ask the site for its download link the way a download does
(forms, RomsFun's countdown: that is the start delay), then read the start of
that file for a few seconds and throw it away. Nothing is saved, and no site
is asked for more than two links per test (a second game only when the
first one's file cannot be read).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from .httpclient import HttpClient
from .models import RomEntry, RomFile
from .sources.base import Source

# Titles nearly every catalogue has. Disc-era series first: their files are
# hundreds of MB, so the sample is timed on a transfer that is still going.
TERMS = ("final fantasy", "mario", "zelda", "doom")
# Enough to get past the connection's slow start, short enough for a test.
SAMPLE_BYTES = 8 * 1024 * 1024
SAMPLE_SECONDS = 6.0
# Less than this, and the file ended before the speed could be measured.
MIN_SAMPLE = 1024 * 1024

# Arcade sets often live on other file servers than a site's console games.
SKIP_SYSTEMS = {"mame", "arcades"}
# Consoles whose games are big files (discs, large cartridges), tried first.
BIG_SYSTEMS = {
    "psx", "ps2", "ps3", "psp", "psvita", "gc", "wii", "wiiu", "switch", "nds", "3ds",
    "dreamcast", "saturn", "segacd", "pcenginecd", "neogeocd", "3do", "n64",
}


def _order(entries: List[RomEntry]) -> List[RomEntry]:
    """Big-file consoles first, then by known size; no arcade sets."""
    usable = [entry for entry in entries if entry.system not in SKIP_SYSTEMS]
    return sorted(usable, key=lambda entry: (entry.system not in BIG_SYSTEMS, -(entry.size or 0)))


async def _picks(source: Source, count: int = 2):
    """Up to ``count`` games of this source with a downloadable file, big ones first."""
    found: List[Tuple[RomEntry, RomFile]] = []
    seen = set()
    last = "no game found to test with"
    for term in TERMS:
        try:
            entries = await source.search(term, limit=12)
        except Exception as exc:
            last = f"search failed: {exc}"
            continue
        for entry in _order(entries)[:3]:
            if entry.key in seen:
                continue
            seen.add(entry.key)
            try:
                files = list(entry.files) or await source.resolve(entry)
            except Exception as exc:
                last = f"could not open a game page: {exc}"
                continue
            if files:
                found.append((entry, max(files, key=lambda f: f.size or entry.size or 0)))
                if len(found) >= count:
                    return found
            else:
                last = "no download link on the game pages"
        # A big game is in hand: no need to search for more.
        if found and found[0][0].system in BIG_SYSTEMS and len(found) >= count:
            break
    if found:
        return sorted(found, key=lambda pair: pair[0].system not in BIG_SYSTEMS)
    raise RuntimeError(last)


async def _pick(source: Source) -> Tuple[RomEntry, RomFile]:
    """One game of this source with a downloadable file."""
    return (await _picks(source, 1))[0]


async def test_source(source: Source, http: HttpClient) -> Dict[str, Any]:
    """One provider: its speed (bytes/s), start delay (s), or an error.

    One game's file can sit on a server that fails while the rest work, so a
    second game is tried before the provider is reported as failing. That is
    at most two links per test.
    """
    try:
        candidates = await _picks(source, 2)
    except Exception as exc:
        return {"ok": False, "error": str(exc) or type(exc).__name__}
    error = "no file could be read"
    best: Optional[Dict[str, Any]] = None
    for entry, rom_file in candidates:
        try:
            asked = time.monotonic()
            url = await source.resolve_download(rom_file)
            handed_out = time.monotonic() - asked
            result = await http.sample(url, max_bytes=SAMPLE_BYTES, max_seconds=SAMPLE_SECONDS)
        except Exception as exc:
            error = str(exc) or type(exc).__name__
            continue
        if result["bytes"] <= 0:
            error = "the file was empty"
            continue
        measured = {
            "ok": True,
            "speed": result["bytes"] / result["seconds"],
            "delay": handed_out + result["first_byte"],
            "bytes": int(result["bytes"]),
            "seconds": result["seconds"],
            "game": entry.title,
        }
        if best is None or measured["bytes"] > best["bytes"]:
            best = measured
        # A file that ended almost at once measured the connection, not the
        # speed: try the next game, and keep this one if nothing is better.
        if result["bytes"] >= MIN_SAMPLE or result["seconds"] >= SAMPLE_SECONDS * 0.9:
            break
    return best or {"ok": False, "error": error}


class SpeedTest:
    """One test at a time; its progress for the Settings page."""

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._state: Dict[str, Any] = {"running": False, "current": None, "results": {}, "started": None, "finished": None}

    @property
    def running(self) -> bool:
        return bool(self._task and not self._task.done())

    def status(self) -> Dict[str, Any]:
        state = dict(self._state)
        state["results"] = dict(state["results"])
        state["running"] = self.running
        return state

    def start(self, sources: List[Source], http: HttpClient,
              record: Callable[[str, Dict[str, Any]], None]) -> bool:
        """Start testing these sources in the background; False if one runs."""
        if self.running:
            return False
        self._state = {
            "running": True,
            "current": None,
            "pending": [source.id for source in sources],
            "results": {},
            "started": time.time(),
            "finished": None,
        }

        async def run() -> None:
            try:
                for source in sources:
                    self._state["current"] = source.id
                    result = await test_source(source, http)
                    self._state["results"][source.id] = result
                    self._state["pending"] = [s for s in self._state["pending"] if s != source.id]
                    try:
                        record(source.id, result)
                    except Exception:  # pragma: no cover - a write error must not end the test
                        pass
            finally:
                self._state["current"] = None
                self._state["finished"] = time.time()

        self._task = asyncio.get_running_loop().create_task(run())
        return True
