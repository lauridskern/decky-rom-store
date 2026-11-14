"""Retrostic / RomsDL adapter.

Both sites run the same software, so a single adapter serves both:

* search   -> /search?q=<term>          (table#romstable)
* browse   -> /roms/<console>            (same table)
* detail   -> /roms/<console>/<slug>     (metadata table + download form)
* download -> POST /roms/<console>/<slug>/download with the form's session
              token, the response page then contains the real file url.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from urllib.parse import unquote

from ..htmlutil import absolute, collapse_ws, parse_size, strip_tags
from ..models import RomEntry, RomFile, extract_region
from ..systems import canonical_system
from .base import Source, SourceError

DEFAULT_BASE = "https://www.retrostic.com"

_ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)
_CARD_RE = re.compile(r'<a\b[^>]*class="[^"]*rom-box[^"]*"[^>]*>(.*?)</a>', re.I | re.S)
_H3_RE = re.compile(r"<h3\b[^>]*>(.*?)</h3>", re.I | re.S)
_H4_RE = re.compile(r"<h4\b[^>]*>(.*?)</h4>", re.I | re.S)
_CELL_RE = re.compile(r"<td\b[^>]*>(.*?)</td>", re.I | re.S)
_HREF_RE = re.compile(r'href="(/roms/[^"]+)"')
_NAME_RE = re.compile(r'<p[^>]*itemprop="name"[^>]*>(.*?)</p>', re.I | re.S)
_IMG_RE = re.compile(r'(?:data-src|src)="(/img/[^"]+)"', re.I)
_META_RE = re.compile(r"<td[^>]*>\s*([^<]{2,28}?:)\s*</td>\s*<td[^>]*>(.*?)</td>", re.I | re.S)
_FORM_RE = re.compile(r"<form\b([^>]*)>(.*?)</form>", re.I | re.S)
_INPUT_RE = re.compile(r'name="([^"]+)"\s+value="([^"]*)"', re.I)
_FILE_RE = re.compile(r'window\.location\.href\s*=\s*"([^"]+)"', re.I)

# Console names as the site spells them -> canonical system key.
CONSOLE_ALIASES = {
    "cps 1": "arcades",
    "cps 2": "arcades",
    "cps 3": "arcades",
    "capcom play system 1": "arcades",
    "capcom play system 2": "arcades",
    "capcom play system 3": "arcades",
    "naomi": "arcades",
    "famicom": "nes",
    "megadrive": "genesis",
    "mega drive": "genesis",
    "master system": "mastersystem",
    "game gear": "gamegear",
    "turbo grafx 16": "pcengine",
    "turbografx 16": "pcengine",
    "virtual boy": "virtualboy",
    "wonder swan": "wonderswan",
    "wonder swan color": "wonderswan-color",
    "neo geo pocket": "ngp",
    "neo geo pocket color": "ngpc",
    "zx spectrum": "zxspectrum",
    "bbc micro": "unknown",
    "cd i": "unknown",
    "c64 preservation": "c64",
    "c64 tapes": "c64",
    "sega 32x": "sega32x",
    "sharp x68000": "x68000",
    "atari st": "atarist",
    "atari jaguar": "jaguar",
    "atari lynx": "atarilynx",
    "gamecube": "gc",
    "nintendo gamecube": "gc",
    "playstation": "psx",
    "ps1": "psx",
    "ps2": "ps2",
    "ps3": "ps3",
    "psp": "psp",
    "nintendo 64": "n64",
    "nintendo ds": "nds",
    "game boy": "gb",
    "game boy color": "gbc",
    "game boy advance": "gba",
    "super nintendo": "snes",
    "nintendo entertainment system": "nes",
}


class RetrosticSource(Source):
    id = "retrostic"
    label = "Retrostic"
    homepage = "https://www.retrostic.com"
    supports_browse = True

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.id = self.options.get("source_id", self.id)
        self.label = self.options.get("label", self.label)
        self.homepage = self.options.get("homepage", self.homepage)
        self.base = (self.options.get("base_url") or self.homepage or DEFAULT_BASE).rstrip("/")

    # ------------------------------------------------------------------ search
    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        from urllib.parse import quote_plus

        url = f"{self.base}/search?search_term_string={quote_plus(query)}"
        html = await self.http.get_text(url)
        return self._parse_rows(html)[:limit]

    async def browse(self, system: str, limit: int = 40) -> List[RomEntry]:
        slug = self._slug_for(system)
        if not slug:
            return []
        html = await self.http.get_text(f"{self.base}/roms/{slug}")
        return self._parse_rows(html)[:limit]

    def _slug_for(self, system: str) -> Optional[str]:
        """Map a canonical system onto the console slug this site uses."""
        wanted = {
            "nds": "nintendo-ds",
            "gba": "gameboy-advance",
            "gbc": "gameboy-color",
            "gb": "gameboy",
            "nes": "nintendo",
            "snes": "super-nintendo",
            "gc": "nintendo-gamecube",
            "wii": "nintendo-wii",
            "n64": "nintendo-64",
            "psx": "playstation-1",
            "ps2": "playstation-2",
            "ps3": "playstation-3",
            "psp": "playstation-portable",
            "c64": "commodore-64-preservation",
            "arcades": "capcom-play-system-1",
        } if self.id == "romsdl" else {
            "3do": "3do", "atari2600": "atari-2600", "atari5200": "atari-5200",
            "atari7800": "atari-7800", "atarilynx": "atari-lynx", "atarist": "atari-st",
            "jaguar": "atari-jaguar", "arcades": "cps-1", "mame": "mame",
            "c64": "c64-preservation", "dreamcast": "dreamcast", "nes": "nes",
            "famicom": "famicom", "gamegear": "game-gear", "gc": "gamecube",
            "gb": "gb", "gba": "gba", "gbc": "gbc", "mastersystem": "master-system",
            "genesis": "megadrive", "n64": "n64", "nds": "nds", "neogeo": "neo-geo",
            "ngp": "neo-geo-pocket", "psx": "ps-1", "ps2": "ps-2", "ps3": "ps-3",
            "psp": "psp", "saturn": "saturn", "sega32x": "sega-32x",
            "snes": "snes", "pcengine": "turbografx16", "virtualboy": "virtual-boy",
            "wii": "wii", "wonderswan": "wonderswan",
            "wonderswan-color": "wonderswan-color", "x68000": "sharp-x68000",
            "zxspectrum": "zx-spectrum",
        }
        return wanted.get(system)

    # ------------------------------------------------------------------ parsing
    def _parse_rows(self, html: str) -> List[RomEntry]:
        entries: List[RomEntry] = []
        seen = set()
        # Some deployments of the same engine use a card layout instead of a
        # table - handle both.
        for card_match in _CARD_RE.finditer(html):
            entry = self._parse_card(card_match.group(0), card_match.group(1), seen)
            if entry:
                entries.append(entry)
        if entries:
            return entries
        for row_match in _ROW_RE.finditer(html):
            row = row_match.group(1)
            href_match = _HREF_RE.search(row)
            if not href_match:
                continue
            href = href_match.group(1)
            if href in seen:
                continue
            seen.add(href)

            cells = _CELL_RE.findall(row)
            title = ""
            name_match = _NAME_RE.search(row)
            if name_match:
                title = collapse_ws(strip_tags(name_match.group(1)))
            elif len(cells) > 2:
                title = collapse_ws(strip_tags(cells[2]))
            if not title:
                continue

            console_name = ""
            if len(cells) > 3:
                console_name = collapse_ws(strip_tags(cells[3]))
            downloads = None
            if len(cells) > 4:
                try:
                    downloads = int(collapse_ws(strip_tags(cells[4])).replace(",", "") or 0) or None
                except ValueError:
                    downloads = None

            system = CONSOLE_ALIASES.get(console_name.lower().strip(), canonical_system(console_name))
            if system == "unknown":
                parts = [p for p in href.split("/") if p]
                system = canonical_system(parts[1] if len(parts) > 2 else console_name)

            entries.append(
                RomEntry(
                    source=self.id,
                    source_id=href.strip("/"),
                    title=title,
                    system=system,
                    url=absolute(self.base, href),
                    cover=self._row_image(row),
                    downloads=downloads,
                    region=extract_region(title),
                )
            )
        return entries

    def _parse_card(self, card: str, body: str, seen: set) -> Optional[RomEntry]:
        href_match = _HREF_RE.search(card)
        if not href_match:
            return None
        href = href_match.group(1)
        if href in seen:
            return None
        seen.add(href)

        title = ""
        name_match = _NAME_RE.search(body)
        if name_match:
            title = collapse_ws(strip_tags(name_match.group(1)))
        if title.lower().startswith("name:"):
            title = title[5:].strip()
        if not title:
            heads = _H3_RE.findall(body)
            if heads:
                title = collapse_ws(strip_tags(heads[0]))
                if title.lower().startswith("name:"):
                    title = title[5:].strip()
        if not title:
            return None

        console_name = ""
        downloads = None
        for head in _H4_RE.findall(body):
            text = collapse_ws(strip_tags(head))
            if text.lower().startswith("console:"):
                console_name = text[8:].strip()
            else:
                number = re.match(r"([\d,]+)", text)
                if number:
                    try:
                        downloads = int(number.group(1).replace(",", "")) or None
                    except ValueError:
                        downloads = None

        system = CONSOLE_ALIASES.get(console_name.lower().strip(), canonical_system(console_name))
        if system == "unknown":
            parts = [p for p in href.split("/") if p]
            system = canonical_system(parts[1] if len(parts) > 2 else console_name)

        return RomEntry(
            source=self.id,
            source_id=href.strip("/"),
            title=title,
            system=system,
            url=absolute(self.base, href),
            cover=self._row_image(body),
            downloads=downloads,
            region=extract_region(title),
        )

    @staticmethod
    def _row_image(row: str) -> Optional[str]:
        for match in _IMG_RE.finditer(row):
            path = match.group(1)
            if "spinner" in path or "no-image" in path or "flags/" in path or "logo" in path:
                continue
            return path
        return None

    # ------------------------------------------------------------------ details
    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        html = await self.http.get_text(entry.url)
        details = self._parse_meta(html)
        if details.get("File Name"):
            entry.size = entry.size or parse_size(details.get("File Size"))
            entry.region = entry.region or details.get("Region")
            entry.year = entry.year or _to_int(details.get("Release Year"))
            entry.downloads = entry.downloads or _to_int(details.get("Downloads"))
            entry.summary = entry.summary or details.get("Genre/s")
            entry.extra["details"] = details

        cover = self._detail_image(html)
        if cover:
            entry.cover_full = cover
            entry.cover = entry.cover or cover

        form = self._download_form(html)
        if not form:
            return []
        action, fields = form
        if not fields:
            return []
        action = absolute(self.base, action)

        files: List[RomFile] = []
        try:
            response = await self.http.post_form(action, fields)
        except Exception as exc:
            entry.extra["error"] = f"{type(exc).__name__}: {exc}"
            return []

        file_match = _FILE_RE.search(response.text)
        url = file_match.group(1) if file_match else ""
        filename = unquote(details.get("File Name") or (url.rsplit("/", 1)[-1] if url else ""))
        if not url:
            return []
        files.append(
            RomFile(
                id=f"{entry.source_id}-0",
                filename=filename,
                url=url,
                size=parse_size(details.get("File Size")),
                region=details.get("Region"),
                label=details.get("Region"),
                source_url=entry.url,
            )
        )
        return files

    @staticmethod
    def _download_form(html: str) -> Optional[tuple]:
        """Find the download form (id="dl") and its hidden fields."""
        for match in _FORM_RE.finditer(html):
            attrs, body = match.group(1), match.group(2)
            if "dl" not in re.findall(r'id="([^"]+)"', attrs):
                continue
            action_match = re.search(r'action="([^"]+)"', attrs, re.I)
            if not action_match:
                continue
            fields = {name: value for name, value in _INPUT_RE.findall(body)}
            return action_match.group(1), fields
        return None

    @staticmethod
    def _parse_meta(html: str) -> Dict[str, str]:
        details: Dict[str, str] = {}
        for match in _META_RE.finditer(html):
            key = collapse_ws(strip_tags(match.group(1))).rstrip(":").strip()
            value = collapse_ws(strip_tags(match.group(2)))
            if key:
                details[key] = value
        return details

    @staticmethod
    def _detail_image(html: str) -> Optional[str]:
        match = re.search(r'<img[^>]*class="img-fluid"[^>]*src="(/img/[^"]+)"', html, re.I)
        if match and "no-image" not in match.group(1):
            return match.group(1)
        return None

    def describe(self) -> Dict[str, Any]:
        data = super().describe()
        data["base_url"] = self.base
        return data


def _to_int(value: Optional[str]) -> Optional[int]:
    try:
        return int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
