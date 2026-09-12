"""
District ORM Model.

Owns the ``districts`` table. Every district belongs to exactly one state (and
transitively one country); district names must be unique within a state.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class District(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single district record, belonging to a state (and transitively a country)."""

    __tablename__ = "districts"
    __table_args__ = (UniqueConstraint("state_id", "name", name="uq_district_state_name"),)

    country_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("countries.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    state_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("states.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="district_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<District name={self.name!r} state_id={self.state_id}>"
