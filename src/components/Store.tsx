import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toaster } from "@decky/api";
import { Button, Dropdown, Focusable, GamepadEvent, TextField } from "@decky/ui";
import { FaCog, FaDownload, FaHdd } from "react-icons/fa";
import {
  addRecent,
  browseRoms,
  getInstalled,
  InstalledGame,
  InstalledPayload,
  uninstallGame,
  getShelves,
  ShelfItem,
  ShelvesPayload,
  toggleFavorite,
  DownloadJob,
  getDownloads,
  getLibrary,
  getSettings,
  getSystemCounts,
  LibraryInfo,
  MergedRom,
  searchRoms,
  Settings,
  SourceInfo,
} from "../types";
import { formatBytes, inRegion, matchKey, REGIONS, SOURCE_LABELS, systemLabel } from "./common";
import { childFocus, focusElement, PAD } from "./gamepad";
import StoreStyles from "./StoreStyles";
import { useChromeInsets } from "./useChromeInsets";
import { searchState } from "../state";
import RomGrid from "./RomGrid";
import HomeView from "./HomeView";
import { syncWithSteam } from "../steam";
import LibraryPanel from "./LibraryPanel";
import RomDetail from "./RomDetail";
import DownloadsDrawer from "./DownloadsDrawer";
import SettingsModal from "./SettingsModal";

// One page is rendered at a time. A search fetches a few pages worth of
// results up front, so paging is instant and never hits the network again.
const PAGE_SIZE = 30;
const RESULT_LIMIT = 120;

const SORTS = [
  { value: "relevance", label: "Best match" },
  { value: "downloads", label: "Most downloaded" },
  { value: "rating", label: "Highest rated" },
  { value: "year", label: "Newest" },
  { value: "size", label: "Largest" },
  { value: "title", label: "A → Z" },
];

const Store: FC = () => {
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState("relevance");
  const [allResults, setResults] = useState<MergedRom[]>([]);
  // Header region filter ("all", "USA", "Europe", "Japan").
  const [region, setRegion] = useState("all");
  const results = useMemo(() => allResults.filter((rom) => inRegion(rom, region)), [allResults, region]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  const [systemCounts, setSystemCounts] = useState<Record<string, number>>({});
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // The open game, as an index into the results, so L1/R1 in the game panel
  // can step through them and closing it can return focus to its cover.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(0);
  const [cached, setCached] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [shelves, setShelves] = useState<ShelvesPayload>({ favorites: [], recent: [] });
  // The ROM library's games (Installed games panel and home shelf).
  const [installed, setInstalled] = useState<InstalledPayload | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryFocus, setLibraryFocus] = useState<string | null>(null);
  // Games uninstalled this session: their "In library" badge goes at once.
  const [uninstalled, setUninstalled] = useState<Set<string>>(() => new Set());
  // A shelf item waiting for its search to finish, so it can be opened.
  const pendingOpen = useRef<Pick<ShelfItem, "title" | "system"> | null>(null);

  const requestId = useRef(0);
  const showDownloadsRef = useRef(false);
  const activeRef = useRef(0);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useChromeInsets(
    settings?.chrome_top_offset ?? 0,
    settings?.chrome_bottom_offset ?? 0,
  );
  const mainRef = useRef<HTMLDivElement | null>(null);
  // What had focus before an overlay opened; it gets focus back on close.
  const returnFocus = useRef<Element | null>(null);

  const refreshDownloads = useCallback(() => {
    getDownloads()
      .then(setJobs)
      .catch(() => undefined);
  }, []);

  const refreshLibrary = useCallback(() => {
    getLibrary()
      .then(setLibrary)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => undefined);
    getShelves().then(setShelves).catch(() => undefined);
    getInstalled().then(setInstalled).catch(() => undefined);
    const loadCounts = () =>
      getSystemCounts()
        .then((counts) => {
          if (counts && Object.keys(counts).length) setSystemCounts(counts);
        })
        .catch(() => undefined);
    loadCounts();
    refreshLibrary();
    refreshDownloads();
    // Poll only while the drawer is open or something is downloading. When
    // nothing is happening the plugin keeps its hands off the Steam client.
    const timer = setInterval(() => {
      if (showDownloadsRef.current || activeRef.current > 0) refreshDownloads();
    }, 1500);
    const countsTimer = setInterval(loadCounts, 600000);
    return () => {
      clearInterval(timer);
      clearInterval(countsTimer);
    };
  }, [refreshDownloads, refreshLibrary]);

  const runSearch = useCallback(
    async (term: string, systemFilter: string, sourceFilter: string, sortBy: string) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        let payload;
        if (!term.trim() && systemFilter !== "all") {
          payload = await browseRoms(systemFilter, 200);
        } else {
          const sourceList = sourceFilter === "all" ? null : [sourceFilter];
          payload = await searchRoms(
            term.trim(),
            sourceList,
            systemFilter === "all" ? null : systemFilter,
            sortBy,
            RESULT_LIMIT,
            1,
          );
        }
        if (id !== requestId.current) return;
        const incoming = payload.results ?? [];
        // Safety net: never mix consoles, even if a source ignores the filter.
        const filtered =
          systemFilter !== "all" ? incoming.filter((rom) => rom.system === systemFilter) : incoming;
        setResults(filtered);
        setSources(payload.sources ?? []);
        setSystems(payload.systems ?? []);
        setSourceCounts(payload.source_counts ?? {});
        setErrors(payload.errors ?? {});
        setCached(!!payload.cached);
        setPage(0);
        setSearched(true);
      } catch (error) {
        if (id !== requestId.current) return;
        setResults([]);
        setErrors({ plugin: String(error) });
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [],
  );

  // Pick up a search handed over by the plugin side menu.
  useEffect(() => {
    if (searchState.version > 0) {
      setQuery(searchState.query);
      if (searchState.system && searchState.system !== "all") setSystem(searchState.system);
    }
  }, [searchState.version]);

  // Debounced search while typing. An empty query without a console filter
  // means "browse mode" - do not fire a pointless search for it.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim() && system === "all") {
      requestId.current += 1;
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    debounce.current = setTimeout(() => {
      // Drop the previous results so a filter change never shows a mix.
      setResults([]);
      runSearch(query, system, source, sort);
    }, 320);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, system, source, sort, runSearch]);

  // Games downloaded in this session count as in the library right away,
  // before the next search asks the backend again.
  const downloaded = useMemo(
    () => new Set(jobs.filter((job) => job.status === "done").map((job) => `${job.system}|${job.title}`)),
    [jobs],
  );

  // A finished download or an uninstall changes what is in the library.
  const doneCount = useMemo(() => jobs.filter((job) => job.status === "done").length, [jobs]);
  const refreshInstalled = useCallback(() => {
    getInstalled().then(setInstalled).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (doneCount) refreshInstalled();
  }, [doneCount, refreshInstalled]);

  // Fallback for loaders without backend events (index.tsx handles those):
  // downloads that finish while the store is open go to Steam from here.
  // Both paths share one queue and skip games that already have a shortcut.
  const announced = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = jobs.filter((job) => job.status === "done");
    if (announced.current === null) {
      announced.current = new Set(done.map((job) => job.id));
      return;
    }
    const fresh = done.filter((job) => !announced.current!.has(job.id));
    if (!fresh.length) return;
    fresh.forEach((job) => announced.current!.add(job.id));
    const paths = fresh.flatMap((job) => [job.path, job.extracted_to]).filter((path): path is string => Boolean(path));
    if (paths.length) syncWithSteam(paths).catch(() => undefined);
  }, [jobs]);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const visible = useMemo(
    () =>
      results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((rom) => {
        if (uninstalled.has(`${rom.system}|${matchKey(rom.title)}`)) return rom.installed ? { ...rom, installed: false } : rom;
        return !rom.installed && rom.entries.some((entry) => downloaded.has(`${rom.system}|${entry.title}`))
          ? { ...rom, installed: true }
          : rom;
      }),
    [results, page, downloaded, uninstalled],
  );

  const openLibrary = (focusId: string | null = null) => {
    remember();
    setLibraryFocus(focusId);
    setShowLibrary(true);
    refreshInstalled();
  };

  const removeGame = async (game: InstalledGame): Promise<boolean> => {
    try {
      const result = await uninstallGame(game.id);
      if (!result.ok && !result.removed) {
        toaster.toast({ title: "Could not uninstall", body: result.error ?? game.title, icon: "Error" });
        return false;
      }
      toaster.toast({
        title: result.ok ? "Uninstalled" : "Partly uninstalled",
        body: result.ok ? `${game.title} · ${formatBytes(result.freed ?? 0)} freed` : (result.error ?? game.title),
        icon: "Trash",
      });
      setUninstalled((current) => new Set(current).add(`${game.system}|${matchKey(game.title)}`));
      // Its Steam shortcut goes with it.
      syncWithSteam(null, false)
        .then((sync) => {
          if (sync.removed.length) {
            toaster.toast({ title: "Removed from your Steam library", body: sync.removed.join(", "), icon: "Steam" });
          }
        })
        .catch(() => undefined);
      setInstalled((current) =>
        current ? { ...current, games: current.games.filter((item) => item.id !== game.id) } : current,
      );
      refreshInstalled();
      return true;
    } catch (error) {
      toaster.toast({ title: "Could not uninstall", body: String(error), icon: "Error" });
      return false;
    }
  };

  const goPage = useCallback((next: number) => {
    setPage(Math.max(0, next));
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, []);

  const cardAt = (slot: number) =>
    mainRef.current?.querySelectorAll(".rs-grid .rs-card")[Math.max(0, slot)] ?? null;

  /** L1/R1 on the store: turn the page and keep focus on the same slot. */
  const turnPage = (delta: number) => {
    const next = Math.min(pageCount - 1, Math.max(0, page + delta));
    if (next === page) return;
    const cards = Array.from(mainRef.current?.querySelectorAll(".rs-grid .rs-card") ?? []);
    const slot = cards.indexOf(document.activeElement as Element);
    goPage(next);
    if (slot >= 0) {
      const count = Math.min(PAGE_SIZE, results.length - next * PAGE_SIZE);
      window.requestAnimationFrame(() => focusElement(cardAt(Math.min(slot, count - 1))));
    }
  };

  const remember = () => {
    returnFocus.current = document.activeElement;
  };

  const openGame = useCallback(
    (rom: MergedRom) => {
      returnFocus.current = document.activeElement;
      setSelectedIndex(results.indexOf(rom));
      addRecent({ title: rom.title, system: rom.system, cover: rom.cover })
        .then(setShelves)
        .catch(() => undefined);
    },
    [results],
  );

  /** A game from a home shelf: search for it, then open it when it shows up. */
  const openShelfItem = useCallback((item: Pick<ShelfItem, "title" | "system">) => {
    pendingOpen.current = item;
    setQuery(item.title);
    setSystem(item.system);
  }, []);

  useEffect(() => {
    const wanted = pendingOpen.current;
    if (!wanted || loading) return;
    if (!searched) return;
    pendingOpen.current = null;
    const key = matchKey(wanted.title);
    const index = results.findIndex(
      (rom) =>
        rom.system === wanted.system &&
        (matchKey(rom.title) === key || rom.entries.some((entry) => matchKey(entry.title) === key)),
    );
    if (index >= 0) {
      setPage(Math.floor(index / PAGE_SIZE));
      setSelectedIndex(index);
    }
  }, [results, loading, searched]);

  const isFavorite = (rom: MergedRom | null) =>
    !!rom && shelves.favorites.some((item) => item.key === `${rom.system}|${matchKey(rom.title)}`);

  const flipFavorite = (rom: MergedRom) => {
    toggleFavorite({ title: rom.title, system: rom.system, cover: rom.cover })
      .then((value) => {
        setShelves(value);
        toaster.toast({
          title: value.favorite ? "Added to favourites" : "Removed from favourites",
          body: rom.title,
          icon: "Favorite",
        });
      })
      .catch(() => undefined);
  };

  /** L1/R1 in the game panel; the grid behind it follows across pages. */
  const stepGame = (delta: number) => {
    if (selectedIndex === null) return;
    const next = selectedIndex + delta;
    if (next < 0 || next >= results.length) return;
    setSelectedIndex(next);
    const nextPage = Math.floor(next / PAGE_SIZE);
    if (nextPage !== page) goPage(nextPage);
  };

  const closeGame = () => {
    if (selectedIndex !== null) {
      // Return to the cover of the game that was open last, which is not the
      // one that opened the panel if L1/R1 moved on.
      const slot = selectedIndex % PAGE_SIZE;
      window.requestAnimationFrame(() => focusElement(cardAt(slot)));
    }
    returnFocus.current = null;
    setSelectedIndex(null);
  };

  const closeOverlay = (close: () => void) => {
    const target = returnFocus.current;
    returnFocus.current = null;
    close();
    window.requestAnimationFrame(() => focusElement(target));
  };

  const focusSearch = () => focusElement(storeRef.current?.querySelector(".rs-search-wrap input"));

  /**
   * Picking a console swaps the home screen or the grid out, taking the
   * focused element with it. Focus goes to that console's chip, so the d-pad
   * and L2/R2 keep working from a known place.
   */
  const pickConsole = useCallback((key: string) => {
    setSystem(key);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() =>
        focusElement(storeRef.current?.querySelector(".rs-chip-btn.active")),
      ),
    );
  }, []);

  /** L2/R2: the previous or next console chip. */
  const stepConsole = (delta: number) => {
    const index = Math.max(0, chips.indexOf(system));
    const next = chips[(index + delta + chips.length) % chips.length];
    if (next) pickConsole(next);
  };

  const onStoreButton = (event: GamepadEvent) => {
    const button = event.detail.button;
    if (button === PAD.BUMPER_LEFT) turnPage(-1);
    else if (button === PAD.BUMPER_RIGHT) turnPage(1);
    else if (button === PAD.TRIGGER_LEFT) stepConsole(-1);
    else if (button === PAD.TRIGGER_RIGHT) stepConsole(1);
  };

  useEffect(() => {
    showDownloadsRef.current = showDownloads;
  }, [showDownloads]);

  const activeDownloads = useMemo(
    () => jobs.filter((job) => job.status === "downloading" || job.status === "queued" || job.status === "extracting").length,
    [jobs],
  );

  useEffect(() => {
    activeRef.current = activeDownloads;
  }, [activeDownloads]);

  const sourceOptions = useMemo(() => {
    const list = sources.filter((item) => item.enabled);
    return list.length ? list : sources;
  }, [sources]);

  // Every console we know about, most games first.
  const consoleOptions = useMemo(() => {
    const keys = new Set<string>(Object.keys(systemCounts));
    systems.forEach((key) => keys.add(key));
    return Array.from(keys).sort((a, b) => (systemCounts[b] ?? 0) - (systemCounts[a] ?? 0));
  }, [systems, systemCounts]);

  // Console chips under the header: everything, then the biggest consoles.
  // The one that is selected stays in the row even if it is a small one.
  const chips = useMemo(() => {
    const top = consoleOptions.slice(0, 12);
    if (system !== "all" && !top.includes(system)) top.push(system);
    return ["all", ...top];
  }, [consoleOptions, system]);

  const consoleTiles = useMemo(
    () => consoleOptions.map((key) => ({ key, count: systemCounts[key] ?? 0 })),
    [consoleOptions, systemCounts],
  );

  const recentDownloads = useMemo(
    () => jobs.filter((job) => job.status === "done").sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0)),
    [jobs],
  );

  const home = !query.trim() && system === "all";

  const selected = selectedIndex !== null ? (results[selectedIndex] ?? null) : null;
  const overlayOpen = selected !== null || showDownloads || showSettings || showLibrary;

  return (
    <div className="rs-store" ref={storeRef}>
      <StoreStyles />
      {/* Everything behind the overlays. While one is open the d-pad cannot
          wander back here. X, Y and the bumpers work from anywhere inside. */}
      <Focusable
        className="rs-body"
        flow-children="column"
        {...childFocus(!overlayOpen)}
        onSecondaryButton={focusSearch}
        onSecondaryActionDescription="Search"
        onOptionsButton={() => {
          remember();
          setShowDownloads(true);
        }}
        onOptionsActionDescription="Downloads"
        onButtonDown={onStoreButton}
        actionDescriptionMap={{
          ...(pageCount > 1 ? { [PAD.BUMPER_LEFT]: "Previous page", [PAD.BUMPER_RIGHT]: "Next page" } : {}),
          [PAD.TRIGGER_LEFT]: "Previous console",
          [PAD.TRIGGER_RIGHT]: "Next console",
        }}
      >
      <Focusable className="rs-header" flow-children="row">
        <div className="rs-search-wrap">
          <TextField
            label=""
            value={query}
            placeholder="Games, consoles or regions…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="rs-filters">
          <Dropdown
            rgOptions={[
              { label: "All systems", data: "all" },
              ...consoleOptions.map((key) => ({
                label: `${systemLabel(key)}${systemCounts[key] ? ` (${systemCounts[key]})` : ""}`,
                data: key,
              })),
            ]}
            selectedOption={system}
            onChange={(option) => setSystem(option.data)}
            menuLabel="System"
          />
          <Dropdown
            rgOptions={[
              { label: "All regions", data: "all" },
              ...REGIONS.map((item) => ({ label: item, data: item })),
            ]}
            selectedOption={region}
            onChange={(option) => {
              setRegion(option.data);
              setPage(0);
              setSelectedIndex(null);
              if (mainRef.current) mainRef.current.scrollTop = 0;
            }}
            menuLabel="Region"
          />
          <Dropdown
            rgOptions={[
              { label: "All sources", data: "all" },
              ...sourceOptions.map((item) => ({
                label: SOURCE_LABELS[item.id] ?? item.label,
                data: item.id,
              })),
            ]}
            selectedOption={source}
            onChange={(option) => setSource(option.data)}
            menuLabel="Source"
          />
          <Dropdown
            rgOptions={SORTS.map((item) => ({ label: item.label, data: item.value }))}
            selectedOption={sort}
            onChange={(option) => setSort(option.data)}
            menuLabel="Sort by"
          />
        </div>

        <div className="rs-icon-btn-wrap">
          <Button
            className={`rs-steam-btn${showDownloads ? " active" : ""}`}
            onClick={() => {
              remember();
              setShowDownloads(true);
            }}
            onOKActionDescription="Downloads"
          >
            <FaDownload />
          </Button>
          {activeDownloads > 0 && <span className="rs-badge-count">{activeDownloads}</span>}
        </div>
        <Button className="rs-steam-btn" onClick={() => openLibrary()} onOKActionDescription="Installed games">
          <FaHdd />
        </Button>
        <Button
          className="rs-steam-btn"
          onClick={() => {
            remember();
            setShowSettings(true);
          }}
          onOKActionDescription="Settings"
        >
          <FaCog />
        </Button>
      </Focusable>

      {/* Console chips: A picks one, L2/R2 step through them from anywhere. */}
      <Focusable className="rs-chips" flow-children="row">
        {chips.map((key) => (
          <Focusable
            key={key}
            className={`rs-chip-btn${system === key ? " active" : ""}`}
            focusClassName="is-focus"
            onActivate={() => setSystem(key)}
            onClick={() => setSystem(key)}
            onOKActionDescription={key === "all" ? "All consoles" : `Only ${systemLabel(key)}`}
          >
            {key === "all" ? "All" : systemLabel(key)}
          </Focusable>
        ))}
      </Focusable>

      <div
        ref={mainRef}
        className={`rs-main${loading && results.length === 0 ? " is-loading" : ""}${
          !loading && results.length === 0 && !home ? " is-empty" : ""
        }`}
      >
        {loading && results.length === 0 ? (
          <div className="rs-loading">
            <div className="rs-spinner" /> Searching…
          </div>
        ) : null}

        {!loading && results.length === 0 && allResults.length > 0 ? (
          <div className="rs-empty">
            <h2>No {region} games here</h2>
            <p>
              {allResults.length} {allResults.length === 1 ? "game was" : "games were"} found, all from other
              regions. Pick All regions in the header to see them.
            </p>
          </div>
        ) : null}

        {!loading && allResults.length === 0 && searched ? (
          <div className="rs-empty">
            <h2>Nothing found</h2>
            {query.trim() ? (
              <p>
                No games matched “{query.trim()}”
                {system !== "all" ? ` on ${systemLabel(system)}` : ""}. Try a different title
                {system !== "all" ? ", pick All consoles" : ""}, or check the sources in Settings: one of them
                may be unreachable.
              </p>
            ) : (
              <p>
                No {systemLabel(system)} games came back from the sources. Not every site lists every console,
                and one may be unreachable right now: Settings shows how each source is doing.
              </p>
            )}
          </div>
        ) : null}

        {home && !loading && results.length === 0 ? (
          <HomeView
            consoles={consoleTiles}
            favorites={shelves.favorites}
            recent={shelves.recent}
            downloads={recentDownloads}
            installed={installed?.games ?? []}
            onConsole={pickConsole}
            onItem={openShelfItem}
            onInstalled={openLibrary}
          />
        ) : null}

        {results.length > 0 ? (
          <>
            <RomGrid items={visible} onOpen={openGame} />

            <div className="rs-bottom-space" />

            {pageCount > 1 ? (
              <Focusable className="rs-pager" flow-children="row">
                <Button className="rs-steam-btn" disabled={page <= 0} onClick={() => goPage(page - 1)}>
                  ‹ Prev
                </Button>
                <span className="rs-pager-label">
                  Page {page + 1} of {pageCount} · {results.length} titles
                </span>
                <Button
                  className="rs-steam-btn"
                  disabled={page >= pageCount - 1}
                  onClick={() => goPage(page + 1)}
                >
                  Next ›
                </Button>
              </Focusable>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="rs-footer">
        <span className="rs-count">
          {cached ? "cached · " : ""}
          {results.length} titles
          {Object.entries(sourceCounts)
            .map(([id, count]) => ` · ${SOURCE_LABELS[id] ?? id} ${count}`)
            .join("")}
        </span>
        {Object.keys(errors).length > 0 && (
          <Focusable
            className="rs-issues rs-issues-icon"
            focusClassName="is-focus"
            title={`${Object.keys(errors).length} source(s) unavailable`}
            onActivate={() => setShowIssues((value) => !value)}
            onClick={() => setShowIssues((value) => !value)}
            onOKActionDescription={showIssues ? "Hide problems" : "Show problems"}
          >
            ⚠
          </Focusable>
        )}
      </div>
      </Focusable>

      {showIssues && Object.keys(errors).length > 0 && (
        <div className="rs-issue-list">
          {Object.entries(errors).map(([id, message]) => (
            <div className="rs-issue-row" key={id}>
              <b>{SOURCE_LABELS[id] ?? id}</b>
              <span>{message}</span>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <RomDetail
          rom={selected}
          library={library}
          // A region picked in the header also picks the file to offer first.
          preferredRegion={region !== "all" ? region : (settings?.preferred_region ?? "")}
          favorite={isFavorite(selected)}
          onToggleFavorite={() => flipFavorite(selected)}
          onClose={closeGame}
          onPrev={selectedIndex! > 0 ? () => stepGame(-1) : undefined}
          onNext={selectedIndex! < results.length - 1 ? () => stepGame(1) : undefined}
          onStarted={() => {
            refreshDownloads();
            // The drawer opens over the grid; closing it lands on this game's cover.
            const slot = selectedIndex! % PAGE_SIZE;
            setSelectedIndex(null);
            returnFocus.current = null;
            window.requestAnimationFrame(() => {
              returnFocus.current = cardAt(slot);
              setShowDownloads(true);
            });
          }}
        />
      )}

      {showLibrary && (
        <LibraryPanel
          games={installed?.games ?? null}
          root={installed?.root ?? library?.root ?? ""}
          focusId={libraryFocus}
          onClose={() => closeOverlay(() => setShowLibrary(false))}
          onUninstall={removeGame}
        />
      )}

      {showDownloads && (
        <DownloadsDrawer
          jobs={jobs}
          onClose={() => closeOverlay(() => setShowDownloads(false))}
          onRefresh={refreshDownloads}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => closeOverlay(() => setShowSettings(false))}
          onSaved={(value) => {
            setSettings(value);
            refreshLibrary();
            toaster.toast({ title: "Settings saved", body: "Reloading results", icon: "Settings" });
          }}
        />
      )}
    </div>
  );
};

export default Store;
