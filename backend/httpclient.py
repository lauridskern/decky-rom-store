"""Tiny dependency-free HTTP client.

The Steam Deck ships Python 3.11 and plugin virtualenvs are not guaranteed to
have pip packages available (and the Deck is frequently offline while
emulating), so the whole backend is written against the standard library only:
no requests, no aiohttp, no beautifulsoup.
"""

from __future__ import annotations

import asyncio
import gzip
import ssl
import threading
import time
import urllib.error
import urllib.request
import zlib
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from typing import Callable, Dict, Optional

DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

REDIRECT_CODES = (301, 302, 303, 307, 308)


class HttpError(Exception):
    """Raised when a request fails in a way the caller must handle."""

    def __init__(self, message: str, status: Optional[int] = None, url: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.url = url


@dataclass
class Response:
    status: int
    url: str
    headers: Dict[str, str] = field(default_factory=dict)
    body: bytes = b""

    @property
    def text(self) -> str:
        charset = "utf-8"
        ctype = self.headers.get("content-type", "")
        if "charset=" in ctype:
            charset = ctype.split("charset=", 1)[1].split(";")[0].strip() or "utf-8"
        try:
            return self.body.decode(charset, errors="replace")
        except LookupError:
            return self.body.decode("utf-8", errors="replace")

    def json(self):
        import json

        return json.loads(self.text)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 400


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Stops urllib from silently following redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


class HttpClient:
    """Blocking urllib wrapped in asyncio, with cookies, throttling and streaming."""

    def __init__(self, user_agent: str = DEFAULT_UA, timeout: int = 30, min_interval: float = 0.6):
        self._ua = user_agent
        self._timeout = timeout
        self._min_interval = min_interval
        self._jar = CookieJar()
        self._lock = threading.Lock()
        self._last_request: Dict[str, float] = {}
        ctx = ssl.create_default_context()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar),
            urllib.request.HTTPSHandler(context=ctx),
        )
        self._no_redirect = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar),
            urllib.request.HTTPSHandler(context=ctx),
            _NoRedirect,
        )

    # ------------------------------------------------------------------ utils
    def _throttle(self, host: str) -> None:
        """Keep a small gap between requests to the same host (politeness)."""
        now = time.monotonic()
        with self._lock:
            last = self._last_request.get(host, 0.0)
            wait = self._min_interval - (now - last)
            if wait > 0:
                time.sleep(wait)
            self._last_request[host] = time.monotonic()

    @staticmethod
    def _decode_body(body: bytes, encoding: str) -> bytes:
        encoding = (encoding or "").lower()
        try:
            if "gzip" in encoding:
                return gzip.decompress(body)
            if "deflate" in encoding:
                try:
                    return zlib.decompress(body)
                except zlib.error:
                    return zlib.decompress(body, -zlib.MAX_WBITS)
        except Exception:
            return body
        return body

    def _build_request(self, url: str, method: str, data: Optional[bytes], headers: Dict[str, str]):
        hdrs = {
            "User-Agent": self._ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        }
        hdrs.update(headers or {})
        return urllib.request.Request(url, data=data, headers=hdrs, method=method.upper())

    def _open(self, url: str, method: str = "GET", data: Optional[bytes] = None,
              headers: Optional[Dict[str, str]] = None, allow_redirects: bool = True) -> Response:
        host = urllib.request.Request(url).host or ""
        self._throttle(host)
        opener = self._opener if allow_redirects else self._no_redirect
        req = self._build_request(url, method, data, headers or {})
        try:
            with opener.open(req, timeout=self._timeout) as resp:
                body = resp.read()
                body = self._decode_body(body, resp.headers.get("Content-Encoding", ""))
                return Response(resp.status, resp.geturl(), dict(resp.headers.items()), body)
        except urllib.error.HTTPError as exc:
            body = exc.read()
            body = self._decode_body(body, exc.headers.get("Content-Encoding", "") if exc.headers else "")
            return Response(exc.code, exc.geturl(), dict(exc.headers.items()) if exc.headers else {}, body)
        except urllib.error.URLError as exc:
            raise HttpError(f"Request failed: {exc.reason}", url=url) from exc
        except (TimeoutError, OSError) as exc:
            raise HttpError(f"Network error: {exc}", url=url) from exc

    # --------------------------------------------------------------- public API
    async def request(self, url: str, method: str = "GET", data: Optional[bytes] = None,
                      headers: Optional[Dict[str, str]] = None, allow_redirects: bool = True,
                      max_bytes: int = 8 * 1024 * 1024) -> Response:
        resp = await asyncio.to_thread(self._open, url, method, data, headers, allow_redirects)
        if resp.status >= 400:
            raise HttpError(f"HTTP {resp.status} for {url}", resp.status, url)
        if len(resp.body) > max_bytes:
            resp.body = resp.body[:max_bytes]
        return resp

    async def get_text(self, url: str, headers: Optional[Dict[str, str]] = None,
                       max_bytes: int = 8 * 1024 * 1024) -> str:
        resp = await self.request(url, "GET", None, headers, max_bytes=max_bytes)
        return resp.text

    async def post_json(self, url: str, payload, headers: Optional[Dict[str, str]] = None) -> Response:
        import json

        body = json.dumps(payload).encode("utf-8")
        hdrs = {"Content-Type": "application/json"}
        hdrs.update(headers or {})
        return await self.request(url, "POST", body, hdrs)

    async def post_form(self, url: str, fields: Dict[str, str],
                        headers: Optional[Dict[str, str]] = None) -> Response:
        """POST an html form (used by sites that hand out a session token)."""
        from urllib.parse import urlencode

        body = urlencode(fields).encode("utf-8")
        hdrs = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": url.split("/", 3)[0] + "//" + url.split("/", 3)[2] if url.count("/") > 2 else "",
            "Referer": url,
        }
        hdrs = {k: v for k, v in hdrs.items() if v}
        hdrs.update(headers or {})
        return await self.request(url, "POST", body, hdrs)

    async def resolve_redirect(self, url: str, headers: Optional[Dict[str, str]] = None,
                               max_hops: int = 8) -> str:
        """Return the final URL of a redirect chain without downloading the body."""
        current = url
        for _ in range(max_hops):
            resp = await asyncio.to_thread(self._open, current, "GET", None, headers or {}, False)
            if resp.status in REDIRECT_CODES:
                location = resp.headers.get("Location") or resp.headers.get("location")
                if not location:
                    break
                current = urllib.parse.urljoin(current, location)
                continue
            return current
        return current

    async def download(self, url: str, dest_path: str, headers: Optional[Dict[str, str]] = None,
                       on_progress: Optional[Callable[[int, int], None]] = None,
                       cancel: Optional[threading.Event] = None) -> int:
        """Stream a URL to disk. Returns the number of bytes written."""
        return await asyncio.to_thread(self._download_sync, url, dest_path, headers or {}, on_progress, cancel)

    def _download_sync(self, url: str, dest_path: str, headers: Dict[str, str],
                       on_progress: Optional[Callable[[int, int], None]],
                       cancel: Optional[threading.Event]) -> int:
        host = urllib.request.Request(url).host or ""
        self._throttle(host)
        req = self._build_request(url, "GET", None, headers)
        written = 0
        try:
            with self._opener.open(req, timeout=max(self._timeout, 120)) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                encoding = (resp.headers.get("Content-Encoding") or "").lower()
                decoder = None
                if "gzip" in encoding:
                    decoder = gzip.GzipFile(fileobj=resp)
                elif "deflate" in encoding:
                    decoder = zlib.decompressobj()
                with open(dest_path, "wb") as fh:
                    while True:
                        if cancel is not None and cancel.is_set():
                            raise HttpError("Download cancelled", url=url)
                        chunk = resp.read(262144)
                        if not chunk:
                            break
                        if decoder is not None:
                            chunk = decoder.decompress(chunk) if hasattr(decoder, "decompress") else decoder.read(len(chunk))
                        if not chunk:
                            continue
                        fh.write(chunk)
                        written += len(chunk)
                        if on_progress:
                            on_progress(written, total)
        except urllib.error.HTTPError as exc:
            raise HttpError(f"HTTP {exc.code} while downloading {url}", exc.code, url) from exc
        except HttpError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise HttpError(f"Download failed: {exc}", url=url) from exc
        if on_progress:
            on_progress(written, written)
        return written

    def cookies_snapshot(self) -> str:
        return "; ".join(f"{c.name}={c.value}" for c in self._jar)
