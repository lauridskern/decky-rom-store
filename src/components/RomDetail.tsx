import { CSSProperties, FC, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toaster } from "@decky/api";
import {
  BiosInfo,
  checkBios,
  getCover,
  getDetails,
  startDownload,
  LibraryInfo,
  MergedRom,
  RomEntry,
  RomFile,
} from "../types";
import { Button, Dropdown, Focusable, GamepadEvent } from "@decky/ui";
import { FaCheck, FaDownload, FaFolder, FaRegStar, FaStar } from "react-icons/fa";
import { artRatios, clampArtRatio, formatBytes, formatCount, isResizedArt, SOURCE_LABELS, systemAspect, systemLabel } from "./common";
import CoverImage from "./CoverImage";
import MediaGallery from "./MediaGallery";
import { useBackGuard } from "./useBackGuard";
import { focusElement, PAD } from "./gamepad";

/**
 * The washed-out artwork behind the title. It is a screenshot when the game
 * has one (a store hero is landscape) and falls back to the cover. The image
 * is resolved through the image cache, so opening the same game again paints
 * it from disk instead of re-downloading it from the CDN.
 */
const HeroBackdrop: FC<{ url: string | null }> = ({ url }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setSrc(null);
      return;
    }
    getCover(url, "detail")
      .then((resolved) => {
        if (!cancelled) setSrc(resolved ?? url);
      })
      .catch(() => {
        if (!cancelled) setSrc(url);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!src) return null;
  return (
    <div className="rs-detail-backdrop" aria-hidden="true">
      <div className="rs-detail-backdrop-art" style={{ backgroundImage: `url("${src}")` } as CSSProperties} />
    </div>
  );
};

/** One labelled figure in the row under the title. */
const Stat: FC<{ label: string; value: ReactNode; tone?: "rating" }> = ({ label, value, tone }) => (
  <div className="rs-kv">
    <span className="rs-kv-label">{label}</span>
    <span className={`rs-kv-value${tone ? ` ${tone}` : ""}`}>{value}</span>
  </div>
);

interface Props {
  rom: MergedRom;
  library: LibraryInfo | null;
  onClose: () => void;
  onStarted: () => void;
  /** L1/R1: the previous and next game in the results, when there is one. */
  onPrev?: () => void;
  onNext?: () => void;
  /** "USA", "Europe", "Japan" or "": files of that region are offered first. */
  preferredRegion?: string;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}

/** Does a file belong to a region? Looks at the region field and the name. */
function inRegion(file: RomFile, region: string): boolean {
  if (!region) return false;
  const needle = region.toLowerCase();
  const short: Record<string, string[]> = { usa: ["usa", "(u)", "[u]"], europe: ["europe", "(e)", "[e]"], japan: ["japan", "(j)", "[j]"] };
  const text = `${file.region ?? ""} ${file.label ?? ""} ${file.filename ?? ""}`.toLowerCase();
  return (short[needle] ?? [needle]).some((token) => text.includes(token)) || text.includes("world");
}

const RomDetail: FC<Props> = ({
  rom,
  library,
  onClose,
  onStarted,
  onPrev,
  onNext,
  preferredRegion = "",
  favorite = false,
  onToggleFavorite,
}) => {
  const [bios, setBios] = useState<BiosInfo | null>(null);
  const [loaded, setLoaded] = useState<MergedRom | null>(null);
  // L1/R1 swap the game without remounting the panel; ignore the last game's
  // details until this one's arrive.
  const details = loaded?.id === rom.id ? loaded : null;
  const panelRef = useRef<HTMLDivElement | null>(null);
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
    setPosterRatio(rom.cover ? (artRatios.get(rom.cover) ?? null) : null);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [rom.id]);

  useEffect(() => {
    let cancelled = false;
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
  const files = variants
    .flatMap((entry) => entry.files.map((file) => ({ entry, file })))
    .map((item, index) => ({ ...item, index, rank: inRegion(item.file, preferredRegion) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  // The backend ranks the files; the first one is offered as the main action.
  const best = files[0] ?? null;
  const others = files.slice(1);
  const failures = variants.filter((entry) => entry.error && entry.files.length === 0);
  const systemName = library?.systems?.find((item) => item.key === rom.system)?.label ?? systemLabel(rom.system);
  const sourceNames = Array.from(new Set(variants.map((entry) => SOURCE_LABELS[entry.source] ?? entry.source)));

  const facts: [string, string][] = [
    ["Developer", developer ?? ""],
    ["Publisher", publisher && publisher !== developer ? publisher : ""],
    ["Genre", genres.slice(0, 3).join(", ")],
    ["Found on", sourceNames.join(", ")],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  // Some sites only name the file when the download starts (MyAbandonware);
  // "Rogue (DOS)" reads better than the link's "lfq3-rogue" until then.
  const fileName = (file: RomFile) =>
    file.filename || (file.label ? `${rom.title} (${file.label})` : file.url.split("/").pop() || "Download");
  const fileMeta = (entry: RomEntry, file: RomFile) =>
    [
      SOURCE_LABELS[entry.source] ?? entry.source,
      file.size ? formatBytes(file.size) : "size unknown",
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
    focusElement(panel.querySelector(".rs-get-btn") ?? panel.querySelector(".rs-close"));
  }, [rom.id, best?.file.id]);

  const onPanelButton = (event: GamepadEvent) => {
    if (event.detail.button === PAD.BUMPER_LEFT && onPrev) onPrev();
    else if (event.detail.button === PAD.BUMPER_RIGHT && onNext) onNext();
  };

  const legend: Record<number, string> = {};
  if (onPrev) legend[PAD.BUMPER_LEFT] = "Previous game";
  if (onNext) legend[PAD.BUMPER_RIGHT] = "Next game";

  return (
    <div className="rs-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      {/* d-pad: the close button, then down through the files, media and the
          save target. B closes (useBackGuard), X downloads the main file from
          anywhere in the panel, L1/R1 move to the neighbouring game. */}
      <Focusable
        ref={panelRef}
        className="rs-panel detail"
        flow-children="column"
        role="dialog"
        aria-modal="true"
        aria-label={rom.title}
        onCancelActionDescription="Close"
        onSecondaryButton={best ? () => download(best.entry, best.file) : undefined}
        onSecondaryActionDescription={best ? "Download" : undefined}
        onOptionsButton={onToggleFavorite}
        onOptionsActionDescription={onToggleFavorite ? (favorite ? "Unfavourite" : "Favourite") : undefined}
        onButtonDown={onPanelButton}
        actionDescriptionMap={legend}
      >
        <Focusable
          className="rs-close"
          focusClassName="is-focus"
          title="Close"
          onActivate={onClose}
          onClick={onClose}
          onOKActionDescription="Close"
        >
          ✕
        </Focusable>

        {/* Left: the poster from the panel's top edge, the credits under it. */}
        <aside className="rs-detail-side">
          <div
            className="rs-detail-poster"
            style={{
              aspectRatio:
                posterRatio && !resizedCover ? String(clampArtRatio(posterRatio)) : systemAspect(rom.system),
            }}
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
              <div className="rs-detail-cover-placeholder">{rom.title.slice(0, 2).toUpperCase()}</div>
            )}
          </div>
          {facts.length > 0 ? (
            <dl className="rs-facts">
              {facts.map(([label, value]) => (
                <div className="rs-fact" key={label}>
                  <dt>{label}</dt>
                  <dd title={value}>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </aside>

        {/* Right: one scroll area, ordered by what people come here to do. */}
        <Focusable ref={contentRef} className="rs-detail-content" flow-children="column">
          <HeroBackdrop url={hero} />

          <header className="rs-detail-head">
            <div className="rs-detail-eyebrow">{systemName}</div>
            <h2 className="rs-detail-title">{rom.title}</h2>
            <div className="rs-kvs">
              {rom.rating ? <Stat
                  label="Rating"
                  tone="rating"
                  value={
                    <>
                      <FaStar /> {rom.rating.toFixed(1)}
                    </>
                  }
                /> : null}
              {rom.downloads ? <Stat label="Downloads" value={formatCount(rom.downloads)} /> : null}
              {rom.year ? <Stat label="Released" value={String(rom.year)} /> : null}
              {rom.regions.length ? <Stat label="Region" value={rom.regions.join(" · ")} /> : null}
            </div>
            {rom.installed || details?.installed ? (
              <div className="rs-owned-note">
                <FaCheck /> In your library
              </div>
            ) : null}
          </header>

          {/* A row: left/right between Download and the star. */}
          <Focusable className="rs-get" flow-children="row">
            {best ? (
              <>
                <Button
                  className="rs-get-btn"
                  disabled={busy === best.file.id}
                  onClick={() => download(best.entry, best.file)}
                  onOKActionDescription="Download"
                  // Back at the top: show the title and art again, not just the button.
                  onGamepadFocus={() => {
                    if (contentRef.current) contentRef.current.scrollTop = 0;
                  }}
                >
                  <FaDownload />
                  {busy === best.file.id ? "Starting…" : "Download"}
                </Button>
                <div className="rs-get-file">
                  <div className="rs-get-name" title={fileName(best.file)}>
                    {fileName(best.file)}
                  </div>
                  <div className="rs-get-meta">
                    {fileMeta(best.entry, best.file).map((part, index) => (
                      <span key={index} className={index === 0 ? "rs-file-source" : undefined}>
                        {part}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            ) : loading ? (
              <div className="rs-get-wait">
                <div className="rs-spinner" /> Finding download links…
              </div>
            ) : (
              <div className="rs-get-wait">No download links were found for this title.</div>
            )}
            {onToggleFavorite ? (
              <Focusable
                className={`rs-fav${favorite ? " on" : ""}`}
                focusClassName="is-focus"
                title={favorite ? "Remove from favourites" : "Add to favourites"}
                onActivate={onToggleFavorite}
                onClick={onToggleFavorite}
                onOKActionDescription={favorite ? "Unfavourite" : "Favourite"}
              >
                {favorite ? <FaStar /> : <FaRegStar />}
              </Focusable>
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
                  <b>
                    {bios.optional ? `${bios.label} (optional)` : `Needs a ${bios.label}`}
                  </b>
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
            <section className="rs-detail-section">
              <div className="rs-section-head">
                <span>Other versions</span>
                {others.length > 0 ? <span className="rs-section-count">{others.length}</span> : null}
              </div>
              <div className="rs-versions">
                {others.map(({ entry, file }) => (
                  <div className="rs-version" key={file.id}>
                    <div className="rs-version-main">
                      <div className="rs-version-name" title={fileName(file)}>
                        {fileName(file)}
                      </div>
                      <div className="rs-version-meta">
                        {fileMeta(entry, file).map((part, index) => (
                          <span key={index} className={index === 0 ? "rs-file-source" : undefined}>
                            {part}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      className="rs-version-btn"
                      disabled={busy === file.id}
                      onClick={() => download(entry, file)}
                      onOKActionDescription="Download this version"
                    >
                      <FaDownload />
                      {busy === file.id ? "Starting…" : "Download"}
                    </Button>
                  </div>
                ))}
              </div>
              {failures.map((entry) => (
                <div key={entry.key} className="rs-version-error">
                  {SOURCE_LABELS[entry.source] ?? entry.source}: {entry.error}
                </div>
              ))}
            </section>
          ) : null}

          {media?.shots?.length || media?.trailer ? (
            <section className="rs-detail-section">
              <div className="rs-section-head">
                <span>Media</span>
              </div>
              <MediaGallery media={media} />
            </section>
          ) : null}

          {media?.summary ? (
            <section className="rs-detail-section">
              <div className="rs-section-head">
                <span>About</span>
              </div>
              <p className="rs-summary">{media.summary}</p>
            </section>
          ) : null}

          {/* Rarely changed, so it sits at the end rather than above the files. */}
          <section className="rs-detail-section">
            <div className="rs-dest">
              <FaFolder className="rs-dest-icon" />
              <span className="rs-dest-label">Save to</span>
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
            </div>
          </section>
        </Focusable>
      </Focusable>
    </div>
  );
};

export default RomDetail;
