"""Proper names for files, and Switch title IDs by name.

Files are named however the site named them: "+Super+Mario+Bros.+Wonder.nsp",
"Legend of Zelda, The - The Wind Waker (USA).rvz", "Mario_Kart_8_[v0].xci".
The Library shows the game's real name instead, from the same databases the
covers come from (libretro, GameTDB) and, for Switch, from the title list in
backend/data/switch_titles.json.gz (title ID -> name, made from blawar's
titledb by tools/update_switch_titles.py).

That list also gives a Switch game's title ID when neither the file name nor
an NSP ticket has it (backend/mods.py needs it for the mod folders), and
Ryujinx's own game list does the same for games newer than the list:
Ryujinx keeps games/<title id>/gui/metadata.json with each game's name.
"""

from __future__ import annotations

import gzip
import json
import os
import re
from typing import Callable, Dict, Optional
from urllib.parse import unquote_plus

from .models import match_title

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "switch_titles.json.gz")
RYUJINX_GAMES = ("~/.config/Ryujinx/games", "~/.var/app/org.ryujinx.Ryujinx/config/Ryujinx/games")

_TAGS_RE = re.compile(r"\s*[\(\[\{][^)\]\}]*[\)\]\}]")
_NOISE_RE = re.compile(
    r"\b(?:nsp|xci|nsz|xcz|full\s+game|eshop|update|dlc|base\s+game)\b|\bv\d+(?:\.\d+)*\b",
    re.I,
)


def clean_name(title: str) -> str:
    """A readable name from a file name: no "+" or "_" for spaces, no tags."""
    name = title or ""
    if "%" in name or ("+" in name and " " not in name.strip()):
        name = unquote_plus(name)
    name = name.replace("_", " ")
    name = _TAGS_RE.sub(" ", name)
    name = _NOISE_RE.sub(" ", name)
    # "Legend of Zelda, The - The Wind Waker" -> "The Legend of Zelda - The Wind Waker"
    name = re.sub(r"^(.+?), (The|A|An)\b", r"\2 \1", name.strip())
    return re.sub(r"\s+", " ", name).strip(" -.+") or (title or "").strip()


class SwitchTitles:
    def __init__(self, home: Callable[[], str], path: str = DATA):
        self._home = home
        self._path = path
        self._names: Optional[Dict[str, str]] = None
        self._by_key: Dict[str, str] = {}
        self._ryujinx: Dict[str, str] = {}
        self._ryujinx_seen: Dict[str, float] = {}

    def _load(self) -> Dict[str, str]:
        if self._names is None:
            self._names = {}
            try:
                with gzip.open(self._path, "rt", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    self._names = {str(k).upper(): str(v) for k, v in data.items()}
            except (OSError, ValueError):
                pass
            for tid, name in self._names.items():
                self._by_key.setdefault(match_title(name), tid)
        return self._names

    def name(self, title_id: Optional[str]) -> Optional[str]:
        if not title_id:
            return None
        tid = title_id.upper()
        return self._load().get(tid) or self._ryujinx_names().get(tid)

    def _ryujinx_names(self) -> Dict[str, str]:
        """Title ID -> name from Ryujinx's game list, read again when it changes."""
        home = self._home()
        for folder in RYUJINX_GAMES:
            games = os.path.join(home, folder[2:])
            try:
                stamp = os.stat(games).st_mtime
            except OSError:
                continue
            if self._ryujinx_seen.get(games) == stamp:
                continue
            self._ryujinx_seen[games] = stamp
            try:
                entries = os.listdir(games)
            except OSError:
                continue
            for tid in entries:
                if not re.fullmatch(r"(?i)01[0-9a-f]{14}", tid):
                    continue
                try:
                    with open(os.path.join(games, tid, "gui", "metadata.json"), "r", encoding="utf-8") as fh:
                        title = (json.load(fh) or {}).get("title")
                except (OSError, ValueError, AttributeError):
                    continue
                if title:
                    self._ryujinx[tid.upper()] = str(title)
        return self._ryujinx

    def find(self, title: str) -> Optional[str]:
        """The base game's title ID for a name, or None."""
        self._load()
        for candidate in (title, clean_name(title)):
            key = match_title(candidate)
            if not key:
                continue
            tid = self._by_key.get(key)
            if tid:
                return tid
            for ryu_tid, ryu_name in self._ryujinx_names().items():
                if match_title(ryu_name) == key:
                    return ryu_tid
        return None
