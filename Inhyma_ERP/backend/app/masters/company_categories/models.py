"""
CompanyCategory ORM Model.

Owns the ``company_categories`` table: Name, Business Type (B2B, B2C, etc.),
optional description, and active status, corresponding to the Company Categories
master module.
"""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class CompanyCategory(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single company category reference record."""

    __tablename__ = "company_categories"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    business_type: Mapped[str] = mapped_column(String(50), nullable=False, default="B2B", index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="company_category_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<CompanyCategory name={self.name!r} business_type={self.business_type!r} status={self.status!r}>"
