"""Title matching, merging, box art, library, BIOS and settings - no network."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import bios  # noqa: E402
from backend.boxart import BoxArt, SYSTEMS  # noqa: E402
from backend.images import best_variant  # noqa: E402
from backend.dedupe import merge_entries  # noqa: E402
from backend.library import LibraryIndex, installed_games, uninstall  # noqa: E402
from backend.models import RomEntry, match_title  # noqa: E402
from backend.settings import Settings  # noqa: E402


class Matching(unittest.TestCase):
    def test_same_game(self):
        pairs = [
            ("Pokemon Red", "Pokemon - Red Version (USA, Europe) (SGB Enhanced)"),
            ("Pokémon Emerald", "Pokemon - Emerald Version (USA, Europe)"),
            ("The Legend of Zelda: A Link to the Past", "Legend of Zelda, The - A Link to the Past (USA)"),
            ("Mega Man X", "MegaMan X (USA)"),
            ("Super Mario Bros. 3", "Super Mario Bros. 3 (USA) (Rev 1).zip"),
        ]
        for a, b in pairs:
            self.assertEqual(match_title(a), match_title(b), (a, b))

    def test_different_games(self):
        for a, b in [("Pokemon Red", "Pokemon Blue"), ("Super Mario Land", "Super Mario Land 2 - 6 Golden Coins")]:
            self.assertNotEqual(match_title(a), match_title(b))

    def test_merge(self):
        entries = [
            RomEntry(source="romspedia", source_id="1", title="Pokemon Red", system="gb"),
            RomEntry(source="retrostic", source_id="2", title="Pokemon - Red Version", system="gb"),
            RomEntry(source="romsdl", source_id="3", title="Pokémon Red Version (U)", system="gb"),
            RomEntry(source="retrostic", source_id="4", title="Pokemon Red", system="gbc"),
        ]
        merged = merge_entries(entries)
        self.assertEqual(sorted(len(rom.entries) for rom in merged), [1, 3])


class BoxArtMatching(unittest.TestCase):
    def test_prefers_region_and_plain_release(self):
        art = BoxArt(http=None)  # type: ignore[arg-type]
        art._index["gb"] = art._group([
            "Pokemon - Red Version (USA, Europe) (SGB Enhanced).png",
            "Pokemon - Red Version (Japan) (Beta).png",
            "Tetris (Japan) (En).png",
            "Tetris (World) (Rev 1).png",
        ])
        art._loaded_at["gb"] = time.time()
        self.assertTrue(art.find("Pokemon Red", "gb").endswith("Pokemon%20-%20Red%20Version%20%28USA%2C%20Europe%29%20%28SGB%20Enhanced%29.png"))
        self.assertIn("World", art.find("Tetris", "gb").replace("%20", " "))
        self.assertIsNone(art.find("Pokemon Blue", "gb"))
        entry = RomEntry(source="x", source_id="1", title="Tetris", system="gb")
        asyncio.run(art.apply([entry], resize=True, wait=0))
        self.assertTrue(entry.cover.startswith("https://wsrv.nl/"))
        self.assertTrue(entry.cover_full.startswith("https://thumbnails.libretro.com/"))
        self.assertIn("gb", SYSTEMS)

    def test_installed_games_get_covers_by_file_name(self):
        # The Library tab: titles are file names, tags and all.
        art = BoxArt(http=None)  # type: ignore[arg-type]
        art._index["gb"] = art._group(["Tetris (World) (Rev 1).png"])
        art._loaded_at["gb"] = time.time()
        games = [
            {"title": "Tetris (World) (Rev 1)", "system": "gb"},
            {"title": "Unknown Homebrew", "system": "gb"},
            {"title": "sf2", "system": "arcade"},  # no libretro art by title
        ]
        asyncio.run(art.covers(games, resize=True, wait=0))
        self.assertTrue(games[0]["cover"].startswith("https://wsrv.nl/"))
        self.assertNotIn("cover", games[1])
        self.assertNotIn("cover", games[2])
        asyncio.run(art.covers(games, resize=False, wait=0))
        self.assertTrue(games[0]["cover"].startswith("https://thumbnails.libretro.com/"))


class ImageLinks(unittest.TestCase):
    def test_igdb_screenshot_links_are_valid(self):
        # IGDB size names start with "t_"; links cached before v1.16.1 lack it.
        for url in ("https://images.igdb.com/igdb/image/upload/screenshot_huge/abc.jpg",
                    "https://images.igdb.com/igdb/image/upload/t_screenshot_huge/abc.jpg"):
            self.assertIn("/upload/t_screenshot_huge/abc.jpg", best_variant(url, "detail"))
            self.assertIn("/upload/t_screenshot_med/abc.jpg", best_variant(url, "card"))
        from backend.covers import IGDB_SCREENSHOT_BASE
        self.assertTrue(IGDB_SCREENSHOT_BASE.endswith("/upload/t_screenshot_huge/"))


class SwitchCovers(unittest.TestCase):
    def test_portrait_art_never_a_banner(self):
        from backend.service import StoreService
        tmp = tempfile.mkdtemp()
        svc = StoreService(Settings(os.path.join(tmp, "s.json")), plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "d"))
        svc.covers._client_id = ""  # no IGDB in tests
        svc._build_cover_index_in_background = lambda: None  # no network
        entries = [
            RomEntry(source="switchroms", source_id="1", title="Some Game", system="switch",
                     cover="https://nintendo-switch-roms.com/banner.jpg"),
            RomEntry(source="nswpedia", source_id="2", title="Kirby", system="switch",
                     cover="https://nswpedia.io/k-200x300.jpg", cover_full="https://nswpedia.io/k.jpg"),
            RomEntry(source="romspedia", source_id="3", title="Sonic", system="switch",
                     cover="https://static.romspedia.com/webp/roms/sonic-cover.webp"),
            RomEntry(source="romspedia", source_id="4", title="Mario", system="n64",
                     cover="https://nintendo-switch-roms.com/not-switch.jpg"),
        ]
        asyncio.run(svc._switch_covers(entries))
        banner, kirby, sonic, n64 = entries
        self.assertIsNone(banner.cover, "a wide banner is not a cover")
        self.assertEqual(banner.extra.get("banner"), "https://nintendo-switch-roms.com/banner.jpg")
        self.assertEqual(kirby.cover, "https://nswpedia.io/k.jpg", "the full cover, not the 3:4 crop")
        self.assertTrue(sonic.cover.startswith("https://static.romspedia.com/"))
        self.assertEqual(n64.cover, "https://nintendo-switch-roms.com/not-switch.jpg", "only Switch games")


class Library(unittest.TestCase):
    def test_index_sees_new_files(self):
        folder = tempfile.mkdtemp()
        open(os.path.join(folder, "Pokemon - Red Version (USA, Europe).zip"), "w").close()
        open(os.path.join(folder, "Tetris (World).gb.part"), "w").close()
        index = LibraryIndex()
        self.assertTrue(index.contains(folder, "Pokemon Red"))
        self.assertFalse(index.contains(folder, "Tetris"))
        time.sleep(1.1)
        open(os.path.join(folder, "Tetris (World).gb"), "w").close()
        self.assertTrue(index.contains(folder, "Tetris"))


class Installed(unittest.TestCase):
    def make(self, root, rel, data=b"x" * 10):
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)

    def test_lists_games_not_notes_or_saves(self):
        root = os.path.join(tempfile.mkdtemp(), "roms")
        for rel in ("gb/Tetris (World).gb", "gb/systeminfo.txt", "gb/Tetris (World).srm", "gb/media/box.png",
                    "psx/FF7 (USA) (Disc 1).chd", "psx/FF7 (USA) (Disc 2).chd", "psx/FF7 (USA).m3u"):
            self.make(root, rel)
        games = {g["title"]: g for g in installed_games(root)}
        self.assertEqual(set(games), {"Tetris (World)", "FF7 (USA)"})
        self.assertEqual(len(games["FF7 (USA)"]["files"]), 3)

    def test_uninstall_removes_the_game_only(self):
        home = tempfile.mkdtemp()
        root = os.path.join(home, "roms")
        self.make(root, "gb/Tetris (World).gb")
        self.make(root, "gb/Pokemon Red (USA).gb")
        outside = os.path.join(home, "keep.txt")
        self.make(home, "keep.txt")
        os.symlink(outside, os.path.join(root, "gb", "Link.gb"))
        games = {g["title"]: g for g in installed_games(root)}
        self.assertTrue(uninstall(root, games["Tetris (World)"]["id"])["ok"])
        self.assertTrue(uninstall(root, games["Link"]["id"])["ok"])
        self.assertEqual(os.listdir(os.path.join(root, "gb")), ["Pokemon Red (USA).gb"])
        self.assertTrue(os.path.isfile(outside), "a symlink's target is never deleted")
        self.assertFalse(uninstall(root, "unknown")["ok"])


class Bios(unittest.TestCase):
    def test_found_and_missing(self):
        home = tempfile.mkdtemp()
        roms = os.path.join(home, "EmuDecky", "roms")
        folder = os.path.join(home, "EmuDecky", "bios")
        os.makedirs(roms)
        os.makedirs(folder)
        open(os.path.join(folder, "SCPH5501.BIN"), "w").close()
        self.assertTrue(bios.check("psx", roms)["found"])
        self.assertIsNone(bios.check("saturn", roms)["found"])
        self.assertIsNone(bios.check("gb", roms))


class SettingsMigration(unittest.TestCase):
    def test_igdb_default_flips_once(self):
        path = os.path.join(tempfile.mkdtemp(), "s.json")
        with open(path, "w") as fh:
            json.dump({"igdb_replace_covers": True}, fh)
        settings = Settings(path)
        self.assertFalse(settings.get("igdb_replace_covers"))
        settings.update({"igdb_replace_covers": True})
        self.assertTrue(Settings(path).get("igdb_replace_covers"))

    def test_removed_dumbroms_is_forgotten(self):
        path = os.path.join(tempfile.mkdtemp(), "s.json")
        with open(path, "w") as fh:
            json.dump({
                "settings_revision": 2,
                "enabled_sources": ["romspedia", "dumbroms"],
                "source_priority": ["dumbroms", "romspedia"],
                "dumbroms_base_url": "https://dumbroms.com",
            }, fh)
        settings = Settings(path)
        self.assertNotIn("dumbroms", settings.get("enabled_sources"))
        self.assertNotIn("dumbroms", settings.get("source_priority"))
        self.assertIsNone(settings.get("dumbroms_base_url"))
        with open(path) as fh:
            self.assertNotIn("dumbroms", fh.read())

    def test_romsfun_added_once(self):
        path = os.path.join(tempfile.mkdtemp(), "s.json")
        with open(path, "w") as fh:
            json.dump({"settings_revision": 3, "enabled_sources": ["romspedia", "myabandonware"]}, fh)
        settings = Settings(path)
        self.assertEqual(settings.get("enabled_sources"), ["romspedia", "romsfun", "myabandonware"])
        settings.update({"enabled_sources": ["romspedia", "myabandonware"]})
        self.assertNotIn("romsfun", Settings(path).get("enabled_sources"))


if __name__ == "__main__":
    unittest.main()
