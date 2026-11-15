/** Small helpers shared by the store UI. */

export const SOURCE_LABELS: Record<string, string> = {
  switchroms: "Switch ROMs",
  romspedia: "Romspedia",
  retrostic: "Retrostic",
  romsdl: "RomsDL",
  dumbroms: "DumbRoms",
  myabandonware: "MyAbandonware",
};

export const SYSTEM_LABELS: Record<string, string> = {
  nes: "NES",
  snes: "SNES",
  n64: "N64",
  gc: "GameCube",
  wii: "Wii",
  wiiu: "Wii U",
  switch: "Switch",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  nds: "Nintendo DS",
  "3ds": "Nintendo 3DS",
  "nds-64": "Nintendo DS 64",
  virtualboy: "Virtual Boy",
  genesis: "Genesis",
  mastersystem: "Master System",
  gamegear: "Game Gear",
  sg1000: "SG-1000",
  sega32x: "Sega 32X",
  segacd: "Sega CD",
  saturn: "Saturn",
  dreamcast: "Dreamcast",
  psx: "PlayStation",
  ps2: "PlayStation 2",
  psp: "PSP",
  ps3: "PlayStation 3",
  psvita: "PS Vita",
  atari2600: "Atari 2600",
  atari5200: "Atari 5200",
  atari7800: "Atari 7800",
  atarist: "Atari ST",
  atarilynx: "Atari Lynx",
  jaguar: "Atari Jaguar",
  atari800: "Atari 800",
  vic20: "VIC-20",
  c64: "Commodore 64",
  amiga: "Amiga",
  colecovision: "ColecoVision",
  intellivision: "Intellivision",
  vectrex: "Vectrex",
  videopac: "Videopac",
  "3do": "3DO",
  wonderswan: "WonderSwan",
  "wonderswan-color": "WonderSwan Color",
  ngp: "Neo Geo Pocket",
  ngpc: "Neo Geo Pocket Color",
  neogeo: "Neo Geo",
  neogeocd: "Neo Geo CD",
  pcengine: "PC Engine",
  pcenginecd: "PC Engine CD",
  pcfx: "PC-FX",
  zxspectrum: "ZX Spectrum",
  amstradcpc: "Amstrad CPC",
  msx: "MSX",
  x68000: "X68000",
  pc98: "PC-98",
  dos: "DOS",
  scummvm: "ScummVM",
  easyrpg: "EasyRPG",
  ports: "PC Ports",
  pc: "PC",
  mac: "Macintosh",
  openbor: "OpenBOR",
  arcades: "Arcade",
  mame: "MAME",
  fba: "FinalBurn Neo",
  unknown: "Unknown",
};

export function systemLabel(key: string): string {
  return SYSTEM_LABELS[key] || (key ? key.toUpperCase() : "Unknown");
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)}${units[index]}`;
}

export function formatCount(value: number | null | undefined): string {
  if (!value || value <= 0) return "";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}


/**
 * Box art shape per console, so a grid of NES games does not look like a
 * grid of Switch games.
 */
export const SYSTEM_ASPECTS: Record<string, string> = {
  // Box art is portrait on almost every cartridge and disc console. The exact
  // ratio differs by a few percent between regions, which is why the artwork
  // is fitted inside the frame rather than cropped to it.
  nes: "5 / 7",
  snes: "5 / 7",
  n64: "5 / 7",
  gc: "5 / 7",
  wii: "5 / 7",
  wiiu: "5 / 7",
  switch: "5 / 7",
  gb: "5 / 7",
  gbc: "5 / 7",
  gba: "5 / 7",
  virtualboy: "5 / 7",
  genesis: "5 / 7",
  mastersystem: "5 / 7",
  gamegear: "5 / 7",
  sg1000: "5 / 7",
  sega32x: "5 / 7",
  segacd: "5 / 7",
  saturn: "5 / 7",
  dreamcast: "5 / 7",
  psx: "5 / 7",
  ps2: "5 / 7",
  ps3: "5 / 7",
  psp: "5 / 7",
  psvita: "5 / 7",
  atari2600: "5 / 7",
  atari5200: "5 / 7",
  atari7800: "5 / 7",
  atarist: "5 / 7",
  jaguar: "5 / 7",
  "3do": "5 / 7",
  wonderswan: "5 / 7",
  "wonderswan-color": "5 / 7",
  ngp: "5 / 7",
  ngpc: "5 / 7",
  pcengine: "5 / 7",
  pcenginecd: "5 / 7",
  pcfx: "5 / 7",
  colecovision: "5 / 7",
  intellivision: "5 / 7",
  videopac: "5 / 7",
  zxspectrum: "5 / 7",
  amstradcpc: "5 / 7",
  msx: "5 / 7",
  x68000: "5 / 7",
  pc98: "5 / 7",
  c64: "5 / 7",
  vic20: "5 / 7",
  amiga: "5 / 7",
  atari800: "5 / 7",
  mac: "5 / 7",
  ports: "5 / 7",
  pc: "5 / 7",
  scummvm: "5 / 7",
  easyrpg: "5 / 7",
  // Nintendo DS and 3DS boxes are close to square.
  nds: "10 / 11",
  "nds-64": "10 / 11",
  "3ds": "10 / 11",
  // Arcade marquees and flyers are the only landscape-shaped art here.
  arcades: "4 / 3",
  mame: "4 / 3",
  fba: "4 / 3",
  neogeo: "4 / 3",
  neogeocd: "4 / 3",
  dos: "5 / 7",
  openbor: "5 / 7",
  vectrex: "5 / 7",
  atarilynx: "5 / 7",
};

export function systemAspect(system: string): string {
  return SYSTEM_ASPECTS[system] ?? "5 / 7";
}
