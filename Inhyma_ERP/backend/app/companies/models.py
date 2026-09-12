"""
Company ORM Models.

Owns the ``companies``, ``company_contacts``, ``company_emails``,
``company_category_links``, ``company_sub_category_links``, and
``company_product_links`` tables. Duplicated from the Supplier architecture
to provide an independent, dedicated Companies module.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


def _utcnow() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class CompanyType(str, Enum):
    """Company classification."""

    MANUFACTURER = "manufacturer"
    TRADER = "trader"
    DEALER = "dealer"
    AGENT = "agent"
    EXPORTER = "exporter"
    WHOLESALER = "wholesaler"
    DISTRIBUTOR = "distributor"


class CompanyGrade(str, Enum):
    """Company grade rating."""

    A = "A"
    B = "B"
    C = "C"


class CompanyCurrentStatus(str, Enum):
    """Company lifecycle status."""

    NEW = "new"
    EXISTING = "existing"


class CompanyPotential(str, Enum):
    """Company potential rating."""

    YES = "yes"
    NO = "no"


class Company(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single company profile record."""

    __tablename__ = "companies"

    # --- First data form ---------------------------------------------------------------
    company_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    company_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    brand_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    country_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("countries.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    state_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("states.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    city_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("cities.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    area: Mapped[str | None] = mapped_column(String(255), nullable=True)
    district: Mapped[str | None] = mapped_column(String(150), nullable=True)

    contact_salutation: Mapped[str | None] = mapped_column(String(10), nullable=True)
    contact_full_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contact_designation: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contact_calling_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_whatsapp_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_wechat_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_indiamart_number: Mapped[str | None] = mapped_column(String(30), nullable=True)

    sales_person_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # --- Second form (main data profile form) --------------------------------------------
    tax_id_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    town: Mapped[str | None] = mapped_column(String(150), nullable=True)
    primary_website: Mapped[str | None] = mapped_column(Text, nullable=True)
    secondary_website: Mapped[str | None] = mapped_column(Text, nullable=True)

    company_grade: Mapped[CompanyGrade | None] = mapped_column(
        SAEnum(CompanyGrade, name="company_grade_enum", native_enum=False, length=5), nullable=True
    )
    current_status: Mapped[CompanyCurrentStatus | None] = mapped_column(
        SAEnum(CompanyCurrentStatus, name="company_current_status_enum", native_enum=False, length=20),
        nullable=True,
    )
    potential: Mapped[CompanyPotential | None] = mapped_column(
        SAEnum(CompanyPotential, name="company_potential_enum", native_enum=False, length=10), nullable=True
    )
    potential_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    secondary_products_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    visited_factory_office: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    visit_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    visit_media: Mapped[list | None] = mapped_column(JSON, nullable=True)

    overall_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    emails: Mapped[list["CompanyEmail"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", lazy="selectin"
    )
    contacts: Mapped[list["CompanyContact"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", lazy="selectin"
    )
    category_links: Mapped[list["CompanyCategoryLink"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", lazy="selectin"
    )
    sub_category_links: Mapped[list["CompanySubCategoryLink"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", lazy="selectin"
    )
    product_links: Mapped[list["CompanyProductLink"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<Company company_name={self.company_name!r}>"


class CompanyEmail(Base, UUIDPrimaryKeyMixin):
    """One email address belonging to a company."""

    __tablename__ = "company_emails"
    __table_args__ = (UniqueConstraint("company_id", "email", name="uq_company_email"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    company: Mapped[Company] = relationship(back_populates="emails")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<CompanyEmail email={self.email!r}>"


class CompanyContact(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """One contact person for a company."""

    __tablename__ = "company_contacts"

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    salutation: Mapped[str | None] = mapped_column(String(10), nullable=True)
    person_name: Mapped[str] = mapped_column(String(150), nullable=False)
    designation: Mapped[str | None] = mapped_column(String(150), nullable=True)
    handling_territory: Mapped[str | None] = mapped_column(String(150), nullable=True)
    country_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("countries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    calling_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    whatsapp_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    wechat_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    company: Mapped[Company] = relationship(back_populates="contacts")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<CompanyContact person_name={self.person_name!r}>"


class CompanyCategoryLink(Base, UUIDPrimaryKeyMixin):
    """Many-to-many link: a company to one Product Category."""

    __tablename__ = "company_category_links"
    __table_args__ = (UniqueConstraint("company_id", "category_id", name="uq_company_category"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("product_categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    company: Mapped[Company] = relationship(back_populates="category_links")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<CompanyCategoryLink company_id={self.company_id} category_id={self.category_id}>"


class CompanySubCategoryLink(Base, UUIDPrimaryKeyMixin):
    """Many-to-many link: a company to one Product Sub-Category."""

    __tablename__ = "company_sub_category_links"
    __table_args__ = (UniqueConstraint("company_id", "sub_category_id", name="uq_company_subcategory"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sub_category_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("product_sub_categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    company: Mapped[Company] = relationship(back_populates="sub_category_links")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<CompanySubCategoryLink company_id={self.company_id} sub_category_id={self.sub_category_id}>"


class CompanyProductLink(Base, UUIDPrimaryKeyMixin):
    """Many-to-many link: a company to one specific Product SKU."""

    __tablename__ = "company_product_links"
    __table_args__ = (UniqueConstraint("company_id", "product_id", name="uq_company_product"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    company: Mapped[Company] = relationship(back_populates="product_links")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<CompanyProductLink company_id={self.company_id} product_id={self.product_id}>"
