/**
 * Mock of the @decky/api surface so the store UI can be rendered outside of
 * the Steam client (used by tools/preview).
 */
import type { MergedRom, DownloadJob, LibraryInfo, Settings } from "../../src/types";

export const toaster = {
  toast: (data: { title?: string; body?: string }) => {
    // eslint-disable-next-line no-console
    console.log("[toast]", data.title, data.body);
    return { dismiss: () => undefined };
  },
};

export const routerHook = {
  addRoute: () => undefined,
  removeRoute: () => undefined,
};

export const definePlugin = (fn: any) => fn;

// Local copies so the preview does not depend on the network.
const COVERS: Record<string, string> = {
  "Super Mario 64": "./covers/sm64.webp",
  "Mario Kart Wii": "./covers/mkwii.webp",
  "Mario Kart 7": "./covers/mk7.webp",
  "Pokemon Brilliant Diamond": "./covers/pbd.webp",
};

const TITLES = [
  "Super Mario 64",
  "Mario Kart Wii",
  "Mario Kart 7",
  "New Super Mario Bros. 2",
  "Pokemon Brilliant Diamond",
  "Sonic Mania Plus",
  "Animal Crossing: New Horizons",
  "Kirby And The Forgotten Land",
  "The Legend of Zelda: Ocarina of Time",
  "Super Smash Bros.",
  "Mario & Luigi",
  "Doom",
];

const SYSTEMS = ["n64", "wii", "3ds", "switch", "snes", "dos", "nes", "gc"];

const MANY = Number((globalThis as any).__ROM_COUNT ?? 0);
// A first start: nothing viewed, nothing installed, nothing downloading.
const FRESH = Boolean((globalThis as any).__FRESH);
const ALL_TITLES = [...TITLES, ...Array.from({ length: 48 }, (_, i) => `Test Game ${i + 1}`)];

const makeRom = (title: string, index: number, system: string, id: string): MergedRom => {
  const sources =
    index % 3 === 0
      ? ["romspedia", "retrostic", "romsdl"]
      : index % 3 === 1
        ? ["romspedia", "myabandonware"]
        : ["retrostic"];
  return {
    id,
    title,
    system,
    sources,
    cover: COVERS[title] ?? null,
    rating: 3.4 + (index % 15) / 10,
    downloads: 50000 + index * 7300,
    year: 1996 + index,
    regions: index % 4 === 0 ? ["USA", "Europe"] : [],
    size: 5_970_000 + index * 1_200_000,
    variants: sources.length,
    entries: sources.map((source, variantIndex) => ({
      key: `${source}:${index}`,
      source,
      source_id: `${index}`,
      title,
      system,
      url: "https://example.invalid",
      cover: COVERS[title] ?? null,
      summary: "Platform",
      rating: 3.4 + (index % 15) / 10,
      rating_count: 120,
      downloads: 50000 + index * 7300,
      year: 1996 + index,
      size: 5_970_000,
      // Like the real sources: most entries do not say.
      region: index % 4 === 0 ? "USA" : null,
      developer: "Nintendo EAD",
      publisher: "Nintendo",
      genres: ["Action", "Platform"],
      normalized_title: title.toLowerCase(),
      error: null,
      files:
        // The first game also has a file on a second provider, so the speed
        // ranking ("Fastest") can be seen.
        variantIndex === 1 && index === 0
          ? [
              {
                id: `${source}:${index}:other`,
                filename: `${title} (USA) [!].zip`,
                url: "https://example.invalid/other.zip",
                size: 6_000_000,
                region: "USA",
                label: null,
                source_url: "https://example.invalid",
              },
            ]
          : variantIndex === 0
          ? [
              {
                id: `${source}:${index}:0`,
                filename: `${title} (USA).zip`,
                url: "https://example.invalid/file.zip",
                size: 5_970_000,
                region: "USA",
                label: null,
                source_url: "https://example.invalid",
              },
              // A few titles carry several dumps so the file list can be checked.
              ...(index % 4 === 0
                ? [
                    {
                      id: `${source}:${index}:1`,
                      filename: `${title} (Europe) (En,Fr,De).zip`,
                      url: "https://example.invalid/file-eu.zip",
                      size: 6_120_000,
                      region: "Europe",
                      label: null,
                      source_url: "https://example.invalid",
                    },
                    {
                      id: `${source}:${index}:2`,
                      filename: `${title} (USA) (Rev 1).zip`,
                      url: "https://example.invalid/file-rev1.zip",
                      size: 5_990_000,
                      region: "USA",
                      label: "Rev 1",
                      source_url: "https://example.invalid",
                    },
                  ]
                : []),
              // The first game has many dumps, like popular games on the real
              // sites, so "Show all versions" can be tried.
              ...(index === 0
                ? ["Japan", "Japan (Rev 1)", "Europe (Rev A)", "Brazil", "Korea", "Beta", "Demo"].map((tag, n) => ({
                    id: `${source}:${index}:extra${n}`,
                    filename: `${title} (${tag}).zip`,
                    url: `https://example.invalid/extra${n}.zip`,
                    size: 5_900_000 + n * 10_000,
                    region: tag.split(" ")[0],
                    label: null,
                    source_url: "https://example.invalid",
                  }))
                : []),
            ]
          : [],
    })),
  } as MergedRom;
};

const roms: MergedRom[] = (MANY ? ALL_TITLES : TITLES).map((title, index) =>
  makeRom(title, index, SYSTEMS[index % SYSTEMS.length], `rom-${index}`),
);

// Like the backend: browsing a console returns that console's catalogue.
// Every game made here is registered, so the game panel can find it.
const known = new Map<string, MergedRom>(roms.map((rom) => [rom.id, rom]));
const browseConsole = (system: string): MergedRom[] =>
  TITLES.map((title, index) => {
    const rom = makeRom(title, index, system, `browse-${system}-${index}`);
    known.set(rom.id, rom);
    return rom;
  });

const jobs: DownloadJob[] = FRESH ? [] : [
  {
    id: "dl-1",
    title: "Super Mario 64",
    system: "n64",
    source: "romspedia",
    filename: "Super Mario 64 (USA).zip",
    url: "https://example.invalid",
    destination: "/home/deck/EmuDecky/roms/n64",
    status: "downloading",
    received: 3_200_000,
    total: 5_970_000,
    speed: 1_450_000,
    error: null,
    path: null,
    extracted_to: null,
    created: Date.now() / 1000,
    finished: null,
    cover: "./covers/sm64.webp",
  },
  {
    id: "dl-2",
    title: "Mario & Luigi",
    system: "dos",
    source: "myabandonware",
    filename: "Mario-Luigi_DOS_EN.zip",
    url: "https://example.invalid",
    destination: "/home/deck/EmuDecky/roms/dos",
    status: "done",
    received: 58190,
    total: 58190,
    speed: 0,
    error: null,
    path: "/home/deck/EmuDecky/roms/dos/Mario-Luigi_DOS_EN.zip",
    extracted_to: null,
    created: Date.now() / 1000 - 60,
    finished: Date.now() / 1000,
  },
];

// Home screen shelves: a few favourites and recently viewed games.
const shelves = FRESH ? { favorites: [], recent: [] } : {
  favorites: [
    { key: "n64|supermario64", title: "Super Mario 64", system: "n64", cover: "./covers/sm64.webp", at: 0 },
    { key: "3ds|mariokart7", title: "Mario Kart 7", system: "3ds", cover: "./covers/mk7.webp", at: 0 },
    // Not in the mock catalogue: its page shows "Search for it".
    { key: "snes|chronotrigger", title: "Chrono Trigger", system: "snes", cover: null, at: 0 },
  ],
  recent: [
    { key: "wii|mariokartwii", title: "Mario Kart Wii", system: "wii", cover: "./covers/mkwii.webp", at: 0 },
    { key: "snes|pokemonbrilliantdiamond", title: "Pokemon Brilliant Diamond", system: "snes", cover: "./covers/pbd.webp", at: 0 },
    { key: "n64|supermario64", title: "Super Mario 64", system: "n64", cover: "./covers/sm64.webp", at: 0 },
  ],
};

let srmStarted = false;

// Shortcuts "added to Steam" in the preview, by file.
const steamTracked: Record<string, { appid: number; name: string }> = {};

// Installed games panel: a few games, one with several files.
let installedGames = FRESH ? [] : [
  { id: "g1", system: "n64", title: "Super Mario 64 (USA)", cover: "./covers/sm64.webp", folder: "/home/deck/EmuDecky/roms/n64", files: [{ name: "Super Mario 64 (USA).z64", size: 8_388_608, folder: false }], size: 8_388_608, modified: 3 },
  { id: "g2", system: "psx", title: "Final Fantasy VII (USA)", folder: "/home/deck/EmuDecky/roms/psx", files: [{ name: "Final Fantasy VII (USA).m3u", size: 120, folder: false }, { name: "Final Fantasy VII (USA) (Disc 1).chd", size: 512_000_000, folder: false }, { name: "Final Fantasy VII (USA) (Disc 2).chd", size: 498_000_000, folder: false }], size: 1_010_000_120, modified: 2 },
  { id: "g4", system: "switch", title: "The Legend of Zelda Tears of the Kingdom [0100F2C0115B6000][v0]", folder: "/home/deck/EmuDecky/roms/switch", files: [{ name: "The Legend of Zelda Tears of the Kingdom [0100F2C0115B6000][v0].nsp", size: 16_400_000_000, folder: false }], size: 16_400_000_000, modified: 4 },
  { id: "g5", system: "gc", title: "Legend of Zelda, The - The Wind Waker (USA)", folder: "/home/deck/EmuDecky/roms/gc", files: [{ name: "Legend of Zelda, The - The Wind Waker (USA).rvz", size: 980_000_000, folder: false }], size: 980_000_000, modified: 5 },
  { id: "g3", system: "gb", title: "Tetris (World) (Rev 1)", folder: "/home/deck/EmuDecky/roms/gb", files: [{ name: "Tetris (World) (Rev 1).gb", size: 32_768, folder: false }], size: 32_768, modified: 1 },
];

const library: LibraryInfo = {
  root: "/home/deck/EmuDecky/roms",
  root_exists: true,
  candidates: ["/home/deck/EmuDecky/roms", "/home/deck/Emulation/roms"],
  folders: ["n64", "snes", "switch", "dos", "wii", "ps2"],
  storage: [
    { root: "/home/deck/EmuDecky/roms", label: "Internal storage", free: 41_200_000_000, total: 512_000_000_000 },
    { root: "/run/media/mmcblk0p1/Emulation/roms", label: "SD card", free: 188_700_000_000, total: 512_000_000_000 },
  ],
  systems: [
    { key: "switch", label: "Nintendo Switch", folder: "switch", exists: true, path: "/home/deck/EmuDecky/roms/switch" },
    { key: "n64", label: "Nintendo 64", folder: "n64", exists: true, path: "/home/deck/EmuDecky/roms/n64" },
    { key: "snes", label: "Super Nintendo Entertainment System", folder: "snes", exists: true, path: "/home/deck/EmuDecky/roms/snes" },
    { key: "switch", label: "Nintendo Switch", folder: "switch", exists: true, path: "/home/deck/EmuDecky/roms/switch" },
    { key: "wii", label: "Nintendo Wii", folder: "wii", exists: true, path: "/home/deck/EmuDecky/roms/wii" },
    { key: "dos", label: "DOS / PC", folder: "dos", exists: true, path: "/home/deck/EmuDecky/roms/dos" },
    { key: "nes", label: "Nintendo Entertainment System", folder: "nes", exists: false, path: "/home/deck/EmuDecky/roms/nes" },
  ],
};

const settings: Settings = {
  roms_root: "/home/deck/EmuDecky/roms",
  source_priority: ["romspedia", "retrostic", "romsdl", "myabandonware"],
  enabled_sources: ["switchroms", "romspedia", "retrostic", "romsdl", "romsfun", "myabandonware"],
  extract_archives: false,
  keep_archive: true,
  max_concurrent: 2,
  results_per_source: 30,
  romspedia_base_url: "https://www.romspedia.com",
  retrostic_base_url: "https://www.retrostic.com",
  romsdl_base_url: "https://romsdl.com",
  myabandonware_base_url: "https://www.myabandonware.com",
  show_nsfw: false,
  chrome_top_offset: 0,
  chrome_bottom_offset: 0,
  igdb_client_id: "",
  igdb_client_secret: "",
};

const handlers: Record<string, (...args: any[]) => any> = {
  search: async () => {
    return {
    query: "mario",
    count: roms.length,
    results: roms,
    sources: [
      { id: "romspedia", label: "Romspedia", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "retrostic", label: "Retrostic", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "romsdl", label: "RomsDL", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "myabandonware", label: "My Abandonware", homepage: "", supports_browse: false, enabled: true, status: "idle", error: null },
    ],
    source_counts: { romspedia: 17, retrostic: 30, romsdl: 30, myabandonware: 13 },
    page: 1,
    has_more: true,
    systems: SYSTEMS,
    errors: {},
    };
  },
  browse: async (system: string) => {
    const results = browseConsole(system);
    return {
      query: "",
      count: results.length,
      page: 1,
      has_more: false,
      results,
      sources: [],
      source_counts: {},
      systems: [system],
      errors: {},
    };
  },
  get_cover: async (url: string | null) => url,
  prefetch_covers: async () => undefined,
  // Counted consoles first, then the ones only other sources carry.
  // As the backend: every console a source can browse, the popular ones first, no counts.
  get_consoles: async () =>
    ["switch", "ps2", "psx", "gba", "snes", "n64", "nds", "3ds", "gc", "wii", "nes", "gb", "gbc", "psp", "genesis",
      "dreamcast", "ps3", "wiiu", "psvita", "saturn", "mastersystem", "gamegear", "segacd", "sega32x", "arcades",
      "neogeo", "pcengine", "3do", "amiga", "atari2600", "atari7800", "jaguar", "ngpc", "virtualboy", "wonderswan"]
      .map((key) => ({ key, count: null })),
  get_details: async (id: string) => {
    const rom = known.get(id);
    if (!rom) return null;
    return {
      ...rom,
      extra: {
        media: {
          appid: 367520,
          caption: rom.title,
          summary:
            "Mario is invited to Princess Peach's castle for cake, only to find that Bowser has " +
            "sealed the princess and her servants inside the walls and scattered the Power Stars " +
            "across fifteen courses. Run, swim, slide and fly through the castle to win them back.", 
          capsule: "https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_616x353.jpg",
          trailer: {
            kind: "video",
            thumb: "https://img.youtube.com/vi/UAO2urG23S4/mqdefault.jpg",
            full: "https://www.youtube.com/embed/UAO2urG23S4?autoplay=1&rel=0",
            watch: "https://www.youtube.com/watch?v=UAO2urG23S4",
            name: "Release Trailer",
          },
          shots: [1, 2, 3, 4, 5].map((n) => ({
            kind: "image",
            thumb: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/ss_5384f9f8b96a0b9934b2bc35a4058376211636d2.600x338.jpg?n=${n}`,
            full: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/ss_5384f9f8b96a0b9934b2bc35a4058376211636d2.1920x1080.jpg?n=${n}`,
          })),
        },
      },
    };
  },
  start_download: async () => ({ ok: true, job: jobs[0], destination: "/home/deck/EmuDecky/roms/n64" }),
  get_downloads: async () => jobs,
  cancel_download: async () => ({ ok: true }),
  clear_downloads: async () => ({ ok: true }),
  get_settings: async () => settings,
  update_settings: async (values: Partial<Settings>) => ({ ...settings, ...values }),
  get_library: async () => library,
  get_shelves: async () => shelves,
  // Measured provider speeds (see the speed test below).
  get_speeds: async () => measured,
  start_speed_test: async () => {
    if (speedTest.running) return { ok: false, ...speedTest };
    const ids = [...settings.enabled_sources];
    speedTest = { running: true, current: ids[0] ?? null, pending: ids, results: {}, started: Date.now() / 1000, finished: null, last_tested: speedTest.last_tested };
    const step = () => {
      // As the backend: a source stays pending until its result is in.
      const id = speedTest.pending[0];
      if (!id) {
        speedTest = { ...speedTest, running: false, current: null, finished: Date.now() / 1000, last_tested: Date.now() / 1000 };
        return;
      }
      speedTest.current = id;
      window.setTimeout(() => {
        const live = SPEED_TEST[id];
        speedTest.results[id] = live.error ? { ok: false, error: live.error } : { ok: true, speed: live.speed, delay: live.delay, game: "Super Mario 64" };
        measured[id] = live.error
          ? { ...(measured[id] ?? {}), test_error: live.error, tested: Date.now() / 1000 }
          : { speed: live.speed, delay: live.delay, samples: (measured[id]?.samples ?? 0) + 1, tested: Date.now() / 1000 };
        speedTest.pending = speedTest.pending.slice(1);
        step();
      }, 500);
    };
    step();
    return { ok: true, ...speedTest };
  },
  get_speed_test: async () => ({ ...speedTest, results: { ...speedTest.results }, pending: [...speedTest.pending] }),
  // Steam library (backend/steam.py): N64 and PS1 have SRM parsers, Game Boy not.
  steam_status: async () => ({
    srm: "/home/deck/.config/steam-rom-manager/userData",
    parsers: 2,
    consoles: ["n64", "psx"],
    tracked: Object.keys(steamTracked).length,
    enabled: true,
  }),
  steam_plan: async (paths: string[] | null, add: boolean) => {
    const launch: Record<string, [string, string, string]> = {
      n64: ['"/home/deck/Emulation/tools/launchers/retroarch.sh"', "-L .../mupen64plus_next_libretro.so", "N64"],
      psx: ['"/home/deck/Emulation/tools/launchers/duckstation.sh"', "-batch", "PS1"],
    };
    const items: any[] = [];
    const missing: Record<string, number> = {};
    const onDisk = new Set<string>();
    for (const game of installedGames) {
      const key = `${game.folder}/${game.files[0].name}`;
      onDisk.add(key);
      if (!add || (paths && !paths.includes(key))) continue;
      const parser = launch[game.system];
      if (!parser) {
        missing[game.system] = (missing[game.system] ?? 0) + 1;
        continue;
      }
      items.push({
        key, name: game.title.replace(/\s*\(.*$/, ""), system: game.system, exe: parser[0],
        launchOptions: `${parser[1]} "${key}"`, startDir: '"/home/deck/Emulation/tools/launchers"',
        collection: parser[2], parser: "", appid: steamTracked[key]?.appid ?? null,
      });
    }
    const remove = Object.entries(steamTracked)
      .filter(([key]) => !onDisk.has(key))
      .map(([key, info]) => ({ key, appid: info.appid, name: info.name }));
    return { srm: "/home/deck/.config/steam-rom-manager/userData", parsers: 2, enabled: true, collections: true, artwork: true, items, remove, missing };
  },
  // A 1x1 PNG per slot stands in for real art.
  steam_artwork: async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    return { source: "igdb", assets: { capsule: { data: png, ext: "png" }, hero: { data: png, ext: "png" }, header: { data: png, ext: "png" } } };
  },
  // Steam ROM Manager run (backend/srm_runner.py): found, never run yet.
  srm_status: async () => ({
    found: true,
    command: "/home/deck/Emulation/tools/srm/Steam-ROM-Manager.AppImage add",
    running: srmStarted,
    last: null,
    log: [],
  }),
  srm_start: async () => {
    srmStarted = true;
    return { ok: true, command: "/home/deck/Emulation/tools/srm/Steam-ROM-Manager.AppImage add" };
  },
  srm_ack: async () => ({ ok: true }),
  steam_tracked: async () => ({ ...steamTracked }),
  steam_report: async (added: Record<string, { appid: number; name: string }>, removed: string[]) => {
    Object.assign(steamTracked, added);
    removed.forEach((key) => delete steamTracked[key]);
    installedGames = installedGames.map((g) => ({ ...g, in_steam: Boolean(steamTracked[`${g.folder}/${g.files[0].name}`]) }));
    return { ok: true };
  },
  get_installed: async () => ({ root: "/home/deck/EmuDecky/roms", games: installedGames, size: installedGames.reduce((n, g) => n + g.size, 0) }),
  uninstall_game: async (id: string) => {
    const game = installedGames.find((g) => g.id === id);
    if (!game) return { ok: false, error: "That game is no longer in the library." };
    installedGames = installedGames.filter((g) => g.id !== id);
    return { ok: true, removed: game.files.length, freed: game.size, title: game.title, error: null };
  },
  toggle_favorite: async (item: { title: string; system: string; cover?: string | null }) => {
    const key = `${item.system}|${item.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const had = shelves.favorites.some((f) => f.key === key);
    shelves.favorites = had
      ? shelves.favorites.filter((f) => f.key !== key)
      : [{ key, title: item.title, system: item.system, cover: item.cover ?? null, at: Date.now() / 1000 }, ...shelves.favorites];
    return { ...shelves, favorite: !had };
  },
  add_recent: async (item: { title: string; system: string; cover?: string | null }) => {
    const key = `${item.system}|${item.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    shelves.recent = [
      { key, title: item.title, system: item.system, cover: item.cover ?? null, at: Date.now() / 1000 },
      ...shelves.recent.filter((r) => r.key !== key),
    ].slice(0, 24);
    return shelves;
  },
  // Preview only: a missing BIOS on the N64 games, so the note shows up.
  check_bios: async (system: string) =>
    system === "n64"
      ? { system, label: "Example BIOS", files: ["example_a.bin", "example_b.bin"], hint: null, optional: false, found: null, folder: "/home/deck/EmuDecky/bios" }
      : null,
  get_status: async () => ({
    settings,
    // One of each health state, so the settings view shows them all.
    sources: [
      { id: "romspedia", label: "Romspedia", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null, last_ok: Date.now() / 1000 - 240, failures: 0, ...speedFields("romspedia") },
      { id: "retrostic", label: "Retrostic", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null, last_ok: Date.now() / 1000 - 7200, last_error: "HttpError: HTTP 503", last_error_at: Date.now() / 1000 - 600, failures: 1, ...speedFields("retrostic") },
      { id: "romsdl", label: "RomsDL", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null, last_error: "Host not found", last_error_at: Date.now() / 1000 - 120, failures: 4, resting_until: Date.now() / 1000 + 780, ...speedFields("romsdl") },
      { id: "myabandonware", label: "My Abandonware", homepage: "", supports_browse: false, enabled: true, status: "idle", error: null, last_ok: Date.now() / 1000 - 30, failures: 0, ...speedFields("myabandonware") },
      { id: "switchroms", label: "Switch ROMs", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null, last_ok: Date.now() / 1000 - 600, failures: 0, ...speedFields("switchroms") },
      { id: "romsfun", label: "RomsFun", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null, last_ok: Date.now() / 1000 - 900, failures: 0, ...speedFields("romsfun") },
    ],
    library,
    downloads: jobs,
  }),
  open_folder: async () => ({ ok: true }),
};

// What the speed test measured on a real run (Nov 2026), so the preview's
// ranking looks like the Deck's.
const SPEED_TEST: Record<string, { speed?: number; delay?: number; error?: string }> = {
  switchroms: { speed: 18_050_000, delay: 1.0 },
  romspedia: { speed: 5_690_000, delay: 0.6 },
  romsfun: { speed: 5_660_000, delay: 8.6 },
  myabandonware: { speed: 380_000, delay: 43.7 },
  romsdl: { speed: 250_000, delay: 0.1 },
  retrostic: { speed: 110_000, delay: 1.1 },
};
const measured: Record<string, { speed?: number; delay?: number; samples?: number; tested?: number; test_error?: string }> = {
  romspedia: { speed: 5_690_000, delay: 0.6, samples: 3 },
  retrostic: { speed: 110_000, delay: 1.1, samples: 2 },
};
let speedTest: {
  running: boolean;
  current: string | null;
  pending: string[];
  results: Record<string, unknown>;
  started: number | null;
  finished: number | null;
  last_tested: number | null;
} = { running: false, current: null, pending: [], results: {}, started: null, finished: null, last_tested: null };
const speedFields = (id: string) => ({
  speed: measured[id]?.speed ?? null,
  delay: measured[id]?.delay ?? null,
  speed_samples: measured[id]?.samples ?? 0,
  speed_tested: measured[id]?.tested ?? null,
  speed_test_error: measured[id]?.test_error ?? null,
});

// Mods (backend/mods.py): TotK and Wind Waker have some, the rest are not supported.
const MODS: Record<string, any[]> = {
  g4: [
    { id: 480138, name: "UltraCam (Resolution, FPS, FreeCam)", category: "Visual Overhaul", likes: 161, version: "2.6.1", author: "MaxLastBreath", image: null, summary: "Resolution and FPS options, free camera, configurable in game.", file: { id: 1, name: "ultracam_261_beyond.zip", size: 130_298 }, installable: true, variants: ["UltraCam"], reason: null, installed: null },
    { id: 448096, name: "Visuals Fixed 1.1.2", category: "Visual Overhaul", likes: 41, version: "1.1.2", author: "Ninjamonkey", image: null, summary: "Sharper shadows, less ghosting, 30 or 60 FPS builds.", file: { id: 2, name: "visuals_fixed.zip", size: 3_200_000 }, installable: true, variants: ["Sky Island Fix Standalone", "Visuals Fixed 30fps", "Visuals Fixed 60fps"], reason: null, installed: null },
    { id: 446995, name: "Serfrost's Defogger (Native)", category: "Visual Overhaul", likes: 224, version: null, author: "Serfrost", image: null, summary: "Removes the distance fog.", file: { id: 3, name: "defogger.zip", size: 52_000 }, installable: true, variants: ["Serfrosts Defogger"], reason: null, installed: { variant: "Serfrosts Defogger", emulators: ["ryujinx", "citron"] } },
    { id: 537404, name: "Challenge Mode Complete Version", category: "Gameplay", likes: 182, version: null, author: "Hylian", image: null, summary: "", file: { id: 4, name: "challenge.zip", size: 900_000 }, installable: false, variants: [], reason: "No romfs or exefs folder: not a mod this store can install", installed: null },
  ],
  g5: [
    { id: 9001, name: "The Legend of Goose: The Honk Waker", category: "Skins", likes: 88, version: null, author: "Goose", image: null, summary: "HD texture pack.", file: { id: 5, name: "goose.zip", size: 41_000_000 }, installable: true, variants: ["HD Texture Pack"], reason: null, installed: null },
    { id: 250757, name: "Linka! (Female Link)", category: "Skins", likes: 120, version: null, author: "someone", image: null, summary: "", file: { id: 6, name: "linka.zip", size: 3_333_603 }, installable: false, variants: [], reason: "Replaces files on the disc: needs patching the game, not one-click", installed: null },
  ],
};
let modJob: any = { state: "idle" };
handlers.get_game_mods = async (id: string) => {
  await new Promise((r) => setTimeout(r, 400));
  const game = installedGames.find((g) => g.id === id);
  if (!game || !MODS[id]) {
    return { supported: false, emulators: [], mods: [], reason: "Mods are supported for Switch, GameCube and Wii games so far." };
  }
  const emulators = game.system === "switch" ? [{ id: "ryujinx", label: "Ryujinx" }, { id: "citron", label: "Citron" }] : [{ id: "dolphin", label: "Dolphin" }];
  return { supported: true, emulators, game_id: game.system === "switch" ? "0100F2C0115B6000" : "GZLE01", gamebanana: { id: 7617, name: game.title.replace(/ \[.*$/, "") }, mods: MODS[id], reason: null };
};
handlers.install_mod = async (gameId: string, modId: number, variant: string | null) => {
  const mod = MODS[gameId]?.find((m) => m.id === modId);
  if (!mod) return { ok: false, state: "error", error: "Unknown mod" };
  const total = mod.file.size;
  modJob = { state: "downloading", mod: modId, game: gameId, received: 0, total };
  const tick = () => {
    if (modJob.state !== "downloading") return;
    modJob.received = Math.min(total, modJob.received + total / 6);
    if (modJob.received >= total) {
      modJob.state = "installing";
      setTimeout(() => {
        modJob.state = "done";
        mod.installed = { variant: variant ?? mod.variants[0], emulators: gameId === "g5" ? ["dolphin"] : ["ryujinx", "citron"] };
        if (gameId === "g5") modJob.config = "GFX.ini";
      }, 500);
    } else setTimeout(tick, 350);
  };
  setTimeout(tick, 350);
  return { ok: true, ...modJob };
};
handlers.get_mod_job = async () => ({ ...modJob });
handlers.cancel_mod = async () => { modJob = { ...modJob, state: "error", error: "Cancelled" }; return { ok: true }; };
handlers.remove_mod = async (gameId: string, modId: number) => {
  const mod = MODS[gameId]?.find((m) => m.id === modId);
  if (mod) mod.installed = null;
  return { ok: true, error: null };
};

export const callable =
  <Args extends any[] = [], Return = void>(route: string) =>
  async (...args: Args): Promise<Return> => {
    const handler = handlers[route];
    if (!handler) throw new Error(`No mock for ${route}`);
    return handler(...args) as Return;
  };

export const addEventListener = () => () => undefined;
export const removeEventListener = () => undefined;
