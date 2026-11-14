"""Plugin settings, persisted as JSON on the Deck."""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, Optional

DEFAULTS: Dict[str, Any] = {
    "roms_root": "",
    "source_priority": ["romspedia", "retrostic", "romsdl", "dumbroms", "myabandonware"],
    "enabled_sources": ["romspedia", "retrostic", "romsdl", "dumbroms", "myabandonware"],
    "extract_archives": False,
    "keep_archive": True,
    "max_concurrent": 2,
    "results_per_source": 30,
    "dumbroms_base_url": "https://dumbroms.com",
    "dumbroms_search_url": "{base}/search?q={query}",
    "romspedia_base_url": "https://www.romspedia.com",
    "retrostic_base_url": "https://www.retrostic.com",
    "romsdl_base_url": "https://romsdl.com",
    "myabandonware_base_url": "https://www.myabandonware.com",
    "show_nsfw": False,
    "chrome_top_offset": 0,
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
        except (OSError, ValueError):
            pass

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
