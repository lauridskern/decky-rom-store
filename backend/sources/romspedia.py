"""Romspedia adapter (https://www.romspedia.com).

Romspedia renders everything server side, which makes it the friendliest of
the three sources to scrape:

* search    -> /search?search_term_string=<q>   (cards: div.single-rom)
* browse    -> /roms/<console>
* detail    -> /roms/<console>/<slug>            (div.view-emulator-detail pairs)
* file      -> /roms/<console>/<slug>/download   (links to downloads.romspedia.com)
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from ..htmlutil import (
    absolute,
    collapse_ws,
    iter_anchors,
    iter_blocks,
    parse_attrs,
    parse_size,
    strip_tags,
)
from ..models import RomEntry, RomFile, extract_region
from ..systems import canonical_system, system_label
from .base import Source, SourceError

DEFAULT_BASE = "https://www.romspedia.com"

# romspedia console slug -> canonical system key
CONSOLE_MAP = {
    "gameboy": "gb",
    "gameboy-advance": "gba",
    "gameboy-color": "gbc",
    "mame": "mame",
    "nintendo": "nes",
    "nintendo-3ds": "3ds",
    "nintendo-64": "n64",
    "nintendo-ds": "nds",
    "nintendo-wii": "wii",
    "nintendo-wii-u": "wiiu",
    "nintendo-switch": "switch",
    "playstation-1": "psx",
    "playstation-2": "ps2",
    "playstation-3": "ps3",
    "playstation-portable": "psp",
    "playstation-vita": "psvita",
    "super-nintendo": "snes",
    "sega-genesis": "genesis",
    "sega-master-system": "mastersystem",
    "sega-game-gear": "gamegear",
    "sega-saturn": "saturn",
    "sega-dreamcast": "dreamcast",
    "gamecube": "gc",
}

_DOWNLOAD_RE = re.compile(r'href="(https://downloads\.romspedia\.com/[^"]+)"', re.I)
_FILE_LINK_RE = re.compile(r'href="(https://static\.romspedia\.com[^"]*?cover[^"]*?\.webp)"', re.I)


class RomspediaSource(Source):
    id = "romspedia"
    label = "Romspedia"
    homepage = "https://www.romspedia.com"
    supports_browse = True
    supports_regions = True

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.base = (self.options.get("base_url") or DEFAULT_BASE).rstrip("/")

    # ------------------------------------------------------------------ search
    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        from urllib.parse import quote_plus

        html = await self.http.get_text(self._search_url(query, page))
        entries = self._parse_cards(html)
        self._last_page_count = self._page_count(html)
        return entries[:limit]

    def _search_url(self, query: str, page: int = 1) -> str:
        from urllib.parse import quote_plus

        term = quote_plus(query)
        if page <= 1:
            return f"{self.base}/search?search_term_string={term}"
        return f"{self.base}/search.php?currentpage={page}&search_term_string={term}"

    @staticmethod
    def _page_count(html: str) -> int:
        pages = [int(m) for m in re.findall(r"currentpage=(\d+)", html)]
        return max(pages) if pages else 1

    async def browse(self, system: str, limit: int = 40) -> List[RomEntry]:
        slug = self._slug_for(system)
        if not slug:
            return []
        html = await self.http.get_text(f"{self.base}/roms/{slug}")
        return self._parse_cards(html)[:limit]

    def _slug_for(self, system: str) -> Optional[str]:
        for slug, key in CONSOLE_MAP.items():
            if key == system:
                return slug
        return None

    # ------------------------------------------------------------------ parsing
    def _parse_cards(self, html: str) -> List[RomEntry]:
        entries: List[RomEntry] = []
        seen = set()

        def build(detail_href: str, block: str) -> Optional[RomEntry]:
            parts = [p for p in detail_href.split("/") if p]
            if len(parts) != 3 or parts[0] != "roms":
                return None
            console_slug, slug = parts[1], parts[2]
            if slug in seen:
                return None
            title = self._card_title(block) or self._card_title_from_link(block, detail_href)
            if not title:
                return None
            seen.add(slug)
            system = CONSOLE_MAP.get(console_slug) or canonical_system(console_slug)
            return RomEntry(
                source=self.id,
                source_id=f"{console_slug}/{slug}",
                title=title,
                system=system,
                url=absolute(self.base, f"/roms/{console_slug}/{slug}"),
                cover=self._card_cover(block),
                cover_full=self._card_cover(block),
                downloads=self._card_downloads(block),
                rating=self._card_rating(block),
                region=extract_region(title),
            )

        # Pass 1 - search results wrap the whole card in an <a>.
        for anchor in iter_anchors(html):
            if "single-rom" not in anchor.inner:
                continue
            entry = build(anchor.href.split("?")[0].rstrip("/"), anchor.inner)
            if entry:
                entry.rank = len(entries)
                entries.append(entry)

        # Pass 2 - console listings keep the card in a div with the link inside.
        if not entries:
            for _open, block in iter_blocks(html, "div", 'class="single-rom"'):
                m = re.search(r'href="(/roms/[^"/]+/[^"/]+)"', block, re.I)
                if not m:
                    continue
                entry = build(m.group(1), block)
                if entry:
                    entry.rank = len(entries)
                    entries.append(entry)

        return entries

    @staticmethod
    def _card_title_from_link(block: str, detail_href: str) -> Optional[str]:
        m = re.search(r'<a[^>]*href="%s"[^>]*title="([^"]+)"' % re.escape(detail_href), block, re.I)
        if m:
            return collapse_ws(strip_tags(m.group(1))).replace(" ROM", "").strip()
        return None

    @staticmethod
    def _card_title(inner: str) -> Optional[str]:
        m = re.search(r'<h2[^>]*class="roms-title"[^>]*>(.*?)</h2>', inner, re.I | re.S)
        if m:
            return collapse_ws(strip_tags(m.group(1)))
        return None

    @staticmethod
    def _card_downloads(inner: str) -> Optional[int]:
        m = re.search(r'<span[^>]*class="down-number"[^>]*>([\d,.]+)</span>', inner, re.I)
        if not m:
            return None
        try:
            return int(m.group(1).replace(",", ""))
        except ValueError:
            return None

    @staticmethod
    def _card_rating(inner: str) -> Optional[float]:
        m = re.search(r'class="list-rom-rating"[^>]*data-rating="([\d.]+)"', inner, re.I)
        if not m:
            m = re.search(r'data-rating="([\d.]+)"', inner, re.I)
        if not m:
            return None
        try:
            return float(m.group(1))
        except ValueError:
            return None

    @staticmethod
    def _card_cover(block: str) -> Optional[str]:
        # Box art first, fall back to the wide thumbnail.
        m = re.search(r'src="(https://static\.romspedia\.com[^"]*?-cover\.webp)"', block, re.I)
        if not m:
            m = re.search(r'src="(https://static\.romspedia\.com[^"]*?\.webp)"', block, re.I)
        if not m:
            m = re.search(r'srcset="(https://static\.romspedia\.com[^",]*?\.webp)', block, re.I)
        if not m:
            return None
        return re.sub(r"\s+", "", m.group(1))

    # ------------------------------------------------------------------ details
    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        html = await self.http.get_text(entry.url)
        details = self._parse_details(html)

        # The detail page links to a /download page that in turn points at the
        # real file on downloads.romspedia.com.
        download_page = None
        m = re.search(r'id="btnDownload"[^>]*href="([^"]+)"', html, re.I)
        if not m:
            m = re.search(r'href="([^"]*/download[^"]*)"', html, re.I)
        if m:
            download_page = absolute(self.base, m.group(1))

        files: List[RomFile] = []
        filename = details.get("File Name")
        size = parse_size(details.get("Size"))

        if download_page:
            try:
                page = await self.http.get_text(download_page)
                fm = _DOWNLOAD_RE.search(page)
                if fm:
                    url = re.sub(r"\s+", " ", fm.group(1)).replace(" ", "%20")
                else:
                    url = download_page
            except Exception:
                url = download_page
        else:
            url = entry.url

        name = filename or (url.rsplit("/", 1)[-1] or f"{entry.title}.zip")
        files.append(
            RomFile(
                id=f"{entry.source_id}-0",
                filename=name,
                url=url,
                size=size,
                region=details.get("Region") or entry.region,
                label=details.get("Region"),
                source_url=entry.url,
            )
        )

        entry.rating = entry.rating or self._number(details.get("Rating"))
        entry.year = entry.year or self._int(details.get("Release Year"))
        entry.downloads = entry.downloads or self._int(details.get("Downloads"))
        entry.size = entry.size or size
        entry.region = details.get("Region") or entry.region
        entry.summary = details.get("Category")
        entry.extra.setdefault("details", details)
        return files

    @staticmethod
    def _parse_details(html: str) -> Dict[str, str]:
        details: Dict[str, str] = {}
        pattern = re.compile(
            r'<div[^>]*class="view-emulator-detail-name"[^>]*>(.*?)</div>\s*'
            r'<div[^>]*class="view-emulator-detail-value"[^>]*>(.*?)</div>',
            re.I | re.S,
        )
        for m in pattern.finditer(html):
            key = collapse_ws(strip_tags(m.group(1))).rstrip(":").strip()
            value = collapse_ws(strip_tags(m.group(2)))
            if key:
                details[key] = value
        # Rating is rendered as a data attribute.
        if "Rating" not in details:
            m = re.search(r'data-rating="([\d.]+)"', html, re.I)
            if m:
                details["Rating"] = m.group(1)
        return details

    @staticmethod
    def _number(value) -> Optional[float]:
        try:
            return float(str(value).strip())
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _int(value) -> Optional[int]:
        try:
            return int(str(value).replace(",", "").strip())
        except (TypeError, ValueError):
            return None

    def describe(self) -> Dict[str, Any]:
        data = super().describe()
        data["base_url"] = self.base
        data["configured"] = True
        return data
