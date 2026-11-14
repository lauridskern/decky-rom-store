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

const roms: MergedRom[] = TITLES.map((title, index) => {
  const system = SYSTEMS[index % SYSTEMS.length];
  const sources =
    index % 3 === 0
      ? ["romspedia", "retrostic", "romsdl"]
      : index % 3 === 1
        ? ["romspedia", "myabandonware"]
        : ["retrostic"];
  return {
    id: `rom-${index}`,
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
      region: "USA",
      developer: "Nintendo EAD",
      publisher: "Nintendo",
      genres: ["Action", "Platform"],
      normalized_title: title.toLowerCase(),
      error: null,
      files:
        variantIndex === 0
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
            ]
          : [],
    })),
  } as MergedRom;
});

const jobs: DownloadJob[] = [
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

const library: LibraryInfo = {
  root: "/home/deck/EmuDecky/roms",
  root_exists: true,
  candidates: ["/home/deck/EmuDecky/roms", "/home/deck/Emulation/roms"],
  folders: ["n64", "snes", "switch", "dos", "wii", "ps2"],
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
  source_priority: ["romspedia", "retrostic", "romsdl", "dumbroms", "myabandonware"],
  enabled_sources: ["romspedia", "retrostic", "romsdl", "dumbroms", "myabandonware"],
  extract_archives: false,
  keep_archive: true,
  max_concurrent: 2,
  results_per_source: 30,
  dumbroms_base_url: "https://dumbroms.com",
  dumbroms_search_url: "{base}/search?q={query}",
  romspedia_base_url: "https://www.romspedia.com",
  retrostic_base_url: "https://www.retrostic.com",
  romsdl_base_url: "https://romsdl.com",
  myabandonware_base_url: "https://www.myabandonware.com",
  show_nsfw: false,
  chrome_top_offset: 0,
};

const handlers: Record<string, (...args: any[]) => any> = {
  search: async () => ({
    query: "mario",
    count: roms.length,
    results: roms,
    sources: [
      { id: "romspedia", label: "Romspedia", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "retrostic", label: "Retrostic", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "romsdl", label: "RomsDL", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "dumbroms", label: "DumbRoms", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "myabandonware", label: "My Abandonware", homepage: "", supports_browse: false, enabled: true, status: "idle", error: null },
    ],
    source_counts: { romspedia: 17, retrostic: 30, romsdl: 30, myabandonware: 13 },
    page: 1,
    has_more: true,
    systems: SYSTEMS,
    errors: {},
  }),
  browse: async () => ({
    query: "",
    count: roms.length,
    page: 1,
    has_more: false,
    results: roms,
    sources: [],
    source_counts: {},
    systems: SYSTEMS,
    errors: {},
  }),
  get_cover: async (url: string | null) => url,
  prefetch_covers: async () => undefined,
  get_system_counts: async () => ({
    switch: 9,
    snes: 782,
    gba: 1204,
    nes: 402,
    n64: 393,
    ps2: 1035,
    "3ds": 1015,
    gc: 578,
    gbc: 2303,
    psx: 2180,
    megadrive: 906,
    arcades: 9053,
  }),
  get_details: async (id: string) => roms.find((rom) => rom.id === id) ?? null,
  start_download: async () => ({ ok: true, job: jobs[0], destination: "/home/deck/EmuDecky/roms/n64" }),
  get_downloads: async () => jobs,
  cancel_download: async () => ({ ok: true }),
  clear_downloads: async () => ({ ok: true }),
  get_settings: async () => settings,
  update_settings: async (values: Partial<Settings>) => ({ ...settings, ...values }),
  get_library: async () => library,
  get_status: async () => ({
    settings,
    sources: [
      { id: "romspedia", label: "Romspedia", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "retrostic", label: "Retrostic", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "romsdl", label: "RomsDL", homepage: "", supports_browse: true, enabled: true, status: "idle", error: null },
      { id: "dumbroms", label: "DumbRoms", homepage: "", supports_browse: true, enabled: true, status: "idle", error: "Could not reach https://dumbroms.com" },
      { id: "myabandonware", label: "My Abandonware", homepage: "", supports_browse: false, enabled: true, status: "idle", error: null },
    ],
    library,
    downloads: jobs,
  }),
  open_folder: async () => ({ ok: true }),
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
