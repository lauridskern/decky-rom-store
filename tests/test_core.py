"""Title matching, merging, box art, library, BIOS and settings - no network."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
import unittest.mock

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


class LibraryCovers(unittest.TestCase):
    def test_fallbacks_for_games_without_box_art(self):
        from backend.service import StoreService
        tmp = tempfile.mkdtemp()
        svc = StoreService(Settings(os.path.join(tmp, "s.json")), plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "d"))
        games = [
            {"title": "Final Fantasy VII (USA)", "system": "psx"},   # a download had a cover
            {"title": "Chrono Trigger (USA)", "system": "snes"},     # IGDB knows it already
            {"title": "Mystery Game (Japan)", "system": "gb"},       # looked up on IGDB
            {"title": "sf2", "system": "arcades"},                   # never looked up
        ]
        svc.sgdb._key = lambda: ""  # no SteamGridDB in tests (offline)
        svc.downloads.snapshot = lambda: [{"title": "Final Fantasy VII", "system": "psx", "cover": "https://x.invalid/ff7.png"}]
        svc.covers.cached = lambda title: {"cover": "https://x.invalid/ct.jpg"} if title == "Chrono Trigger" else None
        asked = []

        async def lookup_many(titles, limit=12):
            asked.extend(titles)
            return {title: {"cover": f"https://x.invalid/{title}.jpg"} for title in titles}

        svc.covers.lookup_many = lookup_many
        cls = type(svc.covers)
        original = cls.__dict__["enabled"]
        cls.enabled = property(lambda self: True)  # as if IGDB were set up
        try:
            asyncio.run(svc._library_fallback_covers(games))
        finally:
            cls.enabled = original
        self.assertEqual(games[0]["cover"], "https://x.invalid/ff7.png")
        self.assertEqual(games[1]["cover"], "https://x.invalid/ct.jpg")
        self.assertEqual(games[2]["cover"], "https://x.invalid/Mystery Game.jpg")
        self.assertNotIn("cover", games[3])
        self.assertEqual(asked, ["Mystery Game"], "only the unknown game, by its bare title")


class Consoles(unittest.TestCase):
    def test_every_browsable_console_is_listed(self):
        from backend.service import StoreService
        tmp = tempfile.mkdtemp()
        settings = Settings(os.path.join(tmp, "s.json"))
        from backend.settings import _LEGACY_ADDRESSES
        settings.update(dict(_LEGACY_ADDRESSES))
        svc = StoreService(settings, plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "d"))

        listed = asyncio.run(svc.consoles())
        keys = [item["key"] for item in listed]
        self.assertEqual(keys[:3], ["switch", "ps2", "psx"], "the popular ones first")
        self.assertTrue(all(item["count"] is None for item in listed), "no made-up counts")
        for key in ("switch", "dreamcast", "wonderswan", "pcengine"):
            self.assertIn(key, keys)
        self.assertEqual(len(keys), len(set(keys)))
        self.assertNotIn("unknown", keys)


class ImageLinks(unittest.TestCase):
    def test_igdb_screenshot_links_are_valid(self):
        # IGDB size names start with "t_"; links cached before v1.16.1 lack it.
        for url in ("https://images.igdb.com/igdb/image/upload/screenshot_huge/abc.jpg",
                    "https://images.igdb.com/igdb/image/upload/t_screenshot_huge/abc.jpg"):
            self.assertIn("/upload/t_screenshot_huge/abc.jpg", best_variant(url, "detail"))
            self.assertIn("/upload/t_screenshot_med/abc.jpg", best_variant(url, "card"))
        from backend.covers import IGDB_SCREENSHOT_BASE
        self.assertTrue(IGDB_SCREENSHOT_BASE.endswith("/upload/t_screenshot_huge/"))


class CoverAudit(unittest.TestCase):
    """What a look through one page of every console turned up (Nov 2026)."""

    def test_libretro_link_files_are_not_scans(self):
        from backend.boxart import scan_names
        listing = (
            '<tr><td><a href="Rampage%20%28USA%2C%20Europe%29.png">x</a></td><td>16-Nov-2026 10:00</td><td>19</td></tr>'
            '<tr><td><a href="Rampage%20%28World%29.png">x</a></td><td>16-Nov-2026 10:00</td><td>212K</td></tr>'
            '<tr><td><a href="Tiny%20%28USA%29.png">x</a></td><td>16-Nov-2026 10:00</td><td>4096</td></tr>'
        )
        self.assertEqual(scan_names(listing), {"Rampage (World).png", "Tiny (USA).png"})

    def test_only_images_are_cached(self):
        from backend.images import _looks_like_image
        self.assertTrue(_looks_like_image(b"\xff\xd8\xff\xe0" + b"\0" * 20))
        self.assertTrue(_looks_like_image(b"\x89PNG\r\n\x1a\n" + b"\0" * 20))
        self.assertTrue(_looks_like_image(b"RIFF\0\0\0\0WEBPVP8 "))
        self.assertFalse(_looks_like_image(b"<!DOCTYPE html><html>"))
        self.assertFalse(_looks_like_image(b"Rampage (World).png"), "a libretro link file")
        self.assertFalse(_looks_like_image(b'{"error": "404"}'))

    def test_gametdb_other_regions_through_the_proxy(self):
        from backend.gametdb import GameTDB, cover_url
        proxied = GameTDB.alternatives(cover_url("switch", "AAACA", "US"))
        self.assertIn(cover_url("switch", "AAACA", "EN"), proxied)
        self.assertTrue(all(url.startswith("https://wsrv.nl/") for url in proxied))
        direct = GameTDB.alternatives(cover_url("switch", "AAACA", "US", proxy=False))
        self.assertIn("https://art.gametdb.com/switch/cover/EN/AAACA.jpg", direct)
        self.assertEqual(GameTDB.alternatives("https://example.invalid/a.jpg"), [])

    def test_gametdb_down_is_not_waited_for_twice(self):
        from backend.gametdb import GameTDB

        class Down:
            calls = 0

            async def request(self, url, **kwargs):
                Down.calls += 1
                raise OSError("timed out")

        tdb = GameTDB(Down(), cache_dir=tempfile.mkdtemp())
        games = [RomEntry(source="a", source_id="1", title="Metroid Dread", system="switch")]

        async def run():
            await tdb.apply(games, wait=0.5)
            started = time.time()
            await tdb.apply(games, wait=0.5)
            return time.time() - started

        self.assertLess(asyncio.run(run()), 0.2, "the failed list is remembered, not fetched and waited for again")
        self.assertEqual(Down.calls, 1)

        class Hangs:
            async def request(self, url, **kwargs):
                await asyncio.sleep(5)
                raise OSError("timed out")

        slow = GameTDB(Hangs(), cache_dir=tempfile.mkdtemp())

        async def hanging():
            await slow.apply(games, wait=0.3)  # the first search waits (LIST_WAIT at most)
            started = time.time()
            await slow.apply(games, wait=0.3)
            return time.time() - started

        import backend.gametdb as gametdb_module
        with unittest.mock.patch.object(gametdb_module, "LIST_WAIT", 0.3):
            self.assertLess(asyncio.run(hanging()), 0.1, "a fetch still running is not waited for by every search")

    def test_no_firmware_among_the_games(self):
        from backend.dedupe import is_firmware, merge_entries
        for title in ("[BIOS] Atari Jaguar CD (World)", "[BIOS] Sega CD Model 2 (USA) (v2.00)",
                      "TOS v1.04 (1989)(Atari Corp)(Mega ST)(US)[Rainbow TOS]", "Neo Geo (BIOS)"):
            self.assertTrue(is_firmware(title), title)
        for title in ("Bios Fear", "Street Fighter II Champion Edition (1993)(SPS)(Disk 1 of 4)(System)",
                      "Biosphere", "Tostal Carnage"):
            self.assertFalse(is_firmware(title), title)
        entries = [RomEntry(source="a", source_id="1", title="[BIOS] Atari Lynx (USA, Europe)", system="atarilynx"),
                   RomEntry(source="a", source_id="2", title="California Games", system="atarilynx")]
        self.assertEqual([m.title for m in merge_entries(entries)], ["California Games"])

    def test_switch_roms_titles(self):
        from backend.sources.switchroms import SwitchRomsSource
        clean = SwitchRomsSource._clean_title
        for raw, title in (
            ("Download Persona 5 Royal (Update)", "Persona 5 Royal"),
            ("Super Smash Bros Ultimate Switch (NSP/XCI) Download", "Super Smash Bros Ultimate"),
            ("Minecraft Switch (NSP/ROM) & Update", "Minecraft"),
            ("Download Super Mario Odyssey NSP Full Game [Updated]", "Super Mario Odyssey"),
            ("Pikmin 4 NSP/XCI Nintendo Switch ROMs Download", "Pikmin 4"),
            ("Download Blue Reflection Quartet XCI Full Game-Update", "Blue Reflection Quartet"),
            ("Download EXSTETRA – Latest", "EXSTETRA"),
            ("Minecraft Dungeons Nintendo", "Minecraft Dungeons"),
            ("Fire Emblem Warriors Switch NSP XCI Plus ROMs Free Download", "Fire Emblem Warriors"),
            ("Super Mario 3D World + Bowser’s Fury", "Super Mario 3D World + Bowser’s Fury"),
            ("DRAGON BALL Z KAKAROT Plus A NEW POWER AWAKENS SET", "DRAGON BALL Z KAKAROT Plus A NEW POWER AWAKENS SET"),
        ):
            self.assertEqual(clean(raw), title)


class SwitchCovers(unittest.TestCase):
    def test_gametdb_box_art_never_a_banner(self):
        from backend.service import StoreService
        tmp = tempfile.mkdtemp()
        svc = StoreService(Settings(os.path.join(tmp, "s.json")), plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "d"))
        svc.sgdb._key = lambda: ""  # no SteamGridDB in tests (offline)
        svc.covers._client_id = ""  # no IGDB in tests
        tdb = svc.gametdb
        tdb._index["switch"] = tdb.group({"AABPA": "Mario Kart 8 Deluxe", "AABPK": "Mario Kart 8 Deluxe Bundle (Game + Pass)",
                                          "ACBAA": "Animal Crossing: New Horizons", "AXN7A": "Some Japan Game"})
        tdb._loaded_at["switch"] = time.time()
        tdb._found_loaded = True
        tdb._found = {"switch/AABPA": ["US", time.time()], "switch/ACBAA": ["", time.time()], "switch/AXN7A": ["JA", time.time()]}
        entries = [
            RomEntry(source="switchroms", source_id="1", title="Mario Kart 8 Deluxe", system="switch",
                     cover="https://nintendo-switch-roms.com/banner.jpg"),
            RomEntry(source="switchroms", source_id="2", title="Animal Crossing: New Horizons", system="switch",
                     cover="https://nintendo-switch-roms.com/ac-banner.jpg"),
            RomEntry(source="romspedia", source_id="3", title="Sonic", system="switch",
                     cover="https://static.romspedia.com/webp/roms/sonic-cover.webp"),
            RomEntry(source="romspedia", source_id="4", title="Some Japan Game (Japan)", system="switch"),
            RomEntry(source="romspedia", source_id="5", title="Mario", system="n64",
                     cover="https://nintendo-switch-roms.com/not-switch.jpg"),
        ]
        asyncio.run(svc._switch_covers(entries))
        kart, crossing, sonic, japan, n64 = entries
        from backend.gametdb import cover_url
        self.assertEqual(kart.cover, cover_url("switch", "AABPA", "US"), "the plain game, not the bundle")
        self.assertEqual(kart.cover_full, cover_url("switch", "AABPA", "US", "coverM"))
        self.assertIsNone(crossing.cover, "no GameTDB cover and a wide banner: no cover")
        self.assertEqual(crossing.extra.get("banner"), "https://nintendo-switch-roms.com/ac-banner.jpg")
        self.assertTrue(sonic.cover.startswith("https://static.romspedia.com/"))
        self.assertEqual(japan.cover, cover_url("switch", "AXN7A", "JA"))
        self.assertEqual(n64.cover, "https://nintendo-switch-roms.com/not-switch.jpg", "only Switch games")

    def test_no_eshop_stand_ins_for_switch(self):
        from backend.gametdb import GameTDB
        tdb = GameTDB(http=None, cache_dir=tempfile.mkdtemp())  # type: ignore[arg-type]
        tdb._index["switch"] = GameTDB.group({"AQMXA": "Super Mario Bros. Wonder", "ZZZZA": "Some eShop Game"})
        tdb._loaded_at["switch"] = time.time()
        tdb._found_loaded = True
        tdb._found = {"switch/AQMXA": ["US", time.time()], "switch/ZZZZA": ["US", time.time()]}
        tdb._retail = {"AQMXA"}
        retail = RomEntry(source="x", source_id="1", title="Super Mario Bros. Wonder", system="switch")
        eshop = RomEntry(source="x", source_id="2", title="Some eShop Game", system="switch")
        asyncio.run(tdb.apply([retail, eshop], wait=0))
        from backend.gametdb import cover_url
        self.assertEqual(retail.cover, cover_url("switch", "AQMXA", "US"))
        self.assertIsNone(eshop.cover, "an eShop-only game's GameTDB cover is a stand-in")
        from backend.gametdb import _retail_ids
        shipped = _retail_ids()
        self.assertIn("AQMXA", shipped)
        self.assertGreater(len(shipped), 4000)

    def test_cut_off_titles_and_other_consoles(self):
        from backend.gametdb import GameTDB, cover_url
        tdb = GameTDB(http=None, cache_dir=tempfile.mkdtemp())  # type: ignore[arg-type]
        tdb._index["switch"] = GameTDB.group({"AC2GA": "Mario + Rabbids: Kingdom Battle",
                                              "BAANA": "Mario + Rabbids Kingdom Battle Gold Edition",
                                              "AABPA": "Mario Kart 8 Deluxe"})
        self.assertEqual(tdb.ids("Mario + Rabbids Kingdom Switch", "switch"), ["AC2GA"], "cut off: the shortest full title")
        self.assertEqual(tdb.ids("Mario Kart", "switch"), [], "too short to guess from")
        self.assertEqual(tdb.ids("Mario Kart 8 Deluxe", "n64"), [], "a console GameTDB does not have")
        self.assertEqual(cover_url("wii", "RMCE01", "US", proxy=False), "https://art.gametdb.com/wii/cover/US/RMCE01.png")
        self.assertEqual(cover_url("ds", "AMCE", "US", "coverM", proxy=False), "https://art.gametdb.com/ds/coverM/US/AMCE.jpg")
        self.assertEqual(cover_url("ds", "AMCE", "US"),
                         "https://wsrv.nl/?url=art.gametdb.com%2Fds%2Fcover%2FUS%2FAMCE.jpg&output=webp&q=85",
                         "through the proxy by default")

    def test_gametdb_only_fills_in_after_libretro(self):
        from backend.service import StoreService
        tmp = tempfile.mkdtemp()
        svc = StoreService(Settings(os.path.join(tmp, "s.json")), plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "d"))
        svc.boxart._index["wiiu"] = svc.boxart._group(["Mario Kart 8 (USA).png"])
        svc.boxart._loaded_at["wiiu"] = time.time()
        tdb = svc.gametdb
        tdb._index["wiiu"] = tdb.group({"AMKE01": "Mario Kart 8", "ARDE01": "Super Mario 3D World"})
        tdb._loaded_at["wiiu"] = time.time()
        tdb._found_loaded = True
        tdb._found = {"wiiu/AMKE01": ["US", time.time()], "wiiu/ARDE01": ["US", time.time()]}
        kart = RomEntry(source="x", source_id="1", title="Mario Kart 8", system="wiiu")
        world = RomEntry(source="x", source_id="2", title="Super Mario 3D World", system="wiiu")
        asyncio.run(svc._apply_boxart([kart, world]))
        self.assertIn("thumbnails.libretro.com", kart.cover_full, "libretro's scan first")
        from backend.gametdb import cover_url
        self.assertEqual(world.cover, cover_url("wiiu", "ARDE01", "US"))
        self.assertEqual(world.cover_full, cover_url("wiiu", "ARDE01", "US", "coverM"))

    def test_title_list_and_probing(self):
        from backend.gametdb import GameTDB
        from backend.httpclient import HttpError
        titles = GameTDB.parse("TITLES = https://www.gametdb.com (type: Switch)\nAAACA = Super Mario Odyssey\n"
                               "AAAC3 = Super Mario Odyssey [Starter Pack]\nnot a line\n")
        self.assertEqual(titles, {"AAACA": "Super Mario Odyssey", "AAAC3": "Super Mario Odyssey [Starter Pack]"})
        self.assertEqual(GameTDB.group(titles)[match_title("Super Mario Odyssey")], ["AAACA", "AAAC3"])

        class Http:
            asked = []

            async def request(self, url, method="GET", polite=True, retries=2, max_bytes=0):
                Http.asked.append(url)
                if "/US/" in url:
                    raise HttpError("HTTP 404", 404, url)
                if "/EN/" in url:
                    class Ok:
                        status = 200
                    return Ok()
                raise HttpError("Network error", None, url)

        tdb = GameTDB(Http(), cache_dir=tempfile.mkdtemp())
        tdb.proxy = False  # direct requests (the proxy setting off): the fake server answers those
        tdb._retail = {"AAACA", "AAAC3"}
        tdb._index["switch"] = GameTDB.group(titles)
        tdb._loaded_at["switch"] = time.time()
        entry = RomEntry(source="x", source_id="1", title="Super Mario Odyssey", system="switch")

        async def first_and_second():
            await tdb.apply([entry], wait=2)
            first = entry.cover
            await tdb.settle()
            again = RomEntry(source="x", source_id="2", title="Super Mario Odyssey", system="switch")
            await tdb.apply([again], wait=2)
            return first, again.cover

        first, second = asyncio.run(first_and_second())
        self.assertEqual(first, "https://art.gametdb.com/switch/cover/US/AAACA.jpg", "at once, the likeliest region")
        self.assertEqual(second, "https://art.gametdb.com/switch/cover/EN/AAACA.jpg", "then the region that has it")
        self.assertEqual(tdb.known("switch", "AAACA"), "EN")
        self.assertEqual(GameTDB(Http(), cache_dir=tdb._dir[: -len("/gametdb")]).known("switch", "AAACA"), "EN", "kept on disk")
        self.assertEqual(GameTDB.alternatives("https://art.gametdb.com/switch/cover/US/AAACA.jpg"), [
            "https://art.gametdb.com/switch/cover/EN/AAACA.jpg", "https://art.gametdb.com/switch/cover/JA/AAACA.jpg",
            "https://art.gametdb.com/switch/cover/other/AAACA.jpg"])
        self.assertEqual(GameTDB.alternatives("https://example.invalid/x.jpg"), [])


class SteamGridDBCovers(unittest.TestCase):
    def test_matching_caching_and_the_built_in_key(self):
        from backend.sgdb import SteamGridCovers, clean_title
        from backend.httpclient import HttpError
        from backend.settings import DEFAULT_STEAMGRIDDB_KEY

        self.assertEqual(clean_title("Download Super Mario Odyssey NSP Full Game"), "Super Mario Odyssey")
        self.assertEqual(clean_title("Tetris (World) (Rev 1)"), "Tetris")
        games = [{"id": 1, "name": "Mario Party 5"}, {"id": 2, "name": "Kirby: Super Star Ultra"}]
        self.assertEqual(SteamGridCovers.pick(games, "Kirby Super Star Ultra (USA)")["id"], 2)
        self.assertIsNone(SteamGridCovers.pick(games, "Kirby"), "never a different game")
        self.assertEqual(SteamGridCovers.pick([{"id": 3, "name": "Mario + Rabbids Kingdom Battle"}],
                                              "Mario + Rabbids Kingdom")["id"], 3, "a cut-off title")

        class Http:
            calls = []
            down = False

            async def request(self, url, headers=None, polite=True, retries=2):
                Http.calls.append(url)
                assert headers["Authorization"] == "Bearer k"
                if Http.down:
                    raise HttpError("Network error", None, url)

                class Resp:
                    def json(self_inner):
                        if "/search/" in url:
                            return {"success": True, "data": [{"id": 9, "name": "Bubble Bobble"}] if "Bubble" in url else []}
                        return {"success": True, "data": [{"url": "https://cdn.invalid/full.png", "thumb": "https://cdn.invalid/thumb.png", "mime": "image/png"}]}
                return Resp()

        cache = tempfile.mkdtemp()
        sgdb = SteamGridCovers(Http(), lambda: "k", cache_dir=cache)
        bubble = RomEntry(source="x", source_id="1", title="Bubble Bobble (USA)", system="nes")
        nothing = RomEntry(source="x", source_id="2", title="Unknown Homebrew", system="nes")
        boxed = RomEntry(source="x", source_id="3", title="Bubble Bobble", system="nes", cover="https://box.invalid/x.png")
        asyncio.run(sgdb.apply([bubble, nothing, boxed]))
        self.assertEqual((bubble.cover, bubble.cover_full), ("https://cdn.invalid/thumb.png", "https://cdn.invalid/full.png"))
        self.assertIsNone(nothing.cover)
        self.assertEqual(boxed.cover, "https://box.invalid/x.png", "a game with a cover keeps it")
        asked = len(Http.calls)
        again = SteamGridCovers(Http(), lambda: "k", cache_dir=cache)
        twice = [RomEntry(source="x", source_id="4", title="Bubble Bobble", system="nes"),
                 RomEntry(source="x", source_id="5", title="Unknown Homebrew", system="nes")]
        asyncio.run(again.apply(twice))
        self.assertEqual(len(Http.calls), asked, "found and not found are both remembered on disk")
        self.assertEqual(twice[0].cover, "https://cdn.invalid/thumb.png")

        Http.down = True
        offline = SteamGridCovers(Http(), lambda: "k", cache_dir=tempfile.mkdtemp())
        self.assertIsNone(asyncio.run(offline.lookup("Bubble Bobble")), "a network error is not an answer")
        self.assertIsNone(offline.cached("Bubble Bobble"))

        from backend.service import StoreService
        tmp = tempfile.mkdtemp()
        svc = StoreService(Settings(os.path.join(tmp, "s.json")), plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "d"))
        self.assertEqual(svc.steamgriddb_key(), DEFAULT_STEAMGRIDDB_KEY)
        svc.settings.update({"steamgriddb_api_key": " mine "})
        self.assertEqual(svc.steamgriddb_key(), "mine", "the user's own key wins")


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
    def make(self, root, rel, data=b"x" * 2048):
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)

    def test_lists_games_not_notes_or_saves(self):
        root = os.path.join(tempfile.mkdtemp(), "roms")
        for rel in ("gb/Tetris (World).gb", "gb/systeminfo.txt", "gb/Tetris (World).srm", "gb/media/box.png",
                    "psx/FF7 (USA) (Disc 1).chd", "psx/FF7 (USA) (Disc 2).chd"):
            self.make(root, rel)
        self.make(root, "psx/FF7 (USA).m3u", b"x" * 60)  # tiny, but part of the game
        games = {g["title"]: g for g in installed_games(root)}
        self.assertEqual(set(games), {"Tetris (World)", "FF7 (USA)"})
        self.assertEqual(len(games["FF7 (USA)"]["files"]), 3)

    def test_emulator_folders_are_not_games(self):
        home = tempfile.mkdtemp()
        root = os.path.join(home, "roms")
        # Vita3K: EmuDeck links the emulator's installed games into the folder.
        self.make(home, "Emulation/storage/Vita3K/ux0/app/PCSE00000/eboot.bin")
        os.makedirs(os.path.join(root, "psvita"))
        os.symlink(os.path.join(home, "Emulation/storage/Vita3K/ux0/app"), os.path.join(root, "psvita", "InstalledGames"))
        # Cemu: its storage, its (empty) games path, a broken link.
        self.make(root, "wiiu/mlc01/sys/title/data.bin")
        self.make(root, "wiiu/roms/systeminfo.txt", b"x" * 521)
        os.symlink(os.path.join(home, "gone"), os.path.join(root, "wiiu", "Broken"))
        # A stub file and a folder with only notes in it.
        self.make(root, "gb/placeholder.gb", b"x" * 100)
        self.make(root, "gb/Notes/readme.txt")
        # Real games: a file, and a game that is a folder.
        self.make(root, "gb/Tetris (World).gb")
        self.make(root, "dos/Doom/DOOM.EXE")
        games = {g["title"] for g in installed_games(root)}
        self.assertEqual(games, {"Tetris (World)", "Doom"})

    def test_a_console_never_takes_another_consoles_folder(self):
        root = os.path.join(tempfile.mkdtemp(), "roms")
        self.make(root, "snes/Super Mario World (USA).sfc")
        self.make(root, "gba/Golden Sun (USA).gba")
        games = {g["title"]: g["system"] for g in installed_games(root)}
        self.assertEqual(games, {"Super Mario World (USA)": "snes", "Golden Sun (USA)": "gba"})

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
        self.assertEqual(settings.get("enabled_sources"), ["romspedia", "romsfun", "myabandonware", "homebrewhub"])
        settings.update({"enabled_sources": ["romspedia", "myabandonware"]})
        self.assertNotIn("romsfun", Settings(path).get("enabled_sources"))

    def test_nswpedia_gone_and_homebrew_hub_added_once(self):
        path = os.path.join(tempfile.mkdtemp(), "s.json")
        with open(path, "w") as fh:
            json.dump({"settings_revision": 4, "enabled_sources": ["switchroms", "nswpedia", "romspedia"],
                       "source_priority": ["switchroms", "nswpedia", "romspedia"], "nswpedia_base_url": "https://nswpedia.io"}, fh)
        settings = Settings(path)
        self.assertEqual(settings.get("enabled_sources"), ["switchroms", "romspedia", "homebrewhub"])
        self.assertEqual(settings.get("source_priority"), ["switchroms", "romspedia", "homebrewhub"])
        self.assertIsNone(settings.get("nswpedia_base_url"))
        settings.update({"enabled_sources": ["switchroms", "romspedia"]})
        self.assertNotIn("homebrewhub", Settings(path).get("enabled_sources"), "switching it off sticks")


class SourceAddresses(unittest.TestCase):
    """New installs start without source addresses; older ones keep theirs."""

    def service(self, settings):
        from backend.service import StoreService
        return StoreService(settings, plugin_name="ROM-Store", runtime_dir=os.path.join(tempfile.mkdtemp(), "d"))

    def test_new_install_has_no_addresses_and_no_sources(self):
        settings = Settings(os.path.join(tempfile.mkdtemp(), "s.json"))
        self.assertTrue(all(not settings.get(key) for key in settings.all() if key.endswith("_base_url")))
        svc = self.service(settings)
        self.assertEqual(svc.build_sources(), [])
        described = {item["id"]: item for item in svc.describe_sources()}
        self.assertFalse(described["romspedia"]["configured"])
        self.assertEqual(described["romspedia"]["base_url"], "")

    def test_an_entered_address_turns_the_source_on(self):
        settings = Settings(os.path.join(tempfile.mkdtemp(), "s.json"))
        settings.update({"retrostic_base_url": " example.invalid/ "})
        sources = self.service(settings).build_sources()
        self.assertEqual([s.id for s in sources], ["retrostic"])
        self.assertEqual(sources[0].base, "https://example.invalid")

    def test_older_settings_file_keeps_its_addresses(self):
        path = os.path.join(tempfile.mkdtemp(), "s.json")
        with open(path, "w") as fh:
            json.dump({"settings_revision": 6, "romspedia_base_url": "https://mirror.invalid", "retrostic_base_url": ""}, fh)
        settings = Settings(path)
        self.assertEqual(settings.get("romspedia_base_url"), "https://mirror.invalid", "an edited address stays")
        self.assertEqual(settings.get("retrostic_base_url"), "https://www.retrostic.com", "empty meant the default")
        self.assertEqual(settings.get("settings_revision"), 7)
        settings.update({"retrostic_base_url": ""})
        self.assertEqual(Settings(path).get("retrostic_base_url"), "", "clearing it afterwards sticks")

    def test_older_install_without_a_settings_file_keeps_addresses(self):
        path = os.path.join(tempfile.mkdtemp(), "s.json")
        settings = Settings(path)
        settings.keep_addresses()
        self.assertEqual(Settings(path).get("switchroms_base_url"), "https://nintendo-switch-roms.com")
        cleared = Settings(path)
        cleared.update({"switchroms_base_url": ""})
        cleared.keep_addresses()  # the file exists now: nothing is filled in again
        self.assertEqual(Settings(path).get("switchroms_base_url"), "")


if __name__ == "__main__":
    unittest.main()
