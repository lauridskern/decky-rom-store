/** Small helpers shared by the store UI. */

export const SOURCE_LABELS: Record<string, string> = {
  switchroms: "Switch ROMs",
  romspedia: "Romspedia",
  retrostic: "Retrostic",
  romsdl: "RomsDL",
  nswpedia: "Nswpedia",
  romsfun: "RomsFun",
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
 * The shape of a console's box art, width / height of the front cover.
 *
 * Measured, not guessed: the median of the USA and Europe front scans in the
 * libretro-thumbnails box-art sets (RetroArch's library, which keeps the
 * scans' real proportions), November 2026. Japanese boxes often differ (the
 * Super Famicom and Japanese N64 are portrait, for example); the ROM sites
 * mostly carry USA and Europe releases. Consoles marked "~" had no usable
 * scans and use the physical case or the closest family member.
 *
 * Do not take these from IGDB: it stores every cover cropped to 3:4.
 */
export const BOX_RATIOS: Record<string, number> = {
  // Nintendo
  nes: 0.7,
  snes: 1.41, // USA/Europe boxes are landscape
  n64: 1.37, // landscape outside Japan
  gc: 0.71,
  wii: 0.714,
  wiiu: 0.714,
  switch: 0.62, // ~ the case is 105 x 170 mm
  gb: 1.0,
  gbc: 1.0,
  gba: 1.0,
  nds: 1.12, // a DS case is a little wider than tall
  "nds-64": 1.12,
  "3ds": 1.13,
  virtualboy: 1.0,
  pokemini: 1.0, // ~
  // Sega
  sg1000: 0.7, // ~ like the Master System
  mastersystem: 0.706,
  genesis: 0.7,
  segacd: 0.705,
  sega32x: 0.725,
  saturn: 0.62, // the USA/Europe cases are tall; Japanese ones are square
  dreamcast: 1.0,
  gamegear: 0.65, // USA 0.62, Europe 0.71
  // Sony
  psx: 1.0,
  ps2: 0.705,
  ps3: 0.87,
  psp: 0.58,
  psvita: 0.785,
  // Atari
  atari2600: 0.735,
  atari5200: 0.735, // ~ like the 2600
  atari7800: 0.723,
  atari800: 0.75, // ~
  atarist: 0.78, // ~ like the Amiga
  atarilynx: 1.04,
  jaguar: 0.71,
  // NEC, SNK, Bandai and others
  pcengine: 1.0,
  pcenginecd: 1.0,
  pcfx: 1.0, // ~ a CD case
  neogeo: 0.7, // ~ the AES box
  neogeoaes: 0.7,
  neogeocd: 1.0, // ~ a CD case
  ngp: 1.0,
  ngpc: 1.0,
  wonderswan: 0.815,
  "wonderswan-color": 0.815,
  "3do": 0.55, // USA long boxes; Europe 0.58
  colecovision: 0.732,
  intellivision: 0.722,
  vectrex: 0.743,
  videopac: 0.7, // ~
  // Arcade: flyers, which are portrait
  arcades: 0.71,
  mame: 0.71,
  fba: 0.71,
  // Computers and engines
  msx: 0.71,
  c64: 0.77,
  vic20: 0.77, // ~ like the C64
  amiga: 0.78,
  zxspectrum: 0.7, // ~
  amstradcpc: 0.7, // ~
  x68000: 0.71, // ~
  pc98: 0.71, // ~
  x1: 0.71, // ~
  "sharp-x1": 0.71, // ~
  dos: 0.78, // ~ big box PC games, like the Amiga
  pc: 0.78,
  mac: 0.78,
  ports: 0.78,
  scummvm: 0.78,
  easyrpg: 0.75, // ~
  openbor: 0.75, // ~
};

/** Box shape of a console's art, width / height (portrait 5:7 if unknown). */
export function boxRatio(system: string): number {
  return BOX_RATIOS[system] ?? 5 / 7;
}

/** The same, as a CSS aspect-ratio value. */
export function systemAspect(system: string): string {
  return String(boxRatio(system));
}

/**
 * Sources that resize every image to one fixed size, whatever the art's real
 * shape. Romspedia publishes covers at 500x710 (and 280x398) and thumbnails at
 * 525x295, so a square Game Boy box comes out tall and a landscape SNES box
 * comes out squeezed. Drawn stretched into the console's box shape, the art
 * gets its real proportions back.
 */
export function isResizedArt(url: string | null | undefined): boolean {
  return Boolean(url && /^https?:\/\/static\.romspedia\.com\//.test(url));
}

/**
 * Frames that take the art's own shape (grid covers, the detail poster) are
 * kept inside this range, so a banner or a sliver cannot make one absurdly
 * tall or flat. Real box art is well inside it and keeps its exact shape;
 * anything outside is fitted with its own colours behind it.
 */
export function clampArtRatio(ratio: number): number {
  return Math.min(2, Math.max(0.5, ratio));
}

/**
 * The backend's match_title(): one key for every way the sites spell a game
 * ("Pokémon Red", "Pokemon - Red Version (USA)"), used to find a shelf item
 * again in search results.
 */
export function matchKey(title: string): string {
  return (title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[([][^)\]]*[)\]]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|of|and|version|edition)\b/g, " ")
    .replace(/\s+/g, "");
}

/** width / height of each cover once it has loaded, shared by every frame. */
export const artRatios = new Map<string, number>();
