"""Every source parser against pages recorded from the live site.

These catch parser regressions offline (tools/selftest.py is the live check).
When a site changes its HTML: fix the parser, then re-record with
`python3 tools/record_fixtures.py <source>`.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from backend.service import SOURCE_DEFS  # noqa: E402
from backend.systems import known_systems  # noqa: E402
from http_fixtures import ReplayHttp, fixture_path, load  # noqa: E402

KNOWN = {system["key"] for system in known_systems()}


def build(source_id: str, http):
    definition = SOURCE_DEFS[source_id]
    return definition["cls"](http, {
        "source_id": source_id,
        "label": definition["label"],
        "homepage": definition["homepage"],
        "base_url": definition["homepage"],
    })


class SourceParsers(unittest.TestCase):
    def check(self, source_id: str) -> None:
        if not os.path.isfile(fixture_path(source_id)):
            self.skipTest(f"no fixture recorded for {source_id}")
        fixture = load(source_id)
        expected = fixture["expected"]
        source = build(source_id, ReplayHttp(fixture["calls"]))

        async def run():
            if fixture["query"] is None:
                entries = (await source.browse("switch", limit=10))[:10]
            else:
                entries = await source.search(fixture["query"], limit=10, page=1)
            target = next(e for e in entries if e.title == expected["resolved_title"])
            files = await source.resolve(target)
            return entries, files

        entries, files = asyncio.run(run())

        # Same pages, same parse.
        self.assertEqual([e.title for e in entries], expected["titles"])
        self.assertEqual([e.system for e in entries], expected["systems"])
        self.assertEqual([f.filename for f in files], expected["files"])

        for entry in entries:
            with self.subTest(entry=entry.title):
                self.assertTrue(entry.title.strip())
                self.assertTrue(entry.url.startswith("http"), entry.url)
                # The client can only load absolute image URLs (Retrostic once
                # sent /img/... paths and its covers never showed).
                if entry.cover:
                    self.assertTrue(entry.cover.startswith("http"), entry.cover)
        known = sum(1 for e in entries if e.system in KNOWN)
        self.assertGreaterEqual(known, len(entries) * 0.8, "most results should map to a known console")
        for file in files:
            # MyAbandonware names its files only when the download starts; the
            # platform label stands in for the name until then.
            self.assertTrue(file.filename or file.label)
            self.assertTrue(file.url.startswith("http"), file.url)

    def test_romspedia(self): self.check("romspedia")
    def test_retrostic(self): self.check("retrostic")
    def test_romsdl(self): self.check("romsdl")
    def test_myabandonware(self): self.check("myabandonware")
    def test_switchroms(self): self.check("switchroms")
    def test_homebrewhub(self): self.check("homebrewhub")
    def test_romsfun(self): self.check("romsfun")


if __name__ == "__main__":
    unittest.main()
