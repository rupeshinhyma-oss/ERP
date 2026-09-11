"""
Platform Authorization ORM Models.

Owns the Phase 5 global-authorization schema: `PlatformRole`,
`PlatformPermission`, `RolePermission`, `PlatformRoleAssignment`. This is
the "GlobalUser -> Platform Role -> Platform Permission" chain the Phase
5 brief describes (Sections 3, 5-8) -- a genuinely new, data-driven RBAC
layer, distinct from (and additive to) two things that already exist:

1. `app.platform_auth.PlatformAdmin` (Phase 3) -- a fixed two-tier
   enum (`SUPER_ADMIN`/`PLATFORM_ADMIN`) for humans who log into
   ERP_Main *directly* with their own admin credential. Phase 5 does
   NOT touch, rename, or replace this table. It remains exactly as
   Phase 3 built it and continues to gate the routes it already gates.
2. Every ERP's own local RBAC (`Role`/`Permission` inside Yinglima and
   Inhyma) -- completely untouched, completely out of scope for this
   module, per the brief's own Section 2/12/61 ("do not create a giant
   permission matrix," "ERP business authorization must remain local").

What THIS module adds: platform roles/permissions that attach to a
**GlobalUser** (the end-user identity from Phase 3/4, not the separate
PlatformAdmin table) -- so a GlobalUser can be granted fine-grained,
revocable, optionally ERP-scoped platform-level authorization (e.g.
"can register federation clients," "can view audit logs") without that
authorization being hardcoded into a two-value enum. This is a genuinely
new capability, not a replacement for PlatformAdmin's simpler login-gate
role, which is why both coexist: `PlatformAdmin` is one way to become a
recognized ERP_Main operator (get a session token by logging in
directly); a `GlobalUser` holding `PlatformRoleAssignment`s is another,
generalized way to reach the same class of operations, scoped and
revocable per-permission rather than all-or-nothing per-tier.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_registry.models import ErpInstance
from app.global_users.models import GlobalUser

_PERMISSION_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_.]*$")
_ROLE_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")


class AuthorizationScope(str, Enum):
    """
    Whether a role assignment applies platform-wide or to one specific ERP (Phase 5 Section 9).

    GLOBAL: the assignment's permissions apply everywhere. Reserved for
    genuinely platform-wide operators (e.g. PLATFORM_SUPER_ADMIN).
    ERP: the assignment's permissions apply only to the one ERP named by
    `PlatformRoleAssignment.erp_instance_id`. A role scoped to Yinglima
    grants nothing for Inhyma, and vice versa (Section 9/28) -- enforced
    in the service layer's authorization check, not assumed from the
    role's own definition, since the SAME role (e.g. "ERP_OPERATOR") can
    be assigned to different GlobalUsers with different `erp_instance_id`
    values on each assignment.
    """

    GLOBAL = "GLOBAL"
    ERP = "ERP"


class PlatformRole(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A named, assignable bundle of platform permissions (Phase 5 Section 5/7).

    Deliberately data-driven: no permission list is hardcoded in any
    Python authorization function (Section 7) -- what a role grants is
    entirely determined by its `RolePermission` rows, so new roles can be
    created via the API/seed data without a code change (Section 5:
    "support adding future roles through configuration/database records
    rather than hard-coded authorization logic").
    """

    __tablename__ = "platform_roles"

    role_key: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        doc="Stable, machine-readable key, e.g. 'PLATFORM_ADMIN'. Never used for authorization by itself "
        "-- always resolved through RolePermission.",
    )
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        doc="Disabling a role (rather than deleting it) immediately voids every assignment that "
        "references it, without losing the historical assignment records themselves.",
    )

    permission_links: Mapped[list["RolePermission"]] = relationship(
        back_populates="role", cascade="all, delete-orphan", lazy="selectin"
    )

    @validates("role_key")
    def _validate_role_key(self, _key: str, value: str) -> str:
        """Enforce an uppercase, underscore-friendly key shape (mirrors ErpInstance.key's own validator pattern)."""
        if not value or not _ROLE_KEY_PATTERN.match(value):
            raise ValueError(
                "role_key must be uppercase, start with a letter, and contain only letters, digits, "
                "and underscores (e.g. 'PLATFORM_ADMIN', 'ERP_OPERATOR')."
            )
        return value

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<PlatformRole role_key={self.role_key!r} is_active={self.is_active}>"


class PlatformPermission(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single, fine-grained platform permission code (Phase 5 Section 6), e.g. `platform.erp.update`."""

    __tablename__ = "platform_permissions"

    permission_key: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
        index=True,
        doc="Dotted, machine-readable code, e.g. 'platform.erp.update'.",
    )
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    @validates("permission_key")
    def _validate_permission_key(self, _key: str, value: str) -> str:
        """Enforce the lowercase-dotted key shape every example in the brief uses."""
        if not value or not _PERMISSION_KEY_PATTERN.match(value):
            raise ValueError(
                "permission_key must be lowercase, start with a letter, and contain only letters, "
                "digits, dots, and underscores (e.g. 'platform.erp.update')."
            )
        return value

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<PlatformPermission permission_key={self.permission_key!r}>"


class RolePermission(Base, UUIDPrimaryKeyMixin):
    """Many-to-many link granting one `PlatformPermission` to one `PlatformRole` (Phase 5 Section 7)."""

    __tablename__ = "platform_role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission_id", name="uq_platform_role_permission"),)

    role_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("platform_roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("platform_permissions.id", ondelete="CASCADE"), nullable=False, index=True
    )

    role: Mapped[PlatformRole] = relationship(back_populates="permission_links")
    permission: Mapped[PlatformPermission] = relationship(lazy="selectin")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<RolePermission role_id={self.role_id} permission_id={self.permission_id}>"


class PlatformRoleAssignment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    One GlobalUser's assignment of one PlatformRole, optionally scoped to one ERP (Phase 5 Section 8/9).

    Deliberately NOT embedded into `GlobalUser` itself (Section 8: "Do
    not permanently embed role membership into the GlobalUser record.")
    -- a GlobalUser can hold multiple assignments (different roles,
    different scopes) simultaneously, each independently revocable with
    its own audit trail (`assigned_by`/`revoked_by`/`revoked_at`).

    Scope enforcement: if `scope == ERP`, `erp_instance_id` MUST be set
    (checked in the service layer, not a DB constraint, since "must be
    set when scope=ERP, must be null when scope=GLOBAL" is a conditional
    business rule the service layer validates explicitly for a clearer
    error message -- see `service.py::PlatformAuthzService.assign_role`).
    """

    __tablename__ = "platform_role_assignments"
    __table_args__ = (
        UniqueConstraint(
            "global_user_id", "role_id", "erp_instance_id", name="uq_platform_role_assignment_user_role_erp"
        ),
    )

    global_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("global_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("platform_roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[AuthorizationScope] = mapped_column(
        SAEnum(AuthorizationScope, name="platform_authz_scope", native_enum=False, length=10),
        nullable=False,
        default=AuthorizationScope.GLOBAL,
    )
    erp_instance_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("erp_instances.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        doc="Required when scope=ERP, must be null when scope=GLOBAL (validated in the service layer).",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), nullable=True, doc="The PlatformAdmin.id or GlobalUser.id who created this assignment."
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, doc="Optional expiration (Section 8). Null means no expiry."
    )

    global_user: Mapped[GlobalUser] = relationship()
    role: Mapped[PlatformRole] = relationship(lazy="selectin")
    erp_instance: Mapped[ErpInstance | None] = relationship()

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return (
            f"<PlatformRoleAssignment global_user_id={self.global_user_id} role_id={self.role_id} "
            f"scope={self.scope.value} is_active={self.is_active}>"
        )
