"""Box art from GameTDB (the cover database homebrew loaders use).

libretro-thumbnails (backend/boxart.py) has no Switch art and only some PS3
and Wii U games, the IGDB API crops every cover to 3:4, and the Switch
catalogues publish wide banners. GameTDB has the real case fronts for Switch,
Wii U, Wii, DS, 3DS and PS3 games, free and without a key. Switch art comes
from here first; for the others it fills in what libretro has no scan for.

    https://www.gametdb.com/switchtdb.txt?LANG=EN     "AABPA = Mario Kart 8 Deluxe"
    https://art.gametdb.com/switch/cover/US/AABPA.jpg     160 x 260, ~25 kB (grid)
    https://art.gametdb.com/switch/coverM/US/AABPA.jpg    352 x 570, ~90 kB (poster)

The title list is fetched once and kept on the Deck for two weeks; games are
matched by match_title(), like the libretro index. A game has covers for some
regions only (a missing one is a plain 404), so the first region that has one
is found with a HEAD request and remembered per game, found or not. A search
probes a page's worth of new games at most; the rest are found the next time.
"""

from __future__ import annotations

import asyncio
import bisect
import json
import os
import re
import time
from typing import Dict, Iterable, List, Optional, Tuple

from .httpclient import HttpClient, HttpError
from .models import RomEntry, extract_region, match_title

ART = "https://art.gametdb.com"
TITLES = "https://www.gametdb.com/{platform}tdb.txt?LANG=EN"
INDEX_TTL = 14 * 24 * 60 * 60
# How long "this game has no cover" is believed before asking again.
MISSING_TTL = 7 * 24 * 60 * 60

# Store console key -> GameTDB platform.
PLATFORMS: Dict[str, str] = {
    "switch": "switch", "wiiu": "wiiu", "wii": "wii", "nds": "ds", "3ds": "3ds", "ps3": "ps3",
}
# Per platform: the art for the grid, the art for the game page, file type.
# Wii has the small front only.
KINDS: Dict[str, Tuple[str, str, str]] = {
    "wii": ("cover", "cover", "png"),
}
DEFAULT_KINDS = ("cover", "coverM", "jpg")
# A cut-off title ("Mario + Rabbids Kingdom") matches the full one when it is
# at least this long (as a match_title() key) and nothing shorter fits.
PREFIX_MIN = 12

# Cover folders by region, in the order they are tried after the game's own.
_REGION_FOLDERS = {"USA": "US", "Europe": "EN", "Japan": "JA"}
_ORDER = ("US", "EN", "JA")

_LINE_RE = re.compile(r"^([0-9A-Z]{4,10})\s*=\s*(.+?)\s*$")
# What the Switch catalogues add to a title ("Download Super Mario Odyssey NSP
# Full Game", "Mario Kart 8 Deluxe Switch (NSP)"): tried without it when the
# title as it is has no match.
_NOISE_RE = re.compile(
    r"^\s*download\s+|\b(?:nsp|xci|nsz|xcz|full\s+game|free|eshop|roms?|switch)\b"
    r"|\+\s*(?:all\s+)?(?:updates?|dlcs?)\b.*$|\bv\d+(?:\.\d+)*\b",
    re.I,
)
# Bundles and editions sort after the plain game when several IDs share a title.
_EXTRA_RE = re.compile(r"[\[(]|bundle|starter pack|demo", re.I)


def cover_url(platform: str, game_id: str, region: str, kind: str = "cover") -> str:
    ext = KINDS.get(platform, DEFAULT_KINDS)[2]
    return f"{ART}/{platform}/{kind}/{region}/{game_id}.{ext}"


def kinds(platform: str) -> Tuple[str, str]:
    grid, full, _ext = KINDS.get(platform, DEFAULT_KINDS)
    return grid, full


class GameTDB:
    """Title index and cover lookup for the consoles in PLATFORMS."""

    def __init__(self, http: HttpClient, cache_dir: Optional[str] = None):
        self._http = http
        self._dir = os.path.join(cache_dir, "gametdb") if cache_dir else None
        self._index: Dict[str, Dict[str, List[str]]] = {}
        self._sorted: Dict[str, List[str]] = {}
        self._titles: Dict[str, Dict[str, str]] = {}
        self._loaded_at: Dict[str, float] = {}
        self._building: Dict[str, asyncio.Task] = {}
        # "switch/AABPA" -> [region folder or "", when it was looked up]
        self._found: Dict[str, List] = {}
        self._found_loaded = False
        self._probing: set = set()

    # ------------------------------------------------------------------ files
    def _path(self, name: str) -> Optional[str]:
        return os.path.join(self._dir, name) if self._dir else None

    def _write(self, name: str, data) -> None:
        path = self._path(name)
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            temp = path + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            os.replace(temp, path)
        except OSError:
            pass

    def _read(self, name: str):
        path = self._path(name)
        if not path or not os.path.isfile(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    # ------------------------------------------------------------------ index
    @staticmethod
    def parse(text: str) -> Dict[str, str]:
        """The title list: one "ID = Title" per line after a header line."""
        titles: Dict[str, str] = {}
        for line in text.splitlines():
            match = _LINE_RE.match(line)
            if match and match.group(1) != "TITLES":  # the header line
                titles[match.group(1)] = match.group(2)
        return titles

    @staticmethod
    def group(titles: Dict[str, str]) -> Dict[str, List[str]]:
        """IDs by match_title(), the plain game before bundles and editions."""
        grouped: Dict[str, List[Tuple[bool, str]]] = {}
        for game_id, title in titles.items():
            key = match_title(title)
            if key:
                grouped.setdefault(key, []).append((bool(_EXTRA_RE.search(title)), game_id))
        return {key: [game_id for _extra, game_id in sorted(ids)] for key, ids in grouped.items()}

    def _load(self, platform: str) -> bool:
        if platform in self._index:
            return True
        data = self._read(f"{platform}.json")
        if not isinstance(data, dict) or not data.get("titles"):
            return False
        self._index[platform] = self.group(data["titles"])
        self._titles[platform] = data["titles"]
        self._sorted.pop(platform, None)
        self._loaded_at[platform] = float(data.get("at") or 0)
        return True

    async def _fetch(self, platform: str) -> None:
        resp = await self._http.request(TITLES.format(platform=platform), polite=False, max_bytes=16 * 1024 * 1024)
        titles = self.parse(resp.text)
        if len(titles) < 100:  # an error page, not the list
            return
        self._index[platform] = self.group(titles)
        self._titles[platform] = titles
        self._sorted.pop(platform, None)
        self._loaded_at[platform] = time.time()
        self._write(f"{platform}.json", {"at": time.time(), "titles": titles})

    def _ensure(self, platform: str) -> Optional[asyncio.Task]:
        """Start fetching a platform's title list if it is missing or old."""
        loaded = self._load(platform)
        if loaded and time.time() - self._loaded_at.get(platform, 0) < INDEX_TTL:
            return None
        task = self._building.get(platform)
        if task is None or task.done():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:  # pragma: no cover - defensive
                return None
            task = loop.create_task(self._fetch(platform))
            self._building[platform] = task
        return task

    def ids(self, title: str, system: str) -> List[str]:
        platform = PLATFORMS.get(system)
        if not platform:
            return []
        index = self._index.get(platform, {})
        key = match_title(title)
        found = index.get(key)
        if found:
            return found
        cleaned = match_title(_NOISE_RE.sub(" ", title))
        if cleaned != key and index.get(cleaned):
            return index[cleaned]
        return self._prefix(platform, cleaned or key)

    def name(self, title: str, system: str) -> Optional[str]:
        """GameTDB's name for this game (its title list must be loaded)."""
        platform = PLATFORMS.get(system)
        ids = self.ids(title, system) if platform else []
        return self._titles.get(platform or "", {}).get(ids[0]) if ids else None

    def _prefix(self, platform: str, key: str) -> List[str]:
        """A cut-off title: the shortest full title it is the start of."""
        if len(key) < PREFIX_MIN:
            return []
        keys = self._sorted.get(platform)
        if keys is None:
            keys = self._sorted[platform] = sorted(self._index.get(platform, {}))
        at = bisect.bisect_left(keys, key)
        candidates = []
        while at < len(keys) and keys[at].startswith(key):
            candidates.append(keys[at])
            at += 1
        if not candidates:
            return []
        return self._index[platform][min(candidates, key=len)]

    def prefetch(self, systems: Iterable[str] = ("switch",)) -> None:
        """Fetch title lists in the background (Switch's at plugin start), so
        the first search does not have to wait for them. The others are
        fetched the first time their console shows up."""
        for system in systems:
            if system in PLATFORMS:
                self._ensure(PLATFORMS[system])

    # ------------------------------------------------------------------ covers
    def _found_map(self) -> Dict[str, List]:
        if not self._found_loaded:
            data = self._read("covers.json")
            if isinstance(data, dict):
                self._found = {k: v for k, v in data.items() if isinstance(v, list) and len(v) == 2}
            self._found_loaded = True
        return self._found

    def known(self, platform: str, game_id: str) -> Optional[str]:
        """The region folder with this game's cover, "" for none, None if not looked up."""
        item = self._found_map().get(f"{platform}/{game_id}")
        if not item:
            return None
        region, at = item
        if not region and time.time() - float(at or 0) > MISSING_TTL:
            return None
        return region

    async def _probe(self, platform: str, game_id: str, order: Iterable[str]) -> Optional[str]:
        """The first region folder that has this game's cover.

        "" when GameTDB has none (every region a 404); None when the answer is
        unknown (no network), so nothing is remembered.
        """
        for region in order:
            try:
                resp = await self._http.request(
                    cover_url(platform, game_id, region, kinds(platform)[0]),
                    method="HEAD", polite=False, retries=0, max_bytes=0,
                )
            except HttpError as exc:
                if exc.status == 404:
                    continue
                return None
            except Exception:
                return None
            if resp.status == 200:
                return region
        return ""

    def _order(self, region: Optional[str]) -> List[str]:
        first = _REGION_FOLDERS.get(region or "")
        return ([first] if first else []) + [r for r in _ORDER if r != first]

    async def apply(self, entries: List[RomEntry], wait: float = 4.0, budget: int = 48) -> None:
        """Give entries their GameTDB box art where there is one.

        Sets ``cover`` (the small front, for the grid) and ``cover_full`` (the
        larger one, for the game page). Nothing here waits on the art server:
        a game whose cover region is known gets that region; one not looked
        up yet gets its likeliest region at once (the image cache tries the
        other regions if that one is missing, see ``alternatives``) and is
        looked up in the background, ``budget`` games at a time, so the next
        search knows. A game known to have no cover is left to the other
        sources. Only the title list itself is waited for, the first time.
        """
        wanted = [entry for entry in entries if entry.system in PLATFORMS]
        if not wanted:
            return
        platforms = {PLATFORMS[entry.system] for entry in wanted}
        missing = any(platform not in self._index for platform in platforms)
        pending = [task for task in (self._ensure(platform) for platform in platforms) if task]
        if pending and wait > 0:
            # Without any list there is nothing to match against (and the
            # search result is cached for days): wait for it a little longer.
            wait_list = max(wait, 10.0) if missing else wait
            try:
                await asyncio.wait_for(asyncio.gather(*(asyncio.shield(t) for t in pending), return_exceptions=True), wait_list)
            except (asyncio.TimeoutError, Exception):
                pass

        to_probe: Dict[Tuple[str, str], List[str]] = {}
        for entry in wanted:
            platform = PLATFORMS[entry.system]
            game_ids = self.ids(entry.title, entry.system)[:3]
            if not game_ids:
                continue
            order = self._order(entry.region or extract_region(entry.title))
            grid, full = kinds(platform)
            chosen: Optional[Tuple[str, str]] = None
            for game_id in game_ids:
                region = self.known(platform, game_id)
                if region:
                    chosen = (game_id, region)
                    break
                if region is None:
                    if len(to_probe) < budget:
                        to_probe.setdefault((platform, game_id), order)
                    if chosen is None:
                        # Not looked up yet: the likeliest region for now.
                        chosen = (game_id, order[0])
            if chosen:
                entry.cover = cover_url(platform, chosen[0], chosen[1], grid)
                entry.cover_full = cover_url(platform, chosen[0], chosen[1], full)
                entry.extra["gametdb"] = chosen[0]

        if to_probe:
            self._probe_in_background(to_probe)

    def _probe_in_background(self, to_probe: Dict[Tuple[str, str], List[str]]) -> None:
        semaphore = asyncio.Semaphore(6)

        async def probe(key: Tuple[str, str], order: List[str]) -> None:
            async with semaphore:
                region = await self._probe(key[0], key[1], order)
            if region is not None:
                self._found_map()[f"{key[0]}/{key[1]}"] = [region, time.time()]

        async def run() -> None:
            await asyncio.gather(*(probe(k, o) for k, o in to_probe.items()), return_exceptions=True)
            self._write("covers.json", self._found_map())

        try:
            task = asyncio.get_running_loop().create_task(run())
        except RuntimeError:  # pragma: no cover - defensive
            return
        self._probing.add(task)
        task.add_done_callback(self._probing.discard)

    async def settle(self) -> None:
        """Wait for background lookups (for tests and the speed of the next search)."""
        while self._probing:
            await asyncio.gather(*list(self._probing), return_exceptions=True)

    @staticmethod
    def alternatives(url: str) -> List[str]:
        """The same cover in the other regions, for when this one is missing."""
        match = re.match(r"^(https://art\.gametdb\.com/[^/]+/[^/]+/)([A-Za-z]+)(/[^/]+)$", url or "")
        if not match:
            return []
        return [f"{match.group(1)}{region}{match.group(3)}" for region in (*_ORDER, "other") if region != match.group(2)]

    async def covers(self, games: List[Dict[str, object]], wait: float = 2.0) -> None:
        """The same for installed games (dicts with ``title`` and ``system``)."""
        entries = [
            RomEntry(source="library", source_id=str(index), title=str(game.get("title") or ""), system=str(game.get("system")))
            for index, game in enumerate(games)
        ]
        await self.apply(entries, wait=wait)
        for game, entry in zip(games, entries):
            if entry.cover:
                game["cover"] = entry.cover
