import { CSSProperties, FC, useEffect, useMemo, useState } from "react";
import { toaster } from "@decky/api";
import {
  getCover,
  getDetails,
  startDownload,
  LibraryInfo,
  MergedRom,
  RomEntry,
  RomFile,
} from "../types";
import { Button, Dropdown } from "@decky/ui";
import { FaDownload } from "react-icons/fa";
import { formatBytes, formatCount, SOURCE_LABELS, systemAspect, systemLabel } from "./common";
import CoverImage from "./CoverImage";
import MediaGallery from "./MediaGallery";
import { useBackGuard } from "./useBackGuard";

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
    <div
      className="rs-detail-hero-art"
      style={{ backgroundImage: `url("${src}")` } as CSSProperties}
    />
  );
};

interface Props {
  rom: MergedRom;
  library: LibraryInfo | null;
  onClose: () => void;
  onStarted: () => void;
}

const RomDetail: FC<Props> = ({ rom, library, onClose, onStarted }) => {
  const [details, setDetails] = useState<MergedRom | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // The Steam back button closes this overlay instead of leaving the plugin.
  useBackGuard(true, onClose);
  const [target, setTarget] = useState<string>(rom.system);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDetails(rom.id)
      .then((result) => {
        if (!cancelled) setDetails(result);
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
  // A screenshot makes a far better hero than a blown-up cover.
  const hero = media?.header ?? media?.shots?.[0]?.thumb ?? cover;

  const systems = useMemo(() => {
    const list = library?.systems ?? [];
    const known = new Map<string, string>();
    list.forEach((item) => known.set(item.key, item.label));
    known.set(rom.system, systemLabel(rom.system));
    return Array.from(known.entries()).map(([key, label]) => ({ key, label }));
  }, [library, rom.system]);

  const destination = useMemo(() => {
    const found = library?.systems?.find((item) => item.key === target);
    if (found) return found.path;
    const root = library?.root ?? "";
    return root ? `${root}/${target}` : target;
  }, [library, target]);

  const genres = media?.genres?.length ? media.genres : (primary?.genres ?? []);
  const developer = media?.developers?.length ? media.developers[0] : primary?.developer;
  const publisher = media?.developers?.length ? media.developers[1] : primary?.publisher;
  const year = rom.year;
  const files = variants.flatMap((entry) => entry.files.map((file) => ({ entry, file })));

  const download = async (entry: RomEntry, file: RomFile) => {
    setBusy(file.id);
    try {
      const result = await startDownload(rom.id, entry.key, file.id, target, null);
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

  return (
    <div className="rs-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="rs-panel detail" role="dialog" aria-modal="true" aria-label={rom.title}>
        <div className="rs-detail-hero">
          <HeroBackdrop url={hero} />
          <div className="rs-detail-hero-inner">
            <div className="rs-detail-heading">
              <h2 className="rs-detail-title">{rom.title}</h2>
              <button className="rs-close" onClick={onClose} title="Close" autoFocus>
                ✕
              </button>
            </div>
            <div className="rs-detail-sub">
              {[developer, publisher && publisher !== developer ? publisher : null, year, genres.slice(0, 2).join(" · ")]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
            <div className="rs-detail-badges">
              <span className="rs-pill system">{systemLabel(rom.system)}</span>
              {rom.rating ? (
                <span className="rs-pill rating">★ {rom.rating.toFixed(1)}</span>
              ) : null}
              {rom.downloads ? (
                <span className="rs-pill">↓ {formatCount(rom.downloads)} downloads</span>
              ) : null}
              {rom.regions.map((region) => (
                <span key={region} className="rs-pill region">
                  {region}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rs-detail-body">
          <aside className="rs-detail-side">
            <div className="rs-detail-poster" style={{ aspectRatio: systemAspect(rom.system) }}>
              {cover ? (
                <CoverImage url={cover} kind="detail" alt={rom.title} eager />
              ) : (
                <div className="rs-detail-cover-placeholder">{rom.title.slice(0, 2).toUpperCase()}</div>
              )}
            </div>

            <div className="rs-save">
              <div className="rs-save-label">Save into</div>
              <Dropdown
                rgOptions={systems.map((item) => ({ label: item.label, data: item.key }))}
                selectedOption={target}
                onChange={(option) => setTarget(option.data)}
                menuLabel="System"
              />
              <div className="rs-save-path" title={destination}>
                {destination}
              </div>
            </div>
          </aside>

          <main className="rs-detail-main">
            {media?.summary ? <p className="rs-summary">{media.summary}</p> : null}

            <MediaGallery media={media} />

            {loading ? (
              <div className="rs-detail-loading">
                <div className="rs-spinner" /> Finding download links…
              </div>
            ) : null}

            {!loading && files.length === 0 ? (
              <div className="rs-hint">No download links were found for this title.</div>
            ) : null}

            {files.length > 0 ? (
              <>
                <div className="rs-file-head">
                  <span>Download</span>
                  <span className="rs-file-count">
                    {files.length} {files.length === 1 ? "file" : "files"}
                  </span>
                </div>
                {variants
                  .filter((entry) => entry.files.length > 0 || entry.error)
                  .map((entry) => (
                    <div key={entry.key} className="rs-file-group">
                      {entry.files.map((file) => (
                        <div className="rs-file" key={file.id}>
                          <div className="rs-file-main">
                            <div className="rs-file-name" title={file.filename || file.url}>
                              {file.filename || file.url.split("/").pop() || "Download"}
                            </div>
                            <div className="rs-file-meta">
                              <span className="rs-file-source">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
                              <span className="rs-sep">•</span>
                              <span>{file.size ? formatBytes(file.size) : "size unknown"}</span>
                              {file.region ? (
                                <>
                                  <span className="rs-sep">•</span>
                                  <span>{file.region}</span>
                                </>
                              ) : null}
                              {file.label && file.label !== file.region ? (
                                <>
                                  <span className="rs-sep">•</span>
                                  <span>{file.label}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            className="rs-btn rs-file-btn"
                            disabled={busy === file.id}
                            onClick={() => download(entry, file)}
                          >
                            <FaDownload />
                            {busy === file.id ? "Starting…" : "Download"}
                          </Button>
                        </div>
                      ))}
                      {entry.error ? <div className="rs-hint rs-error">{entry.error}</div> : null}
                    </div>
                  ))}
              </>
            ) : null}
          </main>
        </div>

        <div className="rs-detail-foot">
          <span>
            <b>D-pad</b> move · <b>A</b> select · <b>B</b> close
          </span>
          <span className="rs-detail-foot-dest">{systemLabel(target)} → {destination}</span>
        </div>
      </div>
    </div>
  );
};

export default RomDetail;
