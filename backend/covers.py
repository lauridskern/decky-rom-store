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
import time
from typing import Any, Dict, List, Optional

from .httpclient import HttpClient, HttpError

IGDB_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_API_URL = "https://api.igdb.com/v4/games"
IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload/t_cover_big/"

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
        self._memory: Dict[str, Optional[str]] = {}

    @property
    def enabled(self) -> bool:
        return bool(self._client_id and self._client_secret)

    # ------------------------------------------------------------------ cache
    def _cache_path(self) -> Optional[str]:
        if not self._cache_dir:
            return None
        return os.path.join(self._cache_dir, "igdb_covers.json")

    def _load_cache(self) -> Dict[str, Optional[str]]:
        path = self._cache_path()
        if not path or not os.path.isfile(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}

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

        query_title = title.strip()
        for noise in _NOISE:
            if query_title.lower().startswith(noise):
                query_title = query_title[len(noise):]
                break
        if len(query_title) < 3:
            self._memory[key] = None
            return None

        body = (
            f'search "{query_title}"; fields name,cover.image_id,total_rating,rating_count; '
            f"where name ~ *\"{query_title}\"*; limit 5;"
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

        url = None
        rating = None
        rating_count = None
        wanted = query_title.lower()
        for game in games:
            name = (game.get("name") or "").lower()
            cover = (game.get("cover") or {}).get("image_id")
            if not cover:
                continue
            if name.startswith(wanted) or wanted in name:
                url = f"{IGDB_IMAGE_BASE}{cover}.jpg"
                rating = game.get("total_rating")
                rating_count = game.get("rating_count")
                break
        if url is None and games:
            cover = (games[0].get("cover") or {}).get("image_id")
            if cover:
                url = f"{IGDB_IMAGE_BASE}{cover}.jpg"
                rating = games[0].get("total_rating")
                rating_count = games[0].get("rating_count")

        result: Optional[Dict[str, Any]] = None
        if url or rating:
            result = {"cover": url, "rating": rating, "rating_count": rating_count}
        self._memory[key] = result
        self._save_cache()
        return result

    async def lookup_many(self, titles: List[str], limit: int = 12) -> Dict[str, Optional[Dict[str, Any]]]:
        """Look several titles up in parallel (bounded)."""
        unique: List[str] = []
        for title in titles:
            if title and title not in unique:
                unique.append(title)
        unique = unique[:limit]
        if not unique:
            return {}
        semaphore = asyncio.Semaphore(4)

        async def one(title: str):
            async with semaphore:
                return title, await self.lookup(title)

        results = await asyncio.gather(*(one(title) for title in unique), return_exceptions=True)
        found: Dict[str, Optional[Dict[str, Any]]] = {}
        for item in results:
            if isinstance(item, BaseException):
                continue
            title, url = item
            found[title] = url
        return found
