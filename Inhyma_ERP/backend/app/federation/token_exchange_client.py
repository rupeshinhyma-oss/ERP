"""
ERP_Main Token Exchange Client (Relying Party side).

The other outbound call this ERP makes to ERP_Main during federation
login (alongside `erp_main_client.lookup_membership`): exchanging a
short-lived authorization `code` for a signed federation `id_token`.

This call is deliberately made from THIS backend, not the browser --
it is authenticated with `FEDERATION_CLIENT_ID`/`FEDERATION_CLIENT_SECRET`,
this ERP's own federation client credentials, which must never be
shipped to or read by frontend code. The browser only ever holds the
authorization `code` (short-lived, single-use, meaningless without the
client_secret) between `/federation/authorize` and this exchange.
"""

from __future__ import annotations

import httpx

from app.core.config import settings


class TokenExchangeError(Exception):
    """Raised when the code -> id_token exchange with ERP_Main fails for any reason."""


async def exchange_code_for_id_token(
    *, code: str, redirect_uri: str, code_verifier: str | None = None
) -> str:
    """
    Exchange an authorization `code` for a federation `id_token`.

    Calls `POST /federation/token` on ERP_Main using this ERP's own
    `FEDERATION_CLIENT_ID`/`FEDERATION_CLIENT_SECRET`. Any failure
    (network error, bad status, malformed body) raises
    `TokenExchangeError` -- callers must treat that as "deny login,"
    never "fall back to some other auth path."
    """
    url = f"{settings.ERP_MAIN_API_BASE_URL}/federation/token"
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": settings.FEDERATION_CLIENT_ID,
        "client_secret": settings.FEDERATION_CLIENT_SECRET,
    }
    if code_verifier:
        payload["code_verifier"] = code_verifier

    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise TokenExchangeError(f"Could not reach ERP_Main for token exchange: {exc}") from exc

    if response.status_code != 200:
        raise TokenExchangeError(
            f"ERP_Main token exchange failed with status {response.status_code}: {response.text[:200]}"
        )

    body = response.json()
    data = body.get("data") or {}
    id_token = data.get("id_token")
    if not id_token:
        raise TokenExchangeError("ERP_Main token exchange returned no id_token.")
    return id_token
