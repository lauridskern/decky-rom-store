"""Aggregates the sources, de-duplicates results and drives downloads."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from .covers import IgdbCovers
from .dedupe import merge_entries, sort_roms
from .downloader import DownloadManager
from .emudeck import detect_rom_roots, list_folders, resolve_folder, system_folders
from .httpclient import HttpClient
from .images import ImageCache
from .models import MergedRom, RomEntry, RomFile, normalize_title
from .settings import Settings
from .sources.base import Source
from .systems import canonical_system
from .sources.dumbroms import DumbRomsSource
from .sources.myabandonware import MyAbandonwareSource
from .sources.nswpedia import NswpediaSource
from .sources.retrostic import RetrosticSource
from .sources.switchroms import SwitchRomsSource
from .sources.romspedia import CONSOLE_MAP, RomspediaSource

# id -> (class, label, homepage, default base url)
SOURCE_DEFS: Dict[str, Dict[str, Any]] = {
    "switchroms": {
        "cls": SwitchRomsSource,
        "label": "Switch ROMs",
        "homepage": "https://nintendo-switch-roms.com",
        "base_key": "switchroms_base_url",
    },
    "romspedia": {
        "cls": RomspediaSource,
        "label": "Romspedia",
        "homepage": "https://www.romspedia.com",
        "base_key": "romspedia_base_url",
    },
    "retrostic": {
        "cls": RetrosticSource,
        "label": "Retrostic",
        "homepage": "https://www.retrostic.com",
        "base_key": "retrostic_base_url",
    },
    "romsdl": {
        "cls": RetrosticSource,
        "label": "RomsDL",
        "homepage": "https://romsdl.com",
        "base_key": "romsdl_base_url",
    },
    "dumbroms": {
        "cls": DumbRomsSource,
        "label": "DumbRoms",
        "homepage": "https://dumbroms.com",
        "base_key": "dumbroms_base_url",
        "search_url_key": "dumbroms_search_url",
    },
    "nswpedia": {
        "cls": NswpediaSource,
        "label": "Nswpedia",
        "homepage": "https://nswpedia.io",
        "base_key": "nswpedia_base_url",
    },
    "myabandonware": {
        "cls": MyAbandonwareSource,
        "label": "My Abandonware",
        "homepage": "https://www.myabandonware.com",
        "base_key": "myabandonware_base_url",
    },
}


class StoreService:
    """Everything the Decky bridge needs, in one place."""

    def __init__(self, settings: Settings, http: Optional[HttpClient] = None,
                 plugin_name: Optional[str] = None, runtime_dir: Optional[str] = None):
        self.settings = settings
        self.http = http or HttpClient()
        self._roms: Dict[str, MergedRom] = {}
        self._entries: Dict[str, RomEntry] = {}
        self._errors: Dict[str, str] = {}
        self._last_search: Dict[str, Any] = {}
        self._page = 1
        self._last_page_count = 1
        self._runtime_dir = runtime_dir
        self._COUNTS_TTL = 24 * 60 * 60
        self._browse_cache: Dict[str, tuple] = {}
        self.downloads = DownloadManager(self.http, max_concurrent=int(settings.get("max_concurrent", 2)))
        self.images = ImageCache(self.http, runtime_dir=runtime_dir, plugin_name=plugin_name)
        self.covers = IgdbCovers(
            self.http,
            client_id=settings.get("igdb_client_id"),
            client_secret=settings.get("igdb_client_secret"),
            cache_dir=runtime_dir,
        )

    # ------------------------------------------------------------------ sources
    def build_sources(self) -> List[Source]:
        enabled = self.settings.get("enabled_sources") or []
        options = {
            "romspedia": {"base_url": self.settings.get("romspedia_base_url")},
            "myabandonware": {"base_url": self.settings.get("myabandonware_base_url")},
            "dumbroms": {
                "base_url": self.settings.get("dumbroms_base_url"),
                "search_url": self.settings.get("dumbroms_search_url"),
            },
        }
        sources: List[Source] = []
        for source_id, definition in SOURCE_DEFS.items():
            if source_id not in enabled:
                continue
            options = {
                "source_id": source_id,
                "label": definition["label"],
                "homepage": definition["homepage"],
                "base_url": self.settings.get(definition["base_key"]) or definition["homepage"],
            }
            if definition.get("search_url_key"):
                options["search_url"] = self.settings.get(definition["search_url_key"])
            sources.append(definition["cls"](self.http, options))
        return sources

    def describe_sources(self) -> List[Dict[str, Any]]:
        described = []
        enabled = set(self.settings.get("enabled_sources") or [])
        for source_id, definition in SOURCE_DEFS.items():
            info = {
                "id": source_id,
                "label": definition["label"],
                "homepage": definition["homepage"],
                "supports_browse": bool(definition["cls"].supports_browse),
                "enabled": source_id in enabled,
                "status": "idle",
                "error": self._errors.get(source_id),
                "base_url": self.settings.get(definition["base_key"]) or definition["homepage"],
            }
            described.append(info)
        return described

    # ------------------------------------------------------------------ search
    async def search(self, query: str, source_ids: Optional[List[str]] = None,
                     system: Optional[str] = None, sort: str = "relevance",
                     limit: int = 60, page: int = 1) -> Dict[str, Any]:
        query = (query or "").strip()
        sources = self.build_sources()
        if source_ids:
            wanted = set(source_ids)
            sources = [s for s in sources if s.id in wanted]
        per_source = int(self.settings.get("results_per_source", 30))
        self._errors = {}
        page = max(1, int(page or 1))

        async def run(source: Source) -> Tuple[str, List[RomEntry]]:
            try:
                entries = await source.search(query, limit=per_source, page=page)
                self._errors.pop(source.id, None)
                pages = getattr(source, "_last_page_count", 1)
                if pages and pages > self._last_page_count:
                    self._last_page_count = pages
                return source.id, entries
            except Exception as exc:
                self._errors[source.id] = f"{type(exc).__name__}: {exc}"
                return source.id, []

        results = await asyncio.gather(*(run(source) for source in sources))
        entries: List[RomEntry] = []
        counts: Dict[str, int] = {}
        for source_id, source_entries in results:
            entries.extend(source_entries)
            counts[source_id] = len(source_entries)

        if system and system != "all":
            entries = [e for e in entries if e.system == system]

        merged = merge_entries(entries, self.settings.get("source_priority"))
        if sort and sort != "relevance":
            merged = sort_roms(merged, sort)
        merged = merged[:limit]

        # Ids have to stay unique across pages so "load more" does not
        # overwrite the results that are already on screen.
        for index, rom in enumerate(merged):
            rom.id = f"rom-p{page}-{index}-{rom.title}".replace(" ", "-")[:80]
        if page == 1:
            self._roms = {}
            self._entries = {}
        for rom in merged:
            self._roms[rom.id] = rom
            for entry in rom.entries:
                self._entries[entry.key] = entry

        self._page = page
        payload = {
            "query": query,
            "count": len(merged),
            "page": page,
            "has_more": page < self._last_page_count,
            "results": [rom.to_dict() for rom in merged],
            "sources": self.describe_sources(),
            "source_counts": counts,
            "systems": sorted({e.system for e in entries}),
            "errors": dict(self._errors),
        }
        self._last_search = payload
        self._prefetch_covers(entries)
        await self._enrich_covers(merged)
        return payload

    async def browse(self, system: str, limit: int = 200) -> Dict[str, Any]:
        cached = self._browse_cache.get(system)
        if cached and time.time() - cached[0] < 3600 and len(cached[1]) >= min(limit, len(cached[1])):
            entries = cached[1][:limit]
            return self._browse_payload(system, entries)
        entries: List[RomEntry] = []
        self._errors = {}
        for source in self.build_sources():
            if not source.supports_browse:
                continue
            try:
                found = await source.browse(system, limit=limit)
                entries.extend(found)
            except Exception as exc:
                self._errors[source.id] = f"{type(exc).__name__}: {exc}"

        merged = merge_entries(entries, self.settings.get("source_priority"))[:limit]
        self._last_page_count = 1
        for index, rom in enumerate(merged):
            rom.id = f"rom-browse-{system}-{index}".replace(" ", "-")[:80]
        self._roms = {rom.id: rom for rom in merged}
        self._entries = {}
        for rom in merged:
            for entry in rom.entries:
                self._entries[entry.key] = entry
        self._prefetch_covers(entries)
        self._browse_cache[system] = (time.time(), entries)
        return self._browse_payload(system, entries)

    def _browse_payload(self, system: str, entries: List[RomEntry]) -> Dict[str, Any]:
        merged = merge_entries(entries, self.settings.get("source_priority"))[:200]
        for index, rom in enumerate(merged):
            rom.id = f"rom-browse-{system}-{index}".replace(" ", "-")[:80]
        self._roms.update({rom.id: rom for rom in merged})
        for rom in merged:
            for entry in rom.entries:
                self._entries[entry.key] = entry
        return {
            "query": "",
            "system": system,
            "count": len(merged),
            "page": 1,
            "has_more": False,
            "results": [rom.to_dict() for rom in merged],
            "sources": self.describe_sources(),
            "source_counts": {},
            "systems": [system],
            "errors": dict(self._errors),
        }

    # ------------------------------------------------------------------ details
    async def details(self, rom_id: str) -> Optional[Dict[str, Any]]:
        rom = self._roms.get(rom_id)
        if not rom:
            return None

        sources = {source.id: source for source in self.build_sources()}

        async def resolve(entry: RomEntry) -> None:
            source = sources.get(entry.source)
            if source is None:
                return
            # The sites occasionally drop a request, so give it a few tries
            # before telling the user that the link could not be resolved.
            last_error = ""
            for attempt in range(3):
                try:
                    files = await source.resolve(entry)
                    if files:
                        entry.files = files
                        if not entry.size:
                            entry.size = next((f.size for f in files if f.size), None)
                        entry.extra.pop("error", None)
                        return
                    last_error = "no download link found"
                except Exception as exc:
                    last_error = f"{type(exc).__name__}: {exc}"
                if attempt < 2:
                    await asyncio.sleep(0.7 * (attempt + 1))
            entry.extra["error"] = last_error or "could not resolve the download link"

        await asyncio.gather(*(resolve(entry) for entry in rom.entries))
        return rom.to_dict()

    # ------------------------------------------------------------------ download
    async def start_download(self, rom_id: str, entry_key: str, file_id: str,
                             system: Optional[str] = None,
                             destination_folder: Optional[str] = None) -> Dict[str, Any]:
        rom = self._roms.get(rom_id)
        entry = self._entries.get(entry_key)
        if not rom or not entry:
            return {"ok": False, "error": "Unknown game or file"}

        rom_file: Optional[RomFile] = None
        for candidate in entry.files:
            if candidate.id == file_id:
                rom_file = candidate
                break
        if rom_file is None and entry.files:
            rom_file = entry.files[0]
        if rom_file is None:
            return {"ok": False, "error": "No downloadable file found for this entry"}

        source = next((s for s in self.build_sources() if s.id == entry.source), None)
        headers: Dict[str, str] = {}
        url = rom_file.url
        if source is not None and hasattr(source, "resolve_download"):
            for attempt in range(3):
                try:
                    url = await source.resolve_download(rom_file)
                    break
                except Exception:
                    url = rom_file.url
                    if attempt < 2:
                        await asyncio.sleep(0.7 * (attempt + 1))
        elif rom_file.url.rstrip("/").endswith("/download"):
            url = rom_file.url

        target_system = system or entry.system
        root = self.roms_root()
        folder = destination_folder or resolve_folder(root, target_system, create=True)
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError as exc:
            return {"ok": False, "error": f"Cannot create {folder}: {exc}"}

        filename = rom_file.filename or url.rsplit("/", 1)[-1] or f"{entry.title}.zip"
        job = self.downloads.enqueue(
            title=entry.title,
            system=target_system,
            source=entry.source,
            filename=filename,
            url=url,
            destination=folder,
            headers=headers,
            extract=bool(self.settings.get("extract_archives")),
            keep_archive=bool(self.settings.get("keep_archive", True)),
        )
        return {"ok": True, "job": job.to_dict(), "destination": folder}

    # ------------------------------------------------------------------ library
    def roms_root(self) -> str:
        root = (self.settings.get("roms_root") or "").strip()
        if root and os.path.isdir(root):
            return root
        roots = detect_rom_roots()
        for candidate in roots:
            if os.path.isdir(candidate):
                return candidate
        return root or (roots[0] if roots else os.path.expanduser("~/EmuDecky/roms"))

    def library(self) -> Dict[str, Any]:
        root = self.roms_root()
        folders = list_folders(root)
        return {
            "root": root,
            "root_exists": os.path.isdir(root),
            "candidates": detect_rom_roots(),
            "folders": folders,
            "systems": system_folders(root),
        }

    # ------------------------------------------------------------------ images
    async def get_cover(self, url: Optional[str], kind: str = "card") -> Optional[str]:
        """Return a locally cached URL for a piece of artwork."""
        if not url:
            return None
        try:
            return await self.images.resolve(url, kind)
        except Exception:
            return url

    async def prefetch_covers(self, urls: List[Optional[str]], kind: str = "card") -> None:
        await self.images.prefetch(urls, kind)

    async def _enrich_covers(self, roms: List[MergedRom]) -> None:
        """Replace missing artwork with a clean IGDB cover when possible."""
        await self._apply_portrait_covers(roms)
        if not self.covers.enabled:
            return
        missing: List[str] = []
        for rom in roms:
            for entry in rom.entries:
                if not entry.cover and entry.title not in missing:
                    missing.append(entry.title)
        if not missing:
            return
        try:
            found = await self.covers.lookup_many(missing, limit=12)
        except Exception:
            return
        for rom in roms:
            for entry in rom.entries:
                if entry.cover:
                    continue
                url = found.get(entry.title)
                if url:
                    entry.cover = url
                    entry.cover_full = entry.cover_full or url

    async def _apply_portrait_covers(self, roms: List[MergedRom]) -> None:
        """Give Switch games the portrait box art from the cover index."""
        switch_entries = [
            entry
            for rom in roms
            for entry in rom.entries
            if entry.system == "switch"
        ]
        if not switch_entries:
            return
        source = self._cover_source()
        try:
            index = await source.cover_index()
        except Exception:
            return
        if not index:
            return
        lookup = {normalize_title(title): url for title, url in index.items()}
        for entry in switch_entries:
            url = lookup.get(normalize_title(entry.title))
            if not url:
                continue
            # The portrait box art always looks better than a wallpaper.
            entry.cover = url
            entry.cover_full = url

    def _cover_source(self) -> NswpediaSource:
        """One shared cover source, so its cache survives between searches."""
        if getattr(self, "_nswpedia", None) is None:
            self._nswpedia = NswpediaSource(
                self.http,
                {
                    "base_url": self.settings.get("nswpedia_base_url"),
                    "cache_dir": self._runtime_dir,
                },
            )
        return self._nswpedia

    def _prefetch_covers(self, entries: List[RomEntry]) -> None:
        urls = [entry.cover for entry in entries if entry.cover][:40]
        if not urls or not self.images.enabled:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - defensive
            return
        loop.create_task(self.images.prefetch(urls))

    # ------------------------------------------------------------------ system counts
    async def system_counts(self, refresh: bool = False) -> Dict[str, int]:
        """How many titles each console has (used by the browse panel).

        Scraping every console page takes a while, so the result is cached on
        the Deck and refreshed in the background.
        """
        cached = self._read_counts_cache()
        if cached and not refresh:
            if self._counts_cache_age() < self._COUNTS_TTL:
                return cached
            self._refresh_counts_in_background()
            return cached
        return await self._refresh_counts()

    async def _refresh_counts(self) -> Dict[str, int]:
        source = RomspediaSource(self.http, {"base_url": self.settings.get("romspedia_base_url")})
        try:
            sections = await source.console_sections()
        except Exception:
            sections = [(slug, key) for slug, key in CONSOLE_MAP.items()]
        semaphore = asyncio.Semaphore(4)

        async def count_console(slug: str, label: str) -> Optional[Tuple[str, int]]:
            key = canonical_system(label)
            if key == "unknown":
                key = canonical_system(slug)
            async with semaphore:
                try:
                    entries = await source.console_entries(slug)
                except Exception:
                    return None
                return (key, len(entries)) if entries else None

        results = await asyncio.gather(*(count_console(slug, label) for slug, label in sections))
        counts: Dict[str, int] = {}
        for item in results:
            if not item:
                continue
            key, value = item
            counts[key] = max(counts.get(key, 0), value)
        if counts:
            self._write_counts_cache(counts)
        return counts

    def _refresh_counts_in_background(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - defensive
            return
        loop.create_task(self._refresh_counts())

    def _counts_cache_path(self) -> Optional[str]:
        if not self._runtime_dir:
            return None
        return os.path.join(self._runtime_dir, "system_counts.json")

    def _read_counts_cache(self) -> Dict[str, int]:
        path = self._counts_cache_path()
        if not path or not os.path.isfile(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            return {str(k): int(v) for k, v in (data.get("counts") or {}).items()}
        except (OSError, ValueError):
            return {}

    def _counts_cache_age(self) -> float:
        path = self._counts_cache_path()
        if not path or not os.path.isfile(path):
            return float("inf")
        try:
            return time.time() - os.path.getmtime(path)
        except OSError:
            return float("inf")

    def _write_counts_cache(self, counts: Dict[str, int]) -> None:
        path = self._counts_cache_path()
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"counts": counts, "updated": time.time()}, fh)
        except OSError:
            pass

    def status(self) -> Dict[str, Any]:
        return {
            "settings": self.settings.all(),
            "sources": self.describe_sources(),
            "library": self.library(),
            "downloads": self.downloads.snapshot(),
        }
