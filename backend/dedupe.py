"""Merge results coming from different sources and drop duplicates."""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence

from .models import MergedRom, RomEntry, title_sort_key


def _group_key(entry: RomEntry) -> str:
    return f"{entry.system}::{entry.normalized_title}"


def merge_entries(entries: Iterable[RomEntry], source_priority: Optional[Sequence[str]] = None) -> List[MergedRom]:
    """Group entries by (system, normalised title) and order them by priority.

    `source_priority` is a list of source ids, most trusted first. Entries that
    share a title are kept as variants of one result so the UI can offer the
    region specific builds a source knows about.
    """
    priority = list(source_priority or [])
    buckets: Dict[str, List[RomEntry]] = {}
    order: List[str] = []

    for entry in entries:
        key = _group_key(entry)
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(entry)

    def rank(entry: RomEntry) -> tuple:
        try:
            prio = priority.index(entry.source)
        except ValueError:
            prio = len(priority)
        # Within a source keep the order the site returned (its own relevance).
        source_rank = entry.rank
        # Prefer entries that carry more metadata.
        richness = sum(
            1
            for value in (entry.cover, entry.rating, entry.downloads, entry.year, entry.size, entry.summary)
            if value
        )
        return (prio, source_rank, -richness, title_sort_key(entry.title))

    merged: List[MergedRom] = []
    for index, key in enumerate(order):
        group = sorted(buckets[key], key=rank)
        primary = group[0]
        merged.append(
            MergedRom(
                id=f"rom-{index}-{primary.normalized_title[:48] or 'game'}".replace(" ", "-"),
                title=primary.title,
                system=primary.system,
                entries=group,
            )
        )
    return merged


def sort_roms(roms: List[MergedRom], sort: str) -> List[MergedRom]:
    """Sort merged results for display."""
    if sort == "downloads":
        return sorted(roms, key=lambda r: (-(r.downloads or 0), title_sort_key(r.title)))
    if sort == "rating":
        return sorted(roms, key=lambda r: (-(r.rating or 0), title_sort_key(r.title)))
    if sort == "year":
        return sorted(roms, key=lambda r: (-(r.year or 0), title_sort_key(r.title)))
    if sort == "size":
        return sorted(roms, key=lambda r: (-(r.size or 0), title_sort_key(r.title)))
    return sorted(roms, key=lambda r: title_sort_key(r.title))
