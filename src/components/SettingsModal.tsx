import { FC, useEffect, useState } from "react";
import { toaster } from "@decky/api";
import { getLibrary, getSettings, LibraryInfo, Settings, updateSettings } from "../types";
import { SOURCE_LABELS } from "./common";

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
        <div className="rs-panel settings">
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
      <div className="rs-panel settings">
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
            <input type="text" value={customRoot} onChange={(event) => setCustomRoot(event.target.value)} placeholder="/home/deck/EmuDecky/roms" />
          </div>
          <div className="rs-form-row">
            <label>Detected folders</label>
            <select
              value=""
              onChange={(event) => {
                if (event.target.value) setCustomRoot(event.target.value);
              }}
            >
              <option value="">Select a detected location…</option>
              {candidates.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
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
                    <input
                      type="text"
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

          <div className="rs-section-title">Steam overlay</div>
          <div className="rs-form-row">
            <label>Header offset</label>
            <input
              type="text"
              value={String(settings.chrome_top_offset ?? 0)}
              onChange={(event) => update({ chrome_top_offset: Number(event.target.value) || 0 })}
            />
          </div>
          <div className="rs-form-row">
            <div className="rs-hint">
              Pixels to push the store below the Steam header bar. Leave at 0 to use the height Steam
              reports automatically.
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
