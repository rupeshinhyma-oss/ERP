import pytest
import uuid
from datetime import date
from sqlalchemy import select
from app.database.engine import get_sessionmaker
from app.masters.company_list.models import MasterCompany
from app.masters.hsn.models import HsnCode
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.purchases.local.models import LocalPurchase, LocalPurchaseItem
from app.suppliers.models import Supplier
from app.sales.service import SaleService


@pytest.mark.asyncio
async def test_get_product_costing_info_from_local_purchase():
    sm = get_sessionmaker()
    async with sm() as session:
        # 1. Fetch or create company
        comp = (await session.execute(select(MasterCompany))).scalars().first()
        if not comp:
            comp = MasterCompany(name="Yinglima Co", code="YL")
            session.add(comp)
            await session.flush()

        sup = (await session.execute(select(Supplier))).scalars().first()
        if not sup:
            sup = Supplier(company_name="Dinghe Machinery Co.", organization_id=comp.id)
            session.add(sup)
            await session.flush()

        hsn = HsnCode(
            code=f"8422.{uuid.uuid4().hex[:4]}",
            description="Sealing machines",
            gst_percent=18.0,
            refund_vat_percent=13.0,
        )
        session.add(hsn)

        uom = (await session.execute(select(UnitOfMeasurement))).scalars().first()
        if not uom:
            uom = UnitOfMeasurement(name="Pieces", code="PCS")
            session.add(uom)
            await session.flush()

        from app.masters.product_categories.models import ProductCategory
        cat = (await session.execute(select(ProductCategory))).scalars().first()
        if not cat:
            cat = ProductCategory(category_name="Packaging", category_code=f"CAT-{uuid.uuid4().hex[:4]}")
            session.add(cat)
            await session.flush()

        prod = Product(
            product_name="FR900 Continuous Band Sealer",
            product_name_tally="FR900 Continuous Band Sealer",
            product_code=f"PROD-{uuid.uuid4().hex[:4]}",
            organization_id=comp.id,
            category_id=cat.id,
            uom_id=uom.id,
            hsn_id=hsn.id,
            refund_vat_percent=13.0,
            length=85.0,
            width=42.0,
            height=36.0,
            packaging_quantity=1.0,
            packaging_unit_cbm=0.12852,
        )
        session.add(prod)
        await session.flush()

        # 2. Create Confirmed Local Purchase for this product
        lp = LocalPurchase(
            supplier_id=sup.id,
            supplier_name=sup.company_name,
            invoice_no=f"INV-DH-{uuid.uuid4().hex[:4]}",
            invoice_date=date.today(),
            currency="RMB",
            invoice_total_value=710.0,
            items_total_basic=628.32,
            items_total_vat=81.68,
            items_total_landing=710.0,
            total_quantity=1.0,
            status="Confirmed",
        )
        session.add(lp)
        await session.flush()

        lp_item = LocalPurchaseItem(
            purchase_id=lp.id,
            product_id=prod.id,
            product_name=prod.product_name,
            product_code=prod.product_code,
            quantity=1.0,
            unit_rate=710.0,
            vat_rate=13.0,
            item_total=710.0,
            vat_amount=81.68,
            expense_per_unit=0.0,
            unit_landing_rate=710.0,
            total_landing_rate=710.0,
        )
        session.add(lp_item)
        await session.commit()

        # 3. Test get_product_costing_info via SaleService
        service = SaleService(session)
        data = await service.get_product_costing_info(prod.id, quantity=50.0)

        # Verify Supplier came from Local Purchase
        assert data["supplier_id"] == str(sup.id)
        assert data["supplier_name"] == lp.supplier_name

        # Verify RMB unit rate with VAT: LP Unit Rate (710) is BASIC, so incl. VAT = 710 x 1.13 = 802.30
        assert data["unit_price_rmb_with_vat"] == 802.30

        # Verify Excluding VAT equals the LP basic Unit Rate exactly (802.30 / 1.13 = 710.00)
        assert data["unit_price_rmb_ex_vat"] == 710.0
        assert data["refund_vat_percent"] == 13.0

        # Verify profit calculation (710.00 * 1.03 = 731.30)
        assert data["price_with_profit_rmb"] == 731.30

        # Verify FOB Price USD (731.30 / 6.7 = 109.1493)
        assert 109.10 < data["fob_price_usd"] < 109.20

        # Verify CBM for 50 pieces (50 * 0.12852 = 6.426)
        assert data["total_cbm"] > 6.0

        # Verify Total Supplier Amount (incl. VAT 802.30 * 50 = 40,115)
        assert data["total_supplier_amount_rmb"] == 40115.0


@pytest.mark.asyncio
async def test_get_product_costing_info_from_supplier_quote_fallback():
    sm = get_sessionmaker()
    async with sm() as session:
        from app.masters.product_categories.models import ProductCategory
        from app.suppliers.models import SupplierProductLink

        comp = (await session.execute(select(MasterCompany))).scalars().first()
        if not comp:
            comp = MasterCompany(name="Yinglima Co", code="YL")
            session.add(comp)
            await session.flush()

        sup = (await session.execute(select(Supplier))).scalars().first()
        if not sup:
            from app.masters.countries.models import Country
            from app.masters.states.models import State
            from app.masters.cities.models import City
            cntry = (await session.execute(select(Country))).scalars().first()
            if not cntry:
                cntry = Country(name="China", code="CN")
                session.add(cntry)
                await session.flush()
            st = (await session.execute(select(State))).scalars().first()
            if not st:
                st = State(name="Zhejiang", code="ZJ", country_id=cntry.id)
                session.add(st)
                await session.flush()
            cty = (await session.execute(select(City))).scalars().first()
            if not cty:
                cty = City(name="Wenzhou", state_id=st.id)
                session.add(cty)
                await session.flush()
            sup = Supplier(
                company_name=f"Quote Supplier {uuid.uuid4().hex[:4]}",
                organization_id=comp.id,
                country_id=cntry.id,
                state_id=st.id,
                city_id=cty.id,
            )
            session.add(sup)
            await session.flush()

        cat = (await session.execute(select(ProductCategory))).scalars().first()
        if not cat:
            cat = ProductCategory(category_name="Packaging", category_code=f"CAT-{uuid.uuid4().hex[:4]}")
            session.add(cat)
            await session.flush()

        uom = (await session.execute(select(UnitOfMeasurement))).scalars().first()
        if not uom:
            uom = UnitOfMeasurement(name="Pieces", code="PCS")
            session.add(uom)
            await session.flush()

        prod_no_lp = Product(
            product_name="Custom Machine No LP",
            product_name_tally="Custom Machine No LP",
            product_code=f"NOLP-{uuid.uuid4().hex[:4]}",
            organization_id=comp.id,
            category_id=cat.id,
            uom_id=uom.id,
            refund_vat_percent=13.0,
            packaging_quantity=1.0,
            packaging_unit_cbm=0.5,
        )
        session.add(prod_no_lp)
        await session.flush()

        # Link supplier quote directly
        link = SupplierProductLink(
            supplier_id=sup.id,
            product_id=prod_no_lp.id,
            unit_price=450.0,
            currency="CNY",
        )
        session.add(link)
        await session.commit()

        # Test costing info falls back gracefully to supplier quote without deleted_at error
        service = SaleService(session)
        cost_info = await service.get_product_costing_info(prod_no_lp.id, quantity=10.0)

        assert cost_info["supplier_id"] == str(sup.id)
        assert cost_info["supplier_name"] == sup.company_name
        assert cost_info["unit_price_rmb_with_vat"] == 450.0
        assert cost_info["unit_price_rmb_ex_vat"] == round(450.0 / 1.13, 2)
        assert cost_info["total_supplier_amount_rmb"] == 4500.0
