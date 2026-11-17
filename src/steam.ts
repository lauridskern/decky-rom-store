/**
 * Keeps the Steam library in step with the ROM library, live.
 *
 * Steam ROM Manager edits shortcuts.vdf and needs Steam closed; the plugin runs
 * inside Steam, so it uses the client's own API instead (SteamClient.Apps).
 * The backend works out the shortcuts from SRM's parser configuration
 * (backend/steam.py); this module carries them out and reports the app ids.
 *
 * - after a download: the new game gets its shortcut (index.tsx listens for
 *   the backend's "rom_store_download_done" event, so this works with the
 *   store closed too)
 * - after an uninstall: its shortcut is removed
 * - "Sync with Steam" in Settings: everything, both ways
 *
 * A shortcut that SRM made earlier for the same file is adopted, not doubled.
 *
 * Every sync also re-points the shortcuts it manages whose emulator changed
 * (Emu Hub's "Which emulator opens games" switches SRM's parsers and sends
 * "emuhub:emulator-choice", index.tsx then syncs). Settings has two more:
 * - "Remove duplicates": one shortcut per game, the others are deleted
 * - "Re-add all games": duplicates and shortcuts of deleted games go, every
 *   game is pointed at the emulator SRM's parsers name now, missing ones are
 *   added. Shortcuts are corrected in place rather than deleted and made
 *   again, so play time, artwork and collections stay.
 */
import { srmAck, srmStart, srmStatus, steamArtwork, steamGone, SteamPlanItem, steamPlan, steamReport, steamTracked } from "./types";

export interface SyncResult {
  ok: boolean;
  added: string[];
  adopted: string[];
  removed: string[];
  /** Shortcuts now starting a different emulator (or arguments). */
  repointed: string[];
  /** Extra shortcuts for the same game that were deleted. */
  duplicates: number;
  /** Shortcuts of games no longer on disk that were deleted ("Re-add all"). */
  stale: string[];
  /** Existing shortcuts moved into their parser's Steam collection. */
  collections: string[];
  /** Games that got library artwork in this run. */
  artwork: string[];
  /** E.g. a SteamGridDB key that was turned down (IGDB art was used). */
  warning?: string;
  missing: Record<string, number>;
  error?: string;
}

/** Steam's app type for non-Steam shortcuts. */
const SHORTCUT_TYPE = 1073741824;

const steam = (): any => (globalThis as any).SteamClient;
const store = (name: string): any => (globalThis as any)[name];

/** Only one sync at a time, so two triggers never add the same game twice. */
let queue: Promise<unknown> = Promise.resolve();

function exists(appid: number | null | undefined): boolean {
  if (!appid) return false;
  try {
    return Boolean(store("appStore")?.GetAppOverviewByAppID(appid));
  } catch {
    return false;
  }
}

/** Existing shortcuts by the files they launch, to adopt instead of doubling. */
async function shortcutsByFile(keys: string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const apps: any[] = (store("appStore")?.allApps ?? []).filter((app: any) => app?.app_type === SHORTCUT_TYPE);
  for (const app of apps) {
    let details = store("appDetailsStore")?.GetAppDetails?.(app.appid);
    if (!details) {
      try {
        details = await store("appDetailsStore")?.RequestAppDetails?.(app.appid);
      } catch {
        details = null;
      }
    }
    const command = `${details?.strShortcutExe ?? ""} ${details?.strShortcutLaunchOptions ?? ""}`;
    for (const key of keys) {
      if (!found.has(key) && command.includes(key)) found.set(key, app.appid);
    }
  }
  return found;
}

interface ShortcutInfo {
  appid: number;
  name: string;
  exe: string;
  launchOptions: string;
  startDir: string;
  playtime: number;
}

async function details(appid: number): Promise<any> {
  let found = store("appDetailsStore")?.GetAppDetails?.(appid);
  if (!found) {
    try {
      found = await store("appDetailsStore")?.RequestAppDetails?.(appid);
    } catch {
      found = null;
    }
  }
  return found;
}

/** Every non-Steam shortcut with what it starts. */
async function allShortcuts(): Promise<ShortcutInfo[]> {
  const apps: any[] = (store("appStore")?.allApps ?? []).filter((app: any) => app?.app_type === SHORTCUT_TYPE);
  const out: ShortcutInfo[] = [];
  for (const app of apps) {
    const info = await details(app.appid);
    out.push({
      appid: app.appid,
      name: app.display_name ?? "",
      exe: info?.strShortcutExe ?? "",
      launchOptions: info?.strShortcutLaunchOptions ?? "",
      startDir: info?.strShortcutStartDir ?? "",
      playtime: Number(app.minutes_playtime_forever ?? 0) || 0,
    });
  }
  return out;
}

const unquote = (text: string) => (text ?? "").trim().replace(/^"(.*)"$/, "$1");
const command = (s: ShortcutInfo) => `${s.exe} ${s.launchOptions}`;
const launches = (s: ShortcutInfo, item: SteamPlanItem) =>
  command(s).includes(item.key) || (!!item.real && command(s).includes(item.real));

function sameLaunch(s: ShortcutInfo, item: SteamPlanItem): boolean {
  return (
    unquote(s.exe) === unquote(item.exe) &&
    (s.launchOptions ?? "").trim() === (item.launchOptions ?? "").trim() &&
    unquote(s.startDir) === unquote(item.startDir)
  );
}

function repoint(appid: number, item: SteamPlanItem): void {
  const apps = steam()?.Apps;
  apps?.SetShortcutExe?.(appid, item.exe);
  apps?.SetShortcutStartDir?.(appid, item.startDir);
  apps?.SetShortcutLaunchOptions?.(appid, item.launchOptions);
}

/** ROM paths named in a shortcut's command, inside the library folder. */
function romPaths(s: ShortcutInfo, roots: string[]): string[] {
  const text = command(s);
  const found: string[] = [];
  for (const root of roots) {
    let at = text.indexOf(root.replace(/\/$/, "") + "/");
    while (at >= 0) {
      const end = text.slice(at).search(/["']/);
      found.push((end < 0 ? text.slice(at) : text.slice(at, at + end)).trim());
      at = text.indexOf(root.replace(/\/$/, "") + "/", at + 1);
    }
  }
  return found;
}

function collectionHas(collection: any, appid: number): boolean {
  try {
    if (typeof collection?.apps?.has === "function") return Boolean(collection.apps.has(appid));
    const list = collection?.allApps ?? collection?.apps;
    if (Array.isArray(list)) return list.some((app: any) => (app?.appid ?? app) === appid);
  } catch {
    /* unknown shape: treat as not in it */
  }
  return false;
}

/**
 * Put a game in its parser's Steam collection and take it out of the other
 * parsers' collections (`managed`: every collection SRM's parsers name), so a
 * game moved to another emulator, or a shortcut adopted from SRM, ends up in
 * the right one. Collections the user made are never touched. Best effort:
 * Steam's collection store is internal and changes between builds.
 * Returns true when something changed.
 */
async function placeInCollection(appid: number, target: string | null, managed: string[]): Promise<boolean> {
  try {
    const collections = store("collectionStore");
    const overview = store("appStore")?.GetAppOverviewByAppID(appid);
    if (!collections || !overview) return false;
    let changed = false;
    for (const collection of [...(collections.userCollections ?? [])]) {
      const name = collection?.displayName;
      if (!name || name === target || !managed.includes(name) || !collectionHas(collection, appid)) continue;
      const editable = collection.AsDragDropCollection?.() ?? collection;
      editable.RemoveApps?.([overview]);
      await editable.Save?.();
      changed = true;
    }
    if (target) {
      const existing = (collections.userCollections ?? []).find((c: any) => c?.displayName === target);
      if (!existing) {
        const created = collections.NewUnsavedCollection?.(target, undefined, [overview]);
        await created?.Save?.();
        changed = true;
      } else if (!collectionHas(existing, appid)) {
        const editable = existing.AsDragDropCollection?.() ?? existing;
        editable.AddApps?.([overview]);
        await editable.Save?.();
        changed = true;
      }
    }
    return changed;
  } catch {
    return false; /* the shortcut is there; the collection is a nicety */
  }
}

async function addShortcut(item: SteamPlanItem): Promise<number | null> {
  const apps = steam()?.Apps;
  if (!apps?.AddShortcut) return null;
  const appid: number = await apps.AddShortcut(item.name, item.exe, item.startDir, item.launchOptions);
  if (!appid) return null;
  // AddShortcut names the shortcut after the executable on some builds.
  apps.SetShortcutName?.(appid, item.name);
  apps.SetShortcutExe?.(appid, item.exe);
  apps.SetShortcutStartDir?.(appid, item.startDir);
  apps.SetShortcutLaunchOptions?.(appid, item.launchOptions);
  return appid;
}

/** Steam's library slots (ELibraryAssetType). */
const ASSET_TYPES = { capsule: 0, hero: 1, logo: 2, header: 3, icon: 4 } as const;

function hasCustomArt(appid: number): boolean {
  try {
    return Boolean(store("appStore")?.GetAppOverviewByAppID(appid)?.BHasCustomImages?.());
  } catch {
    return false;
  }
}

/**
 * Library art for a shortcut, the way Steam ROM Manager adds it: cover, wide
 * cover, hero, logo and icon (SteamGridDB with the user's key, else IGDB).
 * Never replaces art a shortcut already has (an SRM shortcut, say).
 */
let lastWarning: string | undefined;

async function addArtwork(appid: number, name: string): Promise<boolean> {
  const apps = steam()?.Apps;
  if (!apps?.SetCustomArtworkForApp || hasCustomArt(appid)) return false;
  const art = await steamArtwork(name);
  if (art.warning) lastWarning = art.warning;
  let set = false;
  for (const [slot, image] of Object.entries(art.assets ?? {})) {
    if (!image) continue;
    try {
      await apps.SetCustomArtworkForApp(appid, image.data, image.ext, ASSET_TYPES[slot as keyof typeof ASSET_TYPES]);
      set = true;
    } catch {
      /* one slot failing does not stop the others */
    }
  }
  return set;
}

type Mode = "sync" | "dedupe" | "repair";

async function run(paths: string[] | null, add: boolean, mode: Mode = "sync"): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true, added: [], adopted: [], removed: [], repointed: [], duplicates: 0, stale: [], collections: [], artwork: [], missing: {},
  };
  if (!steam()?.Apps) return { ...result, ok: false, error: "Not running inside Steam" };
  const plan = await steamPlan(paths, add);
  result.missing = plan.missing ?? {};
  if (!plan.enabled && add) return { ...result, ok: false, error: "Adding games to Steam is switched off in Settings" };

  const reported: Record<string, { appid: number; name: string }> = {};
  const removedKeys: string[] = [];

  if (mode !== "sync") {
    const shortcuts = await allShortcuts();
    const gone = new Set<number>();
    // One shortcut per game: the most played (its play time stays visible),
    // else the one the store tracks, else the oldest. The others go.
    for (const item of plan.items) {
      const matches = shortcuts.filter((s) => !gone.has(s.appid) && launches(s, item));
      if (!matches.length) continue;
      const keep = [...matches].sort(
        (a, b) =>
          b.playtime - a.playtime || Number(b.appid === item.appid) - Number(a.appid === item.appid) || a.appid - b.appid,
      )[0];
      for (const extra of matches) {
        if (extra.appid === keep.appid) continue;
        try {
          steam().Apps.RemoveShortcut(extra.appid);
          gone.add(extra.appid);
          result.duplicates += 1;
        } catch (error) {
          result.ok = false;
          result.error = String(error);
        }
      }
      if (item.appid !== keep.appid) {
        item.appid = keep.appid;
        reported[item.key] = { appid: keep.appid, name: item.name };
      }
    }
    if (mode === "repair" && plan.roots?.length) {
      // Shortcuts of games that were deleted (by hand, or by another tool).
      const candidates = shortcuts.filter((s) => !gone.has(s.appid) && !plan.items.some((item) => launches(s, item)));
      const named = new Map<number, string[]>();
      for (const s of candidates) {
        const found = romPaths(s, plan.roots);
        if (found.length) named.set(s.appid, found);
      }
      const missing = new Set(named.size ? await steamGone([...new Set([...named.values()].flat())]) : []);
      for (const s of candidates) {
        const files = named.get(s.appid);
        if (!files || !files.every((file) => missing.has(file))) continue;
        try {
          steam().Apps.RemoveShortcut(s.appid);
          gone.add(s.appid);
          result.stale.push(s.name);
        } catch (error) {
          result.ok = false;
          result.error = String(error);
        }
      }
    }
    if (mode === "dedupe") {
      if (Object.keys(reported).length) await steamReport(reported, []);
      return result;
    }
  }

  // Shortcuts the store manages that start the wrong emulator now (SRM's
  // parsers changed): correct them in place.
  for (const item of plan.items) {
    if (!exists(item.appid)) continue;
    const info = await details(item.appid!);
    if (!info) continue;
    const current: ShortcutInfo = {
      appid: item.appid!, name: item.name, playtime: 0,
      exe: info.strShortcutExe ?? "", launchOptions: info.strShortcutLaunchOptions ?? "", startDir: info.strShortcutStartDir ?? "",
    };
    if (sameLaunch(current, item)) continue;
    try {
      repoint(item.appid!, item);
      result.repointed.push(item.name);
    } catch (error) {
      result.ok = false;
      result.error = String(error);
    }
  }

  const todo = plan.items.filter((item) => !exists(item.appid));
  // Shortcuts made earlier that still have no art (art was off, or offline).
  const bare = plan.artwork ? plan.items.filter((item) => exists(item.appid) && !hasCustomArt(item.appid!)) : [];
  const adoptable = todo.length ? await shortcutsByFile(todo.map((item) => item.key)) : new Map<string, number>();
  for (const item of todo) {
    try {
      const adopted = adoptable.get(item.key);
      const appid = adopted ?? (await addShortcut(item));
      if (!appid) continue;
      reported[item.key] = { appid, name: item.name };
      (adopted ? result.adopted : result.added).push(item.name);
      if (plan.artwork && (await addArtwork(appid, item.name).catch(() => false))) result.artwork.push(item.name);
    } catch (error) {
      result.ok = false;
      result.error = String(error);
    }
  }

  for (const item of bare) {
    if (await addArtwork(item.appid!, item.name).catch(() => false)) result.artwork.push(item.name);
  }

  // Every game the store manages sits in its parser's collection: new ones,
  // adopted SRM shortcuts, kept duplicates and games moved to another emulator.
  if (plan.collections) {
    const managed = plan.managed_collections ?? [];
    for (const item of plan.items) {
      const appid = reported[item.key]?.appid ?? item.appid;
      if (!appid || !exists(appid)) continue;
      const fresh = result.added.includes(item.name);
      if ((await placeInCollection(appid, item.collection, managed)) && !fresh) result.collections.push(item.name);
    }
  }

  const removed: string[] = removedKeys;
  for (const gone of plan.remove) {
    try {
      if (exists(gone.appid)) steam().Apps.RemoveShortcut(gone.appid);
      removed.push(gone.key);
      result.removed.push(gone.name);
    } catch (error) {
      result.ok = false;
      result.error = String(error);
    }
  }
  if (Object.keys(reported).length || removed.length) await steamReport(reported, removed);
  if (lastWarning) result.warning = lastWarning;
  lastWarning = undefined;
  return result;
}

/**
 * Bring the Steam library up to date. `paths`: only these files (a finished
 * download); `add: false`: only remove shortcuts of games that are gone.
 */
export function syncWithSteam(paths: string[] | null = null, add = true): Promise<SyncResult> {
  const next = queue.then(() => run(paths, add));
  queue = next.catch(() => undefined);
  return next;
}

/** "Remove duplicates": keep one Steam shortcut per game. */
export function removeDuplicateShortcuts(): Promise<SyncResult> {
  const next = queue.then(() => run(null, true, "dedupe"));
  queue = next.catch(() => undefined);
  return next;
}

/** "Re-add all games": duplicates and dead shortcuts out, every game on the right emulator. */
export function repairSteamLibrary(): Promise<SyncResult> {
  const next = queue.then(() => run(null, true, "repair"));
  queue = next.catch(() => undefined);
  return next;
}

/** A shortcut that launches one of these files: one the store made, else SRM's. */
async function findShortcut(paths: string[]): Promise<number | null> {
  const tracked = await steamTracked();
  for (const path of paths) {
    const appid = tracked[path]?.appid;
    if (exists(appid)) return appid;
  }
  const found = await shortcutsByFile(paths);
  for (const path of paths) {
    const appid = found.get(path);
    if (appid) return appid;
  }
  return null;
}

/** Steam's 64-bit id of a shortcut: the app id in the high half, 0x02000000 in the low. */
function gameId(appid: number): string {
  const overview = store("appStore")?.GetAppOverviewByAppID(appid);
  if (overview?.m_gameid) return String(overview.m_gameid);
  return ((BigInt(appid) << BigInt(32)) | BigInt(0x02000000)).toString();
}

/**
 * Start an installed game through its Steam shortcut, which carries the
 * emulator and its arguments from Steam ROM Manager's parsers. A game without
 * a shortcut gets one first (the same sync a finished download runs).
 */
export async function playGame(paths: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!steam()?.Apps?.RunGame) return { ok: false, error: "Not running inside Steam" };
  let appid = await findShortcut(paths);
  if (!appid) {
    const sync = await syncWithSteam(paths);
    appid = await findShortcut(paths);
    if (!appid) {
      if (Object.keys(sync.missing ?? {}).length)
        return { ok: false, error: "Steam ROM Manager has no parser for this console, so Steam does not know how to start it." };
      return { ok: false, error: sync.error ?? "It could not be added to your Steam library." };
    }
  }
  steam().Apps.RunGame(gameId(appid), "", -1, 100);
  return { ok: true };
}

/**
 * Run Steam ROM Manager itself (see backend/srm_runner.py). Steam has to be
 * closed for it, so this ends with Steam shutting down; Game Mode starts it
 * again. In order, so nothing is lost when a step fails:
 *   1. SRM must be installed
 *   2. the backend starts its helper, which waits for Steam to close
 *   3. the plugin's own shortcuts are handed over (removed), so SRM does not
 *      add those games a second time; SRM's own come back after the run
 *   4. Steam shuts down
 */
export function runSteamRomManager(): Promise<{ ok: boolean; error?: string }> {
  const next = queue.then(async () => {
    const status = await srmStatus();
    if (!status.found) return { ok: false, error: "Steam ROM Manager was not found." };
    const started = await srmStart();
    if (!started.ok) return { ok: false, error: started.error ?? "Could not start Steam ROM Manager." };
    const tracked = await steamTracked();
    const handed: string[] = [];
    for (const [key, info] of Object.entries(tracked)) {
      try {
        if (exists(info.appid)) steam().Apps.RemoveShortcut(info.appid);
        handed.push(key);
      } catch {
        /* SRM will still add it; a later sync adopts it */
      }
    }
    if (handed.length) await steamReport({}, handed);
    // Give Steam a moment to take the removals in before it writes its list.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    steam()?.User?.StartShutdown?.(false);
    return { ok: true };
  });
  queue = next.catch(() => undefined);
  return next;
}

/**
 * After a restart: if Steam ROM Manager ran, say how it went and sync, which
 * adopts SRM's new shortcuts (so uninstalling still removes them). Waits for
 * Steam's app list to fill first, or SRM's shortcuts would look missing.
 */
export async function reportSteamRomManager(notify: (title: string, body: string) => void): Promise<void> {
  const status = await srmStatus();
  const last = status.last;
  if (!last || last.seen) return;
  await srmAck();
  if (!last.ok) {
    notify("Steam ROM Manager did not finish", last.error || status.log.slice(-1)[0] || "See Settings → Steam library");
    return;
  }
  notify("Steam ROM Manager finished", "Your library was updated by Steam ROM Manager.");
  for (let tries = 0; tries < 20; tries += 1) {
    const apps = store("appStore")?.allApps ?? [];
    if (apps.some((app: any) => app?.app_type === SHORTCUT_TYPE)) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  await syncWithSteam().catch(() => undefined);
}
