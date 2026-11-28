"""Tests for Product Trade & Price History feature."""

from __future__ import annotations

import uuid
import pytest
from app.database.engine import get_sessionmaker
from app.masters.product_prices.service import ProductPriceService
from app.masters.product_prices.schemas import (
    ProductTradeHistoryResponse,
    PurchaseHistoryRecord,
    SalesHistoryRecord,
    ProductTradeHistoryMetrics,
)


def test_trade_history_schema_serialization():
    """Verify that trade history schemas serialize and calculate as expected."""
    sample_id = uuid.uuid4()
    metrics = ProductTradeHistoryMetrics(
        latest_purchase_rate=14.0,
        latest_purchase_currency="USD",
        latest_purchase_landing_rate=15.0,
        latest_purchase_date="2026-03-10",
        latest_supplier_name="Zhejiang Machinery Co.",
        latest_purchase_type="invoice",
        latest_sales_rate=19.0,
        latest_sales_currency="USD",
        latest_sales_date="2026-03-12",
        latest_buyer_name="Inhyma Mumbai",
        estimated_margin_percent=26.32,
        estimated_profit_per_unit=5.0,
        profit_currency="USD",
        total_purchased_qty=100.0,
        total_sold_qty=100.0,
    )

    purchase = PurchaseHistoryRecord(
        record_type="invoice",
        doc_number="LP-INV-088",
        record_date="2026-03-10",
        supplier_name="Zhejiang Machinery Co.",
        quantity=100.0,
        unit_rate=14.0,
        unit_landing_rate=15.0,
        currency="USD",
        total_amount=1400.0,
        status="Confirmed",
    )

    sale = SalesHistoryRecord(
        record_type="order",
        doc_number="SO-2026-0035",
        consignment_code="MUM1",
        record_date="2026-03-12",
        buyer_name="Inhyma Mumbai",
        quantity=100.0,
        unit_rate=19.0,
        currency="USD",
        item_total=1900.0,
        status="sales_confirmed",
        margin_percent=26.3,
    )

    res = ProductTradeHistoryResponse(
        product_id=sample_id,
        product_code="GP-100",
        product_name="Stainless Steel Gear Pump",
        metrics=metrics,
        purchases=[purchase],
        sales=[sale],
    )

    data = res.model_dump()
    assert data["product_code"] == "GP-100"
    assert data["metrics"]["estimated_margin_percent"] == 26.32
    assert len(data["purchases"]) == 1
    assert data["purchases"][0]["record_type"] == "invoice"
    assert len(data["sales"]) == 1
    assert data["sales"][0]["margin_percent"] == 26.3


@pytest.mark.asyncio
async def test_get_trade_history_service_query():
    """Verify database query for trade history using isolated synthetic records."""
    from datetime import date
    from sqlalchemy import delete, select
    from app.buyers.models import Buyer
    from app.masters.company_list.models import MasterCompany
    from app.masters.countries.models import Country
    from app.masters.product_categories.models import ProductCategory
    from app.masters.products.models import Product
    from app.masters.uom.models import UnitOfMeasurement
    from app.purchases.local.models import LocalPurchase, LocalPurchaseItem
    from app.sales.models import SaleOrder, SaleOrderItem
    from app.suppliers.models import Supplier

    sm = get_sessionmaker()
    created_ids: dict[str, uuid.UUID] = {}
    async with sm() as s:
        try:
            cntry = (await s.execute(select(Country).limit(1))).scalars().first()
            if cntry is None:
                cntry = Country(name=f"China-{uuid.uuid4().hex[:4]}", code=f"C{uuid.uuid4().hex[:3].upper()}")
                s.add(cntry)
                await s.flush()

            comp = (await s.execute(select(MasterCompany).limit(1))).scalars().first()
            if comp is None:
                comp = MasterCompany(name=f"Yinglima Trade Co {uuid.uuid4().hex[:4]}", code=f"YT{uuid.uuid4().hex[:4].upper()}")
                s.add(comp)
                await s.flush()

            buyer = (await s.execute(select(Buyer).limit(1))).scalars().first()
            if buyer is None:
                buyer = Buyer(company_name=f"Trade Buyer {uuid.uuid4().hex[:4]}", country_id=cntry.id)
                s.add(buyer)
                await s.flush()

            supplier = (await s.execute(select(Supplier).limit(1))).scalars().first()
            if supplier is None:
                from app.masters.states.models import State
                from app.masters.cities.models import City
                st = (await s.execute(select(State).where(State.country_id == cntry.id).limit(1))).scalars().first()
                if st is None:
                    st = State(name=f"Zhejiang-{uuid.uuid4().hex[:4]}", code=f"Z{uuid.uuid4().hex[:3].upper()}", country_id=cntry.id)
                    s.add(st)
                    await s.flush()
                cty = (await s.execute(select(City).where(City.state_id == st.id).limit(1))).scalars().first()
                if cty is None:
                    cty = City(name=f"Wenzhou-{uuid.uuid4().hex[:4]}", state_id=st.id, country_id=cntry.id)
                    s.add(cty)
                    await s.flush()
                supplier = Supplier(
                    company_name=f"Trade Supplier {uuid.uuid4().hex[:4]}",
                    country_id=cntry.id,
                    state_id=st.id,
                    city_id=cty.id,
                )
                s.add(supplier)
                await s.flush()

            cat = (await s.execute(select(ProductCategory).limit(1))).scalars().first()
            if cat is None:
                cat = ProductCategory(name=f"Sealers-{uuid.uuid4().hex[:4]}", code=f"SL-{uuid.uuid4().hex[:4]}")
                s.add(cat)
                await s.flush()

            uom = (await s.execute(select(UnitOfMeasurement).limit(1))).scalars().first()
            if uom is None:
                uom = UnitOfMeasurement(name=f"Pieces-{uuid.uuid4().hex[:4]}", code=f"PC{uuid.uuid4().hex[:3].upper()}")
                s.add(uom)
                await s.flush()

            pid = uuid.uuid4()
            prod = Product(
                id=pid,
                product_code=f"FR900-{uuid.uuid4().hex[:6].upper()}",
                product_name="FR900 Band Sealer MSH",
                product_name_tally="FR900 Band Sealer MSH",
                category_id=cat.id,
                uom_id=uom.id,
                organization_id=comp.id,
                supplier_id=supplier.id,
            )
            s.add(prod)
            await s.flush()
            created_ids["product"] = pid

            lp = LocalPurchase(
                supplier_id=supplier.id,
                supplier_name=supplier.company_name,
                invoice_no=f"LP-TH-{uuid.uuid4().hex[:6].upper()}",
                invoice_date=date.today(),
                currency="RMB",
                invoice_total_value=1400.0,
                total_quantity=10.0,
                status="Confirmed",
            )
            s.add(lp)
            await s.flush()
            created_ids["lp"] = lp.id

            lp_item = LocalPurchaseItem(
                purchase_id=lp.id,
                product_id=pid,
                product_name=prod.product_name,
                product_code=prod.product_code,
                quantity=10.0,
                unit_rate=140.0,
                vat_rate=13.0,
                item_total=1400.0,
                expense_per_unit=0.0,
                unit_landing_rate=140.0,
                total_landing_rate=1400.0,
            )
            s.add(lp_item)

            so = SaleOrder(
                order_no=f"SO-TH-{uuid.uuid4().hex[:6].upper()}",
                organization_id=comp.id,
                organization_name=comp.name,
                buyer_id=buyer.id,
                buyer_name=buyer.company_name,
                order_date=date.today(),
                currency="USD",
                total_quantity=5.0,
                status="sales_confirmed",
            )
            s.add(so)
            await s.flush()
            created_ids["so"] = so.id

            so_item = SaleOrderItem(
                order_id=so.id,
                product_id=pid,
                product_name=prod.product_name,
                product_code=prod.product_code,
                quantity=5.0,
                unit_rate=30.0,
            )
            s.add(so_item)
            await s.commit()

            svc = ProductPriceService(s)
            res = await svc.get_trade_history(pid)

            assert res.product_id == pid
            assert "FR900" in res.product_name
            assert isinstance(res.sales, list)
            assert len(res.sales) == 1
            assert res.sales[0].record_type == "order"
            assert res.metrics.total_sold_qty == 5.0
            assert res.metrics.total_purchased_qty == 10.0
        finally:
            await s.rollback()
            async with sm() as clean:
                if "so" in created_ids:
                    await clean.execute(delete(SaleOrderItem).where(SaleOrderItem.order_id == created_ids["so"]))
                    await clean.execute(delete(SaleOrder).where(SaleOrder.id == created_ids["so"]))
                if "lp" in created_ids:
                    await clean.execute(delete(LocalPurchaseItem).where(LocalPurchaseItem.purchase_id == created_ids["lp"]))
                    await clean.execute(delete(LocalPurchase).where(LocalPurchase.id == created_ids["lp"]))
                if "product" in created_ids:
                    await clean.execute(delete(Product).where(Product.id == created_ids["product"]))
                await clean.commit()
