"""Steam library artwork for the shortcuts the plugin adds (see steam.py).

Steam ROM Manager gives its shortcuts artwork from SteamGridDB; this does the
same for the shortcuts made here, for these slots of a Steam library entry:

    capsule  portrait cover (600x900)        hero  wide banner on the game page
    header   landscape cover (920x430)       logo  the game's logo over the hero
    icon     the small square icon

Sources, best first:
- SteamGridDB, with the user's own API key (Settings; free at
  steamgriddb.com -> Preferences -> API). SRM uses a key built into SRM; that
  one is SRM's and is not borrowed here.
- IGDB, through the credentials the plugin already has: the cover for the
  capsule, the official key art (or a screenshot) for the hero and header.
  IGDB has no logos or icons.

Images go to the frontend as base64, which sets them with
SteamClient.Apps.SetCustomArtworkForApp. Steam takes PNG and JPEG only.
"""

from __future__ import annotations

import asyncio
import base64
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from .covers import IgdbCovers
from .httpclient import HttpClient, HttpError

SGDB_API = "https://www.steamgriddb.com/api/v2"
IGDB_IMAGES = "https://images.igdb.com/igdb/image/upload"
MAX_IMAGE = 12 * 1024 * 1024

# Slot -> SteamGridDB endpoint and query (static images, nothing NSFW or joke).
_SGDB_SLOTS = {
    "capsule": ("grids", "dimensions=600x900&types=static&nsfw=false&humor=false"),
    "header": ("grids", "dimensions=920x430,460x215&types=static&nsfw=false&humor=false"),
    "hero": ("heroes", "types=static&nsfw=false&humor=false"),
    "logo": ("logos", "types=static&nsfw=false&humor=false"),
    "icon": ("icons", "types=static&nsfw=false&humor=false"),
}
_IGDB_ID_RE = re.compile(r"/upload/[^/]+/([a-z0-9]+)\.(?:jpg|png)", re.I)


class SteamArtwork:
    def __init__(self, http: HttpClient, covers: IgdbCovers, sgdb_key: str = ""):
        self._http = http
        self._covers = covers
        self.sgdb_key = (sgdb_key or "").strip()

    # ------------------------------------------------------------------ sources
    async def _sgdb(self, path: str) -> Any:
        resp = await self._http.request(
            f"{SGDB_API}/{path}",
            headers={"Authorization": f"Bearer {self.sgdb_key}", "Accept": "application/json"},
            polite=False,
            retries=1,
        )
        data = resp.json()
        if not data.get("success"):
            raise HttpError(f"SteamGridDB: {data.get('errors') or 'request failed'}")
        return data.get("data")

    async def _from_sgdb(self, title: str) -> Dict[str, List[str]]:
        games = await self._sgdb(f"search/autocomplete/{quote(title, safe='')}")
        if not games:
            return {}
        game_id = games[0]["id"]

        async def slot(name: str, endpoint: str, query: str):
            try:
                images = await self._sgdb(f"{endpoint}/game/{game_id}?{query}") or []
            except (HttpError, ValueError, KeyError):
                return name, []
            # Steam takes PNG and JPEG; SteamGridDB also has WebP.
            return name, [i["url"] for i in images if i.get("url") and i.get("mime") in ("image/png", "image/jpeg")][:3]

        found = await asyncio.gather(*(slot(n, e, q) for n, (e, q) in _SGDB_SLOTS.items()))
        return {name: urls for name, urls in found if urls}

    async def _from_igdb(self, title: str) -> Dict[str, List[str]]:
        if not self._covers.enabled:
            return {}
        info = await self._covers.lookup(title)
        if not info:
            return {}
        cover = info.get("cover_id") or self._igdb_id(info.get("cover"))
        # Hero and header are wide slots (1920x620, 920x430): only landscape
        # images, key art first, then screenshots. Key art is often a poster.
        def wide(images: List[List[Any]]) -> List[str]:
            return [i for i, w, h in images if w and h and w / h >= 1.25]

        art = wide(info.get("artworks") or [])
        shots = wide(info.get("screenshots") or [])
        if not info.get("screenshots"):
            # Looked up before sizes were cached: screenshots are wide anyway.
            shots = [i for i in (self._igdb_id(s.get("full")) for s in info.get("shots") or []) if i]
        candidates = art + shots
        result: Dict[str, List[str]] = {}
        if cover:
            result["capsule"] = [f"{IGDB_IMAGES}/t_cover_big_2x/{cover}.jpg"]
        if candidates:
            result["hero"] = [f"{IGDB_IMAGES}/t_1080p/{i}.jpg" for i in candidates[:2]]
            result["header"] = [f"{IGDB_IMAGES}/t_720p/{i}.jpg" for i in candidates[:2]]
        return result

    @staticmethod
    def _igdb_id(url: Optional[str]) -> Optional[str]:
        match = _IGDB_ID_RE.search(url or "")
        return match.group(1) if match else None

    async def find(self, title: str) -> Dict[str, Any]:
        """Candidate image URLs per slot, and where they came from."""
        if self.sgdb_key:
            try:
                urls = await self._from_sgdb(title)
                if urls:
                    return {"source": "steamgriddb", "urls": urls}
            except (HttpError, ValueError, KeyError) as exc:
                # A wrong key must not cost the shortcut its art: IGDB next.
                igdb = await self._from_igdb(title)
                return {"source": "igdb", "urls": igdb, "warning": f"SteamGridDB: {exc}"}
        return {"source": "igdb", "urls": await self._from_igdb(title)}

    # ------------------------------------------------------------------ images
    async def _image(self, url: str) -> Optional[Dict[str, str]]:
        try:
            resp = await self._http.request(url, polite=False, retries=1, max_bytes=MAX_IMAGE)
        except HttpError:
            return None
        ctype = resp.header("content-type").lower()
        ext = "png" if "png" in ctype or url.lower().endswith(".png") else "jpg" if ("jpeg" in ctype or "jpg" in ctype or url.lower().endswith((".jpg", ".jpeg"))) else None
        if not ext or not resp.body:
            return None
        return {"data": base64.b64encode(resp.body).decode("ascii"), "ext": ext}

    async def assets(self, title: str) -> Dict[str, Any]:
        """The images themselves, base64, one per slot (first candidate that loads)."""
        found = await self.find(title)
        assets: Dict[str, Dict[str, str]] = {}
        for slot, urls in (found.get("urls") or {}).items():
            for url in urls:
                image = await self._image(url)
                if image:
                    assets[slot] = image
                    break
        return {"source": found.get("source"), "warning": found.get("warning"), "assets": assets}
