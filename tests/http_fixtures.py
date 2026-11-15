"""Record the sites' responses once, replay them in the tests.

RecordingHttp is a real HttpClient that also keeps every response it gets.
ReplayHttp answers from such a recording and never touches the network, so the
parser tests run offline and give the same answer every time. A request that
was not recorded fails loudly: a parser that suddenly asks for other pages is a
change worth looking at.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
from typing import Any, Dict, Optional

from backend.httpclient import HttpClient, HttpError, Response

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def _key(method: str, url: str, data: Optional[bytes]) -> str:
    digest = hashlib.sha1(data or b"").hexdigest()[:10]
    return f"{method} {url} {digest}"


class RecordingHttp(HttpClient):
    def __init__(self) -> None:
        super().__init__()
        self.calls: Dict[str, Dict[str, Any]] = {}

    async def request(self, url: str, method: str = "GET", data: Optional[bytes] = None,
                      headers: Optional[Dict[str, str]] = None, allow_redirects: bool = True,
                      max_bytes: int = 8 * 1024 * 1024, retries: int = 2, polite: bool = True) -> Response:
        try:
            resp = await super().request(url, method, data, headers, allow_redirects, max_bytes, retries, polite)
        except HttpError as exc:
            self.calls[_key(method, url, data)] = {"error": str(exc), "status": exc.status}
            raise
        self.calls[_key(method, url, data)] = {
            "status": resp.status,
            "url": resp.url,
            "headers": dict(resp.headers),
            "body": base64.b64encode(resp.body).decode("ascii"),
        }
        return resp

    async def resolve_redirect(self, url: str, headers: Optional[Dict[str, str]] = None, max_hops: int = 8) -> str:
        final = await super().resolve_redirect(url, headers, max_hops)
        self.calls[_key("REDIRECT", url, None)] = {"final": final}
        return final


class ReplayHttp(HttpClient):
    def __init__(self, calls: Dict[str, Dict[str, Any]]) -> None:
        super().__init__()
        self.calls = calls

    def _lookup(self, key: str) -> Dict[str, Any]:
        if key not in self.calls:
            raise HttpError(f"not in the recording: {key}")
        return self.calls[key]

    async def request(self, url: str, method: str = "GET", data: Optional[bytes] = None,
                      headers: Optional[Dict[str, str]] = None, allow_redirects: bool = True,
                      max_bytes: int = 8 * 1024 * 1024, retries: int = 2, polite: bool = True) -> Response:
        item = self._lookup(_key(method, url, data))
        if "error" in item:
            raise HttpError(item["error"], item.get("status"), url)
        return Response(
            status=item["status"],
            url=item["url"],
            headers=item.get("headers") or {},
            body=base64.b64decode(item["body"]),
        )

    async def resolve_redirect(self, url: str, headers: Optional[Dict[str, str]] = None, max_hops: int = 8) -> str:
        return self._lookup(_key("REDIRECT", url, None))["final"]


def fixture_path(source_id: str) -> str:
    return os.path.join(FIXTURES, f"{source_id}.json.gz")


def save(source_id: str, payload: Dict[str, Any]) -> None:
    os.makedirs(FIXTURES, exist_ok=True)
    with gzip.open(fixture_path(source_id), "wt", encoding="utf-8") as fh:
        json.dump(payload, fh)


def load(source_id: str) -> Dict[str, Any]:
    with gzip.open(fixture_path(source_id), "rt", encoding="utf-8") as fh:
        return json.load(fh)
