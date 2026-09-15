"""
AgentType ORM Model.

Owns the ``agent_types`` table: Name, optional description, and active status, corresponding to the Agent Types master module.
"""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class AgentType(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single agent type reference record."""

    __tablename__ = "agent_types"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="agent_type_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<AgentType name={self.name!r} status={self.status!r}>"
