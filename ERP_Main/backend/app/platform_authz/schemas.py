"""Platform Authorization Pydantic Schemas."""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.platform_authz.models import AuthorizationScope

_PERMISSION_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_.]*$")
_ROLE_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")


class PlatformPermissionCreate(BaseModel):
    """Payload to define a new platform permission (Phase 5 Section 6)."""

    permission_key: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("permission_key")
    @classmethod
    def _validate_permission_key(cls, value: str) -> str:
        """Reject a malformed key here (422) rather than letting the ORM's own validator raise a bare 500."""
        if not _PERMISSION_KEY_PATTERN.match(value):
            raise ValueError(
                "permission_key must be lowercase, start with a letter, and contain only letters, "
                "digits, dots, and underscores (e.g. 'platform.erp.update')."
            )
        return value


class PlatformPermissionRead(BaseModel):
    """A platform permission as returned by the API."""

    id: uuid.UUID
    permission_key: str
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PlatformRoleCreate(BaseModel):
    """Payload to create a new platform role (Phase 5 Section 5)."""

    role_key: str = Field(..., min_length=1, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("role_key")
    @classmethod
    def _validate_role_key(cls, value: str) -> str:
        """Reject a malformed key here (422) rather than letting the ORM's own validator raise a bare 500."""
        if not _ROLE_KEY_PATTERN.match(value):
            raise ValueError(
                "role_key must be uppercase, start with a letter, and contain only letters, digits, "
                "and underscores (e.g. 'PLATFORM_ADMIN', 'ERP_OPERATOR')."
            )
        return value


class PlatformRoleUpdate(BaseModel):
    """Payload to update a role's metadata or active flag. `role_key` is immutable once created."""

    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class PlatformRoleRead(BaseModel):
    """A platform role as returned by the API, including its granted permissions."""

    id: uuid.UUID
    role_key: str
    display_name: str
    description: str | None
    is_active: bool
    permission_keys: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RolePermissionAssign(BaseModel):
    """Payload to grant a permission to a role."""

    permission_key: str = Field(..., min_length=1, max_length=100)


class PlatformRoleAssignmentCreate(BaseModel):
    """
    Payload to assign a role to a GlobalUser (Phase 5 Section 8/9).

    `erp_instance_id` is required when `scope=ERP` and forbidden when
    `scope=GLOBAL` -- validated here (schema layer) AND again in the
    service layer (defense in depth, since the service layer is also
    reachable from seed scripts that don't go through this schema).
    """

    role_key: str = Field(..., min_length=1, max_length=50)
    scope: AuthorizationScope = AuthorizationScope.GLOBAL
    erp_instance_id: uuid.UUID | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def _validate_scope_consistency(self) -> "PlatformRoleAssignmentCreate":
        """Enforce erp_instance_id presence/absence matches the declared scope."""
        if self.scope == AuthorizationScope.ERP and self.erp_instance_id is None:
            raise ValueError("erp_instance_id is required when scope=ERP.")
        if self.scope == AuthorizationScope.GLOBAL and self.erp_instance_id is not None:
            raise ValueError("erp_instance_id must be omitted when scope=GLOBAL.")
        return self


class PlatformRoleAssignmentRead(BaseModel):
    """A role assignment as returned by the API."""

    id: uuid.UUID
    global_user_id: uuid.UUID
    role_id: uuid.UUID
    role_key: str
    scope: AuthorizationScope
    erp_instance_id: uuid.UUID | None
    is_active: bool
    assigned_by: uuid.UUID | None
    revoked_at: datetime | None
    revoked_by: uuid.UUID | None
    expires_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EffectivePermissionsResponse(BaseModel):
    """
    A GlobalUser's computed effective platform permissions (Phase 5 Section 10/33).

    `global_permissions` are granted regardless of ERP context.
    `erp_permissions` maps `erp_instance_id` (as a string) to the extra
    permissions granted specifically for that ERP -- never merged into
    `global_permissions`, so a caller can tell at a glance which
    permissions apply everywhere vs. only within one ERP's scope
    (Section 28: never conflate a global permission with an ERP-scoped one).
    """

    global_user_id: uuid.UUID
    global_permissions: list[str] = Field(default_factory=list)
    erp_permissions: dict[str, list[str]] = Field(default_factory=dict)
