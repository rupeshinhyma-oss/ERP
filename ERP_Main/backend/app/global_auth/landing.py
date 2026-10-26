"""
Where a signed-in person belongs -- decided ONCE, here, and simply followed by every app.

The rules (from the platform owner):
  * no ERP access            -> the ERP Dashboard (control plane), whichever login page they used;
  * access to exactly 1 ERP   -> that ERP only, whichever login page they used (current or future ERPs);
  * access to 2+ ERPs         -> may switch between exactly those ERPs;
  * platform admins           -> every ERP.

Addresses come from the ERP registry (``erp_instances.base_url``) and the control plane's own ``FRONTEND_URL`` -- nothing is
hard-coded, so the same decision works on localhost and on hosted domains and for ERPs added later.

The registry is read through a short in-process cache (every spoke request verifies the session, so this runs at high
volume) and, if the database hiccups, the last good copy is used: a routing answer is still produced.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.erp_registry.models import ErpInstance, ErpStatus

logger = logging.getLogger(__name__)

CONTROL_PLANE_KEY = "control-plane"


@dataclass(frozen=True)
class RegistryErp:
    key: str
    name: str
    url: Optional[str]


_CACHE: Dict[str, Any] = {"at": 0.0, "erps": None}


def invalidate_landing_registry_cache() -> None:
    """Forget the cached registry (call after an ERP is registered, edited or suspended)."""
    _CACHE["at"] = 0.0
    _CACHE["erps"] = None


def control_plane_url() -> str:
    """The ERP Dashboard's own address (this app's FRONTEND_URL), as a dashboard URL."""
    base = (getattr(settings, "FRONTEND_URL", "") or "").strip().rstrip("/")
    return f"{base}/dashboard" if base else ""


async def load_registry(db: AsyncSession) -> List[RegistryErp]:
    """ACTIVE ERPs with their dashboard address; cached briefly, stale copy on a database error."""
    ttl = float(getattr(settings, "ECOSYSTEM_LANDING_REGISTRY_TTL_SECONDS", 30.0))
    now = time.monotonic()
    cached = _CACHE.get("erps")
    if cached is not None and (now - float(_CACHE.get("at") or 0.0)) < ttl:
        return list(cached)
    try:
        rows = (
            await db.execute(
                select(ErpInstance.key, ErpInstance.display_name, ErpInstance.name, ErpInstance.base_url).where(
                    ErpInstance.status == ErpStatus.ACTIVE
                )
            )
        ).all()
    except Exception as exc:  # noqa: BLE001 -- fallback by design
        logger.warning("ERP registry unavailable for the landing decision (%s); using the last good copy", exc)
        return list(cached) if cached is not None else []
    erps = [
        RegistryErp(key=(key or "").strip().lower(), name=(display or name or key or "").strip(), url=((url or "").strip() or None))
        for key, display, name, url in rows
        if key
    ]
    _CACHE["erps"] = erps
    _CACHE["at"] = now
    return list(erps)


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