"""
URL and SSRF validation utilities.

Protects against Server-Side Request Forgery and malicious redirect targets.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from app.core.config import EnvironmentEnum, settings

# Cloud metadata endpoints and link-local ranges that are ALWAYS forbidden
FORBIDDEN_METADATA_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("169.254.0.0/16"),  # IPv4 Link-local / Cloud Metadata
    ipaddress.ip_network("fe80::/10"),       # IPv6 Link-local
]

FORBIDDEN_PRIVATE_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("10.0.0.0/8"),      # RFC1918 Private
    ipaddress.ip_network("172.16.0.0/12"),   # RFC1918 Private
    ipaddress.ip_network("192.168.0.0/16"),  # RFC1918 Private
    ipaddress.ip_network("127.0.0.0/8"),     # IPv4 Loopback
    ipaddress.ip_network("0.0.0.0/8"),       # Current network / unspecified
    ipaddress.ip_network("::1/128"),         # IPv6 Loopback
    ipaddress.ip_network("fc00::/7"),        # IPv6 Unique Local
]


def _is_ip_in_networks(
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address,
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network],
) -> bool:
    for net in networks:
        if ip.version == net.version and ip in net:
            return True
    return False


def validate_external_url(url: str, allow_local: bool | None = None) -> str:
    """
    Validate that a URL is well-formed and does not point to restricted
    internal or cloud metadata addresses (SSRF protection).

    - Cloud metadata (169.254.169.254, fe80::/10) is ALWAYS rejected.
    - Private IP ranges (10.x, 172.16.x, 192.168.x, 127.x) are rejected
      unless explicitly allowed via allow_local or local/test environment.
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL must be a non-empty string.")

    url_clean = url.strip()
    parsed = urlparse(url_clean)

    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Invalid URL scheme '{parsed.scheme}'. Only 'http' and 'https' are allowed.")

    if not parsed.netloc or not parsed.hostname:
        raise ValueError("URL must contain a valid hostname.")

    if parsed.username or parsed.password:
        raise ValueError("URL must not contain embedded user credentials.")

    hostname = parsed.hostname.lower()

    if allow_local is None:
        allow_local = getattr(settings, "ALLOW_LOCAL_URLS", False) or (
            settings.ENVIRONMENT in (EnvironmentEnum.LOCAL, EnvironmentEnum.TEST)
        )

    # Check for direct metadata or loopback hostnames
    if hostname in ("localhost", "localhost.localdomain") and not allow_local:
        raise ValueError(f"Access to localhost/loopback address '{hostname}' is not permitted.")

    # Try to parse as IP address literal
    try:
        ip = ipaddress.ip_address(hostname)
        # Always block cloud metadata
        if _is_ip_in_networks(ip, FORBIDDEN_METADATA_NETWORKS):
            raise ValueError("Access to link-local and cloud metadata addresses is strictly forbidden.")
        if not allow_local and (ip.is_private or ip.is_loopback or _is_ip_in_networks(ip, FORBIDDEN_PRIVATE_NETWORKS)):
            raise ValueError(f"Access to private/internal IP address '{ip}' is not permitted.")
        return url_clean
    except ValueError as e:
        # If message is our own forbidden error, re-raise it
        if "forbidden" in str(e).lower() or "not permitted" in str(e).lower():
            raise
        # Otherwise, hostname is a domain name

    # Resolve domain if in strict mode (not allowing local)
    if not allow_local:
        try:
            addr_info = socket.getaddrinfo(hostname, None)
            for item in addr_info:
                ip_str = item[4][0]
                ip = ipaddress.ip_address(ip_str)
                if _is_ip_in_networks(ip, FORBIDDEN_METADATA_NETWORKS):
                    raise ValueError("Access to link-local and cloud metadata addresses is strictly forbidden.")
                if ip.is_private or ip.is_loopback or _is_ip_in_networks(ip, FORBIDDEN_PRIVATE_NETWORKS):
                    raise ValueError(f"Resolved hostname '{hostname}' points to restricted address '{ip}'.")
        except socket.gaierror:
            pass

    return url_clean
