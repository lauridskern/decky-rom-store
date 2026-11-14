import { CSSProperties, FC, useEffect, useMemo, useState } from "react";
import { toaster } from "@decky/api";
import {
  getDetails,
  startDownload,
  LibraryInfo,
  MergedRom,
  RomEntry,
  RomFile,
} from "../types";
import { Dropdown } from "@decky/ui";
import { formatBytes, formatCount, systemLabel } from "./common";
import CoverImage from "./CoverImage";

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
      <div className="rs-panel detail">
        <div className="rs-panel-head">
          <h3>{rom.title}</h3>
          <button className="rs-btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="rs-panel-body">
          <div className="rs-detail-grid">
            <div>
              {primary?.cover_full || rom.cover ? (
                <div
                  className="rs-detail-cover rs-detail-cover-sm"
                  style={
                    (primary?.cover_full ?? rom.cover)
                      ? ({ ["--rs-cover" as string]: `url(${primary?.cover_full ?? rom.cover})` } as CSSProperties)
                      : undefined
                  }
                >
                  <CoverImage url={primary?.cover_full ?? rom.cover} kind="detail" alt={rom.title} eager />
                </div>
              ) : (
                <div className="rs-detail-cover-placeholder">{rom.title.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="rs-form-row" style={{ marginTop: 12, flexDirection: "column", alignItems: "stretch" }}>
                <label style={{ flex: "0 0 auto" }}>Save into</label>
                <Dropdown
                  rgOptions={systems.map((item) => ({ label: item.label, data: item.key }))}
                  selectedOption={target}
                  onChange={(option) => setTarget(option.data)}
                  menuLabel="System"
                />
                <div className="rs-hint rs-path">{destination}</div>
              </div>
            </div>

            <div>
              <h2 className="rs-detail-title">{rom.title}</h2>
              <div className="rs-detail-meta">
                <span className="rs-pill system">{systemLabel(rom.system)}</span>
                {rom.regions.map((region) => (
                  <span key={region} className="rs-pill region">
                    {region}
                  </span>
                ))}
                {rom.rating ? <span className="rs-pill rating">★ {rom.rating.toFixed(1)}</span> : null}
                {rom.downloads ? <span className="rs-pill">↓ {formatCount(rom.downloads)} downloads</span> : null}
                {rom.year ? <span className="rs-pill">{rom.year}</span> : null}
              </div>

              {primary?.developer || primary?.publisher ? (
                <div className="rs-meta" style={{ marginBottom: 10 }}>
                  {primary.developer ? <span className="rs-pill">{primary.developer}</span> : null}
                  {primary.publisher ? <span className="rs-pill">{primary.publisher}</span> : null}
                  {(primary?.genres ?? []).slice(0, 4).map((genre) => (
                    <span key={genre} className="rs-pill">
                      {genre}
                    </span>
                  ))}
                </div>
              ) : null}

              {loading && (
                <div className="rs-loading">
                  <div className="rs-spinner" /> Resolving download links…
                </div>
              )}
              {!loading && variants.length === 0 && <div className="rs-hint">No downloadable variants found.</div>}

              {!loading &&
                variants
                  .filter((entry) => entry.files.length > 0 || entry.error)
                  .map((entry) => (
                  <div key={entry.key} style={{ marginBottom: 14 }}>
                    {entry.error ? <div className="rs-hint rs-error">{entry.error}</div> : null}
                    {entry.files.length === 0 && !entry.error ? (
                      <div className="rs-hint">No files listed for this source.</div>
                    ) : null}
                    {entry.files.map((file) => (
                      <div className="rs-variant" key={file.id}>
                        <div className="rs-variant-main">
                          <div className="rs-variant-name" title={file.filename || file.url}>
                            {file.filename || file.url.split("/").pop() || "Download"}
                          </div>
                          <div className="rs-variant-sub">
                            {file.label ? `${file.label} · ` : ""}
                            {file.size ? formatBytes(file.size) : "size unknown"}
                            {file.region ? ` · ${file.region}` : ""}
                          </div>
                        </div>
                        <button
                          className="rs-btn"
                          disabled={busy === file.id}
                          onClick={() => download(entry, file)}
                        >
                          {busy === file.id ? "Starting…" : "Download"}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RomDetail;
