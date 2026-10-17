"""
ERP_Main API Client (Relying Party side).

The one place Yinglima calls back into ERP_Main over HTTP: resolving a
federation ID token's `sub` (a GlobalUser id) into ITS OWN
`local_user_id`, via ERP_Main's service-credential-gated internal lookup
endpoint (Phase 4 Step 24/36). Authenticated with
`settings.FEDERATION_SERVICE_CREDENTIAL` -- this ERP's own machine
credential, issued by ERP_Main's `app.service_identity`, entirely
separate from `FEDERATION_CLIENT_ID`/`_SECRET` (which authenticate the
token *exchange*, not this lookup).

Never trusts a `local_user_id` supplied by a browser (Step 24) -- this
is the only source Yinglima's SSO login route accepts one from.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from app.core.config import settings


class MembershipLookupError(Exception):
    """Raised when ERP_Main's membership lookup fails or returns no membership for this ERP."""


async def lookup_membership(global_user_id: uuid.UUID) -> dict[str, Any]:
    """
    Resolve this ERP's own membership for a given GlobalUser id.

    Returns the membership dict (`local_user_id`, `status`, ...) on
    success. Raises `MembershipLookupError` on any failure, including a
    404 (no membership exists for this ERP) -- callers should treat any
    exception from this function as "deny access," never "assume active."
    """
    url = f"{settings.ERP_MAIN_API_BASE_URL}/internal/federation/memberships/{global_user_id}"
    headers = {"Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise MembershipLookupError(f"Could not reach ERP_Main for membership lookup: {exc}") from exc

    if response.status_code != 200:
        raise MembershipLookupError(
            f"ERP_Main membership lookup failed with status {response.status_code}: {response.text[:200]}"
        )

    body = response.json()
    data = body.get("data")
    if not data:
        raise MembershipLookupError("ERP_Main returned no membership data.")
    return data


async def lookup_membership_by_local_user(local_user_id: str | uuid.UUID) -> dict[str, Any]:
    """
    Resolve this ERP's own membership and GlobalUser status for a given local user id.

    Returns the membership dict (`global_user_id`, `local_user_id`, `status`, `global_user_status`)
    on success. Raises `MembershipLookupError` on any failure.
    """
    url = f"{settings.ERP_MAIN_API_BASE_URL}/internal/federation/memberships/by-local-user/{local_user_id}"
    headers = {"Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise MembershipLookupError(f"Could not reach ERP_Main for local user membership lookup: {exc}") from exc

    if response.status_code != 200:
        raise MembershipLookupError(
            f"ERP_Main membership lookup failed with status {response.status_code}: {response.text[:200]}"
        )

    body = response.json()
    data = body.get("data")
    if not data:
        raise MembershipLookupError("ERP_Main returned no membership data for local user.")
    return data


class EcosystemSessionError(Exception):
    """Raised when ERP_Main cannot confirm a central ecosystem session (unreachable, error, or malformed reply)."""


class EcosystemSessionUnavailable(EcosystemSessionError):
    """ERP_Main could not be reached or answered with an error: a TEMPORARY problem, safe to retry (HTTP 503 here)."""


_LAST_GOOD_SESSIONS: dict[str, tuple[float, dict[str, Any]]] = {}
VERIFY_DIAGNOSTICS: dict[str, Any] = {"ok": None, "at": None, "url": None, "status": None, "error": None, "attempts": 0}


def _is_local_url(url: str) -> bool:
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def erp_main_api_base_urls() -> list[str]:
    """Every base URL worth trying for ERP_Main, best first (configured URL, then ones derived from the issuer/JWKS)."""
    candidates: list[str] = []
    configured = (settings.ERP_MAIN_API_BASE_URL or "").strip().rstrip("/")
    derived: list[str] = []
    issuer = (getattr(settings, "ERP_MAIN_ISSUER", "") or "").strip().rstrip("/")
    if issuer:
        derived.append(issuer if issuer.endswith("/api/v1") else f"{issuer}/api/v1")
    jwks = (getattr(settings, "ERP_MAIN_JWKS_URL", "") or "").strip()
    if "/api/v1/" in jwks:
        derived.append(jwks.split("/api/v1/")[0] + "/api/v1")
    explicit = (getattr(settings, "ERP_MAIN_URL", "") or "").strip().rstrip("/")
    if explicit:
        derived.insert(0, explicit if explicit.endswith("/api/v1") else f"{explicit}/api/v1")
    production = getattr(settings, "is_production", False)
    # In production a localhost default is never a real ERP_Main: try the other candidates first.
    ordered = ([configured] if configured and not (production and _is_local_url(configured) and derived) else []) + derived
    if configured and configured not in ordered:
        ordered.append(configured)
    for url in ordered:
        if url and url not in candidates:
            candidates.append(url)
    return candidates


def _client_for_erp_main(timeout: Any) -> httpx.AsyncClient:
    # Force IPv4: hosted platforms such as Render have no outbound IPv6, and a stray AAAA answer must never make the
    # control plane look "unreachable".
    try:
        transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0", retries=1)
        return httpx.AsyncClient(timeout=timeout, transport=transport)
    except Exception:
        return httpx.AsyncClient(timeout=timeout)


async def verify_ecosystem_session(
    session_id: str, *, budget_seconds: float | None = None, allow_stale: bool = True
) -> dict[str, Any]:
    """
    Ask ERP_Main whether a central ecosystem session is currently valid.

    ERP_Main re-checks the user's status and ERP memberships on every call, so the answer reflects access changes
    made centrally a moment ago.

    Reliability rules (a hosted free-tier ERP_Main may be asleep, restarting or briefly erroring):
      * several base URLs are tried, and temporary problems (network error, 502/503/504, 429) are retried with growing
        pauses until the time budget is used up -- a sleeping ERP_Main gets time to wake up;
      * a definite answer (200, or a 4xx such as 404) is final and never retried;
      * if ERP_Main stays unreachable, a session that THIS ERP verified as active within the last
        ``SSO_HANDOVER_STALE_OK_SECONDS`` is accepted (marked ``_from_cache``) -- sign-in keeps working through a
        short outage, while a session never verified before still fails CLOSED;
      * the reason for the latest failure is kept in ``VERIFY_DIAGNOSTICS`` (see GET /health/federation).
    """
    import asyncio
    import time as _time
    from urllib.parse import quote

    budget = float(budget_seconds if budget_seconds is not None else settings.SSO_HANDOVER_VERIFY_TIMEOUT_SECONDS)
    deadline = _time.monotonic() + max(budget, 1.0)
    bases = erp_main_api_base_urls()
    sid_q = quote(session_id, safe="")
    last_error = "ERP_Main is not configured."
    attempts = 0
    pause = 0.6

    while bases and _time.monotonic() < deadline:
        retryable_seen = False
        for base in bases:
            remaining = deadline - _time.monotonic()
            if remaining <= 0.5:
                break
            attempts += 1
            url = f"{base}/global/ecosystem-session/{sid_q}"
            per_try = httpx.Timeout(connect=min(8.0, remaining), read=min(15.0, remaining), write=5.0, pool=5.0)
            try:
                async with _client_for_erp_main(per_try) as http_client:
                    response = await http_client.get(url)
            except httpx.HTTPError as exc:
                retryable_seen = True
                last_error = f"{base}: {type(exc).__name__}: {exc}"[:300]
                VERIFY_DIAGNOSTICS.update(ok=False, at=_time.time(), url=base, status=None, error=last_error, attempts=attempts)
                continue
            code = response.status_code
            if code == 200:
                try:
                    body = response.json()
                except ValueError:
                    retryable_seen = True
                    last_error = f"{base}: non-JSON reply"
                    continue
                data = body.get("data", body) if isinstance(body, dict) else None
                if not isinstance(data, dict):
                    last_error = f"{base}: unexpected reply shape"
                    continue
                VERIFY_DIAGNOSTICS.update(ok=True, at=_time.time(), url=base, status=200, error=None, attempts=attempts)
                if data.get("active") is True:
                    if len(_LAST_GOOD_SESSIONS) > 2000:
                        _LAST_GOOD_SESSIONS.clear()
                    _LAST_GOOD_SESSIONS[session_id] = (_time.monotonic(), dict(data))
                elif data.get("revoked") is True:
                    _LAST_GOOD_SESSIONS.pop(session_id, None)
                return data
            last_error = f"{base}: HTTP {code}"
            VERIFY_DIAGNOSTICS.update(ok=False, at=_time.time(), url=base, status=code, error=last_error, attempts=attempts)
            if code in (429, 500, 502, 503, 504):
                retryable_seen = True
            # any other code (e.g. 404 = wrong base URL) is a definite answer: try the next candidate only
        if not retryable_seen:
            break
        await asyncio.sleep(min(pause, max(deadline - _time.monotonic(), 0)))
        pause = min(pause * 2, 5.0)

    if allow_stale:
        hit = _LAST_GOOD_SESSIONS.get(session_id)
        stale_ok = float(getattr(settings, "SSO_HANDOVER_STALE_OK_SECONDS", 900.0))
        if hit is not None and (_time.monotonic() - hit[0]) <= stale_ok:
            data = dict(hit[1])
            data["_from_cache"] = True
            return data
    raise EcosystemSessionUnavailable(f"Could not reach ERP_Main to verify the session ({last_error}).")


async def push_password_to_erp_main(email: str | None, new_password: str) -> bool:
    """
    Tell ERP_Main that this person's password changed in THIS ERP, so the whole ecosystem shares one password.

    ERP_Main stores it centrally and pushes it to the person's other ERPs.  Best effort: returns False
    (never raises) if ERP_Main is unreachable, has no matching user, or no service credential is configured --
    the local change already succeeded, and sign-in falls back to a central check on every ERP.
    """
    try:
        creds = settings.get_expected_erp_main_credentials()
        if not creds or not email or not new_password:
            return False
        url = f"{settings.ERP_MAIN_API_BASE_URL.rstrip('/')}/internal/users/password"
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.post(
                url,
                json={"email": email, "new_password": new_password},
                headers={"Authorization": f"Bearer {creds[0]}", "X-ERP-Key": settings.ERP_KEY},
            )
        return response.status_code == 200
    except Exception:  # never break a successful local password change
        return False


# --- Per-session (one login = one session id) -------------------------------------------------------------------
_SESSION_STATE_CACHE: dict[str, tuple[float, str]] = {}
_SESSION_STATE_TTL_SECONDS = 45.0           # a session known to be active is not re-checked for this long
_SESSION_STATE_UNREACHABLE_TTL_SECONDS = 15.0


def _central_configured() -> bool:
    try:
        return bool(settings.get_expected_erp_main_credentials()) and bool(settings.ERP_MAIN_API_BASE_URL)
    except Exception:
        return False


def _service_headers() -> dict[str, str] | None:
    creds = settings.get_expected_erp_main_credentials()
    if not creds:
        return None
    return {"Authorization": f"Bearer {creds[0]}", "X-ERP-Key": settings.ERP_KEY}


async def open_central_session(email: str | None) -> dict[str, Any] | None:
    """
    This ERP has just verified a person's password.  Ask ERP_Main to open ONE central session for this login; its id
    goes into every token of the login, so a later sign-out ends exactly this login everywhere.

    Never raises.  Returns None when ERP_Main cannot be reached, refuses (e.g. no access grant for this ERP) or no
    service credential is configured -- the caller then issues a clearly labelled local-only session, so a central
    problem never blocks a legitimate login.
    """
    try:
        headers = _service_headers()
        if not headers or not email:
            return None
        url = f"{settings.ERP_MAIN_API_BASE_URL.rstrip('/')}/internal/sessions/open"
        # Short on purpose: a slow or sleeping ERP_Main must never make a LOGIN hang; the login then simply falls back
        # to a local-only session.
        timeout = httpx.Timeout(connect=1.5, read=3.0, write=3.0, pool=3.0)
        async with httpx.AsyncClient(timeout=timeout) as http_client:
            response = await http_client.post(url, json={"email": email}, headers=headers)
        if response.status_code != 200:
            return None
        body = response.json()
        data = body.get("data", body) if isinstance(body, dict) else None
        return data if isinstance(data, dict) and data.get("session_id") else None
    except Exception:
        return None


async def push_session_signout_to_erp_main(session_id: str) -> bool:
    """
    A person signed out of THIS ERP.  Tell ERP_Main so it ends THIS session (dashboard + the other ERPs it used).
    Server-to-server, so it works even if the browser never reaches ERP_Main.  Best effort: never raises.
    """
    try:
        headers = _service_headers()
        sid = (session_id or "").strip()
        if not headers or not sid or sid.startswith("loc-"):
            return False
        from urllib.parse import quote

        url = f"{settings.ERP_MAIN_API_BASE_URL.rstrip('/')}/internal/sessions/{quote(sid, safe='')}/signout"
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.post(url, headers=headers)
        return response.status_code == 200
    except Exception:
        return False


async def central_session_state(session_id: str) -> str:
    """
    "active" | "revoked" | "unknown" for a central session id.  Never raises.

    Safety net behind ERP_Main's push: even if a sign-out message is lost, this ERP notices within ~45 seconds.
    Cached; and fail-OPEN ("unknown") when ERP_Main is unreachable, not configured, or does not know the session,
    so an ERP_Main outage never logs everybody out.
    """
    import time as _time

    sid = (session_id or "").strip()
    if not sid or sid.startswith("loc-") or sid.startswith("ihm-sess-") or not _central_configured():
        return "unknown"
    now = _time.monotonic()
    hit = _SESSION_STATE_CACHE.get(sid)
    if hit is not None and hit[0] > now:
        return hit[1]
    state, ttl = "unknown", _SESSION_STATE_UNREACHABLE_TTL_SECONDS
    try:
        data = await verify_ecosystem_session(sid, budget_seconds=4.0, allow_stale=False)
        if data.get("active") is True:
            state, ttl = "active", _SESSION_STATE_TTL_SECONDS
        elif data.get("revoked") is True:
            state, ttl = "revoked", _SESSION_STATE_TTL_SECONDS
    except EcosystemSessionError:
        pass
    if len(_SESSION_STATE_CACHE) > 5000:
        for k in [k for k, (exp, _) in _SESSION_STATE_CACHE.items() if exp <= now][:2500] or list(_SESSION_STATE_CACHE)[:2500]:
            _SESSION_STATE_CACHE.pop(k, None)
    _SESSION_STATE_CACHE[sid] = (now + ttl, state)
    return state