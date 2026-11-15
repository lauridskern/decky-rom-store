"""Mods for installed games: popular ones from GameBanana, installed in one go.

What a mod is and where it goes depends on the emulator, so this knows a few:

    Switch   Ryujinx              <config>/mods/contents/<title id>/<mod>/{romfs,exefs,cheats}
             yuzu, Citron, Eden,  <data>/load/<TITLE ID>/<mod>/{romfs,exefs,cheats}
             Sudachi, suyu
    GC, Wii  Dolphin              <data>/Load/Textures/<game id>/<mod>/   (HD texture packs)

The emulators are found by their data folders, the way EmuDeck installs them;
a mod is installed for every one that is there. The game is identified by the
Switch title ID (from the file name, or the ticket inside an NSP) or the GC /
Wii game ID (from the disc header of an ISO, RVZ/WIA, CISO or WBFS).

The mods come from GameBanana (https://gamebanana.com), the community site
most emulator mods are published on: the game by name, its most downloaded
mods, and each mod's files. GameBanana lists what is inside an archive without
it being downloaded, so a mod gets an Install button only when its layout is
known (a Switch mod's romfs/exefs/cheats, a Dolphin texture pack); a disc
patch or a whole modded game is listed as not one-click. An archive with
several builds of the mod (60 FPS, 30 FPS, ...) offers them as variants.

Installing downloads the file, unpacks just that build and copies it into
each emulator's folder; installed.json remembers every path, so removing a
mod deletes exactly what was installed and nothing else. ZIP is unpacked
with Python, 7z and RAR with bsdtar (part of SteamOS).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import zipfile
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

from .httpclient import HttpClient, HttpError
from .models import match_title

GB_API = "https://gamebanana.com/apiv11"
GB_LEGACY = "https://api.gamebanana.com/Core/Item/Data"
LIST_TTL = 24 * 60 * 60
GAME_TTL = 14 * 24 * 60 * 60

# ---------------------------------------------------------------- emulators

# id -> label, consoles, folders it may live in (first that exists wins), and
# how its mod folders are laid out.
EMULATORS: Dict[str, Dict[str, Any]] = {
    "ryujinx": {
        "label": "Ryujinx", "systems": {"switch"}, "layout": "ryujinx",
        "dirs": ["~/.config/Ryujinx", "~/.var/app/org.ryujinx.Ryujinx/config/Ryujinx"],
    },
    "citron": {"label": "Citron", "systems": {"switch"}, "layout": "yuzu", "dirs": ["~/.local/share/citron"]},
    "eden": {"label": "Eden", "systems": {"switch"}, "layout": "yuzu", "dirs": ["~/.local/share/eden"]},
    "yuzu": {
        "label": "yuzu", "systems": {"switch"}, "layout": "yuzu",
        "dirs": ["~/.local/share/yuzu", "~/.var/app/org.yuzu_emu.yuzu/data/yuzu"],
    },
    "sudachi": {"label": "Sudachi", "systems": {"switch"}, "layout": "yuzu", "dirs": ["~/.local/share/sudachi"]},
    "suyu": {"label": "suyu", "systems": {"switch"}, "layout": "yuzu", "dirs": ["~/.local/share/suyu"]},
    "dolphin": {
        "label": "Dolphin", "systems": {"gc", "wii"}, "layout": "dolphin",
        "dirs": ["~/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu", "~/.local/share/dolphin-emu"],
        "config": ["~/.var/app/org.DolphinEmu.dolphin-emu/config/dolphin-emu", "~/.config/dolphin-emu"],
    },
}
MOD_SYSTEMS = {"switch", "gc", "wii"}


def detect_emulators(system: str, home: str) -> List[Dict[str, str]]:
    """The installed emulators that run this console: id, label, data folder."""
    found = []
    for emu_id, info in EMULATORS.items():
        if system not in info["systems"]:
            continue
        for folder in info["dirs"]:
            path = os.path.join(home, folder[2:]) if folder.startswith("~/") else folder
            if os.path.isdir(path):
                found.append({"id": emu_id, "label": info["label"], "dir": path})
                break
    return found


def mod_base(emulator: Dict[str, str], game_id: str) -> str:
    """The folder this emulator loads this game's mods from."""
    layout = EMULATORS[emulator["id"]]["layout"]
    if layout == "ryujinx":
        return os.path.join(emulator["dir"], "mods", "contents", game_id.lower())
    if layout == "yuzu":
        return os.path.join(emulator["dir"], "load", game_id.upper())
    return os.path.join(emulator["dir"], "Load", "Textures", game_id.upper())


def enable_dolphin_textures(home: str) -> Optional[str]:
    """Turn on "Load Custom Textures" in Dolphin's GFX.ini; the file it changed."""
    for folder in EMULATORS["dolphin"]["config"]:
        config = os.path.join(home, folder[2:])
        if not os.path.isdir(config):
            continue
        path = os.path.join(config, "GFX.ini")
        try:
            text = ""
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as fh:
                    text = fh.read()
        except OSError:
            return None
        if re.search(r"^\s*HiresTextures\s*=\s*True\s*$", text, re.M | re.I):
            return path
        lines = text.splitlines()
        out, in_settings, done = [], False, False
        for line in lines:
            if re.match(r"^\s*\[.*\]\s*$", line):
                if in_settings and not done:
                    out.append("HiresTextures = True")
                    done = True
                in_settings = line.strip().lower() == "[settings]"
            if in_settings and re.match(r"^\s*HiresTextures\s*=", line, re.I):
                line, done = "HiresTextures = True", True
            out.append(line)
        if not done:
            if not in_settings:
                out.append("[Settings]")
            out.append("HiresTextures = True")
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("\n".join(out) + "\n")
        except OSError:
            return None
        return path
    return None


# ---------------------------------------------------------------- game ids

_TITLE_ID_RE = re.compile(r"[\[(]?\b(01[0-9a-fA-F]{14})\b[\])]?")
_DISC_ID_RE = re.compile(rb"^[A-Z0-9]{4}[0-9A-Z]{2}$")


def switch_title_id(path: str, lookup: Optional[Callable[[str], Optional[str]]] = None) -> Optional[str]:
    """The base game's title ID: from the file name, an NSP's ticket name, or
    else by the game's name (``lookup``: backend/titles.py)."""
    match = _TITLE_ID_RE.search(os.path.basename(path))
    tid = match.group(1) if match else None
    if not tid and path.lower().endswith((".nsp", ".nsz")):
        tid = _nsp_ticket_title(path)
    if not tid and lookup:
        tid = lookup(os.path.splitext(os.path.basename(path))[0])
    if not tid:
        return None
    # Updates (…800) and DLC belong to the base game's folder (…000).
    return (tid[:-3] + "000").upper()


def _nsp_ticket_title(path: str) -> Optional[str]:
    """An NSP is a PFS0: its ticket is named after the rights ID, which
    starts with the title ID."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(16)
            if head[:4] != b"PFS0":
                return None
            count, table = struct.unpack("<II", head[4:12])
            if count > 4096 or table > 1 << 20:
                return None
            fh.seek(16 + count * 24)
            names = fh.read(table).split(b"\0")
    except OSError:
        return None
    for name in names:
        text = name.decode("ascii", "ignore")
        if text.lower().endswith(".tik") and re.match(r"^[0-9a-fA-F]{32}\.tik$", text):
            return text[:16]
    return None


def disc_game_id(path: str) -> Optional[str]:
    """A GameCube / Wii disc's 6-character game ID."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(0x60)
            magic = head[:4]
            if magic in (b"RVZ\x01", b"WIA\x01"):
                candidate = head[0x58:0x5E]
            elif magic == b"WBFS":
                fh.seek(0x200)
                candidate = fh.read(6)
            elif magic == b"CISO":
                fh.seek(0x8000)
                candidate = fh.read(6)
            else:
                candidate = head[:6]
    except OSError:
        return None
    return candidate.decode("ascii") if _DISC_ID_RE.match(candidate) else None


def game_id_for(system: str, path: str, lookup: Optional[Callable[[str], Optional[str]]] = None) -> Optional[str]:
    if system == "switch":
        return switch_title_id(path, lookup)
    if system in ("gc", "wii"):
        return disc_game_id(path)
    return None


# ---------------------------------------------------------------- archives

_SWITCH_DIRS = {"romfs", "exefs", "cheats"}
_TEXTURE_RE = re.compile(r"(^|/)tex1_[^/]+\.(png|dds)$", re.I)
# Files a GameCube / Wii mod puts on the disc (Riivolution, ISO patches).
_DISC_EXTS = (".arc", ".rarc", ".szs", ".u8", ".bmd", ".bdl", ".bfres", ".dol", ".rel", ".xdelta", ".bps", ".ups",
              ".iso", ".rvz", ".wbfs", ".gcm", ".nkit.iso")


def classify(system: str, paths: List[str], game_id: Optional[str]) -> Dict[str, Any]:
    """What an archive is: its installable builds (variants), or why not.

    Returns {"kind", "variants": [{"name", "root"}], "reason"}. A variant's
    root is the folder inside the archive whose contents are installed.
    """
    files = [p.replace("\\", "/").strip("/") for p in paths if p and not p.endswith("/")]
    if not files:
        return {"kind": None, "variants": [], "reason": "The archive is empty"}
    if system == "switch":
        roots: List[str] = []
        for path in files:
            parts = path.split("/")
            for i, part in enumerate(parts[:-1]):
                if part.lower() in _SWITCH_DIRS:
                    root = "/".join(parts[:i])
                    if root not in roots:
                        roots.append(root)
                    break
        # A root inside another root's romfs is part of that one, not a build.
        roots = [r for r in roots if not any(r != o and r.startswith(o + "/") for o in roots)]
        if not roots:
            return {"kind": None, "variants": [], "reason": "No romfs or exefs folder: not a mod this store can install"}
        return {"kind": "switch", "variants": [{"name": _variant_name(r), "root": r} for r in roots], "reason": None}
    if system in ("gc", "wii"):
        textures = [p for p in files if _TEXTURE_RE.search(p)]
        if not textures:
            return {"kind": None, "variants": [], "reason": "Not a texture pack: needs installing by hand"}
        # Models, levels, code: files that replace the disc's own. Those need
        # the game patched; a few textures alongside do not make it a pack.
        if any(p.lower().endswith(_DISC_EXTS) for p in files):
            return {"kind": None, "variants": [], "reason": "Replaces files on the disc: needs patching the game, not one-click"}
        roots = []
        for path in textures:
            parts = path.split("/")
            # The folder named after the game ID, if the pack has one.
            root = None
            for i, part in enumerate(parts[:-1]):
                if re.fullmatch(r"[A-Z0-9]{6}|[A-Z0-9]{3}", part):
                    root = "/".join(parts[: i + 1])
                    break
            if root is None:
                root = "/".join(parts[:1]) if len(parts) > 2 else ""
            if root not in roots:
                roots.append(root)
        if game_id:
            own = [r for r in roots if r.split("/")[-1].upper() in (game_id.upper(), game_id[:3].upper())]
            roots = own or roots
        return {"kind": "dolphin", "variants": [{"name": _variant_name(r), "root": r} for r in roots[:6]], "reason": None}
    return {"kind": None, "variants": [], "reason": "Mods for this console are not supported yet"}


def _variant_name(root: str) -> str:
    """A build's name: the innermost folder that is not an ID or a layout folder."""
    for part in reversed([p for p in root.split("/") if p]):
        if re.fullmatch(r"(?i)01[0-9a-f]{14}|[A-Z0-9]{6}|[A-Z0-9]{3}|contents|atmosphere|mods|load|textures|switch", part):
            continue
        return part.replace("_", " ").strip() or "Mod"
    return "Mod"


def _safe_member(name: str) -> Optional[str]:
    clean = name.replace("\\", "/")
    if clean.startswith("/") or ".." in clean.split("/") or re.match(r"^[A-Za-z]:", clean):
        return None
    return clean


def extract(archive: str, dest: str) -> None:
    """Unpack an archive (zip with Python; 7z, rar with bsdtar), safely."""
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                name = _safe_member(info.filename)
                if not name or info.is_dir():
                    continue
                target = os.path.join(dest, name)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with zf.open(info) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out, 1 << 20)
        return
    tool = shutil.which("bsdtar")
    if not tool:
        raise RuntimeError("This mod is a 7z/RAR archive and bsdtar is not available to unpack it")
    listing = subprocess.run([tool, "-tf", archive], capture_output=True, text=True, timeout=120)
    if listing.returncode != 0:
        raise RuntimeError(f"Could not read the archive: {listing.stderr.strip()[:200]}")
    if any(_safe_member(line) is None for line in listing.stdout.splitlines() if line.strip()):
        raise RuntimeError("The archive has paths outside its own folder; not unpacking it")
    done = subprocess.run([tool, "-xf", archive, "-C", dest], capture_output=True, text=True, timeout=1800)
    if done.returncode != 0:
        raise RuntimeError(f"Could not unpack the archive: {done.stderr.strip()[:200]}")


def _folder_name(text: str) -> str:
    name = re.sub(r"[^\w .,'()+&-]+", "", text or "").strip(" .") or "Mod"
    return name[:80]


# ---------------------------------------------------------------- the manager

def name_queries(title: str, limit: int = 6) -> List[str]:
    """Pieces of a title to search GameBanana with, the most telling first."""
    queries: List[str] = []

    def add(text: str) -> None:
        text = re.sub(r"\s+", " ", text).strip(" ,:-")
        if len(text) >= 4 and text.lower() not in (q.lower() for q in queries):
            queries.append(text)

    add(title)
    # "Legend of Zelda, The - The Wind Waker" -> "The Wind Waker", ...
    for part in sorted(re.split(r"\s+-\s+|:|,", title), key=len, reverse=True):
        if len(part.split()) >= 2:
            add(part)
    words = title.split()
    for n in (4, 3):
        if len(words) > n:
            add(" ".join(words[-n:]))
            add(" ".join(words[:n]))
    return queries[:limit]


class ModManager:
    def __init__(self, http: HttpClient, data_dir: Optional[str], home: Callable[[], str],
                 lookup: Optional[Callable[[str], Optional[str]]] = None):
        self._http = http
        # Switch title ID by name, when the file does not say (backend/titles.py).
        self._lookup = lookup
        self._dir = os.path.join(data_dir, "mods") if data_dir else tempfile.mkdtemp(prefix="rom-store-mods-")
        self._home = home
        self._lock = threading.Lock()
        self._job: Dict[str, Any] = {"state": "idle"}
        self._cancel: Optional[threading.Event] = None
        self._task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------ disk state
    def _read(self, name: str, default):
        path = os.path.join(self._dir, name)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return default

    def _write(self, name: str, data) -> None:
        path = os.path.join(self._dir, name)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            temp = path + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            os.replace(temp, path)
        except OSError:
            pass

    def installed(self) -> Dict[str, Dict[str, Any]]:
        data = self._read("installed.json", {})
        return data if isinstance(data, dict) else {}

    # ------------------------------------------------------------ GameBanana
    async def _gb(self, path: str) -> Any:
        resp = await self._http.request(f"{GB_API}/{path}", polite=False, retries=1)
        return json.loads(resp.text or "null")

    async def find_game(self, title: str) -> Optional[Dict[str, Any]]:
        """GameBanana's game for this title (same name, or the start of it)."""
        from .sgdb import clean_title

        bare = clean_title(title)
        key = match_title(bare)
        cache = self._read("games.json", {})
        hit = cache.get(key) if isinstance(cache, dict) else None
        if hit and time.time() - float(hit.get("at") or 0) < GAME_TTL:
            return hit.get("game")
        game = None
        loose = None
        # GameBanana matches a continuous piece of its names, punctuation and
        # all ("Tears of the Kingdom" finds "The Legend of Zelda: Tears of the
        # Kingdom", the file name's "The Legend of Zelda Tears of the Kingdom"
        # finds nothing): ask for a few pieces, accept only the same game.
        for query in name_queries(bare):
            data = await self._gb(f"Util/Game/NameMatch?_sName={quote(query)}&_nPerpage=20")
            for record in (data or {}).get("_aRecords") or []:
                other = match_title(record.get("_sName") or "")
                if other == key:
                    game = record
                    break
                if loose is None and len(min(other, key, key=len)) >= 10 and (other.startswith(key) or key.startswith(other)):
                    loose = record
            if game:
                break
        game = game or loose
        found = {"id": game["_idRow"], "name": game.get("_sName")} if game else None
        if isinstance(cache, dict):
            cache[key] = {"game": found, "at": time.time()}
            self._write("games.json", cache)
        return found

    async def popular(self, gb_game: int, count: int = 16) -> List[Dict[str, Any]]:
        """The game's most downloaded mods, with their files."""
        name = f"list-{gb_game}.json"
        cached = self._read(name, None)
        if isinstance(cached, dict) and time.time() - float(cached.get("at") or 0) < LIST_TTL:
            return cached.get("mods") or []
        data = await self._gb(
            f"Mod/Index?_nPage=1&_nPerpage={count}&_aFilters%5BGeneric_Game%5D={gb_game}&_sSort=Generic_MostDownloaded"
        )
        records = (data or {}).get("_aRecords") or []
        semaphore = asyncio.Semaphore(4)

        async def details(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            if record.get("_bIsObsolete") or not record.get("_bHasFiles", True):
                return None
            async with semaphore:
                try:
                    info = await self._gb(f"Mod/{record['_idRow']}?_csvProperties=_aFiles,_sText,_sVersion")
                except (HttpError, ValueError):
                    info = {}
            files = [
                {"id": f.get("_idRow"), "name": f.get("_sFile"), "size": f.get("_nFilesize"),
                 "url": f.get("_sDownloadUrl"), "note": (f.get("_sDescription") or "")[:120], "added": f.get("_tsDateAdded")}
                for f in (info or {}).get("_aFiles") or [] if f.get("_sDownloadUrl")
            ]
            image = None
            for img in ((record.get("_aPreviewMedia") or {}).get("_aImages") or [])[:1]:
                base, small = img.get("_sBaseUrl"), img.get("_sFile530") or img.get("_sFile")
                if base and small:
                    image = f"{base}/{small}"
            text = re.sub(r"<[^>]+>", " ", (info or {}).get("_sText") or "")
            return {
                "id": record["_idRow"],
                "name": record.get("_sName") or "Mod",
                "category": (record.get("_aRootCategory") or {}).get("_sName"),
                "likes": record.get("_nLikeCount") or 0,
                "version": record.get("_sVersion") or (info or {}).get("_sVersion") or None,
                "updated": record.get("_tsDateUpdated") or record.get("_tsDateModified"),
                "author": (record.get("_aSubmitter") or {}).get("_sName"),
                "image": image,
                "summary": re.sub(r"\s+", " ", text).strip()[:300],
                "url": record.get("_sProfileUrl"),
                "files": files,
            }

        mods = [m for m in await asyncio.gather(*(details(r) for r in records)) if m and m["files"]]
        self._write(name, {"at": time.time(), "mods": mods})
        return mods

    async def file_list(self, file_id: int) -> List[str]:
        """The paths inside one of a mod's archives, without downloading it."""
        cache = self._read("archives.json", {})
        key = str(file_id)
        if isinstance(cache, dict) and key in cache:
            return cache[key]
        resp = await self._http.request(
            f"{GB_LEGACY}?itemtype=File&itemid={int(file_id)}&fields=Metadata().aArchiveFilesList()", polite=False, retries=1
        )
        data = json.loads(resp.text or "null")
        paths = data[0] if isinstance(data, list) and data and isinstance(data[0], list) else []
        paths = [p for p in paths if isinstance(p, str)]
        if isinstance(cache, dict):
            cache[key] = paths
            if len(cache) > 3000:
                cache = dict(list(cache.items())[-2000:])
            self._write("archives.json", cache)
        return paths

    # ------------------------------------------------------------ a game's mods
    async def game_mods(self, game: Dict[str, Any], library_root: str) -> Dict[str, Any]:
        system = str(game.get("system") or "")
        result: Dict[str, Any] = {"game": game.get("id"), "system": system, "supported": system in MOD_SYSTEMS,
                                  "emulators": [], "game_id": None, "mods": [], "reason": None, "gamebanana": None}
        if system not in MOD_SYSTEMS:
            result["reason"] = "Mods are supported for Switch, GameCube and Wii games so far."
            return result
        emulators = detect_emulators(system, self._home())
        result["emulators"] = [{"id": e["id"], "label": e["label"]} for e in emulators]
        path = _main_file(game)
        game_id = game_id_for(system, path, self._lookup) if path else None
        result["game_id"] = game_id
        if not emulators:
            names = ", ".join(EMULATORS[e]["label"] for e in EMULATORS if system in EMULATORS[e]["systems"])
            result["reason"] = f"No emulator for this console found ({names})."
        elif not game_id:
            result["reason"] = (
                "The game's title ID is unknown (not in the file name, the NSP, the store's title list or "
                "Ryujinx's game list): add it to the file name, like \"Game [0100…000].nsp\"."
                if system == "switch" else "The game ID could not be read from this disc image."
            )
        try:
            gb_game = await self.find_game(str(game.get("name") or game.get("title") or ""))
        except (HttpError, ValueError) as exc:
            result["reason"] = result["reason"] or f"GameBanana did not answer: {exc}"
            return result
        result["gamebanana"] = gb_game
        if not gb_game:
            result["reason"] = result["reason"] or "GameBanana has no mods for this game."
            return result
        try:
            mods = await self.popular(int(gb_game["id"]))
        except (HttpError, ValueError) as exc:
            result["reason"] = result["reason"] or f"GameBanana did not answer: {exc}"
            return result
        mine = self.installed().get(str(game.get("id")), {})
        semaphore = asyncio.Semaphore(4)

        async def describe(mod: Dict[str, Any]) -> Dict[str, Any]:
            file = mod["files"][0]
            async with semaphore:
                try:
                    paths = await self.file_list(file["id"])
                except (HttpError, ValueError):
                    paths = []
            sort = classify(system, paths, game_id) if paths else {
                "kind": None, "variants": [], "reason": "GameBanana could not list this archive"}
            installed = mine.get(str(mod["id"]))
            return {
                **{k: mod[k] for k in ("id", "name", "category", "likes", "version", "updated", "author", "image", "summary", "url")},
                "file": {k: file.get(k) for k in ("id", "name", "size", "note")},
                "installable": bool(sort["kind"]) and bool(emulators) and bool(game_id),
                "variants": [v["name"] for v in sort["variants"]],
                "reason": sort["reason"],
                "installed": {"variant": installed.get("variant"), "emulators": list(installed.get("paths", {}))} if installed else None,
            }

        result["mods"] = list(await asyncio.gather(*(describe(m) for m in mods)))
        return result

    # ------------------------------------------------------------ install
    def job(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._job)

    def start_install(self, game: Dict[str, Any], mod_id: int, variant: Optional[str]) -> Dict[str, Any]:
        with self._lock:
            if self._job.get("state") in ("downloading", "installing"):
                return {"ok": False, "error": "Another mod is being installed", **self._job}
            self._job = {"state": "downloading", "mod": mod_id, "game": game.get("id"), "received": 0, "total": 0, "error": None}
        self._cancel = threading.Event()
        self._task = asyncio.get_running_loop().create_task(self._install(game, mod_id, variant))
        return {"ok": True, **self.job()}

    def cancel(self) -> None:
        if self._cancel:
            self._cancel.set()

    def _update(self, **values) -> None:
        with self._lock:
            self._job.update(values)

    async def _install(self, game: Dict[str, Any], mod_id: int, variant: Optional[str]) -> None:
        work = None
        try:
            system = str(game.get("system") or "")
            path = _main_file(game)
            game_id = game_id_for(system, path, self._lookup) if path else None
            emulators = detect_emulators(system, self._home())
            if not game_id or not emulators:
                raise RuntimeError("The game or its emulator could not be found")
            gb_game = await self.find_game(str(game.get("name") or game.get("title") or ""))
            mods = await self.popular(int(gb_game["id"])) if gb_game else []
            mod = next((m for m in mods if int(m["id"]) == int(mod_id)), None)
            if not mod:
                raise RuntimeError("That mod is no longer listed")
            file = mod["files"][0]
            sort = classify(system, await self.file_list(file["id"]), game_id)
            if not sort["kind"]:
                raise RuntimeError(sort["reason"] or "Not a mod this store can install")
            chosen = next((v for v in sort["variants"] if v["name"] == variant), None) or sort["variants"][0]
            if len(sort["variants"]) > 1 and variant is None:
                raise RuntimeError("Pick one of the versions in this mod first")

            _mkdir(self._dir)
            work = tempfile.mkdtemp(prefix="mod-", dir=self._dir)
            archive = os.path.join(work, _folder_name(file["name"]) or "mod.zip")
            await self._http.download(
                file["url"], archive,
                on_progress=lambda got, total: self._update(received=got, total=total),
                cancel=self._cancel,
            )
            self._update(state="installing")
            unpacked = os.path.join(work, "x")
            os.makedirs(unpacked, exist_ok=True)
            await asyncio.to_thread(extract, archive, unpacked)
            source = os.path.join(unpacked, chosen["root"]) if chosen["root"] else unpacked
            if not os.path.isdir(source):
                raise RuntimeError("The archive did not contain what GameBanana listed")
            name = _folder_name(mod["name"] if len(sort["variants"]) == 1 else f"{mod['name']} - {chosen['name']}")
            paths: Dict[str, str] = {}
            for emulator in emulators:
                target = os.path.join(mod_base(emulator, game_id), name)
                if os.path.exists(target):
                    shutil.rmtree(target, ignore_errors=True)
                await asyncio.to_thread(shutil.copytree, source, target)
                paths[emulator["id"]] = target
            extra = None
            if sort["kind"] == "dolphin":
                extra = enable_dolphin_textures(self._home())
            record = self.installed()
            record.setdefault(str(game.get("id")), {})[str(mod_id)] = {
                "name": mod["name"], "variant": chosen["name"], "file": file["id"], "paths": paths,
                "game_id": game_id, "at": time.time(),
            }
            self._write("installed.json", record)
            self._update(state="done", config=extra)
        except Exception as exc:  # reported to the UI
            self._update(state="error", error=str(exc) or type(exc).__name__)
        finally:
            if work:
                shutil.rmtree(work, ignore_errors=True)

    def remove(self, game: Dict[str, Any], mod_id: int) -> Dict[str, Any]:
        """Delete exactly the folders an install made, and only inside mod folders."""
        record = self.installed()
        mods = record.get(str(game.get("id")), {})
        entry = mods.get(str(mod_id))
        if not entry:
            return {"ok": False, "error": "That mod is not installed"}
        emulators = {e["id"]: e for e in detect_emulators(str(game.get("system")), self._home())}
        errors = []
        for emu_id, path in (entry.get("paths") or {}).items():
            emulator = emulators.get(emu_id)
            base = os.path.realpath(mod_base(emulator, entry.get("game_id") or "")) if emulator else None
            real = os.path.realpath(path)
            if not base or os.path.dirname(real) != base:
                errors.append(f"{emu_id}: not inside its mod folder, left alone")
                continue
            try:
                shutil.rmtree(real)
            except FileNotFoundError:
                pass
            except OSError as exc:
                errors.append(f"{emu_id}: {exc}")
        mods.pop(str(mod_id), None)
        if not mods:
            record.pop(str(game.get("id")), None)
        self._write("installed.json", record)
        return {"ok": not errors, "error": "; ".join(errors) or None}


def _mkdir(path: str) -> bool:
    try:
        os.makedirs(path, exist_ok=True)
        return True
    except OSError:
        return False


def _main_file(game: Dict[str, Any]) -> Optional[str]:
    """The game's main file: the disc image or NSP/XCI, not a .m3u list."""
    files = [f for f in game.get("files") or [] if not f.get("folder")]
    files.sort(key=lambda f: (f.get("name", "").lower().endswith((".m3u", ".cue", ".txt")), -int(f.get("size") or 0)))
    return os.path.join(str(game.get("folder")), files[0]["name"]) if files else None
