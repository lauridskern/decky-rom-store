"""What is in the ROM library: the "In library" badge, the list of installed
games, and uninstalling them."""

from __future__ import annotations

import hashlib
import os
import shutil
import threading
from typing import Any, Dict, List, Optional, Set, Tuple

from .emudeck import list_folders
from .models import match_title
from .systems import emudeck_folder, known_systems


class LibraryIndex:
    """Matching keys of the files in each console folder.

    A folder is only listed again when its modification time changes (adding
    or removing a file changes it), so marking a page of results costs one
    stat() per console.
    """

    def __init__(self) -> None:
        self._folders: Dict[str, Tuple[float, Set[str]]] = {}
        self._lock = threading.Lock()

    def keys(self, folder: str) -> Set[str]:
        try:
            mtime = os.stat(folder).st_mtime
        except OSError:
            return set()
        with self._lock:
            cached = self._folders.get(folder)
            if cached and cached[0] == mtime:
                return cached[1]
        keys: Set[str] = set()
        try:
            with os.scandir(folder) as scan:
                for item in scan:
                    if item.name.startswith(".") or item.name.endswith(".part"):
                        continue
                    key = match_title(item.name)
                    if key:
                        keys.add(key)
        except OSError:
            return set()
        with self._lock:
            self._folders[folder] = (mtime, keys)
        return keys

    def contains(self, folder: str, title: str) -> bool:
        key = match_title(title)
        return bool(key) and key in self.keys(folder)


# ---------------------------------------------------------------- installed

# Not games: EmuDeck's notes in every console folder, saves, artwork, configs.
_SKIP_NAMES = {"systeminfo.txt", "metadata.txt", "readme.txt", "_info.txt", "desktop.ini", "thumbs.db", ".gitkeep"}
_SKIP_EXTENSIONS = {
    ".txt", ".md", ".nfo", ".xml", ".json", ".ini", ".cfg", ".db", ".dat", ".log",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4",
    ".srm", ".sav", ".state", ".sta", ".mcr", ".dsv", ".eep", ".fla", ".sra", ".rtc",
    ".part", ".tmp",
}
_SKIP_FOLDERS = {"media", "images", "videos", "manuals", "screenshots", "saves", "states", "snap", "downloaded_images"}
# Emulator storage EmuDeck and the emulators keep inside console folders:
# Vita3K's InstalledGames, Cemu's mlc01 and its games path "roms", Yuzu /
# Ryujinx's nand and keys, shader caches, updates, DLC, ...
_EMULATOR_FOLDERS = {
    "installedgames", "mlc01", "roms", "nand", "sys", "usr", "sdcard", "ux0",
    "bios", "firmware", "keys", "shaders", "shadercache", "cache", "content",
    "update", "updates", "dlc", "patches", "textures", "cheats", "mods",
    "config", "configs", "logs", "temp", "tmp",
}
# No game is smaller, all its files together (a .m3u or .cue alone is tiny,
# but it comes with its discs), while what emulators leave behind (an empty
# games path, a stub) often is.
_MIN_GAME_BYTES = 1024


def _counts(name: str) -> bool:
    """A file name that can belong to a game (not a note, save or picture)."""
    lower = name.lower()
    return not (lower.startswith(".") or lower in _SKIP_NAMES or os.path.splitext(lower)[1] in _SKIP_EXTENSIONS)


def _has_game_data(path: str) -> bool:
    """A folder holds at least _MIN_GAME_BYTES of files that can be a game."""
    total = 0
    for folder, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if not _counts(name):
                continue
            try:
                total += os.path.getsize(os.path.join(folder, name))
            except OSError:
                continue
            if total >= _MIN_GAME_BYTES:
                return True
    return False


def _is_game(entry: os.DirEntry) -> bool:
    name = entry.name.lower()
    if not _counts(name):
        return False
    try:
        if entry.is_symlink():
            # EmuDeck links emulator storage (Vita3K's InstalledGames, Cemu's
            # mlc01) into the console folders. A link to a folder is that,
            # never a game, and a broken link is nothing at all.
            if not os.path.exists(entry.path) or os.path.isdir(entry.path):
                return False
        elif entry.is_dir(follow_symlinks=False):
            if name in _SKIP_FOLDERS or name in _EMULATOR_FOLDERS:
                return False
            return _has_game_data(entry.path)
        return True
    except OSError:
        return False


def _size(path: str) -> int:
    if os.path.isdir(path) and not os.path.islink(path):
        total = 0
        for folder, _dirs, files in os.walk(path):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(folder, name))
                except OSError:
                    pass
        return total
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _game_id(system: str, key: str) -> str:
    return hashlib.sha1(f"{system}|{key}".encode("utf-8")).hexdigest()[:16]


def installed_games(root: str) -> List[Dict[str, Any]]:
    """Every game in the console folders of a ROM library, newest first.

    Files that belong to one game share a title ("Game (USA) (Disc 1).chd",
    "Game (USA).m3u") and are listed, sized and removed together.
    """
    if not root or not os.path.isdir(root):
        return []
    available = list_folders(root)
    seen_folders: Set[str] = set()
    games: List[Dict[str, Any]] = []
    for system in known_systems():
        folder_name = emudeck_folder(system["key"], available, strict=True)
        folder = os.path.join(root, folder_name)
        if folder_name.lower() in seen_folders or not os.path.isdir(folder):
            continue
        seen_folders.add(folder_name.lower())
        grouped: Dict[str, List[os.DirEntry]] = {}
        try:
            with os.scandir(folder) as scan:
                for entry in scan:
                    if _is_game(entry):
                        key = match_title(entry.name) or entry.name.lower()
                        grouped.setdefault(key, []).append(entry)
        except OSError:
            continue
        for key, entries in grouped.items():
            entries.sort(key=lambda e: (len(e.name), e.name))
            files = [{"name": e.name, "size": _size(e.path), "folder": e.is_dir(follow_symlinks=False)} for e in entries]
            if sum(f["size"] for f in files) < _MIN_GAME_BYTES:
                continue
            try:
                newest = max(e.stat(follow_symlinks=False).st_mtime for e in entries)
            except OSError:
                newest = 0.0
            title = os.path.splitext(entries[0].name)[0] if not entries[0].is_dir() else entries[0].name
            games.append({
                "id": _game_id(system["key"], key),
                "system": system["key"],
                "title": title,
                "folder": folder,
                "files": files,
                "size": sum(f["size"] for f in files),
                "modified": newest,
            })
    games.sort(key=lambda g: g["modified"], reverse=True)
    return games


def uninstall(root: str, game_id: str) -> Dict[str, Any]:
    """Delete one installed game's files.

    The game is looked up again by id (the frontend never sends paths), and
    every path is checked to be a direct child of a console folder inside the
    ROM library before anything is removed.
    """
    game = next((g for g in installed_games(root) if g["id"] == game_id), None)
    if not game:
        return {"ok": False, "error": "That game is no longer in the library."}
    # The console folder must be a direct child of the library by name. It may
    # itself be a symlink (EmuDeck links console folders to the SD card), so
    # the files are checked against wherever it really points.
    if os.path.dirname(os.path.normpath(game["folder"])) != os.path.normpath(root):
        return {"ok": False, "error": "Refusing to delete outside the ROM library."}
    folder = os.path.realpath(game["folder"])
    removed = 0
    freed = 0
    errors: List[str] = []
    for item in game["files"]:
        path = os.path.join(game["folder"], item["name"])
        real = os.path.realpath(path)
        if os.path.dirname(real) != folder and not os.path.islink(path):
            errors.append(f"{item['name']}: outside the console folder")
            continue
        try:
            if item["folder"] and not os.path.islink(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            removed += 1
            freed += int(item["size"] or 0)
        except OSError as exc:
            errors.append(f"{item['name']}: {exc.strerror or exc}")
    return {
        "ok": not errors,
        "removed": removed,
        "freed": freed,
        "title": game["title"],
        "error": "; ".join(errors) or None,
    }
