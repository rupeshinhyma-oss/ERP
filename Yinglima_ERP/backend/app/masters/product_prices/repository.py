"""Database repository for Product Prices Directory."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException
from app.masters.product_prices.schemas import (
    AssignSupplierPricePayload,
    ProductPriceItem,
    ProductPriceSupplierItem,
    UpdatePricePayload,
)
from app.suppliers.models import SupplierProductLink


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProductPriceRepository:
    """Repository handling database queries for product pricing."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_product_prices(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
        category_id: uuid.UUID | None = None,
        sub_category_id: uuid.UUID | None = None,
        brand_id: uuid.UUID | None = None,
        has_price: bool | None = None,
        sort_by: str = "product_name_tally",
        sort_dir: str = "asc",
    ) -> tuple[list[ProductPriceItem], int]:
        """
        List paginated products with their lowest supplier quoted price.
        Returns (items, total_count).
        """
        page = max(1, page)
        page_size = max(1, min(50000, page_size))
        offset = (page - 1) * page_size

        filter_clauses = ["p.deleted_at IS NULL"]
        params: dict[str, Any] = {"limit": page_size, "offset": offset}

        if category_id:
            filter_clauses.append("p.category_id = :category_id")
            params["category_id"] = str(category_id)

        if sub_category_id:
            filter_clauses.append("p.sub_category_id = :sub_category_id")
            params["sub_category_id"] = str(sub_category_id)

        if brand_id:
            filter_clauses.append("p.brand_id = :brand_id")
            params["brand_id"] = str(brand_id)

        if has_price is True:
            filter_clauses.append(
                "EXISTS (SELECT 1 FROM supplier_product_links spl WHERE spl.product_id = p.id AND spl.unit_price IS NOT NULL)"
            )
        elif has_price is False:
            filter_clauses.append(
                "NOT EXISTS (SELECT 1 FROM supplier_product_links spl WHERE spl.product_id = p.id AND spl.unit_price IS NOT NULL)"
            )

        if search and search.strip():
            term = f"%{search.strip()}%"
            filter_clauses.append(
                "("
                "p.product_code ILIKE :search_term OR "
                "p.product_name ILIKE :search_term OR "
                "p.product_name_tally ILIKE :search_term OR "
                "p.barcode ILIKE :search_term OR "
                "EXISTS (SELECT 1 FROM supplier_product_links spl "
                "JOIN suppliers s ON s.id = spl.supplier_id "
                "WHERE spl.product_id = p.id AND s.company_name ILIKE :search_term AND s.deleted_at IS NULL)"
                ")"
            )
            params["search_term"] = term

        where_sql = " AND ".join(filter_clauses)

        # 1. Count query
        count_sql = f"SELECT COUNT(*) FROM products p WHERE {where_sql}"
        count_res = await self.session.execute(text(count_sql), params)
        total_count = count_res.scalar() or 0

        if total_count == 0:
            return [], 0

        from app.common.currency import get_active_rates
        rates = await get_active_rates()
        cny_rate = float(rates.get("CNY", 7.14))
        eur_rate = float(rates.get("EUR", 0.92))
        inr_rate = float(rates.get("INR", 83.50))
        params["cny_rate"] = cny_rate
        params["eur_rate"] = eur_rate
        params["inr_rate"] = inr_rate

        norm_spl_price_sql = """
            (CASE 
                WHEN UPPER(COALESCE(spl.currency, 'USD')) IN ('CNY', 'RMB') THEN spl.unit_price / :cny_rate
                WHEN UPPER(COALESCE(spl.currency, 'USD')) = 'EUR' THEN spl.unit_price / :eur_rate
                WHEN UPPER(COALESCE(spl.currency, 'USD')) = 'INR' THEN spl.unit_price / :inr_rate
                ELSE spl.unit_price
             END)
        """
        norm_best_price_sql = """
            (CASE 
                WHEN UPPER(COALESCE(best.currency, 'USD')) IN ('CNY', 'RMB') THEN best.unit_price / :cny_rate
                WHEN UPPER(COALESCE(best.currency, 'USD')) = 'EUR' THEN best.unit_price / :eur_rate
                WHEN UPPER(COALESCE(best.currency, 'USD')) = 'INR' THEN best.unit_price / :inr_rate
                ELSE best.unit_price
             END)
        """

        # Determine order
        dir_clean = "DESC" if sort_dir.lower() == "desc" else "ASC"
        nulls_order = "NULLS LAST" if dir_clean == "ASC" else "NULLS FIRST"

        if sort_by == "best_price":
            order_sql = f"{norm_best_price_sql} {dir_clean} {nulls_order}, p.product_name_tally ASC"
            paginate_in_cte = False
        elif sort_by == "product_code":
            order_sql = f"p.product_code {dir_clean} {nulls_order}"
            paginate_in_cte = True
        elif sort_by == "created_at":
            order_sql = f"p.created_at {dir_clean}"
            paginate_in_cte = True
        else:
            order_sql = f"p.product_name_tally {dir_clean}"
            paginate_in_cte = True

        if paginate_in_cte:
            # Fast path: paginate products first, then join aggregates for those 50 rows
            data_sql = f"""
                WITH paged AS (
                    SELECT
                        p.id,
                        p.product_code,
                        p.product_name,
                        p.product_name_tally,
                        p.barcode,
                        p.category_id,
                        p.sub_category_id,
                        p.brand_id,
                        p.uom_id,
                        p.images,
                        p.supplier_id
                    FROM products p
                    WHERE {where_sql}
                    ORDER BY {order_sql}
                    LIMIT :limit OFFSET :offset
                )
                SELECT
                    p.id,
                    p.product_code,
                    p.product_name,
                    p.product_name_tally,
                    p.barcode,
                    p.category_id,
                    pc.name AS category_name,
                    p.sub_category_id,
                    psc.name AS sub_category_name,
                    p.brand_id,
                    b.name AS brand_name,
                    p.uom_id,
                    u.code AS uom_code,
                    p.images,
                    COALESCE(agg.supplier_count, 0) AS supplier_count,
                    best.id AS primary_link_id,
                    best.supplier_id AS primary_supplier_id,
                    best.company_name AS primary_supplier_name,
                    best.unit_price AS best_price,
                    best.currency AS best_currency,
                    COALESCE(best.is_preferred, false) AS is_preferred
                FROM paged p
                LEFT JOIN product_categories pc ON pc.id = p.category_id
                LEFT JOIN product_sub_categories psc ON psc.id = p.sub_category_id
                LEFT JOIN brands b ON b.id = p.brand_id
                LEFT JOIN units_of_measurement u ON u.id = p.uom_id
                LEFT JOIN (
                    SELECT
                        spl.product_id,
                        COUNT(spl.id) AS supplier_count
                    FROM supplier_product_links spl
                    JOIN suppliers s ON s.id = spl.supplier_id AND s.deleted_at IS NULL
                    WHERE spl.product_id IN (SELECT id FROM paged)
                    GROUP BY spl.product_id
                ) agg ON agg.product_id = p.id
                LEFT JOIN (
                    SELECT DISTINCT ON (spl.product_id)
                        spl.product_id,
                        spl.id,
                        spl.supplier_id,
                        s.company_name,
                        spl.unit_price,
                        spl.currency,
                        (CASE WHEN spl.supplier_id = p2.supplier_id THEN true ELSE false END) AS is_preferred
                    FROM supplier_product_links spl
                    JOIN paged p2 ON p2.id = spl.product_id
                    JOIN suppliers s ON s.id = spl.supplier_id AND s.deleted_at IS NULL
                    WHERE spl.unit_price IS NOT NULL
                    ORDER BY 
                        spl.product_id, 
                        (CASE WHEN spl.supplier_id = p2.supplier_id THEN 0 ELSE 1 END) ASC,
                        {norm_spl_price_sql} ASC, 
                        spl.updated_at DESC
                ) best ON best.product_id = p.id
                ORDER BY {order_sql};
            """
        else:
            # Sort by best_price across all filtered products
            data_sql = f"""
                SELECT
                    p.id,
                    p.product_code,
                    p.product_name,
                    p.product_name_tally,
                    p.barcode,
                    p.category_id,
                    pc.name AS category_name,
                    p.sub_category_id,
                    psc.name AS sub_category_name,
                    p.brand_id,
                    b.name AS brand_name,
                    p.uom_id,
                    u.code AS uom_code,
                    p.images,
                    COALESCE(agg.supplier_count, 0) AS supplier_count,
                    best.id AS primary_link_id,
                    best.supplier_id AS primary_supplier_id,
                    best.company_name AS primary_supplier_name,
                    best.unit_price AS best_price,
                    best.currency AS best_currency,
                    COALESCE(best.is_preferred, false) AS is_preferred
                FROM products p
                LEFT JOIN product_categories pc ON pc.id = p.category_id
                LEFT JOIN product_sub_categories psc ON psc.id = p.sub_category_id
                LEFT JOIN brands b ON b.id = p.brand_id
                LEFT JOIN units_of_measurement u ON u.id = p.uom_id
                LEFT JOIN (
                    SELECT
                        spl.product_id,
                        COUNT(spl.id) AS supplier_count
                    FROM supplier_product_links spl
                    JOIN suppliers s ON s.id = spl.supplier_id AND s.deleted_at IS NULL
                    GROUP BY spl.product_id
                ) agg ON agg.product_id = p.id
                LEFT JOIN (
                    SELECT DISTINCT ON (spl.product_id)
                        spl.product_id,
                        spl.id,
                        spl.supplier_id,
                        s.company_name,
                        spl.unit_price,
                        spl.currency,
                        (CASE WHEN spl.supplier_id = p2.supplier_id THEN true ELSE false END) AS is_preferred
                    FROM supplier_product_links spl
                    JOIN products p2 ON p2.id = spl.product_id
                    JOIN suppliers s ON s.id = spl.supplier_id AND s.deleted_at IS NULL
                    WHERE spl.unit_price IS NOT NULL
                    ORDER BY 
                        spl.product_id, 
                        (CASE WHEN spl.supplier_id = p2.supplier_id THEN 0 ELSE 1 END) ASC,
                        {norm_spl_price_sql} ASC, 
                        spl.updated_at DESC
                ) best ON best.product_id = p.id
                WHERE {where_sql}
                ORDER BY {order_sql}
                LIMIT :limit OFFSET :offset;
            """

        data_res = await self.session.execute(text(data_sql), params)
        rows = data_res.fetchall()

        items: list[ProductPriceItem] = []
        for r in rows:
            m = r._mapping
            items.append(
                ProductPriceItem(
                    product_id=m["id"],
                    product_code=m["product_code"],
                    product_name=m["product_name"],
                    product_name_tally=m["product_name_tally"],
                    barcode=m["barcode"],
                    category_id=m["category_id"],
                    category_name=m["category_name"],
                    sub_category_id=m["sub_category_id"],
                    sub_category_name=m["sub_category_name"],
                    brand_id=m["brand_id"],
                    brand_name=m["brand_name"],
                    uom_id=m["uom_id"],
                    uom_code=m["uom_code"],
                    images=m["images"] if isinstance(m["images"], list) else None,
                    best_price=float(m["best_price"]) if m["best_price"] is not None else None,
                    best_currency=m["best_currency"],
                    primary_supplier_id=m["primary_supplier_id"],
                    primary_supplier_name=m["primary_supplier_name"],
                    primary_link_id=m["primary_link_id"],
                    supplier_count=int(m["supplier_count"] or 0),
                    has_price=m["best_price"] is not None,
                    is_preferred=bool(m.get("is_preferred", False)),
                )
            )

        return items, total_count

    async def get_product_suppliers(self, product_id: uuid.UUID) -> list[ProductPriceSupplierItem]:
        """Fetch all suppliers linked to a product with their quote details."""
        from app.common.currency import get_active_rates
        rates = await get_active_rates()
        cny_rate = float(rates.get("CNY", 7.14))
        eur_rate = float(rates.get("EUR", 0.92))
        inr_rate = float(rates.get("INR", 83.50))

        query = text("""
            SELECT
                spl.id AS link_id,
                spl.product_id,
                spl.supplier_id,
                s.company_name AS supplier_name,
                NULL AS supplier_code,
                s.contact_calling_number,
                s.contact_whatsapp_number,
                s.contact_wechat_number,
                c.name AS city_name,
                st.name AS state_name,
                co.name AS country_name,
                spl.unit_price,
                spl.currency,
                spl.moq,
                spl.notes,
                spl.updated_at,
                spl.created_at,
                (CASE WHEN spl.supplier_id = p.supplier_id THEN true ELSE false END) AS is_preferred
            FROM supplier_product_links spl
            JOIN products p ON p.id = spl.product_id
            JOIN suppliers s ON s.id = spl.supplier_id AND s.deleted_at IS NULL
            LEFT JOIN cities c ON c.id = s.city_id
            LEFT JOIN states st ON st.id = s.state_id
            LEFT JOIN countries co ON co.id = s.country_id
            WHERE spl.product_id = :product_id
            ORDER BY 
                (CASE WHEN spl.supplier_id = p.supplier_id THEN 0 ELSE 1 END) ASC,
                (CASE 
                    WHEN UPPER(COALESCE(spl.currency, 'USD')) IN ('CNY', 'RMB') THEN spl.unit_price / :cny_rate
                    WHEN UPPER(COALESCE(spl.currency, 'USD')) = 'EUR' THEN spl.unit_price / :eur_rate
                    WHEN UPPER(COALESCE(spl.currency, 'USD')) = 'INR' THEN spl.unit_price / :inr_rate
                    ELSE spl.unit_price
                  END) ASC NULLS LAST, spl.updated_at DESC;
        """)

        res = await self.session.execute(query, {"product_id": str(product_id), "cny_rate": cny_rate, "eur_rate": eur_rate, "inr_rate": inr_rate})
        rows = res.fetchall()

        items: list[ProductPriceSupplierItem] = []
        for r in rows:
            m = r._mapping
            items.append(
                ProductPriceSupplierItem(
                    link_id=m["link_id"],
                    product_id=m["product_id"],
                    supplier_id=m["supplier_id"],
                    supplier_name=m["supplier_name"],
                    supplier_code=m["supplier_code"],
                    contact_calling_number=m["contact_calling_number"],
                    contact_whatsapp_number=m["contact_whatsapp_number"],
                    contact_wechat_number=m["contact_wechat_number"],
                    city_name=m["city_name"],
                    state_name=m["state_name"],
                    country_name=m["country_name"],
                    unit_price=float(m["unit_price"]) if m["unit_price"] is not None else None,
                    currency=m["currency"] or "CNY",
                    moq=float(m["moq"]) if m["moq"] is not None else None,
                    notes=m["notes"],
                    updated_at=m["updated_at"],
                    created_at=m["created_at"],
                    is_preferred=bool(m.get("is_preferred", False)),
                )
            )
        return items

    async def assign_supplier_price(self, payload: AssignSupplierPricePayload) -> uuid.UUID:
        """
        Insert or update a supplier-product quote link.
        Uses PostgreSQL ON CONFLICT (supplier_id, product_id) DO UPDATE.
        Returns the link_id.
        """
        now = _utcnow()
        query = text("""
            INSERT INTO supplier_product_links (
                id, supplier_id, product_id, unit_price, currency, moq, notes, created_at, updated_at
            )
            VALUES (
                :id, :supplier_id, :product_id, :unit_price, :currency, :moq, :notes, :created_at, :updated_at
            )
            ON CONFLICT (supplier_id, product_id)
            DO UPDATE SET
                unit_price = EXCLUDED.unit_price,
                currency = EXCLUDED.currency,
                moq = EXCLUDED.moq,
                notes = COALESCE(EXCLUDED.notes, supplier_product_links.notes),
                updated_at = EXCLUDED.updated_at
            RETURNING id;
        """)

        res = await self.session.execute(
            query,
            {
                "id": str(uuid.uuid4()),
                "supplier_id": str(payload.supplier_id),
                "product_id": str(payload.product_id),
                "unit_price": payload.unit_price,
                "currency": (payload.currency or "CNY").upper(),
                "moq": payload.moq,
                "notes": payload.notes,
                "created_at": now,
                "updated_at": now,
            },
        )
        row = res.fetchone()
        if not row:
            raise NotFoundException("Failed to assign supplier price link")

        if payload.is_preferred:
            await self.set_preferred_supplier(payload.product_id, payload.supplier_id)

        return row[0]

    async def set_preferred_supplier(self, product_id: uuid.UUID, supplier_id: uuid.UUID | None) -> None:
        """Set or clear the preferred supplier for a product."""
        query = text("""
            UPDATE products
            SET supplier_id = :supplier_id,
                updated_at = :updated_at
            WHERE id = :product_id AND deleted_at IS NULL
            RETURNING id;
        """)
        res = await self.session.execute(
            query,
            {
                "product_id": str(product_id),
                "supplier_id": str(supplier_id) if supplier_id else None,
                "updated_at": _utcnow(),
            },
        )
        if not res.fetchone():
            raise NotFoundException("Product not found")

    async def update_supplier_price(self, link_id: uuid.UUID, payload: UpdatePricePayload) -> None:
        """Inline update of a supplier link's unit price, currency, moq, or notes."""
        updates: list[str] = ["updated_at = :updated_at"]
        params: dict[str, Any] = {"link_id": str(link_id), "updated_at": _utcnow()}

        if payload.unit_price is not None:
            updates.append("unit_price = :unit_price")
            params["unit_price"] = payload.unit_price

        if payload.currency is not None:
            updates.append("currency = :currency")
            params["currency"] = payload.currency.upper()

        if payload.moq is not None:
            updates.append("moq = :moq")
            params["moq"] = payload.moq

        if payload.notes is not None:
            updates.append("notes = :notes")
            params["notes"] = payload.notes

        query = text(f"""
            UPDATE supplier_product_links
            SET {", ".join(updates)}
            WHERE id = :link_id
            RETURNING id;
        """)
        res = await self.session.execute(query, params)
        if not res.fetchone():
            raise NotFoundException("Supplier price link not found")

    async def delete_supplier_price(self, link_id: uuid.UUID) -> None:
        """Remove a supplier price link."""
        query = text("DELETE FROM supplier_product_links WHERE id = :link_id RETURNING id;")
        res = await self.session.execute(query, {"link_id": str(link_id)})
        if not res.fetchone():
            raise NotFoundException("Supplier price link not found")

    async def get_link_by_id(self, link_id: uuid.UUID) -> dict[str, Any] | None:
        """Fetch link by id."""
        query = text("""
            SELECT id, supplier_id, product_id, unit_price, currency, moq, notes, updated_at
            FROM supplier_product_links
            WHERE id = :link_id;
        """)
        res = await self.session.execute(query, {"link_id": str(link_id)})
        row = res.fetchone()
        return dict(row._mapping) if row else None

    async def list_suppliers_lookup(self) -> list[dict[str, Any]]:
        """Fast, lightweight lookup of suppliers for price assignment dropdowns."""
        sql = text("""
            SELECT id, company_name, supplier_type
            FROM suppliers
            WHERE is_active = true
            ORDER BY company_name ASC
        """)
        res = await self.session.execute(sql)
        return [
            {"id": str(r[0]), "company_name": r[1], "supplier_type": r[2]}
            for r in res.fetchall()
        ]

    async def get_product_trade_history(self, product_id: uuid.UUID) -> dict[str, Any]:
        """
        Fetch full 360-degree trade history:
        1. Product details & UOM
        2. Purchase history (Invoices, Quotations, Catalog quotes)
        3. Sales history (Sales Orders, Buyer inquiries)
        4. Metrics (latest buy vs latest sell rate, profit margin, volume totals)
        """
        from app.common.currency import get_active_rates

        rates = await get_active_rates()

        def to_usd(amount: float | None, curr: str | None) -> float | None:
            if amount is None:
                return None
            c = (curr or "USD").upper().strip()
            rate = float(rates.get(c, 1.0))
            return amount / rate if rate > 0 else amount

        # 1. Product metadata
        prod_query = text("""
            SELECT p.id, p.product_code, p.product_name, p.product_name_tally, u.code AS uom_code
            FROM products p
            LEFT JOIN units_of_measurement u ON u.id = p.uom_id
            WHERE p.id = :product_id AND p.deleted_at IS NULL;
        """)
        prod_res = await self.session.execute(prod_query, {"product_id": str(product_id)})
        prod_row = prod_res.fetchone()
        if not prod_row:
            raise NotFoundException("Product not found")

        prod_m = prod_row._mapping

        # 2. Purchase history
        # 2a. Vendor Invoices (local_purchases)
        lp_query = text("""
            SELECT
                'invoice' AS record_type,
                CAST(lpi.id AS text) AS item_id,
                CAST(lp.id AS text) AS doc_id,
                lp.invoice_no AS doc_number,
                CAST(lp.invoice_date AS text) AS record_date,
                CAST(lp.supplier_id AS text) AS supplier_id,
                lp.supplier_name,
                CAST(lpi.quantity AS float) AS quantity,
                CAST(lpi.unit_rate AS float) AS unit_rate,
                CAST(lpi.unit_landing_rate AS float) AS unit_landing_rate,
                lp.currency,
                CAST(lpi.item_total AS float) AS total_amount,
                lp.status,
                lp.remarks
            FROM local_purchase_items lpi
            JOIN local_purchases lp ON lp.id = lpi.purchase_id
            WHERE lpi.product_id = :product_id AND lp.deleted_at IS NULL
            ORDER BY lp.invoice_date DESC, lpi.created_at DESC;
        """)
        lp_res = await self.session.execute(lp_query, {"product_id": str(product_id)})
        invoices = [dict(r._mapping) for r in lp_res.fetchall()]

        # 2b. Supplier Quotations
        quote_query = text("""
            SELECT
                'quote' AS record_type,
                CAST(q.id AS text) AS item_id,
                CAST(q.id AS text) AS doc_id,
                q.quote_number AS doc_number,
                CAST(CAST(q.created_at AS date) AS text) AS record_date,
                CAST(q.supplier_id AS text) AS supplier_id,
                s.company_name AS supplier_name,
                CAST(q.quantity AS float) AS quantity,
                CAST(q.unit_price AS float) AS unit_rate,
                NULL AS unit_landing_rate,
                q.currency,
                CAST(q.total_cost AS float) AS total_amount,
                CAST(q.status AS text) AS status,
                q.remarks
            FROM quotations q
            JOIN inquiry_items ii ON ii.id = q.inquiry_item_id AND ii.deleted_at IS NULL
            JOIN suppliers s ON s.id = q.supplier_id AND s.deleted_at IS NULL
            WHERE ii.product_id = :product_id AND q.deleted_at IS NULL
            ORDER BY q.created_at DESC;
        """)
        quote_res = await self.session.execute(quote_query, {"product_id": str(product_id)})
        quotes = [dict(r._mapping) for r in quote_res.fetchall()]

        # 2c. Active Catalog Quotes (supplier_product_links)
        catalog_query = text("""
            SELECT
                'catalog' AS record_type,
                CAST(spl.id AS text) AS item_id,
                CAST(spl.id AS text) AS doc_id,
                'CATALOG-QUOTE' AS doc_number,
                CAST(CAST(spl.updated_at AS date) AS text) AS record_date,
                CAST(spl.supplier_id AS text) AS supplier_id,
                s.company_name AS supplier_name,
                CAST(spl.moq AS float) AS quantity,
                CAST(spl.unit_price AS float) AS unit_rate,
                NULL AS unit_landing_rate,
                spl.currency,
                NULL AS total_amount,
                'active' AS status,
                spl.notes AS remarks
            FROM supplier_product_links spl
            JOIN suppliers s ON s.id = spl.supplier_id AND s.deleted_at IS NULL
            WHERE spl.product_id = :product_id AND spl.unit_price IS NOT NULL
            ORDER BY spl.updated_at DESC;
        """)
        cat_res = await self.session.execute(catalog_query, {"product_id": str(product_id)})
        catalogs = [dict(r._mapping) for r in cat_res.fetchall()]

        purchases = invoices + quotes + catalogs

        # 3. Sales history
        # 3a. Commercial Sales Orders
        so_query = text("""
            SELECT
                'order' AS record_type,
                CAST(soi.id AS text) AS item_id,
                CAST(so.id AS text) AS doc_id,
                so.order_no AS doc_number,
                so.consignment_code,
                CAST(so.order_date AS text) AS record_date,
                CAST(so.buyer_id AS text) AS buyer_id,
                so.buyer_name,
                CAST(soi.quantity AS float) AS quantity,
                CAST(soi.unit_rate AS float) AS unit_rate,
                so.currency,
                CAST(soi.item_total AS float) AS item_total,
                so.status,
                soi.remarks
            FROM sales_order_items soi
            JOIN sales_orders so ON so.id = soi.order_id
            WHERE soi.product_id = :product_id AND so.deleted_at IS NULL
            ORDER BY so.order_date DESC, soi.created_at DESC;
        """)
        so_res = await self.session.execute(so_query, {"product_id": str(product_id)})
        sales_orders = [dict(r._mapping) for r in so_res.fetchall()]

        # 3b. Buyer Inquiries
        inq_query = text("""
            SELECT
                'inquiry' AS record_type,
                CAST(ii.id AS text) AS item_id,
                CAST(i.id AS text) AS doc_id,
                COALESCE(cc.code, 'INQUIRY') AS doc_number,
                cc.code AS consignment_code,
                CAST(CAST(ii.proposed_at AS date) AS text) AS record_date,
                CAST(i.buyer_id AS text) AS buyer_id,
                b.company_name AS buyer_name,
                CAST(ii.quantity AS float) AS quantity,
                0.0 AS unit_rate,
                'CNY' AS currency,
                0.0 AS item_total,
                CAST(ii.status AS text) AS status,
                ii.product_specs_remarks AS remarks
            FROM inquiry_items ii
            JOIN inquiries i ON i.id = ii.inquiry_id AND i.deleted_at IS NULL
            LEFT JOIN consignment_codes cc ON cc.id = i.consignment_code_id AND cc.deleted_at IS NULL
            JOIN buyers b ON b.id = i.buyer_id AND b.deleted_at IS NULL
            WHERE ii.product_id = :product_id AND ii.deleted_at IS NULL
            ORDER BY ii.proposed_at DESC;
        """)
        inq_res = await self.session.execute(inq_query, {"product_id": str(product_id)})
        inquiries = [dict(r._mapping) for r in inq_res.fetchall()]

        sales = sales_orders + inquiries

        # 4. Metrics & KPI computation
        # Latest purchase: prioritize confirmed invoice, fallback to quotation or catalog quote
        latest_purchase = None
        for p in purchases:
            if p.get("unit_rate") and float(p["unit_rate"]) > 0:
                latest_purchase = p
                break

        latest_sale = None
        for s in sales_orders:
            if s.get("unit_rate") and float(s["unit_rate"]) > 0:
                latest_sale = s
                break

        latest_purchase_usd = None
        if latest_purchase:
            rate_val = float(latest_purchase.get("unit_landing_rate") or latest_purchase["unit_rate"])
            latest_purchase_usd = to_usd(rate_val, latest_purchase.get("currency"))

        latest_sales_usd = None
        if latest_sale:
            latest_sales_usd = to_usd(float(latest_sale["unit_rate"]), latest_sale.get("currency"))

        estimated_margin_pct = None
        profit_per_unit = None
        profit_curr = None

        if latest_purchase and latest_sale and latest_purchase_usd and latest_sales_usd and latest_sales_usd > 0:
            estimated_margin_pct = round(((latest_sales_usd - latest_purchase_usd) / latest_sales_usd) * 100, 2)
            if latest_purchase.get("currency") == latest_sale.get("currency"):
                profit_per_unit = round(float(latest_sale["unit_rate"]) - float(latest_purchase["unit_rate"]), 2)
                profit_curr = latest_sale.get("currency")
            else:
                profit_per_unit = round(latest_sales_usd - latest_purchase_usd, 2)
                profit_curr = "USD"

        # Attach margin_percent to individual sales order items
        for s in sales:
            if s.get("record_type") == "order" and s.get("unit_rate") and float(s["unit_rate"]) > 0 and latest_purchase_usd:
                s_usd = to_usd(float(s["unit_rate"]), s.get("currency"))
                if s_usd and s_usd > 0:
                    s["margin_percent"] = round(((s_usd - latest_purchase_usd) / s_usd) * 100, 1)

        total_purchased_qty = sum(float(inv.get("quantity") or 0) for inv in invoices)
        total_sold_qty = sum(float(so.get("quantity") or 0) for so in sales_orders)

        metrics = {
            "latest_purchase_rate": float(latest_purchase["unit_rate"]) if latest_purchase else None,
            "latest_purchase_currency": latest_purchase.get("currency") if latest_purchase else None,
            "latest_purchase_landing_rate": float(latest_purchase["unit_landing_rate"]) if latest_purchase and latest_purchase.get("unit_landing_rate") else None,
            "latest_purchase_date": latest_purchase.get("record_date") if latest_purchase else None,
            "latest_supplier_name": latest_purchase.get("supplier_name") if latest_purchase else None,
            "latest_purchase_type": latest_purchase.get("record_type") if latest_purchase else None,

            "latest_sales_rate": float(latest_sale["unit_rate"]) if latest_sale else None,
            "latest_sales_currency": latest_sale.get("currency") if latest_sale else None,
            "latest_sales_date": latest_sale.get("record_date") if latest_sale else None,
            "latest_buyer_name": latest_sale.get("buyer_name") if latest_sale else None,

            "estimated_margin_percent": estimated_margin_pct,
            "estimated_profit_per_unit": profit_per_unit,
            "profit_currency": profit_curr,

            "total_purchased_qty": total_purchased_qty,
            "total_sold_qty": total_sold_qty,
        }

        return {
            "product_id": prod_m["id"],
            "product_code": prod_m["product_code"],
            "product_name": prod_m["product_name"],
            "product_name_tally": prod_m["product_name_tally"],
            "uom_code": prod_m["uom_code"],
            "metrics": metrics,
            "purchases": purchases,
            "sales": sales,
        }


