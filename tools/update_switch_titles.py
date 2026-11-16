#!/usr/bin/env python3
"""Refresh the Switch lists in backend/data from blawar/titledb and GameTDB.

The mods need a Switch game's title ID (backend/mods.py), and the Library
shows the game's real name. Many files carry neither, so the plugin ships a
small list of every base game: title ID -> English name. It is cut down from
titledb's US.en.json (26 MB to download, 90 MB unpacked) to about 350 kB,
which is why it is made here and not on the Deck.

    python3 tools/update_switch_titles.py

It also writes backend/data/gametdb_switch_retail.json.gz: the GameTDB IDs
of Switch games that had a retail release. GameTDB's "cover" for an
eShop-only game is a stand-in (an orange "Nintendo eShop" card with a small
banner), so backend/gametdb.py only uses Switch covers of retail games.

Run it before a release now and then; newer games are also found through
Ryujinx's own game list on the Deck.
"""

import gzip
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

SOURCE = "https://raw.githubusercontent.com/blawar/titledb/master/US.en.json"
DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "data")
TARGET = os.path.join(DATA, "switch_titles.json.gz")
GAMETDB = "https://www.gametdb.com/switchtdb.zip"
RETAIL = os.path.join(DATA, "gametdb_switch_retail.json.gz")
# GameTDB turns away clients without a browser's name.
BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def retail_ids() -> None:
    request = urllib.request.Request(GAMETDB, headers={"User-Agent": BROWSER})
    with urllib.request.urlopen(request, timeout=300) as resp:
        archive = zipfile.ZipFile(io.BytesIO(resp.read()))
    xml = archive.read(next(n for n in archive.namelist() if n.endswith(".xml"))).decode("utf-8", "replace")
    pairs = re.findall(r"<id>([^<]+)</id>\s*<type>([^<]+)</type>", xml)
    retail = sorted({game_id for game_id, kind in pairs if kind.strip().lower() == "switch"})
    with gzip.open(RETAIL, "wt", encoding="utf-8") as fh:
        json.dump(retail, fh, separators=(",", ":"))
    print(f"{len(retail)} retail of {len(pairs)} GameTDB Switch games -> {RETAIL} ({os.path.getsize(RETAIL)} bytes)")


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
    retail_ids()
    return 0


if __name__ == "__main__":
    sys.exit(main())
