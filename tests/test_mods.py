"""Mods (backend/mods.py): game IDs, archive layouts, install and remove. Offline."""

from __future__ import annotations

import asyncio
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import mods  # noqa: E402
from backend.mods import (  # noqa: E402
    ModManager, classify, detect_emulators, disc_game_id, enable_dolphin_textures, mod_base, name_queries,
    switch_title_id,
)


def write(path: str, data: bytes) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    return path


def pfs0(names):
    """A minimal NSP (PFS0) holding empty files with these names."""
    table = b"".join(n.encode() + b"\0" for n in names)
    entries = b"".join(struct.pack("<QQII", 0, 0, sum(len(x) + 1 for x in names[:i]), 0) for i in range(len(names)))
    return b"PFS0" + struct.pack("<II", len(names), len(table)) + b"\0" * 4 + entries + table


class GameIds(unittest.TestCase):
    def test_switch_title_ids(self):
        tmp = tempfile.mkdtemp()
        self.assertEqual(switch_title_id(write(os.path.join(tmp, "Zelda [0100F2C0115B6000][v0].nsp"), b"x")), "0100F2C0115B6000")
        self.assertEqual(switch_title_id(write(os.path.join(tmp, "Zelda Update [0100f2c0115b6800].nsp"), b"x")),
                         "0100F2C0115B6000", "an update's ID is the base game's folder")
        ticket = "0100f2c0115b60000000000000000004.tik"
        nsp = write(os.path.join(tmp, "Zelda.nsp"), pfs0(["abc.nca", ticket, "0100f2c0115b60000000000000000004.cert"]))
        self.assertEqual(switch_title_id(nsp), "0100F2C0115B6000", "from the ticket inside the NSP")
        self.assertIsNone(switch_title_id(write(os.path.join(tmp, "Zelda.xci"), b"HEAD" * 10)))

    def test_disc_ids(self):
        tmp = tempfile.mkdtemp()
        self.assertEqual(disc_game_id(write(os.path.join(tmp, "a.iso"), b"GZLE01" + b"\0" * 64)), "GZLE01")
        rvz = b"RVZ\x01" + b"\0" * (0x58 - 4) + b"RMCP01" + b"\0" * 16
        self.assertEqual(disc_game_id(write(os.path.join(tmp, "b.rvz"), rvz)), "RMCP01")
        wbfs = b"WBFS" + b"\0" * (0x200 - 4) + b"SB4E01"
        self.assertEqual(disc_game_id(write(os.path.join(tmp, "c.wbfs"), wbfs)), "SB4E01")
        self.assertIsNone(disc_game_id(write(os.path.join(tmp, "d.iso"), b"\0" * 64)))


class Layouts(unittest.TestCase):
    def test_switch(self):
        self.assertEqual(classify("switch", ["UltraCam/exefs/main.npdm", "UltraCam/romfs/a.ini"], None)["variants"],
                         [{"name": "UltraCam", "root": "UltraCam"}])
        builds = classify("switch", ["60fps/romfs/x", "30fps/romfs/x", "readme.txt"], None)["variants"]
        self.assertEqual([b["name"] for b in builds], ["60fps", "30fps"])
        self.assertEqual(classify("switch", ["romfs/a.bin"], None)["variants"], [{"name": "Mod", "root": ""}])
        self.assertIsNone(classify("switch", ["Mod/data.bin"], None)["kind"])

    def test_dolphin(self):
        pack = classify("gc", ["Pack/GZLE01/tex1_16x16_a_14.png", "Pack/GZLE01/b/tex1_8x8_b_3.dds"], "GZLE01")
        self.assertEqual(pack["variants"], [{"name": "Pack", "root": "Pack/GZLE01"}])
        self.assertIsNone(classify("gc", ["Pack/GZLE01/tex1_a.png", "Link.arc"], "GZLE01")["kind"], "a model swap")
        self.assertIsNone(classify("gc", ["patch.xdelta"], "GZLE01")["kind"])
        self.assertIsNone(classify("psx", ["romfs/x"], None)["kind"])

    def test_name_queries(self):
        self.assertIn("The Wind Waker", name_queries("Legend of Zelda, The - The Wind Waker"))
        self.assertIn("Tears of the Kingdom", name_queries("The Legend of Zelda Tears of the Kingdom"))


class Emulators(unittest.TestCase):
    def test_found_and_laid_out(self):
        home = tempfile.mkdtemp()
        os.makedirs(os.path.join(home, ".config/Ryujinx"))
        os.makedirs(os.path.join(home, ".local/share/citron"))
        found = detect_emulators("switch", home)
        self.assertEqual([e["id"] for e in found], ["ryujinx", "citron"])
        self.assertTrue(mod_base(found[0], "0100F2C0115B6000").endswith("Ryujinx/mods/contents/0100f2c0115b6000"))
        self.assertTrue(mod_base(found[1], "0100f2c0115b6000").endswith("citron/load/0100F2C0115B6000"))
        self.assertEqual(detect_emulators("gc", home), [])

    def test_dolphin_textures_switched_on_once(self):
        home = tempfile.mkdtemp()
        config = os.path.join(home, ".var/app/org.DolphinEmu.dolphin-emu/config/dolphin-emu")
        os.makedirs(config)
        write(os.path.join(config, "GFX.ini"), b"[Settings]\nAspectRatio = 1\nHiresTextures = False\n[Hacks]\nEFBToTextureEnable = True\n")
        enable_dolphin_textures(home)
        enable_dolphin_textures(home)
        text = open(os.path.join(config, "GFX.ini")).read()
        self.assertEqual(text.count("HiresTextures"), 1)
        self.assertIn("HiresTextures = True", text)
        self.assertIn("AspectRatio = 1", text)
        self.assertIn("EFBToTextureEnable = True", text)


class InstallRemove(unittest.TestCase):
    def test_install_two_emulators_and_remove_exactly_that(self):
        home = tempfile.mkdtemp()
        for folder in (".config/Ryujinx", ".local/share/citron"):
            os.makedirs(os.path.join(home, folder))
        roms = os.path.join(home, "roms", "switch")
        write(os.path.join(roms, "Zelda [0100F2C0115B6000].nsp"), b"x" * 4096)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr("60fps/exefs/main.npdm", b"npdm")
            zf.writestr("60fps/romfs/a.bin", b"a")
            zf.writestr("30fps/romfs/a.bin", b"b")
            zf.writestr("../evil.txt", b"no")
        data = archive.getvalue()

        class Http:
            async def download(self, url, dest, on_progress=None, cancel=None, resume=False):
                with open(dest, "wb") as fh:
                    fh.write(data)
                if on_progress:
                    on_progress(len(data), len(data))
                return len(data)

        manager = ModManager(Http(), tempfile.mkdtemp(), home=lambda: home)
        files = ["60fps/exefs/main.npdm", "60fps/romfs/a.bin", "30fps/romfs/a.bin"]
        mod = {"id": 7, "name": "Speed Mod", "files": [{"id": 70, "name": "speed.zip", "url": "https://x.invalid/dl", "size": len(data)}]}

        async def find_game(title):
            return {"id": 1, "name": "Zelda"}

        async def popular(gb_game, count=16):
            return [mod]

        async def file_list(file_id):
            return files

        manager.find_game, manager.popular, manager.file_list = find_game, popular, file_list
        game = {"id": "g1", "system": "switch", "title": "Zelda", "folder": roms,
                "files": [{"name": "Zelda [0100F2C0115B6000].nsp", "size": 4096, "folder": False}]}

        async def run(variant):
            manager.start_install(game, 7, variant)
            await manager._task
            return manager.job()

        self.assertEqual(asyncio.run(run(None))["state"], "error", "two builds: one has to be picked")
        job = asyncio.run(run("60fps"))
        self.assertEqual(job["state"], "done", job)
        ryu = os.path.join(home, ".config/Ryujinx/mods/contents/0100f2c0115b6000/Speed Mod - 60fps")
        cit = os.path.join(home, ".local/share/citron/load/0100F2C0115B6000/Speed Mod - 60fps")
        for folder in (ryu, cit):
            self.assertEqual(open(os.path.join(folder, "romfs/a.bin"), "rb").read(), b"a", "the 60fps build")
            self.assertTrue(os.path.isfile(os.path.join(folder, "exefs/main.npdm")))
        self.assertFalse(os.path.exists(os.path.join(home, "evil.txt")))
        self.assertEqual(manager.installed()["g1"]["7"]["variant"], "60fps")

        # A tampered record pointing elsewhere is not followed.
        record = manager.installed()
        keep = write(os.path.join(home, "keep", "me.txt"), b"keep")
        record["g1"]["7"]["paths"]["citron"] = os.path.dirname(keep)
        manager._write("installed.json", record)
        result = manager.remove(game, 7)
        self.assertFalse(result["ok"])
        self.assertTrue(os.path.isfile(keep), "nothing outside a mod folder is deleted")
        self.assertFalse(os.path.exists(ryu))
        self.assertNotIn("g1", manager.installed())


if __name__ == "__main__":
    unittest.main()
