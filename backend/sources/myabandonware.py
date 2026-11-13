"""MyAbandonware adapter (https://www.myabandonware.com).

The site is backed by a TypeSense index ("games"). The search page ships a
short lived, scoped search key inside its HTML, which is exactly what we need
to query the index directly - far cheaper and more stable than scraping the
rendered result list.

* search -> POST https://ts.myabandonware.com/multi_search
* detail -> /game/<slug>/           (a.game-downloads__platform-download)
* file   -> /download/<id>-<slug>   (302 -> the real archive)
"""

from __future__ import annotations

import base64
import json
import re
import time
from typing import Any, Dict, List, Optional

from ..htmlutil import absolute, collapse_ws, strip_tags
from ..models import RomEntry, RomFile
from ..systems import canonical_system
from .base import Source, SourceError

DEFAULT_BASE = "https://www.myabandonware.com"
DEFAULT_TS_HOST = "ts.myabandonware.com"

_KEY_RE = re.compile(r'id="tsKey"\s+value="([^"]+)"')
_SERVER_RE = re.compile(r"tsServer\s*=\s*(\{.*?\})", re.S)
_DOWNLOAD_RE = re.compile(r'<a\b[^>]*class="[^"]*game-downloads__platform-download[^"]*"[^>]*>', re.I)
_PLATFORM_TITLE_RE = re.compile(r'<h3[^>]*class="game-downloads__platforms-title"[^>]*>(.*?)</h3>', re.I | re.S)
_HREF_RE = re.compile(r'href="([^"]+)"', re.I)
_SIZE_RE = re.compile(r'data-file-size="([\d.]+)"', re.I)


class MyAbandonwareSource(Source):
    id = "myabandonware"
    label = "My Abandonware"
    homepage = "https://www.myabandonware.com"
    supports_browse = False

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.base = (self.options.get("base_url") or DEFAULT_BASE).rstrip("/")
        self._ts_host = self.options.get("ts_host") or DEFAULT_TS_HOST
        self._api_key: Optional[str] = None
        self._api_key_expiry: float = 0.0

    # ------------------------------------------------------------ type sense key
    async def _ensure_key(self) -> str:
        now = time.time()
        if self._api_key and now < self._api_key_expiry - 60:
            return self._api_key
        html = await self.http.get_text(f"{self.base}/search?q=zelda")
        m = _KEY_RE.search(html)
        if not m:
            raise SourceError("Could not read the MyAbandonware search key")
        key = m.group(1)
        server = _SERVER_RE.search(html)
        if server:
            try:
                data = json.loads(server.group(1))
                if data.get("host"):
                    self._ts_host = data["host"]
            except Exception:
                pass
        self._api_key = key
        self._api_key_expiry = self._key_expiry(key)
        return key

    @staticmethod
    def _key_expiry(key: str) -> float:
        """Scoped TypeSense keys embed their expiry in the payload."""
        try:
            raw = base64.b64decode(key + "=" * (-len(key) % 4)).decode("utf-8", errors="ignore")
            start = raw.find("{")
            if start == -1:
                return time.time() + 900
            payload = json.loads(raw[start:])
            return float(payload.get("expires_at") or (time.time() + 900))
        except Exception:
            return time.time() + 900

    # ------------------------------------------------------------------ search
    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        key = await self._ensure_key()
        payload = {
            "searches": [
                {
                    "collection": "games",
                    "q": query,
                    "query_by": "name,alt_names",
                    "query_by_weights": "2,1",
                    "sort_by": "popularity:asc",
                    "prefix": True,
                    "infix": "fallback",
                    "num_typos": 2,
                    "typo_tokens_threshold": 100,
                    "drop_tokens_threshold": 0,
                    "enable_overrides": True,
                    "exact_match_first": True,
                    "per_page": max(1, min(limit, 50)),
                    "page": max(1, page),
                }
            ]
        }
        resp = await self.http.post_json(
            f"https://{self._ts_host}/multi_search", payload, headers={"X-TYPESENSE-API-KEY": key}
        )
        try:
            data = resp.json()
        except Exception as exc:  # pragma: no cover - defensive
            raise SourceError(f"MyAbandonware returned an unexpected payload: {exc}") from exc
        results = (data.get("results") or [{}])[0]
        entries: List[RomEntry] = []
        for hit in results.get("hits", []) or []:
            entry = self._entry_from_hit(hit.get("document") or {})
            if entry:
                entry.rank = len(entries)
                entries.append(entry)
        return entries[:limit]

    def _webp_from_sources(self, releases: List[Dict[str, Any]]) -> Optional[str]:
        """Pick the webp screenshot advertised by the index."""
        for release in releases:
            raw = release.get("main_screenshot_sources")
            if not raw:
                continue
            try:
                sources = json.loads(raw) if isinstance(raw, str) else raw
            except (TypeError, ValueError):
                continue
            for source in sources or []:
                if str(source.get("type", "")).endswith("webp") and source.get("srcset"):
                    return absolute(self.base, source["srcset"])
        return None

    def _entry_from_hit(self, doc: Dict[str, Any]) -> Optional[RomEntry]:
        name = (doc.get("name") or "").strip()
        slug = (doc.get("short_url") or "").strip()
        if not name or not slug:
            return None
        platforms = [p for p in (doc.get("platforms") or []) if p]
        releases = doc.get("releases") or []
        system = canonical_system(platforms[0] if platforms else "")
        if system == "unknown" and releases:
            system = canonical_system(releases[0].get("platform", ""))

        cover = None
        for release in releases:
            shot = release.get("main_screenshot")
            if shot:
                cover = absolute(self.base, shot)
                break
        # The site ships a webp next to every png screenshot - use the exact
        # path from the index instead of guessing it.
        if cover:
            webp = self._webp_from_sources(releases)
            if webp:
                cover = webp

        genres = [g for g in (doc.get("genres") or []) if g]
        year = doc.get("year")
        rating = doc.get("rating_score") or doc.get("avg_rate")
        try:
            rating = float(rating) if rating is not None else None
        except (TypeError, ValueError):
            rating = None

        return RomEntry(
            source=self.id,
            source_id=slug,
            title=name,
            system=system,
            url=f"{self.base}/game/{slug}/",
            cover=cover,
            rating=rating,
            rating_count=doc.get("rating_count"),
            downloads=doc.get("popularity"),
            year=year if isinstance(year, int) else None,
            developer=", ".join(doc.get("developers") or []) or None,
            publisher=", ".join(doc.get("publishers") or []) or None,
            genres=genres,
            extra={"platforms": platforms},
        )

    # ------------------------------------------------------------------ details
    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        html = await self.http.get_text(entry.url)
        files = self._parse_downloads(html, entry)
        entry.extra["download_html_seen"] = bool(files)
        # The game page carries the real box art ("default" image).
        boxart = self._parse_boxart(html)
        if boxart:
            entry.cover_full = boxart
            entry.cover = entry.cover or boxart
            entry.extra["boxart"] = boxart
        return files

    @staticmethod
    def _parse_boxart(html: str) -> Optional[str]:
        """Find the cover image (data-source) on a MyAbandonware game page."""
        candidates = re.findall(r'data-source="(/media/img/[^"]+)"', html)
        for path in candidates:
            if "/default/" in path and path.lower().endswith((".jpg", ".png", ".jpeg", ".webp")):
                return absolute("https://www.myabandonware.com", path)
        m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html, re.I)
        if m:
            return absolute("https://www.myabandonware.com", m.group(1))
        return None

    def _parse_downloads(self, html: str, entry: RomEntry) -> List[RomFile]:
        platform_titles = [(m.start(), collapse_ws(strip_tags(m.group(1)))) for m in _PLATFORM_TITLE_RE.finditer(html)]
        files: List[RomFile] = []
        for index, m in enumerate(_DOWNLOAD_RE.finditer(html)):
            tag = m.group(0)
            href = _HREF_RE.search(tag)
            if not href:
                continue
            size_m = _SIZE_RE.search(tag)
            size = None
            if size_m:
                try:
                    # data-file-size is the archive size in bytes.
                    size = int(float(size_m.group(1)))
                except ValueError:
                    size = None
            platform = ""
            for pos, label in platform_titles:
                if pos < m.start():
                    platform = label.replace(" version", "").strip()
                else:
                    break
            download_url = absolute(self.base, href.group(1))
            files.append(
                RomFile(
                    id=f"{entry.source_id}-{index}",
                    filename="",
                    url=download_url,
                    size=size,
                    label=platform or None,
                    source_url=entry.url,
                )
            )
        return files

    async def resolve_download(self, rom_file: RomFile) -> str:
        """Turn /download/<id>-<slug> into the real archive URL.

        MyAbandonware only hands out the file after a session cookie has been
        established on the game page, so we fetch that page first and then let
        the redirect point at the archive.
        """
        if not rom_file.source_url:
            return rom_file.url
        headers = {"Referer": rom_file.source_url}
        await self.http.get_text(rom_file.source_url, headers=headers)
        return await self.http.resolve_redirect(rom_file.url, headers=headers)

    def describe(self) -> Dict[str, Any]:
        data = super().describe()
        data["base_url"] = self.base
        return data
