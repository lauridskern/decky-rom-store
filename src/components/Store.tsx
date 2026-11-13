import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toaster } from "@decky/api";
import { FaCog, FaDownload, FaSearch } from "react-icons/fa";
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
import { searchState } from "../state";
import RomCard from "./RomCard";
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
  const [showBrowse, setShowBrowse] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);

  const requestId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    getSystemCounts()
      .then(setSystemCounts)
      .catch(() => undefined);
    refreshLibrary();
    refreshDownloads();
    const timer = setInterval(refreshDownloads, 900);
    return () => clearInterval(timer);
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
          payload = await browseRoms(systemFilter, 60);
        } else {
          const sourceList = sourceFilter === "all" ? null : [sourceFilter];
          payload = await searchRoms(
            term.trim(),
            sourceList,
            systemFilter === "all" ? null : systemFilter,
            sortBy,
            60,
            pageNumber,
          );
        }
        if (id !== requestId.current) return;
        setResults((previous) => (append ? [...previous, ...(payload.results ?? [])] : payload.results ?? []));
        setSources(payload.sources ?? []);
        setSystems(payload.systems ?? []);
        setSourceCounts(payload.source_counts ?? {});
        setErrors(payload.errors ?? {});
        setHasMore(!!payload.has_more);
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

  // Debounced search while typing.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
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

  const browse = (target: string) => {
    setShowBrowse(false);
    setQuery("");
    setSystem(target);
    setPage(1);
    requestId.current += 1;
    setResults([]);
    runSearch("", target, "all", sort, 1, false);
  };

  const activeDownloads = useMemo(
    () => jobs.filter((job) => job.status === "downloading" || job.status === "queued" || job.status === "extracting").length,
    [jobs],
  );

  const sourceOptions = useMemo(() => {
    const list = sources.filter((item) => item.enabled);
    return list.length ? list : sources;
  }, [sources]);

  const browseSystems = useMemo(() => {
    const keys = new Set<string>(Object.keys(systemCounts));
    systems.forEach((key) => keys.add(key));
    return Array.from(keys).sort((a, b) => (systemCounts[b] ?? 0) - (systemCounts[a] ?? 0));
  }, [systems, systemCounts]);

  return (
    <div className="rs-store">
      <div className="rs-header">
        <div className="rs-brand">
          ROM Store <small>EmuDecky library</small>
        </div>

        <div className="rs-search-wrap">
          <span className="rs-search-icon">
            <FaSearch />
          </span>
          <input
            type="text"
            value={query}
            placeholder="Search games, consoles or regions…"
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </div>

        <select value={system} onChange={(event) => setSystem(event.target.value)}>
          <option value="all">All systems</option>
          {systems.map((key) => (
            <option key={key} value={key}>
              {systemLabel(key)}
              {systemCounts[key] ? ` (${systemCounts[key]})` : ""}
            </option>
          ))}
        </select>

        <select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="all">All sources</option>
          {sourceOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {SOURCE_LABELS[item.id] ?? item.label}
            </option>
          ))}
        </select>

        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          {SORTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        <button className="rs-icon-btn" onClick={() => setShowBrowse(true)} title="Browse by console">
          ☰
        </button>
        <button
          className={`rs-icon-btn${showDownloads ? " active" : ""}`}
          onClick={() => setShowDownloads(true)}
          title="Downloads"
        >
          <FaDownload />
          {activeDownloads > 0 && <span className="rs-badge-count">{activeDownloads}</span>}
        </button>
        <button className="rs-icon-btn" onClick={() => setShowSettings(true)} title="Settings">
          <FaCog />
        </button>
      </div>

      <div className="rs-main">
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

        {!searched && results.length === 0 ? (
          <div className="rs-empty">
            <h2>Search the ROM indexes</h2>
            <p>
              Type a game title to search Romspedia, DumbRoms and MyAbandonware at once. Duplicate titles are
              merged, and every download lands in the matching EmuDecky ROM folder.
            </p>
            <button className="rs-btn" onClick={() => setShowBrowse(true)}>
              Browse by console
            </button>
          </div>
        ) : null}

        <div className="rs-grid">
          {results.map((rom) => (
            <RomCard key={`${rom.id}-${page}`} rom={rom} onOpen={setSelected} />
          ))}
        </div>

        {hasMore ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "20px 0 6px" }}>
            <button className="rs-btn ghost" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="rs-footer">
        <span>{results.length} titles</span>
        {Object.entries(sourceCounts).map(([id, count]) => (
          <span key={id}>
            {SOURCE_LABELS[id] ?? id}: {count}
          </span>
        ))}
        <span className="rs-path">{settings?.roms_root || library?.root || ""}</span>
        {Object.entries(errors).map(([id, message]) => (
          <span key={id} className="rs-error">
            {SOURCE_LABELS[id] ?? id}: {message}
          </span>
        ))}
      </div>

      {showBrowse && (
        <div className="rs-overlay" onClick={(event) => event.target === event.currentTarget && setShowBrowse(false)}>
          <div className="rs-panel detail">
            <div className="rs-panel-head">
              <h3>Browse by console</h3>
              <button className="rs-btn ghost" onClick={() => setShowBrowse(false)}>
                Close
              </button>
            </div>
            <div className="rs-panel-body">
              <div className="rs-browse-grid">
                {browseSystems.map((key) => (
                  <button key={key} className="rs-browse-tile" onClick={() => browse(key)}>
                    <span className="rs-browse-name">{systemLabel(key)}</span>
                    <span className="rs-browse-count">{systemCounts[key] ?? "—"}</span>
                  </button>
                ))}
              </div>
              {!browseSystems.length && (
                <div className="rs-hint">Console list unavailable — the source could not be reached.</div>
              )}
            </div>
          </div>
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
