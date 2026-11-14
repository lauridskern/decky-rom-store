"""TLS trust store handling.

SteamOS ships an outdated ca-certificates bundle, so Python's default
verification fails with "unable to get local issuer certificate" for most
sites (anything behind Let's Encrypt / Cloudflare). The plugin therefore
carries its own up to date CA bundle and falls back to a relaxed context only
if even that does not work.
"""

from __future__ import annotations

import os
import ssl
from typing import List, Optional, Tuple

# Shipped with the plugin.
BUNDLED_CA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cacert.pem")

SYSTEM_CA_PATHS = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/cert.pem",
    "/etc/pki/tls/cacert.pem",
    "/usr/local/share/certs/ca-root-nss.crt",
)


def ca_candidates() -> List[str]:
    """Certificate bundles to try, best first."""
    candidates: List[str] = []
    try:
        import certifi  # type: ignore

        candidates.append(certifi.where())
    except Exception:
        pass
    if os.path.isfile(BUNDLED_CA):
        candidates.append(BUNDLED_CA)
    candidates.extend(path for path in SYSTEM_CA_PATHS if os.path.isfile(path))
    return candidates


def ssl_context() -> Tuple[ssl.SSLContext, str]:
    """Build the most trustworthy SSL context we can.

    Returns the context and a short description of where the trust store came
    from (useful for the plugin log).
    """
    for path in ca_candidates():
        try:
            context = ssl.create_default_context(cafile=path)
            return context, path
        except Exception:
            continue
    try:
        return ssl.create_default_context(), "system default"
    except Exception:
        return ssl._create_unverified_context(), "unverified"


def relaxed_context() -> ssl.SSLContext:
    """Last resort context that does not verify certificates."""
    return ssl._create_unverified_context()


def is_certificate_error(error: BaseException) -> bool:
    """True when the failure was a TLS certificate problem."""
    text = str(error).lower()
    if "certificate verify failed" in text or "certificate_verify_failed" in text:
        return True
    if "unable to get local issuer certificate" in text:
        return True
    return False
