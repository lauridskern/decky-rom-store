"""Unpacking archives the emulator cannot open (backend/unpack.py). Offline."""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.steam import SrmConfig  # noqa: E402
from backend.unpack import main_file, needs_unpack, unpack  # noqa: E402


def srm_with(rom_dir: str, glob: str) -> SrmConfig:
    return SrmConfig("/srm", [{"configTitle": "x", "romDirectory": rom_dir, "parserInputs": {"glob": glob}}], {})


class Decide(unittest.TestCase):
    def test_from_the_parsers_file_types(self):
        roms = tempfile.mkdtemp()
        psp = os.path.join(roms, "psp")
        os.makedirs(psp)
        srm = srm_with(psp, "**/${title}@(.7z|.7Z|.elf|.chd|.cso|.iso|.pbp|.prx)")  # EmuDeck's PPSSPP parser
        self.assertTrue(needs_unpack("psp", psp, "God of War (USA).zip", srm), "PPSSPP takes no .zip")
        self.assertFalse(needs_unpack("psp", psp, "God of War (USA).7z", srm), "but it takes .7z")
        self.assertFalse(needs_unpack("psp", psp, "God of War (USA).iso", srm), "not an archive")
        gba = os.path.join(roms, "gba")
        os.makedirs(gba)
        srm2 = srm_with(gba, "**/${title}@(.gba|.zip|.7z)")
        self.assertFalse(needs_unpack("gba", gba, "Golden Sun.zip", srm2))
        self.assertTrue(needs_unpack("psx", os.path.join(roms, "psx"), "FF7.zip", None), "no parser: disc consoles")
        self.assertFalse(needs_unpack("snes", os.path.join(roms, "snes"), "Mario.zip", None))


class Unpack(unittest.TestCase):
    def test_flat_unique_and_the_file_to_launch(self):
        folder = tempfile.mkdtemp()
        archive = os.path.join(folder, "Game (USA).zip")
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr("Game (USA)/Game (USA).cue", "FILE")
            zf.writestr("Game (USA)/Game (USA) (Track 1).bin", b"x" * 100)
            zf.writestr("../escape.bin", b"no")
        with open(os.path.join(folder, "Game (USA).cue"), "w") as fh:
            fh.write("already here")
        produced = unpack(archive, folder)
        names = sorted(os.path.basename(p) for p in produced)
        self.assertIn("Game (USA) (2).cue", names, "an existing file is never overwritten")
        self.assertIn("Game (USA) (Track 1).bin", names)
        self.assertIn("escape.bin", names, "flattened into the folder, not outside it")
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(folder), "escape.bin")))
        self.assertTrue(main_file(produced).endswith(".cue"))
        self.assertEqual(open(os.path.join(folder, "Game (USA).cue")).read(), "already here")
        self.assertFalse([n for n in os.listdir(folder) if n.startswith(".unpack-")], "no work folder left")

    def test_a_broken_archive_says_so(self):
        folder = tempfile.mkdtemp()
        broken = os.path.join(folder, "x.7z")
        with open(broken, "wb") as fh:
            fh.write(b"not an archive")
        with self.assertRaises(RuntimeError):
            unpack(broken, folder)


if __name__ == "__main__":
    unittest.main()
