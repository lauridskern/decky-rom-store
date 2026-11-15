import { CSSProperties, FC, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toaster } from "@decky/api";
import {
  BiosInfo,
  checkBios,
  DownloadJob,
  getSpeeds,
  SourceSpeed,
  getCover,
  getDetails,
  startDownload,
  LibraryInfo,
  MergedRom,
  RomEntry,
  RomFile,
} from "../types";
import { Button, Dropdown, Focusable, GamepadEvent } from "@decky/ui";
import { FaCheck, FaDownload, FaFolder, FaRegStar, FaSearch, FaStar, FaTimes } from "react-icons/fa";
import { artRatios, clampArtRatio, formatBytes, formatCount, isResizedArt, SOURCE_LABELS, systemAspect, systemLabel } from "./common";
import CoverImage from "./CoverImage";
import { NoArt } from "./RomCard";
import MediaGallery from "./MediaGallery";
import { useBackGuard } from "./useBackGuard";
import { focusElement, PAD } from "./gamepad";
import { Glyph, Spinner } from "./ui";

/**
 * The washed-out artwork behind the title. It is a screenshot when the game
 * has one (a store hero is landscape) and falls back to the cover. The image
 * is resolved through the image cache, so opening the same game again paints
 * it from disk instead of re-downloading it from the CDN.
 */
const HeroBackdrop: FC<{ url: string | null }> = ({ url }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    // The backdrop first shows the cover, then switches to a screenshot once
    // the details are in. It keeps the picture it has until the next one has
    // really loaded, and only uses files from the Deck's image cache: a remote
    // URL is often blocked by the Steam client and left the backdrop empty.
    let cancelled = false;
    if (!url) return;
    getCover(url, "detail")
      .then((resolved) => {
        if (cancelled || !resolved) return;
        const image = new Image();
        image.onload = () => {
          if (!cancelled) setSrc(resolved);
        };
        image.src = resolved;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!src) return null;
  return (
    <div className="rs-page-backdrop" aria-hidden="true">
      <div className="rs-page-backdrop-art" style={{ backgroundImage: `url("${src}")` } as CSSProperties} />
    </div>
  );
};

/** One figure in the row under the title. */
const Stat: FC<{ children: ReactNode; tone?: "rating" | "owned" }> = ({ children, tone }) => (
  <span className={`rs-stat${tone ? ` ${tone}` : ""}`}>{children}</span>
);

interface Props {
  rom: MergedRom;
  library: LibraryInfo | null;
  /** The download queue: this game's running download shows on its button. */
  jobs: DownloadJob[];
  /** Opened from a shelf: its links are still being looked up... */
  resolving?: boolean;
  /** ...or the sources did not have it. */
  missing?: boolean;
  onClose: () => void;
  onStarted: () => void;
  onShowDownloads: () => void;
  onSearchInstead?: () => void;
  /** Where this game is in the results ("3 / 120"). */
  position?: { index: number; total: number };
  /** L1/R1: the previous and next game in the results, when there is one. */
  onPrev?: () => void;
  onNext?: () => void;
  /** "USA", "Europe", "Japan" or "": files of that region are offered first. */
  preferredRegion?: string;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}

/** Seconds until a file is in, from its provider's measurements; null if unmeasured. */
function estimateSeconds(stats: SourceSpeed | undefined, size: number | null | undefined): number | null {
  // The last speed test got no file from it (a browser check, a download
  // page): offered last, after every provider that works.
  if (stats?.test_error) return Number.POSITIVE_INFINITY;
  if (!stats?.speed) return null;
  return (stats.delay ?? 0) + (size ?? 0) / stats.speed;
}

/** Does a file belong to a region? Looks at the region field and the name. */
function inRegion(file: RomFile, region: string): boolean {
  if (!region) return false;
  const needle = region.toLowerCase();
  const short: Record<string, string[]> = { usa: ["usa", "(u)", "[u]"], europe: ["europe", "(e)", "[e]"], japan: ["japan", "(j)", "[j]"] };
  const text = `${file.region ?? ""} ${file.label ?? ""} ${file.filename ?? ""}`.toLowerCase();
  return (short[needle] ?? [needle]).some((token) => text.includes(token)) || text.includes("world");
}

// The poster column (see .rs-page-side in styles.ts).
const SIDE_PAD_LEFT = 40;
const SIDE_PAD_Y = 66 + 28;
const SIDE_GAP = 22;
const POSTER_MAX_WIDTH = 268;
const POSTER_MIN_WIDTH = 120;
const FACT_ROW = 37; // label + one line of value
const FACT_GAP = 12;

/**
 * How wide the poster column is and how many facts fit under the poster.
 *
 * The poster has its art's shape and fills the column's width. A tall cover
 * on a short screen would run off the bottom, so the poster gets at most the
 * column's height minus two rows of facts, and the whole column narrows to
 * the poster's width instead of the poster being cut or squashed. Facts that
 * do not fit under it are left out rather than cut in half.
 */
export function sideLayout(
  pageHeight: number,
  ratio: number,
  factCount: number,
): { width: number; facts: number; columns: 1 | 2 } {
  if (pageHeight <= 0) return { width: POSTER_MAX_WIDTH, facts: factCount, columns: 2 };
  const column = pageHeight - SIDE_PAD_Y;
  const reserved = factCount ? SIDE_GAP + 2 * FACT_ROW + FACT_GAP : 0;
  const width = Math.round(Math.max(POSTER_MIN_WIDTH, Math.min(POSTER_MAX_WIDTH, (column - reserved) * ratio)));
  const left = column - width / ratio - SIDE_GAP;
  const rows = Math.max(0, Math.floor((left + FACT_GAP) / (FACT_ROW + FACT_GAP)));
  // Two columns of facts need room for "DOWNLOADS" and a short value each.
  const columns = width >= 220 ? 2 : 1;
  return { width, facts: Math.min(factCount, rows * columns), columns };
}

/**
 * A game, on the whole screen: its art behind the title, the poster on the
 * left, and on the right everything in the order people need it - the
 * download, other versions, pictures, the description, where it is saved.
 */
const GamePage: FC<Props> = ({
  rom,
  library,
  jobs,
  resolving = false,
  missing = false,
  onClose,
  onStarted,
  onShowDownloads,
  onSearchInstead,
  position,
  onPrev,
  onNext,
  preferredRegion = "",
  favorite = false,
  onToggleFavorite,
}) => {
  const [bios, setBios] = useState<BiosInfo | null>(null);
  // How fast each provider has been on earlier downloads.
  const [speeds, setSpeeds] = useState<Record<string, SourceSpeed>>({});
  useEffect(() => {
    getSpeeds()
      .then((value) => setSpeeds(value ?? {}))
      .catch(() => undefined);
  }, []);
  const [loaded, setLoaded] = useState<MergedRom | null>(null);
  // Some games list dozens of dumps; the first few, then "Show all".
  const [allVersions, setAllVersions] = useState(false);
  // L1/R1 swap the game without remounting the panel; ignore the last game's
  // details until this one's arrive.
  const details = loaded?.id === rom.id ? loaded : null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The page's height: the poster column is sized from it (see sideLayout).
  const [pageHeight, setPageHeight] = useState(0);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    setPageHeight(panel.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPageHeight(panel.clientHeight));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // The Steam back button closes this overlay instead of leaving the plugin.
  useBackGuard(true, onClose);
  const [target, setTarget] = useState<string>(rom.system);
  // The poster frame takes the cover's own shape once it has loaded; until then
  // it holds the usual box shape for the console so the column does not jump.
  const [posterRatio, setPosterRatio] = useState<number | null>(() => (rom.cover ? (artRatios.get(rom.cover) ?? null) : null));

  // Consoles that need a BIOS say so, and whether one is in place.
  useEffect(() => {
    let cancelled = false;
    setBios(null);
    checkBios(rom.system)
      .then((info) => {
        if (!cancelled) setBios(info ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rom.system]);

  // A different game (L1/R1): start from the top with its own defaults.
  useEffect(() => {
    setTarget(rom.system);
    setAllVersions(false);
    setPosterRatio(rom.cover ? (artRatios.get(rom.cover) ?? null) : null);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [rom.id]);

  // A game opened from a shelf has no links until the sources were asked.
  const stub = rom.id.startsWith("stub:");
  useEffect(() => {
    let cancelled = false;
    if (stub) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getDetails(rom.id)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rom.id]);

  const variants = useMemo(() => (details ? details.entries : rom.entries), [details, rom.entries]);
  const primary = variants[0];
  const media = details?.extra?.media;
  const cover = primary?.cover_full ?? rom.cover ?? null;
  // Resized art (Romspedia) is stretched back into the console's box shape.
  const resizedCover = isResizedArt(cover);
  const posterShape = posterRatio && !resizedCover ? String(clampArtRatio(posterRatio)) : systemAspect(rom.system);
  // A screenshot makes a far better hero than a blown-up cover.
  const hero = media?.header ?? media?.shots?.[0]?.thumb ?? cover;

  const systems = useMemo(() => {
    const list = library?.systems ?? [];
    const known = new Map<string, string>();
    list.forEach((item) => known.set(item.key, item.label));
    known.set(rom.system, systemLabel(rom.system));
    return Array.from(known.entries()).map(([key, label]) => ({ key, label }));
  }, [library, rom.system]);

  // Which ROM library (internal storage, SD card) this download goes to.
  const storage = library?.storage ?? [];
  const [drive, setDrive] = useState<string | null>(null);
  const driveRoot = drive ?? library?.root ?? "";

  const destination = useMemo(() => {
    const found = library?.systems?.find((item) => item.key === target);
    // The folder name is the same on every drive; only the root changes.
    const folder = found?.folder ?? target;
    if (found && driveRoot === library?.root) return found.path;
    return driveRoot ? `${driveRoot}/${folder}` : folder;
  }, [library, target, driveRoot]);

  const genres = media?.genres?.length ? media.genres : (primary?.genres ?? []);
  const developer = media?.developers?.length ? media.developers[0] : primary?.developer;
  const publisher = media?.developers?.length ? media.developers[1] : primary?.publisher;
  // The preferred region's files first; otherwise the backend's order.
  // Order: the preferred region's files first, then the one that should be
  // in first, from each provider's measured speed and start delay (a link
  // that takes a form or a countdown to hand out is slower to start).
  // Providers without measurements count as the median of the known ones.
  const allFiles = variants.flatMap((entry) => entry.files.map((file) => ({ entry, file })));
  // One size for every file of the game (the median), so the estimate only
  // tells providers apart; within a provider its own order stays (its main
  // release first), however a few kB differ between dumps.
  const sizes = allFiles.map((item) => item.file.size ?? item.entry.size ?? 0).filter(Boolean).sort((a, b) => a - b);
  const gameSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const listed = allFiles.map((item, index) => ({
    ...item,
    index,
    rank: inRegion(item.file, preferredRegion) ? 0 : 1,
    eta: estimateSeconds(speeds[item.entry.source], gameSize),
  }));
  const knownEtas = listed
    .map((item) => item.eta)
    .filter((eta): eta is number => eta !== null && Number.isFinite(eta))
    .sort((a, b) => a - b);
  const typicalEta = knownEtas.length ? knownEtas[Math.floor(knownEtas.length / 2)] : 0;
  const files = listed.sort(
    (a, b) => a.rank - b.rank || (a.eta ?? typicalEta) - (b.eta ?? typicalEta) || a.index - b.index,
  );
  // The backend ranks the files; the first one is offered as the main action.
  const best = files[0] ?? null;
  const others = files.slice(1);
  const VERSIONS_SHOWN = 5;
  const shownOthers = allVersions ? others : others.slice(0, VERSIONS_SHOWN);

  const showAllVersions = () => {
    setAllVersions(true);
    // Focus moves on to the first version that was hidden.
    window.requestAnimationFrame(() => focusElement(contentRef.current?.querySelectorAll(".rs-version")[VERSIONS_SHOWN]));
  };

  // This game's download, if one is running: the main button turns into it.
  const titles = new Set(variants.map((entry) => entry.title));
  const job =
    jobs.find(
      (item) =>
        titles.has(item.title) &&
        (item.status === "downloading" || item.status === "queued" || item.status === "extracting"),
    ) ?? null;
  const jobProgress = job?.total ? Math.min(1, job.received / job.total) : 0;
  const owned = Boolean(
    rom.installed || details?.installed || jobs.some((item) => item.status === "done" && titles.has(item.title)),
  );
  const failures = variants.filter((entry) => entry.error && entry.files.length === 0);
  const systemName = library?.systems?.find((item) => item.key === rom.system)?.label ?? systemLabel(rom.system);
  const sourceNames = Array.from(new Set(variants.map((entry) => SOURCE_LABELS[entry.source] ?? entry.source)));

  const facts: [string, string][] = [
    ["Developer", developer ?? ""],
    ["Publisher", publisher && publisher !== developer ? publisher : ""],
    ["Genre", genres.slice(0, 3).join(", ")],
    ["Downloads", rom.downloads ? formatCount(rom.downloads) : ""],
    ["Found on", sourceNames.join(", ")],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  const side = sideLayout(pageHeight, Number(posterShape) || 5 / 7, facts.length);

  // Some sites only name the file when the download starts (MyAbandonware);
  // "Rogue (DOS)" reads better than the link's "lfq3-rogue" until then.
  const fileName = (file: RomFile) =>
    file.filename || (file.label ? `${rom.title} (${file.label})` : file.url.split("/").pop() || "Download");
  const fileMeta = (entry: RomEntry, file: RomFile) =>
    [
      SOURCE_LABELS[entry.source] ?? entry.source,
      file.size ? formatBytes(file.size) : "size unknown",
      speeds[entry.source]?.speed ? `${formatBytes(speeds[entry.source].speed)}/s` : null,
      file.region,
      file.label && file.label !== file.region ? file.label : null,
    ].filter(Boolean) as string[];

  const download = async (entry: RomEntry, file: RomFile) => {
    setBusy(file.id);
    try {
      const result = await startDownload(rom.id, entry.key, file.id, target, null, drive);
      if (result.ok) {
        toaster.toast({
          title: "Download started",
          body: `${rom.title} → ${result.destination ?? destination}`,
          icon: "Download",
        });
        onStarted();
      } else {
        toaster.toast({ title: "Download failed", body: result.error ?? "Unknown error", icon: "Download" });
      }
    } catch (error) {
      toaster.toast({ title: "Download failed", body: String(error), icon: "Download" });
    } finally {
      setBusy(null);
    }
  };

  // Focus lands on the main Download button as soon as there is one. Until the
  // links have loaded it sits on the close button, and it is never taken away
  // from something the player has already moved to.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    const idle = !active || !panel.contains(active) || active.classList.contains("rs-close");
    if (!idle) return;
    focusElement(panel.querySelector(".rs-cta-btn") ?? panel.querySelector(".rs-close"));
  }, [rom.id, best?.file.id, missing]);

  const onPanelButton = (event: GamepadEvent) => {
    if (event.detail.button === PAD.BUMPER_LEFT && onPrev) onPrev();
    else if (event.detail.button === PAD.BUMPER_RIGHT && onNext) onNext();
  };

  const legend: Record<number, string> = {};
  if (onPrev) legend[PAD.BUMPER_LEFT] = "Previous game";
  if (onNext) legend[PAD.BUMPER_RIGHT] = "Next game";

  const waiting = loading || resolving;
  const mainAction = job ? onShowDownloads : best ? () => download(best.entry, best.file) : undefined;

  return (
    // d-pad: the close button, then down through the download, the versions,
    // the pictures and the save target. B closes (useBackGuard), X downloads
    // from anywhere on the page, Y favourites, L1/R1 go to the neighbours.
    <Focusable noFocusRing
      ref={panelRef}
      className="rs-page"
      flow-children="column"
      role="dialog"
      aria-modal="true"
      aria-label={rom.title}
      onCancelActionDescription="Back"
      onSecondaryButton={mainAction}
      onSecondaryActionDescription={job ? "View downloads" : best ? "Download" : undefined}
      onOptionsButton={onToggleFavorite}
      onOptionsActionDescription={onToggleFavorite ? (favorite ? "Unfavourite" : "Favourite") : undefined}
      onButtonDown={onPanelButton}
      actionDescriptionMap={legend}
    >
      {/* Keyed by game: L1/R1 must not keep the last game's backdrop. */}
      <HeroBackdrop key={rom.id} url={hero} />

      <Focusable noFocusRing className="rs-page-nav" flow-children="row">
        {position ? (
          <span className="rs-page-pos">
            <Glyph>L1</Glyph>
            {position.index + 1} / {position.total}
            <Glyph>R1</Glyph>
          </span>
        ) : null}
        <Focusable noFocusRing
          className="rs-close rs-f"
          focusClassName="is-focus"
          title="Close"
          onActivate={onClose}
          onClick={onClose}
          onOKActionDescription="Close"
        >
          <FaTimes />
        </Focusable>
      </Focusable>

      {/* Left: the poster in its own shape, the credits under it. */}
      <aside className="rs-page-side" style={{ width: side.width + SIDE_PAD_LEFT }}>
        <div
          className="rs-poster"
          style={
            {
              aspectRatio: posterShape,
              "--rs-ratio": posterShape,
            } as CSSProperties
          }
        >
          {cover ? (
            <CoverImage
              url={cover}
              kind="detail"
              alt={rom.title}
              eager
              stretch={resizedCover}
              onRatio={(ratio) => {
                setPosterRatio(ratio);
                return clampArtRatio(ratio) === ratio;
              }}
            />
          ) : (
            <NoArt title={rom.title} system={rom.system} />
          )}
        </div>
        {side.facts > 0 ? (
          <dl className={`rs-facts${side.columns === 1 ? " single" : ""}`}>
            {facts.slice(0, side.facts).map(([label, value]) => (
              <div className="rs-fact" key={label}>
                <dt>{label}</dt>
                <dd title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </aside>

      {/* Right: one scroll area, ordered by what people come here to do. */}
      <Focusable noFocusRing ref={contentRef} className="rs-page-main" flow-children="column">
        <header className="rs-page-head">
          <div className="rs-eyebrow">{systemName}</div>
          <h1 className="rs-title">{rom.title}</h1>
          <div className="rs-stats">
            {owned ? (
              <Stat tone="owned">
                <FaCheck /> In your library
              </Stat>
            ) : null}
            {rom.rating ? (
              <Stat tone="rating">
                <FaStar /> {rom.rating.toFixed(1)}
              </Stat>
            ) : null}
            {rom.year ? <Stat>{rom.year}</Stat> : null}
            {rom.regions.length ? <Stat>{rom.regions.join(" · ")}</Stat> : null}
            {best?.file.size ? <Stat>{formatBytes(best.file.size)}</Stat> : null}
          </div>
        </header>

        {/* A row: left/right between the download and the star. */}
        <Focusable noFocusRing className="rs-cta" flow-children="row">
          {job ? (
            <Button noFocusRing className="rs-cta-btn busy" onClick={onShowDownloads} onOKActionDescription="View downloads">
              <span className="rs-cta-fill" style={{ width: `${Math.round(jobProgress * 100)}%` }} />
              <span className="rs-cta-label">
                {job.status === "queued"
                  ? "Queued"
                  : job.status === "extracting"
                    ? "Extracting…"
                    : `Downloading · ${Math.round(jobProgress * 100)}%`}
              </span>
            </Button>
          ) : best ? (
            <Button noFocusRing
              className="rs-cta-btn"
              disabled={busy === best.file.id}
              onClick={() => download(best.entry, best.file)}
              onOKActionDescription="Download"
              // Back at the top: show the title and art again, not just the button.
              onGamepadFocus={() => {
                if (contentRef.current) contentRef.current.scrollTop = 0;
              }}
            >
              <span className="rs-cta-label">
                <FaDownload />
                {busy === best.file.id ? "Starting…" : owned ? "Download again" : "Download"}
              </span>
            </Button>
          ) : missing ? (
            <Button noFocusRing className="rs-cta-btn quiet" onClick={onSearchInstead} onOKActionDescription="Search">
              <span className="rs-cta-label">
                <FaSearch /> Search for it
              </span>
            </Button>
          ) : (
            <div className="rs-cta-wait">
              {waiting ? (
                <>
                  <Spinner /> Finding download links…
                </>
              ) : (
                "No download links were found for this title."
              )}
            </div>
          )}
          {onToggleFavorite ? (
            <Focusable noFocusRing
              className={`rs-icon-btn rs-f${favorite ? " on" : ""}`}
              focusClassName="is-focus"
              title={favorite ? "Remove from favourites" : "Add to favourites"}
              onActivate={onToggleFavorite}
              onClick={onToggleFavorite}
              onOKActionDescription={favorite ? "Unfavourite" : "Favourite"}
            >
              {favorite ? <FaStar /> : <FaRegStar />}
            </Focusable>
          ) : null}
          {best && !job ? (
            <div className="rs-cta-file">
              {/* One line: the file. Source, size and speed are in the versions list. */}
              <div className="rs-cta-name" title={fileName(best.file)}>
                {fileName(best.file)}
              </div>
            </div>
          ) : job ? (
            <div className="rs-cta-file">
              <div className="rs-cta-name" title={job.filename}>
                {job.filename}
              </div>
            </div>
          ) : missing ? (
            <div className="rs-cta-file">
              <div className="rs-cta-name">Not on the sources right now</div>
              <div className="rs-meta">
                <span>A search across every console may still find it.</span>
              </div>
            </div>
          ) : null}
        </Focusable>

        {bios ? (
          <div className={`rs-bios${bios.found ? " ok" : bios.optional ? " optional" : " missing"}`}>
            {bios.found ? (
              <>
                <b>{bios.label}</b> found: <span className="rs-path">{bios.found}</span>
              </>
            ) : (
              <>
                <b>{bios.optional ? `${bios.label} (optional)` : `Needs a ${bios.label}`}</b>
                {bios.hint ? ` · ${bios.hint}. ` : ". "}
                {bios.files.length ? (
                  <>
                    Put {bios.files.length > 1 ? "one of " : ""}
                    <span className="rs-path">{bios.files.slice(0, 3).join(", ")}</span> in{" "}
                  </>
                ) : (
                  <>Put it in </>
                )}
                <span className="rs-path">{bios.folder}</span>. ROM Store does not download BIOS files.
              </>
            )}
          </div>
        ) : null}

        {others.length > 0 || failures.length > 0 ? (
          <section className="rs-page-section">
            <div className="rs-section-head">
              <h2 className="rs-h3">Other versions</h2>
              {others.length > 0 ? <span className="rs-count">{others.length}</span> : null}
            </div>
            {/* Each row is one target: A downloads that version. */}
            <Focusable noFocusRing className="rs-versions" flow-children="column">
              {shownOthers.map(({ entry, file }) => (
                <Focusable noFocusRing
                  key={file.id}
                  className={`rs-version rs-f${busy === file.id ? " busy" : ""}`}
                  focusClassName="is-focus"
                  onActivate={() => download(entry, file)}
                  onClick={() => download(entry, file)}
                  onOKActionDescription="Download this version"
                >
                  <div className="rs-version-main">
                    <div className="rs-version-name" title={fileName(file)}>
                      {fileName(file)}
                    </div>
                    <div className="rs-meta">
                      {fileMeta(entry, file).map((part, index) => (
                        <span key={index} className={index === 0 ? "rs-file-source" : undefined}>
                          {part}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="rs-version-get">{busy === file.id ? <Spinner /> : <FaDownload />}</span>
                </Focusable>
              ))}
            </Focusable>
            {others.length > shownOthers.length ? (
              <Focusable noFocusRing
                className="rs-pill rs-f rs-versions-more"
                focusClassName="is-focus"
                onActivate={showAllVersions}
                onClick={showAllVersions}
                onOKActionDescription="Show all"
              >
                Show all {others.length} versions
              </Focusable>
            ) : null}
            {failures.map((entry) => (
              <div key={entry.key} className="rs-version-error">
                {SOURCE_LABELS[entry.source] ?? entry.source}: {entry.error}
              </div>
            ))}
          </section>
        ) : null}

        {media?.shots?.length || media?.trailer ? (
          <section className="rs-page-section">
            <div className="rs-section-head">
              <h2 className="rs-h3">Media</h2>
            </div>
            <MediaGallery media={media} />
          </section>
        ) : null}

        {media?.summary ? (
          <section className="rs-page-section">
            <div className="rs-section-head">
              <h2 className="rs-h3">About</h2>
            </div>
            <p className="rs-summary">{media.summary}</p>
          </section>
        ) : null}

        {/* Rarely changed, so it sits at the end rather than above the files. */}
        {stub ? null : (
          <section className="rs-page-section">
            <div className="rs-section-head">
              <h2 className="rs-h3">Save to</h2>
            </div>
            <Focusable noFocusRing className="rs-dest" flow-children="row">
              <FaFolder className="rs-dest-icon" />
              <div className="rs-dest-select">
                <Dropdown
                  rgOptions={systems.map((item) => ({ label: item.label, data: item.key }))}
                  selectedOption={target}
                  onChange={(option) => setTarget(option.data)}
                  menuLabel="Save to"
                />
              </div>
              {storage.length > 1 ? (
                <div className="rs-dest-select drive">
                  <Dropdown
                    rgOptions={storage.map((item) => ({
                      label: `${item.label} · ${formatBytes(item.free)} free`,
                      data: item.root,
                    }))}
                    selectedOption={driveRoot}
                    onChange={(option) => setDrive(option.data)}
                    menuLabel="Drive"
                  />
                </div>
              ) : null}
              <span className="rs-dest-path" title={destination}>
                {destination}
              </span>
            </Focusable>
          </section>
        )}
      </Focusable>
    </Focusable>
  );
};

export default GamePage;
