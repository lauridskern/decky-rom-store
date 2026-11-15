"""Box art from libretro-thumbnails (RetroArch's box-art library).

The ROM sites publish their own covers, but they are often the wrong shape
(Romspedia resizes every image to one fixed size), the wrong platform (a 3DS
remake's box on an N64 game) or the front and back of a box side by side.
libretro-thumbnails has a front scan for most No-Intro / Redump titles, at the
box's real proportions, named after the game:

    https://thumbnails.libretro.com/Nintendo - Game Boy/Named_Boxarts/
        Pokemon - Red Version (USA, Europe) (SGB Enhanced).png

The server lists each console's folder, so one request per console gives the
whole index. It is cached on the Deck for two weeks, built in the background
when a console shows up for the first time, and matched against the store's
titles by normalised name.

The scans are full-size PNGs (often 500 kB - 1 MB). Thirty of them decoded at
full size would cost the Steam client well over 100 MB, so the grid uses a
small WebP from the open-source resizing proxy wsrv.nl (about 25 kB each,
downloaded once and cached like every other cover). The game panel's poster
loads the full scan, one image at a time. Both are settings.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from html import unescape
from typing import Dict, Iterable, List, Optional
from urllib.parse import quote, unquote

from .httpclient import HttpClient
from .models import RomEntry, extract_region, match_title

BASE = "https://thumbnails.libretro.com"
RESIZER = "https://wsrv.nl/"
INDEX_TTL = 14 * 24 * 60 * 60

# Store console key -> libretro playlist name. Arcade sets are named after
# their ROM set (e.g. "sf2.png"), not the game, so they cannot be matched by
# title and are left out.
SYSTEMS: Dict[str, str] = {
    "nes": "Nintendo - Nintendo Entertainment System",
    "snes": "Nintendo - Super Nintendo Entertainment System",
    "n64": "Nintendo - Nintendo 64",
    "gc": "Nintendo - GameCube",
    "wii": "Nintendo - Wii",
    "gb": "Nintendo - Game Boy",
    "gbc": "Nintendo - Game Boy Color",
    "gba": "Nintendo - Game Boy Advance",
    "nds": "Nintendo - Nintendo DS",
    "3ds": "Nintendo - Nintendo 3DS",
    "virtualboy": "Nintendo - Virtual Boy",
    "pokemini": "Nintendo - Pokemon Mini",
    "sg1000": "Sega - SG-1000",
    "mastersystem": "Sega - Master System - Mark III",
    "genesis": "Sega - Mega Drive - Genesis",
    "segacd": "Sega - Mega-CD - Sega CD",
    "sega32x": "Sega - 32X",
    "saturn": "Sega - Saturn",
    "dreamcast": "Sega - Dreamcast",
    "gamegear": "Sega - Game Gear",
    "psx": "Sony - PlayStation",
    "ps2": "Sony - PlayStation 2",
    "psp": "Sony - PlayStation Portable",
    "atari2600": "Atari - 2600",
    "atari5200": "Atari - 5200",
    "atari7800": "Atari - 7800",
    "atarilynx": "Atari - Lynx",
    "jaguar": "Atari - Jaguar",
    "pcengine": "NEC - PC Engine - TurboGrafx 16",
    "pcenginecd": "NEC - PC Engine CD - TurboGrafx-CD",
    "ngp": "SNK - Neo Geo Pocket",
    "ngpc": "SNK - Neo Geo Pocket Color",
    "wonderswan": "Bandai - WonderSwan",
    "wonderswan-color": "Bandai - WonderSwan Color",
    "3do": "The 3DO Company - 3DO",
    "colecovision": "Coleco - ColecoVision",
    "intellivision": "Mattel - Intellivision",
    "vectrex": "GCE - Vectrex",
    "msx": "Microsoft - MSX",
    "c64": "Commodore - 64",
    "amiga": "Commodore - Amiga",
    "dos": "DOS",
}

_HREF_RE = re.compile(r'href="([^"?/][^"]*\.png)"', re.I)
_TAGS_RE = re.compile(r"\(([^)]*)\)")
# Builds nobody wants as the picture for a game.
_UNWANTED = ("beta", "proto", "demo", "sample", "kiosk", "pirate", "unl", "hack", "virtual console")
_REGION_ORDER = ("usa", "world", "europe", "japan")


def full_url(system_name: str, filename: str) -> str:
    return f"{BASE}/{quote(system_name)}/Named_Boxarts/{quote(filename)}"


def thumb_url(url: str, width: int = 320) -> str:
    """A small WebP of a scan, through the resizing proxy."""
    bare = url.split("://", 1)[-1]
    return f"{RESIZER}?url={quote(bare, safe='')}&w={width}&h={width}&fit=inside&output=webp&q=82"


def _score(name: str, region: Optional[str]) -> tuple:
    """Lower is better: the entry's own region, then USA/World/Europe/Japan,
    then plain releases over revisions and special builds."""
    tags = " ".join(_TAGS_RE.findall(name)).lower()
    unwanted = any(word in tags for word in _UNWANTED)
    wanted = (region or "").lower()
    own = 0 if wanted and wanted in tags else 1
    try:
        order = next(i for i, r in enumerate(_REGION_ORDER) if r in tags)
    except StopIteration:
        order = len(_REGION_ORDER)
    return (unwanted, own, order, "rev" in tags, len(name))


class BoxArt:
    """Matches store entries to libretro box art."""

    def __init__(self, http: HttpClient, cache_dir: Optional[str] = None):
        self._http = http
        self._dir = os.path.join(cache_dir, "boxart") if cache_dir else None
        self._index: Dict[str, Dict[str, List[str]]] = {}
        self._loaded_at: Dict[str, float] = {}
        self._building: Dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------------ index
    def _path(self, system: str) -> Optional[str]:
        return os.path.join(self._dir, f"{system}.json") if self._dir else None

    def _load(self, system: str) -> bool:
        if system in self._index:
            return True
        path = self._path(system)
        if not path or not os.path.isfile(path):
            return False
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            self._index[system] = self._group(data.get("names") or [])
            self._loaded_at[system] = float(data.get("at") or 0)
            return True
        except (OSError, ValueError):
            return False

    @staticmethod
    def _group(names: Iterable[str]) -> Dict[str, List[str]]:
        grouped: Dict[str, List[str]] = {}
        for name in names:
            key = match_title(name[:-4] if name.lower().endswith(".png") else name)
            if key:
                grouped.setdefault(key, []).append(name)
        return grouped

    async def _fetch(self, system: str) -> None:
        playlist = SYSTEMS[system]
        # One plain directory listing per console (PS1: ~2.5 MB, 9000 names).
        resp = await self._http.request(
            f"{BASE}/{quote(playlist)}/Named_Boxarts/", polite=False, max_bytes=24 * 1024 * 1024
        )
        html = resp.text
        names = sorted({unescape(unquote(href)) for href in _HREF_RE.findall(html)})
        if not names:
            return
        self._index[system] = self._group(names)
        self._loaded_at[system] = time.time()
        path = self._path(system)
        if path:
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump({"at": time.time(), "names": names}, fh)
            except OSError:
                pass

    def _ensure(self, system: str) -> Optional[asyncio.Task]:
        """Start building a console's index if it is missing or stale."""
        if system not in SYSTEMS:
            return None
        loaded = self._load(system)
        fresh = loaded and time.time() - self._loaded_at.get(system, 0) < INDEX_TTL
        if fresh:
            return None
        task = self._building.get(system)
        if task is None or task.done():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:  # pragma: no cover - defensive
                return None
            task = loop.create_task(self._fetch(system))
            self._building[system] = task
        return task

    # ------------------------------------------------------------------ matching
    def find(self, title: str, system: str, region: Optional[str] = None) -> Optional[str]:
        """Full-size scan URL for a game, or None."""
        names = self._index.get(system, {}).get(match_title(title))
        if not names:
            return None
        best = min(names, key=lambda name: _score(name, region or extract_region(title)))
        return full_url(SYSTEMS[system], best)

    async def apply(self, entries: List[RomEntry], resize: bool = True, wait: float = 4.0) -> None:
        """Give entries libretro box art where there is a match.

        A console seen for the first time has its index fetched; the first
        search waits up to `wait` seconds for it, after that it finishes in the
        background and the next search has the art.
        """
        systems = {entry.system for entry in entries if entry.system in SYSTEMS}
        pending = [task for task in (self._ensure(system) for system in systems) if task]
        if pending and wait > 0:
            try:
                await asyncio.wait_for(asyncio.gather(*(asyncio.shield(t) for t in pending), return_exceptions=True), wait)
            except (asyncio.TimeoutError, Exception):
                pass
        for entry in entries:
            if entry.system not in self._index:
                continue
            url = self.find(entry.title, entry.system, entry.region)
            if not url:
                continue
            entry.extra["boxart"] = url
            entry.cover_full = url
            if resize:
                entry.cover = thumb_url(url)
