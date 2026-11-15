import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toaster } from "@decky/api";
import { Button, Dropdown, Focusable, GamepadEvent, TextField } from "@decky/ui";
import { FaCog, FaDownload } from "react-icons/fa";
import {
  browseRoms,
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
import { SOURCE_LABELS, systemLabel } from "./common";
import { childFocus, focusElement, PAD } from "./gamepad";
import StoreStyles from "./StoreStyles";
import { useChromeInsets } from "./useChromeInsets";
import { searchState } from "../state";
import RomGrid from "./RomGrid";
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
  const [results, setResults] = useState<MergedRom[]>([]);
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

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const visible = useMemo(
    () => results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [results, page],
  );

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
    },
    [results],
  );

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

  const onStoreButton = (event: GamepadEvent) => {
    if (event.detail.button === PAD.BUMPER_LEFT) turnPage(-1);
    else if (event.detail.button === PAD.BUMPER_RIGHT) turnPage(1);
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

  const selected = selectedIndex !== null ? (results[selectedIndex] ?? null) : null;
  const overlayOpen = selected !== null || showDownloads || showSettings;

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
        actionDescriptionMap={
          pageCount > 1 ? { [PAD.BUMPER_LEFT]: "Previous page", [PAD.BUMPER_RIGHT]: "Next page" } : undefined
        }
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

      <div
        ref={mainRef}
        className={`rs-main${loading && results.length === 0 ? " is-loading" : ""}${
          !loading && results.length === 0 ? " is-empty" : ""
        }`}
      >
        {loading && results.length === 0 ? (
          <div className="rs-loading">
            <div className="rs-spinner" /> Searching…
          </div>
        ) : null}

        {!loading && results.length === 0 && searched ? (
          <div className="rs-empty">
            <h2>Nothing found</h2>
            <p>
              No games matched “{query}”. Try a different title, clear the system filter, or check the source
              settings — one of the sources may be unreachable.
            </p>
          </div>
        ) : null}

        {!searched && !loading && results.length === 0 ? (
          <div className="rs-empty">
            <h2>Search the ROM indexes</h2>
            <p>
              Type a game title to search Romspedia, DumbRoms and MyAbandonware at once. Duplicate titles are
              merged, and every download lands in the matching EmuDecky ROM folder.
            </p>
          </div>
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
