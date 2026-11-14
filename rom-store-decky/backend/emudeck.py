"""Locate the EmuDecky ROM library and map consoles onto its folders."""

from __future__ import annotations

import glob
import os
from typing import Dict, List, Optional

from .systems import emudeck_folder, known_systems

# Directory names used by EmuDecky / EmuDeck installations.
ROM_DIR_NAMES = ("roms", "ROMs", "games", "Games")


def _home() -> str:
    return os.path.expanduser("~")


def detect_rom_roots() -> List[str]:
    """Return candidate ROM roots, most likely first."""
    candidates: List[str] = []
    home = _home()

    # EmuDecky (the Decky plugin) and plain EmuDeck layouts.
    candidates.append(os.path.join(home, "EmuDecky", "roms"))
    candidates.append(os.path.join(home, "Emulation", "roms"))
    candidates.append(os.path.join(home, "roms"))

    # SD cards / external drives (SteamOS mounts them under /run/media).
    for mount in sorted(glob.glob("/run/media/*/*")):
        candidates.append(os.path.join(mount, "EmuDecky", "roms"))
        candidates.append(os.path.join(mount, "Emulation", "roms"))
        candidates.append(os.path.join(mount, "roms"))

    # Decky / Homebrew style locations.
    candidates.append(os.path.join(home, "homebrew", "roms"))

    existing = [p for p in candidates if os.path.isdir(p)]
    missing = [p for p in candidates if p not in existing]
    return existing + missing


def list_folders(root: str) -> List[str]:
    if not root or not os.path.isdir(root):
        return []
    try:
        names = [
            name
            for name in os.listdir(root)
            if os.path.isdir(os.path.join(root, name)) and not name.startswith(".")
        ]
    except OSError:
        return []
    return sorted(names, key=str.lower)


def resolve_folder(root: str, system_key: str, create: bool = False) -> str:
    """Return the folder inside `root` that should hold this system."""
    available = list_folders(root)
    folder = emudeck_folder(system_key, available)
    path = os.path.join(root, folder)
    if create and not os.path.isdir(path):
        try:
            os.makedirs(path, exist_ok=True)
        except OSError:
            pass
    return path


def system_folders(root: str) -> List[Dict[str, str]]:
    """Describe every known system plus the folder it would use on this Deck."""
    available = list_folders(root)
    folders = {name.lower(): name for name in available}
    out: List[Dict[str, str]] = []
    for system in known_systems():
        folder = emudeck_folder(system["key"], available)
        out.append(
            {
                "key": system["key"],
                "label": system["label"],
                "folder": folder,
                "exists": folders.get(folder.lower(), folder) in folders,
                "path": os.path.join(root, folder),
            }
        )
    return out


def is_writable(path: str) -> bool:
    directory = path if os.path.isdir(path) else os.path.dirname(path)
    return os.access(directory or ".", os.W_OK)
