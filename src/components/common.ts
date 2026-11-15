/** Small helpers shared by the store UI. */

export const SOURCE_LABELS: Record<string, string> = {
  switchroms: "Switch ROMs",
  romspedia: "Romspedia",
  retrostic: "Retrostic",
  romsdl: "RomsDL",
  nswpedia: "Nswpedia",
  homebrewhub: "Homebrew Hub",
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
  pokemini: "Pokémon mini",
  genesis: "Genesis",
  megadrive: "Mega Drive",
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
  "sharp-x1": "Sharp X1",
  x1: "Sharp X1",
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

/** Regions the header filter offers. */
export const REGIONS = ["USA", "Europe", "Japan"] as const;
export type Region = (typeof REGIONS)[number];

const REGION_WORDS: Record<string, Region | "World"> = {
  usa: "USA", us: "USA", u: "USA", america: "USA", "north america": "USA", canada: "USA",
  europe: "Europe", eu: "Europe", e: "Europe", uk: "Europe", "united kingdom": "Europe", germany: "Europe",
  france: "Europe", spain: "Europe", italy: "Europe", netherlands: "Europe", sweden: "Europe",
  scandinavia: "Europe", australia: "Europe", pal: "Europe",
  // Language tags of European releases: "(ES)", "(De)", "(En,Fr,De)".
  es: "Europe", de: "Europe", fr: "Europe", it: "Europe", nl: "Europe", sv: "Europe",
  japan: "Japan", jp: "Japan", j: "Japan", jpn: "Japan", ntsc_j: "Japan",
  world: "World", w: "World",
};

/**
 * The regions a game is known to exist in, from the sites' region fields and
 * the tags in their titles: "(USA)", "(U)", "(USA, Europe)", "[J]". Empty when
 * no source says.
 */
export function regionsOf(rom: { regions: string[]; entries: { title: string; region: string | null }[] }): Set<string> {
  const found = new Set<string>();
  const add = (word: string) => {
    const region = REGION_WORDS[word.trim().toLowerCase().replace(/-/g, "_")];
    if (region) found.add(region);
  };
  rom.regions.forEach((region) => region.split(/[,/]/).forEach(add));
  for (const entry of rom.entries) {
    if (entry.region) entry.region.split(/[,/]/).forEach(add);
    for (const tag of entry.title.match(/[([][^)\]]+[)\]]/g) ?? []) tag.slice(1, -1).split(/[,/]/).forEach(add);
  }
  return found;
}

/**
 * Region filter: hides games only known from other regions. Games no source
 * gives a region for stay (most sites do not tag their titles); "World" fits all.
 */
export function inRegion(rom: Parameters<typeof regionsOf>[0], region: string): boolean {
  if (region === "all") return true;
  const regions = regionsOf(rom);
  return regions.size === 0 || regions.has("World") || regions.has(region);
}

/** width / height of each cover once it has loaded, shared by every frame. */
export const artRatios = new Map<string, number>();


/**
 * Console families, for a touch of colour: the stripe on a console tile and
 * the tint of a cover that has no art. Colours only, no logos.
 */
const FAMILIES: Record<string, string[]> = {
  nintendo: ["nes", "snes", "n64", "gc", "wii", "wiiu", "switch", "gb", "gbc", "gba", "nds", "nds-64", "3ds", "virtualboy", "pokemini"],
  sony: ["psx", "ps2", "ps3", "psp", "psvita"],
  sega: ["genesis", "megadrive", "mastersystem", "gamegear", "sg1000", "sega32x", "segacd", "saturn", "dreamcast"],
  atari: ["atari2600", "atari5200", "atari7800", "atarist", "atarilynx", "jaguar", "atari800"],
  nec: ["pcengine", "pcenginecd", "pcfx"],
  snk: ["neogeo", "neogeocd", "ngp", "ngpc"],
  arcade: ["arcades", "mame", "fba"],
  computer: ["dos", "pc", "mac", "amiga", "c64", "vic20", "zxspectrum", "amstradcpc", "msx", "x68000", "pc98", "scummvm", "ports", "easyrpg", "openbor"],
};
const FAMILY_TINT: Record<string, string> = {
  nintendo: "#e5484d",
  sony: "#4c82ff",
  sega: "#2bb5e8",
  atari: "#f2913d",
  nec: "#e9c046",
  snk: "#d7a94b",
  arcade: "#a877ff",
  computer: "#4fc98a",
};
const SYSTEM_TINT: Record<string, string> = {};
Object.entries(FAMILIES).forEach(([family, systems]) => systems.forEach((key) => (SYSTEM_TINT[key] = FAMILY_TINT[family])));

/** A console's accent colour (by maker), grey when unknown. */
export function systemTint(system: string): string {
  return SYSTEM_TINT[system] ?? "#8a95a3";
}

/** "12 s", "4 min", "1 h 20 min": time left on a download. */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds - hours * 3600) / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" from unix seconds. */
export function timeAgo(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const delta = Math.max(0, Date.now() / 1000 - seconds);
  if (delta < 90) return "just now";
  if (delta < 5400) return `${Math.round(delta / 60)} min ago`;
  if (delta < 129600) return `${Math.round(delta / 3600)} h ago`;
  return `${Math.round(delta / 86400)} days ago`;
}

/** The key favourites and recently viewed games are stored under. */
export function shelfKey(system: string, title: string): string {
  return `${system}|${matchKey(title)}`;
}
