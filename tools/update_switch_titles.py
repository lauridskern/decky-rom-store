#!/usr/bin/env python3
"""Refresh backend/data/switch_titles.json.gz from blawar/titledb.

The mods need a Switch game's title ID (backend/mods.py), and the Library
shows the game's real name. Many files carry neither, so the plugin ships a
small list of every base game: title ID -> English name. It is cut down from
titledb's US.en.json (26 MB to download, 90 MB unpacked) to about 350 kB,
which is why it is made here and not on the Deck.

    python3 tools/update_switch_titles.py

Run it before a release now and then; newer games are also found through
Ryujinx's own game list on the Deck.
"""

import gzip
import json
import os
import re
import sys
import urllib.request

SOURCE = "https://raw.githubusercontent.com/blawar/titledb/master/US.en.json"
TARGET = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "data", "switch_titles.json.gz")


def main() -> int:
    request = urllib.request.Request(SOURCE, headers={"Accept-Encoding": "gzip", "User-Agent": "rom-store-titles"})
    with urllib.request.urlopen(request, timeout=300) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    data = json.loads(raw)
    titles = {}
    for item in data.values():
        tid, name = (item.get("id") or "").upper(), item.get("name") or ""
        # Base games only (updates end in 800, DLC differ); no demos.
        if not re.fullmatch(r"01[0-9A-F]{11}000", tid) or not name or item.get("isDemo"):
            continue
        titles.setdefault(tid, re.sub(r"\s*[™®©]\s*", lambda m: " " if m.group(0).strip() != m.group(0) else "", name).strip())
    os.makedirs(os.path.dirname(TARGET), exist_ok=True)
    with gzip.open(TARGET, "wt", encoding="utf-8") as fh:
        json.dump(dict(sorted(titles.items())), fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(titles)} games -> {TARGET} ({os.path.getsize(TARGET)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
