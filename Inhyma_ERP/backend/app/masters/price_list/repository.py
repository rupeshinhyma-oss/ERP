"""Repository for Price List Management Module."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException
from app.masters.brands.models import Brand
from app.masters.price_list.schemas import (
    AssignSupplierQuotePayload,
    PriceListItem,
    PriceListMetrics,
    SupplierQuoteItem,
)
from app.masters.product_categories.models import ProductCategory
from app.masters.product_sub_categories.models import ProductSubCategory
from app.masters.products.models import Product
from app.masters.taxes.models import Tax
from app.masters.uom.models import UnitOfMeasurement
from app.suppliers.models import Supplier, SupplierProductLink


class PriceListRepository:
    """Repository handling database queries and price calculations for Price List Master."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_price_items(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
        category_id: uuid.UUID | None = None,
        sub_category_id: uuid.UUID | None = None,
        brand_id: uuid.UUID | None = None,
        has_price: bool | None = None,
        gst_percent: float | None = None,
        sort_by: str = "product_name_tally",
        sort_dir: str = "asc",
    ) -> tuple[list[PriceListItem], int]:
        """
        Fetch paginated products with tax, master lookups, and calculated GST prices.
        Returns (items, total_count).
        """
        page = max(1, page)
        page_size = max(1, min(10000, page_size))
        offset = (page - 1) * page_size

        # Base query joining Product with its lookup masters and Tax
        base_stmt = (
            select(
                Product,
                ProductCategory.name.label("category_name"),
                ProductSubCategory.name.label("sub_category_name"),
                Brand.name.label("brand_name"),
                UnitOfMeasurement.code.label("uom_code"),
                Tax.hsn_number.label("tax_hsn_number"),
                Tax.gst_percent.label("tax_gst_percent"),
                Tax.import_duty_percent.label("tax_import_duty_percent"),
            )
            .outerjoin(ProductCategory, ProductCategory.id == Product.category_id)
            .outerjoin(ProductSubCategory, ProductSubCategory.id == Product.sub_category_id)
            .outerjoin(Brand, Brand.id == Product.brand_id)
            .outerjoin(UnitOfMeasurement, UnitOfMeasurement.id == Product.uom_id)
            .outerjoin(Tax, Tax.id == Product.hsn_id)
            .where(Product.deleted_at.is_(None))
        )

        if category_id:
            base_stmt = base_stmt.where(Product.category_id == category_id)

        if sub_category_id:
            base_stmt = base_stmt.where(Product.sub_category_id == sub_category_id)

        if brand_id:
            base_stmt = base_stmt.where(Product.brand_id == brand_id)

        if has_price is True:
            base_stmt = base_stmt.where(Product.standard_price.is_not(None), Product.standard_price > 0)
        elif has_price is False:
            base_stmt = base_stmt.where(or_(Product.standard_price.is_(None), Product.standard_price == 0))

        if gst_percent is not None:
            base_stmt = base_stmt.where(Tax.gst_percent == gst_percent)

        if search and search.strip():
            term = f"%{search.strip()}%"
            base_stmt = base_stmt.where(
                or_(
                    Product.product_code.ilike(term),
                    Product.product_name.ilike(term),
                    Product.product_name_tally.ilike(term),
                    Product.product_name_invoice.ilike(term),
                    Product.barcode.ilike(term),
                    ProductCategory.name.ilike(term),
                    Brand.name.ilike(term),
                    Tax.hsn_number.ilike(term),
                )
            )

        # Count total matching rows
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        count_res = await self.session.execute(count_stmt)
        total_count = count_res.scalar() or 0

        if total_count == 0:
            return [], 0

        # Determine sorting
        sort_map: dict[str, Any] = {
            "product_code": Product.product_code,
            "product_name": Product.product_name,
            "standard_price": Product.standard_price,
            "minimum_price": Product.minimum_price,
            "standard_cost": Product.standard_cost,
            "current_stock": Product.current_stock,
            "created_at": Product.created_at,
            "product_name_tally": Product.product_name_tally,
        }
        order_col = sort_map.get(sort_by, Product.product_name_tally)
        base_stmt = base_stmt.order_by(order_col.desc() if sort_dir.lower() == "desc" else order_col.asc())

        # Paginate
        base_stmt = base_stmt.limit(page_size).offset(offset)
        result = await self.session.execute(base_stmt)
        rows = result.all()

        if not rows:
            return [], total_count

        product_ids = [r[0].id for r in rows]

        # Fetch supplier quotation links for the fetched products in a single batch
        supp_stmt = (
            select(
                SupplierProductLink,
                Supplier.company_name,
                Supplier.contact_calling_number,
            )
            .join(Supplier, Supplier.id == SupplierProductLink.supplier_id)
            .where(
                SupplierProductLink.product_id.in_(product_ids),
                Supplier.deleted_at.is_(None),
            )
            .order_by(SupplierProductLink.created_at.asc())
        )
        supp_result = await self.session.execute(supp_stmt)
        supp_rows = supp_result.all()

        quotes_by_product_id: dict[uuid.UUID, list[SupplierQuoteItem]] = {pid: [] for pid in product_ids}
        for link, comp_name, contact_num in supp_rows:
            quotes_by_product_id[link.product_id].append(
                SupplierQuoteItem(
                    link_id=link.id,
                    supplier_id=link.supplier_id,
                    supplier_name=comp_name,
                    calling_number=contact_num,
                    unit_price=float(link.unit_price) if link.unit_price is not None else None,
                    currency=link.currency or "INR",
                    moq=float(link.moq) if link.moq is not None else None,
                    notes=link.notes,
                    updated_at=link.updated_at,
                )
            )

        items: list[PriceListItem] = []
        for row in rows:
            p: Product = row[0]
            cat_name = row[1]
            sub_cat_name = row[2]
            br_name = row[3]
            uom_code = row[4]
            hsn_num = row[5]
            tax_gst = row[6]
            duty_pct = row[7]

            gst_pct = float(tax_gst) if tax_gst is not None else 18.0
            import_duty = float(duty_pct) if duty_pct is not None else 0.0

            std_price = float(p.standard_price) if p.standard_price is not None else None
            min_price = float(p.minimum_price) if p.minimum_price is not None else None
            std_cost = float(p.standard_cost) if p.standard_cost is not None else None

            # GST amounts and Inclusive totals
            std_price_gst = round(std_price * (gst_pct / 100.0), 2) if std_price is not None else None
            std_price_inc = round(std_price + std_price_gst, 2) if (std_price is not None and std_price_gst is not None) else None

            min_price_gst = round(min_price * (gst_pct / 100.0), 2) if min_price is not None else None
            min_price_inc = round(min_price + min_price_gst, 2) if (min_price is not None and min_price_gst is not None) else None

            std_cost_gst = round(std_cost * (gst_pct / 100.0), 2) if std_cost is not None else None
            std_cost_inc = round(std_cost + std_cost_gst, 2) if (std_cost is not None and std_cost_gst is not None) else None

            # Margins
            margin_amt = None
            margin_pct = None
            if std_price is not None and std_cost is not None:
                margin_amt = round(std_price - std_cost, 2)
                margin_pct = round(((std_price - std_cost) / std_price) * 100.0, 2) if std_price > 0 else 0.0

            images_list = p.images if isinstance(p.images, list) else []
            first_img = images_list[0] if images_list and isinstance(images_list[0], str) else None

            supp_quotes = quotes_by_product_id.get(p.id, [])

            items.append(
                PriceListItem(
                    product_id=p.id,
                    product_code=p.product_code,
                    product_name=p.product_name,
                    product_name_tally=p.product_name_tally,
                    product_name_invoice=p.product_name_invoice,
                    barcode=p.barcode,
                    category_id=p.category_id,
                    category_name=cat_name,
                    sub_category_id=p.sub_category_id,
                    sub_category_name=sub_cat_name,
                    brand_id=p.brand_id,
                    brand_name=br_name,
                    uom_id=p.uom_id,
                    uom_code=uom_code,
                    hsn_id=p.hsn_id,
                    hsn_number=hsn_num,
                    gst_percent=gst_pct,
                    import_duty_percent=import_duty,
                    current_stock=float(p.current_stock or 0.0),
                    images=images_list,
                    image_url=first_img,
                    status=p.status.value if hasattr(p.status, "value") else str(p.status),
                    standard_price=std_price,
                    minimum_price=min_price,
                    standard_cost=std_cost,
                    standard_price_gst_amount=std_price_gst,
                    minimum_price_gst_amount=min_price_gst,
                    standard_cost_gst_amount=std_cost_gst,
                    standard_price_inc_gst=std_price_inc,
                    minimum_price_inc_gst=min_price_inc,
                    standard_cost_inc_gst=std_cost_inc,
                    margin_amount=margin_amt,
                    margin_percent=margin_pct,
                    has_price=(std_price is not None and std_price > 0),
                    has_min_price=(min_price is not None and min_price > 0),
                    supplier_count=len(supp_quotes),
                    suppliers=supp_quotes,
                )
            )

        return items, total_count

    async def get_metrics(self) -> PriceListMetrics:
        """Calculate high-level commercial catalog metrics for KPI cards."""
        stmt = (
            select(
                func.count(Product.id).label("total_products"),
                func.count(Product.id).filter(Product.standard_price > 0).label("priced_products"),
                func.avg(Product.standard_price).filter(Product.standard_price > 0).label("avg_std_price"),
                func.avg(Product.minimum_price).filter(Product.minimum_price > 0).label("avg_min_price"),
                func.avg(Tax.gst_percent).label("avg_gst"),
            )
            .outerjoin(Tax, Tax.id == Product.hsn_id)
            .where(Product.deleted_at.is_(None))
        )
        res = await self.session.execute(stmt)
        row = res.one()

        total = row.total_products or 0
        priced = row.priced_products or 0
        unpriced = max(0, total - priced)
        avg_std_ex = float(row.avg_std_price) if row.avg_std_price is not None else 0.0
        avg_min_ex = float(row.avg_min_price) if row.avg_min_price is not None else 0.0
        avg_gst = float(row.avg_gst) if row.avg_gst is not None else 18.0

        avg_std_inc = round(avg_std_ex * (1.0 + (avg_gst / 100.0)), 2) if avg_std_ex else 0.0
        avg_min_inc = round(avg_min_ex * (1.0 + (avg_gst / 100.0)), 2) if avg_min_ex else 0.0

        return PriceListMetrics(
            total_products=total,
            priced_products=priced,
            unpriced_products=unpriced,
            avg_standard_price_ex_gst=round(avg_std_ex, 2),
            avg_standard_price_inc_gst=avg_std_inc,
            avg_min_price_ex_gst=round(avg_min_ex, 2),
            avg_min_price_inc_gst=avg_min_inc,
        )

    async def get_product_by_id(self, product_id: uuid.UUID) -> Product | None:
        """Fetch product with Tax relationship for calculation."""
        stmt = select(Product).where(Product.id == product_id, Product.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def get_product_by_code(self, code: str) -> Product | None:
        """Fetch product by code (case-insensitive) for bulk import."""
        clean_code = code.strip()
        stmt = select(Product).where(func.lower(Product.product_code) == clean_code.lower(), Product.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def update_product_price(
        self,
        product_id: uuid.UUID,
        *,
        standard_price: float | None = None,
        minimum_price: float | None = None,
        standard_cost: float | None = None,
        is_inclusive: bool = False,
    ) -> Product:
        """
        Update selling and minimum prices for a product.
        If is_inclusive is True, automatically converts from GST-inclusive rate to base rate
        using the product's linked GST percentage (or default 18.0%).
        """
        product = await self.get_product_by_id(product_id)
        if product is None:
            raise NotFoundException("Product not found")

        # Determine GST rate for this product
        gst_percent = 18.0
        if product.hsn_id:
            tax_res = await self.session.execute(select(Tax.gst_percent).where(Tax.id == product.hsn_id))
            tax_val = tax_res.scalar()
            if tax_val is not None:
                gst_percent = float(tax_val)

        gst_multiplier = 1.0 + (gst_percent / 100.0)

        if standard_price is not None:
            if is_inclusive:
                base_std = round(standard_price / gst_multiplier, 2)
            else:
                base_std = round(standard_price, 2)
            product.standard_price = base_std

        if minimum_price is not None:
            if is_inclusive:
                base_min = round(minimum_price / gst_multiplier, 2)
            else:
                base_min = round(minimum_price, 2)
            product.minimum_price = base_min

        if standard_cost is not None:
            if is_inclusive:
                base_cost = round(standard_cost / gst_multiplier, 2)
            else:
                base_cost = round(standard_cost, 2)
            product.standard_cost = base_cost

        return product

    async def get_product_suppliers(self, product_id: uuid.UUID) -> list[SupplierQuoteItem]:
        """Fetch all supplier quotations linked to a product."""
        supp_stmt = (
            select(
                SupplierProductLink,
                Supplier.company_name,
                Supplier.contact_calling_number,
            )
            .join(Supplier, Supplier.id == SupplierProductLink.supplier_id)
            .where(
                SupplierProductLink.product_id == product_id,
                Supplier.deleted_at.is_(None),
            )
            .order_by(SupplierProductLink.unit_price.asc().nulls_last())
        )
        supp_res = await self.session.execute(supp_stmt)
        rows = supp_res.all()

        return [
            SupplierQuoteItem(
                link_id=link.id,
                supplier_id=link.supplier_id,
                supplier_name=comp_name,
                calling_number=contact_num,
                unit_price=float(link.unit_price) if link.unit_price is not None else None,
                currency=link.currency or "INR",
                moq=float(link.moq) if link.moq is not None else None,
                notes=link.notes,
                updated_at=link.updated_at,
            )
            for link, comp_name, contact_num in rows
        ]

    async def assign_supplier_quote(
        self,
        product_id: uuid.UUID,
        payload: AssignSupplierQuotePayload,
    ) -> uuid.UUID:
        """Assign or update a supplier quotation for a product."""
        stmt = select(SupplierProductLink).where(
            SupplierProductLink.product_id == product_id,
            SupplierProductLink.supplier_id == payload.supplier_id,
        )
        res = await self.session.execute(stmt)
        link = res.scalar_one_or_none()

        if link is not None:
            link.unit_price = payload.unit_price
            link.currency = payload.currency
            link.moq = payload.moq
            link.notes = payload.notes
        else:
            link = SupplierProductLink(
                product_id=product_id,
                supplier_id=payload.supplier_id,
                unit_price=payload.unit_price,
                currency=payload.currency,
                moq=payload.moq,
                notes=payload.notes,
            )
            self.session.add(link)

        await self.session.flush()
        return link.id

    async def delete_supplier_quote(self, link_id: uuid.UUID) -> None:
        """Remove a supplier quotation link."""
        stmt = select(SupplierProductLink).where(SupplierProductLink.id == link_id)
        res = await self.session.execute(stmt)
        link = res.scalar_one_or_none()
        if link is None:
            raise NotFoundException("Supplier quote link not found")
        await self.session.delete(link)
        await self.session.flush()
