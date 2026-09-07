"""
Platform Admin ORM Model.

Owns the `platform_admins` table: ERP_Main's own human administrators --
the security principals allowed to mutate the control plane (ERP
Registry, Global Users, Memberships, service credentials).

This is explicitly NOT a GlobalUser (see `app.global_users`). A
GlobalUser is a business/end-user identity that gets ERP Memberships
into Yinglima/Inhyma/future ERPs. A PlatformAdmin is a control-plane
operator identity -- Phase 3 Step 20 calls this out directly: "Do not
recreate every Yinglima/Inhyma local permission in ERP_Main" and "Do not
build an enormous global RBAC system yet." Two roles are enough for now.
"""

from __future__ import annotations

from enum import Enum

from sqlalchemy import Boolean, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PlatformAdminRole(str, Enum):
    """
    Minimal control-plane authorization tiers (Phase 3 Step 20).

    SUPER_ADMIN: unrestricted control-plane access, including managing
    other platform admins and service credentials.
    PLATFORM_ADMIN: can manage the ERP Registry, Global Users, and
    Memberships, but not other admin accounts or service credentials.

    This is intentionally NOT a full RBAC system -- no permission codes,
    no role hierarchy, just two fixed tiers, exactly as much as Phase 3
    asks for and no more.
    """

    SUPER_ADMIN = "SUPER_ADMIN"
    PLATFORM_ADMIN = "PLATFORM_ADMIN"


class PlatformAdmin(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single human control-plane administrator account."""

    __tablename__ = "platform_admins"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[PlatformAdminRole] = mapped_column(
        SAEnum(PlatformAdminRole, name="platform_admin_role", native_enum=False, length=20),
        default=PlatformAdminRole.PLATFORM_ADMIN,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def __repr__(self) -> str:
        """Return a debug-friendly representation (never includes the password hash)."""
        return f"<PlatformAdmin email={self.email!r} role={self.role.value}>"
