"""Unpacking downloaded archives, where the emulator needs it.

The sites publish many games as .zip or .7z. Cartridge emulators mostly open
those directly, disc emulators do not: PPSSPP takes .7z but not .zip,
DuckStation and Dolphin take neither. Steam ROM Manager's parsers list the
file types each emulator takes, so a game left in an archive the emulator
cannot open is never added to Steam (backend/steam.py) and cannot be played.

``needs_unpack`` decides from the EmuDeck parsers for the console's folder
(and, without Steam ROM Manager, from a list of disc consoles); ``unpack``
extracts the archive next to itself: ZIP with Python, 7z and RAR with bsdtar
(part of SteamOS). Folders inside the archive are flattened into the console
folder, nothing existing is overwritten, and nothing is written outside it.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import zipfile
from typing import Any, List, Optional

from .htmlutil import safe_filename

ARCHIVES = (".zip", ".7z", ".rar")

# Consoles whose emulators read disc images, not archives, when there is no
# Steam ROM Manager parser to ask.
DISC_SYSTEMS = {
    "psp", "psx", "ps2", "ps3", "psvita", "gc", "wii", "wiiu", "switch", "3ds", "dreamcast", "saturn", "segacd",
    "pcenginecd", "neogeocd", "3do", "xbox", "xbox360", "pcfx",
}


def archive_ext(name: str) -> Optional[str]:
    lower = (name or "").lower()
    return next((ext for ext in ARCHIVES if lower.endswith(ext)), None)


def needs_unpack(system: str, folder: str, filename: str, srm: Optional[Any] = None) -> bool:
    """True when this archive has to be unpacked for the console's emulator.

    ``srm`` is a steam.SrmConfig: the parsers for this folder say which file
    types the emulator takes; an archive type none of them lists is unpacked.
    """
    ext = archive_ext(filename)
    if not ext:
        return False
    if srm is not None and getattr(srm, "parsers", None):
        real = os.path.realpath(folder)
        mine = [p for p in srm.parsers if srm.rom_dir(p) == real]
        listed = [srm.extensions(p) for p in mine]
        if any(listed):
            return not any(ext in exts for exts in listed if exts)
    return system in DISC_SYSTEMS


def _unique(path: str) -> str:
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    index = 2
    while os.path.exists(f"{stem} ({index}){ext}"):
        index += 1
    return f"{stem} ({index}){ext}"


def unpack(archive: str, destination: str) -> List[str]:
    """Extract every file into ``destination`` (flat). Returns the new files.

    Raises RuntimeError when the archive cannot be read or unpacked.
    """
    os.makedirs(destination, exist_ok=True)
    work = tempfile.mkdtemp(prefix=".unpack-", dir=destination)
    try:
        if zipfile.is_zipfile(archive):
            with zipfile.ZipFile(archive) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    name = safe_filename(os.path.basename(info.filename.replace("\\", "/")))
                    if not name:
                        continue
                    target = _unique(os.path.join(work, name))
                    with zf.open(info) as src, open(target, "wb") as out:
                        shutil.copyfileobj(src, out, 1 << 20)
        else:
            tool = shutil.which("bsdtar")
            if not tool:
                raise RuntimeError("This is a 7z/RAR archive and bsdtar is not available to unpack it")
            raw = os.path.join(work, ".raw")
            os.makedirs(raw)
            done = subprocess.run([tool, "-xf", archive, "-C", raw], capture_output=True, text=True, timeout=3600)
            if done.returncode != 0:
                raise RuntimeError(f"Could not unpack the archive: {done.stderr.strip()[:200]}")
            real_raw = os.path.realpath(raw)
            for folder, _dirs, files in os.walk(raw):
                for name in files:
                    source = os.path.join(folder, name)
                    # bsdtar keeps paths inside -C; a link pointing out is skipped.
                    if os.path.islink(source) or not os.path.realpath(source).startswith(real_raw + os.sep):
                        continue
                    target = _unique(os.path.join(work, safe_filename(name)))
                    os.replace(source, target)
            shutil.rmtree(raw, ignore_errors=True)
        produced: List[str] = []
        for name in sorted(os.listdir(work)):
            target = _unique(os.path.join(destination, name))
            os.replace(os.path.join(work, name), target)
            produced.append(target)
        if not produced:
            raise RuntimeError("The archive is empty")
        return produced
    except (zipfile.BadZipFile, OSError) as exc:
        raise RuntimeError(f"Could not unpack the archive: {exc}") from exc
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main_file(files: List[str]) -> Optional[str]:
    """What to launch among unpacked files: a playlist, cue or the biggest."""
    for ext in (".m3u", ".cue", ".gdi"):
        for path in files:
            if path.lower().endswith(ext):
                return path
    return max(files, key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0) if files else None
