"""Console normalisation and EmuDecky folder mapping.

`canonical_system()` turns whatever a source calls a platform ("N64",
"Nintendo 64", "playstation-1", "DOS", ...) into one stable key, and
`emudeck_folder()` maps that key onto the directory name used inside
`~/EmuDecky/roms/`.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

# key -> (display name, default EmuDecky roms folder)
SYSTEMS: Dict[str, Tuple[str, str]] = {
    # Nintendo
    "nes": ("Nintendo Entertainment System", "nes"),
    "snes": ("Super Nintendo Entertainment System", "snes"),
    "n64": ("Nintendo 64", "n64"),
    "gc": ("Nintendo GameCube", "gc"),
    "wii": ("Nintendo Wii", "wii"),
    "wiiu": ("Nintendo Wii U", "wiiu"),
    "switch": ("Nintendo Switch", "switch"),
    "gb": ("Game Boy", "gb"),
    "gbc": ("Game Boy Color", "gbc"),
    "gba": ("Game Boy Advance", "gba"),
    "nds": ("Nintendo DS", "nds"),
    "3ds": ("Nintendo 3DS", "3ds"),
    "nds-64": ("Nintendo DS 64", "nds64"),
    "virtualboy": ("Virtual Boy", "virtualboy"),
    "pokemini": ("Pok mini", "pokemini"),
    # Sega
    "genesis": ("Sega Genesis / Mega Drive", "genesis"),
    "mastersystem": ("Sega Master System", "mastersystem"),
    "gamegear": ("Sega Game Gear", "gamegear"),
    "sg1000": ("Sega SG-1000", "sg1000"),
    "sega32x": ("Sega 32X", "sega32x"),
    "segacd": ("Sega CD", "segacd"),
    "saturn": ("Sega Saturn", "saturn"),
    "dreamcast": ("Sega Dreamcast", "dreamcast"),
    # Sony
    "psx": ("PlayStation", "psx"),
    "ps2": ("PlayStation 2", "ps2"),
    "psp": ("PlayStation Portable", "psp"),
    "ps3": ("PlayStation 3", "ps3"),
    "psvita": ("PlayStation Vita", "psvita"),
    # Atari / others
    "atari2600": ("Atari 2600", "atari2600"),
    "atari5200": ("Atari 5200", "atari5200"),
    "atari7800": ("Atari 7800", "atari7800"),
    "atarist": ("Atari ST", "atarist"),
    "atarilynx": ("Atari Lynx", "atarilynx"),
    "jaguar": ("Atari Jaguar", "jaguar"),
    "atari800": ("Atari 800", "atari800"),
    "vic20": ("Commodore VIC-20", "vic20"),
    "c64": ("Commodore 64", "c64"),
    "amiga": ("Commodore Amiga", "amiga"),
    "colecovision": ("ColecoVision", "colecovision"),
    "intellivision": ("Mattel Intellivision", "intellivision"),
    "vectrex": ("Vectrex", "vectrex"),
    "videopac": ("Magnavox Odyssey 2 / Videopac", "videopac"),
    "3do": ("3DO Interactive Multiplayer", "3do"),
    "wonderswan": ("Bandai WonderSwan", "wonderswan"),
    "wonderswan-color": ("Bandai WonderSwan Color", "wonderswancolor"),
    "ngp": ("Neo Geo Pocket", "ngp"),
    "ngpc": ("Neo Geo Pocket Color", "ngpc"),
    "neogeo": ("Neo Geo", "neogeo"),
    "neogeocd": ("Neo Geo CD", "neogeocd"),
    "pcengine": ("NEC PC Engine / TurboGrafx-16", "pcengine"),
    "pcenginecd": ("NEC PC Engine CD", "pcenginecd"),
    "pcfx": ("NEC PC-FX", "pcfx"),
    "zxspectrum": ("ZX Spectrum", "zxspectrum"),
    "amstradcpc": ("Amstrad CPC", "amstradcpc"),
    "msx": ("MSX", "msx"),
    "x68000": ("Sharp X68000", "x68000"),
    "pc98": ("NEC PC-98", "pc98"),
    "sharp-x1": ("Sharp X1", "sharpx1"),
    "x1": ("Sharp X1", "sharpx1"),
    # Computers / misc
    "dos": ("DOS / PC", "dos"),
    "scummvm": ("ScummVM", "scummvm"),
    "easyrpg": ("EasyRPG", "easyrpg"),
    "ports": ("PC Ports", "ports"),
    "pc": ("PC (Windows)", "pc"),
    "mac": ("Apple Macintosh", "mac"),
    "openbor": ("OpenBOR", "openbor"),
    # Arcade
    "arcades": ("Arcade (FinalBurn Neo)", "arcades"),
    "mame": ("Arcade (MAME)", "mame"),
    "fba": ("Arcade (FinalBurn Neo)", "fba"),
    "neogeoaes": ("Neo Geo AES", "neogeo"),
}

# Alias -> canonical key. Keys are lower-cased and stripped before lookup.
ALIASES: Dict[str, str] = {}


def _register(canonical: str, *aliases: str) -> None:
    for alias in aliases:
        ALIASES[_key(alias)] = canonical


def _key(text: str) -> str:
    return "".join(ch for ch in (text or "").lower() if ch.isalnum())


_register("nes", "nintendo entertainment system", "nintendo nes", "famicom", "famicom")
_register("snes", "super nintendo", "super nintendo entertainment system", "nintendo snes", "super nes", "sfc")
_register("n64", "nintendo 64", "nintendo-64", "n64", "nintendo64")
_register("gc", "gamecube", "nintendo gamecube", "game cube", "ngc")
_register("wii", "nintendo wii", "wii")
_register("wiiu", "nintendo wii u", "wii u", "wiiu")
_register("switch", "nintendo switch", "ns", "nx", "switch")
_register("gb", "game boy", "gameboy", "gb", "game boy original")
_register("gbc", "game boy color", "gameboy color", "gbc")
_register("gba", "game boy advance", "gameboy advance", "gba")
_register("nds", "nintendo ds", "ds", "nds")
_register("3ds", "nintendo 3ds", "3ds", "3ds xl")
_register("genesis", "sega genesis", "mega drive", "megadrive", "genesis", "md")
_register("mastersystem", "sega master system", "master system", "mastersystem", "sms")
_register("gamegear", "sega game gear", "game gear", "gamegear", "gg")
_register("saturn", "sega saturn", "saturn")
_register("dreamcast", "sega dreamcast", "dreamcast", "dc")
_register("psx", "playstation", "playstation 1", "ps1", "psx", "sony playstation")
_register("ps2", "playstation 2", "ps2", "sony playstation 2")
_register("psp", "playstation portable", "psp", "sony psp")
_register("ps3", "playstation 3", "ps3")
_register("psvita", "playstation vita", "ps vita", "psvita")
_register("atari2600", "atari 2600", "2600", "atari2600")
_register("atari5200", "atari 5200", "5200")
_register("atari7800", "atari 7800", "7800")
_register("atarist", "atari st", "st", "atarist")
_register("atarilynx", "atari lynx", "lynx")
_register("c64", "commodore 64", "c64", "commodore64")
_register("amiga", "commodore amiga", "amiga")
_register("vic20", "commodore vic-20", "vic-20", "vic20")
_register("3do", "3do", "3do interactive multiplayer", "panasonic 3do")
_register("wonderswan", "bandai wonderswan", "wonderswan", "ws")
_register("wonderswan-color", "bandai wonderswan color", "wonderswan color", "wsc")
_register("ngp", "neo geo pocket", "ngp")
_register("ngpc", "neo geo pocket color", "ngpc")
_register("neogeo", "neo geo", "neogeo", "aes", "neo geo aes")
_register("pcengine", "pc engine", "turbografx-16", "turbografx 16", "tg16", "pc engine / turbografx-16")
_register("pcenginecd", "pc engine cd", "turbografx-cd", "segacd pce", "pc engine cd / turbografx-cd")
_register("zxspectrum", "zx spectrum", "spectrum", "zxspectrum")
_register("amstradcpc", "amstrad cpc", "cpc")
_register("msx", "msx", "msx1", "msx2")
_register("dos", "dos", "ms-dos", "pc dos", "msdos")
_register("scummvm", "scummvm")
_register("easyrpg", "easyrpg")
_register("ports", "ports", "pc ports", "ports/pc")
_register("pc", "windows", "pc", "windows pc", "microsoft windows")
_register("mac", "macintosh", "mac os", "apple macintosh")
_register("openbor", "openbor")
_register("arcades", "arcade", "arcades", "arcade (fba)", "fbneo", "final burn neo")
_register("mame", "mame", "mame 2003 plus", "arcade (mame)", "mame current")
_register("fba", "fba", "final burn neo", "arcade (finalburn neo)")


def canonical_system(raw: Optional[str]) -> str:
    """Return a stable system key for a free-form platform string."""
    if not raw:
        return "unknown"
    cleaned = raw.strip()
    low = _key(cleaned)
    if low in ALIASES:
        return ALIASES[low]
    if low in SYSTEMS:
        return low
    # Fall back to a loose match on the display names.
    for key, (label, _folder) in SYSTEMS.items():
        if low and (low in _key(label) or _key(label) in low):
            return key
    return "unknown"


def system_label(key: str) -> str:
    return SYSTEMS.get(key, ("Unknown", "unknown"))[0]


def default_folder(key: str) -> str:
    return SYSTEMS.get(key, ("Unknown", key))[1]


def emudeck_folder(key: str, available: Optional[List[str]] = None, strict: bool = False) -> str:
    """Map a system key onto a folder that exists in the EmuDecky roms tree.

    `available` is the list of directories found inside the roms root; when the
    preferred folder is missing we fall back to a case-insensitive match so
    that installs with slightly different naming still work.
    """
    preferred = default_folder(key)
    if not available:
        return preferred
    lowered = {name.lower(): name for name in available}
    if preferred.lower() in lowered:
        return lowered[preferred.lower()]
    alias = ALIASES.get(_key(preferred))
    if alias and alias.lower() in lowered:
        return lowered[alias.lower()]
    # loose match: "gameboy" -> "gb", "nintendo 64" -> "n64"
    compact = _key(preferred)
    for name in available:
        if _key(name) == compact:
            return name
    if strict:
        # Reading a library: "nes" must not take "snes" (or "gb" take "gba").
        return preferred
    for name in available:
        nk = _key(name)
        if nk and (nk in compact or compact in nk):
            return name
    return preferred


def known_systems() -> List[Dict[str, str]]:
    return [
        {"key": key, "label": label, "folder": folder}
        for key, (label, folder) in sorted(SYSTEMS.items(), key=lambda kv: kv[1][0])
    ]
