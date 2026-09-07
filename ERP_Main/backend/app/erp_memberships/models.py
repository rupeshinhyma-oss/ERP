"""
ERP Membership ORM Model.

Owns the `erp_memberships` table: the association between one GlobalUser
and one local account in one ERP (Phase 3 Steps 8-9).

    GlobalUser G1
    +-- Membership -> Yinglima -> local_user_id "17"
    +-- Membership -> Inhyma   -> local_user_id "93"

`local_user_id` type decision (Phase 3 Step 10)
------------------------------------------------
Both Yinglima's and Inhyma's `User.id` are UUIDs today (confirmed by
inspecting `app.users.models.User` in both repos, which both inherit
`UUIDPrimaryKeyMixin`). Even so, this column is a **bounded string**
(`String(255)`), not a UUID column type, for two reasons:
1. Step 10 asks for a representation that "safely supports... future ERP
   ID formats" -- a future ERP might reasonably use an integer, a
   composite key, or some other identifier scheme, and a string holds any
   of those (including a UUID's own text form) without a future migration
   to loosen the column type.
2. This is explicitly NOT a SQL foreign key into any ERP's own database
   (Phase 3 Steps 10/45: "Do NOT create a database foreign key from
   ERP_Main to an ERP database") -- it is an opaque external identifier
   ERP_Main stores and echoes back, never joins against, so there is no
   correctness benefit to a stricter column type, only a future
   flexibility cost.

Two independent uniqueness constraints (Phase 3 Step 11) enforce:
- one GlobalUser has at most one membership per ERP instance
  (`uq_erp_memberships_user_erp`).
- one ERP-local account maps to at most one GlobalUser
  (`uq_erp_memberships_erp_local_user`) -- strongly recommended by the
  brief and enforced here at the database level, not just in the service
  layer, so it holds even under concurrent requests.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_registry.models import ErpInstance
from app.global_users.models import GlobalUser

_LOCAL_USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,255}$")


class ErpMembershipStatus(str, Enum):
    """
    Controlled lifecycle status for one GlobalUser<->ERP membership (Phase 3 Step 12).

    PENDING: linked but not yet verified against the ERP's own local
    account (Step 16 -- used when live service-to-service verification
    wasn't available at link time).
    ACTIVE: verified and currently valid for global access purposes.
    SUSPENDED: temporarily not valid; reversible via `restore` (Step 48).
    REVOKED: the association is no longer valid. This does NOT mean the
    local ERP user was deleted (Step 48) -- it only means this specific
    GlobalUser<->ERP link is closed.
    """

    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    REVOKED = "REVOKED"


class ErpMembership(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One GlobalUser's association with one local account in one ERP instance."""

    __tablename__ = "erp_memberships"
    __table_args__ = (
        UniqueConstraint("global_user_id", "erp_instance_id", name="uq_erp_memberships_user_erp"),
        UniqueConstraint("erp_instance_id", "local_user_id", name="uq_erp_memberships_erp_local_user"),
    )

    global_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("global_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    erp_instance_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    local_user_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Opaque identifier from the local ERP's own User table. NOT a SQL foreign key into that "
        "ERP's database -- see module docstring for the type decision.",
    )
    status: Mapped[ErpMembershipStatus] = mapped_column(
        SAEnum(ErpMembershipStatus, name="erp_membership_status", native_enum=False, length=20),
        default=ErpMembershipStatus.PENDING,
        nullable=False,
        index=True,
    )
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, doc="When this membership was first created (link requested)."
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="When the local account was confirmed to exist via service-to-service verification, if ever.",
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    global_user: Mapped[GlobalUser] = relationship()
    erp_instance: Mapped[ErpInstance] = relationship()

    @validates("local_user_id")
    def _validate_local_user_id(self, _key: str, value: str) -> str:
        """Reject an empty or unreasonably-shaped local_user_id before it ever reaches the database."""
        if not value or not _LOCAL_USER_ID_PATTERN.match(value):
            raise ValueError(
                "local_user_id must be 1-255 characters of letters, digits, '.', '_', ':', or '-'."
            )
        return value

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return (
            f"<ErpMembership global_user_id={self.global_user_id} erp_instance_id={self.erp_instance_id} "
            f"status={self.status.value}>"
        )
