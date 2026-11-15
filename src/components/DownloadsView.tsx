import { FC, useEffect, useRef } from "react";
import { Button, Focusable } from "@decky/ui";
import { FaBan, FaCheck, FaDownload, FaExclamation } from "react-icons/fa";
import { cancelDownload, clearDownloads, DownloadJob } from "../types";
import { boxRatio, formatBytes, formatEta, formatSpeed, SOURCE_LABELS, systemLabel, timeAgo } from "./common";
import CoverImage from "./CoverImage";
import { NoArt } from "./RomCard";
import { focusElement } from "./gamepad";
import { EmptyState, Glyph, Progress } from "./ui";

interface Props {
  jobs: DownloadJob[];
  onRefresh: () => void;
  /** A on a finished download: its page in the store. */
  onOpen: (item: { title: string; system: string; cover?: string | null }) => void;
  onBrowse: () => void;
}

const isActive = (job: DownloadJob) =>
  job.status === "downloading" || job.status === "queued" || job.status === "extracting";

const Thumb: FC<{ job: DownloadJob }> = ({ job }) => (
  <div className="rs-dl-thumb" style={{ aspectRatio: String(Math.min(1.45, Math.max(0.6, boxRatio(job.system)))) }}>
    {job.cover ? <CoverImage url={job.cover} alt="" /> : <NoArt title="" system={job.system} />}
  </div>
);

/**
 * The Downloads tab: what is coming in, with its progress and time left, and
 * what came in before.
 *
 * Gamepad: one column; A on a running download's button cancels it, A on a
 * finished one opens its store page, X clears the finished ones.
 */
const DownloadsView: FC<Props> = ({ jobs, onRefresh, onOpen, onBrowse }) => {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const active = jobs.filter(isActive);
  const finished = jobs.filter((job) => !isActive(job)).sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0));

  const focusFirst = () =>
    focusElement(viewRef.current?.querySelector(".rs-dl-cancel, .rs-dl-row, .rs-empty .rs-btn"));

  // When the row that had focus goes away (cleared, finished), focus moves on
  // instead of getting lost. (Opening the tab puts focus here: Store.focusTab.)
  useEffect(() => {
    window.requestAnimationFrame(() => {
      const current = document.activeElement;
      if (!current || current === document.body) focusFirst();
    });
  }, [jobs.length, active.length]);

  const clearFinished = () => {
    clearDownloads()
      .then(onRefresh)
      .catch(() => undefined);
  };

  return (
    <Focusable
      ref={viewRef}
      className="rs-view rs-scroll"
      data-view="downloads"
      flow-children="column"
      onSecondaryButton={finished.length ? clearFinished : undefined}
      onSecondaryActionDescription={finished.length ? "Clear finished" : undefined}
    >
      <Focusable className="rs-view-head" flow-children="row">
        <div className="rs-view-title">
          <h1 className="rs-h1">Downloads</h1>
          <span className="rs-count">
            {active.length ? `${active.length} in progress` : jobs.length ? "Nothing in progress" : ""}
          </span>
        </div>
        {finished.length ? (
          <Focusable
            className="rs-pill rs-f"
            focusClassName="is-focus"
            onActivate={clearFinished}
            onClick={clearFinished}
            onOKActionDescription="Clear finished"
          >
            <Glyph round>X</Glyph> Clear finished
          </Focusable>
        ) : null}
      </Focusable>

      {jobs.length === 0 ? (
        <EmptyState
          icon={<FaDownload />}
          title="Nothing downloaded yet"
          action={
            <Button className="rs-btn" onClick={onBrowse}>
              Browse the store
            </Button>
          }
        >
          Pick a game in the store and press Download. It shows up here with its progress, and lands in your ROM
          folder.
        </EmptyState>
      ) : null}

      {active.length ? (
        <Focusable className="rs-dl-list" flow-children="column">
          {active.map((job) => {
            const progress = job.total ? Math.min(1, job.received / job.total) : 0;
            const left = job.speed > 0 && job.total ? (job.total - job.received) / job.speed : 0;
            return (
              <div className="rs-dl" key={job.id}>
                <Thumb job={job} />
                <div className="rs-dl-main">
                  <div className="rs-dl-top">
                    <span className="rs-dl-title" title={job.filename}>
                      {job.title}
                    </span>
                    <span className="rs-dl-pct">
                      {job.status === "queued" ? "Queued" : job.status === "extracting" ? "Extracting" : `${Math.round(progress * 100)}%`}
                    </span>
                  </div>
                  <Progress value={job.status === "extracting" ? 1 : progress} />
                  <div className="rs-meta">
                    <span>{systemLabel(job.system)}</span>
                    <span>{SOURCE_LABELS[job.source] ?? job.source}</span>
                    <span>
                      {formatBytes(job.received) || "0B"}
                      {job.total ? ` of ${formatBytes(job.total)}` : ""}
                    </span>
                    {job.speed > 0 ? <span>{formatSpeed(job.speed)}</span> : null}
                    {left > 0 ? <span>{formatEta(left)} left</span> : null}
                  </div>
                </div>
                {job.status !== "extracting" ? (
                  <Button
                    className="rs-btn ghost rs-dl-cancel"
                    onClick={() => {
                      cancelDownload(job.id)
                        .then(onRefresh)
                        .catch(() => undefined);
                    }}
                    onOKActionDescription="Cancel download"
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            );
          })}
        </Focusable>
      ) : null}

      {finished.length ? (
        <section className="rs-section">
          <div className="rs-section-head">
            <h2 className="rs-h2">Finished</h2>
            <span className="rs-count">{finished.length}</span>
          </div>
          <Focusable className="rs-dl-list" flow-children="column">
            {finished.map((job) => (
              <Focusable
                key={job.id}
                className={`rs-dl-row rs-f ${job.status}`}
                focusClassName="is-focus"
                onActivate={() => onOpen({ title: job.title, system: job.system, cover: job.cover })}
                onClick={() => onOpen({ title: job.title, system: job.system, cover: job.cover })}
                onOKActionDescription="Store page"
              >
                <span className="rs-dl-state">
                  {job.status === "done" ? <FaCheck /> : job.status === "error" ? <FaExclamation /> : <FaBan />}
                </span>
                <div className="rs-dl-main">
                  <div className="rs-dl-title" title={job.filename}>
                    {job.title}
                  </div>
                  <div className="rs-meta">
                    <span>{systemLabel(job.system)}</span>
                    {job.status === "done" ? (
                      <>
                        {job.total || job.received ? <span>{formatBytes(job.total || job.received)}</span> : null}
                        {job.finished ? <span>{timeAgo(job.finished)}</span> : null}
                        {job.path ? (
                          <span className="rs-path" title={job.extracted_to ?? job.path}>
                            {job.extracted_to ?? job.path}
                          </span>
                        ) : null}
                      </>
                    ) : job.status === "error" ? (
                      <span className="rs-bad">{job.error || "Failed"}</span>
                    ) : (
                      <span>Cancelled</span>
                    )}
                  </div>
                </div>
              </Focusable>
            ))}
          </Focusable>
        </section>
      ) : null}
    </Focusable>
  );
};

export default DownloadsView;
