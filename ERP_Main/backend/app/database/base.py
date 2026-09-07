"""
Declarative Base and Shared Model Mixins.

Deliberately identical in shape to Yinglima_ERP's `app.database.base`: same
`GUID` cross-dialect UUID type, same mixins. This is its own database
though -- ERP_Main and Yinglima do not share a `Base`, a metadata object, a
connection, or a single row. Two codebases independently choosing the same
good pattern is not coupling.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import CHAR, TypeDecorator


class GUID(TypeDecorator):
    """
    Platform-independent UUID column type.

    Stores as PostgreSQL's native `UUID` type when available, and falls
    back to `CHAR(36)` on other backends (e.g. SQLite for local dev/tests).
    """

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        """Use the native UUID type on PostgreSQL, CHAR(36) elsewhere."""
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import UUID as PG_UUID

            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        """Normalize the Python value before sending it to the DB driver."""
        if value is None:
            return value
        if dialect.name == "postgresql":
            return str(value)
        if not isinstance(value, uuid.UUID):
            return str(uuid.UUID(str(value)))
        return str(value)

    def process_result_value(self, value, dialect):
        """Coerce the raw DB value back into a `uuid.UUID` in Python."""
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


def _utcnow() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Shared declarative base for every ORM model in ERP_Main's own database."""


class UUIDPrimaryKeyMixin:
    """Mixin providing a UUID v4 primary key column named `id` -- the internal, immutable identity."""

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4, nullable=False)


class TimestampMixin:
    """Mixin providing `created_at` / `updated_at` UTC timestamp columns."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
