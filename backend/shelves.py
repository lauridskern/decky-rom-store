"""Favourites and recently viewed games, kept on the Deck."""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, List, Optional

from .models import match_title

MAX_RECENT = 24
MAX_FAVORITES = 200


def _item(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Only what the home screen needs to show a game and find it again."""
    title = str(data.get("title") or "").strip()
    system = str(data.get("system") or "").strip()
    if not title or not system:
        return None
    return {
        "key": f"{system}|{match_title(title)}",
        "title": title,
        "system": system,
        "cover": data.get("cover") or None,
        "at": time.time(),
    }


class Shelves:
    def __init__(self, path: Optional[str]) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._data: Dict[str, List[Dict[str, Any]]] = {"favorites": [], "recent": []}
        self._load()

    def _load(self) -> None:
        if not self._path or not os.path.isfile(self._path):
            return
        try:
            with open(self._path, "r", encoding="utf-8") as fh:
                stored = json.load(fh)
        except (OSError, ValueError):
            return
        for name in ("favorites", "recent"):
            items = stored.get(name) if isinstance(stored, dict) else None
            if isinstance(items, list):
                self._data[name] = [item for item in items if isinstance(item, dict) and item.get("key")]

    def _save(self) -> None:
        if not self._path:
            return
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            temp = self._path + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(self._data, fh)
            os.replace(temp, self._path)
        except OSError:
            pass

    def all(self) -> Dict[str, List[Dict[str, Any]]]:
        with self._lock:
            return {name: list(items) for name, items in self._data.items()}

    def toggle_favorite(self, data: Dict[str, Any]) -> Dict[str, Any]:
        item = _item(data or {})
        if not item:
            return {"favorite": False, **self.all()}
        with self._lock:
            favorites = self._data["favorites"]
            existing = next((f for f in favorites if f["key"] == item["key"]), None)
            if existing:
                favorites.remove(existing)
                favorite = False
            else:
                favorites.insert(0, item)
                del favorites[MAX_FAVORITES:]
                favorite = True
            self._save()
        return {"favorite": favorite, **self.all()}

    def add_recent(self, data: Dict[str, Any]) -> Dict[str, Any]:
        item = _item(data or {})
        if not item:
            return self.all()
        with self._lock:
            recent = [r for r in self._data["recent"] if r["key"] != item["key"]]
            recent.insert(0, item)
            self._data["recent"] = recent[:MAX_RECENT]
            self._save()
        return self.all()
