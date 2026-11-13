/** Small helpers shared by the store UI. */

export const SOURCE_LABELS: Record<string, string> = {
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
