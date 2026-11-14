"""Data model shared by the sources, the aggregator and the Decky bridge."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

# Region hints that show up in ROM titles: (USA), (U), [E], (Japan), ...
_REGION_TOKENS = (
    "usa", "us", "u", "europe", "eu", "e", "japan", "j", "jp", "world", "w",
    "asia", "korea", "brazil", "canada", "australia", "scandinavia", "italy",
    "spain", "france", "germany", "china", "hong kong", "taiwan", "unknown",
    "multi", "region free", "regionfree",
)

_REGION_RE = re.compile(r"[\(\[]\s*([^)\]]{1,24}?)\s*[\)\]]")
_TAG_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")


def extract_region(title: str) -> Optional[str]:
    """Pull the region out of a ROM title such as 'Sonic (USA).zip'."""
    if not title:
        return None
    for group in _REGION_RE.findall(title):
        token = group.strip().lower()
        token = re.sub(r"\s+", " ", token)
        # Skip tags that are clearly not regions (build info, languages, ...).
        if token in _REGION_TOKENS:
            return group.strip().upper() if len(token) <= 3 else group.strip()
        if re.fullmatch(r"[a-z]{2,3}", token) and token in ("eu", "jp", "us", "uk", "au", "br", "kr", "cn"):
            return group.strip().upper()
    return None


def normalize_title(title: str) -> str:
    """Title without region/tag noise - used to detect duplicates."""
    if not title:
        return ""
    text = title.lower()
    # Drop file extension first ("Super Mario (USA).zip" -> "Super Mario (USA)").
    text = re.sub(r"\.(zip|7z|rar|iso|xci|nsp|xci|rom|bin|chd|cue|gz|tar|exe|iso)$", "", text, flags=re.I)
    text = _TAG_RE.sub(" ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\b(the|a|an|of|and)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def title_sort_key(title: str) -> str:
    return re.sub(r"^(the|a|an)\s+", "", (title or "").strip(), flags=re.I).lower()


@dataclass
class RomFile:
    """A single downloadable file for a ROM entry."""

    id: str
    filename: str
    url: str = ""
    size: Optional[int] = None
    region: Optional[str] = None
    label: Optional[str] = None
    source_url: Optional[str] = None  # page the url was resolved from

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RomEntry:
    """One result coming from one source."""

    source: str
    source_id: str
    title: str
    system: str
    url: str = ""
    cover: Optional[str] = None
    cover_full: Optional[str] = None
    summary: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    downloads: Optional[int] = None
    year: Optional[int] = None
    size: Optional[int] = None
    region: Optional[str] = None
    developer: Optional[str] = None
    publisher: Optional[str] = None
    genres: List[str] = field(default_factory=list)
    files: List[RomFile] = field(default_factory=list)
    rank: int = 0
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.source}:{self.source_id}"

    @property
    def normalized_title(self) -> str:
        return normalize_title(self.title)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["key"] = self.key
        data["normalized_title"] = self.normalized_title
        data["error"] = self.extra.get("error")
        return data


@dataclass
class MergedRom:
    """A de-duplicated title that may exist on several sources."""

    id: str
    title: str
    system: str
    entries: List[RomEntry] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def sources(self) -> List[str]:
        seen: List[str] = []
        for entry in self.entries:
            if entry.source not in seen:
                seen.append(entry.source)
        return seen

    @property
    def cover(self) -> Optional[str]:
        for entry in self.entries:
            if entry.cover:
                return entry.cover
        return None

    @property
    def rating(self) -> Optional[float]:
        values = [e.rating for e in self.entries if e.rating is not None]
        return max(values) if values else None

    @property
    def downloads(self) -> Optional[int]:
        values = [e.downloads for e in self.entries if e.downloads is not None]
        return max(values) if values else None

    @property
    def year(self) -> Optional[int]:
        for entry in self.entries:
            if entry.year:
                return entry.year
        return None

    @property
    def regions(self) -> List[str]:
        regions: List[str] = []
        for entry in self.entries:
            region = entry.region or extract_region(entry.title)
            if region and region not in regions:
                regions.append(region)
        return regions

    @property
    def size(self) -> Optional[int]:
        for entry in self.entries:
            if entry.size:
                return entry.size
            for f in entry.files:
                if f.size:
                    return f.size
        return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "system": self.system,
            "sources": self.sources,
            "cover": self.cover,
            "rating": self.rating,
            "downloads": self.downloads,
            "year": self.year,
            "regions": self.regions,
            "size": self.size,
            "variants": len(self.entries),
            "entries": [e.to_dict() for e in self.entries],
            "extra": dict(self.extra),
        }
