"""
Global User ORM Model.

Owns the `global_users` table: one row per human identity across the
multi-ERP ecosystem (Phase 3 Step 6). A GlobalUser is deliberately thin --
it identifies a person at the platform level; it is NOT a copy of any
local ERP's `User`/employee record (Step 6: "Do NOT overfill GlobalUser
with local ERP employee information. Do NOT copy entire local User
objects.").

What links a GlobalUser to a specific ERP's own local account is
`ErpMembership` (see `app.erp_memberships`), not anything on this model.
"""

from __future__ import annotations

from enum import Enum

from sqlalchemy import JSON, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class GlobalUserStatus(str, Enum):
    """
    Controlled lifecycle status for a Global User (Phase 3 Step 7).

    This is deliberately separate from any ERP's status, any
    ErpMembership's status, and any local User's status (Step 12) --
    collapsing these into one enum would make it impossible to express
    "this person is a suspended global identity but their Yinglima
    membership/local account is untouched," which Phase 3's access model
    (Step 13, Step 47) depends on being expressible.
    """

    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"


class GlobalUser(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One human identity across the multi-ERP ecosystem."""

    __tablename__ = "global_users"

    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    primary_email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    status: Mapped[GlobalUserStatus] = mapped_column(
        SAEnum(GlobalUserStatus, name="global_user_status", native_enum=False, length=20),
        default=GlobalUserStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    external_identity_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        doc="Optional external IdP subject/identifier (e.g. for a future OIDC provider). Unused by "
        "anything in Phase 3 -- present only because Step 6 names it as a justified optional field "
        "for a future federation phase to read without a schema change.",
    )
    metadata_json: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, doc="Optional non-sensitive structured metadata. Never a place for secrets."
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<GlobalUser primary_email={self.primary_email!r} status={self.status.value}>"
