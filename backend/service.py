"""Aggregates the sources, de-duplicates results and drives downloads."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import socket
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from . import bios
from .artwork import SteamArtwork
from .boxart import BoxArt
from .gametdb import PLATFORMS as GAMETDB_PLATFORMS, GameTDB
from .sgdb import SteamGridCovers
from .mods import ModManager, switch_title_id, _main_file
from .titles import SwitchTitles, clean_name
from .unpack import archive_ext, needs_unpack, unpack, main_file as unpacked_main
from .steam import _home as _user_home
from .speedtest import SpeedTest
from .covers import IgdbCovers
from .dedupe import merge_entries, sort_roms
from .downloader import DownloadManager
from .emudeck import detect_rom_roots, list_folders, resolve_folder, system_folders
from .httpclient import HttpClient
from .images import ImageCache
from .library import LibraryIndex, installed_games, uninstall
from .srm_runner import SrmRunner
from .steam import SrmConfig, SteamShortcuts, plan as steam_plan
from .shelves import Shelves
from .speeds import SpeedStats
from .media import SteamMedia
from .models import MergedRom, RomEntry, RomFile, match_title, normalize_title
from .settings import Settings, DEFAULT_STEAMGRIDDB_KEY
from .sources.base import Source
from .systems import SYSTEMS, canonical_system
from .sources.myabandonware import MyAbandonwareSource
from .sources.retrostic import RetrosticSource
from .sources.switchroms import SwitchRomsSource
from .sources.romspedia import CONSOLE_MAP, RomspediaSource
from .sources.romsfun import RomsFunSource
from .sources.homebrewhub import HomebrewHubSource

# id -> (class, label, homepage, default base url)
# The console tiles and the console filter, in this order (the rest by name):
# the systems people come for most, newest generations of each family first.
POPULAR_CONSOLES = [
    "switch", "ps2", "psx", "gba", "snes", "n64", "nds", "3ds", "gc", "wii", "nes", "gb", "gbc",
    "psp", "genesis", "dreamcast", "ps3", "wiiu", "psvita", "saturn", "mastersystem", "gamegear",
    "segacd", "sega32x", "arcades", "mame", "neogeo", "pcengine", "dos",
]


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
    "romsfun": {
        "cls": RomsFunSource,
        "label": "RomsFun",
        "homepage": "https://romsfun.com",
        "base_key": "romsfun_base_url",
    },
    "homebrewhub": {
        "cls": HomebrewHubSource,
        "label": "Homebrew Hub",
        "homepage": "https://hh3.gbdev.io",
        "base_key": "homebrewhub_base_url",
    },
    "myabandonware": {
        "cls": MyAbandonwareSource,
        "label": "My Abandonware",
        "homepage": "https://www.myabandonware.com",
        "base_key": "myabandonware_base_url",
    },
}


def _human(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} TB"


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
        self._browse_cache: Dict[str, tuple] = {}
        self._unreachable: Dict[str, float] = {}
        # Per source: last success, last failure and failures in a row.
        self._health: Dict[str, Dict[str, Any]] = self._read_health()
        self.downloads = DownloadManager(
            self.http,
            max_concurrent=int(settings.get("max_concurrent", 2)),
            state_path=os.path.join(runtime_dir, "downloads.json") if runtime_dir else None,
        )
        self.images = ImageCache(self.http, runtime_dir=runtime_dir, plugin_name=plugin_name)
        self.media = SteamMedia(self.http, cache_dir=runtime_dir)
        self.boxart = BoxArt(self.http, cache_dir=runtime_dir)
        self.gametdb = GameTDB(self.http, cache_dir=runtime_dir)
        self.images.alternatives = GameTDB.alternatives
        self.sgdb = SteamGridCovers(self.http, self.steamgriddb_key, cache_dir=runtime_dir)
        self.titles = SwitchTitles(_user_home)
        self.mods = ModManager(self.http, runtime_dir, home=_user_home, lookup=self.titles.find)
        self.library_index = LibraryIndex()
        self.srm = SrmRunner(runtime_dir)
        self.speeds = SpeedStats(os.path.join(runtime_dir, "source_speeds.json") if runtime_dir else None)
        self.speed_test = SpeedTest()
        self.downloads.on_measure = lambda job, size, seconds: self.speeds.record(
            job.source, size, seconds, job.prepare_seconds
        )
        self.steam_shortcuts = SteamShortcuts(os.path.join(runtime_dir, "steam_shortcuts.json") if runtime_dir else None)
        self.shelves = Shelves(os.path.join(runtime_dir, "shelves.json") if runtime_dir else None)
        self.covers = IgdbCovers(
            self.http,
            client_id=settings.get("igdb_client_id"),
            client_secret=settings.get("igdb_client_secret"),
            cache_dir=runtime_dir,
        )

    async def probe_sources(self) -> None:
        """Check which sources resolve before the first search runs.

        A dead domain can take ten seconds to fail, so we find out up front
        and keep it out of the search path. A failed probe is only trusted for
        a couple of minutes: the Deck often boots before the network is up,
        and we do not want to block every source for that.
        """
        for source in self.build_sources():
            host = urlparse(source.homepage).hostname
            if not host:
                continue
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(socket.getaddrinfo, host, None), timeout=3
                )
            except Exception:
                self._unreachable[source.id] = time.time() + 120
                self._errors[source.id] = "host not found"

    # ------------------------------------------------------------------ cache
    #
    # Every cached query and every cached detail view lives in its own small
    # file. They used to share one big JSON document, which meant every single
    # search read, parsed and re-wrote the whole thing on the event loop - a
    # file that grows with every query you make. After a long session that
    # alone was tens of megabytes of JSON per search, and it blocked every
    # other call (including image loading) while it was serialised.
    MAX_CACHED_SEARCHES = 300
    MAX_CACHED_DETAILS = 300

    def _cache_dir(self, kind: str) -> Optional[str]:
        if not self._runtime_dir:
            return None
        return os.path.join(self._runtime_dir, "cache", kind)

    def _cache_file(self, kind: str, key: str) -> Optional[str]:
        folder = self._cache_dir(kind)
        if not folder:
            return None
        return os.path.join(folder, f"{key}.json")

    @staticmethod
    def _read_json(path: Optional[str]) -> Optional[Dict[str, Any]]:
        if not path or not os.path.isfile(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as fh:
                value = json.load(fh)
            return value if isinstance(value, dict) else None
        except (OSError, ValueError):
            return None

    def _cache_read(self, kind: str, key: str) -> Optional[Dict[str, Any]]:
        return self._read_json(self._cache_file(kind, key))

    def _cache_write(self, kind: str, key: str, value: Dict[str, Any]) -> None:
        path = self._cache_file(kind, key)
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(value, fh)
            os.replace(tmp, path)
        except OSError:
            return
        self._cache_prune(kind)

    def _cache_prune(self, kind: str) -> None:
        """Keep the cache folder to a sane number of files."""
        folder = self._cache_dir(kind)
        if not folder:
            return
        limit = self.MAX_CACHED_SEARCHES if kind == "search" else self.MAX_CACHED_DETAILS
        try:
            entries = []
            with os.scandir(folder) as scan:
                for item in scan:
                    try:
                        entries.append((item.stat().st_mtime, item.path))
                    except OSError:
                        continue
            if len(entries) <= limit:
                return
            entries.sort()
            for _mtime, path in entries[: len(entries) - limit]:
                try:
                    os.remove(path)
                except OSError:
                    pass
        except OSError:
            pass

    def _cache_totals(self) -> Dict[str, int]:
        files = 0
        size = 0
        for kind in ("search", "details"):
            folder = self._cache_dir(kind)
            if not folder:
                continue
            try:
                with os.scandir(folder) as scan:
                    for item in scan:
                        try:
                            size += item.stat().st_size
                            files += 1
                        except OSError:
                            continue
            except OSError:
                continue
        return {"files": files, "bytes": size}

    # Bumped when cached search and detail results would show outdated covers
    # (2: GameTDB's eShop stand-ins for Switch); the caches are cleared once.
    CACHE_REVISION = 2

    def _drop_legacy_caches(self) -> None:
        """Remove the old single-file caches from earlier versions, and the
        per-query caches once when CACHE_REVISION changes."""
        if not self._runtime_dir:
            return
        marker = os.path.join(self._runtime_dir, "cache", "revision")
        try:
            with open(marker, "r", encoding="utf-8") as fh:
                current = int(fh.read().strip() or 0)
        except (OSError, ValueError):
            current = 0
        if current != self.CACHE_REVISION:
            for kind in ("search", "details"):
                folder = self._cache_dir(kind)
                if folder and os.path.isdir(folder):
                    shutil.rmtree(folder, ignore_errors=True)
            self._browse_cache.clear()
            try:
                os.makedirs(os.path.dirname(marker), exist_ok=True)
                with open(marker, "w", encoding="utf-8") as fh:
                    fh.write(str(self.CACHE_REVISION))
            except OSError:
                pass
        # system_counts.json: console counts scraped from Romspedia, dropped in v1.17.5.
        for name in ("search_cache.json", "details_cache.json", "system_counts.json"):
            path = os.path.join(self._runtime_dir, name)
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass

    @staticmethod
    def _details_key(title: str, system: str) -> str:
        raw = f"{(title or '').strip().lower()}|{system or 'unknown'}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

    def _index_rom(self, rom: MergedRom) -> None:
        self._roms[rom.id] = rom
        for entry in rom.entries:
            self._entries[entry.key] = entry

    def _cache_key(self, query: str, system: Optional[str], sources: Optional[List[str]], sort: str) -> str:
        raw = f"{query.strip().lower()}|{system or 'all'}|{','.join(sorted(sources or [])) or 'all'}|{sort}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def _entry_from_dict(data: Dict[str, Any]) -> RomEntry:
        return RomEntry(
            source=data.get("source", ""),
            source_id=data.get("source_id", ""),
            title=data.get("title", ""),
            system=data.get("system", "unknown"),
            url=data.get("url", ""),
            cover=data.get("cover"),
            cover_full=data.get("cover_full"),
            summary=data.get("summary"),
            rating=data.get("rating"),
            rating_count=data.get("rating_count"),
            downloads=data.get("downloads"),
            year=data.get("year"),
            size=data.get("size"),
            region=data.get("region"),
            developer=data.get("developer"),
            publisher=data.get("publisher"),
            genres=data.get("genres") or [],
            files=[RomFile(**file) for file in (data.get("files") or [])],
            extra=data.get("extra") or {},
        )

    def _restore(self, cached: Dict[str, Any]) -> None:
        """Put cached entries back so the detail view still works offline."""
        merged: List[MergedRom] = []
        for rom in cached.get("roms") or []:
            entries = [self._entry_from_dict(entry) for entry in rom.get("entries") or []]
            merged.append(
                MergedRom(
                    id=rom.get("id", ""),
                    title=rom.get("title", ""),
                    system=rom.get("system", "unknown"),
                    entries=entries,
                )
            )
        self._roms = {rom.id: rom for rom in merged}
        self._entries = {}
        for rom in merged:
            for entry in rom.entries:
                self._entries[entry.key] = entry

    # ------------------------------------------------------------------ sources
    def build_sources(self) -> List[Source]:
        enabled = self.settings.get("enabled_sources") or []
        sources: List[Source] = []
        for source_id, definition in SOURCE_DEFS.items():
            address = self.source_address(source_id)
            # No address entered: the user has not set this source up.
            if source_id not in enabled or not address:
                continue
            options = {
                "source_id": source_id,
                "label": definition["label"],
                "homepage": address,
                "base_url": address,
            }
            if definition.get("search_url_key"):
                options["search_url"] = self.settings.get(definition["search_url_key"])
            sources.append(definition["cls"](self.http, options))
        return sources

    def source_address(self, source_id: str) -> str:
        """The address the user entered for a source, normalised, or ""."""
        definition = SOURCE_DEFS.get(source_id)
        value = str(self.settings.get(definition["base_key"]) or "").strip() if definition else ""
        if not value:
            return ""
        if "://" not in value:
            value = "https://" + value
        return value.rstrip("/")

    # ------------------------------------------------------------------ health
    FAILURES_BEFORE_REST = 3
    REST_SECONDS = 15 * 60

    def _record(self, source_id: str, error: Optional[str]) -> None:
        health = self._health.setdefault(source_id, {})
        if error is None:
            health["ok_at"] = time.time()
            health["failures"] = 0
        else:
            health["error"] = error[:240]
            health["error_at"] = time.time()
            health["failures"] = int(health.get("failures") or 0) + 1

    def _resting_until(self, source_id: str) -> Optional[float]:
        """When a source that keeps failing gets tried again, or None."""
        health = self._health.get(source_id) or {}
        if int(health.get("failures") or 0) < self.FAILURES_BEFORE_REST:
            return None
        until = float(health.get("error_at") or 0) + self.REST_SECONDS
        return until if until > time.time() else None

    def _health_path(self) -> Optional[str]:
        return os.path.join(self._runtime_dir, "source_health.json") if self._runtime_dir else None

    def _read_health(self) -> Dict[str, Dict[str, Any]]:
        data = self._read_json(self._health_path())
        return data if isinstance(data, dict) else {}

    def _write_health(self) -> None:
        path = self._health_path()
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(self._health, fh)
        except OSError:
            pass

    def describe_sources(self) -> List[Dict[str, Any]]:
        described = []
        enabled = set(self.settings.get("enabled_sources") or [])
        for source_id, definition in SOURCE_DEFS.items():
            info = {
                "id": source_id,
                "label": definition["label"],
                "homepage": self.source_address(source_id),
                "supports_browse": bool(definition["cls"].supports_browse),
                "enabled": source_id in enabled,
                "configured": bool(self.source_address(source_id)),
                "status": "idle",
                "error": self._errors.get(source_id),
                "base_url": self.source_address(source_id),
            }
            health = self._health.get(source_id) or {}
            info["last_ok"] = health.get("ok_at")
            info["last_error"] = health.get("error")
            info["last_error_at"] = health.get("error_at")
            info["failures"] = int(health.get("failures") or 0)
            info["resting_until"] = self._resting_until(source_id)
            speed = self.speeds.all().get(source_id) or {}
            info["speed"] = speed.get("speed")
            info["delay"] = speed.get("delay")
            info["speed_samples"] = int(speed.get("samples") or 0)
            info["speed_tested"] = speed.get("tested")
            info["speed_test_error"] = speed.get("test_error")
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

        # Long lived cache: the catalogues barely change, so a query that was
        # made a few days ago is served straight from disk.
        ttl = float(self.settings.get("search_cache_hours", 72)) * 3600
        # Keyed by the sources actually asked and their addresses: setting up,
        # switching off or moving a source must not serve the old answer.
        cache_key = self._cache_key(query, system, [f"{s.id}@{s.options.get('base_url', '')}" for s in sources], sort)
        cached = self._cache_read("search", cache_key)
        if cached and (time.time() - float(cached.get("at", 0))) < ttl:
            try:
                self._restore(cached)
                payload = dict(cached.get("payload") or {})
                payload["cached"] = True
                payload["cache_age_hours"] = round((time.time() - float(cached.get("at", 0))) / 3600, 1)
                self._mark_installed(payload.get("results") or [])
                self._last_search = payload
                return payload
            except Exception:
                # A broken cache entry must never stop a search.
                pass

        blocked = [
            source
            for source in sources
            if self._unreachable.get(source.id, 0.0) > time.time()
        ]
        # If that would silence every source, the network is probably just
        # not up yet - try them all anyway.
        ignore_breaker = len(blocked) == len(sources) and len(sources) > 0

        async def run(source: Source) -> Tuple[str, List[RomEntry]]:
            blocked_until = self._unreachable.get(source.id, 0.0)
            if blocked_until > time.time() and not ignore_breaker:
                # We already know this source is down - do not wait for it.
                self._errors[source.id] = "unreachable"
                return source.id, []
            resting = self._resting_until(source.id)
            if resting and not ignore_breaker:
                # Failed several times in a row: leave it alone for a while
                # instead of making every search wait for it.
                self._errors[source.id] = f"skipped after repeated failures: {self._health[source.id].get('error')}"
                return source.id, []
            try:
                entries = await source.search(query, limit=per_source, page=page)
                self._record(source.id, None)
                self._errors.pop(source.id, None)
                pages = getattr(source, "_last_page_count", 1)
                if pages and pages > self._last_page_count:
                    self._last_page_count = pages
                return source.id, entries
            except Exception as exc:
                message = f"{type(exc).__name__}: {exc}"
                self._errors[source.id] = message
                self._record(source.id, message)
                if "host not found" in message.lower() or "nodename" in message.lower():
                    # Remember it, so the next search does not wait for DNS -
                    # but only for a short while, the network may come back.
                    self._unreachable[source.id] = time.time() + 120
                return source.id, []

        results = await asyncio.gather(*(run(source) for source in sources))
        self._write_health()
        entries: List[RomEntry] = []
        counts: Dict[str, int] = {}
        for source_id, source_entries in results:
            entries.extend(source_entries)
            counts[source_id] = len(source_entries)

        if system and system != "all":
            entries = [e for e in entries if e.system == system]
            # The sites search every console at once and return one page, so
            # "pokemon" on Game Boy finds nothing: the page is all GBA and DS.
            # The console's own catalogue (the browse view, cached) fills in.
            entries.extend(await self._catalogue_matches(system, query, {e.key for e in entries}))

        await self._apply_boxart(entries)
        await self._switch_covers(entries)
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
        # Enrich before the payload is built, so the ratings and the IGDB art
        # are part of the result the frontend receives.
        try:
            await self._enrich_covers(merged)
        except Exception:
            pass
        payload["results"] = [rom.to_dict() for rom in merged]
        payload["cached"] = False
        self._mark_installed(payload["results"])
        self._last_search = payload
        self._prefetch_covers(entries)

        # Remember it for the next few days - one small file for this query.
        self._cache_write("search", cache_key, {
            "at": time.time(),
            "payload": payload,
            "roms": [
                {
                    "id": rom.id,
                    "title": rom.title,
                    "system": rom.system,
                    "entries": [entry.to_dict() for entry in rom.entries],
                }
                for rom in merged
            ],
        })
        return payload

    async def browse(self, system: str, limit: int = 200) -> Dict[str, Any]:
        ttl = float(self.settings.get("search_cache_hours", 72)) * 3600
        cached = self._browse_cache.get(system)
        if cached and time.time() - cached[0] < ttl and len(cached[1]) >= min(limit, len(cached[1])):
            entries = cached[1][:limit]
            # Covers looked up in the background since (IGDB) fill in now.
            await self._switch_covers(entries)
            await self._fill_missing_covers(entries)
            return self._browse_payload(system, entries)
        entries: List[RomEntry] = []
        self._errors = {}
        for source in self.build_sources():
            if not source.supports_browse:
                continue
            if self._resting_until(source.id):
                continue
            try:
                found = await source.browse(system, limit=limit)
                entries.extend(found)
                self._record(source.id, None)
            except Exception as exc:
                self._errors[source.id] = f"{type(exc).__name__}: {exc}"
                self._record(source.id, self._errors[source.id])
        self._write_health()

        await self._apply_boxart(entries)
        await self._switch_covers(entries)
        await self._fill_missing_covers(entries)
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

    async def _catalogue_matches(self, system: str, query: str, known: set) -> List[RomEntry]:
        """Entries of a console's catalogue whose title has every query word."""
        words = normalize_title(query).split()
        if not words:
            return []
        cached = self._browse_cache.get(system)
        if cached is None:
            # Fetch it with the same code as the browse view; this also fills
            # the cache for the next search on this console.
            saved_roms, saved_entries = self._roms, self._entries
            try:
                await asyncio.wait_for(self.browse(system), timeout=12)
            except Exception:
                pass
            finally:
                # browse() swaps the session's games out; keep the search's.
                self._roms, self._entries = saved_roms, saved_entries
            cached = self._browse_cache.get(system)
        if not cached:
            return []
        def matches(title: str) -> bool:
            # Every query word starts a word of the title: "poke red" works.
            title_words = normalize_title(title).split()
            return all(any(part.startswith(word) for part in title_words) for word in words)

        return [
            entry
            for entry in cached[1]
            if entry.system == system and entry.key not in known and matches(entry.title)
        ]

    def _browse_payload(self, system: str, entries: List[RomEntry]) -> Dict[str, Any]:
        merged = merge_entries(entries, self.settings.get("source_priority"))[:200]
        for index, rom in enumerate(merged):
            rom.id = f"rom-browse-{system}-{index}".replace(" ", "-")[:80]
        self._roms.update({rom.id: rom for rom in merged})
        for rom in merged:
            for entry in rom.entries:
                self._entries[entry.key] = entry
        results = [rom.to_dict() for rom in merged]
        self._mark_installed(results)
        return {
            "query": "",
            "system": system,
            "count": len(merged),
            "page": 1,
            "has_more": False,
            "results": results,
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

        # Opening the same game again must be instant: the download links and
        # the gallery are cached, so closing the modal never leaves a scrape
        # running in the background.
        ttl = float(self.settings.get("search_cache_hours", 72)) * 3600
        key = self._details_key(rom.title, rom.system)
        cached = self._cache_read("details", key)
        if cached and time.time() - float(cached.get("at", 0)) < ttl:
            try:
                entries = [self._entry_from_dict(item) for item in cached.get("entries") or []]
                if entries and any(entry.files for entry in entries):
                    rom.entries = entries
                    rom.extra = dict(rom.extra or {})
                    if cached.get("media"):
                        rom.extra["media"] = cached["media"]
                    self._index_rom(rom)
                    return self._with_installed(rom)
            except Exception:
                pass

        # Entries that already have their links resolved (this session) are
        # not scraped again either.
        pending = [entry for entry in rom.entries if not entry.files]
        if not pending:
            return self._with_installed(rom)

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

        await asyncio.gather(*(resolve(entry) for entry in pending))

        # Media for the gallery strip.
        primary = rom.entries[0] if rom.entries else None
        media = None
        if primary:
            media = await self._build_media(primary)
            if media:
                rom.extra = getattr(rom, "extra", {})
                rom.extra["media"] = media

        try:
            self._cache_write("details", key, {
                "at": time.time(),
                "entries": [entry.to_dict() for entry in rom.entries],
                "media": media or (rom.extra or {}).get("media"),
            })
        except Exception:
            pass
        return self._with_installed(rom)

    async def _build_media(self, entry: RomEntry) -> Optional[Dict[str, Any]]:
        """Collect artwork for a game.

        The site the game came from is the best source (MyAbandonware has a
        full screenshot gallery, the Switch sites publish their own art), then
        IGDB if credentials are configured, and finally a YouTube trailer.
        """
        media: Dict[str, Any] = {}
        source = next((s for s in self.build_sources() if s.id == entry.source), None)
        if source is not None and hasattr(source, "media"):
            try:
                own = await source.media(entry)
            except Exception:
                own = None
            if own:
                media.update(own)

        # IGDB is the primary source: real screenshots, a trailer and the
        # game's own box art.
        if self.covers.enabled:
            try:
                info = await self.covers.lookup(entry.title)
            except Exception:
                info = None
            if info:
                media["cover"] = info.get("cover") or media.get("cover")
                shots = list(info.get("shots") or [])
                if media.get("shots"):
                    # Keep the site's own shots first, they match the ROM.
                    shots.extend(media["shots"])
                media["shots"] = shots[:5]
                media["trailer"] = info.get("trailer") or media.get("trailer")
                media["summary"] = info.get("summary") or media.get("summary")
                if info.get("genres"):
                    media["genres"] = info["genres"]
                if info.get("developers"):
                    media["developers"] = info["developers"]
                if info.get("released"):
                    media["released"] = info["released"]

        # Last resort: look the trailer up on YouTube. Only used when IGDB did
        # not have one, and only when the video title really matches.
        if not media.get("trailer"):
            try:
                trailer = await self.media.youtube_trailer(entry.title)
            except Exception:
                trailer = None
            if trailer:
                media["trailer"] = trailer

        if not media.get("shots") and not media.get("trailer") and not media.get("cover"):
            return None
        media.setdefault("caption", entry.title)
        return media

    # ------------------------------------------------------------------ download
    async def start_download(self, rom_id: str, entry_key: str, file_id: str,
                             system: Optional[str] = None,
                             destination_folder: Optional[str] = None,
                             root: Optional[str] = None) -> Dict[str, Any]:
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
        # How long the site takes to hand out the link (forms, countdowns)
        # counts towards its speed ranking too.
        preparing = time.time()
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
        # A library on another drive (the SD card) can be picked per download.
        if not root or not os.path.isdir(root):
            root = self.roms_root()
        folder = destination_folder or resolve_folder(root, target_system, create=True)
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError as exc:
            return {"ok": False, "error": f"Cannot create {folder}: {exc}"}

        # Check the space now when the size is known; extracting an archive
        # needs room for both copies for a moment.
        size = rom_file.size or entry.size or 0
        if size:
            need = size * (2 if self.settings.get("extract_archives") else 1)
            try:
                free = shutil.disk_usage(folder).free
            except OSError:
                free = 0
            if free and need > free:
                return {
                    "ok": False,
                    "error": f"Not enough free space on this drive: needs {_human(need)}, {_human(free)} free.",
                }

        filename = rom_file.filename or url.rsplit("/", 1)[-1] or f"{entry.title}.zip"
        # Unpack when the user asked for it, and always when the console's
        # emulator cannot open this kind of archive (backend/unpack.py):
        # otherwise the game is neither playable nor added to Steam.
        wanted = bool(self.settings.get("extract_archives"))
        try:
            needed = needs_unpack(target_system, folder, filename, SrmConfig.load())
        except Exception:  # pragma: no cover - a wrong guess must not stop a download
            needed = False
        extract = wanted or needed
        keep = bool(self.settings.get("keep_archive", True)) if wanted else False
        job = self.downloads.enqueue(
            title=entry.title,
            system=target_system,
            source=entry.source,
            filename=filename,
            url=url,
            destination=folder,
            headers=headers,
            extract=extract,
            keep_archive=keep,
            prepare_seconds=time.time() - preparing,
            cover=rom.cover or entry.cover,
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

    def _with_installed(self, rom: MergedRom) -> Dict[str, Any]:
        data = rom.to_dict()
        self._mark_installed([data])
        return data

    def _mark_installed(self, results: List[Dict[str, Any]]) -> None:
        """Flag results that already have a file in their console's folder."""
        root = self.roms_root()
        folders: Dict[str, str] = {}
        for result in results:
            system = result.get("system") or "unknown"
            if system not in folders:
                folders[system] = resolve_folder(root, system)
            folder = folders[system]
            titles = [result.get("title") or ""] + [e.get("title") or "" for e in result.get("entries") or []]
            result["installed"] = any(self.library_index.contains(folder, title) for title in titles if title)

    def library(self) -> Dict[str, Any]:
        root = self.roms_root()
        folders = list_folders(root)
        return {
            "root": root,
            "root_exists": os.path.isdir(root),
            "candidates": detect_rom_roots(),
            "folders": folders,
            "systems": system_folders(root),
            "storage": self.storage(root),
        }

    def installed(self) -> Dict[str, Any]:
        """Every game in the ROM library, for the Installed games view."""
        root = self.roms_root()
        games = installed_games(root)
        tracked = self.steam_shortcuts.all()
        for game in games:
            game["in_steam"] = any(os.path.join(game["folder"], f["name"]) in tracked for f in game["files"])
        return {"root": root, "games": games, "size": sum(g["size"] for g in games)}

    async def installed_view(self) -> Dict[str, Any]:
        """``installed()`` with box art, for the Library tab and the home shelf.

        Sizing folders walks the disk, so the listing runs on a worker thread;
        the art is matched from the box-art index by file name.
        """
        result = await asyncio.to_thread(self.installed)
        games = result["games"]
        if self.settings.get("libretro_boxart", True):
            try:
                await self.boxart.covers(games, resize=bool(self.settings.get("boxart_resize", True)))
            except Exception as exc:  # pragma: no cover - art must never break the list
                print(f"ROM Store: library box art lookup failed: {exc!r}")
        if self.settings.get("libretro_boxart", True):
            try:
                rest = [game for game in games if game.get("system") in GAMETDB_PLATFORMS and not game.get("cover")]
                if rest:
                    await self.gametdb.covers(rest)
            except Exception as exc:  # pragma: no cover - art must never break the list
                print(f"ROM Store: library GameTDB lookup failed: {exc!r}")
        try:
            await self._library_fallback_covers(games)
        except Exception as exc:  # pragma: no cover - art must never break the list
            print(f"ROM Store: library cover fallback failed: {exc!r}")
        try:
            srm = SrmConfig.load()
        except Exception:  # pragma: no cover - Steam ROM Manager is optional
            srm = None
        for game in games:
            game["name"] = self._display_name(game)
            # Kept in an archive its emulator cannot open: offer to unpack it.
            files = [f for f in game.get("files") or [] if not f.get("folder")]
            game["needs_unpack"] = bool(files) and all(
                needs_unpack(str(game.get("system")), str(game.get("folder")), f["name"], srm) for f in files
            )
        return result

    async def unpack_game(self, game_id: str) -> Dict[str, Any]:
        """Unpack an installed game's archives for its emulator, then delete them."""
        game = await asyncio.to_thread(self._installed_game, game_id)
        if not game:
            return {"ok": False, "error": "That game is no longer in the library."}
        folder = str(game.get("folder"))
        produced: List[str] = []
        errors: List[str] = []
        for item in game.get("files") or []:
            if item.get("folder") or not archive_ext(item["name"]):
                continue
            archive = os.path.join(folder, item["name"])
            try:
                produced += await asyncio.to_thread(unpack, archive, folder)
            except RuntimeError as exc:
                errors.append(f"{item['name']}: {exc}")
                continue
            try:
                os.remove(archive)
            except OSError:
                pass
        main = unpacked_main(produced)
        return {"ok": bool(produced) and not errors, "files": produced, "main": main, "error": "; ".join(errors) or None}

    def _display_name(self, game: Dict[str, Any]) -> str:
        """The game's real name: from the title list, libretro or GameTDB,
        else the file name cleaned up (backend/titles.py)."""
        title, system = str(game.get("title") or ""), str(game.get("system") or "")
        cleaned = clean_name(title)
        try:
            if system == "switch":
                path = _main_file(game)
                tid = switch_title_id(path, self.titles.find) if path else None
                name = self.titles.name(tid)
                if name:
                    return name
            for candidate in (title, cleaned):
                name = self.boxart.name(candidate, system) or self.gametdb.name(candidate, system)
                if name:
                    return name
        except Exception:  # pragma: no cover - a name must never break the list
            pass
        return cleaned

    async def _library_fallback_covers(self, games: List[Dict[str, Any]], wait: float = 2.0) -> None:
        """Covers for installed games the box-art index has no scan for.

        First what the store already knows without asking anyone: the cover a
        download of the game had, then IGDB's cache. The rest is looked up on
        IGDB in the background (bounded, at most ``wait`` seconds here), so
        the next time the list is opened those games have art too.
        """
        missing = [game for game in games if not game.get("cover")]
        if not missing:
            return
        # The cover a download of the game had, then SteamGridDB, then IGDB.
        by_title: Dict[str, str] = {}
        for job in self.downloads.snapshot():
            if job.get("cover") and job.get("title"):
                by_title.setdefault(f"{job.get('system')}|{match_title(job['title'])}", job["cover"])
        for game in missing:
            bare = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", str(game.get("title") or "")).strip()
            known = by_title.get(f"{game.get('system')}|{match_title(bare)}")
            if known:
                game["cover"] = known
        missing = [game for game in missing if not game.get("cover")]
        if not missing:
            return
        stand_ins = [
            RomEntry(source="library", source_id=str(i), title=str(game.get("title") or ""), system=str(game.get("system")))
            for i, game in enumerate(missing)
        ]
        try:
            await self.sgdb.apply(stand_ins, wait=wait)
        except Exception as exc:  # pragma: no cover - art must never break the list
            print(f"ROM Store: library SteamGridDB lookup failed: {exc!r}")
        for game, stand_in in zip(missing, stand_ins):
            if stand_in.cover:
                game["cover"] = stand_in.cover
        missing = [game for game in missing if not game.get("cover")]
        if not missing:
            return
        lookups: Dict[str, List[Dict[str, Any]]] = {}
        for game in missing:
            bare = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", str(game.get("title") or "")).strip()
            known = by_title.get(f"{game.get('system')}|{match_title(bare)}")
            if known:
                game["cover"] = known
                continue
            info = self.covers.cached(bare) if bare else None
            if info and info.get("cover"):
                game["cover"] = info["cover"]
            elif bare and self.covers.enabled and game.get("system") not in ("arcades", "mame"):
                lookups.setdefault(bare, []).append(game)
        if not lookups:
            return
        task = asyncio.ensure_future(self.covers.lookup_many(list(lookups), limit=12))
        try:
            found = await asyncio.wait_for(asyncio.shield(task), timeout=wait)
        except (asyncio.TimeoutError, Exception):
            return
        for title, info in (found or {}).items():
            if info and info.get("cover"):
                for game in lookups.get(title, []):
                    game["cover"] = info["cover"]

    # ------------------------------------------------------------------ steam
    def steam_plan(self, paths: Optional[List[str]] = None, add: bool = True) -> Dict[str, Any]:
        """Shortcuts the Steam library should have (see backend/steam.py)."""
        enabled = bool(self.settings.get("steam_shortcuts", True))
        result = steam_plan(self.roms_root(), self.steam_shortcuts.all(), only=paths, add=add and enabled)
        result["enabled"] = enabled
        result["collections"] = bool(self.settings.get("steam_collections", True))
        result["artwork"] = bool(self.settings.get("steam_artwork", True))
        return result

    async def steam_artwork(self, title: str) -> Dict[str, Any]:
        """Steam library art for a game, base64 per slot (see artwork.py)."""
        if not self.settings.get("steam_artwork", True):
            return {"source": None, "assets": {}}
        art = SteamArtwork(self.http, self.covers, self.steamgriddb_key())
        return await art.assets(title)

    def steam_report(self, added: Dict[str, Any], removed: List[str]) -> Dict[str, Any]:
        self.steam_shortcuts.report(added or {}, removed or [])
        return {"ok": True, "tracked": len(self.steam_shortcuts.all())}

    def steam_tracked(self) -> Dict[str, Any]:
        """Shortcuts the plugin made, to hand over before SRM runs."""
        return self.steam_shortcuts.all()

    def srm_status(self) -> Dict[str, Any]:
        return self.srm.status(self.roms_root(), self.settings.get("srm_path") or "")

    def srm_start(self) -> Dict[str, Any]:
        return self.srm.start(self.roms_root(), self.settings.get("srm_path") or "")

    def srm_ack(self) -> Dict[str, Any]:
        self.srm.acknowledge()
        return {"ok": True}

    def steam_status(self) -> Dict[str, Any]:
        config = SrmConfig.load()
        consoles = sorted({config.rom_dir(p).rsplit("/", 1)[-1] for p in config.parsers if config.rom_dir(p)})
        return {
            "srm": config.folder,
            "parsers": len(config.parsers),
            "consoles": consoles,
            "tracked": len(self.steam_shortcuts.all()),
            "enabled": bool(self.settings.get("steam_shortcuts", True)),
        }

    def uninstall(self, game_id: str) -> Dict[str, Any]:
        return uninstall(self.roms_root(), game_id)

    def check_bios(self, system: str) -> Optional[Dict[str, Any]]:
        """Whether a console needs a BIOS and whether one is in place."""
        root = self.roms_root()
        return bios.check(system, root, resolve_folder(root, system))

    def storage(self, current: Optional[str] = None) -> List[Dict[str, Any]]:
        """ROM libraries on this Deck that a download can go to, with space."""
        roots = [current] if current else []
        roots += [path for path in detect_rom_roots() if os.path.isdir(path) and path not in roots]
        out: List[Dict[str, Any]] = []
        for path in roots:
            try:
                usage = shutil.disk_usage(path)
            except OSError:
                continue
            if path.startswith("/run/media/"):
                label = "SD card" if "/mmcblk" in path or path.count("/") >= 4 else "External drive"
            else:
                label = "Internal storage"
            out.append({"root": path, "label": label, "free": usage.free, "total": usage.total})
        return out

    # ------------------------------------------------------------------ images
    def clear_cache(self) -> Dict[str, Any]:
        """Throw away the cached searches and detail views."""
        removed = 0
        for kind in ("search", "details"):
            folder = self._cache_dir(kind)
            if not folder:
                continue
            try:
                with os.scandir(folder) as scan:
                    for item in scan:
                        try:
                            os.remove(item.path)
                            removed += 1
                        except OSError:
                            continue
            except OSError:
                continue
        self._drop_legacy_caches()
        self._browse_cache = {}
        return {"ok": True, "removed": removed}

    def cache_stats(self) -> Dict[str, Any]:
        totals = self._cache_totals()
        return {
            "entries": totals["files"],
            "bytes": totals["bytes"],
            "path": self._cache_dir("search") or "",
            "ttl_hours": float(self.settings.get("search_cache_hours", 72)),
        }

    async def image_diagnostics(self, url: Optional[str] = None) -> Dict[str, Any]:
        """Tell us exactly where an image gets stuck."""
        plugin = self.images._plugin_name or ""
        sample = url or "https://static.romspedia.com/webp/roms/super-mario-64-cover.webp"
        local = None
        error = None
        try:
            local = await self.images.resolve(sample, "card")
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
        folder = self.images.folder
        files = []
        if os.path.isdir(folder):
            files = [
                {"name": name, "size": os.path.getsize(os.path.join(folder, name))}
                for name in sorted(os.listdir(folder))[:5]
            ]
        return {
            "plugin_name": plugin,
            "base_url": self.images._base_url,
            "local_url": local,
            "cache_folder": folder,
            "cache_exists": os.path.isdir(folder),
            "cached_files": files,
            "runtime_dir": self._runtime_dir,
            "error": error,
        }

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

    async def _apply_boxart(self, entries: List[RomEntry]) -> None:
        """Real box scans from libretro-thumbnails, before any other art."""
        if not self.settings.get("libretro_boxart", True):
            return
        try:
            await self.boxart.apply(entries, resize=bool(self.settings.get("boxart_resize", True)))
        except Exception as exc:  # pragma: no cover - art must never break a search
            print(f"ROM Store: box art lookup failed: {exc!r}")
        self.gametdb.proxy = bool(self.settings.get("boxart_resize", True))
        # What libretro has no scan for, GameTDB may (Wii U, PS3, Wii, DS,
        # 3DS). Switch is handled in _switch_covers, GameTDB first there.
        rest = [
            entry for entry in entries
            if entry.system in GAMETDB_PLATFORMS and entry.system != "switch" and not entry.extra.get("boxart")
        ]
        if rest:
            try:
                await self.gametdb.apply(rest)
            except Exception as exc:  # pragma: no cover - art must never break a search
                print(f"ROM Store: GameTDB lookup failed: {exc!r}")

    async def _enrich_covers(self, roms: List[MergedRom]) -> None:
        """Fill in artwork and ratings from IGDB.

        The lookups are slow (a couple of requests per game), so the grid is
        enriched in the background - the next search shows the ratings.
        """
        # Games no box-art library and no site has a cover for: SteamGridDB.
        try:
            await self.sgdb.apply([entry for rom in roms for entry in rom.entries])
        except Exception as exc:  # pragma: no cover - art must never break a search
            print(f"ROM Store: SteamGridDB lookup failed: {exc!r}")
        if not self.covers.enabled:
            return
        replace = bool(self.settings.get("igdb_replace_covers", False))

        # Apply what we already know - this is instant and makes the ratings
        # show up on the next search.
        wanted: List[str] = []
        for rom in roms:
            for entry in rom.entries:
                info = self.covers.cached(entry.title)
                if info:
                    self._apply_igdb(entry, info, replace)
                    continue
                if (replace or not entry.cover) and entry.title not in wanted:
                    wanted.append(entry.title)
        if not wanted:
            return
        # Look the first few up right away (short budget) so the ratings show
        # on the first search, and let the rest happen in the background.
        task = self._igdb_enrich_in_background(roms, wanted[:14])
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=3.0)
        except (asyncio.TimeoutError, Exception):
            pass

    def _igdb_enrich_in_background(self, roms: List[MergedRom], titles: List[str]) -> asyncio.Task:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - defensive
            raise
        task = loop.create_task(self._igdb_enrich(roms, titles))

        def done(finished) -> None:
            # A failing background job must not disappear silently.
            if finished.cancelled():
                return
            error = finished.exception()
            if error:
                print(f"ROM Store: IGDB enrichment failed: {error!r}")

        task.add_done_callback(done)
        return task

    async def _igdb_enrich(self, roms: List[MergedRom], titles: List[str]) -> None:
        replace = bool(self.settings.get("igdb_replace_covers", False))
        try:
            found = await self.covers.lookup_many(titles, limit=len(titles))
        except Exception:
            return
        for rom in roms:
            for entry in rom.entries:
                info = found.get(entry.title)
                if info:
                    self._apply_igdb(entry, info, replace)

    @staticmethod
    def _apply_igdb(entry: RomEntry, info: Dict[str, Any], replace: bool) -> None:
        url = info.get("cover")
        if url and (replace or not entry.cover):
            entry.cover = url
            entry.cover_full = entry.cover_full or url
        rating = info.get("rating")
        if rating and not entry.rating:
            try:
                entry.rating = round(float(rating), 1)
                entry.rating_count = info.get("rating_count") or entry.rating_count
            except (TypeError, ValueError):
                pass

    async def _fill_missing_covers(self, entries: List[RomEntry]) -> None:
        """A console's catalogue: SteamGridDB for the games with no cover yet."""
        try:
            await self.sgdb.apply(entries)
        except Exception as exc:  # pragma: no cover - art must never break a browse
            print(f"ROM Store: SteamGridDB lookup failed: {exc!r}")

    async def _switch_covers(self, entries: List[RomEntry]) -> None:
        """Portrait box art for Switch games.

        libretro has no Switch art and Switch ROMs publishes wide banners
        (1.7-1.9:1). So: GameTDB's case front (backend/gametdb.py), else
        Romspedia's box art, else IGDB's official cover; a banner is never
        used as a cover (the placeholder is, with the title).
        """
        switch = [entry for entry in entries if entry.system == "switch"]
        if not switch:
            return
        before = {id(entry): entry.cover for entry in switch}
        self.gametdb.proxy = bool(self.settings.get("boxart_resize", True))
        try:
            await self.gametdb.apply(switch)
        except Exception as exc:  # pragma: no cover - art must never break a search
            print(f"ROM Store: GameTDB lookup failed: {exc!r}")
        missing: List[RomEntry] = []
        for entry in switch:
            if entry.extra.get("gametdb"):
                continue
            entry.cover = before[id(entry)]
            if entry.cover and "static.romspedia.com" in entry.cover:
                continue  # resized box art; drawn back in the box shape
            if entry.cover:
                entry.extra["banner"] = entry.cover
            entry.cover = entry.cover_full = None
            missing.append(entry)
        if missing:
            try:
                await self.sgdb.apply(missing)
            except Exception as exc:  # pragma: no cover - art must never break a search
                print(f"ROM Store: SteamGridDB lookup failed: {exc!r}")
            missing = [entry for entry in missing if not entry.cover]
        if not missing or not self.covers.enabled:
            return
        titles = list(dict.fromkeys(entry.title for entry in missing))
        known = {title: self.covers.cached(title) for title in titles}
        wanted = [title for title, info in known.items() if info is None]
        if wanted:
            # A short wait on the first search; the rest comes in the next one.
            try:
                found = await asyncio.wait_for(asyncio.shield(self.covers.lookup_many(wanted, limit=14)), 3.0)
                known.update(found)
            except (asyncio.TimeoutError, Exception):
                pass
        for entry in missing:
            cover = (known.get(entry.title) or {}).get("cover")
            if cover:
                entry.cover = entry.cover_full = cover

    # ------------------------------------------------------------- speed test
    # Results older than this are tested again by themselves (see
    # start_background_tasks), when the setting is on.
    SPEED_TEST_EVERY = 7 * 24 * 3600

    def start_speed_test(self) -> Dict[str, Any]:
        """Measure every enabled source now (backend/speedtest.py)."""
        sources = [source for source in self.build_sources() if not self._resting_until(source.id)]
        if not sources:
            return {"ok": False, "error": "No source is switched on.", **self.speed_test.status()}

        def record(source_id: str, result: Dict[str, Any]) -> None:
            self.speeds.record_test(
                source_id,
                float(result.get("bytes") or 0),
                float(result.get("seconds") or 0),
                float(result.get("delay") or 0),
                None if result.get("ok") else str(result.get("error") or "failed"),
            )

        started = self.speed_test.start(sources, self.http, record)
        return {"ok": started, **self.speed_test.status()}

    def speed_test_status(self) -> Dict[str, Any]:
        status = self.speed_test.status()
        status["last_tested"] = self.speeds.last_tested([s.id for s in self.build_sources()]) or None
        return status

    def speed_test_due(self) -> bool:
        """The automatic test should run: on, stale, and nothing downloading."""
        if not self.settings.get("speed_test_auto", True) or self.speed_test.running:
            return False
        ids = [source.id for source in self.build_sources()]
        if not ids or time.time() - self.speeds.last_tested(ids) < self.SPEED_TEST_EVERY:
            return False
        # A download in progress shares the line and would spoil the result.
        return not any(job.get("status") in ("queued", "downloading") for job in self.downloads.snapshot())

    def start_background_tasks(self) -> None:
        """Re-check the sources now and then, so a source that comes back
        (or a network that was not up yet) is picked up automatically."""
        # The single-file caches from earlier versions are a liability: they
        # were re-read and re-written on every search.
        self._drop_legacy_caches()
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - defensive
            return
        # Switch box art: the GameTDB title list, before the first search.
        try:
            self.gametdb.prefetch()
        except Exception:  # pragma: no cover - art must never stop the start
            pass

        async def ticker():
            while True:
                await asyncio.sleep(120)
                # Provider speeds, once a week, a couple of minutes after the
                # plugin starts and whenever nothing is downloading.
                try:
                    if self.speed_test_due():
                        self.start_speed_test()
                except Exception as exc:  # pragma: no cover - never stops the ticker
                    print(f"ROM Store: speed test could not start: {exc!r}")
                for source in self.build_sources():
                    if self._unreachable.get(source.id, 0.0) <= time.time():
                        continue
                    host = urlparse(source.homepage).hostname
                    if not host:
                        continue
                    try:
                        await asyncio.wait_for(
                            asyncio.to_thread(socket.getaddrinfo, host, None), timeout=3
                        )
                    except Exception:
                        self._unreachable[source.id] = time.time() + 120
                        continue
                    self._unreachable.pop(source.id, None)

        loop.create_task(ticker())

    def _prefetch_covers(self, entries: List[RomEntry]) -> None:
        urls = [entry.cover for entry in entries if entry.cover][:30]
        if not urls or not self.images.enabled:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - defensive
            return
        loop.create_task(self.images.prefetch(urls))

    # ------------------------------------------------------------------ system counts
    # ------------------------------------------------------------------ mods
    def _installed_game(self, game_id: str) -> Optional[Dict[str, Any]]:
        game = next((g for g in installed_games(self.roms_root()) if g["id"] == game_id), None)
        if game:
            # The real name: GameBanana is searched with it, not the file name.
            game["name"] = self._display_name(game)
        return game

    async def game_mods(self, game_id: str) -> Dict[str, Any]:
        """Popular mods for an installed game and what is installed (backend/mods.py)."""
        game = await asyncio.to_thread(self._installed_game, game_id)
        if not game:
            return {"supported": False, "reason": "That game is no longer in the library.", "mods": [], "emulators": []}
        return await self.mods.game_mods(game, self.roms_root())

    async def install_mod(self, game_id: str, mod_id: int, variant: Optional[str] = None) -> Dict[str, Any]:
        game = await asyncio.to_thread(self._installed_game, game_id)
        if not game:
            return {"ok": False, "error": "That game is no longer in the library."}
        return self.mods.start_install(game, int(mod_id), variant)

    async def remove_mod(self, game_id: str, mod_id: int) -> Dict[str, Any]:
        game = await asyncio.to_thread(self._installed_game, game_id)
        if not game:
            return {"ok": False, "error": "That game is no longer in the library."}
        return await asyncio.to_thread(self.mods.remove, game, int(mod_id))

    def steamgriddb_key(self) -> str:
        """The user's own SteamGridDB key, else the one built into the plugin."""
        return (self.settings.get("steamgriddb_api_key") or "").strip() or DEFAULT_STEAMGRIDDB_KEY

    async def consoles(self) -> List[Dict[str, Any]]:
        """Every console an enabled source can browse, best known first.

        There is no game count: the sites do not publish one that means
        anything for the store (one site's catalogue, before merging), and
        counting every catalogue would take hundreds of requests.
        """
        keys: set = set()
        for source in self.build_sources():
            if source.supports_browse:
                try:
                    keys |= source.browse_systems()
                except Exception:  # pragma: no cover - a broken table must not hide the rest
                    pass
        keys = {key for key in keys if key in SYSTEMS and key != "unknown"}
        rank = {key: index for index, key in enumerate(POPULAR_CONSOLES)}
        ordered = sorted(keys, key=lambda key: (rank.get(key, len(rank)), SYSTEMS[key][0].lower()))
        return [{"key": key, "count": None} for key in ordered]

    def status(self) -> Dict[str, Any]:
        return {
            "settings": self.settings.all(),
            "sources": self.describe_sources(),
            "library": self.library(),
            "downloads": self.downloads.snapshot(),
        }
