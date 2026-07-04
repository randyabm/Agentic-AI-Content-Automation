"""SSRF guard for fetching user-supplied URLs (articles, crawler, remote images).

Blocks requests to private, loopback, link-local and reserved IP ranges so a
user can't point the server at internal services (MinIO, Redis, the cloud
metadata endpoint at 169.254.169.254, etc.).
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class SSRFError(ValueError):
    """Raised when a URL resolves to a disallowed (internal) address."""


def _ip_is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_multicast or addr.is_reserved or addr.is_unspecified
    )


def assert_url_is_safe(url: str) -> None:
    """Raise SSRFError unless `url` is http(s) and every resolved address is public."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SSRFError(f"Only http(s) URLs are allowed, got: {parsed.scheme or 'none'}")
    host = parsed.hostname
    if not host:
        raise SSRFError("URL has no host")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80),
                                   proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFError(f"Could not resolve host {host}: {exc}")
    for info in infos:
        ip = info[4][0]
        if not _ip_is_public(ip):
            raise SSRFError(f"Refusing to fetch internal address {ip} (host {host})")
