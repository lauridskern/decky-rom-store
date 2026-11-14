"""Optional unified cover art lookup via IGDB (Twitch).

The individual ROM sites publish wildly different artwork: portrait box art on
one, 16:9 wallpapers on another, screenshots on a third. This module can look
the game up in the IGDB database, which has one clean, high quality poster per
title, and hand that URL back so every card in the store looks the same.

It is optional: without credentials the plugin simply uses the artwork the
source provides (the UI normalises it with a blurred backdrop).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, Dict, List, Optional

from .httpclient import HttpClient, HttpError


def _clean(title: str) -> str:
    """Normalise a title so "Super Mario Bros. Wonder" and
    "Super Mario Bros Wonder" are the same game."""
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()

IGDB_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_API_URL = "https://api.igdb.com/v4/games"
IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload/t_cover_big/"
IGDB_SCREENSHOT_BASE = "https://images.igdb.com/igdb/image/upload/screenshot_huge/"

# Words that make a title unsearchable on IGDB.
_NOISE = ("the ", "a ", "an ")


class IgdbCovers:
    """Resolves game titles to IGDB cover art, with a local cache."""

    def __init__(self, http: HttpClient, client_id: Optional[str] = None,
                 client_secret: Optional[str] = None, cache_dir: Optional[str] = None):
        self._http = http
        self._client_id = (client_id or "").strip()
        self._client_secret = (client_secret or "").strip()
        self._cache_dir = cache_dir
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._memory: Dict[str, Optional[Dict[str, Any]]] = {}
        self._cache_loaded = False

    @property
    def enabled(self) -> bool:
        return bool(self._client_id and self._client_secret)

    # ------------------------------------------------------------------ cache
    def _cache_path(self) -> Optional[str]:
        if not self._cache_dir:
            return None
        return os.path.join(self._cache_dir, "igdb_covers.json")

    def _load_cache(self) -> Dict[str, Any]:
        if self._cache_loaded:
            return {}
        self._cache_loaded = True
        path = self._cache_path()
        if not path or not os.path.isfile(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh) or {}
        except (OSError, ValueError):
            return {}
        for key, value in data.items():
            self._memory.setdefault(key, value)
        return data

    def _save_cache(self) -> None:
        path = self._cache_path()
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(self._memory, fh)
        except OSError:
            pass

    # ------------------------------------------------------------------ token
    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expiry:
            return self._token
        body = (
            f"client_id={self._client_id}&client_secret={self._client_secret}"
            "&grant_type=client_credentials"
        ).encode()
        response = await self._http.request(
            IGDB_TOKEN_URL, "POST", body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        data = response.json()
        self._token = data.get("access_token", "")
        self._token_expiry = time.time() + float(data.get("expires_in", 3600)) - 60
        return self._token

    # ------------------------------------------------------------------ lookup
    def cached(self, title: str) -> Optional[Dict[str, Any]]:
        """What we already know about a title, without any network call."""
        key = _clean(title)
        if not key:
            return None
        if key in self._memory:
            return self._memory[key]
        self._load_cache()
        return self._memory.get(key)

    async def lookup(self, title: str) -> Optional[Dict[str, Any]]:
        """Return the IGDB art and rating for a game title, if known."""
        if not self.enabled or not title:
            return None
        key = title.strip().lower()
        if key in self._memory:
            return self._memory[key]
        cache = self._load_cache()
        if key in cache:
            self._memory[key] = cache[key]
            return cache[key]

        query_title = _clean(title)
        for noise in _NOISE:
            if query_title.startswith(noise.strip()):
                query_title = query_title[len(noise.strip()):]
                break
        if len(query_title) < 3:
            self._memory[key] = None
            return None

        body = (
            f'search "{title.strip()}"; fields name,cover.image_id,screenshots.image_id,'
            f"videos.video_id,rating,aggregated_rating,rating_count,total_rating,summary,"
            f"first_release_date,genres.name,platforms.name,involved_companies.company.name; "
            f"limit 6;"
        ).encode()
        try:
            token = await self._access_token()
            response = await self._http.request(
                IGDB_API_URL, "POST", body,
                headers={"Client-ID": self._client_id, "Authorization": f"Bearer {token}"},
            )
            games = response.json() or []
        except (HttpError, ValueError, KeyError):
            self._memory[key] = None
            return None

        best = self._best_game(games, query_title)
        if not best:
            self._memory[key] = None
            return None

        cover = (best.get("cover") or {}).get("image_id")
        url = f"{IGDB_IMAGE_BASE}{cover}.jpg" if cover else None
        rating = self._rating(best)
        result: Optional[Dict[str, Any]] = None
        if url or rating or self._shots(best):
            result = {
                "cover": url,
                "rating": rating,
                "rating_count": best.get("rating_count"),
                "shots": self._shots(best),
                "trailer": self._trailer(best),
                "summary": (best.get("summary") or "")[:600] or None,
                "genres": [g.get("name") for g in (best.get("genres") or []) if g.get("name")][:4],
                "platforms": [p.get("name") for p in (best.get("platforms") or []) if p.get("name")][:4],
                "developers": [
                    c.get("company", {}).get("name")
                    for c in (best.get("involved_companies") or [])
                    if (c.get("company") or {}).get("name")
                ][:2],
                "released": best.get("first_release_date"),
            }
        self._memory[key] = result
        self._save_cache()
        return result

    @staticmethod
    def _rating(game: Dict[str, Any]) -> Optional[float]:
        """IGDB stores the community score out of 100, we show 0-5."""
        for field in ("rating", "total_rating", "aggregated_rating"):
            value = game.get(field)
            if value is None:
                continue
            try:
                value = float(value)
            except (TypeError, ValueError):
                continue
            if field == "aggregated_rating":
                return round(value / 2.0, 1)
            return round(value / 20.0, 1)
        return None

    @staticmethod
    def _best_game(games: List[Dict[str, Any]], query_title: str) -> Optional[Dict[str, Any]]:
        """Pick the entry that really is the game we are looking for."""
        wanted = _clean(query_title)
        best = None
        best_score = 0.0
        for game in games:
            name = _clean(game.get("name") or "")
            if not name:
                continue
            if name == wanted:
                return game
            if name.startswith(wanted):
                score = 3.0
            elif wanted in name:
                score = 2.0
            elif name in wanted:
                score = 1.5
            else:
                # Fall back to a word overlap.
                words = set(wanted.split())
                overlap = len(words & set(name.split()))
                if not overlap or len(words) < 2:
                    continue
                score = overlap / len(words)
                if score < 0.75:
                    continue
            if game.get("screenshots") or game.get("cover"):
                score += 0.25
            # Prefer the entry whose name is closest to the query - the base
            # game, not the bundle or the DLC.
            score -= min(len(name) - len(wanted), 40) / 1000.0
            if score > best_score:
                best_score = score
                best = game
        return best

    @staticmethod
    def _shots(game: Dict[str, Any]) -> List[Dict[str, str]]:
        shots: List[Dict[str, str]] = []
        for shot in (game.get("screenshots") or [])[:8]:
            image = shot.get("image_id")
            if not image:
                continue
            shots.append(
                {
                    "kind": "image",
                    "thumb": f"{IGDB_SCREENSHOT_BASE}{image}.jpg",
                    "full": f"{IGDB_SCREENSHOT_BASE}{image}.jpg",
                }
            )
        return shots

    @staticmethod
    def _trailer(game: Dict[str, Any]) -> Optional[Dict[str, str]]:
        """The game's trailer. IGDB knows which video is the trailer."""
        videos = [v for v in (game.get("videos") or []) if v.get("video_id")]
        if not videos:
            return None
        trailer = None
        for video in videos:
            name = (video.get("name") or "").lower()
            if "trailer" in name:
                trailer = video
                break
        if trailer is None:
            trailer = videos[0]
        video_id = trailer["video_id"]
        return {
            "kind": "video",
            "thumb": f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
            "full": f"https://www.youtube.com/embed/{video_id}?autoplay=1&rel=0",
            "watch": f"https://www.youtube.com/watch?v={video_id}",
            "name": trailer.get("name") or "Trailer",
        }

    async def lookup_many(self, titles: List[str], limit: int = 12) -> Dict[str, Optional[Dict[str, Any]]]:
        """Look several titles up in parallel (bounded)."""
        unique: List[str] = []
        for title in titles:
            if title and title not in unique:
                unique.append(title)
        unique = unique[:limit]
        if not unique:
            return {}
        semaphore = asyncio.Semaphore(2)

        async def one(title: str):
            async with semaphore:
                await asyncio.sleep(0.12)  # stay inside the IGDB rate limit
                return title, await self.lookup(title)

        results = await asyncio.gather(*(one(title) for title in unique), return_exceptions=True)
        found: Dict[str, Optional[Dict[str, Any]]] = {}
        for item in results:
            if isinstance(item, BaseException):
                continue
            title, url = item
            found[title] = url
        return found
