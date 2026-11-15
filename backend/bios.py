"""Which consoles need BIOS files, and whether this Deck has them.

ROM Store never downloads BIOS files. It only tells the player that a console
needs one, which file names the usual emulators look for, and where they go,
and it checks whether a matching file is already there.

File names are the ones RetroArch, DuckStation, PCSX2 and Flycast look for in
an EmuDeck / EmuDecky "bios" folder (next to the "roms" folder).
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

# key -> what the console needs.
#   any_of:   one of these files is enough (regional versions of one BIOS)
#   pattern:  any file whose name matches (PS2 BIOS dumps have no fixed name)
#   optional: games mostly run without it
BIOS: Dict[str, Dict[str, Any]] = {
    "psx": {
        "label": "PlayStation BIOS",
        "any_of": ["scph5501.bin", "scph5500.bin", "scph5502.bin", "scph1001.bin", "scph7001.bin", "scph101.bin"],
    },
    "ps2": {
        "label": "PlayStation 2 BIOS",
        "pattern": r"(scph|ps2).*\.bin$",
        "hint": "any PS2 BIOS dump (.bin) for PCSX2",
    },
    "saturn": {
        "label": "Saturn BIOS",
        "any_of": ["sega_101.bin", "mpr-17933.bin", "saturn_bios.bin"],
    },
    "segacd": {
        "label": "Sega CD BIOS",
        "any_of": ["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"],
    },
    "pcenginecd": {
        "label": "PC Engine CD system card",
        "any_of": ["syscard3.pce"],
    },
    "3do": {
        "label": "3DO BIOS",
        "any_of": ["panafz10.bin", "panafz1.bin", "goldstar.bin"],
    },
    "neogeo": {
        "label": "Neo Geo BIOS",
        "any_of": ["neogeo.zip"],
        "also_in_roms": True,
    },
    "atari5200": {
        "label": "Atari 5200 BIOS",
        "any_of": ["5200.rom"],
    },
    "atarilynx": {
        "label": "Lynx boot ROM",
        "any_of": ["lynxboot.img"],
    },
    "dreamcast": {
        "label": "Dreamcast BIOS",
        "any_of": ["dc/dc_boot.bin", "dc_boot.bin"],
        "optional": True,
        "hint": "Flycast runs most games without it",
    },
    "nds": {
        "label": "DS BIOS and firmware",
        "any_of": ["bios7.bin", "bios9.bin", "firmware.bin"],
        "optional": True,
        "hint": "melonDS runs most games without them",
    },
    "gba": {
        "label": "Game Boy Advance BIOS",
        "any_of": ["gba_bios.bin"],
        "optional": True,
        "hint": "mGBA runs games without it",
    },
}


def bios_folders(roms_root: str) -> List[str]:
    """Where a BIOS can live: next to the ROM folder, then the usual places."""
    home = os.path.expanduser("~")
    folders = [
        os.path.join(os.path.dirname(roms_root.rstrip("/")), "bios") if roms_root else "",
        os.path.join(home, "EmuDecky", "bios"),
        os.path.join(home, "Emulation", "bios"),
    ]
    seen: List[str] = []
    for folder in folders:
        if folder and folder not in seen:
            seen.append(folder)
    return seen


def _present(folder: str, name: str) -> bool:
    """Case-insensitive check, since emulators on Linux disagree on case."""
    path = os.path.join(folder, name)
    if os.path.isfile(path):
        return True
    parent, base = os.path.split(path)
    try:
        return any(entry.lower() == base.lower() for entry in os.listdir(parent))
    except OSError:
        return False


def check(system: str, roms_root: str, system_folder: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """What a console needs and what was found, or None if it needs nothing."""
    spec = BIOS.get(system)
    if not spec:
        return None
    folders = bios_folders(roms_root)
    search = list(folders)
    if spec.get("also_in_roms") and system_folder:
        search.append(system_folder)
    found: Optional[str] = None
    if spec.get("pattern"):
        pattern = re.compile(spec["pattern"], re.I)
        for folder in search:
            try:
                match = next((name for name in os.listdir(folder) if pattern.search(name)), None)
            except OSError:
                match = None
            if match:
                found = os.path.join(folder, match)
                break
    else:
        for name in spec.get("any_of", []):
            folder = next((f for f in search if _present(f, name)), None)
            if folder:
                found = os.path.join(folder, name)
                break
    existing = next((f for f in folders if os.path.isdir(f)), folders[0] if folders else "")
    return {
        "system": system,
        "label": spec["label"],
        "files": spec.get("any_of", []),
        "hint": spec.get("hint"),
        "optional": bool(spec.get("optional")),
        "found": found,
        "folder": existing,
    }
