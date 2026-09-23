"""Product Repository. Query-specific extensions for ``products``."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.products.models import Product


class ProductRepository(BaseRepository[Product]):
    """Repository for product rows."""

    searchable_fields = ("product_code", "product_name", "product_name_tally", "product_name_invoice", "barcode")
    sortable_fields = ("product_code", "product_name", "created_at", "updated_at", "standard_price")
    filterable_fields = ("status", "category_id", "sub_category_id", "brand_id", "hsn_id", "uom_id", "organization_id", "has_images")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``Product`` model."""
        super().__init__(session, Product)

    def _apply_dynamic_filters(self, stmt: Select, filters: Any) -> Select:
        """Apply filters, matching organization_id against both single and multi-org fields and has_images."""
        if not filters:
            return stmt
        from sqlalchemy import String, cast, func, or_
        from app.common.filtering import FilterParams

        exact_copy = dict(filters.exact)
        org_id = exact_copy.pop("organization_id", None)
        has_images = exact_copy.pop("has_images", None)

        filters_copy = FilterParams(exact=exact_copy, ranges=filters.ranges)
        stmt = super()._apply_dynamic_filters(stmt, filters_copy)

        if org_id is not None:
            org_str = str(org_id)
            stmt = stmt.where(
                or_(
                    Product.organization_id == org_id,
                    Product.organization_ids.cast(String).ilike(f"%{org_str}%"),
                )
            )
        if has_images is not None:
            is_true = str(has_images).lower() in ("true", "1", "yes")
            if is_true:
                stmt = stmt.where(
                    Product.images.is_not(None),
                    func.json_array_length(Product.images) > 0,
                )
            else:
                stmt = stmt.where(
                    or_(
                        Product.images.is_(None),
                        func.json_array_length(Product.images) == 0,
                    )
                )
        return stmt

    async def get_by_id(self, id_: uuid.UUID) -> Product | None:
        """Fetch a single product by primary key, with its primary supplier's name/city attached."""
        product = await super().get_by_id(id_)
        if product is not None:
            await self.attach_planning_supplier_info([product])
        return product

    async def get_by_ids(self, ids: list[uuid.UUID]) -> dict[uuid.UUID, Product]:
        """Fetch many products by primary key, with each one's primary supplier's name/city attached."""
        records_by_id = await super().get_by_ids(ids)
        if records_by_id:
            await self.attach_planning_supplier_info(list(records_by_id.values()))
        return records_by_id

    async def attach_planning_supplier_info(self, products: list[Product]) -> None:
        """
        Attach each product's primary supplier's name/city.

        Supports both direct ``Product.supplier_id`` and fallback to the
        earliest ``SupplierProductLink`` created for that product. Sets
        ``supplier_name``, ``_planning_supplier_name``, and ``_planning_supplier_city``
        on each product in place.
        """
        if not products:
            return

        for product in products:
            setattr(product, "_planning_supplier_name", None)
            setattr(product, "_planning_supplier_city", None)
            setattr(product, "supplier_name", None)

        from sqlalchemy import func, select
        from app.masters.cities.models import City
        from app.suppliers.models import Supplier, SupplierProductLink

        # 1. For products with an explicit product.supplier_id, query directly
        direct_supplier_ids = [p.supplier_id for p in products if p.supplier_id]
        supplier_info_by_supplier_id: dict[uuid.UUID, tuple[str, str | None]] = {}
        if direct_supplier_ids:
            stmt_direct = (
                select(Supplier.id, Supplier.company_name, City.name.label("city_name"))
                .outerjoin(City, City.id == Supplier.city_id)
                .where(Supplier.id.in_(direct_supplier_ids))
            )
            res_direct = await self.session.execute(stmt_direct)
            supplier_info_by_supplier_id = {
                row.id: (row.company_name, row.city_name) for row in res_direct.all()
            }

        # 2. For products without explicit product.supplier_id, fallback to earliest SupplierProductLink
        products_needing_link = [p for p in products if not p.supplier_id]
        supplier_info_by_product_id: dict[uuid.UUID, tuple[uuid.UUID, str, str | None]] = {}
        if products_needing_link:
            needing_ids = [p.id for p in products_needing_link]
            ranked = (
                select(
                    SupplierProductLink.product_id,
                    SupplierProductLink.supplier_id,
                    func.row_number()
                    .over(
                        partition_by=SupplierProductLink.product_id,
                        order_by=SupplierProductLink.created_at.asc(),
                    )
                    .label("rn"),
                )
                .where(SupplierProductLink.product_id.in_(needing_ids))
                .subquery()
            )
            stmt_link = (
                select(
                    ranked.c.product_id,
                    Supplier.id.label("supplier_id"),
                    Supplier.company_name,
                    City.name.label("city_name"),
                )
                .join(Supplier, Supplier.id == ranked.c.supplier_id)
                .outerjoin(City, City.id == Supplier.city_id)
                .where(ranked.c.rn == 1)
            )
            res_link = await self.session.execute(stmt_link)
            supplier_info_by_product_id = {
                row.product_id: (row.supplier_id, row.company_name, row.city_name) for row in res_link.all()
            }

        # 3. Attach info to products
        for product in products:
            if product.supplier_id and product.supplier_id in supplier_info_by_supplier_id:
                info = supplier_info_by_supplier_id[product.supplier_id]
                setattr(product, "supplier_name", info[0])
                setattr(product, "_planning_supplier_name", info[0])
                setattr(product, "_planning_supplier_city", info[1])
            elif product.id in supplier_info_by_product_id:
                info = supplier_info_by_product_id[product.id]
                product.supplier_id = info[0]
                setattr(product, "supplier_name", info[1])
                setattr(product, "_planning_supplier_name", info[1])
                setattr(product, "_planning_supplier_city", info[2])

    def _apply_search(self, stmt, term: str | None):
        """
        Apply a flexible, space-normalized case-insensitive search across searchable_fields.

        Two conditions per field on purpose: the plain ``ILIKE`` (matches
        the base class's behavior, accelerated by a plain trigram GIN
        index per field) plus a space/hyphen-normalized ``LIKE`` against
        ``lower(replace(replace(col, ' ', ''), '-', ''))`` (accelerated by
        a separate trigram GIN index built on that SAME expression -- see
        the ``add_trgm_search_indexes`` migration's expression indexes for
        ``products``). Postgres can only use a trigram index that matches
        the exact expression queried, so the normalized search needed its
        own expression index, not just the five plain-column ones.
        """
        if not term:
            return stmt

        from sqlalchemy import case, exists, func, or_
        from app.masters.brands.models import Brand
        from app.masters.hsn.models import HsnCode
        from app.masters.product_categories.models import ProductCategory
        from app.masters.product_sub_categories.models import ProductSubCategory
        from app.masters.uom.models import UnitOfMeasurement

        clean_term = term.replace(" ", "").replace("-", "").lower()
        pattern = f"%{term}%"
        clean_pattern = f"%{clean_term}%"

        conditions = []
        for field in ("product_code", "product_name", "product_name_tally", "product_name_invoice", "barcode", "description", "origin", "packaging"):
            if hasattr(self.model, field):
                col = getattr(self.model, field)
                conditions.append(col.ilike(pattern))
                normalized_col = func.lower(func.replace(func.replace(col, " ", ""), "-", ""))
                conditions.append(normalized_col.like(clean_pattern))

        # Linked Category
        conditions.append(
            exists().where(
                ProductCategory.id == Product.category_id,
                or_(ProductCategory.name.ilike(pattern), ProductCategory.code.ilike(pattern)),
            )
        )

        # Linked Sub-Category
        conditions.append(
            exists().where(
                ProductSubCategory.id == Product.sub_category_id,
                or_(ProductSubCategory.name.ilike(pattern), ProductSubCategory.code.ilike(pattern)),
            )
        )

        # Linked Brand
        conditions.append(
            exists().where(
                Brand.id == Product.brand_id,
                or_(Brand.name.ilike(pattern), Brand.code.ilike(pattern)),
            )
        )

        # Linked HSN
        conditions.append(
            exists().where(
                HsnCode.id == Product.hsn_id,
                or_(HsnCode.code.ilike(pattern), HsnCode.description.ilike(pattern)),
            )
        )

        # Linked UOM
        conditions.append(
            exists().where(
                UnitOfMeasurement.id == Product.uom_id,
                or_(UnitOfMeasurement.name.ilike(pattern), UnitOfMeasurement.code.ilike(pattern), UnitOfMeasurement.short_name.ilike(pattern)),
            )
        )

        # Priority relevance ranking: direct name/code prefix > substring > linked masters > hidden specs
        relevance_rank = case(
            (Product.product_name_tally.ilike(f"{term}%"), 1),
            (Product.product_code.ilike(f"{term}%"), 2),
            (Product.product_name_tally.ilike(pattern), 3),
            (Product.product_name.ilike(pattern), 4),
            (Product.product_code.ilike(pattern), 5),
            else_=10,
        )

        return stmt.where(or_(*conditions)).order_by(relevance_rank)

    async def get_by_code(self, product_code: str) -> Product | None:
        """Fetch a product by its unique code."""
        stmt = self._base_select().where(Product.product_code == product_code)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def code_exists(self, product_code: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another product already uses this code."""
        from sqlalchemy import select
        stmt = select(Product.id).where(Product.product_code == product_code)
        if exclude_id is not None:
            stmt = stmt.where(Product.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[Product]:
        """Return every non-deleted product, ordered by name."""
        stmt = self._base_select().order_by(Product.product_name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def is_referenced(self, product_id: uuid.UUID) -> bool:
        """
        Return True if any other module references this product.

        Products is the central item master every other module keys off
        of rather than duplicating (see this module's docstring), so this
        check grows as new modules link to Product by foreign key.
        Currently checks: Suppliers (``supplier_product_links``). Future
        modules (Inventory, Sales, Purchase) should extend this same
        method rather than adding their own separate "can I delete this
        product" check.
        """
        from sqlalchemy import exists, select

        from app.suppliers.models import SupplierProductLink

        stmt = select(exists().where(SupplierProductLink.product_id == product_id))
        result = await self.session.execute(stmt)
        return bool(result.scalar())