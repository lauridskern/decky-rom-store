"""Generic, configuration driven ROM source.

This adapter powers the "DumbRoms" entry. That site is not resolvable at the
moment (dumbroms.com does not exist in DNS), so the adapter is written to be
pointed at *any* simple ROM index: the base URL, the search URL template and
the download link pattern are all settings, and the parsing is heuristic
enough to cope with WordPress style themes as well as hand rolled ones.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urljoin, urlparse

from ..htmlutil import absolute, collapse_ws, iter_anchors, safe_filename, strip_tags
from ..models import RomEntry, RomFile, extract_region
from ..systems import canonical_system
from .base import Source, SourceError

DEFAULT_BASE = "https://dumbroms.com"

FILE_EXTENSIONS = (
    ".zip", ".7z", ".rar", ".iso", ".bin", ".cue", ".chd", ".gzip", ".gz",
    ".xci", ".nsp", ".nsz", ".xcz", ".wbfs", ".cia", ".3ds", ".nds", ".gba",
    ".gb", ".gbc", ".nes", ".sfc", ".smc", ".md", ".gen", ".64", ".z64", ".n64",
    ".v64", ".iso", ".wad", ".lnx", ".a26", ".j64", ".p64", ".g64", ".v64",
)

SKIP_PATH_HINTS = (
    "/about", "/contact", "/faq", "/privacy", "/terms", "/dmca", "/login",
    "/register", "/signup", "/sign-in", "/account", "/cart", "/checkout",
    "/donate", "/blog", "/news", "/forum", "/member", "/advertise", "/sitemap",
    "/tag/", "/category/", "/author/", "/page/", "/wp-content", "/feed",
    "/rss", "/search", "/browse", "/list", "/index.php", "/privacy-policy",
)

SKIP_EXTS = (
    ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
    ".woff", ".woff2", ".ttf", ".mp4", ".webm", ".mp3", ".pdf", ".xml", ".rss",
)

DOWNLOAD_HINTS = ("download", "mirror", "direct", "file", "rom")


class DumbRomsSource(Source):
    id = "dumbroms"
    label = "DumbRoms"
    homepage = DEFAULT_BASE
    supports_browse = True

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.base = (self.options.get("base_url") or DEFAULT_BASE).rstrip("/")
        self.search_template = (
            self.options.get("search_url") or "{base}/search?q={query}"
        )
        self.detail_template = self.options.get("detail_url") or ""

    # ------------------------------------------------------------------ search
    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        last_error: Optional[str] = None
        for url in self._candidate_search_urls(query, page):
            try:
                html = await self.http.get_text(url)
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                continue
            entries = self._parse_cards(html, base=url)
            if entries:
                return entries[:limit]
            # The page loaded but held no recognisable result links.
            last_error = None
        if last_error:
            raise SourceError(f"Could not reach {self.base} ({last_error})")
        return []

    def _candidate_search_urls(self, query: str, page: int = 1) -> List[str]:
        encoded = quote_plus(query)
        encoded_path = re.sub(r"[^A-Za-z0-9._-]+", "-", query).strip("-")
        templates = [
            self.search_template,
            "{base}/search?q={query}",
            "{base}/?s={query}",
            "{base}/search/{query}",
            "{base}/search/{query}/",
            "{base}/roms/{query}",
        ]
        urls: List[str] = []
        for template in templates:
            if "{query}" not in template:
                continue
            candidate = template.format(base=self.base, query=encoded, query_path=encoded_path, page=page)
            if page > 1 and "{page}" not in template:
                candidate = f"{candidate}&page={page}" if "?" in candidate else f"{candidate}?page={page}"
            if candidate not in urls:
                urls.append(candidate)
        return urls

    # ------------------------------------------------------------------ parsing
    def _parse_cards(self, html: str, base: str) -> List[RomEntry]:
        anchors = []
        for anchor in iter_anchors(html):
            href = anchor.href.strip()
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            absolute_href = absolute(base, href)
            parsed = urlparse(absolute_href)
            if parsed.netloc and urlparse(base).netloc and parsed.netloc != urlparse(base).netloc:
                continue
            path = parsed.path.lower()
            if any(path.endswith(ext) for ext in SKIP_EXTS):
                continue
            if any(hint in path for hint in SKIP_PATH_HINTS):
                continue
            if len(path.strip("/").split("/")) == 0:
                continue
            anchors.append((anchor, absolute_href, path))

        shapes: Dict[str, int] = {}
        for _anchor, _href, path in anchors:
            shape = self._shape(path)
            shapes[shape] = shapes.get(shape, 0) + 1

        ranked = sorted(shapes.items(), key=lambda kv: kv[1], reverse=True)
        detail_shapes = {shape for shape, count in ranked if count >= 3}

        entries: List[RomEntry] = []
        seen = set()
        for anchor, href, path in anchors:
            if self._shape(path) not in detail_shapes:
                continue
            if href in seen:
                continue
            seen.add(href)
            title = self._title_for(anchor)
            if not title:
                continue
            system = canonical_system(self._system_hint(anchor, path))
            entries.append(
                RomEntry(
                    source=self.id,
                    source_id=href,
                    title=title,
                    system=system,
                    url=href,
                    cover=self._cover_for(html, anchor.start),
                    region=extract_region(title),
                    rank=len(entries),
                )
            )
        return entries

    @staticmethod
    def _shape(path: str) -> str:
        parts = [p for p in path.split("/") if p]
        if not parts:
            return "/"
        if len(parts) == 1:
            return "/*"
        return "/" + "/".join(parts[:-1]) + "/*"

    @staticmethod
    def _title_for(anchor) -> Optional[str]:
        title = (anchor.attrs.get("title") or "").strip()
        if title:
            title = re.sub(r"\s*(ROM|ISO|download|game)\s*(download)?\s*$", "", title, flags=re.I).strip()
            if title:
                return collapse_ws(title)
        text = anchor.text.strip()
        if text and len(text) < 120:
            return collapse_ws(text)
        return None

    @staticmethod
    def _system_hint(anchor, path: str) -> str:
        for hint in ("data-platform", "data-system", "data-console"):
            if hint in anchor.attrs:
                return anchor.attrs[hint]
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 2:
            return parts[-2]
        return ""

    @staticmethod
    def _cover_for(html: str, position: int) -> Optional[str]:
        window = html[position: position + 1500]
        m = re.search(r'<img[^>]+src="([^"]+)"', window, re.I)
        if not m:
            return None
        url = m.group(1).strip()
        if url.startswith("data:"):
            return None
        return url

    # ------------------------------------------------------------------ details
    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        html = await self.http.get_text(entry.url)
        files = self._parse_files(html, entry)
        return files

    def _parse_files(self, html: str, entry: RomEntry) -> List[RomFile]:
        candidates: List[Tuple[int, str, str]] = []
        for anchor in iter_anchors(html):
            href = anchor.href.strip()
            if not href or href.startswith(("#", "javascript:")):
                continue
            path = urlparse(href).path.lower()
            if not any(path.endswith(ext) for ext in FILE_EXTENSIONS):
                continue
            label = anchor.text.strip() or anchor.attrs.get("title", "")
            score = 0
            if any(hint in href.lower() for hint in DOWNLOAD_HINTS):
                score += 5
            if any(hint in label.lower() for hint in DOWNLOAD_HINTS):
                score += 3
            if "download" in (anchor.attrs.get("class") or "").lower():
                score += 3
            candidates.append((score, href, label))

        candidates.sort(key=lambda item: -item[0])
        files: List[RomFile] = []
        seen = set()
        for index, (_score, href, label) in enumerate(candidates):
            if href in seen:
                continue
            seen.add(href)
            url = absolute(entry.url, href)
            name = safe_filename(url.rsplit("/", 1)[-1] or f"{entry.title}.zip")
            files.append(
                RomFile(
                    id=f"{entry.source_id}-{index}",
                    filename=name,
                    url=url,
                    label=collapse_ws(label) or None,
                    source_url=entry.url,
                )
            )
        return files

    def describe(self) -> Dict[str, Any]:
        data = super().describe()
        data["base_url"] = self.base
        data["search_url"] = self.search_template
        data["configured"] = bool(self.options.get("base_url"))
        return data
