"""Covers from SteamGridDB, for games no box-art library has.

SteamGridDB is the community library Steam ROM Manager takes its art from.
Its "grids" are Steam capsules, 600 x 900, made or scanned by its users, and
it has them for nearly everything people play in an emulator, ROM hacks
included. They are not box scans, so they come after libretro and GameTDB
(backend/boxart.py, backend/gametdb.py) and fill in games with no cover:

    GET /api/v2/search/autocomplete/<title>            the game's id
    GET /api/v2/grids/game/<id>?dimensions=600x900     its grids, best first

A game is accepted only when SteamGridDB's name is the same title
(match_title) or the start of it, so a generic search never paints the wrong
game. Answers, found or not, are kept on the Deck for two weeks; a search
waits a moment for the first few and looks the rest up in the background.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Callable, Dict, List, Optional
from urllib.parse import quote

from .httpclient import HttpClient, HttpError
from .models import RomEntry, match_title

API = "https://www.steamgriddb.com/api/v2"
GRIDS = "dimensions=600x900&types=static&nsfw=false&humor=false&epilepsy=false"
TTL = 14 * 24 * 60 * 60

# Region and dump tags, and what the catalogues add ("Download … NSP").
_TAGS_RE = re.compile(r"\s*[\(\[][^)\]]*[\)\]]")
_NOISE_RE = re.compile(
    r"^\s*download\s+|\b(?:nsp|xci|nsz|xcz|full\s+game|free|eshop|roms?|iso)\b|\+\s*(?:all\s+)?(?:updates?|dlcs?)\b.*$",
    re.I,
)


def clean_title(title: str) -> str:
    return re.sub(r"\s+", " ", _NOISE_RE.sub(" ", _TAGS_RE.sub(" ", title or ""))).strip(" -:")


class SteamGridCovers:
    def __init__(self, http: HttpClient, key: Callable[[], str], cache_dir: Optional[str] = None):
        self._http = http
        self._key = key
        self._path = os.path.join(cache_dir, "sgdb_covers.json") if cache_dir else None
        self._cache: Optional[Dict[str, List]] = None
        self._running: set = set()
        self._asked: set = set()

    @property
    def enabled(self) -> bool:
        return bool((self._key() or "").strip())

    # ------------------------------------------------------------------ cache
    def _entries(self) -> Dict[str, List]:
        if self._cache is None:
            self._cache = {}
            if self._path and os.path.isfile(self._path):
                try:
                    with open(self._path, "r", encoding="utf-8") as fh:
                        data = json.load(fh)
                    if isinstance(data, dict):
                        self._cache = {k: v for k, v in data.items() if isinstance(v, list) and len(v) == 3}
                except (OSError, ValueError):
                    pass
        return self._cache

    def _save(self) -> None:
        if not self._path:
            return
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            temp = self._path + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(self._entries(), fh)
            os.replace(temp, self._path)
        except OSError:
            pass

    def cached(self, title: str) -> Optional[List[str]]:
        """[thumb, full] when found, [] when SteamGridDB has none, None if not asked yet."""
        key = match_title(clean_title(title))
        item = self._entries().get(key)
        if not item or time.time() - float(item[2] or 0) > TTL:
            return None
        return [item[0], item[1]] if item[0] else []

    # ------------------------------------------------------------------ lookup
    async def _api(self, path: str):
        resp = await self._http.request(
            f"{API}/{path}",
            headers={"Authorization": f"Bearer {self._key().strip()}", "Accept": "application/json"},
            polite=False,
            retries=1,
        )
        data = resp.json()
        if not isinstance(data, dict) or not data.get("success"):
            raise HttpError(f"SteamGridDB: {data.get('errors') if isinstance(data, dict) else 'bad answer'}")
        return data.get("data")

    @staticmethod
    def pick(games: List[Dict], title: str) -> Optional[Dict]:
        """The search hit that is this game: the same title, or the start of it."""
        want = match_title(clean_title(title))
        if not want:
            return None
        named = [(g, match_title(g.get("name") or "")) for g in games if isinstance(g, dict) and g.get("id")]
        for game, key in named:
            if key == want:
                return game
        for game, key in named:
            # A cut-off catalogue title, or SteamGridDB's shorter one.
            if len(min(key, want, key=len)) >= 10 and (key.startswith(want) or want.startswith(key)):
                return game
        return None

    async def lookup(self, title: str) -> Optional[List[str]]:
        """[thumb, full] for this title, [] for none; None on a network or key error."""
        search = clean_title(title)
        key = match_title(search)
        if not key:
            return []
        try:
            games = await self._api(f"search/autocomplete/{quote(search, safe='')}") or []
            game = self.pick(games, title)
            found: List[str] = []
            if game:
                grids = await self._api(f"grids/game/{game['id']}?{GRIDS}") or []
                for grid in grids:
                    if grid.get("url") and grid.get("mime") in ("image/png", "image/jpeg", "image/webp"):
                        found = [grid.get("thumb") or grid["url"], grid["url"]]
                        break
        except (HttpError, ValueError, KeyError, TypeError):
            return None
        entry = [found[0], found[1], time.time()] if found else ["", "", time.time()]
        self._entries()[key] = entry
        return found

    # ------------------------------------------------------------------ apply
    async def apply(self, entries: List[RomEntry], wait: float = 3.0, budget: int = 32) -> None:
        """Give entries without a cover SteamGridDB's, where it has one.

        Known answers are instant; up to ``budget`` new titles are looked up
        (four at a time), the search waiting ``wait`` seconds for them at most.
        """
        if not self.enabled:
            return
        bare = [entry for entry in entries if not entry.cover]
        if not bare:
            return
        wanted: List[str] = []
        for entry in bare:
            hit = self.cached(entry.title)
            if hit:
                self._set(entry, hit)
            elif hit is None:
                key = match_title(clean_title(entry.title))
                if key and key not in self._asked and entry.title not in wanted and len(wanted) < budget:
                    wanted.append(entry.title)
        if not wanted:
            return
        for title in wanted:
            self._asked.add(match_title(clean_title(title)))
        task = asyncio.ensure_future(self._lookup_many(wanted))
        self._running.add(task)
        task.add_done_callback(self._running.discard)
        try:
            await asyncio.wait_for(asyncio.shield(task), wait)
        except (asyncio.TimeoutError, Exception):
            pass
        for entry in bare:
            if not entry.cover:
                hit = self.cached(entry.title)
                if hit:
                    self._set(entry, hit)

    async def _lookup_many(self, titles: List[str]) -> None:
        semaphore = asyncio.Semaphore(4)

        async def one(title: str) -> None:
            async with semaphore:
                found = await self.lookup(title)
            if found is None:
                # Not an answer (network, key): may be asked again later.
                self._asked.discard(match_title(clean_title(title)))

        try:
            await asyncio.gather(*(one(title) for title in titles), return_exceptions=True)
        finally:
            self._save()

    async def settle(self) -> None:
        while self._running:
            await asyncio.gather(*list(self._running), return_exceptions=True)

    @staticmethod
    def _set(entry: RomEntry, hit: List[str]) -> None:
        entry.cover = hit[0]
        entry.cover_full = hit[1]
        entry.extra["sgdb"] = True
