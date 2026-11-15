"""Record fresh test fixtures for the source parsers (needs the network).

    python3 tools/record_fixtures.py                # every source
    python3 tools/record_fixtures.py romspedia      # one source

For each source it runs one search, resolves the download links of the first
result, and saves every response plus what the parser made of them to
tests/fixtures/<source>.json.gz. Re-record when a site changes its HTML and the
parser has been fixed for it; tests/test_sources.py then replays the new pages.
"""

from __future__ import annotations

import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))

from backend.service import SOURCE_DEFS  # noqa: E402
from http_fixtures import RecordingHttp, save  # noqa: E402

# A query each site has plenty of results for.
QUERIES = {
    "romspedia": "mario",
    "retrostic": "mario",
    "romsdl": "mario",
    "myabandonware": "doom",
    "switchroms": "zelda",
    "nswpedia": "zelda",
    "romsfun": "super mario world",
}


def build(source_id: str, http):
    definition = SOURCE_DEFS[source_id]
    options = {
        "source_id": source_id,
        "label": definition["label"],
        "homepage": definition["homepage"],
        "base_url": definition["homepage"],
    }
    return definition["cls"](http, options)


async def record(source_id: str) -> None:
    http = RecordingHttp()
    source = build(source_id, http)
    query = QUERIES[source_id]
    try:
        if query is None:
            entries = (await source.browse("switch", limit=10))[:10]
        else:
            entries = await source.search(query, limit=10, page=1)
    except Exception as exc:
        print(f"{source_id:<14} search failed, not recorded: {exc}")
        return
    if not entries:
        print(f"{source_id:<14} no results, not recorded")
        return
    files = []
    resolved = entries[0]
    try:
        files = await source.resolve(resolved)
    except Exception as exc:
        print(f"{source_id:<14} resolve failed: {exc}")
    save(source_id, {
        "query": query,
        "calls": http.calls,
        "expected": {
            "count": len(entries),
            "titles": [entry.title for entry in entries],
            "systems": [entry.system for entry in entries],
            "resolved_title": resolved.title,
            "files": [file.filename for file in files],
        },
    })
    print(f"{source_id:<14} {len(entries)} results, {len(files)} file(s), {len(http.calls)} responses recorded")


async def main() -> None:
    wanted = sys.argv[1:] or list(QUERIES)
    for source_id in wanted:
        await record(source_id)


if __name__ == "__main__":
    asyncio.run(main())
