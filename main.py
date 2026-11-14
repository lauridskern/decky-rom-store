"""ROM Store - Decky plugin backend.

Searches ROM indexes (Romspedia, DumbRoms, MyAbandonware), merges and
de-duplicates the results, and downloads the chosen file straight into the
matching EmuDecky ROM folder.
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

import decky  # noqa: E402  (provided by Decky Loader)

from backend.service import StoreService  # noqa: E402
from backend.settings import Settings  # noqa: E402


class Plugin:
    def __init__(self) -> None:
        self.settings = Settings(os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "rom-store.json"))
        self.service = StoreService(
            self.settings,
            plugin_name=os.path.basename(decky.DECKY_PLUGIN_DIR),
            runtime_dir=decky.DECKY_PLUGIN_RUNTIME_DIR,
        )

    # ------------------------------------------------------------------ lifecycle
    async def _main(self) -> None:
        decky.logger.info("ROM Store backend started")
        library = self.service.library()
        decky.logger.info(f"ROM library root: {library['root']} (exists={library['root_exists']})")
        decky.logger.info(f"TLS trust store: {self.service.http.ca_source}")

    async def _unload(self) -> None:
        decky.logger.info("ROM Store backend unloading")
        await self.service.downloads.wait_all()

    async def _uninstall(self) -> None:
        decky.logger.info("ROM Store backend uninstalled")

    # ------------------------------------------------------------------ store
    async def search(self, query: str, sources: Optional[List[str]] = None,
                     system: Optional[str] = None, sort: str = "relevance",
                     limit: int = 60, page: int = 1) -> Dict[str, Any]:
        return await self.service.search(query, sources, system, sort, limit, page)

    async def browse(self, system: str, limit: int = 60) -> Dict[str, Any]:
        return await self.service.browse(system, limit)

    async def get_system_counts(self) -> Dict[str, int]:
        return await self.service.system_counts()

    # ------------------------------------------------------------------ artwork
    async def get_cover(self, url: Optional[str], kind: str = "card") -> Optional[str]:
        """Resolve a remote cover image to a locally cached URL."""
        return await self.service.get_cover(url, kind)

    async def prefetch_covers(self, urls: List[Optional[str]], kind: str = "card") -> None:
        await self.service.prefetch_covers(urls, kind)

    async def get_details(self, rom_id: str) -> Optional[Dict[str, Any]]:
        return await self.service.details(rom_id)

    async def start_download(self, rom_id: str, entry_key: str, file_id: str,
                             system: Optional[str] = None,
                             destination_folder: Optional[str] = None) -> Dict[str, Any]:
        return await self.service.start_download(rom_id, entry_key, file_id, system, destination_folder)

    # ------------------------------------------------------------------ downloads
    async def get_downloads(self) -> List[Dict[str, Any]]:
        return self.service.downloads.snapshot()

    async def cancel_download(self, job_id: str) -> Dict[str, Any]:
        cancelled = self.service.downloads.cancel(job_id)
        return {"ok": cancelled}

    async def clear_downloads(self) -> Dict[str, Any]:
        self.service.downloads.clear_finished()
        return {"ok": True}

    # ------------------------------------------------------------------ settings
    async def get_settings(self) -> Dict[str, Any]:
        return self.settings.all()

    async def update_settings(self, values: Dict[str, Any]) -> Dict[str, Any]:
        updated = self.settings.update(values or {})
        self.service.downloads.set_max_concurrent(int(updated.get("max_concurrent", 2)))
        return updated

    async def get_library(self) -> Dict[str, Any]:
        return self.service.library()

    async def get_status(self) -> Dict[str, Any]:
        return self.service.status()

    async def open_folder(self, path: str) -> Dict[str, Any]:
        """Open a folder in the Deck's file manager (xdg-open)."""
        try:
            if not path or not os.path.isdir(path):
                return {"ok": False, "error": "Folder does not exist"}
            os.system(f'xdg-open "{path}" >/dev/null 2>&1 &')
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
