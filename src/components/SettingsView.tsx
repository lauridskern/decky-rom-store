import { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toaster } from "@decky/api";
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
  getSpeedTest,
  getStatus,
  ImageDiagnostics,
  LibraryInfo,
  Settings,
  SourceInfo,
  SpeedTestStatus,
  srmStatus,
  startSpeedTest,
  SrmStatus,
  steamStatus,
  SteamStatus,
  updateSettings,
} from "../types";
import { removeDuplicateShortcuts, repairSteamLibrary, runSteamRomManager, syncWithSteam, SyncResult } from "../steam";
import { configuredSources, formatBytes, SOURCE_IDS, SOURCE_LABELS, systemLabel, timeAgo } from "./common";
import { measurePerformance, PerfSample } from "./perf";
import { reloadStore } from "../state";
import { Spinner, Switch } from "./ui";

const failed = (error: unknown): SyncResult => ({
  ok: false, added: [], adopted: [], removed: [], repointed: [], duplicates: 0, stale: [], collections: [], artwork: [], missing: {},
  error: String(error),
});

/** One line for a clean-up run: what changed, or that nothing had to. */
const SteamOutcome = ({ result }: { result: SyncResult }) => {
  if (result.error) return <span className="rs-bad">{result.error}</span>;
  const parts = [
    result.duplicates ? `${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} deleted` : "",
    result.stale.length ? `${result.stale.length} shortcut${result.stale.length === 1 ? "" : "s"} of deleted games removed` : "",
    result.repointed.length ? `${result.repointed.length} game${result.repointed.length === 1 ? "" : "s"} moved to the right emulator` : "",
    result.collections.length ? `${result.collections.length} put in the right collection` : "",
    result.added.length ? `${result.added.length} added` : "",
    result.adopted.length ? `${result.adopted.length} existing adopted` : "",
    result.removed.length ? `${result.removed.length} removed` : "",
  ].filter(Boolean);
  return <span>{parts.length ? `${parts.join(", ")}.` : "Everything was already in order."}</span>;
};

interface Props {
  /** Called with the stored settings after every save. */
  onSaved: (settings: Settings) => void;
  /** Open on this section (the home screen's "Set up sources"). */
  initialSection?: SectionKey;
}

const SOURCE_HINTS: Record<string, string> = {
  switchroms: "Switch specific catalogue with hundreds of NSP/XCI titles and direct file links.",
  romspedia: "Server rendered search results, region specific builds, direct file links. The only source with a Switch section.",
  retrostic: "Large catalogue of classic consoles, direct zip downloads.",
  romsdl: "Same engine as Retrostic, different catalogue - useful for extra region builds.",
  romsfun:
    "Big catalogue across 50+ consoles, including romhacks and fan translations (listed after the games). Each download waits out the site's 7-second countdown first.",
  myabandonware: "TypeSense backed search for older PC and console titles.",
  homebrewhub: "New games made for Game Boy, GBC, GBA and NES by their authors, free to download.",
};

export type SectionKey = "library" | "sources" | "downloads" | "artwork" | "steam" | "advanced";
const SECTIONS: { key: SectionKey; label: string; icon: ReactNode; lead: string }[] = [
  { key: "library", label: "Library", icon: <FaFolderOpen />, lead: "Where your games are kept." },
  { key: "sources", label: "Sources", icon: <FaGlobe />, lead: "The sites a search asks: you enter where each one is." },
  { key: "downloads", label: "Downloads", icon: <FaDownload />, lead: "Which file is offered first and what happens to it." },
  { key: "artwork", label: "Artwork", icon: <FaImage />, lead: "Where covers come from." },
  { key: "steam", label: "Steam", icon: <FaSteam />, lead: "Downloaded games in your Steam library." },
  { key: "advanced", label: "Advanced", icon: <FaWrench />, lead: "Layout offsets, the cache and diagnostics." },
];

/** Measured download speed, for the health line. */
function speedNote(info: SourceInfo | undefined): string {
  if (info?.speed_test_error) return ` · speed test: ${info.speed_test_error}`;
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

/**
 * Every provider by measured speed, fastest first: the order the game page
 * offers their files in. A provider whose last test got no file is last.
 */
function SpeedRanking({ sources, enabled }: { sources: SourceInfo[]; enabled: string[] }) {
  const list = sources.filter((item) => enabled.includes(item.id));
  const working = list
    .filter((item) => item.speed && !item.speed_test_error)
    .sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));
  const failed = list.filter((item) => item.speed_test_error);
  const unknown = list.filter((item) => !item.speed && !item.speed_test_error);
  const top = working[0]?.speed ?? 1;
  if (!working.length && !failed.length) return null;
  return (
    <div className="rs-speeds">
      {working.map((item, index) => (
        <div className="rs-speed" key={item.id}>
          <span className="rs-speed-name">
            {index === 0 ? <span className="rs-speed-top">Fastest</span> : null}
            {SOURCE_LABELS[item.id] ?? item.label}
          </span>
          <span className="rs-speed-bar">
            <span style={{ width: `${Math.max(2, Math.round(((item.speed ?? 0) / top) * 100))}%` }} />
          </span>
          <span className="rs-speed-value">
            {formatBytes(item.speed)}/s
            {item.delay && item.delay >= 2 ? <em> · {Math.round(item.delay)} s to start</em> : null}
          </span>
        </div>
      ))}
      {failed.map((item) => (
        <div className="rs-speed failed" key={item.id} title={item.speed_test_error ?? undefined}>
          <span className="rs-speed-name">{SOURCE_LABELS[item.id] ?? item.label}</span>
          <span className="rs-speed-error">{item.speed_test_error}</span>
        </div>
      ))}
      {unknown.map((item) => (
        <div className="rs-speed unknown" key={item.id}>
          <span className="rs-speed-name">{SOURCE_LABELS[item.id] ?? item.label}</span>
          <span className="rs-speed-error">Not measured yet</span>
        </div>
      ))}
    </div>
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
const SettingsView: FC<Props> = ({ onSaved, initialSection }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [section, setSection] = useState<SectionKey>(initialSection ?? "library");
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [diagnostics, setDiagnostics] = useState<ImageDiagnostics | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [perf, setPerf] = useState<PerfSample | null>(null);
  const [perfBusy, setPerfBusy] = useState(false);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [speedTest, setSpeedTest] = useState<SpeedTestStatus | null>(null);
  const [steam, setSteam] = useState<SteamStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<SyncResult | null>(null);
  // "Remove duplicates" / "Re-add all games": both delete shortcuts, so the
  // first press asks and the second runs.
  const [steamJob, setSteamJob] = useState<"dedupe" | "repair" | null>(null);
  const [steamArmed, setSteamArmed] = useState<"dedupe" | "repair" | null>(null);
  const [steamDone, setSteamDone] = useState<{ kind: "dedupe" | "repair"; result: SyncResult } | null>(null);
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
    getSpeedTest().then(setSpeedTest).catch(() => undefined);
    steamStatus().then(setSteam).catch(() => undefined);
    srmStatus().then(setSrm).catch(() => undefined);
  }, []);

  // While a speed test runs, follow it once a second; when it is done, the
  // sources' figures are fresh, so read them again. Nothing polls otherwise.
  const testing = Boolean(speedTest?.running);
  useEffect(() => {
    if (!testing) return;
    let alive = true;
    const timer = window.setTimeout(function tick() {
      getSpeedTest()
        .then((next) => {
          if (!alive) return;
          setSpeedTest(next);
          if (!next.running) {
            getStatus()
              .then((status) => alive && setSources(status.sources ?? []))
              .catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [testing, speedTest]);

  const runSpeedTest = () => {
    startSpeedTest()
      .then((status) => {
        setSpeedTest(status);
        if (!status.running && status.error) toaster.toast({ title: "Speed test", body: status.error });
      })
      .catch(() => undefined);
  };

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
        setSynced(failed(error)),
      )
      .finally(() => setSyncing(false));
  };

  const cleanUp = (kind: "dedupe" | "repair") => {
    if (steamArmed !== kind) {
      setSteamArmed(kind);
      setSteamDone(null);
      return;
    }
    flush();
    setSteamArmed(null);
    setSteamJob(kind);
    (kind === "dedupe" ? removeDuplicateShortcuts() : repairSteamLibrary())
      .then((result) => {
        setSteamDone({ kind, result });
        steamStatus().then(setSteam).catch(() => undefined);
      })
      .catch((error) => setSteamDone({ kind, result: failed(error) }))
      .finally(() => setSteamJob(null));
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
    const current = speedTest?.current ? (SOURCE_LABELS[speedTest.current] ?? speedTest.current) : null;
    const done = Object.keys(speedTest?.results ?? {}).length;
    const total = done + (speedTest?.pending?.length ?? 0);
    // Switched on and given an address: only these are asked and measured.
    const configured = configuredSources(settings as unknown as Record<string, unknown>);
    body = (
      <>
        <div className="rs-group">Sources</div>
        <Note>
          ROM Store comes without any site addresses. It knows how to read each site below, not where to find it:
          look up the address of a site you want to use and enter it under its name.
        </Note>
        {SOURCE_IDS.map((id) => {
          const address = text(`${id}_base_url` as keyof Settings).trim();
          return (
            <div className="rs-source" key={id}>
              <ToggleRow
                label={SOURCE_LABELS[id]}
                on={settings.enabled_sources.includes(id)}
                onChange={(value) => toggleSource(id, value)}
                hint={
                  <>
                    {address ? (
                      <SourceHealth info={sources.find((item) => item.id === id)} />
                    ) : (
                      <span className="rs-health idle">No address yet</span>
                    )}
                    {SOURCE_HINTS[id]}
                  </>
                }
              />
              <Row label="Address" wide>
                <TextField
                  label=""
                  placeholder={`Where ${SOURCE_LABELS[id]} is, e.g. https://…`}
                  value={text(`${id}_base_url` as keyof Settings)}
                  onChange={(event) => update({ [`${id}_base_url`]: event.target.value } as unknown as Partial<Settings>)}
                />
              </Row>
            </div>
          );
        })}
        {configured.length ? (
          <>
        <div className="rs-group">Speed</div>
        <Row
          label="Provider speed"
          hint={
            testing
              ? `Testing ${current ?? "…"} (${Math.min(done + 1, total)} of ${total})`
              : `Reads a few seconds of a real download from every provider, one after the other; nothing is saved. Every game page offers the fastest provider's file first${
                  speedTest?.last_tested ? `. Last test ${timeAgo(speedTest.last_tested)}` : ""
                }.`
          }
          fit
        >
          <Button noFocusRing className="rs-btn ghost" disabled={testing} onClick={runSpeedTest}>
            {testing ? (
              <>
                <Spinner /> Testing…
              </>
            ) : (
              "Test all now"
            )}
          </Button>
        </Row>
        <SpeedRanking sources={sources} enabled={configured} />
        <ToggleRow
          label="Test again every week"
          hint="By itself, a couple of minutes after the store starts, when nothing is downloading."
          on={settings.speed_test_auto !== false}
          onChange={(value) => update({ speed_test_auto: value })}
        />
          </>
        ) : null}
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
          hint="The scans are large; the grid loads 25 kB copies made by the open-source image proxy wsrv.nl, which also fetches GameTDB's covers (GameTDB stops answering after many direct requests). Off: the grid keeps the sites' covers and only the game page shows the full scan."
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
          hint="Optional: your own free key (steamgriddb.com → Preferences → API). Empty uses the key built into the store. SteamGridDB gives Steam library art and covers for games no box-art library has."
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
                  : `Added ${synced.added.length}, adopted ${synced.adopted.length} existing, removed ${synced.removed.length}${synced.repointed.length ? `, moved ${synced.repointed.length} to another emulator` : ""}${synced.collections.length ? `, ${synced.collections.length} put in the right collection` : ""}, artwork for ${synced.artwork.length}.`}
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
          label="Remove duplicates"
          hint={
            steamArmed === "dedupe" ? (
              <span className="rs-warn">
                Every game keeps one shortcut (the most played, else the one ROM Store made) and its other shortcuts are
                deleted, Steam ROM Manager's included. Press again to go ahead.
              </span>
            ) : steamDone?.kind === "dedupe" ? (
              <SteamOutcome result={steamDone.result} />
            ) : (
              "Deletes extra Steam shortcuts that start the same game, for example one from Steam ROM Manager and one from ROM Store."
            )
          }
        >
          <Button noFocusRing className="rs-btn ghost" disabled={!!steamJob || syncing} onClick={() => cleanUp("dedupe")}>
            {steamJob === "dedupe" ? "Removing…" : steamArmed === "dedupe" ? "Remove them" : "Remove duplicates"}
          </Button>
        </Row>
        <Row
          fit
          label="Re-add all games"
          hint={
            steamArmed === "repair" ? (
              <span className="rs-warn">
                Duplicates and shortcuts of games that are no longer on the Deck are deleted, every game is pointed at the
                emulator chosen in Steam ROM Manager (or Emu Hub), and missing games are added. Shortcuts are corrected in
                place, so play time, artwork and collections stay. Press again to go ahead.
              </span>
            ) : steamDone?.kind === "repair" ? (
              <SteamOutcome result={steamDone.result} />
            ) : (
              "Puts every game in your library into Steam once, cleanly, with the right emulator."
            )
          }
        >
          <Button noFocusRing className="rs-btn ghost" disabled={!!steamJob || syncing} onClick={() => cleanUp("repair")}>
            {steamJob === "repair" ? "Working…" : steamArmed === "repair" ? "Re-add them" : "Re-add all games"}
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
