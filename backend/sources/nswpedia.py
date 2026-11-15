"""Nswpedia - Nintendo Switch catalogue with portrait box art.

The site has no server side search (its search box is JavaScript), but its
archive pages are plain WordPress lists and every entry carries a portrait
"cover" image. That makes it two useful things at once:

* a browse-only source with real Switch box art, and
* the cover index the store uses to give every Switch game a clean, portrait
  poster, no matter which site the game was found on.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional

from html import unescape
from urllib.parse import quote_plus

from ..htmlutil import absolute, collapse_ws, parse_size, strip_tags
from ..models import RomEntry, RomFile, extract_region, normalize_title
from .base import Source

DEFAULT_BASE = "https://nswpedia.io"

_IMG_RE = re.compile(
    r'<img[^>]+src="(https?://[^"]+/wp-content/uploads/\d{4}/\d{2}/([^"]+))"[^>]*>', re.I
)
_ALT_RE = re.compile(r'alt="([^"]*)"', re.I)
# One result card, on the catalogue pages and in the search results:
#   <div class="nsw-rom-card"> ... <img src="..."> ...
#   <h3 class="nsw-card-title"><a href="https://nswpedia.io/rom/<slug>/">Title</a></h3>
#   <p class="nsw-card-size">NSP • 16.3 GB</p>
_CARD_SPLIT = 'class="nsw-rom-card"'
_CARD_TITLE_RE = re.compile(r'class="nsw-card-title"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S)
_CARD_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
_CARD_SIZE_RE = re.compile(r'class="nsw-card-size"[^>]*>([^<]*)<', re.I)
_SIZE_SUFFIX_RE = re.compile(r"-\d+x\d+(?=\.[a-z0-9]+$)", re.I)
_FILE_RE = re.compile(
    r'href="(https?://[^"]+?\.(?:nsp|xci|nspz|xcz|rar|zip)(?:\?[^"]*)?)"', re.I
)
_NOISE_RE = re.compile(r"\s*Nintendo\s+Switch\s+cover\s*(Exclusives)?\s*$", re.I)


class NswpediaSource(Source):
    id = "nswpedia"
    label = "Nswpedia"
    homepage = DEFAULT_BASE
    supports_browse = True

    def __init__(self, http, options=None):
        super().__init__(http, options)
        self.id = self.options.get("source_id", self.id)
        self.label = self.options.get("label", self.label)
        self.homepage = self.options.get("homepage", self.homepage)
        self.base = (self.options.get("base_url") or self.homepage or DEFAULT_BASE).rstrip("/")
        self._cover_index: Optional[Dict[str, str]] = None
        self._cache_dir = self.options.get("cache_dir")

    # ------------------------------------------------------------------ search
    def _parse_cards(self, html: str) -> List[Dict[str, Any]]:
        """Result cards: real page link, title, cover and size."""
        cards: List[Dict[str, Any]] = []
        for block in html.split(_CARD_SPLIT)[1:]:
            title_match = _CARD_TITLE_RE.search(block)
            if not title_match:
                continue
            title = collapse_ws(unescape(strip_tags(title_match.group(2))))
            if not title:
                continue
            image = _CARD_IMG_RE.search(block)
            size = _CARD_SIZE_RE.search(block)
            cover = absolute(self.base, image.group(1)) if image else None
            cards.append({
                "url": absolute(self.base, title_match.group(1)),
                "title": title,
                # The card shows a 200x300 crop; the upload without the size
                # suffix is the full cover.
                "cover": cover,
                "cover_full": _SIZE_SUFFIX_RE.sub("", cover) if cover else None,
                "size": parse_size(size.group(1).split("\u2022")[-1]) if size else None,
            })
        return cards

    def _card_entries(self, cards: List[Dict[str, Any]], seen: set, start: int) -> List[RomEntry]:
        entries: List[RomEntry] = []
        for card in cards:
            key = normalize_title(card["title"])
            if not key or key in seen:
                continue
            seen.add(key)
            entries.append(
                RomEntry(
                    source=self.id,
                    source_id=key,
                    title=card["title"],
                    system="switch",
                    url=card["url"],
                    cover=card["cover"],
                    cover_full=card["cover_full"],
                    size=card["size"],
                    region=extract_region(card["title"]),
                    rank=start + len(entries),
                )
            )
        return entries

    async def search(self, query: str, limit: int = 40, page: int = 1) -> List[RomEntry]:
        """The site's own WordPress search (?s=), result cards like the catalogue."""
        query = (query or "").strip()
        if not query:
            return []
        if page <= 1:
            url = f"{self.base}/?s={quote_plus(query)}"
        else:
            url = f"{self.base}/page/{page}/?s={quote_plus(query)}"
        try:
            html = await self.http.get_text(url)
        except Exception:
            html = ""
        entries = self._card_entries(self._parse_cards(html), set(), 0) if html else []
        if entries:
            return entries[:limit]
        return self._index_search(query, limit)

    def _index_search(self, query: str, limit: int) -> List[RomEntry]:
        """Fallback: match the cached cover index (no request)."""
        index = self.cached_index()
        wanted = normalize_title(query)
        if not wanted:
            return []
        hits = [title for title in index if wanted in normalize_title(title)]
        entries: List[RomEntry] = []
        for title in hits[:limit]:
            entries.append(
                RomEntry(
                    source=self.id,
                    source_id=normalize_title(title),
                    title=title,
                    system="switch",
                    url=f"{self.base}/{_slug_for(title)}/",
                    cover=index[title],
                    cover_full=index[title],
                    region=extract_region(title),
                    rank=len(entries),
                )
            )
        return entries

    # ------------------------------------------------------------------ browse
    async def browse(self, system: str, limit: int = 200) -> List[RomEntry]:
        # Switch only; see SwitchRomsSource.browse.
        if system != "switch":
            return []
        entries: List[RomEntry] = []
        seen = set()
        for page in range(1, 13):
            url = f"{self.base}/page/{page}/"
            try:
                html = await self.http.get_text(url)
            except Exception:
                break
            cards = self._parse_cards(html)
            if cards:
                added_cards = self._card_entries(cards, seen, len(entries))
                entries.extend(added_cards)
                if not added_cards or len(entries) >= limit:
                    break
                continue
            # Older page layout without cards: covers only, links guessed.
            found = self._parse_covers(html)
            if not found:
                break
            added = 0
            for title, cover in found:
                key = normalize_title(title)
                if not key or key in seen:
                    continue
                seen.add(key)
                entries.append(
                    RomEntry(
                        source=self.id,
                        source_id=key,
                        title=title,
                        system="switch",
                        url=f"{self.base}/{_slug_for(title)}/",
                        cover=cover,
                        cover_full=cover,
                        region=extract_region(title),
                        rank=len(entries),
                    )
                )
                added += 1
            if added == 0 or len(entries) >= limit:
                break
        return entries[:limit]

    def _parse_covers(self, html: str) -> List[tuple]:
        found: List[tuple] = []
        seen = set()
        for match in _IMG_RE.finditer(html):
            url, filename = match.group(1), match.group(2)
            if "cover" not in filename.lower() and "-nswpedia-io-" not in filename.lower():
                continue
            if "logo" in filename.lower():
                continue
            tag = match.group(0)
            alt = _ALT_RE.search(tag)
            title = collapse_ws(strip_tags(alt.group(1))) if alt else ""
            title = _NOISE_RE.sub("", title).strip()
            if not title:
                title = _title_from_filename(filename)
            if not title or title.lower() in seen:
                continue
            seen.add(title.lower())
            # Use the original (largest) file when WordPress added a size suffix.
            original = _SIZE_SUFFIX_RE.sub("", url)
            found.append((title, original))
        return found

    # ------------------------------------------------------------------ covers
    def cached_index(self) -> Dict[str, str]:
        """The index we already have, without any network call."""
        if self._cover_index is not None:
            return self._cover_index
        cached = self._read_cache()
        if cached:
            self._cover_index = cached
        return cached

    async def cover_index(self, refresh: bool = False) -> Dict[str, str]:
        """Title -> portrait cover url for every game we know.

        Building it means fetching a dozen archive pages, so the result is
        cached on the Deck for a day.
        """
        if self._cover_index is not None and not refresh:
            return self._cover_index
        cached = self._read_cache()
        if cached and not refresh:
            self._cover_index = cached
            return cached
        index: Dict[str, str] = {}
        for page in range(1, 7):
            try:
                html = await self.http.get_text(f"{self.base}/page/{page}/")
            except Exception:
                break
            for title, cover in self._parse_covers(html):
                index.setdefault(title, cover)
            if not index:
                break
        if index:
            self._write_cache(index)
        self._cover_index = index
        return index

    # ------------------------------------------------------------------ cache
    def _cache_path(self) -> Optional[str]:
        if not self._cache_dir:
            return None
        return os.path.join(self._cache_dir, "nswpedia_covers.json")

    def _read_cache(self) -> Dict[str, str]:
        path = self._cache_path()
        if not path or not os.path.isfile(path):
            return {}
        try:
            if time.time() - os.path.getmtime(path) > 24 * 60 * 60:
                return {}
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            return {str(k): str(v) for k, v in (data or {}).items()}
        except (OSError, ValueError):
            return {}

    def _write_cache(self, index: Dict[str, str]) -> None:
        path = self._cache_path()
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(index, fh)
        except OSError:
            pass

    async def media(self, entry: RomEntry) -> Optional[Dict[str, Any]]:
        """The cover art of every game, plus the page imagery."""
        try:
            html = await self.http.get_text(entry.url)
        except Exception:
            return None
        shots: List[Dict[str, str]] = []
        if entry.cover:
            shots.append({"kind": "image", "thumb": entry.cover, "full": entry.cover})
        # Only the images of the game itself.
        body = html
        start = html.find('class="entry-content"')
        if start != -1:
            end = html.find("</article>", start)
            body = html[start: end if end != -1 else len(html)]
        for match in re.finditer(r'src="(https?://[^"]+/wp-content/uploads/[^"]+)"', body):
            url = match.group(1).split("?")[0]
            if "logo" in url.lower() or "cropped-" in url.lower():
                continue
            if any(shot["full"] == url for shot in shots):
                continue
            shots.append({"kind": "image", "thumb": url, "full": url})
            if len(shots) >= 5:
                break
        if not shots:
            return None
        return {"shots": shots, "caption": entry.title}

    # ------------------------------------------------------------------ details
    async def resolve(self, entry: RomEntry) -> List[RomFile]:
        try:
            html = await self.http.get_text(entry.url)
        except Exception:
            return []
        match = _FILE_RE.search(html)
        if not match:
            return []
        url = match.group(1).replace("&amp;", "&")
        name = url.split("/")[-1].split("?")[0]
        return [
            RomFile(
                id=f"{entry.source_id}-0",
                filename=name,
                url=url,
                size=None,
                region=entry.region,
                source_url=entry.url,
            )
        ]

    def describe(self) -> Dict[str, Any]:
        data = super().describe()
        data["base_url"] = self.base
        return data


def _slug_for(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug


def _title_from_filename(filename: str) -> str:
    name = filename.rsplit("/", 1)[-1]
    name = re.sub(r"-\d+x\d+(?=\.[a-z0-9]+$)", "", name, flags=re.I)
    name = re.sub(r"-Nswpedia-io-Cover(?:\.[a-z0-9]+)?$", "", name, flags=re.I)
    name = re.sub(r"\.[a-z0-9]+$", "", name, flags=re.I)
    name = name.replace("-", " ").strip()
    return name.title() if name else ""
