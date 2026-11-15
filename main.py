"""ROM Store - Decky plugin backend.

Searches ROM indexes (Romspedia, Retrostic, RomsDL, MyAbandonware and two
Switch catalogues), merges and de-duplicates the results, and downloads the chosen
file straight into the matching EmuDecky ROM folder.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional

# Make sure the bundled backend package is importable no matter where the
# plugin is installed.
PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

try:
    # Decky Loader >= 3.1
    import decky  # type: ignore
except ImportError:
    try:
        # Decky Loader 3.0 exposed the same helpers as decky_plugin.
        import decky_plugin as decky  # type: ignore
    except ImportError:
        # Not running on the Deck (tests, packaging checks).
        decky = None  # type: ignore

from backend.service import StoreService  # noqa: E402
from backend.settings import Settings  # noqa: E402


def _log(message: str) -> None:
    """Write to the plugin log when we run on the Deck."""
    logger = getattr(decky, "logger", None)
    if logger is not None:
        try:
            logger.info(message)
        except Exception:
            pass


def _env(name: str, *fallbacks: str) -> str:
    """Read a Decky path constant, tolerating older loaders."""
    value = getattr(decky, name, None) if decky is not None else None
    if value:
        return str(value)
    for candidate in fallbacks:
        if candidate:
            return candidate
    return ""


HOME = os.path.expanduser("~")
SETTINGS_DIR = _env(
    "DECKY_PLUGIN_SETTINGS_DIR",
    os.path.join(HOME, "homebrew", "settings", "rom-store-decky"),
)
RUNTIME_DIR = _env(
    "DECKY_PLUGIN_RUNTIME_DIR",
    os.path.join(HOME, "homebrew", "data", "rom-store-decky"),
)
PLUGIN_ROOT = _env("DECKY_PLUGIN_DIR", PLUGIN_DIR)


class Plugin:
    """The plugin entry point.

    Decky Loader >= 3.1 instantiates this class (api_version 1). Older
    loaders call the class methods with the class itself, so every entry
    point resolves a real instance first.
    """

    _instance: Optional["Plugin"] = None

    def __init__(self) -> None:
        self.settings = Settings(os.path.join(SETTINGS_DIR, "rom-store.json"))
        # Decky serves plugin files under the plugin *name* (from
        # plugin.json), not the folder it happens to live in.
        plugin_name = (
            getattr(decky, "DECKY_PLUGIN_NAME", None)
            or os.path.basename(PLUGIN_ROOT)
            or "rom-store"
        )
        self.service = StoreService(
            self.settings,
            plugin_name=plugin_name,
            runtime_dir=RUNTIME_DIR,
        )
        Plugin._instance = self

    @classmethod
    def instance(cls) -> "Plugin":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def _self(cls) -> "Plugin":
        """Return a usable instance whether we were called on one or the class."""
        return cls.instance()

    # ------------------------------------------------------------------ lifecycle
    async def _main(self) -> None:
        plugin = self._self()
        _log("ROM Store backend started")
        library = plugin.service.library()
        _log(f"ROM library root: {library['root']} (exists={library['root_exists']})")
        _log(f"TLS trust store: {plugin.service.http.ca_source}")
        # Find out right away which sources are reachable.
        try:
            await plugin.service.probe_sources()
        except Exception as exc:
            _log(f"source probe failed: {exc!r}")
        # A finished download goes to the frontend, which adds it to Steam.
        emit = getattr(decky, "emit", None) if decky is not None else None
        if emit is not None:
            import asyncio

            loop = asyncio.get_running_loop()

            def finished(job) -> None:
                loop.create_task(emit("rom_store_download_done", job.to_dict()))

            plugin.service.downloads.on_done = finished
        # Downloads that were running when the plugin last stopped continue.
        try:
            resumed = plugin.service.downloads.resume_pending()
            if resumed:
                _log(f"resuming {resumed} interrupted download(s)")
        except Exception as exc:
            _log(f"could not resume downloads: {exc!r}")
        # Keep checking, so a source that was offline comes back on its own.
        try:
            plugin.service.start_background_tasks()
        except Exception as exc:
            _log(f"could not start the background tasks: {exc!r}")

    async def _unload(self) -> None:
        plugin = self._self()
        _log("ROM Store backend unloading")
        # Pause instead of waiting: the partial files continue on the next start.
        await plugin.service.downloads.suspend_all()

    async def _uninstall(self) -> None:
        _log("ROM Store backend uninstalled")

    # ------------------------------------------------------------------ store
    async def search(self, query: str, sources: Optional[List[str]] = None,
                     system: Optional[str] = None, sort: str = "relevance",
                     limit: int = 60, page: int = 1) -> Dict[str, Any]:
        return await self._self().service.search(query, sources, system, sort, limit, page)

    async def browse(self, system: str, limit: int = 60) -> Dict[str, Any]:
        return await self._self().service.browse(system, limit)

    # ------------------------------------------------------------------ mods
    async def get_game_mods(self, game_id: str) -> Dict[str, Any]:
        """Popular GameBanana mods for an installed game (backend/mods.py)."""
        return await self._self().service.game_mods(game_id)

    async def install_mod(self, game_id: str, mod_id: int, variant: Optional[str] = None) -> Dict[str, Any]:
        return await self._self().service.install_mod(game_id, mod_id, variant)

    async def get_mod_job(self) -> Dict[str, Any]:
        return self._self().service.mods.job()

    async def cancel_mod(self) -> Dict[str, Any]:
        self._self().service.mods.cancel()
        return {"ok": True}

    async def remove_mod(self, game_id: str, mod_id: int) -> Dict[str, Any]:
        return await self._self().service.remove_mod(game_id, mod_id)

    async def get_consoles(self) -> List[Dict[str, Any]]:
        """Every console a source can browse, with its game count if known."""
        return await self._self().service.consoles()

    # ------------------------------------------------------------------ artwork
    async def get_cover(self, url: Optional[str], kind: str = "card") -> Optional[str]:
        """Resolve a remote cover image to a locally cached URL."""
        return await self._self().service.get_cover(url, kind)

    def clear_cache(self) -> Dict[str, Any]:
        return self._self().service.clear_cache()

    def cache_stats(self) -> Dict[str, Any]:
        return self._self().service.cache_stats()

    async def image_diagnostics(self, url: Optional[str] = None) -> Dict[str, Any]:
        return await self._self().service.image_diagnostics(url)

    async def prefetch_covers(self, urls: List[Optional[str]], kind: str = "card") -> None:
        await self._self().service.prefetch_covers(urls, kind)

    # ------------------------------------------------------------------ details
    async def get_details(self, rom_id: str) -> Optional[Dict[str, Any]]:
        return await self._self().service.details(rom_id)

    async def start_download(self, rom_id: str, entry_key: str, file_id: str,
                             system: Optional[str] = None,
                             destination_folder: Optional[str] = None,
                             root: Optional[str] = None) -> Dict[str, Any]:
        return await self._self().service.start_download(rom_id, entry_key, file_id, system, destination_folder, root)

    # ------------------------------------------------------------------ downloads
    async def start_speed_test(self) -> Dict[str, Any]:
        """Measure every enabled provider now; progress via get_speed_test."""
        return self._self().service.start_speed_test()

    async def get_speed_test(self) -> Dict[str, Any]:
        return self._self().service.speed_test_status()

    async def get_speeds(self) -> Dict[str, Any]:
        """Measured speed and start delay per source (backend/speeds.py)."""
        return self._self().service.speeds.all()

    async def get_downloads(self) -> List[Dict[str, Any]]:
        return self._self().service.downloads.snapshot()

    async def cancel_download(self, job_id: str) -> Dict[str, Any]:
        cancelled = self._self().service.downloads.cancel(job_id)
        return {"ok": cancelled}

    async def clear_downloads(self) -> Dict[str, Any]:
        self._self().service.downloads.clear_finished()
        return {"ok": True}

    # ------------------------------------------------------------------ settings
    async def get_settings(self) -> Dict[str, Any]:
        return self._self().settings.all()

    async def update_settings(self, values: Dict[str, Any]) -> Dict[str, Any]:
        plugin = self._self()
        updated = plugin.settings.update(values or {})
        plugin.service.downloads.set_max_concurrent(int(updated.get("max_concurrent", 2)))
        return updated

    # ------------------------------------------------------------------ shelves
    async def get_shelves(self) -> Dict[str, Any]:
        return self._self().service.shelves.all()

    async def toggle_favorite(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return self._self().service.shelves.toggle_favorite(item)

    async def add_recent(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return self._self().service.shelves.add_recent(item)

    # ------------------------------------------------------------------ steam
    async def steam_plan(self, paths: Optional[List[str]] = None, add: bool = True) -> Dict[str, Any]:
        import asyncio
        return await asyncio.to_thread(self._self().service.steam_plan, paths, add)

    async def steam_report(self, added: Dict[str, Any], removed: List[str]) -> Dict[str, Any]:
        return self._self().service.steam_report(added, removed)

    async def steam_artwork(self, title: str) -> Dict[str, Any]:
        return await self._self().service.steam_artwork(title)

    async def steam_tracked(self) -> Dict[str, Any]:
        return self._self().service.steam_tracked()

    async def srm_status(self) -> Dict[str, Any]:
        return self._self().service.srm_status()

    async def srm_start(self) -> Dict[str, Any]:
        return self._self().service.srm_start()

    async def srm_ack(self) -> Dict[str, Any]:
        return self._self().service.srm_ack()

    async def steam_status(self) -> Dict[str, Any]:
        import asyncio
        return await asyncio.to_thread(self._self().service.steam_status)

    async def get_installed(self) -> Dict[str, Any]:
        # Sizing folders walks the disk; the service keeps that off the event loop.
        return await self._self().service.installed_view()

    async def uninstall_game(self, game_id: str) -> Dict[str, Any]:
        import asyncio
        return await asyncio.to_thread(self._self().service.uninstall, game_id)

    async def check_bios(self, system: str) -> Optional[Dict[str, Any]]:
        return self._self().service.check_bios(system)

    async def get_library(self) -> Dict[str, Any]:
        return self._self().service.library()

    async def get_status(self) -> Dict[str, Any]:
        return self._self().service.status()

    async def open_folder(self, path: str) -> Dict[str, Any]:
        """Open a folder in the Deck's file manager (xdg-open)."""
        try:
            if not path or not os.path.isdir(path):
                return {"ok": False, "error": "Folder does not exist"}
            os.system(f'xdg-open "{path}" >/dev/null 2>&1 &')
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


async def main() -> None:
    """Entry point for Decky Loader versions that call main() directly."""
    plugin = Plugin.instance()
    await plugin._main()
