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
 */
import { srmAck, srmStart, srmStatus, steamArtwork, SteamPlanItem, steamPlan, steamReport, steamTracked } from "./types";

export interface SyncResult {
  ok: boolean;
  added: string[];
  adopted: string[];
  removed: string[];
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

/** Best effort: Steam's collection store is internal and changes between builds. */
async function addToCollection(name: string, appid: number): Promise<void> {
  try {
    const collections = store("collectionStore");
    const overview = store("appStore")?.GetAppOverviewByAppID(appid);
    if (!collections || !overview) return;
    const existing = (collections.userCollections ?? []).find((c: any) => c?.displayName === name);
    if (existing) {
      const editable = existing.AsDragDropCollection?.() ?? existing;
      editable.AddApps?.([overview]);
      await editable.Save?.();
    } else {
      const created = collections.NewUnsavedCollection?.(name, undefined, [overview]);
      await created?.Save?.();
    }
  } catch {
    /* the shortcut is there; the collection is a nicety */
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

async function run(paths: string[] | null, add: boolean): Promise<SyncResult> {
  const result: SyncResult = { ok: true, added: [], adopted: [], removed: [], artwork: [], missing: {} };
  if (!steam()?.Apps) return { ...result, ok: false, error: "Not running inside Steam" };
  const plan = await steamPlan(paths, add);
  result.missing = plan.missing ?? {};
  if (!plan.enabled && add) return { ...result, ok: false, error: "Adding games to Steam is switched off in Settings" };

  const reported: Record<string, { appid: number; name: string }> = {};
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
      if (!adopted && plan.collections && item.collection) await addToCollection(item.collection, appid);
      if (plan.artwork && (await addArtwork(appid, item.name).catch(() => false))) result.artwork.push(item.name);
    } catch (error) {
      result.ok = false;
      result.error = String(error);
    }
  }

  for (const item of bare) {
    if (await addArtwork(item.appid!, item.name).catch(() => false)) result.artwork.push(item.name);
  }

  const removed: string[] = [];
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
