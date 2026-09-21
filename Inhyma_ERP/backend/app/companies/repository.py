"""
Company Repository.

Query-specific extensions for ``companies`` plus its child tables
(``company_emails``, ``company_contacts``, and the category/sub-category/product
link tables). All many-to-many and one-to-many child rows are managed here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ColumnElement, Select, and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.cities.models import City
from app.masters.countries.models import Country
from app.masters.product_categories.models import ProductCategory
from app.masters.product_sub_categories.models import ProductSubCategory
from app.masters.products.models import Product
from app.masters.states.models import State
from app.companies.models import (
    Company,
    CompanyCategoryLink,
    CompanyContact,
    CompanyEmail,
    CompanyProductLink,
    CompanySubCategoryLink,
)


class CompanyRepository(BaseRepository[Company]):
    """Repository for company profile rows."""

    searchable_fields = (
        "company_name",
        "company_type",
        "contact_full_name",
        "contact_designation",
        "contact_calling_number",
        "contact_whatsapp_number",
        "contact_wechat_number",
        "contact_indiamart_number",
        "tax_id_number",
        "address",
        "town",
        "area",
        "district",
        "primary_website",
        "secondary_website",
        "brand_description",
        "secondary_products_description",
        "visit_remarks",
        "overall_remarks",
    )
    sortable_fields = (
        "company_name",
        "created_at",
        "updated_at",
        "company_grade",
        "current_status",
    )
    filterable_fields = (
        "status",
        "country_id",
        "state_id",
        "city_id",
        "company_type",
        "company_grade",
        "current_status",
        "potential",
        "is_active",
        "visited_factory_office",
    )

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``Company`` model."""
        super().__init__(session, Company)

    def _base_select(self) -> Select:
        """Exclude soft-deleted companies."""
        return super()._base_select()

    def _apply_search(self, stmt: Select, term: str | None) -> Select:
        """
        Comprehensive search matching company fields:
        name, geography, contacts, phones, emails, websites, tax ID, categories, sub-cats, products.
        """
        if not term:
            return stmt
        clean = term.strip()
        if not clean:
            return stmt
        pattern = f"%{clean}%"

        direct_columns = [
            Company.company_name,
            Company.company_type,
            Company.contact_full_name,
            Company.contact_designation,
            Company.contact_calling_number,
            Company.contact_whatsapp_number,
            Company.contact_wechat_number,
            Company.contact_indiamart_number,
            Company.tax_id_number,
            Company.address,
            Company.town,
            Company.area,
            Company.district,
            Company.primary_website,
            Company.secondary_website,
            Company.brand_description,
            Company.secondary_products_description,
            Company.visit_remarks,
            Company.overall_remarks,
        ]
        conditions: list[ColumnElement[bool]] = [col.ilike(pattern) for col in direct_columns]

        # 1. Country Name / Code
        conditions.append(
            exists().where(
                Country.id == Company.country_id,
                or_(Country.name.ilike(pattern), Country.code.ilike(pattern)),
            )
        )

        # 2. State / Province Name / Code
        conditions.append(
            exists().where(
                State.id == Company.state_id,
                or_(State.name.ilike(pattern), State.code.ilike(pattern)),
            )
        )

        # 3. City Name
        conditions.append(
            exists().where(
                City.id == Company.city_id,
                City.name.ilike(pattern),
            )
        )

        # 4. Child Emails
        conditions.append(
            exists().where(
                CompanyEmail.company_id == Company.id,
                CompanyEmail.email.ilike(pattern),
            )
        )

        # 5. Child Contacts
        conditions.append(
            exists().where(
                CompanyContact.company_id == Company.id,
                or_(
                    CompanyContact.person_name.ilike(pattern),
                    CompanyContact.calling_number.ilike(pattern),
                    CompanyContact.whatsapp_number.ilike(pattern),
                    CompanyContact.email.ilike(pattern),
                    CompanyContact.designation.ilike(pattern),
                ),
            )
        )

        # 6. Linked Product Categories
        conditions.append(
            exists().where(
                CompanyCategoryLink.company_id == Company.id,
                ProductCategory.id == CompanyCategoryLink.category_id,
                or_(ProductCategory.name.ilike(pattern), ProductCategory.code.ilike(pattern)),
            )
        )

        # 7. Linked Product Sub Categories
        conditions.append(
            exists().where(
                CompanySubCategoryLink.company_id == Company.id,
                ProductSubCategory.id == CompanySubCategoryLink.sub_category_id,
                or_(ProductSubCategory.name.ilike(pattern), ProductSubCategory.code.ilike(pattern)),
            )
        )

        # 8. Linked Products
        conditions.append(
            exists().where(
                CompanyProductLink.company_id == Company.id,
                Product.id == CompanyProductLink.product_id,
                or_(
                    Product.product_name.ilike(pattern),
                    Product.product_code.ilike(pattern),
                    Product.product_name_tally.ilike(pattern),
                    Product.product_name_invoice.ilike(pattern),
                ),
            )
        )

        return stmt.where(or_(*conditions))

    async def name_city_exists(
        self, company_name: str, city_id: uuid.UUID | None = None, *, exclude_id: uuid.UUID | None = None
    ) -> bool:
        """Return True if a non-deleted company with this Company Name (+ City if given) already exists."""
        stmt = (
            self._base_select()
            .with_only_columns(Company.id)
            .where(Company.company_name.ilike(company_name))
        )
        if city_id is not None:
            stmt = stmt.where(Company.city_id == city_id)
        if exclude_id is not None:
            stmt = stmt.where(Company.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_by_name_city(
        self, company_name: str, city_id: uuid.UUID | None = None, *, exclude_id: uuid.UUID | None = None
    ) -> Company | None:
        """Fetch the company matching this Company Name (+ City if given), if one exists."""
        stmt = self._base_select().where(Company.company_name.ilike(company_name))
        if city_id is not None:
            stmt = stmt.where(Company.city_id == city_id)
        if exclude_id is not None:
            stmt = stmt.where(Company.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_with_relations(self, company_id: uuid.UUID) -> Company | None:
        """Fetch a company by ID with relations loaded."""
        return await self.get_by_id(company_id)

    async def list_all(self) -> list[Company]:
        """Return every non-deleted company, ordered by company name."""
        stmt = self._base_select().order_by(Company.company_name)
        result = await self.session.execute(stmt)
        return list(result.scalars().unique().all())

    async def list_all_category_ids(self, company_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every product-category ID linked to a company."""
        stmt = select(CompanyCategoryLink.category_id).where(CompanyCategoryLink.company_id == company_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_all_sub_category_ids(self, company_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every product-sub-category ID linked to a company."""
        stmt = select(CompanySubCategoryLink.sub_category_id).where(
            CompanySubCategoryLink.company_id == company_id
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def replace_category_links(self, company_id: uuid.UUID, category_ids: list[uuid.UUID]) -> None:
        """Replace a company's product-category links with exactly the given set."""
        existing = await self.session.execute(
            select(CompanyCategoryLink).where(CompanyCategoryLink.company_id == company_id)
        )
        for link in existing.scalars().all():
            await self.session.delete(link)
        await self.session.flush()
        for category_id in category_ids:
            self.session.add(CompanyCategoryLink(company_id=company_id, category_id=category_id))
        await self.session.flush()

    async def replace_sub_category_links(self, company_id: uuid.UUID, sub_category_ids: list[uuid.UUID]) -> None:
        """Replace a company's product-sub-category links with exactly the given set."""
        existing = await self.session.execute(
            select(CompanySubCategoryLink).where(CompanySubCategoryLink.company_id == company_id)
        )
        for link in existing.scalars().all():
            await self.session.delete(link)
        await self.session.flush()
        for sub_category_id in sub_category_ids:
            self.session.add(
                CompanySubCategoryLink(company_id=company_id, sub_category_id=sub_category_id)
            )
        await self.session.flush()

    async def list_all_product_ids(self, company_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every Product ID linked to a company."""
        stmt = select(CompanyProductLink.product_id).where(CompanyProductLink.company_id == company_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def replace_product_links(self, company_id: uuid.UUID, product_ids: list[uuid.UUID]) -> None:
        """Replace a company's linked-product set with exactly the given set."""
        existing = await self.session.execute(
            select(CompanyProductLink).where(CompanyProductLink.company_id == company_id)
        )
        for link in existing.scalars().all():
            await self.session.delete(link)
        await self.session.flush()
        seen: set[uuid.UUID] = set()
        for product_id in product_ids:
            if product_id in seen:
                continue
            seen.add(product_id)
            self.session.add(CompanyProductLink(company_id=company_id, product_id=product_id))
        await self.session.flush()

    def apply_product_filter(self, stmt: Select, product_id: uuid.UUID) -> Select:
        """Restrict a company SELECT to companies linked to the given product."""
        return stmt.where(
            exists().where(
                and_(
                    CompanyProductLink.company_id == Company.id,
                    CompanyProductLink.product_id == product_id,
                )
            )
        )

    async def replace_emails(self, company_id: uuid.UUID, emails: list[str]) -> None:
        """Replace a company's email addresses with exactly the given list."""
        existing = await self.session.execute(select(CompanyEmail).where(CompanyEmail.company_id == company_id))
        for email_row in existing.scalars().all():
            await self.session.delete(email_row)
        await self.session.flush()
        seen: set[str] = set()
        for email in emails:
            normalized = email.strip().lower()
            if normalized in seen:
                continue
            seen.add(normalized)
            self.session.add(CompanyEmail(company_id=company_id, email=email.strip()))
        await self.session.flush()

    def apply_category_filter(self, stmt: Select, category_id: uuid.UUID) -> Select:
        """Restrict a company SELECT to companies linked to the given product category."""
        return stmt.where(
            exists().where(
                and_(
                    CompanyCategoryLink.company_id == Company.id,
                    CompanyCategoryLink.category_id == category_id,
                )
            )
        )

    def apply_sub_category_filter(self, stmt: Select, sub_category_id: uuid.UUID) -> Select:
        """Restrict a company SELECT to companies linked to the given product sub-category."""
        return stmt.where(
            exists().where(
                and_(
                    CompanySubCategoryLink.company_id == Company.id,
                    CompanySubCategoryLink.sub_category_id == sub_category_id,
                )
            )
        )


class CompanyContactRepository(BaseRepository[CompanyContact]):
    """Repository for company contact-person rows."""

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``CompanyContact`` model."""
        super().__init__(session, CompanyContact)

    async def list_for_company(self, company_id: uuid.UUID) -> list[CompanyContact]:
        """Return every non-deleted contact for a company, primary contact first."""
        stmt = (
            self._base_select()
            .where(CompanyContact.company_id == company_id)
            .order_by(CompanyContact.is_primary.desc(), CompanyContact.created_at.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_primary_contact(self, company_id: uuid.UUID) -> CompanyContact | None:
        """Return the auto-created primary contact for a company, if any."""
        stmt = self._base_select().where(
            CompanyContact.company_id == company_id, CompanyContact.is_primary.is_(True)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
