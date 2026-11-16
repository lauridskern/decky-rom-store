import { FC, forwardRef, ReactNode, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toaster } from "@decky/api";
import { Dropdown, Focusable, focusRingClasses, GamepadEvent, TextField } from "@decky/ui";
import { FaCheck, FaExclamationTriangle, FaGamepad, FaSearch, FaStar } from "react-icons/fa";
import {
  addRecent,
  browseRoms,
  getInstalled,
  InstalledGame,
  InstalledPayload,
  uninstallGame,
  getShelves,
  ShelfItem,
  ConsoleInfo,
  ShelvesPayload,
  toggleFavorite,
  DownloadJob,
  getDownloads,
  getLibrary,
  getSettings,
  getConsoles,
  LibraryInfo,
  MergedRom,
  searchRoms,
  Settings,
  SourceInfo,
} from "../types";
import { formatBytes, inRegion, matchKey, REGIONS, shelfKey, SOURCE_LABELS, systemAspect, systemLabel } from "./common";
import { childFocus, focusElement, PAD } from "./gamepad";
import StoreStyles from "./StoreStyles";
import { useChromeInsets } from "./useChromeInsets";
import { useBackGuard } from "./useBackGuard";
import { searchState } from "../state";
import RomGrid from "./RomGrid";
import HomeView from "./HomeView";
import { syncWithSteam } from "../steam";
import LibraryView from "./LibraryView";
import GamePage from "./GamePage";
import DownloadsView from "./DownloadsView";
import SettingsView from "./SettingsView";
import { EmptyState, Glyph } from "./ui";

// The first thing on the home screen that takes focus.
const HOME_FIRST = ".rs-home .rs-shelf-tile, .rs-home .rs-console";

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

/** The four screens. L1/R1 step through them from anywhere. */
type Tab = "store" | "library" | "downloads" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "store", label: "Store" },
  { key: "library", label: "Library" },
  { key: "downloads", label: "Downloads" },
  { key: "settings", label: "Settings" },
];

/** A game opened from a shelf: shown at once, its links are looked up after. */
interface Solo {
  item: Pick<ShelfItem, "title" | "system" | "cover">;
  rom: MergedRom | null;
  missing: boolean;
}

const isActive = (job: DownloadJob) =>
  job.status === "downloading" || job.status === "queued" || job.status === "extracting";

/** Titles as the sites tag them ("Game (USA) (Rev 1)") search badly; drop the tags. */
const bareTitle = (title: string) => title.replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s+/g, " ").trim() || title;

interface StripHandle {
  show: (rom: MergedRom | null) => void;
}

/**
 * The line under the grid: the title of the cover that has focus. The covers
 * carry no text, so this is how a game is read without opening it. It keeps
 * its own state: moving focus re-renders this line, not the store.
 */
const InfoStrip = forwardRef<StripHandle, { summary: ReactNode; children?: ReactNode }>(({ summary, children }, ref) => {
  const [rom, setRom] = useState<MergedRom | null>(null);
  useImperativeHandle(ref, () => ({ show: (next) => setRom((current) => (current === next ? current : next)) }), []);
  const meta = rom
    ? ([
        systemLabel(rom.system),
        rom.year ? String(rom.year) : null,
        rom.size ? formatBytes(rom.size) : null,
        rom.regions.length ? rom.regions.join(" · ") : null,
      ].filter(Boolean) as string[])
    : [];
  return (
    <div className="rs-strip">
      {rom ? (
        <>
          <span className="rs-strip-title">{rom.title}</span>
          <span className="rs-strip-meta">
            {meta.map((part) => (
              <span key={part}>{part}</span>
            ))}
            {rom.rating ? (
              <span className="rs-strip-rating">
                <FaStar /> {rom.rating.toFixed(1)}
              </span>
            ) : null}
            {rom.installed ? (
              <span className="rs-strip-owned">
                <FaCheck /> In library
              </span>
            ) : null}
          </span>
        </>
      ) : (
        <span className="rs-strip-summary">{summary}</span>
      )}
      <span className="rs-strip-right">{children}</span>
    </div>
  );
});
InfoStrip.displayName = "InfoStrip";

const Store: FC = () => {
  const [tab, setTab] = useState<Tab>("store");
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState("relevance");
  const [allResults, setResults] = useState<MergedRom[]>([]);
  // Region filter ("all", "USA", "Europe", "Japan").
  const [region, setRegion] = useState("all");
  const results = useMemo(() => allResults.filter((rom) => inRegion(rom, region)), [allResults, region]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [consoles, setConsoles] = useState<ConsoleInfo[]>([]);

  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // The open game, as an index into the results, so L1/R1 on the game page
  // can step through them and closing it can return focus to its cover.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [solo, setSolo] = useState<Solo | null>(null);
  const [page, setPage] = useState(0);
  const [cached, setCached] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [shelves, setShelves] = useState<ShelvesPayload>({ favorites: [], recent: [] });
  // The ROM library's games (Library tab and the home shelf).
  const [installed, setInstalled] = useState<InstalledPayload | null>(null);
  const [libraryFocus, setLibraryFocus] = useState<string | null>(null);
  // Games uninstalled this session: their "In library" badge goes at once.
  const [uninstalled, setUninstalled] = useState<Set<string>>(() => new Set());

  const requestId = useRef(0);
  const soloToken = useRef(0);
  const tabRef = useRef<Tab>("store");
  const activeRef = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useChromeInsets(settings?.chrome_top_offset ?? 0, settings?.chrome_bottom_offset ?? 0);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<StripHandle | null>(null);
  // What had focus before the game page opened; it gets focus back on close.
  const returnFocus = useRef<Element | null>(null);
  // Where focus was in the Store tab, for coming back to it from another tab.
  const storeFocus = useRef<Element | null>(null);
  // Set when a console was picked: focus goes to the first cover once it is there.
  const wantGrid = useRef(false);

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

  const refreshInstalled = useCallback(() => {
    getInstalled().then(setInstalled).catch(() => undefined);
  }, []);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => undefined);
    getShelves().then(setShelves).catch(() => undefined);
    refreshInstalled();
    const loadCounts = () =>
      getConsoles()
        .then((list) => {
          if (list && list.length) setConsoles(list);
        })
        .catch(() => undefined);
    loadCounts();
    refreshLibrary();
    refreshDownloads();
    // Poll only while the Downloads tab is open or something is downloading.
    // When nothing is happening the plugin keeps its hands off the Steam client.
    const timer = setInterval(() => {
      if (tabRef.current === "downloads" || activeRef.current > 0) refreshDownloads();
    }, 1500);
    const countsTimer = setInterval(loadCounts, 600000);
    return () => {
      clearInterval(timer);
      clearInterval(countsTimer);
    };
  }, [refreshDownloads, refreshLibrary, refreshInstalled]);

  // Steam draws its own focus ring around whatever has focus, on top of ours
  // and without our rounded corners. Our Focusables and Buttons say
  // noFocusRing; Steam's Dropdown and TextField cannot, so while focus is in
  // the store the ring is hidden (it is back as soon as focus leaves, in the
  // Quick Access menu for example).
  useEffect(() => {
    const ring = (focusRingClasses as Record<string, string> | undefined)?.FocusRing;
    if (!ring || typeof document === "undefined") return;
    const root = document.documentElement;
    const style = document.createElement("style");
    style.textContent = `html.rs-no-ring .${CSS.escape(ring)} { opacity: 0 !important; }`;
    document.head.appendChild(style);
    const update = (event: FocusEvent) =>
      root.classList.toggle("rs-no-ring", Boolean(storeRef.current?.contains(event.target as Node)));
    document.addEventListener("focusin", update);
    if (storeRef.current?.contains(document.activeElement)) root.classList.add("rs-no-ring");
    return () => {
      document.removeEventListener("focusin", update);
      root.classList.remove("rs-no-ring");
      style.remove();
    };
  }, []);

  // The store opens on the home screen's first tile. The shelves and the
  // consoles arrive a moment after the store, so this waits for them, and it
  // never takes focus the player has already moved somewhere.
  const homeFilled = consoles.length > 0 || shelves.recent.length > 0 || shelves.favorites.length > 0;
  useEffect(() => {
    if (!homeFilled) return;
    window.requestAnimationFrame(() => {
      const root = storeRef.current;
      if (root && !root.contains(document.activeElement)) focusElement(root.querySelector(HOME_FIRST));
    });
  }, [homeFilled]);

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
      tabRef.current = "store";
      setTab("store");
      setQuery(searchState.query);
      if (searchState.system && searchState.system !== "all") setSystem(searchState.system);
    }
  }, [searchState.version]);

  // Debounced search while typing. An empty query without a console filter
  // is the home screen - do not fire a pointless search for it.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim() && system === "all") {
      requestId.current += 1;
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    // Drop the previous results at once so a filter change never shows a mix,
    // and ignore an answer that is still on its way for the old filters.
    requestId.current += 1;
    setResults([]);
    setLoading(true);
    debounce.current = setTimeout(() => runSearch(query, system, source, sort), 320);
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
        if (uninstalled.has(shelfKey(rom.system, rom.title))) return rom.installed ? { ...rom, installed: false } : rom;
        return !rom.installed && rom.entries.some((entry) => downloaded.has(`${rom.system}|${entry.title}`))
          ? { ...rom, installed: true }
          : rom;
      }),
    [results, page, downloaded, uninstalled],
  );

  const favoriteKeys = useMemo(() => new Set(shelves.favorites.map((item) => item.key)), [shelves.favorites]);

  const home = !query.trim() && system === "all";

  // ------------------------------------------------------------------ tabs

  /** Focus lands inside the tab that was picked, on what was focused there last. */
  const focusTab = useCallback((which: Tab, gameId: string | null = null) => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const root = storeRef.current;
        if (!root) return;
        const view = root.querySelector(`[data-view="${which}"]`);
        if (which === "store") {
          const last = storeFocus.current;
          if (last && view?.contains(last) && focusElement(last)) return;
          if (focusElement(view?.querySelector(`.rs-card, ${HOME_FIRST}`))) return;
        } else if (view) {
          if (view.contains(document.activeElement)) return; // the view took focus itself
          const game = gameId
            ? Array.from(view.querySelectorAll("[data-game]")).find((el) => el.getAttribute("data-game") === gameId)
            : null;
          const first =
            game ?? view.querySelector(".rs-lib-card, .rs-dl-cancel, .rs-dl-row, .rs-set-nav-item.active, .rs-empty .rs-btn");
          if (focusElement(first)) return;
        }
        // Nothing to land on yet (the list is still loading): the tab itself.
        focusElement(root.querySelector(`.rs-tab[data-tab="${which}"]`));
      }),
    );
  }, []);

  const selectTab = useCallback(
    (next: Tab, gameId: string | null = null) => {
      tabRef.current = next;
      setTab(next);
      if (next === "library") refreshInstalled();
      if (next === "downloads") refreshDownloads();
      focusTab(next, gameId);
    },
    [focusTab, refreshDownloads, refreshInstalled],
  );

  const stepTab = (delta: number) => {
    const index = TABS.findIndex((item) => item.key === tab);
    const next = TABS[index + delta];
    if (next) selectTab(next.key);
  };

  const openLibrary = useCallback(
    (focusId: string | null = null) => {
      setLibraryFocus(focusId);
      selectTab("library", focusId);
    },
    [selectTab],
  );

  // ----------------------------------------------------------------- games

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
      setUninstalled((current) => new Set(current).add(shelfKey(game.system, game.title)));
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
      refreshLibrary();
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

  /** L2/R2 and the pager: turn the page and keep focus on the same slot. */
  const turnPage = (delta: number) => {
    const next = Math.min(pageCount - 1, Math.max(0, page + delta));
    if (next === page) return;
    const cards = Array.from(mainRef.current?.querySelectorAll(".rs-grid .rs-card") ?? []);
    const slot = Math.max(0, cards.indexOf(document.activeElement as Element));
    goPage(next);
    const count = Math.min(PAGE_SIZE, results.length - next * PAGE_SIZE);
    window.requestAnimationFrame(() => focusElement(cardAt(Math.min(slot, count - 1))));
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

  /**
   * A game from a shelf (recently viewed, a favourite, a finished download).
   * Its page opens at once with the title and cover the shelf has; the links
   * are looked up in the background, without touching the search on screen.
   */
  const openShelfItem = useCallback((item: Pick<ShelfItem, "title" | "system"> & { cover?: string | null }) => {
    returnFocus.current = document.activeElement;
    const token = ++soloToken.current;
    setSolo({ item: { title: item.title, system: item.system, cover: item.cover ?? null }, rom: null, missing: false });
    const key = matchKey(item.title);
    searchRoms(bareTitle(item.title), null, item.system, "relevance", 40, 1)
      .then((payload) => {
        if (token !== soloToken.current) return;
        const found =
          (payload.results ?? []).find(
            (rom) =>
              rom.system === item.system &&
              (matchKey(rom.title) === key || rom.entries.some((entry) => matchKey(entry.title) === key)),
          ) ?? null;
        setSolo((current) => (current ? { ...current, rom: found, missing: !found } : current));
        if (found) {
          addRecent({ title: found.title, system: found.system, cover: found.cover })
            .then(setShelves)
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (token === soloToken.current) setSolo((current) => (current ? { ...current, missing: true } : current));
      });
  }, []);

  const stub = useMemo<MergedRom | null>(
    () =>
      solo
        ? {
            id: `stub:${solo.item.system}|${solo.item.title}`,
            title: solo.item.title,
            system: solo.item.system,
            sources: [],
            cover: solo.item.cover ?? null,
            rating: null,
            downloads: null,
            year: null,
            regions: [],
            size: null,
            variants: 0,
            entries: [],
          }
        : null,
    [solo?.item],
  );

  const flipFavorite = useCallback((item: { title: string; system: string; cover?: string | null }) => {
    toggleFavorite({ title: item.title, system: item.system, cover: item.cover ?? null })
      .then((value) => {
        setShelves(value);
        toaster.toast({
          title: value.favorite ? "Added to favourites" : "Removed from favourites",
          body: item.title,
          icon: "Favorite",
        });
      })
      .catch(() => undefined);
  }, []);

  /** L1/R1 on the game page; the grid behind it follows across pages. */
  const stepGame = (delta: number) => {
    if (selectedIndex === null) return;
    const next = selectedIndex + delta;
    if (next < 0 || next >= results.length) return;
    setSelectedIndex(next);
    const nextPage = Math.floor(next / PAGE_SIZE);
    if (nextPage !== page) goPage(nextPage);
  };

  const closeGame = () => {
    if (solo) {
      soloToken.current += 1;
      const target = returnFocus.current;
      returnFocus.current = null;
      setSolo(null);
      window.requestAnimationFrame(() => focusElement(target));
      return;
    }
    if (selectedIndex !== null) {
      // Back on the cover of the game that was open last, which is not the
      // one that opened the page if L1/R1 moved on.
      const slot = selectedIndex % PAGE_SIZE;
      window.requestAnimationFrame(() => focusElement(cardAt(slot)));
    }
    returnFocus.current = null;
    setSelectedIndex(null);
  };

  const searchInput = () => storeRef.current?.querySelector<HTMLElement>(".rs-search-wrap input");
  const focusSearch = () => {
    if (tab !== "store") {
      tabRef.current = "store";
      setTab("store");
    }
    focusElement(searchInput());
  };

  /**
   * A console tile. The home screen makes way for that console's catalogue;
   * focus waits on the console filter and moves to the first cover when the
   * games are in.
   */
  const pickConsole = useCallback((key: string) => {
    wantGrid.current = true;
    setSystem(key);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => focusElement(storeRef.current?.querySelector(".rs-filter-console select, .rs-filter-console .Focusable, .rs-filter-console button"))),
    );
  }, []);

  useEffect(() => {
    if (!wantGrid.current || loading) return;
    if (!results.length) {
      if (searched) wantGrid.current = false;
      return;
    }
    wantGrid.current = false;
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      // Not if the player has moved somewhere else in the meantime.
      if (active && active !== document.body && !active.closest(".rs-filterbar, .rs-tab")) return;
      focusElement(cardAt(0));
    });
  }, [results, loading, searched]);

  /** B on the results: back to the home screen, on the console that was open. */
  const goHome = useCallback(() => {
    const from = system;
    setQuery("");
    setSystem("all");
    setSource("all");
    stripRef.current?.show(null);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const root = storeRef.current;
        if (!root) return;
        const tile = from !== "all" ? root.querySelector(`.rs-console[data-key="${from}"]`) : null;
        focusElement(tile ?? root.querySelector(HOME_FIRST));
      }),
    );
  }, [system]);
  // B steps back the way the player came: a tab -> the store, a result list
  // -> the home screen, the home screen -> out of the plugin. Two guards, so
  // the result list keeps its place in the history while another tab is open.
  useBackGuard(!home, goHome);
  useBackGuard(tab !== "store", () => selectTab("store"));

  const onShellButton = (event: GamepadEvent) => {
    const button = event.detail.button;
    if (button === PAD.BUMPER_LEFT) stepTab(-1);
    else if (button === PAD.BUMPER_RIGHT) stepTab(1);
    else if (tab === "store" && !home) {
      if (button === PAD.TRIGGER_LEFT) turnPage(-1);
      else if (button === PAD.TRIGGER_RIGHT) turnPage(1);
    }
  };

  const active = useMemo(() => jobs.filter(isActive), [jobs]);
  useEffect(() => {
    activeRef.current = active.length;
  }, [active.length]);
  // All running downloads as one figure, for the bar under the Downloads tab.
  const activeProgress = useMemo(() => {
    const total = active.reduce((sum, job) => sum + (job.total || 0), 0);
    return total ? active.reduce((sum, job) => sum + Math.min(job.received, job.total || 0), 0) / total : 0;
  }, [active]);

  const sourceOptions = useMemo(() => {
    const list = sources.filter((item) => item.enabled);
    return list.length ? list : sources;
  }, [sources]);

  // Every console a source can browse (the backend's order: the popular
  // ones first), plus any console the current results have.
  const consoleOptions = useMemo(() => {
    const keys = consoles.map((item) => item.key);
    const extra = [...systems, system].filter((key) => key !== "all" && key !== "unknown" && !keys.includes(key));
    return [...keys, ...Array.from(new Set(extra))];
  }, [consoles, systems, system]);

  const selected = solo ? (solo.rom ?? stub) : selectedIndex !== null ? (results[selectedIndex] ?? null) : null;
  const pageOpen = selected !== null;

  const showFocused = useCallback((rom: MergedRom | null) => stripRef.current?.show(rom), []);
  const issueCount = Object.keys(errors).length;
  const heading = query.trim() ? `“${query.trim()}”` : systemLabel(system);

  return (
    <div className="rs-store" ref={storeRef}>
      <StoreStyles />
      {/* Everything behind the game page. While that is open the d-pad cannot
          wander back here. X searches and L1/R1 change tab from anywhere. */}
      <Focusable noFocusRing
        className="rs-body"
        flow-children="column"
        {...childFocus(!pageOpen)}
        onSecondaryButton={focusSearch}
        onSecondaryActionDescription="Search"
        onButtonDown={onShellButton}
      >
        <Focusable noFocusRing className="rs-top" flow-children="row">
          <div className="rs-brand">
            <span className="rs-brand-mark">
              <FaGamepad />
            </span>
            ROM Store
          </div>
          <Focusable noFocusRing className="rs-tabs" flow-children="row">
            <Glyph>L1</Glyph>
            {TABS.map((item) => (
              <Focusable noFocusRing
                key={item.key}
                className={`rs-tab rs-f${tab === item.key ? " active" : ""}`}
                data-tab={item.key}
                focusClassName="is-focus"
                onActivate={() => selectTab(item.key)}
                onClick={() => selectTab(item.key)}
                onOKActionDescription={`Open ${item.label}`}
              >
                {item.label}
                {item.key === "downloads" && active.length > 0 ? (
                  <>
                    <span className="rs-tab-badge">{active.length}</span>
                    <span className="rs-tab-progress">
                      <span style={{ width: `${Math.round(activeProgress * 100)}%` }} />
                    </span>
                  </>
                ) : null}
              </Focusable>
            ))}
            <Glyph>R1</Glyph>
          </Focusable>
          <div className="rs-search">
            <FaSearch className="rs-search-icon" />
            <div className="rs-search-wrap">
              <TextField
                label=""
                value={query}
                placeholder="Search games"
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (tabRef.current !== "store") {
                    tabRef.current = "store";
                    setTab("store");
                  }
                }}
              />
            </div>
            <Glyph round>X</Glyph>
          </div>
        </Focusable>

        <div className="rs-views">
          {/* The store stays mounted behind the other tabs, so its covers,
              scroll position and focus are still there on the way back. */}
          <Focusable noFocusRing
            className={`rs-view${tab === "store" ? "" : " is-hidden"}`}
            data-view="store"
            flow-children="column"
            {...childFocus(tab === "store")}
            onFocus={(event) => {
              storeFocus.current = event.target as Element;
            }}
          >
            {home ? (
              <div className="rs-main rs-main-home">
                <HomeView
                  consoles={consoles}
                  favorites={shelves.favorites}
                  recent={shelves.recent}
                  installed={installed?.games ?? []}
                  onConsole={pickConsole}
                  onItem={openShelfItem}
                  onInstalled={openLibrary}
                  onFavorite={flipFavorite}
                />
              </div>
            ) : (
              <div className="rs-results">
                <Focusable noFocusRing className="rs-filterbar" flow-children="row">
                  <div className="rs-results-head">
                    <h1 className="rs-h1">{heading}</h1>
                    <span className="rs-count">
                      {loading
                        ? "Searching…"
                        : `${results.length.toLocaleString()} ${results.length === 1 ? "game" : "games"}`}
                    </span>
                  </div>
                  <div className="rs-filter rs-filter-console">
                    <Dropdown
                      rgOptions={[
                        { label: "All consoles", data: "all" },
                        ...consoleOptions.map((key) => ({
                          label: systemLabel(key),
                          data: key,
                        })),
                      ]}
                      selectedOption={system}
                      onChange={(option) => setSystem(option.data)}
                      menuLabel="Console"
                    />
                  </div>
                  <div className="rs-filter">
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
                  </div>
                  <div className="rs-filter">
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
                  </div>
                  <div className="rs-filter">
                    <Dropdown
                      rgOptions={SORTS.map((item) => ({ label: item.label, data: item.value }))}
                      selectedOption={sort}
                      onChange={(option) => setSort(option.data)}
                      menuLabel="Sort by"
                    />
                  </div>
                </Focusable>

                <div
                  ref={mainRef}
                  className="rs-main"
                  onBlur={(event) => {
                    // Focus left the covers: the line below stops naming one.
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) showFocused(null);
                  }}
                >
                  {loading && results.length === 0 ? (
                    // The shape of what is coming, so nothing jumps when it arrives.
                    <div className="rs-grid rs-skeleton" aria-hidden="true">
                      {Array.from({ length: 16 }, (_, slot) => (
                        <div key={slot} className="rs-skel" style={{ aspectRatio: systemAspect(system) }} />
                      ))}
                    </div>
                  ) : null}

                  {!loading && results.length === 0 && allResults.length > 0 ? (
                    <EmptyState icon={<FaSearch />} title={`No ${region} games here`}>
                      {allResults.length} {allResults.length === 1 ? "game was" : "games were"} found, all from other
                      regions. Set the region filter to All regions to see them.
                    </EmptyState>
                  ) : null}

                  {!loading && allResults.length === 0 && searched ? (
                    <EmptyState icon={<FaSearch />} title="Nothing found">
                      {query.trim()
                        ? `No games matched “${query.trim()}”${system !== "all" ? ` on ${systemLabel(system)}` : ""}. Try a different title${
                            system !== "all" ? ", pick All consoles" : ""
                          }, or check the sources in Settings: one of them may be unreachable.`
                        : `No ${systemLabel(system)} games came back from the sources. Not every site lists every console, and one may be unreachable right now: Settings shows how each source is doing.`}
                    </EmptyState>
                  ) : null}

                  {results.length > 0 ? (
                    <>
                      <RomGrid
                        items={visible}
                        favorites={favoriteKeys}
                        onOpen={openGame}
                        onFocus={showFocused}
                        onFavorite={flipFavorite}
                      />
                      {pageCount > 1 ? (
                        <Focusable noFocusRing className="rs-pager" flow-children="row">
                          {page > 0 ? (
                            <Focusable noFocusRing
                              className="rs-pill rs-f"
                              focusClassName="is-focus"
                              onActivate={() => turnPage(-1)}
                              onClick={() => turnPage(-1)}
                              onOKActionDescription="Previous page"
                            >
                              <Glyph>L2</Glyph> Previous
                            </Focusable>
                          ) : (
                            <div className="rs-pill off">
                              <Glyph>L2</Glyph> Previous
                            </div>
                          )}
                          <span className="rs-pager-label">
                            Page {page + 1} of {pageCount}
                          </span>
                          {page < pageCount - 1 ? (
                            <Focusable noFocusRing
                              className="rs-pill rs-f"
                              focusClassName="is-focus"
                              onActivate={() => turnPage(1)}
                              onClick={() => turnPage(1)}
                              onOKActionDescription="Next page"
                            >
                              Next <Glyph>R2</Glyph>
                            </Focusable>
                          ) : (
                            <div className="rs-pill off">
                              Next <Glyph>R2</Glyph>
                            </div>
                          )}
                        </Focusable>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {showIssues && issueCount > 0 ? (
                  <div className="rs-issue-list">
                    {Object.entries(errors).map(([id, message]) => (
                      <div className="rs-issue-row" key={id}>
                        <b>{SOURCE_LABELS[id] ?? id}</b>
                        <span>{message}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <InfoStrip
                  ref={stripRef}
                  summary={
                    loading
                      ? "Asking the sources…"
                      : results.length
                        ? `${results.length} ${results.length === 1 ? "game" : "games"}${cached ? " · from the cache" : ""} · pick a cover for its details`
                        : ""
                  }
                >
                  {issueCount > 0 ? (
                    <Focusable noFocusRing
                      className="rs-issues rs-f"
                      focusClassName="is-focus"
                      onActivate={() => setShowIssues((value) => !value)}
                      onClick={() => setShowIssues((value) => !value)}
                      onOKActionDescription={showIssues ? "Hide problems" : "Show problems"}
                    >
                      <FaExclamationTriangle /> {issueCount} {issueCount === 1 ? "source" : "sources"} unavailable
                    </Focusable>
                  ) : null}
                  {pageCount > 1 ? (
                    <span className="rs-strip-page">
                      <Glyph>L2</Glyph>
                      Page {page + 1} / {pageCount}
                      <Glyph>R2</Glyph>
                    </span>
                  ) : null}
                </InfoStrip>
              </div>
            )}
          </Focusable>

          {tab === "library" ? (
            <LibraryView
              games={installed?.games ?? null}
              root={installed?.root ?? library?.root ?? ""}
              storage={library?.storage ?? []}
              focusId={libraryFocus}
              onUninstall={removeGame}
              onChanged={refreshInstalled}
              onStorePage={openShelfItem}
              onBrowse={() => selectTab("store")}
            />
          ) : null}

          {tab === "downloads" ? (
            <DownloadsView
              jobs={jobs}
              onRefresh={refreshDownloads}
              onOpen={openShelfItem}
              onBrowse={() => selectTab("store")}
            />
          ) : null}

          {tab === "settings" ? (
            <SettingsView
              onSaved={(value) => {
                setSettings(value);
                refreshLibrary();
              }}
            />
          ) : null}
        </div>
      </Focusable>

      {selected ? (
        <GamePage
          rom={selected}
          library={library}
          jobs={jobs}
          resolving={Boolean(solo && !solo.rom && !solo.missing)}
          missing={Boolean(solo?.missing)}
          // A region picked in the filter also picks the file to offer first.
          preferredRegion={region !== "all" ? region : (settings?.preferred_region ?? "")}
          favorite={favoriteKeys.has(shelfKey(selected.system, selected.title))}
          onToggleFavorite={() => flipFavorite(selected)}
          onClose={closeGame}
          position={solo || selectedIndex === null ? undefined : { index: selectedIndex, total: results.length }}
          onPrev={!solo && selectedIndex! > 0 ? () => stepGame(-1) : undefined}
          onNext={!solo && selectedIndex! < results.length - 1 ? () => stepGame(1) : undefined}
          onStarted={refreshDownloads}
          onShowDownloads={() => {
            closeGame();
            selectTab("downloads");
          }}
          onSearchInstead={() => {
            const item = solo?.item;
            closeGame();
            if (item) {
              // Focus waits on the tab and moves to the first hit when it is in.
              wantGrid.current = true;
              setQuery(bareTitle(item.title));
              selectTab("store");
            }
          }}
        />
      ) : null}
    </div>
  );
};

export default Store;
