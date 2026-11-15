import { FC, useEffect, useState } from "react";
import { Dropdown, TextField } from "@decky/ui";
import { useBackGuard } from "./useBackGuard";
import { CacheStats, clearCache, getCacheStats, getImageDiagnostics, ImageDiagnostics } from "../types";
import { toaster } from "@decky/api";
import { getLibrary, getSettings, LibraryInfo, Settings, updateSettings } from "../types";
import { SOURCE_LABELS } from "./common";
import { measurePerformance, PerfSample } from "./perf";
import { reloadStore } from "../state";

interface Props {
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}

const SOURCE_ORDER = ["switchroms", "romspedia", "retrostic", "romsdl", "dumbroms", "myabandonware"] as const;

const SOURCE_HINTS: Record<string, string> = {
  switchroms: "Switch specific catalogue with hundreds of NSP/XCI titles and direct file links.",
  romspedia: "Server rendered search results, region specific builds, direct file links. The only source with a Switch section.",
  retrostic: "Large catalogue of classic consoles, direct zip downloads.",
  romsdl: "Same engine as Retrostic, different catalogue - useful for extra region builds.",
  dumbroms: "Point this at the DumbRoms address you want to use (the domain below is the default).",
  myabandonware: "TypeSense backed search for older PC and console titles.",
};

function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className={`rs-switch${on ? " on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span />
    </div>
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
      <div className="rs-panel settings" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="rs-panel-head">
          <h3>Settings</h3>
          <button className="rs-btn ghost" onClick={onClose}>
            Cancel
          </button>
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
                <div className="rs-hint">{SOURCE_HINTS[id]}</div>
              </div>
              {(id === "romspedia" || id === "retrostic" || id === "romsdl" || id === "switchroms") && (
                <div className="rs-form-row">
                  <label>Base URL</label>
                  <input
                    type="text"
                    value={(settings as unknown as Record<string, string>)[`${id}_base_url`] ?? ""}
                    onChange={(event) =>
                      update({ [`${id}_base_url`]: event.target.value } as unknown as Partial<Settings>)
                    }
                  />
                </div>
              )}
              {id === "dumbroms" && (
                <>
                  <div className="rs-form-row">
                    <label>Base URL</label>
                    <input
                      type="text"
                      value={settings.dumbroms_base_url}
                      onChange={(event) => update({ dumbroms_base_url: event.target.value })}
                    />
                  </div>
                  <div className="rs-form-row">
                    <label>Search URL</label>
                    <TextField
                      label="DumbRoms search URL"
                      value={settings.dumbroms_search_url}
                      onChange={(event) => update({ dumbroms_search_url: event.target.value })}
                    />
                  </div>
                  <div className="rs-form-row">
                    <div className="rs-hint">
                      Use <span className="rs-path">{"{base}"}</span> for the base address and{" "}
                      <span className="rs-path">{"{query}"}</span> for the search term.
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}

          <div className="rs-section-title">Cover art</div>
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
            <label>Replace all artwork</label>
            <Toggle on={settings.igdb_replace_covers !== false} onChange={(value) => update({ igdb_replace_covers: value })} />
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
            <label>Extract .zip archives</label>
            <Toggle on={settings.extract_archives} onChange={(value) => update({ extract_archives: value })} />
          </div>
          <div className="rs-form-row">
            <label>Keep the archive too</label>
            <Toggle on={settings.keep_archive} onChange={(value) => update({ keep_archive: value })} />
          </div>
          <div className="rs-form-row">
            <label>Results per source</label>
            <input
              type="text"
              value={String(settings.results_per_source)}
              onChange={(event) => update({ results_per_source: Number(event.target.value) || 20 })}
            />
          </div>
          <div className="rs-form-row">
            <label>Parallel downloads</label>
            <input
              type="text"
              value={String(settings.max_concurrent)}
              onChange={(event) => update({ max_concurrent: Number(event.target.value) || 1 })}
            />
          </div>

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
            <button
              className="rs-btn ghost"
              onClick={() =>
                clearCache()
                  .then(() => getCacheStats())
                  .then(setCache)
                  .catch(() => undefined)
              }
            >
              Clear cache ({cache?.entries ?? 0})
            </button>
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
            <button
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
            </button>
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
            <button className="rs-btn ghost" onClick={reloadStore}>
              Reload the view
            </button>
          </div>
          <div className="rs-hint">
            Reloading rebuilds the store UI from scratch. If a session has become sluggish, this
            recovers it without restarting Steam.
          </div>

          <div className="rs-section-title">Diagnostics</div>
          <div className="rs-form-row">
            <label>Artwork proxy</label>
            <button
              className="rs-btn ghost"
              onClick={() =>
                getImageDiagnostics(null)
                  .then(setDiagnostics)
                  .catch(() => setDiagnostics(null))
              }
            >
              Test image pipeline
            </button>
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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
            <button className="rs-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="rs-btn" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
