"""Small HTML helpers built on top of the standard library.

We deliberately avoid a real parser: the three sources we scrape use very
predictable markup, and a dependency-free implementation keeps the plugin
installable on any Steam Deck without pip access.
"""

from __future__ import annotations

import html as html_module
import re
from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional
from urllib.parse import urljoin

_TAG_RE = re.compile(r"<(/?)([a-zA-Z0-9]+)([^>]*)>")
_ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)""")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b.*?</\1>", re.I | re.S)


def strip_tags(raw: str) -> str:
    """Remove markup and collapse whitespace."""
    if not raw:
        return ""
    text = _SCRIPT_STYLE_RE.sub(" ", raw)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_module.unescape(text)
    return collapse_ws(text)


def collapse_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def unescape(text: str) -> str:
    return html_module.unescape(text or "")


def parse_attrs(raw: str) -> Dict[str, str]:
    attrs: Dict[str, str] = {}
    for m in _ATTR_RE.finditer(raw or ""):
        name = m.group(1).lower()
        value = m.group(2)
        if value[:1] in ("'", '"'):
            value = value[1:-1]
        attrs[name] = html_module.unescape(value)
    return attrs


@dataclass
class Anchor:
    href: str
    attrs: Dict[str, str]
    inner: str
    start: int
    end: int

    @property
    def text(self) -> str:
        return strip_tags(self.inner)

    @property
    def title(self) -> str:
        return self.attrs.get("title", "")


def iter_anchors(html: str) -> Iterator[Anchor]:
    """Yield every <a> element, correctly handling nested anchors."""
    pos = 0
    length = len(html)
    while True:
        start = html.find("<a", pos)
        if start == -1:
            return
        tag_end = html.find(">", start)
        if tag_end == -1:
            return
        tag_raw = html[start:tag_end + 1]
        if tag_raw[2:3] in ("/", "!"):  # </a> or <!a ...>
            pos = tag_end + 1
            continue
        attrs = parse_attrs(tag_raw[2:-1])
        if "href" not in attrs:
            pos = tag_end + 1
            continue
        # Walk forward balancing nested anchors.
        depth = 1
        scan = tag_end + 1
        while scan < length and depth:
            next_open = html.find("<a", scan)
            next_close = html.find("</a", scan)
            if next_close == -1:
                break
            if next_open != -1 and next_open < next_close:
                probe = html[next_open:next_open + 4].lower()
                if probe[2:3] not in ("/", " ", ">", "\t", "\n"):
                    depth += 1
                scan = next_open + 2
                continue
            depth -= 1
            scan = next_close + 3
        end = min(scan, length)
        inner = html[tag_end + 1:end]
        yield Anchor(attrs["href"], attrs, inner, start, end)
        pos = end


def find_all(html: str, pattern: str, flags: int = re.I | re.S) -> List[re.Match]:
    return list(re.finditer(pattern, html, flags))


def find_matching_close(html: str, tag: str, start: int) -> int:
    """Return the index just past the closing tag of an already open element.

    `start` points just after the opening tag; the element itself counts as one
    open tag, so a matching close is the point where the nesting returns to 0.
    """
    open_re = re.compile(r"<%s\b" % re.escape(tag), re.I)
    close_re = re.compile(r"</%s\s*>" % re.escape(tag), re.I)
    depth = 1
    i = start
    while i < len(html):
        m_open = open_re.search(html, i)
        m_close = close_re.search(html, i)
        if m_close is None:
            return -1
        if m_open and m_open.start() < m_close.start():
            depth += 1
            i = m_open.end()
            continue
        depth -= 1
        i = m_close.end()
        if depth == 0:
            return i
    return -1


def iter_blocks(html: str, tag: str = "div", attr_needle: Optional[str] = None):
    """Yield (open_tag, block_html) for every balanced element of `tag`.

    `attr_needle` filters on the opening tag only, e.g. 'class="single-rom"'.
    """
    pattern = re.compile(r"<%s\b[^>]*>" % re.escape(tag), re.I)
    for m in pattern.finditer(html):
        if attr_needle and attr_needle not in m.group(0):
            continue
        end = find_matching_close(html, tag, m.end())
        if end == -1:
            continue
        yield m.group(0), html[m.start():end]


def first_group(html: str, pattern: str, group: int = 1, flags: int = re.I | re.S) -> Optional[str]:
    m = re.search(pattern, html, flags)
    if not m:
        return None
    try:
        return m.group(group)
    except (IndexError, re.error):  # pragma: no cover - defensive
        return None


def absolute(base: str, href: str) -> str:
    if not href:
        return base
    href = href.strip()
    if href.startswith("//"):
        scheme = "https:" if base.startswith("https") else "http:"
        return scheme + href
    return urljoin(base, href)


def filename_from_url(url: str) -> str:
    from urllib.parse import unquote, urlparse

    path = urlparse(url).path
    name = unquote(path.rsplit("/", 1)[-1]) if path else ""
    return name


def parse_size(text: Optional[str]) -> Optional[int]:
    """'5.97MB' -> 6260256 (bytes)."""
    if not text:
        return None
    m = re.search(r"([\d.,]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB)", text, re.I)
    if not m:
        return None
    try:
        value = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    unit = m.group(2).lower()
    factors = {
        "b": 1,
        "kb": 1000, "kib": 1024,
        "mb": 1000 ** 2, "mib": 1024 ** 2,
        "gb": 1000 ** 3, "gib": 1024 ** 3,
        "tb": 1000 ** 4, "tib": 1024 ** 4,
    }
    return int(value * factors.get(unit, 1))


def human_size(num: Optional[int]) -> str:
    if not num:
        return ""
    step = 1024.0
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(num)
    idx = 0
    while value >= step and idx < len(units) - 1:
        value /= step
        idx += 1
    return f"{value:.1f}{units[idx]}" if idx else f"{int(value)}B"


def safe_filename(name: str, fallback: str = "download") -> str:
    """Make a string safe to use as a file name on Linux/SteamOS."""
    name = (name or "").strip()
    name = name.replace("/", "_").replace("\\", "_")
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = re.sub(r"[:*?\"<>|]", "_", name)
    name = collapse_ws(name).strip(". ")
    if not name:
        name = fallback
    return name[:180]
