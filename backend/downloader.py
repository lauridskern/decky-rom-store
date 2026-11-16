"""Download queue with progress reporting and optional archive extraction."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import threading
import time
import zipfile

from .unpack import archive_ext, main_file, unpack
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .htmlutil import safe_filename
from .httpclient import HttpClient, HttpError

STATUS_QUEUED = "queued"
STATUS_DOWNLOADING = "downloading"
STATUS_EXTRACTING = "extracting"
STATUS_DONE = "done"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelled"


@dataclass
class DownloadJob:
    id: str
    title: str
    system: str
    source: str
    filename: str
    url: str
    destination: str
    status: str = STATUS_QUEUED
    received: int = 0
    total: int = 0
    speed: float = 0.0
    error: Optional[str] = None
    created: float = field(default_factory=time.time)
    finished: Optional[float] = None
    path: Optional[str] = None
    extracted_to: Optional[str] = None
    headers: Dict[str, str] = field(default_factory=dict)
    extract: bool = False
    keep_archive: bool = True
    # Timing, for the provider speed ranking (backend/speeds.py): how long the
    # site took to hand out the link, and the transfer itself.
    prepare_seconds: float = 0.0
    transfer_started: Optional[float] = None
    resumed_from: int = 0
    # The game's cover, for the Downloads tab.
    cover: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "system": self.system,
            "source": self.source,
            "filename": self.filename,
            "url": self.url,
            "destination": self.destination,
            "status": self.status,
            "received": self.received,
            "total": self.total,
            "speed": self.speed,
            "error": self.error,
            "path": self.path,
            "extracted_to": self.extracted_to,
            "created": self.created,
            "finished": self.finished,
            "cover": self.cover,
        }


class DownloadManager:
    """Keeps a small queue of downloads running in the background.

    The queue is saved to ``state_path``. A download that was running when the
    plugin stopped (Steam restarted, the Deck went to sleep or was turned off)
    keeps its ``.part`` file and continues from there on the next start, see
    ``resume_pending``.
    """

    def __init__(self, http: HttpClient, max_concurrent: int = 2, state_path: Optional[str] = None):
        self._http = http
        self._max_concurrent = max(1, max_concurrent)
        self._jobs: Dict[str, DownloadJob] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        self._cancels: Dict[str, threading.Event] = {}
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._lock = threading.Lock()
        self._counter = 0
        self._state_path = state_path
        self._saved_at = 0.0
        self._suspending = False
        self._pending: List[str] = []
        # Called with each job that finished (the plugin tells the frontend,
        # which adds the game to the Steam library).
        self.on_done = None
        # Called with (job, bytes, seconds) for each finished transfer.
        self.on_measure = None
        self._load()

    # ------------------------------------------------------------------ state
    def _load(self) -> None:
        if not self._state_path or not os.path.isfile(self._state_path):
            return
        try:
            with open(self._state_path, "r", encoding="utf-8") as fh:
                stored = json.load(fh)
        except (OSError, ValueError):
            return
        known = set(DownloadJob.__dataclass_fields__)
        for item in stored if isinstance(stored, list) else []:
            try:
                job = DownloadJob(**{k: v for k, v in item.items() if k in known})
            except TypeError:
                continue
            if job.status in (STATUS_QUEUED, STATUS_DOWNLOADING, STATUS_EXTRACTING):
                # It was cut off; it goes back in the queue and continues.
                job.status = STATUS_QUEUED
                job.speed = 0.0
                self._pending.append(job.id)
            self._jobs[job.id] = job
            self._cancels[job.id] = threading.Event()
        self._counter = len(self._jobs)

    def _save(self, force: bool = False) -> None:
        """Write the queue, at most every few seconds unless forced."""
        if not self._state_path:
            return
        now = time.time()
        if not force and now - self._saved_at < 3.0:
            return
        self._saved_at = now
        with self._lock:
            jobs = [
                {**job.to_dict(), "headers": job.headers, "extract": job.extract, "keep_archive": job.keep_archive}
                for job in self._jobs.values()
            ]
        try:
            os.makedirs(os.path.dirname(self._state_path), exist_ok=True)
            temp = self._state_path + ".tmp"
            with open(temp, "w", encoding="utf-8") as fh:
                json.dump(jobs, fh)
            os.replace(temp, self._state_path)
        except OSError:
            pass

    def resume_pending(self) -> int:
        """Continue the downloads that were running when the plugin stopped."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - defensive
            return 0
        started = 0
        for job_id in self._pending:
            job = self._jobs.get(job_id)
            if job and job.status == STATUS_QUEUED:
                self._tasks[job_id] = loop.create_task(self._run(job, job.extract, job.keep_archive, resume=True))
                started += 1
        self._pending = []
        return started

    async def suspend_all(self) -> None:
        """Stop for now, keeping partial files so the next start continues.

        The transfer runs on a worker thread, which cancelling the asyncio task
        does not stop: it is told to stop through its cancel event and waited
        for, so nothing writes to a .part file after the queue is saved.
        """
        self._suspending = True
        for event in self._cancels.values():
            event.set()
        tasks = [task for task in self._tasks.values() if not task.done()]
        if tasks:
            done, pending = await asyncio.wait(tasks, timeout=8)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        self._save(force=True)

    # ------------------------------------------------------------------ public
    def set_max_concurrent(self, value: int) -> None:
        self._max_concurrent = max(1, min(int(value or 1), 6))
        self._semaphore = None

    def snapshot(self) -> List[Dict[str, Any]]:
        with self._lock:
            jobs = list(self._jobs.values())
        jobs.sort(key=lambda job: job.created, reverse=True)
        return [job.to_dict() for job in jobs]

    def get(self, job_id: str) -> Optional[DownloadJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def clear_finished(self) -> None:
        with self._lock:
            for job_id, job in list(self._jobs.items()):
                if job.status in (STATUS_DONE, STATUS_ERROR, STATUS_CANCELLED):
                    self._jobs.pop(job_id, None)
        self._save(force=True)

    def enqueue(self, *, title: str, system: str, source: str, filename: str, url: str,
                destination: str, headers: Optional[Dict[str, str]] = None,
                extract: bool = False, keep_archive: bool = True,
                prepare_seconds: float = 0.0, cover: Optional[str] = None) -> DownloadJob:
        with self._lock:
            self._counter += 1
            job_id = f"dl-{int(time.time())}-{self._counter}"
            job = DownloadJob(
                id=job_id,
                title=title,
                system=system,
                source=source,
                filename=filename,
                url=url,
                destination=destination,
                headers=headers or {},
                extract=extract,
                keep_archive=keep_archive,
                prepare_seconds=prepare_seconds,
                cover=cover,
            )
            self._jobs[job_id] = job
            self._cancels[job_id] = threading.Event()
            self._forget_finished()
        self._save(force=True)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - defensive
            loop = None
        if loop is not None:
            self._tasks[job_id] = loop.create_task(self._run(job, extract, keep_archive))
        return job

    def _forget_finished(self, keep: int = 40) -> None:
        """Do not hold every completed job for the life of the plugin."""
        if len(self._jobs) <= keep * 2:
            return
        finished = [
            (job.finished or 0.0, job_id)
            for job_id, job in self._jobs.items()
            if job.status in (STATUS_DONE, STATUS_CANCELLED, STATUS_ERROR)
        ]
        finished.sort()
        for _when, job_id in finished[: max(0, len(self._jobs) - keep)]:
            self._jobs.pop(job_id, None)
            self._cancels.pop(job_id, None)
            self._tasks.pop(job_id, None)

    def cancel(self, job_id: str) -> bool:
        cancel = self._cancels.get(job_id)
        if cancel:
            cancel.set()
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        job = self.get(job_id)
        if job and job.status in (STATUS_QUEUED, STATUS_DOWNLOADING):
            job.status = STATUS_CANCELLED
            job.finished = time.time()
            if job.path:
                self._remove(job.path + ".part")
            self._save(force=True)
            return True
        return False

    async def wait_all(self) -> None:
        tasks = list(self._tasks.values())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ------------------------------------------------------------------ worker
    async def _run(self, job: DownloadJob, extract: bool, keep_archive: bool, resume: bool = False) -> None:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self._max_concurrent)
        cancel = self._cancels.get(job.id) or threading.Event()
        temp_path: Optional[str] = None
        try:
            async with self._semaphore:
                if cancel.is_set():
                    job.status = STATUS_CANCELLED
                    return
                job.status = STATUS_DOWNLOADING
                os.makedirs(job.destination, exist_ok=True)
                name = safe_filename(job.filename or job.url.rsplit("/", 1)[-1] or f"{job.title}.zip")
                final_path = os.path.join(job.destination, name)
                temp_path = final_path + ".part"
                job.path = final_path
                job.transfer_started = time.time()
                job.resumed_from = os.path.getsize(temp_path) if resume and os.path.exists(temp_path) else 0

                last = time.time()
                last_bytes = 0

                def progress(received: int, total: int) -> None:
                    nonlocal last, last_bytes
                    job.received = received
                    if total:
                        job.total = total
                    now = time.time()
                    if now - last >= 0.4:
                        job.speed = (received - last_bytes) / max(now - last, 0.001)
                        last = now
                        last_bytes = received
                    self._save()

                last_error: Optional[str] = None
                for attempt in range(3):
                    try:
                        # Retries (and a download picked up after a restart)
                        # continue the partial file instead of starting over.
                        await self._http.download(
                            job.url, temp_path, headers=job.headers, on_progress=progress, cancel=cancel,
                            resume=resume or attempt > 0,
                        )
                        last_error = None
                        break
                    except HttpError as exc:
                        last_error = str(exc)
                        if cancel.is_set():
                            raise
                        if "Not enough free space" in last_error:
                            break
                        if resume and exc.status in (401, 403, 404, 410):
                            # The site's download links expire after a while.
                            last_error = "The download link has expired. Start it again from the game page."
                            break
                        if attempt < 2:
                            await asyncio.sleep(1.0 * (attempt + 1))
                if last_error:
                    raise HttpError(last_error)
                transfer_seconds = time.time() - (job.transfer_started or time.time())

                if cancel.is_set():
                    if self._suspending:
                        job.status = STATUS_QUEUED
                        job.speed = 0.0
                        return
                    self._remove(temp_path)
                    job.status = STATUS_CANCELLED
                    job.finished = time.time()
                    return

                # Never overwrite an existing game without asking.
                if os.path.exists(final_path):
                    final_path = self._unique_path(final_path)
                    job.path = final_path
                os.replace(temp_path, final_path)
                job.received = os.path.getsize(final_path)
                if not job.total:
                    job.total = job.received

                if extract and archive_ext(final_path):
                    job.status = STATUS_EXTRACTING
                    self._save(force=True)
                    # Off the event loop: a disc image takes a while.
                    try:
                        produced = await asyncio.to_thread(unpack, final_path, job.destination)
                    except RuntimeError as exc:
                        produced = []
                        job.error = f"Downloaded, but not unpacked: {exc}"
                    extracted = main_file(produced)
                    job.extracted_to = extracted
                    if extracted and not keep_archive:
                        self._remove(final_path)
                        job.path = extracted

                job.status = STATUS_DONE
                job.finished = time.time()
                self._save(force=True)
                if self.on_measure is not None:
                    try:
                        self.on_measure(job, max(0, job.received - job.resumed_from), transfer_seconds)
                    except Exception:  # pragma: no cover - statistics must not fail a download
                        pass
                if self.on_done is not None:
                    try:
                        self.on_done(job)
                    except Exception:  # pragma: no cover - a listener must not fail a download
                        pass
        except asyncio.CancelledError:
            if self._suspending and job.status != STATUS_CANCELLED:
                # The plugin is stopping: keep the partial file for next time.
                job.status = STATUS_QUEUED
                job.speed = 0.0
                raise
            job.status = STATUS_CANCELLED
            job.finished = time.time()
            self._remove(temp_path)
            self._save(force=True)
            raise
        except HttpError as exc:
            if self._suspending:
                # Stopped by suspend_all: the partial file stays for next time.
                job.status = STATUS_QUEUED
                job.speed = 0.0
                return
            job.status = STATUS_ERROR
            job.error = str(exc)
            job.finished = time.time()
            self._remove(temp_path)
            self._save(force=True)
        except Exception as exc:  # pragma: no cover - defensive
            job.status = STATUS_ERROR
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished = time.time()
            self._remove(temp_path)
            self._save(force=True)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _unique_path(path: str) -> str:
        stem, ext = os.path.splitext(path)
        index = 2
        while os.path.exists(f"{stem} ({index}){ext}"):
            index += 1
        return f"{stem} ({index}){ext}"

    @staticmethod
    def _remove(path: Optional[str]) -> None:
        if not path:
            return
        try:
            os.remove(path)
        except OSError:
            pass

    @staticmethod
    def _extract_zip(archive: str, destination: str) -> Optional[str]:
        """Extract a zip into the destination folder, flattening the structure."""
        try:
            with zipfile.ZipFile(archive) as zf:
                members = [m for m in zf.infolist() if not m.is_dir()]
                if not members:
                    return None
                if len(members) == 1 and not os.path.dirname(members[0].filename):
                    target = os.path.join(destination, safe_filename(members[0].filename))
                    with zf.open(members[0]) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    return target
                for member in members:
                    name = safe_filename(os.path.basename(member.filename))
                    if not name:
                        continue
                    target = os.path.join(destination, name)
                    with zf.open(member) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                return destination
        except (zipfile.BadZipFile, OSError):
            return None
