"""Steam library sync: reading Steam ROM Manager's parsers and the plan."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.artwork import SteamArtwork  # noqa: E402
from backend.srm_runner import SrmRunner, find_srm  # noqa: E402
from backend.steam import SrmConfig, SteamShortcuts, clean_title, plan  # noqa: E402


class SteamPlan(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.roms = os.path.join(self.home, "Emulation", "roms")
        for rel in ("n64/Super Mario 64 (USA).z64", "n64/notes.txt", "gb/Tetris (World).gb",
                    "psx/FF7 (USA) (Disc 1).chd", "psx/FF7 (USA) (Disc 2).chd", "psx/FF7 (USA).m3u"):
            path = os.path.join(self.roms, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "w").close()
        srm = os.path.join(self.home, ".config/steam-rom-manager/userData")
        os.makedirs(srm)
        with open(os.path.join(srm, "userSettings.json"), "w") as fh:
            json.dump({"environmentVariables": {"romsDirectory": self.roms}}, fh)
        with open(os.path.join(srm, "userConfigurations.json"), "w") as fh:
            json.dump([
                {"parserType": "Glob", "configTitle": "N64 - RetroArch", "romDirectory": "${romsdirglobal}/n64",
                 "steamCategories": ["N64"], "executable": {"path": "/launchers/retroarch.sh"},
                 "executableArgs": '-L core.so "${filePath}"', "parserInputs": {"glob": "${title}@(.z64|.n64)"}},
                {"parserType": "Glob", "configTitle": "N64 - other", "romDirectory": "${romsdirglobal}/n64",
                 "executable": {"path": "/launchers/other.sh"}, "executableArgs": '"${filePath}"',
                 "parserInputs": {"glob": "${title}@(.z64)"}, "disabled": True},
                {"parserType": "Glob", "configTitle": "PS1", "romDirectory": "${romsdirglobal}/psx",
                 "steamCategories": ["PS1"], "executable": {"path": "/launchers/duckstation.sh"},
                 "executableArgs": '-batch "${filePath}"', "parserInputs": {"glob": "${title}@(.m3u|.chd|.cue)"}},
            ], fh)
        self.config = SrmConfig.load(self.home)

    def test_reads_enabled_parsers(self):
        self.assertEqual(len(self.config.parsers), 2)
        self.assertEqual(self.config.extensions(self.config.parsers[0]), [".z64", ".n64"])

    def test_plan_uses_the_parsers_command(self):
        result = plan(self.roms, {}, config=self.config)
        items = {item["system"]: item for item in result["items"]}
        self.assertEqual(items["n64"]["exe"], '"/launchers/retroarch.sh"')
        self.assertIn("Super Mario 64 (USA).z64", items["n64"]["launchOptions"])
        self.assertEqual(items["n64"]["collection"], "N64")
        self.assertEqual(items["n64"]["name"], "Super Mario 64")
        # One shortcut for a multi-disc game: its playlist.
        self.assertTrue(items["psx"]["launchOptions"].endswith('FF7 (USA).m3u"'))
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["missing"], {"gb": 1})

    def test_tracked_and_removed(self):
        mario = os.path.join(self.roms, "n64", "Super Mario 64 (USA).z64")
        gone = os.path.join(self.roms, "n64", "Gone (USA).z64")
        tracked = {mario: {"appid": 11}, gone: {"appid": 22, "name": "Gone"}}
        result = plan(self.roms, tracked, config=self.config)
        self.assertEqual(next(i for i in result["items"] if i["key"] == mario)["appid"], 11)
        self.assertEqual([r["appid"] for r in result["remove"]], [22])
        only_remove = plan(self.roms, tracked, config=self.config, add=False)
        self.assertEqual(only_remove["items"], [])
        self.assertEqual(len(only_remove["remove"]), 1)

    def test_only_some_files(self):
        mario = os.path.join(self.roms, "n64", "Super Mario 64 (USA).z64")
        result = plan(self.roms, {}, only=[mario], config=self.config)
        self.assertEqual([i["key"] for i in result["items"]], [mario])

    def test_no_srm_setup(self):
        empty = SrmConfig.load(tempfile.mkdtemp())
        self.assertIsNone(empty.folder)
        self.assertEqual(plan(self.roms, {}, config=empty)["items"], [])

    def test_shortcut_store(self):
        path = os.path.join(tempfile.mkdtemp(), "s.json")
        store = SteamShortcuts(path)
        store.report({"/a.z64": {"appid": 5, "name": "A"}}, [])
        self.assertEqual(SteamShortcuts(path).all()["/a.z64"]["appid"], 5)
        store.report({}, ["/a.z64"])
        self.assertEqual(SteamShortcuts(path).all(), {})

    def test_clean_title(self):
        self.assertEqual(clean_title("Pokemon - Red Version (USA, Europe) (SGB Enhanced)"), "Pokemon - Red Version")


class FakeCovers:
    enabled = True

    def __init__(self, info):
        self.info = info

    async def lookup(self, title):
        return self.info


class Artwork(unittest.TestCase):
    def urls(self, info):
        import asyncio
        art = SteamArtwork(http=None, covers=FakeCovers(info))  # type: ignore[arg-type]
        return asyncio.run(art.find("Some Game"))

    def test_wide_slots_only_get_wide_images(self):
        found = self.urls({
            "cover_id": "cov1",
            "artworks": [["poster", 900, 1200], ["banner", 1920, 1080]],
            "screenshots": [["shot", 1280, 720]],
        })
        self.assertEqual(found["source"], "igdb")
        urls = found["urls"]
        self.assertTrue(urls["capsule"][0].endswith("/t_cover_big_2x/cov1.jpg"))
        self.assertTrue(urls["hero"][0].endswith("/banner.jpg"), "key art first, but only if it is wide")
        self.assertTrue(urls["hero"][1].endswith("/shot.jpg"))

    def test_square_screens_give_no_hero(self):
        found = self.urls({"cover_id": "c", "artworks": [], "screenshots": [["gb", 160, 144]]})
        self.assertNotIn("hero", found["urls"])

    def test_old_cache_entries_still_work(self):
        found = self.urls({
            "cover": "https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg",
            "shots": [{"full": "https://images.igdb.com/igdb/image/upload/screenshot_huge/sh1.jpg"}],
        })
        self.assertTrue(found["urls"]["capsule"][0].endswith("/abc123.jpg"))
        self.assertTrue(found["urls"]["hero"][0].endswith("/sh1.jpg"))


class RunSrm(unittest.TestCase):
    def fake(self, folder, body):
        path = os.path.join(folder, "srm.sh")
        with open(path, "w") as fh:
            fh.write("#!/bin/sh\n" + body + "\n")
        os.chmod(path, 0o755)
        return path

    def wait(self, runner, srm, seconds=15):
        import time
        for _ in range(int(seconds / 0.2)):
            last = runner.status("/none/roms", srm)["last"]
            if last:
                return last
            time.sleep(0.2)
        return None

    def test_finds_srm_next_to_the_library(self):
        emulation = os.path.join(tempfile.mkdtemp(), "Emulation")
        os.makedirs(os.path.join(emulation, "tools", "srm"))
        app = os.path.join(emulation, "tools", "srm", "Steam-ROM-Manager.AppImage")
        with open(app, "w") as fh:
            fh.write("#!/bin/sh\n")
        os.chmod(app, 0o755)
        self.assertEqual(find_srm(os.path.join(emulation, "roms")), [app, "add"])

    def test_runs_add_and_records_the_result(self):
        folder = tempfile.mkdtemp()
        srm = self.fake(folder, 'echo "added $*"')
        runner = SrmRunner(os.path.join(folder, "rt"))
        self.assertTrue(runner.start("/none/roms", srm)["ok"])
        last = self.wait(runner, srm)
        self.assertTrue(last and last["ok"])
        self.assertIn("added add", "\n".join(runner.status("/none/roms", srm)["log"]))

    def test_retries_without_sandbox(self):
        folder = tempfile.mkdtemp()
        srm = self.fake(folder, 'if [ "$1" = "--no-sandbox" ]; then exit 0; fi\necho "SUID sandbox helper"; exit 133')
        runner = SrmRunner(os.path.join(folder, "rt"))
        runner.start("/none/roms", srm)
        self.assertTrue(self.wait(runner, srm)["ok"])

    def test_waits_for_steam_to_close(self):
        import shutil
        import subprocess
        import time
        folder = tempfile.mkdtemp()
        fake_steam = os.path.join(folder, "steam")
        shutil.copy("/bin/sleep", fake_steam)
        steam = subprocess.Popen([fake_steam, "3"])
        srm = self.fake(folder, "exit 0")
        runner = SrmRunner(os.path.join(folder, "rt"))
        runner.start("/none/roms", srm)
        time.sleep(1.5)
        self.assertIsNone(runner.status("/none/roms", srm)["last"], "never runs while Steam is open")
        steam.wait()
        self.assertTrue(self.wait(runner, srm)["ok"])

    def test_not_installed(self):
        # Never look on the real machine: a developer's Deck has SRM, and a
        # test must not run it against their Steam library.
        from unittest import mock
        with mock.patch("backend.srm_runner.find_srm", return_value=None):
            result = SrmRunner(tempfile.mkdtemp()).start("/none/roms", "")
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
