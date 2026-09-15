"""
Billing Company ORM Model.

Owns the ``billing_companies`` table: Name, Email, Mobile, Logo, Signature,
Address, City, Zip Code, GST No, Pancard, Sale Order Prefix, Proforma Invoice Prefix,
Bank Name, Sale Order Term And Condition, and status.
"""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class BillingCompany(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single billing company reference record."""

    __tablename__ = "billing_companies"

    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    mobile: Mapped[str | None] = mapped_column(String(20), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    zip_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gst_no: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    pan_no: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    so_prefix: Mapped[str] = mapped_column(String(30), nullable=False)
    pi_prefix: Mapped[str] = mapped_column(String(30), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(100), nullable=False)
    terms_and_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="billing_company_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<BillingCompany name={self.name!r} email={self.email!r} status={self.status!r}>"
