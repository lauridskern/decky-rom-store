"""Media for the store experience: screenshots and trailers.

The Steam store API is keyless and gives us exactly what a store page needs:
small thumbnail art for the shelf and full size media for the lightbox, plus
the game's own trailer video.

The Steam "capsule" images are tiny (about 50-120 kB), so the gallery strip
stays cheap even with a dozen entries.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

from .httpclient import HttpClient, HttpError

STORE_SEARCH = "https://store.steampowered.com/api/storesearch/?term={term}&l=english&cc=US"
APP_DETAILS = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english&cc=US"
CAPSULE = "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg"
YOUTUBE_SEARCH = "https://www.youtube.com/results?search_query={query}"
YOUTUBE_THUMB = "https://img.youtube.com/vi/{video}/mqdefault.jpg"
YOUTUBE_EMBED = "https://www.youtube.com/embed/{video}?autoplay=1&rel=0"
YOUTUBE_WATCH = "https://www.youtube.com/watch?v={video}"
HEADER = "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"

CACHE_TTL = 7 * 24 * 60 * 60

# Words that stop a title from matching a store entry.
_STRIP = re.compile(r"[\s\-_:!,'\.]+(?:the|a|an|edition|version|game|rom|nsp|xci|switch|3ds|ds)\s*$", re.I)


def _normalise(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


class SteamMedia:
    """Resolves a game title to Steam artwork and a trailer."""

    def __init__(self, http: HttpClient, cache_dir: Optional[str] = None):
        self._http = http
        self._cache_dir = cache_dir
        self._memory: Dict[str, Optional[Dict[str, Any]]] = {}

    # ------------------------------------------------------------------ cache
    def _cache_path(self) -> Optional[str]:
        if not self._cache_dir:
            return None
        return os.path.join(self._cache_dir, "steam_media.json")

    def _load(self) -> Dict[str, Any]:
        path = self._cache_path()
        if not path or not os.path.isfile(path):
            return {}
        try:
            if time.time() - os.path.getmtime(path) > CACHE_TTL:
                return {}
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}

    def _save(self, data: Dict[str, Any]) -> None:
        path = self._cache_path()
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
        except OSError:
            pass

    # ------------------------------------------------------------------ lookup
    async def lookup(self, title: str) -> Optional[Dict[str, Any]]:
        """Return {appid, caption, shots: [{thumb, full}], trailer: {thumb, video}}."""
        if not title:
            return None
        key = _normalise(title)
        if not key:
            return None
        if key in self._memory:
            return self._memory[key]

        cache = self._load()
        if key in cache:
            self._memory[key] = cache[key]
            return cache[key]

        media = await self._fetch(title, key)
        self._memory[key] = media
        if media:
            cache[key] = media
            self._save(cache)
        return media

    async def _fetch(self, title: str, key: str) -> Optional[Dict[str, Any]]:
        try:
            response = await self._http.request(
                STORE_SEARCH.format(term=quote_plus(title)), retries=1, max_bytes=2 * 1024 * 1024
            )
            items = (response.json() or {}).get("items") or []
        except (HttpError, ValueError):
            return None

        appid = self._pick_app(items, key)
        if not appid:
            return None

        try:
            response = await self._http.request(
                APP_DETAILS.format(appid=appid), retries=1, max_bytes=8 * 1024 * 1024
            )
            payload = response.json() or {}
            data = (payload.get(str(appid)) or {}).get("data") or {}
        except (HttpError, ValueError):
            return None
        if not data:
            return None

        shots: List[Dict[str, str]] = []
        for shot in (data.get("screenshots") or [])[:8]:
            thumb = shot.get("path_thumbnail")
            full = shot.get("path_full")
            if thumb and full:
                shots.append({"kind": "image", "thumb": thumb, "full": full})

        trailer = None
        for movie in data.get("movies") or []:
            video = movie.get("mp4") or movie.get("webm")
            thumb = (movie.get("thumbnail") or "").replace("http://", "https://")
            if video and thumb:
                trailer = {
                    "kind": "video",
                    "thumb": thumb,
                    "full": video.replace("http://", "https://"),
                    "name": movie.get("name") or "Trailer",
                }
                if "trailer" in (movie.get("name") or "").lower():
                    break

        if not shots and not trailer:
            return None

        return {
            "appid": appid,
            "caption": data.get("name") or title,
            "shots": shots,
            "trailer": trailer,
            "capsule": CAPSULE.format(appid=appid),
            "header": HEADER.format(appid=appid),
        }

    async def youtube_trailer(self, title: str) -> Optional[Dict[str, str]]:
        """Find the game's trailer on YouTube (no API key needed)."""
        if not title:
            return None
        query = quote_plus(f"{title} trailer")
        try:
            response = await self._http.request(
                YOUTUBE_SEARCH.format(query=query),
                headers={"Accept-Language": "en-US,en;q=0.9"},
                max_bytes=4 * 1024 * 1024,
                retries=1,
            )
        except HttpError:
            return None
        body = response.text
        ids = re.findall(r'"videoId":"([A-Za-z0-9_-]{11})"', body)
        titles = re.findall(r'"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){3,90})"', body)
        wanted = _normalise(title)
        best = None
        best_score = 0
        for video, name in zip(ids, titles):
            clean = _normalise(name.replace('\\"', ""))
            if not wanted:
                continue
            if clean.startswith(wanted):
                score = 3
            elif wanted in clean:
                score = 2
            elif clean in wanted:
                score = 1
            else:
                continue
            if "trailer" in clean:
                score += 2
            elif "gameplay" in clean or "announcement" in clean:
                score += 1
            if score > best_score:
                best_score = score
                best = (video, name)
                if score >= 5:
                    break
        if not best:
            return None
        video, name = best
        return {
            "kind": "video",
            "thumb": YOUTUBE_THUMB.format(video=video),
            "full": YOUTUBE_EMBED.format(video=video),
            "watch": YOUTUBE_WATCH.format(video=video),
            "name": name,
        }

    @staticmethod
    def _pick_app(items: List[Dict[str, Any]], key: str) -> Optional[int]:
        """Pick the store entry whose name matches the game title best."""
        best = None
        best_score = 0.0
        for item in items:
            name = _normalise(item.get("name") or "")
            if not name:
                continue
            if name == key:
                return int(item["id"])
            if key in name or name in key:
                score = min(len(name), len(key)) / max(len(name), len(key))
                if score > best_score:
                    best_score = score
                    best = item
        # Only accept a loose match when it is reasonably close.
        if best is not None and best_score >= 0.72:
            return int(best["id"])
        return None
