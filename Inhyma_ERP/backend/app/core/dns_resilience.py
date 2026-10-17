"""
DNS resilience patch for Python sockets -- WINDOWS ONLY by default.

Why it exists: Windows Winsock sometimes raises ``[Errno 11001] getaddrinfo failed`` for short-TTL CNAME chains
(e.g. Supabase poolers) or after transient UDP loss.  On those machines we retry and fall back to the last resolved
addresses.

Why it is now limited: on Linux hosts (Render, Docker, AWS) the resolver is fine and this patch only did harm.  The
previous version cached results by hostname alone, so a lookup that asked for IPv6 could be served to a later lookup
that asked for IPv4.  Render has no outbound IPv6, so ERP-to-ERP calls (e.g. the SSO session check) then failed with
"control plane not reachable".  The cache key now includes family/type/proto/flags, and the patch only installs on
Windows unless ``DNS_RESILIENCE_FORCE=1`` is set.  ``DNS_RESILIENCE_DISABLE=1`` switches it off everywhere.
"""

from __future__ import annotations

import logging
import os
import socket
import sys
import time
from typing import Any

logger = logging.getLogger("app.core.dns_resilience")

_CACHE_TTL_SECONDS = 60.0
# (host, family, type, proto, flags) -> (result_tuples, timestamp)
_RESOLVED_CACHE: dict[tuple[str, int, int, int, int], tuple[list[Any], float]] = {}

# Known fallback IPs for Supabase poolers in ap-south-1 (IPv4 only, used only when DNS fails and nothing is cached).
_PRESEEDED_FALLBACKS: dict[str, list[str]] = {
    "aws-0-ap-south-1.pooler.supabase.com": ["3.111.105.85", "65.0.195.55"],
}

_ORIG_GETADDRINFO = socket.getaddrinfo
_PATCHED = False


def _should_install() -> bool:
    if os.environ.get("DNS_RESILIENCE_DISABLE", "").strip().lower() in {"1", "true", "yes"}:
        return False
    if os.environ.get("DNS_RESILIENCE_FORCE", "").strip().lower() in {"1", "true", "yes"}:
        return True
    return sys.platform.startswith("win")


def _with_port(entries: list[Any], port: Any) -> list[Any]:
    """Copy cached results, replacing only the port and keeping every other field (incl. IPv6 flow/scope)."""
    try:
        target_port = int(port) if port is not None and str(port).isdigit() else 0
    except (TypeError, ValueError):
        target_port = 0
    out = []
    for item in entries:
        sockaddr = item[4]
        if isinstance(sockaddr, tuple) and len(sockaddr) >= 2:
            sockaddr = (sockaddr[0], target_port, *sockaddr[2:])
        out.append((item[0], item[1], item[2], item[3], sockaddr))
    return out


def install_dns_resilience() -> None:
    """Idempotently install the resilient resolver (no-op on non-Windows hosts)."""
    global _PATCHED
    if _PATCHED or not _should_install():
        return

    def resilient_getaddrinfo(host: Any, port: Any, family: int = 0, type: int = 0, proto: int = 0, flags: int = 0):
        if not isinstance(host, str) or not host:
            return _ORIG_GETADDRINFO(host, port, family, type, proto, flags)

        key = (host.strip().lower(), family, type, proto, flags)
        hit = _RESOLVED_CACHE.get(key)
        if hit and time.time() - hit[1] < _CACHE_TTL_SECONDS:
            return _with_port(hit[0], port)

        last_error: Exception | None = None
        for attempt in range(3):
            try:
                res = _ORIG_GETADDRINFO(host, port, family, type, proto, flags)
                if res:
                    _RESOLVED_CACHE[key] = (res, time.time())
                return res
            except socket.gaierror as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.1)

        stale = _RESOLVED_CACHE.get(key)
        if stale:
            logger.warning("DNS lookup failed for %s (%s); using last known addresses", host, last_error)
            return _with_port(stale[0], port)

        fallback_ips = _PRESEEDED_FALLBACKS.get(key[0])
        if fallback_ips and family in (0, socket.AF_INET):
            logger.warning("DNS lookup failed for %s (%s); using preseeded fallback IPs", host, last_error)
            p = int(port) if port is not None and str(port).isdigit() else 0
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, p)) for ip in fallback_ips]

        if last_error:
            raise last_error
        return _ORIG_GETADDRINFO(host, port, family, type, proto, flags)

    setattr(socket, "getaddrinfo", resilient_getaddrinfo)
    _PATCHED = True
    logger.info("DNS resilience handler installed (platform=%s).", sys.platform)