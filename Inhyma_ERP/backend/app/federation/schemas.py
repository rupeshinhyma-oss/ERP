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
