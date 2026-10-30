"""
Where a signed-in person belongs -- decided ONCE, here, and simply followed by every app.

The rules (from the platform owner):
  * no ERP access            -> the ERP Dashboard (control plane), whichever login page they used;
  * access to exactly 1 ERP   -> that ERP only, whichever login page they used (current or future ERPs);
  * access to 2+ ERPs         -> may switch between exactly those ERPs;
  * platform admins           -> every ERP.

Addresses come first from environment configuration (`.env` locally, platform environment variables in production,
e.g. ``YINGLIMA_FRONTEND_URL``, ``INHYMA_FRONTEND_URL``, ``<KEY>_FRONTEND_URL``, and ``FRONTEND_URL``), falling back
to ``erp_instances.base_url`` ONLY when that database URL belongs to the same environment class (local vs hosted).
Localhost and hosted domains never cross-contaminate even when sharing one database.
"""

from __future__ import annotations

import ipaddress
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import EnvironmentEnum, settings
from app.erp_registry.models import ErpInstance, ErpStatus

logger = logging.getLogger(__name__)

CONTROL_PLANE_KEY = "control-plane"


@dataclass(frozen=True)
class RegistryErp:
    key: str
    name: str
    url: Optional[str]


_CACHE: Dict[str, Any] = {"at": 0.0, "rows": None}


def invalidate_landing_registry_cache() -> None:
    """Forget the cached registry (call after an ERP is registered, edited or suspended)."""
    _CACHE["at"] = 0.0
    _CACHE["rows"] = None


def _is_local_url(url: str) -> bool:
    """Return True for loopback, `.local`, and RFC-1918 LAN addresses; False for public hosted domains."""
    host = (urlparse(url).hostname or "").strip().lower()
    if not host:
        return False
    if host in {"localhost", "localhost.localdomain", "0.0.0.0"} or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return bool(ip.is_loopback or ip.is_private or ip.is_unspecified)
    except ValueError:
        return False


def _matches_current_environment(url: str) -> bool:
    """Ensure local runs never emit hosted URLs and production runs never emit localhost/LAN URLs."""
    env = getattr(settings, "ENVIRONMENT", None)
    if env == EnvironmentEnum.LOCAL:
        return _is_local_url(url)
    if env == EnvironmentEnum.PRODUCTION:
        return not _is_local_url(url)
    return True


def _normalize_dashboard_url(raw: str) -> str:
    cleaned = (raw or "").strip().rstrip("/")
    if not cleaned:
        return ""
    if cleaned.endswith("/dashboard"):
        cleaned = cleaned[: -len("/dashboard")].rstrip("/")
    return f"{cleaned}/dashboard" if cleaned else ""


def _resolve_erp_frontend_url(key: str, db_url: Optional[str]) -> Optional[str]:
    """
    Resolve an ERP's frontend dashboard URL:
      1. `<KEY>_FRONTEND_URL` from `.env` / OS environment (authoritative per environment).
      2. `erp_instances.base_url` from DB ONLY when compatible with the current environment.
    """
    configured = settings.get_erp_frontend_url(key)
    if configured and _matches_current_environment(configured):
        return configured

    candidate = (db_url or "").strip()
    if candidate and _matches_current_environment(candidate):
        return candidate
    return None


def control_plane_url() -> str:
    """The ERP Dashboard's own address (`FRONTEND_URL` from `.env` / environment), as a dashboard URL."""
    base = _normalize_dashboard_url(getattr(settings, "FRONTEND_URL", "") or "")
    if base and _matches_current_environment(base):
        return base

    raw_cors = getattr(settings, "CORS_ALLOWED_ORIGINS", "") or ""
    if isinstance(raw_cors, str):
        cors_origins = [o.strip() for o in raw_cors.split(",") if o.strip()]
    else:
        cors_origins = [str(o).strip() for o in raw_cors if str(o).strip()]
    spoke_origins = {
        _normalize_dashboard_url(raw)[: -len("/dashboard")]
        for raw in (
            getattr(settings, "YINGLIMA_FRONTEND_URL", ""),
            getattr(settings, "INHYMA_FRONTEND_URL", ""),
        )
        if _normalize_dashboard_url(raw)
    }
    remaining = [
        _normalize_dashboard_url(origin)
        for origin in cors_origins
        if origin
        and origin != "*"
        and _normalize_dashboard_url(origin)[: -len("/dashboard")] not in spoke_origins
        and _matches_current_environment(origin)
    ]
    if len(remaining) == 1:
        return remaining[0]
    return ""


async def load_registry(db: AsyncSession) -> List[RegistryErp]:
    """ACTIVE ERPs with their environment-resolved dashboard address; cached briefly, stale copy on DB error."""
    ttl = float(getattr(settings, "ECOSYSTEM_LANDING_REGISTRY_TTL_SECONDS", 30.0))
    now = time.monotonic()
    cached_rows = _CACHE.get("rows")
    if cached_rows is None or (now - float(_CACHE.get("at") or 0.0)) >= ttl:
        try:
            db_rows = (
                await db.execute(
                    select(ErpInstance.key, ErpInstance.display_name, ErpInstance.name, ErpInstance.base_url).where(
                        ErpInstance.status == ErpStatus.ACTIVE
                    )
                )
            ).all()
            cached_rows = [
                (
                    (key or "").strip().lower(),
                    (display or name or key or "").strip(),
                    ((url or "").strip() or None),
                )
                for key, display, name, url in db_rows
                if key
            ]
            _CACHE["rows"] = cached_rows
            _CACHE["at"] = now
        except Exception as exc:  # noqa: BLE001 -- fallback by design
            logger.warning("ERP registry unavailable for the landing decision (%s); using the last good copy", exc)
            if cached_rows is None:
                return []

    return [
        RegistryErp(key=key, name=name, url=_resolve_erp_frontend_url(key, db_url))
        for key, name, db_url in cached_rows
    ]


def _public_erp(e: RegistryErp) -> Dict[str, Any]:
    return {"key": e.key, "name": e.name, "url": e.url}


def compute_landing(
    *,
    allowed_erps: Iterable[Any],
    user_type: str | None,
    erps: Iterable[RegistryErp],
    control_plane: str,
) -> Dict[str, Any]:
    """
    Pure decision. Returns::

        {"mode": "admin" | "dashboard" | "single" | "multi",
         "target": {"key", "name", "url"} | None,      # where this person MUST be (single / dashboard), None = free choice
         "erps": [{"key", "name", "url"}, ...],         # the ERPs this person may open / switch between
         "control_plane_url": "..."}
    """
    allowed = [str(k).strip().lower() for k in (allowed_erps or []) if k is not None and str(k).strip()]
    registry = {e.key: e for e in erps}
    dashboard = {"key": CONTROL_PLANE_KEY, "name": "ERP Dashboard", "url": control_plane or None}

    if "*" in allowed or (user_type or "") == "platform_admin":
        every = sorted(registry.values(), key=lambda e: e.key)
        return {"mode": "admin", "target": None, "erps": [_public_erp(e) for e in every], "control_plane_url": control_plane or None}

    member_keys: List[str] = []
    for key in allowed:
        if key in (CONTROL_PLANE_KEY, "*") or key in member_keys:
            continue
        if key in registry:  # an unknown / suspended / decommissioned ERP is not an ERP the person can use
            member_keys.append(key)
    members = sorted((registry[k] for k in member_keys), key=lambda e: e.key)

    if not members:
        return {"mode": "dashboard", "target": dashboard, "erps": [], "control_plane_url": control_plane or None}
    if len(members) == 1:
        return {
            "mode": "single",
            "target": _public_erp(members[0]),
            "erps": [_public_erp(members[0])],
            "control_plane_url": control_plane or None,
        }
    return {"mode": "multi", "target": None, "erps": [_public_erp(e) for e in members], "control_plane_url": control_plane or None}


async def attach_landing(db: AsyncSession, session: Dict[str, Any]) -> Dict[str, Any]:
    """Copy of a public session dict with its ``landing`` decision added (inactive sessions are returned untouched)."""
    if not session or session.get("active") is False:
        return session
    try:
        erps = await load_registry(db)
        landing = compute_landing(
            allowed_erps=session.get("allowed_erps") or [],
            user_type=session.get("user_type"),
            erps=erps,
            control_plane=control_plane_url(),
        )
    except Exception as exc:  # noqa: BLE001 -- never let routing help break authentication itself
        logger.warning("Could not compute the landing decision (%s)", exc)
        return session
    return {**session, "landing": landing}
