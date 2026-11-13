import { FC } from "react";
import { cancelDownload, clearDownloads, DownloadJob, openFolder } from "../types";
import { formatBytes, formatSpeed } from "./common";

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

const DownloadsDrawer: FC<Props> = ({ jobs, onClose, onRefresh }) => {
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
            <button
              className="rs-btn ghost"
              onClick={() => {
                cancelDownload(job.id);
                onRefresh();
              }}
            >
              Cancel
            </button>
          ) : null}
          {job.status === "done" && job.path ? (
            <button
              className="rs-btn ghost"
              onClick={() => openFolder(job.destination)}
              title={job.path}
            >
              Open folder
            </button>
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
            <span className="rs-path" style={{ fontSize: 10, opacity: 0.75 }}>
              {job.path}
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="rs-overlay" style={{ justifyContent: "flex-end", padding: 0 }} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="rs-panel drawer">
        <div className="rs-panel-head">
          <h3>Downloads{active.length ? ` (${active.length} active)` : ""}</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="rs-btn ghost"
              onClick={() => {
                clearDownloads();
                onRefresh();
              }}
            >
              Clear finished
            </button>
            <button className="rs-btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="rs-panel-body">
          {jobs.length === 0 && <div className="rs-hint">Nothing downloaded yet.</div>}
          {active.map(render)}
          {finished.length > 0 && <div className="rs-section-title">Finished</div>}
          {finished.map(render)}
        </div>
      </div>
    </div>
  );
};

export default DownloadsDrawer;
