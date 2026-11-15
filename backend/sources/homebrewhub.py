"""Homebrew Hub (hh.gbdev.io): new games for old consoles, free to download.

The gbdev community's archive of homebrew for Game Boy, Game Boy Color, Game
Boy Advance and NES: games made for those consoles today, published by their
authors to be played. Everything comes from its JSON API:

    https://hh3.gbdev.io/api/search?q=<words>&typetag=game&results=40
    https://hh3.gbdev.io/api/search?platform=GB&typetag=game&results=100&page=2

Each entry lists its files (``files/orion-gb-v1.2.gb``, the playable one
marked ``default``) and screenshots, served from

    https://hh3.gbdev.io/static/<basepath>/entries/<slug>/<file>
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

from ..models import RomEntry, RomFile
from .base import Source

DEFAULT_BASE = "https://hh3.gbdev.io"
GAME_PAGE = "https://hh.gbdev.io/game/{slug}"

# Homebrew Hub platform -> store console key.
PLATFORMS: Dict[str, str] = {"GB": "gb", "GBC": "gbc", "GBA": "gba", "NES": "nes"}
SYSTEM_PLATFORMS: Dict[str, str] = {key: platform for platform, key in PLATFORMS.items()}
PAGE = 100


class HomebrewHubSource(Source):
    id = "homebrewhub"
    label = "Homebrew Hub"
    homepage = DEFAULT_BASE
    supports_browse = True
    # Homebrew has no Final Fantasy; words its catalogue is full of instead.
    speed_test_terms = ("space", "dragon", "quest")

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.id = self.options.get("source_id", self.id)
        self.label = self.options.get("label", self.label)
        self.base = (self.options.get("base_url") or DEFAULT_BASE).rstrip("/")

    def browse_systems(self) -> set:
        return set(SYSTEM_PLATFORMS)

    async def _api(self, query: str) -> Dict[str, Any]:
        resp = await self.http.request(f"{self.base}/api/search?{query}", polite=False)
        data = json.loads(resp.text or "{}")
        return data if isinstance(data, dict) else {}

    # ------------------------------------------------------------------ search
    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        data = await self._api(f"q={quote_plus(query)}&typetag=game&results={max(1, min(limit, PAGE))}&page={max(1, page)}")
        return self._entries(data)[:limit]

    async def browse(self, system: str, limit: int = 200) -> List[RomEntry]:
        platform = SYSTEM_PLATFORMS.get(system)
        if not platform:
            return []
        entries: List[RomEntry] = []
        page = 1
        while len(entries) < limit:
            data = await self._api(f"platform={platform}&typetag=game&results={PAGE}&page={page}")
            found = self._entries(data)
            entries.extend(found)
            if not found or page >= int(data.get("page_total") or 1):
                break
            page += 1
        return entries[:limit]

    # ------------------------------------------------------------------ parse
    def _static(self, item: Dict[str, Any], path: str) -> str:
        base = item.get("basepath") or "database-gb"
        return f"{self.base}/static/{base}/entries/{item.get('slug')}/{path}"

    def _entries(self, data: Dict[str, Any]) -> List[RomEntry]:
        entries: List[RomEntry] = []
        for item in data.get("entries") or []:
            if not isinstance(item, dict) or not item.get("slug") or not item.get("title"):
                continue
            system = PLATFORMS.get(str(item.get("platform") or "").upper())
            if not system:
                continue
            files = self._files(item)
            if not files:
                continue  # nothing to play (a tool, a demo without a ROM)
            shots = [self._static(item, shot) for shot in item.get("screenshots") or [] if isinstance(shot, str)]
            year = None
            if str(item.get("date") or "")[:4].isdigit():
                year = int(str(item["date"])[:4])
            entry = RomEntry(
                source=self.id,
                source_id=str(item["slug"]),
                title=str(item["title"]).strip(),
                system=system,
                url=GAME_PAGE.format(slug=item["slug"]),
                cover=shots[0] if shots else None,
                cover_full=shots[0] if shots else None,
                summary=(item.get("description") or None),
                year=year,
                developer=_developer(item.get("developer")),
                genres=[str(tag).replace("-", " ").title() for tag in (item.get("tags") or [])[:3] if isinstance(tag, str)],
                files=files,
            )
            entry.extra["homebrew"] = True
            entry.extra["shots"] = shots[:12]
            entries.append(entry)
        return entries

    def _files(self, item: Dict[str, Any]) -> List[RomFile]:
        playable = [f for f in item.get("files") or [] if isinstance(f, dict) and f.get("playable") and f.get("filename")]
        # The author's default build first, then the others (older versions).
        playable.sort(key=lambda f: not f.get("default"))
        files: List[RomFile] = []
        for index, item_file in enumerate(playable):
            path = str(item_file["filename"])
            label = f"v{item_file['version']}" if item_file.get("version") else None
            files.append(
                RomFile(
                    id=f"{item.get('slug')}-{index}",
                    filename=os.path.basename(path),
                    url=self._static(item, path),
                    label=label,
                    source_url=GAME_PAGE.format(slug=item.get("slug")),
                )
            )
        return files

    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        # The API answer already carries the files.
        return list(entry.files)

    async def media(self, entry: RomEntry) -> Optional[Dict[str, Any]]:
        shots = entry.extra.get("shots") or []
        if not shots:
            return None
        return {"shots": [{"kind": "image", "thumb": url, "full": url} for url in shots], "caption": entry.title}

    def describe(self) -> Dict[str, Any]:
        data = super().describe()
        data["base_url"] = self.base
        return data


def _developer(value: Any) -> Optional[str]:
    if isinstance(value, list):
        names = [d.get("name") if isinstance(d, dict) else d for d in value]
        return ", ".join(str(n) for n in names if n) or None
    if isinstance(value, dict):
        return value.get("name") or None
    return str(value) if value else None
