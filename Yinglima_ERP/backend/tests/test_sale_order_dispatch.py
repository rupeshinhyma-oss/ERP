import pytest
import uuid
from datetime import date
from sqlalchemy import select

from app.database.engine import get_sessionmaker
from app.purchases.local.models import LocalPurchase
from app.purchases.local.schemas import LocalPurchaseCreate, LocalPurchaseItemCreate, LocalPurchaseInwardRequest
from app.purchases.local.service import LocalPurchaseService
from app.sales.models import SaleOrder
from app.sales.schemas import SaleOrderCreate, SaleOrderItemCreate, SaleOrderDispatchRequest
from app.sales.service import SaleService
from app.stock.service import StockMovementService
from app.stock.repository import StockMovementRepository
from app.suppliers.models import Supplier
from app.buyers.models import Buyer
from app.masters.company_list.models import MasterCompany
from app.core.exceptions import BadRequestException


@pytest.mark.asyncio
async def test_sale_order_outward_dispatch_lifecycle():
    """
    Test end-to-end stock reduction on sale order dispatch:
    1. Verify insufficient stock blocks outward dispatch with BadRequestException.
    2. Inward stock from a Local Purchase.
    3. Dispatch Sale Order & verify StockMovement (outward) is created and linked.
    4. Verify live warehouse stock is decreased.
    5. Verify duplicate dispatch is blocked.
    """
    sm = get_sessionmaker()
    async with sm() as session:
        sales_service = SaleService(session)
        lp_service = LocalPurchaseService(session)
        stock_repo = StockMovementRepository(session)

        # 1. Ensure master company exists
        q_co = await session.execute(select(MasterCompany).limit(1))
        company = q_co.scalars().first()
        if not company:
            company = MasterCompany(name="Yinglima China Co", code=f"YLM-{uuid.uuid4().hex[:4].upper()}")
            session.add(company)
            await session.flush()

        # 2. Ensure buyer exists
        q_b = await session.execute(select(Buyer).limit(1))
        buyer = q_b.scalars().first()
        if not buyer:
            buyer = Buyer(company_name=f"Test Buyer {uuid.uuid4().hex[:4]}", country="India")
            session.add(buyer)
            await session.flush()

        # 3. Ensure supplier exists
        q_s = await session.execute(select(Supplier).limit(1))
        supplier = q_s.scalars().first()
        if not supplier:
            supplier = Supplier(company_name=f"Test Factory {uuid.uuid4().hex[:4]}", country="China")
            session.add(supplier)
            await session.flush()

        # Unique product for isolated testing
        prod_name = f"Dispatch Widget {uuid.uuid4().hex[:6]}"
        prod_code = f"SKU-{uuid.uuid4().hex[:6].upper()}"

        # Create a Sale Order for 10 pcs
        so_payload = SaleOrderCreate(
            organization_id=company.id,
            organization_name=company.name,
            buyer_id=buyer.id,
            buyer_name=buyer.company_name,
            order_date=date.today(),
            currency="RMB",
            status="admin_approved",
            items=[
                SaleOrderItemCreate(
                    product_name=prod_name,
                    product_code=prod_code,
                    quantity=10.0,
                    unit_rate=50.0,
                    tax_percent=0.0,
                )
            ],
        )
        sale_order = await sales_service.create_order(so_payload)
        assert sale_order.id is not None
        assert sale_order.status == "admin_approved"
        assert sale_order.stock_movement_id is None

        # Step A: Attempt to dispatch when available stock is 0 -> MUST RAISE BadRequestException
        with pytest.raises(BadRequestException) as exc_info:
            await sales_service.dispatch_order(sale_order.id)
        assert "Insufficient stock in warehouse" in str(exc_info.value)
        assert "Available: 0, Requested: 10" in str(exc_info.value)

        # Step B: Now inward 25 pcs via Local Purchase
        lp_payload = LocalPurchaseCreate(
            supplier_id=supplier.id,
            supplier_name=supplier.company_name,
            invoice_no=f"INV-DISP-{uuid.uuid4().hex[:6].upper()}",
            invoice_date=date.today(),
            currency="RMB",
            invoice_total_value=565.0,
            status="Confirmed",
            items=[
                LocalPurchaseItemCreate(
                    product_name=prod_name,
                    product_code=prod_code,
                    quantity=25.0,
                    unit_rate=20.0,
                    vat_rate=13.0,
                )
            ],
        )
        lp = await lp_service.create_purchase(lp_payload)
        inward_req = LocalPurchaseInwardRequest(
            movement_date=date.today(),
            warehouse_location="Main Godown",
            remarks="Initial receipt for dispatch test",
        )
        inwarded_lp = await lp_service.inward_purchase(lp.id, inward_req)
        assert inwarded_lp.status == "Inwarded"
        assert inwarded_lp.stock_movement_number is not None

        # Verify warehouse stock balance is now 25
        stock_bal = await stock_repo.get_current_stock(product_name=prod_name, product_code=prod_code)
        assert stock_bal == 25.0

        # Step C: Dispatch Sale Order (10 pcs)
        dispatch_req = SaleOrderDispatchRequest(
            movement_date=date.today(),
            warehouse_location="Main Godown",
            transporter_name="FastFreight Logistics",
            vehicle_no="MH-04-AB-1234",
            remarks="Dispatched via Air cargo",
        )
        dispatched_order = await sales_service.dispatch_order(sale_order.id, dispatch_req)

        assert dispatched_order.status == "dispatched"
        assert dispatched_order.stock_movement_id is not None
        assert dispatched_order.stock_movement_number.startswith("OUT-")

        # Step D: Verify warehouse stock is now 25 - 10 = 15
        new_stock_bal = await stock_repo.get_current_stock(product_name=prod_name, product_code=prod_code)
        assert new_stock_bal == 15.0

        # Step E: Verify duplicate dispatch is blocked
        with pytest.raises(BadRequestException) as exc_dup:
            await sales_service.dispatch_order(sale_order.id)
        assert "has already been dispatched" in str(exc_dup.value)
