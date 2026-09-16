"""
ERP_Main Global Identity Registration Client (best-effort, fire-and-forget).

The third outbound call this ERP makes to ERP_Main (alongside
`erp_main_client.lookup_membership` and `token_exchange_client`):
registering a brand-new local login-having user with the global
identity layer, right after this ERP itself creates that user.

CRITICAL RELIABILITY PROPERTY: this call must NEVER be able to fail,
delay, or roll back local user creation. Local user creation is this
ERP's own business, complete and durable the moment it commits --
whether ERP_Main is up, slow, misconfigured, or completely
unreachable is irrelevant to that fact. This module is written so a
caller can safely fire it with `asyncio.create_task(...)` and never
await or check its result on the request's critical path:
- Every failure mode (network error, timeout, non-200, bad body) is
  caught here and turned into a plain `False` return / logged
  warning -- nothing propagates as an exception to the caller.
- If this best-effort registration never lands (ERP_Main was down,
  say), the local user still logs in and works normally. A platform
  admin can always link the account manually later via ERP_Main's
  existing Memberships admin page -- that manual path is the
  permanent fallback this best-effort call sits in front of, not a
  replacement for it.
"""

from __future__ import annotations

import logging
import uuid

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


async def register_user_with_global_identity(
    *, email: str, display_name: str, local_user_id: uuid.UUID | str
) -> bool:
    """
    Best-effort: tell ERP_Main a new local user was just created here.

    Returns True on confirmed success, False on ANY failure -- never
    raises. Authenticated with this ERP's own `FEDERATION_SERVICE_CREDENTIAL`
    (the same one already used for the membership lookup call), so
    ERP_Main can verify which ERP is actually calling; nothing here
    lets this ERP claim to be registering on behalf of a different one.

    Intentionally silent about WHY it failed beyond a log line: the
    caller (local user creation) has already succeeded and returned to
    its own caller by the time this typically runs, so there is no
    request left to report an error back to.
    """
    if not settings.ERP_MAIN_API_BASE_URL:
        return False

    url = f"{settings.ERP_MAIN_API_BASE_URL}/internal/federation/register-user"
    headers = {"Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}"}
    payload = {
        "email": email,
        "display_name": display_name,
        "local_user_id": str(local_user_id),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning(
            "Global identity registration skipped (ERP_Main unreachable): %s. "
            "Local user was created successfully regardless; a platform admin can link it manually later.",
            exc,
        )
        return False

    if response.status_code not in (200, 201):
        logger.warning(
            "Global identity registration skipped (ERP_Main returned %s): %s. "
            "Local user was created successfully regardless; a platform admin can link it manually later.",
            response.status_code,
            response.text[:200],
        )
        return False

    return True
