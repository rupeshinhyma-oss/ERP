"""Federation Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.url_validator import validate_external_url


class FederationClientCreate(BaseModel):
    """
    Payload to register an ERP as a federation client (Phase 4 Step 16).

    `client_id` is auto-generated (not caller-supplied) from the ERP's
    own `key`, so it's always traceable back to a registry entry.
    `redirect_uris` must be exact, absolute URLs -- no wildcards, no
    partial matching (Step 17).
    """

    redirect_uris: list[str] = Field(..., min_length=1, max_length=10)
    federation_enabled: bool = False

    @field_validator("redirect_uris")
    @classmethod
    def _validate_redirect_uris(cls, value: list[str]) -> list[str]:
        """Validate redirect URIs: reject non-http(s) URLs and SSRF targets."""
        return [validate_external_url(uri) for uri in value]


class FederationClientSecretIssued(BaseModel):
    """Response returned exactly once, at registration/rotation time -- the only time the plaintext secret is visible."""

    id: uuid.UUID
    client_id: str
    client_secret: str = Field(..., description="Full plaintext client secret. Store this now -- it cannot be retrieved again.")
    redirect_uris: list[str]
    federation_enabled: bool


class FederationClientRead(BaseModel):
    """A federation client as returned by the API -- never includes the secret or its hash."""

    id: uuid.UUID
    erp_instance_id: uuid.UUID
    client_id: str
    redirect_uris: list[str]
    federation_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FederationClientUpdate(BaseModel):
    """Payload to update a federation client's redirect URIs / enabled flag."""

    redirect_uris: list[str] | None = Field(default=None, min_length=1, max_length=10)
    federation_enabled: bool | None = None

    @field_validator("redirect_uris")
    @classmethod
    def _validate_redirect_uris(cls, value: list[str] | None) -> list[str] | None:
        """Validate redirect URIs: reject non-http(s) URLs and SSRF targets."""
        if value is None:
            return None
        return [validate_external_url(uri) for uri in value]


class AuthorizeRequest(BaseModel):
    """
    Payload for `POST /federation/authorize` -- the Global User has selected an ERP to launch (Phase 4 Step 19).

    This is deliberately an authenticated, server-to-server-shaped call
    (the Global User's own session token gates it) rather than a raw
    `GET /open?erp=...` redirect (Step 47's explicit anti-pattern).
    """

    erp_instance_id: uuid.UUID
    redirect_uri: str = Field(..., min_length=1)
    state: str = Field(..., min_length=1, max_length=255)
    nonce: str | None = Field(default=None, max_length=255)
    code_challenge: str | None = Field(default=None, max_length=255)
    code_challenge_method: str | None = Field(default=None, max_length=10)


class AuthorizeResponse(BaseModel):
    """The authorization code and echoed state, for the caller to build the redirect to the target ERP."""

    authorization_code: str
    state: str
    redirect_uri: str


class TokenExchangeRequest(BaseModel):
    """
    Payload for `POST /federation/token` -- the ERP exchanges an authorization code for an ID token.

    Authenticated via HTTP Basic-shaped `client_id`/`client_secret` in
    the body (kept simple rather than requiring literal HTTP Basic auth
    headers, since this endpoint is called server-to-server, not from a
    browser).
    """

    grant_type: str = Field(default="authorization_code")
    code: str = Field(..., min_length=1)
    redirect_uri: str = Field(..., min_length=1)
    client_id: str = Field(..., min_length=1)
    client_secret: str = Field(..., min_length=1)
    code_verifier: str | None = Field(default=None, max_length=255)


class TokenExchangeResponse(BaseModel):
    """The issued federation ID token."""

    id_token: str
    token_type: str = "Bearer"
    expires_in: int


class OidcDiscoveryDocument(BaseModel):
    """Minimal OIDC discovery metadata (Phase 4 Step 4) -- only what's actually implemented, nothing more."""

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    response_types_supported: list[str] = ["code"]
    grant_types_supported: list[str] = ["authorization_code"]
    id_token_signing_alg_values_supported: list[str] = ["RS256"]
    code_challenge_methods_supported: list[str] = ["S256"]
    subject_types_supported: list[str] = ["public"]
