"""Merge results coming from different sources and drop duplicates."""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence

from .models import MergedRom, RomEntry, match_title, title_sort_key


def _group_key(entry: RomEntry) -> str:
    # match_title ignores spacing, accents and filler words, so "Pokemon Red",
    # "Pokémon - Red Version (USA)" and "Pokemon Red Version" are one game.
    return f"{entry.system}::{match_title(entry.title)}"


def merge_entries(entries: Iterable[RomEntry], source_priority: Optional[Sequence[str]] = None) -> List[MergedRom]:
    """Group entries by (system, normalised title) and order them by priority.

    The groups are interleaved round robin across the sources, so a single
    source can never push every other source off the first page. Inside a
    group the entries keep the order the source returned them.
    """
    priority = list(source_priority or [])
    entries = list(entries)

    groups: Dict[str, List[RomEntry]] = {}
    per_source: Dict[str, List[RomEntry]] = {}
    for entry in entries:
        groups.setdefault(_group_key(entry), []).append(entry)
        per_source.setdefault(entry.source, []).append(entry)

    def rank(entry: RomEntry) -> tuple:
        try:
            prio = priority.index(entry.source)
        except ValueError:
            prio = len(priority)
        richness = sum(
            1
            for value in (entry.cover, entry.rating, entry.downloads, entry.year, entry.size, entry.summary)
            if value
        )
        return (prio, entry.rank, -richness, title_sort_key(entry.title))

    for group in groups.values():
        group.sort(key=rank)

    ordered_sources = sorted(
        per_source,
        key=lambda source: (
            priority.index(source) if source in priority else len(priority),
            source,
        ),
    )

    ordered_keys: List[str] = []
    seen = set()
    index = 0
    while True:
        added = False
        for source in ordered_sources:
            source_entries = per_source[source]
            if index < len(source_entries):
                key = _group_key(source_entries[index])
                if key not in seen:
                    seen.add(key)
                    ordered_keys.append(key)
                added = True
        if not added:
            break
        index += 1

    merged: List[MergedRom] = []
    for position, key in enumerate(ordered_keys):
        group = groups[key]
        primary = group[0]
        merged.append(
            MergedRom(
                id=f"rom-{position}-{primary.normalized_title[:48] or 'game'}".replace(" ", "-"),
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
