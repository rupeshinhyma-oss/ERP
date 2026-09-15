"""
Social Media ORM Model.

Owns the ``social_media`` table: Name and active status, corresponding to the Social Media master module.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class SocialMedia(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single social media platform entry (e.g. Google, YouTube, Instagram, Facebook)."""

    __tablename__ = "social_media"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="social_media_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<SocialMedia name={self.name!r} status={self.status!r}>"
