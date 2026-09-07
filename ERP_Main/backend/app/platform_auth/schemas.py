"""Platform Admin Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.platform_auth.models import PlatformAdminRole


class PlatformLoginRequest(BaseModel):
    """Login payload for a platform administrator."""

    email: EmailStr
    password: str = Field(..., min_length=1)


class PlatformLoginResponse(BaseModel):
    """Issued session token plus its expiry, returned on successful login."""

    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class PlatformAdminCreate(BaseModel):
    """
    Payload to create a new platform admin.

    There is deliberately no public self-registration route for this --
    every route that creates a `PlatformAdmin` requires an existing
    SUPER_ADMIN caller (see `routes.py`), so the very first admin account
    must be created out-of-band (see `scripts/seed_platform_admin.py`).
    """

    email: EmailStr
    display_name: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=8, max_length=200)
    role: PlatformAdminRole = PlatformAdminRole.PLATFORM_ADMIN


class PlatformAdminRead(BaseModel):
    """A platform admin as returned by the API (never includes the password hash)."""

    id: uuid.UUID
    email: str
    display_name: str
    role: PlatformAdminRole
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
