import { FC, useEffect, useRef, useState } from "react";
import { Button, Dropdown, Focusable, TextField } from "@decky/ui";
import { useBackGuard } from "./useBackGuard";
import { focusElement } from "./gamepad";
import { CacheStats, clearCache, getCacheStats, getImageDiagnostics, ImageDiagnostics } from "../types";
import { toaster } from "@decky/api";
import {
  getLibrary,
  getSettings,
  getStatus,
  LibraryInfo,
  Settings,
  SourceInfo,
  srmStatus,
  SrmStatus,
  steamStatus,
  SteamStatus,
  updateSettings,
} from "../types";
import { runSteamRomManager, syncWithSteam, SyncResult } from "../steam";
import { systemLabel } from "./common";
import { SOURCE_LABELS } from "./common";
import { measurePerformance, PerfSample } from "./perf";
import { reloadStore } from "../state";

interface Props {
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}

const SOURCE_ORDER = ["switchroms", "nswpedia", "romspedia", "retrostic", "romsdl", "romsfun", "myabandonware"] as const;

function ago(seconds: number): string {
  const delta = Math.max(0, Date.now() / 1000 - seconds);
  if (delta < 90) return "just now";
  if (delta < 5400) return `${Math.round(delta / 60)} min ago`;
  if (delta < 129600) return `${Math.round(delta / 3600)} h ago`;
  return `${Math.round(delta / 86400)} days ago`;
}

/** One line on how a source has been doing lately. */
function SourceHealth({ info }: { info: SourceInfo | undefined }) {
  if (!info || (!info.last_ok && !info.last_error_at)) {
    return <span className="rs-health idle">Not used yet</span>;
  }
  if (info.resting_until) {
    const minutes = Math.max(1, Math.round((info.resting_until - Date.now() / 1000) / 60));
    return (
      <span className="rs-health bad" title={info.last_error ?? undefined}>
        Failed {info.failures} times in a row, skipped for {minutes} more min · {info.last_error}
      </span>
    );
  }
  if (info.failures && info.last_error_at) {
    return (
      <span className="rs-health warn" title={info.last_error ?? undefined}>
        Last try failed {ago(info.last_error_at)} · {info.last_error}
      </span>
    );
  }
  return <span className="rs-health ok">Working · last answered {ago(info.last_ok!)}</span>;
}

const SOURCE_HINTS: Record<string, string> = {
  switchroms: "Switch specific catalogue with hundreds of NSP/XCI titles and direct file links.",
  romspedia: "Server rendered search results, region specific builds, direct file links. The only source with a Switch section.",
  retrostic: "Large catalogue of classic consoles, direct zip downloads.",
  romsdl: "Same engine as Retrostic, different catalogue - useful for extra region builds.",
  nswpedia: "Switch catalogue with its own search; covers and sizes come from the result cards.",
  romsfun:
    "Big catalogue across 50+ consoles, including romhacks and fan translations (listed after the games). Each download waits out the site's 7-second countdown first.",
  myabandonware: "TypeSense backed search for older PC and console titles.",
};

/** A switch the d-pad can reach: A flips it. */
function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <Focusable
      className={`rs-switch${on ? " on" : ""}`}
      focusClassName="is-focus"
      role="switch"
      aria-checked={on}
      onActivate={() => onChange(!on)}
      onClick={() => onChange(!on)}
      onOKActionDescription={on ? "Turn off" : "Turn on"}
    >
      <span />
    </Focusable>
  );
}

const SettingsModal: FC<Props> = ({ onClose, onSaved }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [customRoot, setCustomRoot] = useState("");
  const [diagnostics, setDiagnostics] = useState<ImageDiagnostics | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [perf, setPerf] = useState<PerfSample | null>(null);
  const [perfBusy, setPerfBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [steam, setSteam] = useState<SteamStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<SyncResult | null>(null);
  const [srm, setSrm] = useState<SrmStatus | null>(null);
  const [srmAsking, setSrmAsking] = useState(false);
  const [srmError, setSrmError] = useState<string | null>(null);
  useEffect(() => {
    steamStatus().then(setSteam).catch(() => undefined);
    srmStatus().then(setSrm).catch(() => undefined);
  }, []);

  const askSrm = () => {
    setSrmAsking(true);
    setSrmError(null);
    // The safe answer has focus.
    window.requestAnimationFrame(() => focusElement(panelRef.current?.querySelector(".rs-srm-cancel")));
  };
  const cancelSrm = () => {
    setSrmAsking(false);
    window.requestAnimationFrame(() => focusElement(panelRef.current?.querySelector(".rs-srm-run")));
  };
  const runSrm = () => {
    runSteamRomManager()
      .then((result) => {
        if (!result.ok) {
          setSrmAsking(false);
          setSrmError(result.error ?? "Steam ROM Manager could not be started.");
        }
      })
      .catch((error) => setSrmError(String(error)));
  };

  const syncNow = () => {
    setSyncing(true);
    setSynced(null);
    syncWithSteam()
      .then((result) => {
        setSynced(result);
        steamStatus().then(setSteam).catch(() => undefined);
      })
      .catch((error) =>
        setSynced({ ok: false, added: [], adopted: [], removed: [], artwork: [], missing: {}, error: String(error) }),
      )
      .finally(() => setSyncing(false));
  };
  useEffect(() => {
    getStatus()
      .then((status) => setSources(status.sources ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getCacheStats()
      .then(setCache)
      .catch(() => undefined);
  }, []);
  // The Steam back button closes the settings instead of leaving the plugin.
  useBackGuard(true, onClose);

  useEffect(() => {
    getSettings().then((value) => {
      setSettings(value);
      setCustomRoot(value.roms_root ?? "");
    });
    getLibrary().then(setLibrary).catch(() => undefined);
  }, []);

  // Start on the first setting rather than on Cancel.
  const ready = settings !== null;
  useEffect(() => {
    if (!ready) return;
    window.requestAnimationFrame(() => {
      const body = panelRef.current?.querySelector(".rs-panel-body");
      focusElement(body?.querySelector("input, .rs-switch, button, [tabindex]"));
    });
  }, [ready]);

  if (!settings) {
    return (
      <div className="rs-overlay">
        <div className="rs-panel settings" role="dialog" aria-modal="true" aria-label="Settings">
          <div className="rs-panel-body">
            <div className="rs-loading">
              <div className="rs-spinner" /> Loading settings…
            </div>
          </div>
        </div>
      </div>
    );
  }

  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });

  const toggleSource = (id: string, enabled: boolean) => {
    const current = new Set(settings.enabled_sources);
    if (enabled) current.add(id);
    else current.delete(id);
    update({ enabled_sources: Array.from(current) });
  };

  const save = async () => {
    try {
      const saved = await updateSettings({ ...settings, roms_root: customRoot.trim() });
      onSaved(saved);
      toaster.toast({ title: "Settings saved", body: "ROM Store preferences updated", icon: "Settings" });
      onClose();
    } catch (error) {
      toaster.toast({ title: "Could not save settings", body: String(error), icon: "Settings" });
    }
  };

  const candidates = library?.candidates ?? [];

  return (
    <div className="rs-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      {/* Gamepad: one column from Cancel at the top to Save at the bottom.
          B cancels (useBackGuard), X saves from anywhere. */}
      <Focusable
        ref={panelRef}
        className="rs-panel settings"
        flow-children="column"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onCancelActionDescription="Cancel"
        onSecondaryButton={save}
        onSecondaryActionDescription="Save"
      >
        <div className="rs-panel-head">
          <h3>Settings</h3>
          <Button className="rs-btn ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <div className="rs-panel-body">
          <div className="rs-section-title">ROM library</div>
          <div className="rs-form-row">
            <label>EmuDecky ROM folder</label>
            <TextField
              label="EmuDecky ROM folder"
              value={customRoot}
              placeholder="/home/deck/EmuDecky/roms"
              onChange={(event) => setCustomRoot(event.target.value)}
            />
          </div>
          <div className="rs-form-row">
            <label>Detected folders</label>
            <Dropdown
              rgOptions={[
                { label: "Select a detected location…", data: "" },
                ...candidates.map((path) => ({ label: path, data: path })),
              ]}
              selectedOption=""
              onChange={(option) => {
                if (option.data) setCustomRoot(option.data);
              }}
              menuLabel="Detected folders"
            />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Games are stored in <span className="rs-path">{library?.root ?? "unknown"}</span>
              {library?.folders?.length ? ` (${library.folders.length} system folders)` : ""}.
            </div>
          </div>

          <div className="rs-section-title">Sources</div>
          {SOURCE_ORDER.map((id) => (
            <div key={id}>
              <div className="rs-form-row">
                <label>{SOURCE_LABELS[id]}</label>
                <Toggle on={settings.enabled_sources.includes(id)} onChange={(value) => toggleSource(id, value)} />
              </div>
              <div className="rs-form-row">
                <div className="rs-hint">
                  <SourceHealth info={sources.find((source) => source.id === id)} />
                  {SOURCE_HINTS[id]}
                </div>
              </div>
              {(id === "romspedia" || id === "retrostic" || id === "romsdl" || id === "switchroms" || id === "nswpedia" || id === "romsfun") && (
                <div className="rs-form-row">
                  <label>Base URL</label>
                  <TextField
                    label=""
                    value={(settings as unknown as Record<string, string>)[`${id}_base_url`] ?? ""}
                    onChange={(event) =>
                      update({ [`${id}_base_url`]: event.target.value } as unknown as Partial<Settings>)
                    }
                  />
                </div>
              )}
            </div>
          ))}

          <div className="rs-section-title">Cover art</div>
          <div className="rs-form-row">
            <label>Box art from libretro</label>
            <Toggle on={settings.libretro_boxart !== false} onChange={(value) => update({ libretro_boxart: value })} />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Real front scans from RetroArch's box-art library (libretro-thumbnails), matched by title, in each
              box's true shape. Used before the sites' own covers.
            </div>
          </div>
          <div className="rs-form-row">
            <label>Small copies for the grid</label>
            <Toggle on={settings.boxart_resize !== false} onChange={(value) => update({ boxart_resize: value })} />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              The scans are large; the grid loads 25 kB copies made by the open-source image proxy wsrv.nl. Off: the
              grid keeps the sites' covers and only the game panel shows the full scan.
            </div>
          </div>
          <div className="rs-form-row">
            <label>IGDB client ID</label>
            <TextField
              label="IGDB client ID"
              value={settings.igdb_client_id ?? ""}
              onChange={(event) => update({ igdb_client_id: event.target.value })}
              placeholder="optional"
            />
          </div>
          <div className="rs-form-row">
            <label>Use IGDB art for every game</label>
            <Toggle on={settings.igdb_replace_covers === true} onChange={(value) => update({ igdb_replace_covers: value })} />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Off: IGDB art only fills in games that have no cover, and the box scans keep each console's
              real shape. On: IGDB art everywhere, which IGDB crops to 3:4 for every console.
            </div>
          </div>
          <div className="rs-form-row">
            <label>IGDB client secret</label>
            <TextField
              label="IGDB client secret"
              value={settings.igdb_client_secret ?? ""}
              onChange={(event) => update({ igdb_client_secret: event.target.value })}
              placeholder="optional"
            />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Create a free application at twitch.tv/developers to get both values. With them the store
              replaces missing artwork with clean, high quality poster art from the IGDB database.
            </div>
          </div>

          <div className="rs-section-title">Steam overlay</div>
          <div className="rs-form-row">
            <label>Header offset</label>
            <TextField
              label="Header offset (px)"
              value={String(settings.chrome_top_offset ?? 0)}
              onChange={(event) => update({ chrome_top_offset: Number(event.target.value) || 0 })}
            />
          </div>
          <div className="rs-form-row">
            <label>Button bar offset</label>
            <TextField
              label="Button bar offset (px)"
              value={String(settings.chrome_bottom_offset ?? 0)}
              onChange={(event) => update({ chrome_bottom_offset: Number(event.target.value) || 0 })}
            />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Pixels to push the store below the Steam header bar and above the button hints. Leave at 0
              to use the values Steam reports automatically.
            </div>
          </div>

          <div className="rs-section-title">Downloads</div>
          <div className="rs-form-row">
            <label>Preferred region</label>
            <Dropdown
              rgOptions={[
                { label: "No preference", data: "" },
                { label: "USA", data: "USA" },
                { label: "Europe", data: "Europe" },
                { label: "Japan", data: "Japan" },
              ]}
              selectedOption={settings.preferred_region ?? ""}
              onChange={(option) => update({ preferred_region: option.data })}
              menuLabel="Preferred region"
            />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">The game panel offers this region's file first, as the big Download button.</div>
          </div>
          <div className="rs-form-row">
            <label>Extract .zip archives</label>
            <Toggle on={settings.extract_archives} onChange={(value) => update({ extract_archives: value })} />
          </div>
          <div className="rs-form-row">
            <label>Keep the archive too</label>
            <Toggle on={settings.keep_archive} onChange={(value) => update({ keep_archive: value })} />
          </div>
          <div className="rs-form-row">
            <label>Results per source</label>
            <TextField
              label=""
              value={String(settings.results_per_source)}
              onChange={(event) => update({ results_per_source: Number(event.target.value) || 20 })}
            />
          </div>
          <div className="rs-form-row">
            <label>Parallel downloads</label>
            <TextField
              label=""
              value={String(settings.max_concurrent)}
              onChange={(event) => update({ max_concurrent: Number(event.target.value) || 1 })}
            />
          </div>

          <div className="rs-section-title">Steam library</div>
          <div className="rs-form-row">
            <label>Add games to Steam</label>
            <Toggle on={settings.steam_shortcuts !== false} onChange={(value) => update({ steam_shortcuts: value })} />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Every downloaded game is added to your Steam library right away, and removed again when you uninstall
              it. The launch command comes from your Steam ROM Manager setup (the one EmuDeck makes), so the
              shortcut starts the game exactly like one SRM would create. No Steam restart needed.
            </div>
          </div>
          <div className="rs-form-row">
            <label>Sort into collections</label>
            <Toggle on={settings.steam_collections !== false} onChange={(value) => update({ steam_collections: value })} />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              {steam === null
                ? "Looking for Steam ROM Manager…"
                : steam.srm
                  ? `Steam ROM Manager found: ${steam.parsers} enabled ${steam.parsers === 1 ? "parser" : "parsers"}${
                      steam.consoles.length ? ` (${steam.consoles.map(systemLabel).slice(0, 8).join(", ")}${steam.consoles.length > 8 ? ", …" : ""})` : ""
                    }. ${steam.tracked} ${steam.tracked === 1 ? "game" : "games"} added by ROM Store.`
                  : "No Steam ROM Manager setup found. Run EmuDeck's Steam ROM Manager once so the consoles have parsers, then sync."}
            </div>
          </div>
          <div className="rs-form-row">
            <label>Library artwork</label>
            <Toggle on={settings.steam_artwork !== false} onChange={(value) => update({ steam_artwork: value })} />
          </div>
          <div className="rs-form-row">
            <label>SteamGridDB API key</label>
            <TextField
              label=""
              value={settings.steamgriddb_api_key ?? ""}
              placeholder="optional"
              onChange={(event) => update({ steamgriddb_api_key: event.target.value.trim() })}
            />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Like Steam ROM Manager, each game added to Steam gets a cover, wide cover, hero, logo and icon from
              SteamGridDB. That needs your own free API key (steamgriddb.com → Preferences → API). Without one,
              covers and heroes come from IGDB (no logos or icons). Art a shortcut already has is never replaced.
            </div>
          </div>
          <div className="rs-form-row">
            <label>Library check</label>
            <Button className="rs-btn ghost" disabled={syncing} onClick={syncNow}>
              {syncing ? "Syncing…" : "Sync with Steam now"}
            </Button>
          </div>
          <div className="rs-form-row">
            <label>Steam ROM Manager</label>
            {srmAsking ? (
              <Focusable className="rs-panel-actions" flow-children="row">
                <Button className="rs-btn ghost rs-srm-cancel" onClick={cancelSrm}>
                  Cancel
                </Button>
                <Button className="rs-btn danger" onClick={runSrm}>
                  Close Steam and run
                </Button>
              </Focusable>
            ) : (
              <Button className="rs-btn ghost rs-srm-run" disabled={!srm?.found} onClick={askSrm}>
                Run Steam ROM Manager…
              </Button>
            )}
          </div>
          <div className="rs-form-row">
            <div className={`rs-hint${srmAsking ? " rs-warn" : ""}`}>
              {srmAsking
                ? "Steam closes now, together with any running game. Steam ROM Manager then updates your whole library with its own titles, artwork and controller layouts, and Steam starts again (about half a minute). The games ROM Store added are handed over to it, so nothing is doubled."
                : srm === null
                  ? "Looking for Steam ROM Manager…"
                  : srm.found
                    ? `Runs your Steam ROM Manager setup itself (${srm.command}). It needs Steam closed, so Steam restarts.`
                    : "Steam ROM Manager was not found in Emulation/tools/srm or ~/Applications. Set its path below if it is elsewhere."}
              {srmError ? <span className="rs-error"> {srmError}</span> : null}
              {srm?.last && !srmAsking ? (
                <span className={srm.last.ok ? "" : "rs-error"}>
                  {" "}
                  Last run {new Date(srm.last.at * 1000).toLocaleString()}: {srm.last.ok ? "finished." : srm.last.error || "failed."}
                </span>
              ) : null}
            </div>
          </div>
          {srm?.last && !srm.last.ok && srm.log.length ? (
            <pre className="rs-diagnostics">{srm.log.join("\n")}</pre>
          ) : null}
          <div className="rs-form-row">
            <label>SRM location</label>
            <TextField
              label=""
              value={settings.srm_path ?? ""}
              placeholder="found automatically"
              onChange={(event) => update({ srm_path: event.target.value.trim() })}
            />
          </div>

          {synced ? (
            <div className="rs-form-row">
              <div className={`rs-hint${synced.ok ? "" : " rs-error"}`}>
                {synced.error
                  ? synced.error
                  : `Added ${synced.added.length}, adopted ${synced.adopted.length} existing, removed ${synced.removed.length}, artwork for ${synced.artwork.length}.`}
                {synced.warning ? ` ${synced.warning} (check the key; IGDB art was used).` : ""}
                {Object.keys(synced.missing).length
                  ? ` No parser for: ${Object.entries(synced.missing)
                      .map(([key, count]) => `${systemLabel(key)} (${count})`)
                      .join(", ")}.`
                  : ""}
              </div>
            </div>
          ) : null}

          <div className="rs-section-title">Offline cache</div>
          <div className="rs-form-row">
            <label>Keep results for</label>
            <TextField
              label="Hours"
              value={String(settings.search_cache_hours ?? 72)}
              onChange={(event) => update({ search_cache_hours: Number(event.target.value) || 72 })}
            />
          </div>
          <div className="rs-form-row">
            <label>Cached searches</label>
            <Button
              className="rs-btn ghost"
              onClick={() =>
                clearCache()
                  .then(() => getCacheStats())
                  .then(setCache)
                  .catch(() => undefined)
              }
            >
              Clear cache ({cache?.entries ?? 0})
            </Button>
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Search results are stored on the Deck, so repeating a search is instant even after a
              restart. {cache ? `${cache.entries} entries, ${Math.round((cache.bytes ?? 0) / 1024)} kB.` : ""}
            </div>
          </div>

          <div className="rs-section-title">Performance</div>
          <div className="rs-form-row">
            <label>Measure the client</label>
            <Button
              className="rs-btn ghost"
              disabled={perfBusy}
              onClick={() => {
                setPerfBusy(true);
                measurePerformance(1500)
                  .then(setPerf)
                  .catch(() => setPerf(null))
                  .finally(() => setPerfBusy(false));
              }}
            >
              {perfBusy ? "Measuring…" : "Run a sample"}
            </Button>
          </div>
          {perf ? (
            <pre className="rs-diagnostics">
{`frame time    : ${perf.frameMs} ms  (worst ${perf.worstMs} ms)
frames        : ~${perf.fps} fps
dom nodes     : ${perf.nodes}
images        : ${perf.images}
js heap       : ${perf.heapMB === null ? "unknown" : `${perf.heapMB} MB`}
search cache  : ${cache ? `${cache.entries} entries, ${Math.round(cache.bytes / 1024)} kB` : "unknown"}`}
            </pre>
          ) : null}
          <div className="rs-form-row">
            <label>Store view</label>
            <Button className="rs-btn ghost" onClick={reloadStore}>
              Reload the view
            </Button>
          </div>
          <div className="rs-hint">
            Reloading rebuilds the store UI from scratch. If a session has become sluggish, this
            recovers it without restarting Steam.
          </div>

          <div className="rs-section-title">Diagnostics</div>
          <div className="rs-form-row">
            <label>Artwork proxy</label>
            <Button
              className="rs-btn ghost"
              onClick={() =>
                getImageDiagnostics(null)
                  .then(setDiagnostics)
                  .catch(() => setDiagnostics(null))
              }
            >
              Test image pipeline
            </Button>
          </div>
          {diagnostics ? (
            <pre className="rs-diagnostics">
{`plugin folder : ${diagnostics.plugin_name}
base url      : ${diagnostics.base_url}
local url     : ${diagnostics.local_url ?? "-"}
cache folder  : ${diagnostics.cache_folder}
cached files  : ${diagnostics.cached_files.length}
error         : ${diagnostics.error ?? "none"}`}
            </pre>
          ) : null}

          <Focusable className="rs-panel-actions end" flow-children="row">
            <Button className="rs-btn ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button className="rs-btn rs-save-btn" onClick={save} onOKActionDescription="Save">
              Save
            </Button>
          </Focusable>
        </div>
      </Focusable>
    </div>
  );
};

export default SettingsModal;
