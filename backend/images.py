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
from typing import Callable, Dict, List, Optional, Set, Tuple

from urllib.parse import quote

from .httpclient import HttpClient, HttpError

DEFAULT_BASE_URL = "http://localhost:1337"
MAX_CACHE_BYTES = 250 * 1024 * 1024  # keep the runtime folder sane
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
    # Resizing proxies name the format in the query (wsrv.nl: output=webp).
    output = re.search(r"[?&]output=([a-z0-9]{2,5})(?:&|$)", url.lower())
    if output:
        return output.group(1)
    match = re.search(r"\.([a-z0-9]{2,5})(?:\?|$)", url.lower())
    return match.group(1) if match else "jpg"


def best_variant(url: Optional[str], kind: str = "card") -> Optional[str]:
    """Pick the best sized variant of a known image URL.

    Romspedia publishes several sizes of every cover; the card only needs a
    small one while the detail view wants the full art.
    """
    if not url:
        return None
    # Up to v1.16.0 screenshots were stored as .../upload/screenshot_huge/...,
    # which IGDB answers with a 404 (size names start with "t_"). Cached
    # searches and details still hold such links.
    url = url.replace("/upload/screenshot_huge/", "/upload/t_screenshot_huge/")
    if kind == "detail":
        return url
    # Romspedia: <base>-cover.webp -> <base>-cover-280x398.webp
    if "static.romspedia.com" in url and url.endswith("-cover.webp"):
        return url[: -len("-cover.webp")] + "-cover-280x398.webp"
    # IGDB screenshots: the full 1920x1080 file is ~500 kB, the medium one
    # is around 50 kB and plenty for a thumbnail.
    if "images.igdb.com" in url and "/t_screenshot_huge/" in url:
        return url.replace("/t_screenshot_huge/", "/t_screenshot_med/")
    # IGDB covers: 264x374 decoded to 4 bytes per pixel is 400 kB of texture
    # for a 130 px card. The 180x256 variant is indistinguishable at that size
    # and halves both the download and the memory the client has to hold.
    if "images.igdb.com" in url and "/t_cover_big/" in url:
        return url.replace("/t_cover_big/", "/t_cover_med/")
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
        # Other places the same picture may be, tried when a download fails
        # (set by the service: GameTDB's other regions).
        self.alternatives: Optional[Callable[[str], List[str]]] = None

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
            if len(self._locks) > 4000:
                # Only a de-duplication aid; dropping them costs at most one
                # redundant download.
                self._locks.clear()
                self._locks[key] = lock
            if os.path.exists(path) and os.path.getsize(path) > 0:
                return self._local_url(key, ext)
            if self._semaphore is None:
                self._semaphore = asyncio.Semaphore(8)
            try:
                async with self._semaphore:
                    await self._download(target, path)
            except Exception:
                # Some art exists in several places (GameTDB keeps a cover per
                # region): try the others before giving up.
                found = False
                for other in (self.alternatives(target) if self.alternatives else []):
                    try:
                        async with self._semaphore:
                            await self._download(other, path)
                        found = True
                        break
                    except Exception:
                        continue
                if not found:
                    # No local copy: report it as missing so the UI can show
                    # the placeholder straight away instead of waiting for a
                    # remote image the Steam client would block anyway.
                    return None
            if not os.path.exists(path):
                return url
            # The download may have written a different extension - the url we
            # hand out has to match the file that is actually on disk.
            actual = os.path.splitext(path)[1].lstrip(".") or ext
            self._known.add(key)
            self._prune()
            return self._local_url(key, actual)

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
            polite=False,
            retries=1,
        )
        body = response.body
        if not body:
            raise HttpError(f"Empty image response for {url}")
        ext = _extension(url, response.header("content-type"))
        if ext != os.path.splitext(path)[1].lstrip("."):
            path = os.path.splitext(path)[0] + "." + ext
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, path)

    def _prune(self) -> None:
        # Walking a folder with thousands of covers costs real time, so this
        # runs at most every five minutes - and on a worker thread, because it
        # must never block the plugin while it stats the cache.
        now = time.time()
        if now - self._last_prune < 300:
            return
        self._last_prune = now
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._prune_sync()
            return
        loop.create_task(asyncio.to_thread(self._prune_sync))

    def _prune_sync(self) -> None:
        try:
            entries = []
            total = 0
            with os.scandir(self.folder) as scan:
                for item in scan:
                    try:
                        stat = item.stat()
                    except OSError:
                        continue
                    if not item.is_file():
                        continue
                    total += stat.st_size
                    entries.append((stat.st_mtime, stat.st_size, item.path))
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
