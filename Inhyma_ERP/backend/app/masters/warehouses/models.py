"""
Warehouse ORM Model.

Owns the ``warehouses`` table: Name, Address, Billing Company, Over Selling flag,
Is Primary flag, Main Warehouse link, Color code, and active status.
"""

from __future__ import annotations

import uuid
from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.constants import RecordStatus
from app.database.base import Base, GUID, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Warehouse(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single warehouse reference record."""

    __tablename__ = "warehouses"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    billing_company: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    over_selling: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    main_warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("warehouses.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    color: Mapped[str] = mapped_column(String(20), default="#2563EB", nullable=False)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="warehouse_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    # Self-referential relationship to main warehouse
    main_warehouse: Mapped[Warehouse | None] = relationship(
        "Warehouse",
        remote_side="Warehouse.id",
        foreign_keys=[main_warehouse_id],
        lazy="selectin",
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<Warehouse name={self.name!r} billing_company={self.billing_company!r} is_primary={self.is_primary} status={self.status!r}>"
