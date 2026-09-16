"""ERP Membership Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.erp_memberships.models import ErpMembershipStatus


class ErpMembershipCreate(BaseModel):
    """
    Payload to create (link) a new ERP Membership (Phase 3 Step 16).

    `erp_instance_id` is not included here -- it's taken from the route
    path (`POST /global/users/{user_id}/memberships/{erp_id}`), keeping
    the URL itself the single source of truth for which ERP is being
    linked, rather than trusting a body field that could disagree with it.
    """

    local_user_id: str = Field(..., min_length=1, max_length=255)


class ErpMembershipStatusUpdate(BaseModel):
    """Payload for the dedicated status-transition endpoints (suspend/restore/revoke all use this shape)."""

    reason: str | None = Field(default=None, max_length=500)


class ErpMembershipRead(BaseModel):
    """One ERP Membership as returned by the API."""

    id: uuid.UUID
    global_user_id: uuid.UUID
    erp_instance_id: uuid.UUID
    local_user_id: str
    status: ErpMembershipStatus
    linked_at: datetime
    verified_at: datetime | None
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ErpMembershipWithErpSummary(ErpMembershipRead):
    """
    An ERP Membership plus a lightweight summary of the ERP it belongs to.

    Used by the "which ERPs does this Global User belong to" view (Phase
    3 Step 34) -- deliberately excludes full local business permission
    trees per that step's explicit instruction.
    """

    erp_key: str
    erp_display_name: str


class InternalMembershipLookupResponse(BaseModel):
    """
    Response for the service-credential-gated internal membership lookup
    (Phase 4 Step 24/36).

    Returned to an ERP's own backend so it can resolve a federation ID
    token's `sub` (a GlobalUser id) to its own `local_user_id` --
    server-side, from a trusted service-to-service call, never from
    anything a browser could supply directly. Deliberately excludes any
    other ERP's data: the calling ERP's own service credential determines
    which single ERP's membership row (if any) is returned.
    """

    global_user_id: uuid.UUID
    local_user_id: str
    status: ErpMembershipStatus


class InternalUserRegistrationRequest(BaseModel):
    """
    Payload for the service-credential-gated internal user auto-registration
    endpoint (`POST /internal/federation/register-user`).

    Sent by an ERP's own backend, fire-and-forget, right after IT creates a
    new local login-having user -- never by a browser, and never containing
    a password or any credential. `erp_instance_id` is deliberately absent
    here too, for the same reason it's absent from `ErpMembershipCreate`:
    the caller's identity comes only from its verified service credential
    (`credential.erp_instance_id`), never from a body field a compromised
    or misconfigured caller could set to impersonate a different ERP.
    """

    email: str = Field(..., min_length=3, max_length=255)
    display_name: str = Field(..., min_length=1, max_length=200)
    local_user_id: str = Field(..., min_length=1, max_length=255)


class InternalUserRegistrationResponse(BaseModel):
    """Response confirming the resulting GlobalUser + ErpMembership state (idempotent on repeat calls)."""

    global_user_id: uuid.UUID
    erp_instance_id: uuid.UUID
    local_user_id: str
    membership_status: ErpMembershipStatus
    global_user_created: bool = Field(
        description="True only if this call created a brand-new GlobalUser; False if one already existed "
        "for this email (e.g. the person already has a membership in another ERP)."
    )
