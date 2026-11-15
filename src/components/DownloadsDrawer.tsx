import { FC, useEffect, useRef } from "react";
import { Button, Focusable } from "@decky/ui";
import { cancelDownload, clearDownloads, DownloadJob } from "../types";
import { formatBytes, formatSpeed } from "./common";
import { focusElement } from "./gamepad";
import { useBackGuard } from "./useBackGuard";

interface Props {
  jobs: DownloadJob[];
  onClose: () => void;
  onRefresh: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  queued: "#8b949d",
  downloading: "#66c0f4",
  extracting: "#a4d007",
  done: "#a4d007",
  error: "#ff8f6b",
  cancelled: "#8b949d",
};

/**
 * Gamepad: a column of the header buttons and each running download's Cancel.
 * B closes the drawer (useBackGuard), X clears the finished downloads.
 */
const DownloadsDrawer: FC<Props> = ({ jobs, onClose, onRefresh }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The back button closes the drawer instead of leaving the plugin.
  useBackGuard(true, onClose);

  // Focus the first running download's Cancel, or Close when nothing runs.
  useEffect(() => {
    window.requestAnimationFrame(() =>
      focusElement(panelRef.current?.querySelector(".rs-dl-cancel") ?? panelRef.current?.querySelector(".rs-dl-close")),
    );
  }, []);

  const clearFinished = () => {
    clearDownloads();
    onRefresh();
  };

  const active = jobs.filter((job) => job.status === "downloading" || job.status === "queued" || job.status === "extracting");
  const finished = jobs.filter((job) => !active.includes(job));

  const render = (job: DownloadJob) => {
    const percent = job.total ? Math.min(100, (job.received / job.total) * 100) : job.status === "done" ? 100 : 0;
    return (
      <div className="rs-dl-row" key={job.id}>
        <div className="rs-dl-top">
          <div className="rs-dl-name" title={job.filename}>
            {job.title}
          </div>
          <div className="rs-dl-status" style={{ color: STATUS_COLORS[job.status] }}>
            {job.status === "downloading"
              ? `${percent.toFixed(0)}%`
              : job.status === "extracting"
                ? "extracting"
                : job.status}
          </div>
          {job.status === "downloading" || job.status === "queued" ? (
            <Button
              className="rs-btn ghost rs-dl-cancel"
              onClick={() => {
                cancelDownload(job.id);
                onRefresh();
              }}
              onOKActionDescription="Cancel download"
            >
              Cancel
            </Button>
          ) : null}
          {job.status === "error" ? <span className="rs-pill region">{job.error}</span> : null}
        </div>
        {(job.status === "downloading" || job.status === "extracting") && (
          <div className="rs-progress">
            <div style={{ width: `${percent}%` }} />
          </div>
        )}
        <div className="rs-dl-sub">
          <span>
            {formatBytes(job.received)}
            {job.total ? ` / ${formatBytes(job.total)}` : ""}
          </span>
          <span>{formatSpeed(job.speed)}</span>
        </div>
        {job.status === "done" && job.path ? (
          <div className="rs-dl-sub">
            <span className="rs-path" style={{ fontSize: 10, opacity: 0.75 }} title={job.path}>
              {job.path}
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="rs-overlay" style={{ justifyContent: "flex-end", padding: 0 }} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <Focusable
        ref={panelRef}
        className="rs-panel drawer"
        flow-children="column"
        onCancelActionDescription="Close"
        onSecondaryButton={finished.length ? clearFinished : undefined}
        onSecondaryActionDescription={finished.length ? "Clear finished" : undefined}
      >
        <div className="rs-panel-head">
          <h3>Downloads{active.length ? ` (${active.length} active)` : ""}</h3>
          <Focusable className="rs-panel-actions" flow-children="row">
            <Button className="rs-btn ghost" disabled={!finished.length} onClick={clearFinished}>
              Clear finished
            </Button>
            <Button className="rs-btn ghost rs-dl-close" onClick={onClose}>
              Close
            </Button>
          </Focusable>
        </div>
        <div className="rs-panel-body">
          {jobs.length === 0 && <div className="rs-hint">Nothing downloaded yet.</div>}
          {active.map(render)}
          {finished.length > 0 && <div className="rs-section-title">Finished</div>}
          {finished.map(render)}
        </div>
      </Focusable>
    </div>
  );
};

export default DownloadsDrawer;
