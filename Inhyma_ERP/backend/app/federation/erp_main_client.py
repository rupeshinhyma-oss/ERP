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


async def verify_ecosystem_session(session_id: str) -> dict[str, Any]:
    """
    Ask ERP_Main whether a central ecosystem session is currently valid.

    ERP_Main re-checks the user's status and ERP memberships on every call, so
    the answer reflects access changes made centrally a moment ago.  Fails
    CLOSED: any network problem, non-200, or malformed reply raises
    `EcosystemSessionError` -- callers must deny access, never assume active.
    """
    from urllib.parse import quote

    url = f"{settings.ERP_MAIN_API_BASE_URL.rstrip('/')}/global/ecosystem-session/{quote(session_id, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=settings.SSO_HANDOVER_VERIFY_TIMEOUT_SECONDS) as http_client:
            response = await http_client.get(url)
    except httpx.HTTPError as exc:
        raise EcosystemSessionError(f"Could not reach ERP_Main to verify the session: {exc}") from exc

    if response.status_code != 200:
        raise EcosystemSessionError(f"ERP_Main session verification failed with status {response.status_code}.")
    try:
        body = response.json()
    except ValueError as exc:
        raise EcosystemSessionError("ERP_Main returned a non-JSON session verification reply.") from exc
    data = body.get("data", body) if isinstance(body, dict) else None
    if not isinstance(data, dict):
        raise EcosystemSessionError("ERP_Main returned an unexpected session verification reply.")
    return data


async def push_password_to_erp_main(email: str, new_password: str) -> bool:
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