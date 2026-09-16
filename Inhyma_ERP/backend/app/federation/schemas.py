"""Federation SSO Pydantic Schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class FederationSsoLoginRequest(BaseModel):
    """
    Payload for the SSO login route (Phase 4 Step 27).

    Carries the federation ID token issued by ERP_Main after a
    successful authorize -> token exchange (that exchange itself
    happens between the browser/launcher and ERP_Main, and between
    ERP_Main and this ERP's backend server-to-server for the token
    endpoint -- this route is where the resulting `id_token` is finally
    presented to Yinglima to establish a local session).
    """

    id_token: str = Field(..., min_length=1)


class FederationExchangeRequest(BaseModel):
    """
    Payload for `POST /federation/exchange` -- the browser-facing route.

    Carries only the short-lived, single-use authorization `code` (plus
    the exact `redirect_uri` it was issued for, and an optional PKCE
    `code_verifier`). This is deliberately everything a browser is
    allowed to hold during an ERP switch: it never sees this ERP's
    `client_secret` or a raw federation `id_token` -- both are handled
    entirely server-to-server inside this backend.
    """

    code: str = Field(..., min_length=1)
    redirect_uri: str = Field(..., min_length=1)
    code_verifier: str | None = Field(default=None, max_length=255)
