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
