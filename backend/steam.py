"""Put installed games into the Steam library, the way Steam ROM Manager does.

Steam ROM Manager (SRM) cannot run while Steam is running: it writes Steam's
shortcuts.vdf, which Steam only reads at start and overwrites when it exits.
The plugin lives inside Steam, so it does SRM's job live instead: the frontend
adds and removes shortcuts through Steam's own client API (SteamClient.Apps),
and this module works out what those shortcuts should be.

The launch commands come from SRM's own parser configuration, the one EmuDeck
sets up (userConfigurations.json): per console it names the ROM folder, the
file types, the emulator and its arguments. A shortcut made here starts the
game exactly like the one SRM would make.

The plan is the whole job: every installed file that an enabled SRM parser
covers, with its shortcut, plus the shortcuts made earlier whose files are
gone. The frontend carries it out and reports the Steam app ids back, which
are kept in steam_shortcuts.json, so uninstalling a game removes its shortcut.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from .library import installed_games

# Where SRM keeps its settings: the AppImage EmuDeck installs, the Flatpak,
# and EmuDeck's own copy.
SRM_DIRS = (
    ".config/steam-rom-manager/userData",
    ".var/app/com.steamgriddb.steam-rom-manager/config/steam-rom-manager/userData",
    "Emulation/tools/srm/userData",
    "EmuDecky/tools/srm/userData",
)

_VAR_RE = re.compile(r"\$\{([^}]+)\}")
_GLOB_EXT_RE = re.compile(r"@\(([^)]*)\)")
_TAGS_RE = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")


def _home() -> str:
    try:
        import decky  # type: ignore

        home = getattr(decky, "DECKY_USER_HOME", None)
        if home:
            return str(home)
    except ImportError:
        pass
    return os.path.expanduser("~")


def clean_title(name: str) -> str:
    """'Pokemon - Red Version (USA, Europe) (SGB Enhanced)' -> 'Pokemon - Red Version'."""
    title = _TAGS_RE.sub("", name).strip(" -_.")
    return re.sub(r"\s{2,}", " ", title) or name


def _real(path: str) -> str:
    return os.path.realpath(os.path.expanduser(path)) if path else ""


class SrmConfig:
    """The enabled glob parsers of a Steam ROM Manager setup."""

    def __init__(self, folder: Optional[str], parsers: List[Dict[str, Any]], variables: Dict[str, str],
                 categories: Optional[List[str]] = None):
        self.folder = folder
        self.parsers = parsers
        self.variables = variables
        # Every fixed Steam collection any parser names, switched off ones
        # included: the collections a game may be moved out of (an emulator
        # change moves a Switch game from "… - Eden" to "… - Ryujinx"). A
        # collection the user made is never one of them.
        self.categories = categories or []

    @classmethod
    def load(cls, home: Optional[str] = None) -> "SrmConfig":
        home = home or _home()
        for rel in SRM_DIRS:
            folder = os.path.join(home, rel)
            path = os.path.join(folder, "userConfigurations.json")
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    configs = json.load(fh)
            except (OSError, ValueError):
                continue
            variables = cls._globals(folder)
            configs = configs if isinstance(configs, list) else []
            parsers = [
                p for p in configs if isinstance(p, dict)
                and not p.get("disabled")
                and str(p.get("parserType", "")).lower().startswith("glob")
            ]
            categories = sorted({
                c for p in configs if isinstance(p, dict)
                for c in (p.get("steamCategories") or []) if isinstance(c, str) and c and "${" not in c
            })
            return cls(folder, parsers, variables, categories)
        return cls(None, [], {})

    @staticmethod
    def _globals(folder: str) -> Dict[str, str]:
        """SRM's ${...global} variables, from its userSettings.json."""
        try:
            with open(os.path.join(folder, "userSettings.json"), "r", encoding="utf-8") as fh:
                settings = json.load(fh)
        except (OSError, ValueError):
            return {}
        env = settings.get("environmentVariables") or {}
        mapping = {
            "steamdirglobal": env.get("steamDirectory"),
            "romsdirglobal": env.get("romsDirectory"),
            "retroarchpath": env.get("retroarchPath"),
            "racores": env.get("raCoresDirectory"),
            "localimagesdirglobal": env.get("localImagesDirectory"),
        }
        return {key: str(value) for key, value in mapping.items() if value}

    # ------------------------------------------------------------------ parsers
    def expand(self, text: str, values: Dict[str, str]) -> Optional[str]:
        """Fill in ${...} variables; None if one is not known."""
        missing = False

        def repl(match: re.Match) -> str:
            nonlocal missing
            name = match.group(1)
            if name in values:
                return values[name]
            if name in self.variables:
                return self.variables[name]
            missing = True
            return match.group(0)

        result = _VAR_RE.sub(repl, text or "")
        return None if missing else result

    @staticmethod
    def extensions(parser: Dict[str, Any]) -> List[str]:
        """File types from a glob like '${title}@(.n64|.N64|.zip)'."""
        glob = ((parser.get("parserInputs") or {}).get("glob") or (parser.get("parserInputs") or {}).get("glob-regex") or "")
        found: List[str] = []
        for group in _GLOB_EXT_RE.findall(glob):
            for ext in group.split("|"):
                ext = ext.strip().lower()
                if not ext:
                    continue
                found.append(ext if ext.startswith(".") else "." + ext)
        return found

    def rom_dir(self, parser: Dict[str, Any]) -> str:
        return _real(self.expand(parser.get("romDirectory") or "", {}) or "")

    def parser_for(self, folder: str, filename: str) -> Optional[Dict[str, Any]]:
        """The first enabled parser that would pick this file up."""
        real = _real(folder)
        ext = os.path.splitext(filename)[1].lower()
        for parser in self.parsers:
            if self.rom_dir(parser) != real:
                continue
            exts = self.extensions(parser)
            if exts and ext not in exts:
                continue
            return parser
        return None

    def shortcut(self, parser: Dict[str, Any], path: str, title: str) -> Optional[Dict[str, Any]]:
        """Executable, launch options, start folder and collection for a file."""
        exe_path = self.expand(((parser.get("executable") or {}).get("path") or ""), {})
        if not exe_path:
            return None
        name = os.path.basename(path)
        values = {
            "filePath": path,
            "fileName": name,
            "title": os.path.splitext(name)[0],
            "fuzzyTitle": title,
            "finalTitle": title,
            "dir": os.path.dirname(path),
            "fileDir": os.path.dirname(path),
            "romDir": os.path.dirname(path),
            "exePath": exe_path,
            "exeDir": os.path.dirname(exe_path),
            "exeName": os.path.basename(exe_path),
            "/": "/",
        }
        args = self.expand(parser.get("executableArgs") or "", values)
        if args is None:
            return None
        start = self.expand(parser.get("startInDirectory") or "", values) or os.path.dirname(exe_path)
        categories = [c for c in (parser.get("steamCategories") or []) if c and "${" not in c]
        return {
            "exe": f'"{exe_path}"',
            "launchOptions": args.strip(),
            "startDir": f'"{start}"',
            "collection": categories[0] if categories else None,
            "parser": parser.get("configTitle") or "",
        }


class SteamShortcuts:
    """Shortcuts this plugin made: file path -> Steam app id."""

    def __init__(self, path: Optional[str]):
        self._path = path
        self._lock = threading.Lock()
        self._items: Dict[str, Dict[str, Any]] = {}
        if path and os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    self._items = {k: v for k, v in data.items() if isinstance(v, dict) and v.get("appid")}
            except (OSError, ValueError):
                pass

    def _save(self) -> None:
        if not self._path:
            return
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            temp = self._path + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(self._items, fh)
            os.replace(temp, self._path)
        except OSError:
            pass

    def all(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return dict(self._items)

    def report(self, added: Dict[str, Any], removed: List[str]) -> None:
        with self._lock:
            for key, info in (added or {}).items():
                appid = info.get("appid") if isinstance(info, dict) else info
                if appid:
                    self._items[key] = {
                        "appid": int(appid),
                        "name": (info.get("name") if isinstance(info, dict) else None) or "",
                        "at": time.time(),
                    }
            for key in removed or []:
                self._items.pop(key, None)
            self._save()


def gone(roms_root: str, paths: List[str]) -> List[str]:
    """Paths a shortcut launches that are no longer on disk.

    Only files inside a console folder of the library count (a shortcut that
    names something outside the library is never judged), so "Re-add all
    games" can drop shortcuts of deleted games and nothing else.
    """
    if not roms_root:
        return []
    roots = {os.path.realpath(roms_root), os.path.abspath(roms_root)}
    out = []
    for path in paths or []:
        if not isinstance(path, str) or not path.startswith("/"):
            continue
        absolute = os.path.abspath(path)
        inside = any(
            absolute.startswith(root.rstrip("/") + "/") and os.sep in absolute[len(root.rstrip("/")) + 1:]
            for root in roots
        )
        if inside and not os.path.exists(absolute):
            out.append(path)
    return out


def plan(roms_root: str, tracked: Dict[str, Dict[str, Any]], only: Optional[List[str]] = None,
         config: Optional[SrmConfig] = None, add: bool = True) -> Dict[str, Any]:
    """What the Steam library should get, given the games on disk.

    items:   one per installed file an SRM parser covers, with its shortcut and
             the app id if one was made before (the frontend checks it still
             exists and adds it again if not)
    remove:  shortcuts made earlier whose file is gone (uninstalled)
    missing: consoles with games but no enabled SRM parser
    """
    config = config or SrmConfig.load()
    games = installed_games(roms_root)
    items: List[Dict[str, Any]] = []
    missing: Dict[str, int] = {}
    on_disk = set()
    wanted = {os.path.realpath(p) for p in only} if only else None
    for game in games:
        paths = [os.path.join(game["folder"], f["name"]) for f in game["files"]]
        on_disk.update(paths)
        if not add or (wanted is not None and not any(os.path.realpath(p) in wanted for p in paths)):
            continue
        added = False
        # Shortest name first: for a multi-disc game that is the .m3u playlist,
        # the one to launch; one shortcut per game.
        for file, path in zip(game["files"], paths):
            if file.get("folder"):
                continue
            parser = config.parser_for(game["folder"], file["name"])
            if not parser:
                continue
            title = clean_title(game["title"])
            shortcut = config.shortcut(parser, path, title)
            if not shortcut:
                continue
            items.append({
                "key": path,
                # A shortcut may name the file through a symlinked folder (an
                # SD card library linked into ~/Emulation); both count.
                "real": os.path.realpath(path),
                "name": title,
                "system": game["system"],
                **shortcut,
                "appid": (tracked.get(path) or {}).get("appid"),
            })
            added = True
            break
        if not added:
            missing[game["system"]] = missing.get(game["system"], 0) + 1
    remove = [
        {"key": key, "appid": info["appid"], "name": info.get("name") or ""}
        for key, info in tracked.items()
        if key not in on_disk and not os.path.exists(key)
    ]
    roots = [roms_root, os.path.realpath(roms_root)] if roms_root else []
    return {
        "srm": config.folder,
        "parsers": len(config.parsers),
        "roots": list(dict.fromkeys(roots)),
        "managed_collections": config.categories,
        "items": items,
        "remove": remove,
        "missing": missing,
    }
