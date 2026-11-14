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
}

export interface SearchPayload {
  query: string;
  count: number;
  page: number;
  has_more: boolean;
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
}

export interface LibrarySystem {
  key: string;
  label: string;
  folder: string;
  exists: boolean;
  path: string;
}

export interface LibraryInfo {
  root: string;
  root_exists: boolean;
  candidates: string[];
  folders: string[];
  systems: LibrarySystem[];
}

export interface Settings {
  roms_root: string;
  source_priority: string[];
  enabled_sources: string[];
  extract_archives: boolean;
  keep_archive: boolean;
  max_concurrent: number;
  results_per_source: number;
  dumbroms_base_url: string;
  dumbroms_search_url: string;
  romspedia_base_url: string;
  retrostic_base_url: string;
  romsdl_base_url: string;
  switchroms_base_url: string;
  myabandonware_base_url: string;
  show_nsfw: boolean;
  chrome_top_offset: number;
  chrome_bottom_offset: number;
  igdb_replace_covers: boolean;
  igdb_client_id: string;
  igdb_client_secret: string;
}

export interface StatusPayload {
  settings: Settings;
  sources: SourceInfo[];
  library: LibraryInfo;
  downloads: DownloadJob[];
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
  [string, string, string, string | null, string | null],
  StartDownloadResult
>("start_download");
export const getDownloads = callable<[], DownloadJob[]>("get_downloads");
export const cancelDownload = callable<[string], { ok: boolean }>("cancel_download");
export const clearDownloads = callable<[], { ok: boolean }>("clear_downloads");
export const getSettings = callable<[], Settings>("get_settings");
export const updateSettings = callable<[Partial<Settings>], Settings>("update_settings");
export const getLibrary = callable<[], LibraryInfo>("get_library");
export const openFolder = callable<[string], { ok: boolean; error?: string }>("open_folder");
export const getCover = callable<[string | null, string], string | null>("get_cover");
export const prefetchCovers = callable<[string[], string], void>("prefetch_covers");
export const getSystemCounts = callable<[], Record<string, number>>("get_system_counts");
export const getStatus = callable<[], StatusPayload>("get_status");
export const getImageDiagnostics = callable<[string | null], ImageDiagnostics>("image_diagnostics");
