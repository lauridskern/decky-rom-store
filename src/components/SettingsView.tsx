import { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button, Dropdown, Focusable, TextField } from "@decky/ui";
import { FaDownload, FaFolderOpen, FaGlobe, FaImage, FaSteam, FaWrench } from "react-icons/fa";
import { focusElement } from "./gamepad";
import {
  CacheStats,
  clearCache,
  getCacheStats,
  getImageDiagnostics,
  getLibrary,
  getSettings,
  getStatus,
  ImageDiagnostics,
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
import { formatBytes, SOURCE_LABELS, systemLabel, timeAgo } from "./common";
import { measurePerformance, PerfSample } from "./perf";
import { reloadStore } from "../state";
import { Spinner, Switch } from "./ui";

interface Props {
  /** Called with the stored settings after every save. */
  onSaved: (settings: Settings) => void;
}

const SOURCE_ORDER = ["switchroms", "nswpedia", "romspedia", "retrostic", "romsdl", "romsfun", "myabandonware"] as const;
const WITH_BASE_URL = new Set(["romspedia", "retrostic", "romsdl", "switchroms", "nswpedia", "romsfun"]);

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

type SectionKey = "library" | "sources" | "downloads" | "artwork" | "steam" | "advanced";
const SECTIONS: { key: SectionKey; label: string; icon: ReactNode; lead: string }[] = [
  { key: "library", label: "Library", icon: <FaFolderOpen />, lead: "Where your games are kept." },
  { key: "sources", label: "Sources", icon: <FaGlobe />, lead: "The catalogue sites a search asks, and how each one is doing." },
  { key: "downloads", label: "Downloads", icon: <FaDownload />, lead: "Which file is offered first and what happens to it." },
  { key: "artwork", label: "Artwork", icon: <FaImage />, lead: "Where covers come from." },
  { key: "steam", label: "Steam", icon: <FaSteam />, lead: "Downloaded games in your Steam library." },
  { key: "advanced", label: "Advanced", icon: <FaWrench />, lead: "Layout offsets, the cache and diagnostics." },
];

/** Measured download speed, for the health line. */
function speedNote(info: SourceInfo | undefined): string {
  if (!info?.speed || !info.speed_samples) return "";
  const delay = info.delay && info.delay >= 2 ? `, ${Math.round(info.delay)} s to start` : "";
  return ` · downloads at ${formatBytes(info.speed)}/s${delay} (${info.speed_samples} measured)`;
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
        Last try failed {timeAgo(info.last_error_at)} · {info.last_error}
      </span>
    );
  }
  return (
    <span className="rs-health ok">
      Working · last answered {timeAgo(info.last_ok)}
      {speedNote(info)}
    </span>
  );
}

/** A setting with a control on the right (a field, a dropdown, a button). */
const Row: FC<{ label: string; hint?: ReactNode; wide?: boolean; fit?: boolean; children?: ReactNode }> = ({
  label,
  hint,
  wide,
  fit,
  children,
}) => (
  <div className="rs-row">
    <div className="rs-row-text">
      <div className="rs-row-label">{label}</div>
      {hint ? <div className="rs-row-hint">{hint}</div> : null}
    </div>
    {/* wide: a path or a key; fit: a button or a figure, as wide as it is. */}
    {children ? <div className={`rs-row-control${wide ? " wide" : ""}${fit ? " fit" : ""}`}>{children}</div> : null}
  </div>
);

/** A switch: the whole row takes focus and A flips it. */
const ToggleRow: FC<{ label: string; hint?: ReactNode; on: boolean; onChange: (value: boolean) => void }> = ({
  label,
  hint,
  on,
  onChange,
}) => (
  <Focusable noFocusRing
    className="rs-row rs-row-toggle rs-f"
    focusClassName="is-focus"
    role="switch"
    aria-checked={on}
    onActivate={() => onChange(!on)}
    onClick={() => onChange(!on)}
    onOKActionDescription={on ? "Turn off" : "Turn on"}
  >
    <div className="rs-row-text">
      <div className="rs-row-label">{label}</div>
      {hint ? <div className="rs-row-hint">{hint}</div> : null}
    </div>
    <Switch on={on} />
  </Focusable>
);

const Note: FC<{ tone?: "warn" | "bad"; children: ReactNode }> = ({ tone, children }) => (
  <div className={`rs-note${tone ? ` ${tone}` : ""}`}>{children}</div>
);

/**
 * The Settings tab: sections on the left, the section's settings on the right.
 * Nothing to confirm - a change is stored a moment after it is made.
 *
 * Gamepad: up/down through the sections (the right side follows), right into
 * the settings; A flips a switch, opens a list or the keyboard.
 */
const SettingsView: FC<Props> = ({ onSaved }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [section, setSection] = useState<SectionKey>("library");
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [diagnostics, setDiagnostics] = useState<ImageDiagnostics | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [perf, setPerf] = useState<PerfSample | null>(null);
  const [perfBusy, setPerfBusy] = useState(false);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [steam, setSteam] = useState<SteamStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<SyncResult | null>(null);
  const [srm, setSrm] = useState<SrmStatus | null>(null);
  const [srmAsking, setSrmAsking] = useState(false);
  const [srmError, setSrmError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const viewRef = useRef<HTMLDivElement | null>(null);

  // Saving: every change lands in `latest`, and is written a moment later (and
  // when the tab is left), so typing in a field is one write, not one per key.
  const latest = useRef<Settings | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    setSaveState("saving");
    updateSettings({ ...latest.current, roms_root: (latest.current.roms_root ?? "").trim() })
      .then((stored) => {
        savedRef.current(stored);
        setSaveState("saved");
        getLibrary().then(setLibrary).catch(() => undefined);
      })
      .catch(() => setSaveState("error"));
  }, []);

  useEffect(() => flush, [flush]);

  useEffect(() => {
    getSettings()
      .then((value) => {
        latest.current = value;
        setSettings(value);
      })
      .catch(() => undefined);
    getLibrary().then(setLibrary).catch(() => undefined);
    getStatus()
      .then((status) => setSources(status.sources ?? []))
      .catch(() => undefined);
    getCacheStats().then(setCache).catch(() => undefined);
    steamStatus().then(setSteam).catch(() => undefined);
    srmStatus().then(setSrm).catch(() => undefined);
  }, []);

  // Start on the section list.
  const ready = settings !== null;
  useEffect(() => {
    if (!ready) return;
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !active.matches(".rs-tab")) return;
      focusElement(viewRef.current?.querySelector(".rs-set-nav-item.active"));
    });
  }, [ready]);

  if (!settings) {
    return (
      <div className="rs-view rs-scroll" data-view="settings">
        <div className="rs-loading">
          <Spinner /> Loading settings…
        </div>
      </div>
    );
  }

  const update = (patch: Partial<Settings>) => {
    const next = { ...(latest.current ?? settings), ...patch };
    latest.current = next;
    setSettings(next);
    dirty.current = true;
    setSaveState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  const toggleSource = (id: string, enabled: boolean) => {
    const current = new Set(settings.enabled_sources);
    if (enabled) current.add(id);
    else current.delete(id);
    update({ enabled_sources: Array.from(current) });
  };

  const askSrm = () => {
    setSrmAsking(true);
    setSrmError(null);
    // The safe answer has focus.
    window.requestAnimationFrame(() => focusElement(viewRef.current?.querySelector(".rs-srm-cancel")));
  };
  const cancelSrm = () => {
    setSrmAsking(false);
    window.requestAnimationFrame(() => focusElement(viewRef.current?.querySelector(".rs-srm-run")));
  };
  const runSrm = () => {
    flush();
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
    flush();
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

  const candidates = library?.candidates ?? [];
  const current = SECTIONS.find((item) => item.key === section)!;
  const text = (key: keyof Settings) => String((settings as unknown as Record<string, unknown>)[key] ?? "");

  let body: ReactNode = null;
  if (section === "library") {
    body = (
      <>
        <Row
          label="ROM folder"
          hint="The EmuDeck or EmuDecky roms folder. Leave it empty to have it found automatically."
          wide
        >
          <TextField
            label=""
            value={settings.roms_root ?? ""}
            placeholder="/home/deck/EmuDecky/roms"
            onChange={(event) => update({ roms_root: event.target.value })}
          />
        </Row>
        {candidates.length ? (
          <Row label="Detected folders" hint="Pick one to use it as the ROM folder." wide>
            <div className="rs-dd">
              <Dropdown
                rgOptions={[
                  { label: "Select a detected location…", data: "" },
                  ...candidates.map((path) => ({ label: path, data: path })),
                ]}
                selectedOption=""
                onChange={(option) => {
                  if (option.data) update({ roms_root: option.data });
                }}
                menuLabel="Detected folders"
              />
            </div>
          </Row>
        ) : null}
        <Note tone={library && !library.root_exists ? "warn" : undefined}>
          Games are stored in <span className="rs-path">{library?.root ?? "unknown"}</span>
          {library?.folders?.length ? ` (${library.folders.length} console folders)` : ""}
          {library && !library.root_exists ? ". That folder does not exist yet; it is made with the first download" : ""}.
        </Note>
        {(library?.storage ?? []).map((drive) => (
          <Row fit key={drive.root} label={drive.label} hint={<span className="rs-path">{drive.root}</span>}>
            <span className="rs-row-value">
              {formatBytes(drive.free)} free of {formatBytes(drive.total)}
            </span>
          </Row>
        ))}
      </>
    );
  } else if (section === "sources") {
    body = (
      <>
        {SOURCE_ORDER.map((id) => (
          <div className="rs-source" key={id}>
            <ToggleRow
              label={SOURCE_LABELS[id]}
              on={settings.enabled_sources.includes(id)}
              onChange={(value) => toggleSource(id, value)}
              hint={
                <>
                  <SourceHealth info={sources.find((item) => item.id === id)} />
                  {SOURCE_HINTS[id]}
                </>
              }
            />
            {WITH_BASE_URL.has(id) ? (
              <Row label="Address" wide>
                <TextField
                  label=""
                  value={text(`${id}_base_url` as keyof Settings)}
                  onChange={(event) => update({ [`${id}_base_url`]: event.target.value } as unknown as Partial<Settings>)}
                />
              </Row>
            ) : null}
          </div>
        ))}
      </>
    );
  } else if (section === "downloads") {
    body = (
      <>
        <Row label="Preferred region" hint="This region's file is offered first, as the big Download button.">
          <div className="rs-dd">
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
        </Row>
        <ToggleRow
          label="Extract .zip archives"
          hint="Unpack a download into its console folder once it is in."
          on={settings.extract_archives}
          onChange={(value) => update({ extract_archives: value })}
        />
        <ToggleRow
          label="Keep the archive too"
          hint="Leave the .zip next to what was unpacked from it."
          on={settings.keep_archive}
          onChange={(value) => update({ keep_archive: value })}
        />
        <Row label="Downloads at once" hint="How many files come in at the same time.">
          <TextField
            label=""
            value={String(settings.max_concurrent)}
            onChange={(event) => update({ max_concurrent: Number(event.target.value) || 1 })}
          />
        </Row>
        <Row label="Results per source" hint="How many games each site is asked for per search.">
          <TextField
            label=""
            value={String(settings.results_per_source)}
            onChange={(event) => update({ results_per_source: Number(event.target.value) || 20 })}
          />
        </Row>
      </>
    );
  } else if (section === "artwork") {
    body = (
      <>
        <ToggleRow
          label="Box art from libretro"
          hint="Real front scans from RetroArch's box-art library (libretro-thumbnails), matched by title, in each box's true shape. Used before the sites' own covers."
          on={settings.libretro_boxart !== false}
          onChange={(value) => update({ libretro_boxart: value })}
        />
        <ToggleRow
          label="Small copies for the grid"
          hint="The scans are large; the grid loads 25 kB copies made by the open-source image proxy wsrv.nl. Off: the grid keeps the sites' covers and only the game page shows the full scan."
          on={settings.boxart_resize !== false}
          onChange={(value) => update({ boxart_resize: value })}
        />
        <ToggleRow
          label="Use IGDB art for every game"
          hint="Off: IGDB art only fills in games that have no cover, and the box scans keep each console's real shape. On: IGDB art everywhere, which IGDB crops to 3:4 for every console."
          on={settings.igdb_replace_covers === true}
          onChange={(value) => update({ igdb_replace_covers: value })}
        />
        <Row label="IGDB client ID" wide>
          <TextField
            label=""
            value={settings.igdb_client_id ?? ""}
            placeholder="optional"
            onChange={(event) => update({ igdb_client_id: event.target.value })}
          />
        </Row>
        <Row
          label="IGDB client secret"
          hint="A free application at twitch.tv/developers gives both values. With them, games without a cover get poster art, ratings and screenshots from IGDB."
          wide
        >
          <TextField
            label=""
            value={settings.igdb_client_secret ?? ""}
            placeholder="optional"
            onChange={(event) => update({ igdb_client_secret: event.target.value })}
          />
        </Row>
      </>
    );
  } else if (section === "steam") {
    body = (
      <>
        <ToggleRow
          label="Add games to Steam"
          hint="Every downloaded game is added to your Steam library right away, and removed again when you uninstall it. The launch command comes from your Steam ROM Manager setup (the one EmuDeck makes). No Steam restart needed."
          on={settings.steam_shortcuts !== false}
          onChange={(value) => update({ steam_shortcuts: value })}
        />
        <ToggleRow
          label="Sort into collections"
          hint="Each game goes into its console's Steam collection."
          on={settings.steam_collections !== false}
          onChange={(value) => update({ steam_collections: value })}
        />
        <Note tone={steam && !steam.srm ? "warn" : undefined}>
          {steam === null
            ? "Looking for Steam ROM Manager…"
            : steam.srm
              ? `Steam ROM Manager found: ${steam.parsers} enabled ${steam.parsers === 1 ? "parser" : "parsers"}${
                  steam.consoles.length
                    ? ` (${steam.consoles.map(systemLabel).slice(0, 8).join(", ")}${steam.consoles.length > 8 ? ", …" : ""})`
                    : ""
                }. ${steam.tracked} ${steam.tracked === 1 ? "game" : "games"} added by ROM Store.`
              : "No Steam ROM Manager setup found. Run EmuDeck's Steam ROM Manager once so the consoles have parsers, then sync."}
        </Note>
        <ToggleRow
          label="Library artwork"
          hint="Like Steam ROM Manager, each game added to Steam gets a cover, wide cover, hero, logo and icon. Art a shortcut already has is never replaced."
          on={settings.steam_artwork !== false}
          onChange={(value) => update({ steam_artwork: value })}
        />
        <Row
          label="SteamGridDB API key"
          hint="Your own free key (steamgriddb.com → Preferences → API). Without one, covers and heroes come from IGDB, with no logos or icons."
          wide
        >
          <TextField
            label=""
            value={settings.steamgriddb_api_key ?? ""}
            placeholder="optional"
            onChange={(event) => update({ steamgriddb_api_key: event.target.value.trim() })}
          />
        </Row>
        <Row
          fit
          label="Check the library"
          hint={
            synced ? (
              <span className={synced.ok ? undefined : "rs-bad"}>
                {synced.error
                  ? synced.error
                  : `Added ${synced.added.length}, adopted ${synced.adopted.length} existing, removed ${synced.removed.length}, artwork for ${synced.artwork.length}.`}
                {synced.warning ? ` ${synced.warning} (check the key; IGDB art was used).` : ""}
                {Object.keys(synced.missing).length
                  ? ` No parser for: ${Object.entries(synced.missing)
                      .map(([key, count]) => `${systemLabel(key)} (${count})`)
                      .join(", ")}.`
                  : ""}
              </span>
            ) : (
              "Adds shortcuts for games that have none and removes those of games that are gone."
            )
          }
        >
          <Button noFocusRing className="rs-btn ghost" disabled={syncing} onClick={syncNow}>
            {syncing ? "Syncing…" : "Sync with Steam now"}
          </Button>
        </Row>
        <Row
          fit
          label="Steam ROM Manager"
          hint={
            <span className={srmAsking ? "rs-warn" : undefined}>
              {srmAsking
                ? "Steam closes now, together with any running game. Steam ROM Manager then updates your whole library with its own titles, artwork and controller layouts, and Steam starts again (about half a minute). The games ROM Store added are handed over to it, so nothing is doubled."
                : srm === null
                  ? "Looking for Steam ROM Manager…"
                  : srm.found
                    ? `Runs your Steam ROM Manager setup itself (${srm.command}). It needs Steam closed, so Steam restarts.`
                    : "Steam ROM Manager was not found in Emulation/tools/srm or ~/Applications. Set its location below if it is elsewhere."}
              {srmError ? <span className="rs-bad"> {srmError}</span> : null}
              {srm?.last && !srmAsking ? (
                <span className={srm.last.ok ? undefined : "rs-bad"}>
                  {" "}
                  Last run {new Date(srm.last.at * 1000).toLocaleString()}: {srm.last.ok ? "finished." : srm.last.error || "failed."}
                </span>
              ) : null}
            </span>
          }
        >
          {srmAsking ? (
            <Focusable noFocusRing className="rs-actions" flow-children="row">
              <Button noFocusRing className="rs-btn ghost rs-srm-cancel" onClick={cancelSrm}>
                Cancel
              </Button>
              <Button noFocusRing className="rs-btn danger" onClick={runSrm}>
                Close Steam and run
              </Button>
            </Focusable>
          ) : (
            <Button noFocusRing className="rs-btn ghost rs-srm-run" disabled={!srm?.found} onClick={askSrm}>
              Run…
            </Button>
          )}
        </Row>
        {srm?.last && !srm.last.ok && srm.log.length ? <pre className="rs-diagnostics">{srm.log.join("\n")}</pre> : null}
        <Row label="Steam ROM Manager location" hint="Only needed when it is not found by itself." wide>
          <TextField
            label=""
            value={settings.srm_path ?? ""}
            placeholder="found automatically"
            onChange={(event) => update({ srm_path: event.target.value.trim() })}
          />
        </Row>
      </>
    );
  } else {
    body = (
      <>
        <div className="rs-group">Layout</div>
        <Row label="Top offset" hint="Pixels to push the store below Steam's header bar. 0 uses what Steam reports.">
          <TextField
            label=""
            value={String(settings.chrome_top_offset ?? 0)}
            onChange={(event) => update({ chrome_top_offset: Number(event.target.value) || 0 })}
          />
        </Row>
        <Row label="Bottom offset" hint="Pixels to keep free above Steam's button bar. 0 uses what Steam reports.">
          <TextField
            label=""
            value={String(settings.chrome_bottom_offset ?? 0)}
            onChange={(event) => update({ chrome_bottom_offset: Number(event.target.value) || 0 })}
          />
        </Row>

        <div className="rs-group">Cache</div>
        <Row label="Keep search results for" hint="Hours. A repeated search is instant, even after a restart.">
          <TextField
            label=""
            value={String(settings.search_cache_hours ?? 72)}
            onChange={(event) => update({ search_cache_hours: Number(event.target.value) || 72 })}
          />
        </Row>
        <Row
          fit
          label="Stored searches"
          hint={cache ? `${cache.entries} entries, ${Math.round((cache.bytes ?? 0) / 1024)} kB on the Deck.` : undefined}
        >
          <Button noFocusRing
            className="rs-btn ghost"
            onClick={() =>
              clearCache()
                .then(() => getCacheStats())
                .then(setCache)
                .catch(() => undefined)
            }
          >
            Clear cache
          </Button>
        </Row>

        <div className="rs-group">Diagnostics</div>
        <Row fit label="Measure the client" hint="Frame time, DOM size and memory over a second and a half.">
          <Button noFocusRing
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
        </Row>
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
        <Row fit label="Artwork pipeline" hint="Checks that covers can be fetched, stored and served to the store.">
          <Button noFocusRing
            className="rs-btn ghost"
            onClick={() =>
              getImageDiagnostics(null)
                .then(setDiagnostics)
                .catch(() => setDiagnostics(null))
            }
          >
            Run the test
          </Button>
        </Row>
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
        <Row
          fit
          label="Reload the store"
          hint="Rebuilds the store from scratch. If a long session has become sluggish, this recovers it without restarting Steam."
        >
          <Button noFocusRing
            className="rs-btn ghost"
            onClick={() => {
              flush();
              reloadStore();
            }}
          >
            Reload
          </Button>
        </Row>
      </>
    );
  }

  return (
    <Focusable noFocusRing ref={viewRef} className="rs-view rs-settings" data-view="settings" flow-children="row">
      <Focusable noFocusRing className="rs-set-nav" flow-children="column">
        {SECTIONS.map((item) => {
          const pick = () => setSection(item.key);
          return (
            <Focusable noFocusRing
              key={item.key}
              className={`rs-set-nav-item rs-f${section === item.key ? " active" : ""}`}
              focusClassName="is-focus"
              // The right side follows the d-pad, as in Steam's own settings.
              onGamepadFocus={pick}
              onFocus={pick}
              onActivate={pick}
              onClick={pick}
              onOKActionDescription={item.label}
            >
              {item.icon}
              {item.label}
            </Focusable>
          );
        })}
        <div className={`rs-set-saved ${saveState}`}>
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Could not save"
                : "Changes save by themselves"}
        </div>
      </Focusable>

      <Focusable noFocusRing key={section} className="rs-set-pane" flow-children="column">
        <h1 className="rs-h1">{current.label}</h1>
        <p className="rs-set-lead">{current.lead}</p>
        {body}
      </Focusable>
    </Focusable>
  );
};

export default SettingsView;
