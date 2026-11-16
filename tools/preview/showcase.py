"""Builds showcase.json: the catalogue the README screenshots are taken with.

    python3 tools/preview/showcase.py          # from the repository root

Real games on their real consoles, with the art the store itself would show
(libretro-thumbnails scans, GameTDB for Switch, both through wsrv.nl) and
IGDB's ratings and media. Only links are stored; nothing is downloaded into
the repository. `npm run readme` (in tools/preview) then takes the screenshots.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from backend.boxart import thumb_url  # noqa: E402
from backend.gametdb import cover_url  # noqa: E402
from backend.models import RomEntry  # noqa: E402
from backend.service import StoreService  # noqa: E402
from backend.settings import Settings  # noqa: E402

QUERY = "zelda"
# (title, console[, GameTDB id for Switch]). The first 16 are the search result.
GAMES = [
    ("The Legend of Zelda: Ocarina of Time", "n64"),
    ("The Legend of Zelda: A Link to the Past", "snes"),
    ("The Legend of Zelda: Breath of the Wild", "switch", "AAAAA"),
    ("The Legend of Zelda: The Wind Waker", "gc"),
    ("The Legend of Zelda: The Minish Cap", "gba"),
    ("The Legend of Zelda", "nes"),
    ("The Legend of Zelda: Majora's Mask", "n64"),
    ("The Legend of Zelda: Tears of the Kingdom", "switch", "AXN7A"),
    ("The Legend of Zelda: Link's Awakening DX", "gbc"),
    ("The Legend of Zelda: Twilight Princess", "gc"),
    ("The Legend of Zelda: Skyward Sword", "wii"),
    ("The Legend of Zelda: A Link Between Worlds", "3ds"),
    ("The Legend of Zelda: Phantom Hourglass", "nds"),
    ("Zelda II: The Adventure of Link", "nes"),
    ("The Legend of Zelda: Link's Awakening", "switch", "AR3NA"),
    ("The Legend of Zelda: Oracle of Seasons", "gbc"),
    # Shelves, Library and Downloads.
    ("Metroid Dread", "switch", "AYL8A"),
    ("Super Metroid", "snes"),
    ("Castlevania: Symphony of the Night", "psx"),
    ("Chrono Trigger", "snes"),
    ("Pokemon Emerald Version", "gba"),
    ("Super Mario 64", "n64"),
    ("Super Mario Odyssey", "switch", "AAACA"),
    ("Final Fantasy VII", "psx"),
    ("God of War: Chains of Olympus", "psp"),
    ("Tetris", "gb"),
    ("Sonic the Hedgehog 2", "genesis"),
    ("Kirby and the Forgotten Land", "switch", "ARZGA"),
    ("Hollow Knight", "switch", "AKLHA"),
    ("Mario Kart Wii", "wii"),
    ("Metroid Prime", "gc"),
]
RECENT = ["Metroid Dread", "Super Metroid", "Castlevania: Symphony of the Night", "Hollow Knight", "Metroid Prime"]
FAVORITES = ["Chrono Trigger", "Super Mario Odyssey", "Pokemon Emerald Version", "Sonic the Hedgehog 2",
             "Kirby and the Forgotten Land", "Mario Kart Wii"]
# The game whose page is photographed: its IGDB media is kept.
PAGE = "The Legend of Zelda: Tears of the Kingdom"
# IGDB's first release is sometimes a remake or a port.
YEARS = {"The Legend of Zelda: Ocarina of Time": 1998, "The Legend of Zelda: A Link to the Past": 1991,
         "The Legend of Zelda: Link's Awakening": 2019, "Chrono Trigger": 1995, "Super Mario 64": 1996,
         "God of War: Chains of Olympus": 2008, "Tetris": 1989, "Pokemon Emerald Version": 2004}
SIZES = {"nes": 131_000, "snes": 1_050_000, "gb": 33_000, "gbc": 1_020_000, "gba": 8_400_000, "n64": 16_800_000,
         "gc": 1_420_000_000, "wii": 4_380_000_000, "nds": 64_000_000, "3ds": 1_300_000_000,
         "switch": 14_400_000_000, "psx": 690_000_000, "psp": 1_100_000_000, "genesis": 1_050_000}


async def main() -> None:
    tmp = tempfile.mkdtemp()
    svc = StoreService(Settings(os.path.join(tmp, "s.json")), plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "d"))
    entries = [RomEntry(source="x", source_id=str(i), title=g[0], system=g[1]) for i, g in enumerate(GAMES)]
    await svc.boxart.apply(entries, resize=True, wait=60)
    out = []
    for game in GAMES:
        title, system = game[0], game[1]
        if len(game) > 2:
            cover, full = cover_url("switch", game[2], "US"), cover_url("switch", game[2], "US", "coverM")
        else:
            full = svc.boxart.find(title, system)
            cover = thumb_url(full) if full else None
        meta = await svc.covers.lookup(title) or {}
        year = YEARS.get(title)
        if not year and meta.get("released"):
            year = datetime.datetime.fromtimestamp(meta["released"], datetime.timezone.utc).year
        item = {"title": title, "system": system, "cover": cover, "cover_full": full, "year": year,
                "rating": round(meta["rating"], 1) if meta.get("rating") else None, "size": SIZES.get(system)}
        if title == PAGE:
            item["media"] = {key: meta.get(key) for key in ("summary", "genres", "developers", "trailer")}
            item["media"]["shots"] = (meta.get("shots") or [])[:5]
        out.append(item)
        print(f"{system:8} {'art' if cover else '---'} {title}")
    data = {
        "_about": "Showcase catalogue for the README screenshots (npm run readme), made by showcase.py.",
        "query": QUERY,
        "search": out[:16],
        "recent": RECENT,
        "favorites": FAVORITES,
        "games": {item["title"]: {k: v for k, v in item.items() if k != "title"} for item in out[16:]},
    }
    with open(os.path.join(ROOT, "tools/preview/showcase.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    asyncio.run(main())
