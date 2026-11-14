import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toaster } from "@decky/api";
import { Button, Dropdown, TextField } from "@decky/ui";
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
import StoreStyles from "./StoreStyles";
import { useChromeInsets } from "./useChromeInsets";
import { searchState } from "../state";
import RomCard from "./RomCard";
import VirtualGrid from "./VirtualGrid";
import RomDetail from "./RomDetail";
import DownloadsDrawer from "./DownloadsDrawer";
import SettingsModal from "./SettingsModal";

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<MergedRom | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [cached, setCached] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const requestId = useRef(0);
  const showDownloadsRef = useRef(false);
  const activeRef = useRef(0);

  const renderCard = useCallback(
    (rom: MergedRom, _index: number, rowIndex: number) => (
      <RomCard key={`${rom.id}-${page}`} rom={rom} onOpen={setSelected} rowIndex={rowIndex} />
    ),
    [page, setSelected],
  );
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useChromeInsets(
    settings?.chrome_top_offset ?? 0,
    settings?.chrome_bottom_offset ?? 0,
  );
  const mainRef = useRef<HTMLDivElement | null>(null);

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
    // Poll fast only while something is actually downloading, otherwise stay
    // out of the Steam client's way.
    const timer = setInterval(() => {
      if (showDownloadsRef.current || activeRef.current > 0) refreshDownloads();
    }, 1200);
    const slowTimer = setInterval(refreshDownloads, 5000);
    const countsTimer = setInterval(loadCounts, 600000);
    return () => {
      clearInterval(timer);
      clearInterval(slowTimer);
      clearInterval(countsTimer);
    };
  }, [refreshDownloads, refreshLibrary]);

  const runSearch = useCallback(
    async (
      term: string,
      systemFilter: string,
      sourceFilter: string,
      sortBy: string,
      pageNumber: number,
      append: boolean,
    ) => {
      const id = ++requestId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
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
            40,
            pageNumber,
          );
        }
        if (id !== requestId.current) return;
        const incoming = payload.results ?? [];
        // Safety net: never mix consoles, even if a source ignores the filter.
        const filtered =
          systemFilter !== "all" ? incoming.filter((rom) => rom.system === systemFilter) : incoming;
        setResults((previous) => (append ? [...previous, ...filtered] : filtered));
        setSources(payload.sources ?? []);
        setSystems(payload.systems ?? []);
        setSourceCounts(payload.source_counts ?? {});
        setErrors(payload.errors ?? {});
        setHasMore(!!payload.has_more);
        setCached(!!payload.cached);
        setPage(payload.page ?? 1);
        setSearched(true);
      } catch (error) {
        if (id !== requestId.current) return;
        if (!append) setResults([]);
        setErrors({ plugin: String(error) });
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
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
      runSearch(query, system, source, sort, 1, false);
    }, 320);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, system, source, sort, runSearch]);

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    runSearch(query, system, source, sort, page + 1, true);
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

  return (
    <div className="rs-store" ref={storeRef}>
      <StoreStyles />
      <div className="rs-header">
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
            onClick={() => setShowDownloads(true)}
          >
            <FaDownload />
          </Button>
          {activeDownloads > 0 && <span className="rs-badge-count">{activeDownloads}</span>}
        </div>
        <Button className="rs-steam-btn" onClick={() => setShowSettings(true)}>
          <FaCog />
        </Button>
      </div>

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
            <VirtualGrid
              items={results}
              scrollRef={mainRef}
              renderItem={renderCard}
            />

            <div className="rs-bottom-space" />

            {hasMore ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "20px 0 6px" }}>
                <button className="rs-btn ghost" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="rs-footer">
        <span className="rs-foot-hint">
          <b>D-pad</b> browse · <b>A</b> open · <b>B</b> back
        </span>
        <span className="rs-count">
          {cached ? "cached · " : ""}
          {results.length} titles
          {Object.entries(sourceCounts)
            .map(([id, count]) => ` · ${SOURCE_LABELS[id] ?? id} ${count}`)
            .join("")}
        </span>
        {Object.keys(errors).length > 0 && (
          <button
            className="rs-issues rs-issues-icon"
            title={`${Object.keys(errors).length} source(s) unavailable`}
            onClick={() => setShowIssues((value) => !value)}
          >
            ⚠
          </button>
        )}
      </div>

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
          onClose={() => setSelected(null)}
          onStarted={() => {
            refreshDownloads();
            setShowDownloads(true);
            setSelected(null);
          }}
        />
      )}

      {showDownloads && (
        <DownloadsDrawer jobs={jobs} onClose={() => setShowDownloads(false)} onRefresh={refreshDownloads} />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
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
