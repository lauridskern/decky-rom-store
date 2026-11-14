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
  // portrait boxes
  switch: "3 / 4",
  psp: "3 / 4",
  psvita: "3 / 4",
  gbc: "3 / 4",
  gb: "3 / 4",
  // square-ish boxes
  "3ds": "1 / 1",
  nds: "1 / 1",
  gba: "1 / 1",
  // square boxes
  snes: "1 / 1",
  nes: "1 / 1",
  genesis: "1 / 1",
  mastersystem: "1 / 1",
  gamegear: "1 / 1",
  n64: "1 / 1",
  gc: "1 / 1",
  psx: "1 / 1",
  ps2: "1 / 1",
  ps3: "1 / 1",
  wii: "1 / 1",
  wiiu: "1 / 1",
  "3do": "1 / 1",
  pcengine: "1 / 1",
  dreamcast: "1 / 1",
  saturn: "1 / 1",
  sega32x: "1 / 1",
  // landscape
  arcades: "4 / 3",
  mame: "4 / 3",
  neogeo: "4 / 3",
  dos: "4 / 3",
  pc: "4 / 3",
  scummvm: "4 / 3",
};

export function systemAspect(system: string): string {
  return SYSTEM_ASPECTS[system] ?? "3 / 4";
}
