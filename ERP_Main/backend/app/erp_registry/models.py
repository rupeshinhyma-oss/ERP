"""
ERP Registry ORM Models.

Owns the `erp_instances` and `erp_modules` tables: ERP_Main's record of
which independent ERP installations exist, and what each one has declared
it supports. This is Phase 2's entire schema footprint -- deliberately
small, per the Phase 2 brief's Step 1/2 instruction to "only add fields
that are actually useful" rather than everything that might someday be
useful.

What this module is explicitly NOT
-----------------------------------
- Not an authentication or authorization system. Knowing `erp_key =
  "yinglima"` exists in this table grants nobody access to anything (see
  Step 17 of the Phase 2 brief). Global Users, ERP Membership, and Global
  RBAC are later phases.
- Not a place for Yinglima's (or any other ERP's) business data. This
  table only ever describes ERP instances as addresses/configuration
  entries -- it holds no buyers, suppliers, products, or organizations.
- Not the same concept as Yinglima's own `organizations` (single company
  profile) or `master_companies` (group-company lookup list) tables.
  See docs/MULTI_ERP_ARCHITECTURE.md §4 for why those two are unrelated
  to ERP identity and must never be confused with it.
"""

from __future__ import annotations

import re
import uuid
from enum import Enum

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin

_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class ErpStatus(str, Enum):
    """
    Controlled lifecycle status for a registered ERP instance.

    `DECOMMISSIONED` means "no longer available for normal access" -- it is
    a status value, not a deletion. Historical registry rows for a
    decommissioned ERP are kept exactly like every other status; nothing
    in this module ever hard-deletes an `ErpInstance` row (see
    `ErpRegistryService.decommission` in `service.py`, which only ever sets
    this status).
    """

    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    MAINTENANCE = "MAINTENANCE"
    SUSPENDED = "SUSPENDED"
    DECOMMISSIONED = "DECOMMISSIONED"


class ErpInstance(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A single independent ERP installation known to the platform.

    Two identifiers are deliberately kept separate, per Phase 2 Step 1:
    - `id`: internal UUID, immutable, never shown as "the" ERP identity in
      URLs/config -- this is the FK target for every other table that
      needs to reference an ERP instance.
    - `key`: stable, machine-readable, URL/config-safe string (e.g.
      "yinglima"). Unique, never auto-changed when `name`/`display_name`
      change, never reused after an ERP is decommissioned (enforced in
      `service.py`, not the DB layer, since "never reused" is a business
      rule about historical keys, not something a UNIQUE constraint alone
      can express once a row could theoretically be hard-deleted).

    Every other field here exists only because Step 2 of the Phase 2 brief
    names it as useful for a registry entry: display name, description,
    where the service lives, what environment/version it's running, and
    when it was last seen alive. Nothing speculative was added.
    """

    __tablename__ = "erp_instances"
    __table_args__ = (UniqueConstraint("key", name="uq_erp_instances_key"),)

    key: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Stable, machine-readable identifier (e.g. 'yinglima'). Never used for authorization by itself.",
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, doc="Short internal/registry name.")
    display_name: Mapped[str] = mapped_column(
        String(200), nullable=False, doc="Human-facing name shown in any future ERP-switcher UI."
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[ErpStatus] = mapped_column(
        SAEnum(ErpStatus, name="erp_status", native_enum=False, length=20),
        default=ErpStatus.INACTIVE,
        nullable=False,
        index=True,
        doc="Controlled lifecycle status. See ErpStatus docstring re: DECOMMISSIONED.",
    )

    base_url: Mapped[str | None] = mapped_column(
        String(500), nullable=True, doc="Service endpoint for this ERP instance (non-secret; no tokens/keys here)."
    )
    environment: Mapped[str | None] = mapped_column(
        String(50), nullable=True, doc="Deployment environment this instance reports running in, e.g. 'production'."
    )
    version: Mapped[str | None] = mapped_column(
        String(50), nullable=True, doc="Application version this instance last reported."
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc=(
            "UTC timestamp of the last time this instance was known to be reachable. "
            "Phase 2 only stores this field and exposes it for manual updates via "
            "PATCH; nothing yet writes to it automatically -- see "
            "docs/MULTI_ERP_ARCHITECTURE.md Phase 3 notes for the future health-check "
            "job that will populate it."
        ),
    )

    modules: Mapped[list["ErpModule"]] = relationship(
        back_populates="erp_instance", cascade="all, delete-orphan", lazy="selectin"
    )

    @validates("key")
    def _validate_key(self, _key: str, value: str) -> str:
        """Enforce the key format rules from Phase 2 Step 4 at the model layer."""
        if not value or not _KEY_PATTERN.match(value):
            raise ValueError(
                "ERP key must be lowercase, start with a letter, and contain only letters, "
                "digits, and underscores (e.g. 'yinglima', 'erp_03')."
            )
        return value

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<ErpInstance key={self.key!r} status={self.status.value}>"


class ErpModule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A single capability/module an ERP instance has declared it supports.

    This is the "module/capability registry foundation" from Phase 2 Step
    11 -- a flat, data-driven list (e.g. `("yinglima", "CRM")`,
    `("yinglima", "Sales")`, `("inhyma", "Manufacturing")`), NOT a redesign
    of Yinglima's own module architecture. Nothing about Yinglima's actual
    `app/api/v1/router.py` module set changes because a row exists here;
    this table only lets ERP_Main answer "what did this ERP say it has"
    without hardcoding per-ERP `if` branches anywhere (Step 5).
    """

    __tablename__ = "erp_modules"
    __table_args__ = (UniqueConstraint("erp_instance_id", "module_key", name="uq_erp_modules_instance_key"),)

    erp_instance_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    module_key: Mapped[str] = mapped_column(
        String(100), nullable=False, doc="Machine-readable capability/module key, e.g. 'crm', 'sales', 'inventory'."
    )
    module_name: Mapped[str] = mapped_column(String(150), nullable=False, doc="Human-readable module/capability name.")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    erp_instance: Mapped[ErpInstance] = relationship(back_populates="modules")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<ErpModule erp_instance_id={self.erp_instance_id} module_key={self.module_key!r}>"
