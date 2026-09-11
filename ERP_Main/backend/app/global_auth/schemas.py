"""Global Authentication Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class GlobalRegisterRequest(BaseModel):
    """
    Payload to register a new Global User with a global password credential.

    This is intentionally the ONLY self-service creation path for a
    GlobalUser -- `POST /global/users` (Phase 3, `app.global_users`)
    remains platform-admin-only and creates a GlobalUser with no
    credential at all. Both paths are legitimate for different purposes:
    an admin provisioning a person in bulk vs. a person signing themselves
    up for global access.
    """

    display_name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)


class GlobalLoginRequest(BaseModel):
    """Login payload for a Global User."""

    email: EmailStr
    password: str = Field(..., min_length=1)


class GlobalLoginResponse(BaseModel):
    """Issued session access token plus its expiry, returned on successful login."""

    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    session_id: uuid.UUID


class GlobalUserProfile(BaseModel):
    """The authenticated Global User's own profile, as returned by /auth/me."""

    id: uuid.UUID
    display_name: str
    primary_email: str
    status: str

    model_config = {"from_attributes": True}


class GlobalChangePasswordRequest(BaseModel):
    """Payload to change the currently authenticated Global User's password."""

    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1, max_length=200)


class GlobalPasswordResetRequestPayload(BaseModel):
    """
    Payload to request a password reset (Phase 4 Step 43).

    Always returns the same generic success response regardless of
    whether the email is registered, so the endpoint can't be used to
    enumerate valid Global User emails.
    """

    email: EmailStr


class GlobalPasswordResetConfirmPayload(BaseModel):
    """Payload to complete a password reset using a single-use reset token."""

    token: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1, max_length=200)


class GlobalSessionRead(BaseModel):
    """A Global User's own session, as listed for self-service session management."""

    id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    last_activity_at: datetime
    revoked_at: datetime | None
    ip_address: str | None
    user_agent: str | None

    model_config = {"from_attributes": True}
