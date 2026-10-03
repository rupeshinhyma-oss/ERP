"""Option List ORM Model.

Owns the ``option_lists`` table: one row per selectable option, grouped by ``group_key``
(e.g. ``proforma.delivery_type``, ``lead.status``). Replaces hardcoded frontend constants.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, RecordStatusColumn, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class OptionList(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single option inside a named option group."""

    __tablename__ = "option_lists"
    __table_args__ = (UniqueConstraint("group_key", "value", name="uq_option_lists_group_value"),)

    group_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        RecordStatusColumn(),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<OptionList group={self.group_key!r} value={self.value!r}>"
