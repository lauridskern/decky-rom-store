"""Plugin settings, persisted as JSON on the Deck."""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, Optional

# SteamGridDB API key built into the plugin (the maintainer's free key), used
# when the user has not entered their own in Settings -> Steam. Like the IGDB
# credentials below: never log it, and rotate it if it is abused.
DEFAULT_STEAMGRIDDB_KEY = "226014b82073506b73fd9a462806a065"


# The addresses installs before settings revision 7 had as defaults. Those
# installs keep them (see Settings._migrate and keep_addresses); new installs
# start without any.
_LEGACY_ADDRESSES: Dict[str, str] = {
    "romspedia_base_url": "https://www.romspedia.com",
    "retrostic_base_url": "https://www.retrostic.com",
    "romsdl_base_url": "https://romsdl.com",
    "switchroms_base_url": "https://nintendo-switch-roms.com",
    "romsfun_base_url": "https://romsfun.com",
    "homebrewhub_base_url": "https://hh3.gbdev.io",
    "myabandonware_base_url": "https://www.myabandonware.com",
}


DEFAULTS: Dict[str, Any] = {
    "roms_root": "",
    "source_priority": ["switchroms", "romspedia", "retrostic", "romsdl", "romsfun", "myabandonware", "homebrewhub"],
    "enabled_sources": ["switchroms", "romspedia", "retrostic", "romsdl", "romsfun", "myabandonware", "homebrewhub"],
    "extract_archives": False,
    "keep_archive": True,
    "max_concurrent": 2,
    "results_per_source": 30,
    # Every source's address is the user's to enter (Settings -> Sources): the
    # plugin ships the parsers, not the sites. A source without one is skipped.
    "romspedia_base_url": "",
    "retrostic_base_url": "",
    "romsdl_base_url": "",
    "switchroms_base_url": "",
    "romsfun_base_url": "",
    "homebrewhub_base_url": "",
    "myabandonware_base_url": "",
    "show_nsfw": False,
    "search_cache_hours": 72,
    "chrome_top_offset": 0,
    "chrome_bottom_offset": 0,
    # IGDB crops every cover to 3:4, which loses each console's box shape, so
    # its art only fills in games that have no cover unless this is turned on.
    "igdb_replace_covers": False,
    # Bumped when a stored value has to be migrated (see Settings.load).
    "settings_revision": 7,
    # Box art from libretro-thumbnails (see backend/boxart.py), and whether the
    # grid gets small copies through the wsrv.nl resizing proxy.
    # Region whose file the game panel offers first ("" picks no favourite).
    "preferred_region": "",
    # Measure every provider's speed once a week (backend/speedtest.py), so the
    # game page can offer the fastest one first.
    "speed_test_auto": True,
    # Add installed games to the Steam library (backend/steam.py), sorted into
    # the collections their Steam ROM Manager parser names.
    "steam_shortcuts": True,
    "steam_collections": True,
    # Library art for those shortcuts (backend/artwork.py): SteamGridDB with
    # the user's own key, otherwise IGDB.
    "steam_artwork": True,
    "steamgriddb_api_key": "",
    # Where Steam ROM Manager is, if it is not in Emulation/tools/srm.
    "srm_path": "",
    "libretro_boxart": True,
    "boxart_resize": True,
    "igdb_client_id": "g5l93pm0saj4mnqpya3xujmmmcsna1",
    "igdb_client_secret": "v2qtz1potmdvx2blhcvg75ccc3ver7",
}


class Settings:
    """Small JSON backed settings store."""

    def __init__(self, path: Optional[str] = None):
        self._path = path
        self._lock = threading.Lock()
        self._values: Dict[str, Any] = dict(DEFAULTS)
        self.load()

    @property
    def path(self) -> Optional[str]:
        return self._path

    def load(self) -> None:
        if not self._path or not os.path.isfile(self._path):
            return
        try:
            with open(self._path, "r", encoding="utf-8") as fh:
                stored = json.load(fh)
            if isinstance(stored, dict):
                with self._lock:
                    self._values.update(stored)
                    migrated = self._migrate(stored)
                if migrated:
                    self.save()
        except (OSError, ValueError):
            pass

    def _migrate(self, stored: Dict[str, Any]) -> bool:
        """Bring a settings file written by an older version up to date."""
        revision = stored.get("settings_revision", 1)
        if revision >= DEFAULTS["settings_revision"]:
            return False
        if revision < 2:
            # Up to v1.15 every cover was replaced with IGDB art by default and
            # the file stored that default. Return to the new default once;
            # turning it back on afterwards sticks.
            self._values["igdb_replace_covers"] = False
        if revision < 3:
            # The DumbRoms source was removed (dumbroms.com no longer exists):
            # forget it and its address settings.
            for key in ("enabled_sources", "source_priority"):
                value = self._values.get(key)
                if isinstance(value, list):
                    self._values[key] = [s for s in value if s != "dumbroms"]
            for key in ("dumbroms_base_url", "dumbroms_search_url"):
                self._values.pop(key, None)
        if revision < 4:
            # New source: RomsFun. Existing installs saved their source lists,
            # so it is added once; switching it off afterwards sticks.
            for key in ("enabled_sources", "source_priority"):
                value = self._values.get(key)
                if isinstance(value, list) and "romsfun" not in value:
                    at = value.index("myabandonware") if "myabandonware" in value else len(value)
                    self._values[key] = value[:at] + ["romsfun"] + value[at:]
        if revision < 5:
            # Nswpedia was removed as a download source: every file link it
            # has opens datanodes.to's download page, which needs a browser.
            for key in ("enabled_sources", "source_priority"):
                value = self._values.get(key)
                if isinstance(value, list):
                    self._values[key] = [s for s in value if s != "nswpedia"]
        if revision < 6:
            # Switch box art comes from GameTDB now; Nswpedia is gone entirely.
            self._values.pop("nswpedia_base_url", None)
            # New source: Homebrew Hub, added once (switching it off sticks).
            for key in ("enabled_sources", "source_priority"):
                value = self._values.get(key)
                if isinstance(value, list) and "homebrewhub" not in value:
                    self._values[key] = value + ["homebrewhub"]
        if revision < 7:
            # Addresses are no longer filled in for new installs; an existing
            # one keeps the addresses it has been using.
            self._keep_addresses()
        self._values["settings_revision"] = DEFAULTS["settings_revision"]
        return True

    def _keep_addresses(self) -> None:
        for key, address in _LEGACY_ADDRESSES.items():
            if not self._values.get(key):
                self._values[key] = address

    def keep_addresses(self) -> None:
        """An install from before revision 7 that never wrote a settings file
        (nothing was ever changed): keep the addresses it has been using."""
        if self._path and os.path.isfile(self._path):
            return
        with self._lock:
            self._keep_addresses()
            self._values["settings_revision"] = DEFAULTS["settings_revision"]
        self.save()

    def save(self) -> None:
        if not self._path:
            return
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            with self._lock:
                payload = json.dumps(self._values, indent=2, sort_keys=True)
            with open(self._path, "w", encoding="utf-8") as fh:
                fh.write(payload)
        except OSError:
            pass

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._values.get(key, DEFAULTS.get(key, default))

    def all(self) -> Dict[str, Any]:
        with self._lock:
            values = dict(self._values)
        values.update({k: v for k, v in DEFAULTS.items() if k not in values})
        return values

    def update(self, values: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            for key, value in (values or {}).items():
                if key in DEFAULTS:
                    self._values[key] = value
        self.save()
        return self.all()

    def reset(self) -> Dict[str, Any]:
        with self._lock:
            self._values = dict(DEFAULTS)
        self.save()
        return self.all()
