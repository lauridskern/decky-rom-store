#!/usr/bin/env python3
"""End-to-end check of the ROM Store backend against the live sites.

Usage:  python3 tools/selftest.py [search-term]

Downloads are written to a temporary folder, never into the real ROM library.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from backend.service import StoreService  # noqa: E402
from backend.settings import Settings  # noqa: E402


def banner(text: str) -> None:
    print(f"\n=== {text} " + "=" * max(0, 60 - len(text)))


async def main(term: str) -> int:
    tmp = tempfile.mkdtemp(prefix="romstore-selftest-")
    settings = Settings(os.path.join(tmp, "settings.json"))
    settings.update({"roms_root": os.path.join(tmp, "roms"), "max_concurrent": 2})
    service = StoreService(settings)

    banner("library detection")
    library = service.library()
    print("root:", library["root"])
    print("candidates:", library["candidates"][:5])

    banner(f"search: {term!r}")
    payload = await service.search(term, limit=25)
    print("results:", payload["count"])
    for rom in payload["results"][:12]:
        print(f"  {rom['title'][:38]:40} {rom['system']:8} sources={','.join(rom['sources']):28} "
              f"rating={rom['rating']} dl={rom['downloads']} regions={rom['regions']}")
    if payload["errors"]:
        print("source errors:", payload["errors"])

    if not payload["results"]:
        print("no results - aborting")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1

    banner("details + download (first result)")
    rom = payload["results"][0]
    details = await service.details(rom["id"])
    if not details:
        print("no details")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1

    for entry in details["entries"]:
        print(f"  [{entry['source']}] {entry['title'][:40]:42} files={len(entry['files'])}")
        for f in entry["files"]:
            print(f"      {f['id']}: {f['filename'] or '(resolved at download time)'} "
                  f"size={f['size']} url={f['url'][:90]}")

    target_entry = next((e for e in details["entries"] if e["files"]), None)
    if not target_entry:
        print("no downloadable file found")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1

    started = await service.start_download(
        rom["id"], target_entry["key"], target_entry["files"][0]["id"]
    )
    print("start:", started.get("ok"), started.get("error", ""))
    job = started.get("job")
    if not job:
        shutil.rmtree(tmp, ignore_errors=True)
        return 1

    while True:
        await asyncio.sleep(0.6)
        jobs = service.downloads.snapshot()
        current = next((j for j in jobs if j["id"] == job["id"]), None)
        if not current:
            break
        pct = (current["received"] / current["total"] * 100) if current.get("total") else 0
        print(f"    {current['status']:12} {current['received']:>12,} bytes "
              f"({pct:5.1f}%) {current['speed']:>10,.0f} B/s")
        if current["status"] in ("done", "error", "cancelled"):
            break

    final = next((j for j in service.downloads.snapshot() if j["id"] == job["id"]), None)
    if final:
        print("final:", final["status"], final.get("error") or final.get("path"))
        if final.get("path") and os.path.exists(final["path"]):
            print("file size on disk:", os.path.getsize(final["path"]))
            with open(final["path"], "rb") as fh:
                print("magic:", fh.read(4))

    banner("browse (switch)")
    browse = await service.browse("switch", limit=8)
    print("results:", browse["count"])
    for item in browse["results"][:8]:
        print(f"  {item['title'][:45]:47} {item['system']}")

    shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    query = sys.argv[1] if len(sys.argv) > 1 else "mario"
    sys.exit(asyncio.run(main(query)))
