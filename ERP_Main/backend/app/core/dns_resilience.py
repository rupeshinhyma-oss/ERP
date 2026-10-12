"""
DNS Resilience & Fallback Patch for Python Sockets on Windows / Cloud WAN.

Addresses [Errno 11001] getaddrinfo failed caused by:
1. Windows Winsock WSAHOST_NOT_FOUND on short TTL (60s) AWS ELB CNAME chains (e.g. Supabase poolers).
2. Transient UDP packet drops during Wi-Fi or broadband DNS resolution.
3. Lack of retries in asyncio's loop.create_connection / loop.getaddrinfo.

When installed:
- Performs standard socket.getaddrinfo resolution.
- Caches successful resolution tuples in memory with rolling updates.
- If getaddrinfo raises socket.gaierror:
  - Immediately retries up to 2 times with a 100ms pause.
  - If still failing, falls back to the last known resolved IPs for that hostname.
  - If it's a known Supabase pooler host and no cache exists yet, falls back to pre-seeded AWS pooler IPs.
"""

from __future__ import annotations

import logging
import socket
import time
from typing import Any

logger = logging.getLogger("app.core.dns_resilience")

# In-memory DNS cache: host -> (result_tuples, timestamp)
_RESOLVED_CACHE: dict[str, tuple[list[Any], float]] = {}

# Known fallback IPs for Supabase poolers in ap-south-1
_PRESEEDED_FALLBACKS: dict[str, list[str]] = {
    "aws-0-ap-south-1.pooler.supabase.com": ["3.111.105.85", "65.0.195.55"],
}

_ORIG_GETADDRINFO = socket.getaddrinfo
_PATCHED = False


def install_dns_resilience() -> None:
    """Idempotently install the resilient DNS resolver into socket.getaddrinfo."""
    global _PATCHED
    if _PATCHED:
        return

    def resilient_getaddrinfo(
        host: Any,
        port: Any,
        family: int = 0,
        type: int = 0,
        proto: int = 0,
        flags: int = 0,
    ) -> list[Any]:
        # Only intercept string hosts (not numeric IPs or None)
        if not isinstance(host, str) or not host:
            return _ORIG_GETADDRINFO(host, port, family, type, proto, flags)

        host_lower = host.strip().lower()

        # 1. Attempt standard resolution with up to 2 retries on gaierror
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                res = _ORIG_GETADDRINFO(host, port, family, type, proto, flags)
                if res:
                    _RESOLVED_CACHE[host_lower] = (res, time.time())
                return res
            except socket.gaierror as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.1)

        # 2. If standard resolution failed, check the memory cache
        cached_entry = _RESOLVED_CACHE.get(host_lower)
        if cached_entry:
            cached_res, _ = cached_entry
            target_port = int(port) if isinstance(port, (int, str)) and str(port).isdigit() else 0
            adapted_res = [
                (
                    item[0],
                    item[1],
                    item[2],
                    item[3],
                    (item[4][0], target_port) if len(item) > 4 and len(item[4]) >= 2 else item[4],
                )
                for item in cached_res
            ]
            logger.warning(
                "DNS lookup failed for %s (%s); utilizing cached DNS resolution (%s)",
                host,
                last_error,
                [r[4][0] for r in adapted_res if len(r) > 4 and len(r[4]) >= 1],
            )
            return adapted_res

        # 3. Check preseeded fallbacks for known Supabase poolers
        fallback_ips = _PRESEEDED_FALLBACKS.get(host_lower)
        if fallback_ips:
            target_port = int(port) if isinstance(port, (int, str)) and str(port).isdigit() else 0
            synthetic_res = [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, target_port))
                for ip in fallback_ips
            ]
            logger.warning(
                "DNS lookup failed for %s (%s); utilizing preseeded fallback IP (%s)",
                host,
                last_error,
                fallback_ips,
            )
            return synthetic_res

        # Re-raise original error if no fallback is possible
        if last_error:
            raise last_error
        return _ORIG_GETADDRINFO(host, port, family, type, proto, flags)

    socket.getaddrinfo = resilient_getaddrinfo
    _PATCHED = True
    logger.info("DNS resilience and fallback handler installed successfully.")
