"""Cover art pipeline.

The Steam client is picky about remote images, the sources serve a mix of
png/jpg/webp at wildly different sizes, and the Deck may be on a flaky link.
So the plugin downloads the artwork itself, keeps it in the plugin's runtime
folder and hands the frontend a local URL that Decky already serves:

    http://127.0.0.1:1337/plugins/<plugin>/data/covers/<hash>.webp

The first request for an image blocks until it is cached, every later request
is served straight from disk.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from typing import Dict, List, Optional, Set, Tuple

from urllib.parse import quote

from .httpclient import HttpClient, HttpError

DEFAULT_BASE_URL = "http://127.0.0.1:1337"
MAX_CACHE_BYTES = 400 * 1024 * 1024  # keep the runtime folder sane
CONTENT_TYPES = {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/avif": "avif",
}


def _extension(url: str, content_type: str = "") -> str:
    if content_type:
        ext = CONTENT_TYPES.get(content_type.split(";")[0].strip().lower())
        if ext:
            return ext
    match = re.search(r"\.([a-z0-9]{2,5})(?:\?|$)", url.lower())
    return match.group(1) if match else "jpg"


def best_variant(url: Optional[str], kind: str = "card") -> Optional[str]:
    """Pick the best sized variant of a known image URL.

    Romspedia publishes several sizes of every cover; the card only needs a
    small one while the detail view wants the full art.
    """
    if not url:
        return None
    if kind == "detail":
        return url
    # Romspedia: <base>-cover.webp -> <base>-cover-280x398.webp
    if "static.romspedia.com" in url and url.endswith("-cover.webp"):
        return url[: -len("-cover.webp")] + "-cover-280x398.webp"
    return url


class ImageCache:
    """Downloads artwork once and serves it from the plugin's data folder."""

    def __init__(self, http: HttpClient, runtime_dir: Optional[str] = None,
                 plugin_name: Optional[str] = None, base_url: str = DEFAULT_BASE_URL):
        self._http = http
        self._runtime_dir = runtime_dir
        self._plugin_name = plugin_name
        self._base_url = base_url.rstrip("/")
        self._locks: Dict[str, asyncio.Lock] = {}
        self._known: Set[str] = set()
        self._last_prune = 0.0
        # Do not hammer the Deck with dozens of parallel image downloads.
        self._semaphore: Optional[asyncio.Semaphore] = None

    # ------------------------------------------------------------------ paths
    @property
    def enabled(self) -> bool:
        return bool(self._runtime_dir and self._plugin_name)

    @property
    def folder(self) -> str:
        return os.path.join(self._runtime_dir or "", "covers")

    def _local_url(self, key: str, ext: str) -> str:
        plugin = quote(self._plugin_name or "", safe="")
        return f"{self._base_url}/plugins/{plugin}/data/covers/{key}.{ext}"

    def _key(self, url: str) -> str:
        return hashlib.sha1(url.encode("utf-8", errors="ignore")).hexdigest()[:20]

    # ------------------------------------------------------------------ public
    async def resolve(self, url: Optional[str], kind: str = "card") -> Optional[str]:
        """Return a URL the frontend can load, downloading the image if needed."""
        if not url:
            return None
        target = best_variant(url, kind)
        if not self.enabled or not target:
            return url

        key = self._key(target)
        ext = _extension(target)
        path = os.path.join(self.folder, f"{key}.{ext}")

        if os.path.exists(path) and os.path.getsize(path) > 0:
            self._known.add(key)
            return self._local_url(key, ext)

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if os.path.exists(path) and os.path.getsize(path) > 0:
                return self._local_url(key, ext)
            if self._semaphore is None:
                self._semaphore = asyncio.Semaphore(4)
            try:
                async with self._semaphore:
                    await self._download(target, path)
            except Exception:
                return url
            if not os.path.exists(path):
                return url
            self._known.add(key)
            self._prune()
            return self._local_url(key, ext)

    async def prefetch(self, urls: List[Optional[str]], kind: str = "card") -> None:
        """Warm the cache in the background."""
        if not self.enabled:
            return
        seen = set()
        for url in urls:
            if not url or url in seen:
                continue
            seen.add(url)
            try:
                await self.resolve(url, kind)
            except Exception:
                continue

    # ------------------------------------------------------------------ internals
    async def _download(self, url: str, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        response = await self._http.request(
            url,
            "GET",
            headers={"Accept": "image/webp,image/apng,image/*,*/*;q=0.8", "Referer": _referer_for(url)},
            max_bytes=12 * 1024 * 1024,
        )
        body = response.body
        if not body:
            raise HttpError(f"Empty image response for {url}")
        ext = _extension(url, response.headers.get("content-type", ""))
        if ext != os.path.splitext(path)[1].lstrip("."):
            path = os.path.splitext(path)[0] + "." + ext
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, path)

    def _prune(self) -> None:
        now = time.time()
        if now - self._last_prune < 60:
            return
        self._last_prune = now
        try:
            entries = []
            total = 0
            for name in os.listdir(self.folder):
                full = os.path.join(self.folder, name)
                if not os.path.isfile(full):
                    continue
                size = os.path.getsize(full)
                total += size
                entries.append((os.path.getmtime(full), size, full))
            if total <= MAX_CACHE_BYTES:
                return
            entries.sort()
            for _mtime, size, full in entries:
                if total <= MAX_CACHE_BYTES * 0.8:
                    break
                try:
                    os.remove(full)
                    total -= size
                except OSError:
                    pass
        except OSError:
            pass


def _referer_for(url: str) -> str:
    match = re.match(r"https?://([^/]+)/", url)
    host = match.group(1) if match else ""
    if "myabandonware" in host:
        return "https://www.myabandonware.com/"
    if "romspedia" in host:
        return "https://www.romspedia.com/"
    return f"https://{host}/" if host else ""


def collect_urls(entries) -> List[Optional[str]]:
    return [entry.cover for entry in entries if entry.cover]
