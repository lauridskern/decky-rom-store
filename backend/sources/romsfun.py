"""RomsFun (https://romsfun.com).

Search:   /?s=<query>, more pages at /page/<n>/?s=<query>
Browse:   /roms/<console>/, more pages at /roms/<console>/page/<n>/
Games come in one of two layouts, depending on the page: "rf-li" list blocks
or grid cards. Both give the game page (/roms/<console>/<slug>.html, which also
names the console), a thumbnail, the title, a type chip ("Hack", "Fan
Translation") and a download count.

Downloading, the way a visitor's browser does it, as a guest:

1. the game page links to /download/<slug>-<id>
2. that page lists the files in a table (name, type, size), each linking to
   /download/<slug>-<id>/<n>
3. that page shows a short countdown ("Please wait 7 seconds"). Meanwhile its
   script asks the site for the link (POST admin-ajax.php, action
   k_get_download) and shows it when the countdown ends. The adapter makes the
   same request and waits out the same countdown before using the link.

No login, captcha or paywall is involved. If the site ever asks for one (its
guest download limit, a bot check), the adapter reports that and stops; it
does not try to get around it.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote_plus, unquote, urlparse

from ..htmlutil import absolute, collapse_ws, strip_tags, unescape
from ..models import RomEntry, RomFile, extract_region
from .base import Source, SourceError

DEFAULT_BASE = "https://romsfun.com"

# Romsfun console slug -> store console key. Consoles without an emulator on
# the Deck (PS4, Xbox, ...) are not listed and their games are skipped.
CONSOLES: Dict[str, str] = {
    "nes": "nes",
    "super-nintendo": "snes",
    "nintendo-64": "n64",
    "gamecube": "gc",
    "nintendo-wii": "wii",
    "wii-u": "wiiu",
    "game-boy": "gb",
    "game-boy-color": "gbc",
    "game-boy-advance": "gba",
    "nintendo-ds": "nds",
    "nintendo-3ds": "3ds",
    "nintendo-virtual-boy": "virtualboy",
    "nintendo-pokemon-mini": "pokemini",
    "sega-sg-1000": "sg1000",
    "sega-master-system": "mastersystem",
    "sega-genesis": "genesis",
    "sega-cd": "segacd",
    "32x": "sega32x",
    "sega-saturn": "saturn",
    "dreamcast": "dreamcast",
    "sega-game-gear": "gamegear",
    "playstation": "psx",
    "playstation-2": "ps2",
    "ps3": "ps3",
    "playstation-portable": "psp",
    "ps-vita": "psvita",
    "atari-2600": "atari2600",
    "atari-7800": "atari7800",
    "atari-jaguar": "jaguar",
    "turbografx": "pcengine",
    "turbografx-cd": "pcenginecd",
    "nec-pc-fx": "pcfx",
    "nec-pc-9801": "pc98",
    "neo-geo": "neogeo",
    "neo-geo-aes": "neogeo",
    "neo-geo-cd": "neogeocd",
    "snk-neo-geo-pocket-color": "ngpc",
    "3do": "3do",
    "mame": "mame",
    "microsoft-msx": "msx",
    "microsoft-msx2": "msx",
    "amiga": "amiga",
    "sharp-x1": "sharp-x1",
    "sharp-x68000": "x68000",
    "scummvm": "scummvm",
    "openbor": "openbor",
    "windows": "pc",
}
# The other way round, for browsing (first slug wins).
SLUGS: Dict[str, str] = {}
for _slug, _key in CONSOLES.items():
    SLUGS.setdefault(_key, _slug)

_GAME_URL_RE = re.compile(r"/roms/([a-z0-9-]+)/[^/\"]+\.html", re.I)
_TITLE_RE = re.compile(r'class="rf-li-title"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S)
_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
_CHIP_RE = re.compile(r'class="rf-type-chip"[^>]*>(.*?)</a>', re.I | re.S)
_STATS_RE = re.compile(r'class="rf-li-stats[^"]*"[^>]*>(.*?)</div>', re.I | re.S)
_BADGE_RE = re.compile(r'class="badge[^"]*"[^>]*>(.*?)</span>\s*(?=<|$)', re.I | re.S)
# Grid card: <div class="bg-white rounded-lg shadow-md overflow-hidden ...">
#   <img src=...> <h3 ...><a href=".../roms/<console>/<slug>.html">Title</a></h3>
#   <a ... href="...types[]=...">Fan Translation</a>  <span class="text-xs">...249</span>
_GRID_SPLIT = 'class="bg-white rounded-lg shadow-md overflow-hidden'
_GRID_TITLE_RE = re.compile(r'<h3[^>]*>\s*<a[^>]+href="([^"]+\.html)"[^>]*>(.*?)</a>', re.I | re.S)
_GRID_KIND_RE = re.compile(r'<a[^>]+href="[^"]*types(?:\[\]|%5B%5D)=[^"]*"[^>]*>(.*?)</a>', re.I | re.S)
_GRID_COUNT_RE = re.compile(r'<span class="text-xs">\s*<span[^>]*>.*?</span>\s*([\d.,]+\s*[kKmM]?)\s*</span>', re.I | re.S)
_DOWNLOAD_PAGE_RE = re.compile(r'href="([^"]*/download/[a-z0-9-]+-\d+)/?"', re.I)
_ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)
_CELL_RE = re.compile(r"<td\b[^>]*>(.*?)</td>", re.I | re.S)
_FILE_LINK_RE = re.compile(r'href="([^"]*/download/[a-z0-9-]+-\d+/\d+)"', re.I)
_COUNTDOWN_RE = re.compile(r'id="countdown"[^>]*>\s*(\d+)', re.I)
_LINK_RE = re.compile(r'<a[^>]+href="([^"]+)"[^>]*id="download-link"|id="download-link"[^>]*href="([^"]+)"', re.I)
# Markers of Cloudflare's challenge page itself. Not "challenge-platform":
# normal pages load that script too.
_CHALLENGE = ("<title>Just a moment...</title>", "cf-chl-")


def _count(text: str) -> Optional[int]:
    """'12', '1.2K', '3 M' -> a number."""
    match = re.search(r"([\d.,]+)\s*([kKmM]?)", text or "")
    if not match:
        return None
    try:
        value = float(match.group(1).replace(",", ""))
    except ValueError:
        return None
    return int(value * {"k": 1_000, "m": 1_000_000}.get(match.group(2).lower(), 1))


def _size(text: str) -> Optional[int]:
    """'624.75 K', '1.2 MB', '3 G' -> bytes."""
    match = re.search(r"([\d.,]+)\s*([KMGT]?)i?B?\b", text or "", re.I)
    if not match:
        return None
    try:
        value = float(match.group(1).replace(",", ""))
    except ValueError:
        return None
    return int(value * 1024 ** "_KMGT".index(match.group(2).upper() or "_"))


def _tidy(title: str) -> str:
    """Some titles are in capitals ("SUPER MARIO WORLD")."""
    title = collapse_ws(unescape(strip_tags(title)))
    return title.title() if title.isupper() else title


class RomsFunSource(Source):
    id = "romsfun"
    label = "RomsFun"
    homepage = DEFAULT_BASE
    supports_browse = True

    # The site hands out the link for the file page this session opened last,
    # so two downloads must not prepare their links at the same time.
    _link_lock: Optional[asyncio.Lock] = None

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.id = self.options.get("source_id", self.id)
        self.label = self.options.get("label", self.label)
        self.homepage = self.options.get("homepage", self.homepage)
        self.base = (self.options.get("base_url") or self.homepage or DEFAULT_BASE).rstrip("/")

    async def _page(self, url: str) -> str:
        html = await self.http.get_text(url)
        if any(marker in html for marker in _CHALLENGE):
            # A bot check: report it, never try to get past it.
            raise SourceError("RomsFun is showing a browser check right now; try again later")
        return html

    # ------------------------------------------------------------------ lists
    def _blocks(self, html: str):
        """(link, title, image, kind, downloads) for each game, either layout."""
        for block in html.split('class="rf-li ')[1:]:
            title_match = _TITLE_RE.search(block)
            if not title_match:
                continue
            image = _IMG_RE.search(block)
            chip = _CHIP_RE.search(block)
            stats = _STATS_RE.search(block)
            badges = _BADGE_RE.findall(stats.group(1)) if stats else []
            yield (
                title_match.group(1),
                title_match.group(2),
                image.group(1) if image else None,
                collapse_ws(strip_tags(chip.group(1))) if chip else "",
                _count(strip_tags(badges[0])) if badges else None,
            )
        for block in html.split(_GRID_SPLIT)[1:]:
            title_match = _GRID_TITLE_RE.search(block)
            if not title_match or "/roms/" not in title_match.group(1):
                continue
            image = _IMG_RE.search(block)
            kind = _GRID_KIND_RE.search(block)
            count = _GRID_COUNT_RE.search(block)
            yield (
                title_match.group(1),
                title_match.group(2),
                image.group(1) if image else None,
                collapse_ws(strip_tags(kind.group(1))) if kind else "",
                _count(count.group(1)) if count else None,
            )

    def _parse_list(self, html: str) -> List[RomEntry]:
        entries: List[RomEntry] = []
        seen = set()
        for link, raw_title, image, kind, downloads in self._blocks(html):
            url = absolute(self.base, link)
            console = _GAME_URL_RE.search(url)
            system = CONSOLES.get(console.group(1).lower()) if console else None
            if not system or url in seen:
                continue
            seen.add(url)
            title = _tidy(raw_title)
            entry = RomEntry(
                source=self.id,
                source_id=urlparse(url).path.strip("/"),
                title=title,
                system=system,
                url=url,
                cover=absolute(self.base, image) if image else None,
                downloads=downloads,
                region=extract_region(title),
            )
            if kind:
                entry.extra["kind"] = kind
            entries.append(entry)
        # Romhacks and translations fill the first pages of a search ("mario"
        # is mostly hacks); the games themselves come first.
        for rank, entry in enumerate(sorted(entries, key=lambda e: e.extra.get("kind", "").lower() in ("hack", "homebrew"))):
            entry.rank = rank
        entries.sort(key=lambda e: e.rank)
        return entries

    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        query = (query or "").strip()
        if not query:
            return []
        if page <= 1:
            url = f"{self.base}/?s={quote_plus(query)}"
        else:
            url = f"{self.base}/page/{page}/?s={quote_plus(query)}"
        return self._parse_list(await self._page(url))[:limit]

    async def browse(self, system: str, limit: int = 40) -> List[RomEntry]:
        slug = SLUGS.get(system)
        if not slug:
            return []
        entries: List[RomEntry] = []
        seen = set()
        for page in range(1, 9):
            url = f"{self.base}/roms/{slug}/" if page == 1 else f"{self.base}/roms/{slug}/page/{page}/"
            try:
                found = self._parse_list(await self._page(url))
            except Exception:
                if page == 1:
                    raise
                break
            fresh = [entry for entry in found if entry.url not in seen]
            if not fresh:
                break
            for entry in fresh:
                seen.add(entry.url)
                entry.rank = len(entries)
                entries.append(entry)
            if len(entries) >= limit:
                break
        return entries[:limit]

    # ------------------------------------------------------------------ files
    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        game = await self._page(entry.url)
        match = _DOWNLOAD_PAGE_RE.search(game)
        if not match:
            return []
        listing = await self._page(absolute(self.base, match.group(1)))
        files: List[RomFile] = []
        for row in _ROW_RE.findall(listing):
            link = _FILE_LINK_RE.search(row)
            if not link:
                continue
            cells = [collapse_ws(unescape(strip_tags(cell))) for cell in _CELL_RE.findall(row)]
            name = cells[0] if cells else ""
            kind = cells[1] if len(cells) > 1 else ""
            size = _size(cells[2]) if len(cells) > 2 else None
            files.append(
                RomFile(
                    id=f"{entry.source_id}-{len(files) + 1}",
                    # The real file name (with its extension) is only known
                    # once the link is ready; resolve_download fills it in.
                    filename="",
                    url=absolute(self.base, link.group(1)),
                    size=size,
                    region=extract_region(name),
                    label=name if not kind else f"{name} · {kind}",
                    source_url=entry.url,
                )
            )
        if files and not entry.size:
            entry.size = next((f.size for f in files if f.size), None)
        return files

    async def resolve_download(self, rom_file: RomFile) -> str:
        if RomsFunSource._link_lock is None:
            RomsFunSource._link_lock = asyncio.Lock()
        async with RomsFunSource._link_lock:
            page = await self._page(rom_file.url)
            started = time.monotonic()
            countdown = _COUNTDOWN_RE.search(page)
            wait = min(int(countdown.group(1)), 30) if countdown else 7
            resp = await self.http.post_form(
                f"{self.base}/wp-admin/admin-ajax.php",
                {"action": "k_get_download"},
                headers={"Referer": rom_file.url, "X-Requested-With": "XMLHttpRequest"},
            )
            link = self._link_from(resp.text)
            if not link:
                raise SourceError(self._why_no_link(page, resp.text))
            # The same countdown a visitor sits through.
            remaining = wait - (time.monotonic() - started)
            if remaining > 0:
                await asyncio.sleep(remaining)
        name = unquote(urlparse(link).path.rsplit("/", 1)[-1])
        if name and not rom_file.filename:
            rom_file.filename = name
        return link

    @staticmethod
    def _link_from(text: str) -> Optional[str]:
        try:
            data = json.loads(text)
        except ValueError:
            return None
        html = ((data or {}).get("data") or {}).get("html") if isinstance(data, dict) else None
        if not data.get("success") or not html:
            return None
        match = _LINK_RE.search(html)
        if not match:
            return None
        return unescape(match.group(1) or match.group(2))

    @staticmethod
    def _why_no_link(page: str, answer: str) -> str:
        text = f"{strip_tags(page)} {answer}".lower()
        if "limit" in text and ("reached" in text or "exceeded" in text):
            return "RomsFun's download limit for guests is reached; try again later"
        if any(word in text for word in ("captcha", "turnstile", "verify you are human")):
            return "RomsFun wants a human check for this download; get it from romsfun.com in a browser"
        return "RomsFun did not hand out a download link for this file"
