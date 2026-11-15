import { callable } from "@decky/api";

export interface RomFile {
  id: string;
  filename: string;
  url: string;
  size: number | null;
  region: string | null;
  label: string | null;
  source_url: string | null;
}

export interface RomEntry {
  key: string;
  source: string;
  source_id: string;
  title: string;
  system: string;
  url: string;
  cover: string | null;
  cover_full: string | null;
  summary: string | null;
  rating: number | null;
  rating_count: number | null;
  downloads: number | null;
  year: number | null;
  size: number | null;
  region: string | null;
  developer: string | null;
  publisher: string | null;
  genres: string[];
  files: RomFile[];
  normalized_title: string;
  error: string | null;
}

export interface MediaShot {
  kind: "image" | "video";
  thumb: string;
  full: string;
  watch?: string;
  name?: string;
}

export interface Media {
  appid?: number;
  caption?: string;
  shots?: MediaShot[];
  trailer?: MediaShot | null;
  capsule?: string;
  header?: string;
  summary?: string | null;
  genres?: string[];
  platforms?: string[];
  developers?: string[];
  released?: number | null;
}

export interface MergedRom {
  id: string;
  title: string;
  system: string;
  sources: string[];
  cover: string | null;
  rating: number | null;
  downloads: number | null;
  year: number | null;
  regions: string[];
  size: number | null;
  variants: number;
  entries: RomEntry[];
  /** A file for this game is already in its console's ROM folder. */
  installed?: boolean;
  extra?: { media?: Media };
}

export interface SourceInfo {
  id: string;
  label: string;
  homepage: string;
  supports_browse: boolean;
  enabled: boolean;
  status: string;
  error: string | null;
  base_url?: string;
  /** Unix seconds of the last successful search or browse. */
  last_ok?: number | null;
  last_error?: string | null;
  last_error_at?: number | null;
  /** Failures in a row; after a few the source rests for a while. */
  failures?: number;
  resting_until?: number | null;
  /** Measured download speed (bytes/s) and start delay, see backend/speeds.py. */
  speed?: number | null;
  delay?: number | null;
  speed_samples?: number;
  /** When the speed test last tried this source, and why it failed if it did. */
  speed_tested?: number | null;
  speed_test_error?: string | null;
}

export interface SearchPayload {
  query: string;
  count: number;
  page: number;
  has_more: boolean;
  cached?: boolean;
  cache_age_hours?: number;
  source_counts?: Record<string, number>;
  results: MergedRom[];
  sources: SourceInfo[];
  systems: string[];
  errors: Record<string, string>;
}

export interface DownloadJob {
  id: string;
  title: string;
  system: string;
  source: string;
  filename: string;
  url: string;
  destination: string;
  status: "queued" | "downloading" | "extracting" | "done" | "error" | "cancelled";
  received: number;
  total: number;
  speed: number;
  error: string | null;
  path: string | null;
  extracted_to: string | null;
  created: number;
  finished: number | null;
  /** The game's cover, for the Downloads tab. */
  cover?: string | null;
}

export interface LibrarySystem {
  key: string;
  label: string;
  folder: string;
  exists: boolean;
  path: string;
}

export interface StorageInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

export interface LibraryInfo {
  root: string;
  root_exists: boolean;
  candidates: string[];
  folders: string[];
  systems: LibrarySystem[];
  /** ROM libraries a download can go to (internal, SD card), with space. */
  storage?: StorageInfo[];
}

export interface Settings {
  roms_root: string;
  source_priority: string[];
  enabled_sources: string[];
  extract_archives: boolean;
  keep_archive: boolean;
  max_concurrent: number;
  results_per_source: number;
  romspedia_base_url: string;
  retrostic_base_url: string;
  romsdl_base_url: string;
  switchroms_base_url: string;
  myabandonware_base_url: string;
  show_nsfw: boolean;
  search_cache_hours: number;
  chrome_top_offset: number;
  chrome_bottom_offset: number;
  igdb_replace_covers: boolean;
  preferred_region?: string;
  /** Test every provider's speed once a week (backend/speedtest.py). */
  speed_test_auto?: boolean;
  steam_shortcuts?: boolean;
  steam_collections?: boolean;
  steam_artwork?: boolean;
  steamgriddb_api_key?: string;
  srm_path?: string;
  libretro_boxart?: boolean;
  boxart_resize?: boolean;
  igdb_client_id: string;
  igdb_client_secret: string;
}

export interface StatusPayload {
  settings: Settings;
  sources: SourceInfo[];
  library: LibraryInfo;
  downloads: DownloadJob[];
}

export interface CacheStats {
  entries: number;
  bytes: number;
  path: string;
  ttl_hours: number;
}

export interface ImageDiagnostics {
  plugin_name: string;
  base_url: string;
  local_url: string | null;
  cache_folder: string;
  cache_exists: boolean;
  cached_files: { name: string; size: number }[];
  runtime_dir: string;
  error: string | null;
}

export interface BiosInfo {
  system: string;
  label: string;
  /** File names the usual emulators accept (any one of them). */
  files: string[];
  hint: string | null;
  optional: boolean;
  /** Path of the file that was found, or null. */
  found: string | null;
  folder: string;
}

/** A game found in the ROM library's console folders. */
export interface InstalledGame {
  id: string;
  system: string;
  title: string;
  folder: string;
  files: { name: string; size: number; folder: boolean }[];
  size: number;
  modified: number;
  /** A Steam shortcut for it was made by the plugin. */
  in_steam?: boolean;
  /** Box art for it, when the console's box-art index has a match. */
  cover?: string | null;
  /** Its real name (title list, libretro, GameTDB), else the file name cleaned up. */
  name?: string;
}

/** A GameBanana mod for an installed game (backend/mods.py). */
export interface ModInfo {
  id: number;
  name: string;
  category?: string | null;
  likes: number;
  version?: string | null;
  updated?: number | null;
  author?: string | null;
  image?: string | null;
  summary?: string;
  url?: string | null;
  file: { id: number; name: string; size?: number | null; note?: string };
  /** One click: the layout is known, the emulator and the game ID found. */
  installable: boolean;
  /** Builds inside the archive (60 FPS, 30 FPS, ...); one has to be picked. */
  variants: string[];
  /** Why it is not one-click. */
  reason?: string | null;
  installed?: { variant?: string | null; emulators: string[] } | null;
}

export interface GameMods {
  game?: string;
  system?: string;
  supported: boolean;
  /** The emulators a mod goes into. */
  emulators: { id: string; label: string }[];
  /** Switch title ID or GameCube / Wii game ID. */
  game_id?: string | null;
  gamebanana?: { id: number; name: string } | null;
  mods: ModInfo[];
  reason?: string | null;
}

export interface ModJob {
  ok?: boolean;
  state: "idle" | "downloading" | "installing" | "done" | "error";
  mod?: number;
  game?: string;
  received?: number;
  total?: number;
  error?: string | null;
  /** An emulator setting the install switched on (Dolphin's custom textures). */
  config?: string | null;
}

export interface InstalledPayload {
  root: string;
  games: InstalledGame[];
  size: number;
}

export interface UninstallResult {
  ok: boolean;
  removed?: number;
  freed?: number;
  title?: string;
  error?: string | null;
}

/** One shortcut the Steam library should have (backend/steam.py). */
export interface SteamPlanItem {
  key: string;
  name: string;
  system: string;
  exe: string;
  launchOptions: string;
  startDir: string;
  collection: string | null;
  parser: string;
  appid: number | null;
}

export interface SteamPlan {
  srm: string | null;
  parsers: number;
  enabled: boolean;
  collections: boolean;
  artwork: boolean;
  items: SteamPlanItem[];
  remove: { key: string; appid: number; name: string }[];
  /** Consoles with games but no enabled Steam ROM Manager parser. */
  missing: Record<string, number>;
}

export interface SteamStatus {
  srm: string | null;
  parsers: number;
  consoles: string[];
  tracked: number;
  enabled: boolean;
}

/** A game on a home-screen shelf (favourites, recently viewed). */
export interface ShelfItem {
  key: string;
  title: string;
  system: string;
  cover: string | null;
  at: number;
}

export interface ShelvesPayload {
  favorites: ShelfItem[];
  recent: ShelfItem[];
  favorite?: boolean;
}

export interface StartDownloadResult {
  ok: boolean;
  error?: string;
  job?: DownloadJob;
  destination?: string;
}

export const searchRoms = callable<
  [string, string[] | null, string | null, string, number, number],
  SearchPayload
>("search");
export const browseRoms = callable<[string, number], SearchPayload>("browse");
export const getDetails = callable<[string], MergedRom | null>("get_details");
export const startDownload = callable<
  [string, string, string, string | null, string | null, string | null],
  StartDownloadResult
>("start_download");
export const getDownloads = callable<[], DownloadJob[]>("get_downloads");
export const cancelDownload = callable<[string], { ok: boolean }>("cancel_download");
export const clearDownloads = callable<[], { ok: boolean }>("clear_downloads");
export const getSettings = callable<[], Settings>("get_settings");
export const updateSettings = callable<[Partial<Settings>], Settings>("update_settings");
export const getLibrary = callable<[], LibraryInfo>("get_library");
export const checkBios = callable<[string], BiosInfo | null>("check_bios");
export const getShelves = callable<[], ShelvesPayload>("get_shelves");
export const getInstalled = callable<[], InstalledPayload>("get_installed");

/** Measured per source (backend/speeds.py): bytes per second, start delay. */
export interface SourceSpeed {
  speed?: number;
  delay?: number;
  samples?: number;
  /** The last speed test could not get a file from this source. */
  test_error?: string | null;
  tested?: number | null;
}
export const getSpeeds = callable<[], Record<string, SourceSpeed>>("get_speeds");

/** The provider speed test (backend/speedtest.py). */
export interface SpeedTestResult {
  ok: boolean;
  speed?: number;
  delay?: number;
  game?: string;
  error?: string;
}
export interface SpeedTestStatus {
  ok?: boolean;
  error?: string;
  running: boolean;
  current: string | null;
  pending?: string[];
  results: Record<string, SpeedTestResult>;
  started: number | null;
  finished: number | null;
  last_tested?: number | null;
}
export const startSpeedTest = callable<[], SpeedTestStatus>("start_speed_test");
export const getSpeedTest = callable<[], SpeedTestStatus>("get_speed_test");
export const steamPlan = callable<[string[] | null, boolean], SteamPlan>("steam_plan");
export const steamReport = callable<[Record<string, { appid: number; name: string }>, string[]], { ok: boolean }>("steam_report");
export const steamStatus = callable<[], SteamStatus>("steam_status");

export interface SteamArtworkPayload {
  source: "steamgriddb" | "igdb" | null;
  warning?: string | null;
  /** Slot -> image (base64), for SteamClient.Apps.SetCustomArtworkForApp. */
  assets: Partial<Record<"capsule" | "hero" | "header" | "logo" | "icon", { data: string; ext: "png" | "jpg" }>>;
}
export const steamArtwork = callable<[string], SteamArtworkPayload>("steam_artwork");

export interface SrmStatus {
  found: boolean;
  command: string | null;
  running: boolean;
  /** The last run's result (written by the helper after SRM finished). */
  last: { ok: boolean; code: number; at: number; error: string; seen?: boolean } | null;
  log: string[];
}
export const srmStatus = callable<[], SrmStatus>("srm_status");
export const srmStart = callable<[], { ok: boolean; error?: string; command?: string }>("srm_start");
export const srmAck = callable<[], { ok: boolean }>("srm_ack");
export const steamTracked = callable<[], Record<string, { appid: number; name: string }>>("steam_tracked");
export const uninstallGame = callable<[string], UninstallResult>("uninstall_game");
export const toggleFavorite = callable<[Partial<ShelfItem>], ShelvesPayload>("toggle_favorite");
export const addRecent = callable<[Partial<ShelfItem>], ShelvesPayload>("add_recent");
export const openFolder = callable<[string], { ok: boolean; error?: string }>("open_folder");
export const getCover = callable<[string | null, string], string | null>("get_cover");
export const prefetchCovers = callable<[string[], string], void>("prefetch_covers");
/** Every console a source can browse; `count` only where it is known. */
export interface ConsoleInfo {
  key: string;
  count: number | null;
}
export const getConsoles = callable<[], ConsoleInfo[]>("get_consoles");
export const getGameMods = callable<[string], GameMods>("get_game_mods");
export const installMod = callable<[string, number, string | null], ModJob>("install_mod");
export const getModJob = callable<[], ModJob>("get_mod_job");
export const cancelMod = callable<[], { ok: boolean }>("cancel_mod");
export const removeMod = callable<[string, number], { ok: boolean; error?: string | null }>("remove_mod");
export const getStatus = callable<[], StatusPayload>("get_status");
export const getImageDiagnostics = callable<[string | null], ImageDiagnostics>("image_diagnostics");
export const getCacheStats = callable<[], CacheStats>("cache_stats");
export const clearCache = callable<[], { ok: boolean; removed: number }>("clear_cache");
