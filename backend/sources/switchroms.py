"""Nintendo Switch source (nintendo-switch-roms.com).

A Switch specific catalogue with several hundred titles. The game pages are
server rendered and link straight to the .nsp/.xci file, so no captcha or
JavaScript is involved. The base URL is a setting, which makes it easy to
point the adapter at a mirror of the same site.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urlparse

from ..htmlutil import absolute, collapse_ws, strip_tags
from ..models import RomEntry, RomFile, extract_region
from .base import Source, SourceError

DEFAULT_BASE = "https://nintendo-switch-roms.com"

_FILE_HOSTS = ("berkasdrive", "direct-stor")
_FILE_RE = re.compile(r'href="(https?://[^"]+?\.(?:nsp|xci|nspz|xcz)(?:\?[^"]*)?)"', re.I)
_SIZE_RE = re.compile(r"([\d.,]+\s*(?:GB|MB))", re.I)
_RESULT_RE = re.compile(
    r'<div class="search-grid-img[^"]*">\s*<a href="([^"]+)">(.*?)</a>.*?'
    r'<h4 class="search-grid-title[^"]*">\s*<a href="([^"]+)">(.*?)</a>',
    re.I | re.S,
)
_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)


class SwitchRomsSource(Source):
    id = "switchroms"
    label = "Switch ROMs"
    homepage = DEFAULT_BASE
    supports_browse = True

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.id = self.options.get("source_id", self.id)
        self.label = self.options.get("label", self.label)
        self.homepage = self.options.get("homepage", self.homepage)
        self.base = (self.options.get("base_url") or self.homepage or DEFAULT_BASE).rstrip("/")
        self._pages: Dict[str, str] = {}

    # ------------------------------------------------------------------ search
    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        from urllib.parse import quote_plus

        term = quote_plus(query)
        url = f"{self.base}/?s={term}" if page <= 1 else f"{self.base}/page/{page}/?s={term}"
        html = await self.http.get_text(url)
        return self._parse_results(html)[:limit]

    async def browse(self, system: str, limit: int = 200) -> List[RomEntry]:
        """Walk the catalogue pages so the browse view shows the whole library."""
        entries: List[RomEntry] = []
        seen = set()
        for page in range(1, 13):
            url = f"{self.base}/" if page == 1 else f"{self.base}/page/{page}/"
            try:
                html = await self.http.get_text(url)
            except Exception:
                break
            found = self._parse_cards(html)
            if not found:
                break
            added = 0
            for entry in found:
                if entry.url in seen:
                    continue
                seen.add(entry.url)
                entry.rank = len(entries)
                entries.append(entry)
                added += 1
            if added == 0 or len(entries) >= limit:
                break
        return entries[:limit]

    def _parse_cards(self, html: str) -> List[RomEntry]:
        """Parse the card grid used on the catalogue page."""
        entries: List[RomEntry] = []
        seen = set()
        host = urlparse(self.base).netloc
        pattern = re.compile(
            r'<a[^>]+href="(https?://' + re.escape(host) + r'/[^\"#?]+/)"[^>]*>(.*?)</a>',
            re.I | re.S,
        )
        for match in pattern.finditer(html):
            href, inner = match.group(1), match.group(2)
            if href in seen:
                continue
            path = urlparse(href).path
            if re.match(r"^/\d{4}/\d{2}/\d{2}/?$", path):
                continue
            if path.startswith(("/author/", "/category/", "/tag/", "/feed", "/page/")):
                continue
            if path.strip("/") in ("", "nintendo-switch-roms"):
                continue
            title = collapse_ws(strip_tags(inner))
            if not title or len(title) < 6:
                continue
            if title.lower() in ("read more", "download") or title.lower().startswith("by "):
                continue
            title = self._clean_title(title)
            if not title:
                continue
            seen.add(href)
            cover = self._nearby_image(html, match.start())
            entries.append(
                RomEntry(
                    source=self.id,
                    source_id=href,
                    title=title,
                    system="switch",
                    url=href,
                    cover=cover,
                    region=extract_region(title),
                    rank=len(entries),
                )
            )
        return entries

    @staticmethod
    def _nearby_image(html: str, position: int) -> Optional[str]:
        window = html[max(0, position - 1600): position]
        matches = list(_IMG_RE.finditer(window))
        for match in reversed(matches):
            src = match.group(1)
            if "/uploads/" in src:
                return src
        return None

    @staticmethod
    def _clean_title(title: str) -> str:
        title = re.sub(r"^Download\s*[-–|]\s*", "", title, flags=re.I)
        title = re.sub(r"\s*[-–|]\s*Download\s*$", "", title, flags=re.I)
        # "Fire Emblem Warriors Switch NSP XCI Plus ROMs Free Download"
        title = re.sub(r"\s+Plus\s+ROMs?\s+Free\s+Download\s*$", "", title, flags=re.I)
        title = re.sub(r"\s+Free\s+Download\s*$", "", title, flags=re.I)
        title = re.sub(r"\s+Switch\s+(?:ROMs?\s+)?(?:NSP\s*/?\s*XCI|NSP|XCI)\b", " ", title, flags=re.I)
        title = re.sub(r"\s+ROMs?\s*$", "", title, flags=re.I)
        title = re.sub(r"\s{2,}", " ", title)
        return title.strip()

    # ------------------------------------------------------------------ parsing
    def _parse_results(self, html: str) -> List[RomEntry]:
        entries: List[RomEntry] = []
        seen = set()
        for match in _RESULT_RE.finditer(html):
            image_href, image_html, title_href, title_html = match.groups()
            url = title_href.strip()
            if url in seen:
                continue
            seen.add(url)
            title = self._clean_title(collapse_ws(strip_tags(title_html)))
            if not title:
                continue
            cover = None
            img = _IMG_RE.search(image_html)
            if img:
                cover = absolute(self.base, img.group(1))
            entries.append(
                RomEntry(
                    source=self.id,
                    source_id=url,
                    title=title,
                    system="switch",
                    url=absolute(self.base, url),
                    cover=cover,
                    region=extract_region(title),
                    rank=len(entries),
                )
            )
        return entries

    # ------------------------------------------------------------------ details
    async def _page(self, url: str) -> str:
        cached = self._pages.get(url)
        if cached is not None:
            return cached
        html = await self.http.get_text(url)
        if len(self._pages) > 24:
            self._pages.clear()
        self._pages[url] = html
        return html

    async def media(self, entry: RomEntry) -> Optional[Dict[str, Any]]:
        """The site publishes wallpapers/box art for every game."""
        try:
            html = await self._page(entry.url)
        except Exception:
            return None
        urls: List[str] = []
        # Only the images of the game itself - the page also links the
        # artwork of related and popular games.
        body = self._own_content(html)
        for match in re.finditer(r'src="(https?://[^"]+/wp-content/uploads/[^"]+)"', body):
            url = match.group(1).split("?")[0]
            if "logo" in url.lower() or url in urls:
                continue
            urls.append(url)
            if len(urls) >= 5:
                break
        if not urls:
            return None
        shots = [{"kind": "image", "thumb": url, "full": url} for url in urls]
        return {"shots": shots, "caption": entry.title}

    @staticmethod
    def _own_content(html: str) -> str:
        """The part of the page that belongs to the game itself."""
        for marker in ('class="entry-content"', 'class="post-content"', 'id="the-content"'):
            start = html.find(marker)
            if start == -1:
                continue
            end = html.find("</article>", start)
            return html[start: end if end != -1 else len(html)]
        # Fall back to the main article block.
        start = html.find("<article")
        end = html.find("</article>", start)
        if start != -1 and end != -1:
            return html[start:end]
        return html

    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        html = await self._page(entry.url)
        match = _FILE_RE.search(html)
        if not match:
            # Some pages only expose the link through the download button.
            match = re.search(
                r'<a[^>]+href="(https?://[^"]+)"[^>]*>(?:(?!</a>).)*?Download\s+Rom',
                html, re.I | re.S,
            )
        if not match:
            return []
        url = match.group(1).replace("&amp;", "&")
        filename = self._filename_from(url)
        size = await self._remote_size(url, entry.url)
        return [
            RomFile(
                id=f"{entry.source_id}-0",
                filename=filename,
                url=url,
                size=size,
                region=entry.region,
                label=entry.region,
                source_url=entry.url,
            )
        ]

    @staticmethod
    def _filename_from(url: str) -> str:
        parsed = urlparse(url)
        query = parsed.query
        name = ""
        if "filename=" in query:
            name = query.split("filename=", 1)[1]
            name = name.split("&", 1)[0]
        if not name:
            name = parsed.path.rsplit("/", 1)[-1]
        name = unquote(name)
        name = re.sub(r"^\d+[a-z0-9]*-", "", name)  # strip the hash prefix
        return name or "switch-rom.nsp"

    async def _remote_size(self, url: str, referer: str) -> Optional[int]:
        """Ask the file host how big the file is (the pages do not say)."""
        try:
            response = await self.http.request(
                url, "HEAD", headers={"Referer": referer}, max_bytes=1024, retries=1
            )
            length = response.headers.get("content-length")
            return int(length) if length and length.isdigit() else None
        except Exception:
            return None

    def describe(self) -> Dict[str, Any]:
        data = super().describe()
        data["base_url"] = self.base
        return data
