"""Common interface implemented by every ROM source."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..httpclient import HttpClient
from ..models import RomEntry, RomFile


class SourceError(Exception):
    """Raised when a source cannot be reached or returns garbage."""


class Source:
    """A site the plugin can search and download from."""

    id: str = "source"
    label: str = "Source"
    homepage: str = ""
    supports_browse: bool = False
    supports_regions: bool = False

    def __init__(self, http: HttpClient, options: Optional[Dict[str, Any]] = None):
        self.http = http
        self.options = options or {}

    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        raise NotImplementedError

    async def browse(self, system: str, limit: int = 40) -> List[RomEntry]:
        raise NotImplementedError

    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        """Return the downloadable files for an entry (may be empty)."""
        return list(entry.files)

    async def media(self, entry: RomEntry) -> Optional[Dict[str, Any]]:
        """Screenshots/artwork this site has for a game (optional)."""
        return None

    async def resolve_download(self, rom_file: RomFile) -> str:
        """Return the URL that actually serves the bytes (default: as is)."""
        return rom_file.url

    def describe(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "homepage": self.homepage,
            "supports_browse": self.supports_browse,
            "supports_regions": self.supports_regions,
            "configured": True,
            "base_url": self.options.get("base_url", ""),
        }
