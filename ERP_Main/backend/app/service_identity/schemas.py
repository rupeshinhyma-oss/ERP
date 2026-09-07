"""ERP Service Credential Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ErpServiceCredentialCreate(BaseModel):
    """Payload to issue a new service credential for an ERP instance."""

    expires_at: datetime | None = Field(
        default=None, description="Optional expiry. Omit for a non-expiring credential (still revocable)."
    )


class ErpServiceCredentialIssued(BaseModel):
    """
    Response returned exactly once, at issuance/rotation time.

    This is the ONLY place the plaintext `bearer_token` is ever visible --
    it is never retrievable again afterward, matching Phase 3 Step 24
    ("display plaintext token only at creation/rotation time").
    """

    id: uuid.UUID
    credential_identifier: str
    bearer_token: str = Field(..., description="Full '<identifier>.<secret>' credential. Store this now -- it "
                               "cannot be retrieved again.")
    expires_at: datetime | None
    created_at: datetime


class ErpServiceCredentialRead(BaseModel):
    """A service credential as returned by the API, after issuance -- never includes the secret or its hash."""

    id: uuid.UUID
    erp_instance_id: uuid.UUID
    credential_identifier: str
    expires_at: datetime | None
    revoked_at: datetime | None
    last_used_at: datetime | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ErpHeartbeatRequest(BaseModel):
    """
    Heartbeat payload (Phase 3 Step 27).

    Deliberately narrow -- runtime metadata only, never business data,
    never users/orders/products, per the brief's explicit prohibition.
    """

    version: str | None = Field(default=None, max_length=50)
    environment: str | None = Field(default=None, max_length=50)
    deployment_id: str | None = Field(default=None, max_length=100, description="Optional deployment identifier.")


class ErpHeartbeatResponse(BaseModel):
    """Confirms the heartbeat was accepted and echoes the resulting state."""

    erp_instance_id: uuid.UUID
    erp_key: str
    last_seen_at: datetime
