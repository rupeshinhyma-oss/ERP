import pytest
import uuid
from datetime import date
from sqlalchemy import select, text

from app.database.engine import get_sessionmaker
from app.masters.company_list.models import MasterCompany
from app.suppliers.models import Supplier
from app.buyers.models import Buyer
from app.purchases.local.models import LocalPurchase, LocalPurchaseItem
from app.sales.models import SaleOrder, SaleOrderItem
from app.stock.service import StockMovementService
from app.stock.schemas import (
    StockMovementCreate,
    StockMovementItemCreate,
)


@pytest.mark.asyncio
async def test_stock_movement_inward_outward_and_extract_flow():
    sm = get_sessionmaker()
    async with sm() as session:
        service = StockMovementService(session)

        # 1. Fetch test supplier and buyer or create mock references
        supp = (await session.execute(select(Supplier))).scalars().first()
        assert supp is not None

        buyer = (await session.execute(select(Buyer))).scalars().first()
        assert buyer is not None

        test_sku = f"TEST-SKU-{uuid.uuid4().hex[:6]}"
        inward_mov = None
        outward_mov = None
        lp = None
        so = None

        try:
            # 2. Test: Direct Inward creation
            inward_payload = StockMovementCreate(
                movement_type="inward",
                movement_date=date.today(),
                source_type="direct",
                supplier_id=supp.id,
                supplier_name=supp.company_name,
                warehouse_location="Mumbai Godown 1",
                reference_no="CHAL-9901",
                vehicle_no="MH-04-AB-9999",
                remarks="Direct factory receipt",
                items=[
                    StockMovementItemCreate(
                        product_name="High Speed Sealing Film",
                        product_code=test_sku,
                        expected_quantity=100.0,
                        quantity=100.0,
                        damaged_quantity=5.0,
                        accepted_quantity=95.0,
                        unit_rate=50.0,
                    )
                ],
            )

            inward_mov = await service.create_movement(inward_payload)
            assert inward_mov.id is not None
            assert inward_mov.movement_no.startswith("INW-")
            assert inward_mov.total_quantity == 95.0
            assert len(inward_mov.items) == 1
            assert inward_mov.items[0].accepted_quantity == 95.0

            # 3. Test: Direct Outward creation
            outward_payload = StockMovementCreate(
                movement_type="outward",
                movement_date=date.today(),
                source_type="direct",
                buyer_id=buyer.id,
                buyer_name=buyer.company_name,
                warehouse_location="Mumbai Godown 1",
                reference_no="DISP-1102",
                remarks="Dispatch to buyer",
                items=[
                    StockMovementItemCreate(
                        product_name="High Speed Sealing Film",
                        product_code=test_sku,
                        expected_quantity=30.0,
                        quantity=30.0,
                        damaged_quantity=0.0,
                        accepted_quantity=30.0,
                        unit_rate=75.0,
                    )
                ],
            )

            outward_mov = await service.create_movement(outward_payload)
            assert outward_mov.id is not None
            assert outward_mov.movement_no.startswith("OUT-")
            assert outward_mov.total_quantity == 30.0

            # 4. Verify Live Stock Balance for this SKU
            balances = await service.get_stock_balances(search=test_sku)
            assert len(balances) >= 1
            item_bal = next(b for b in balances if b["product_code"] == test_sku)
            assert item_bal["total_inward_qty"] == 95.0
            assert item_bal["total_outward_qty"] == 30.0
            assert item_bal["current_stock_qty"] == 65.0  # 95 - 30 = 65

            # 5. Verify Kardex chronological entries
            kardex = await service.get_product_kardex(product_name="High Speed Sealing Film")
            sku_kardex = [k for k in kardex if k["movement_no"] in (inward_mov.movement_no, outward_mov.movement_no)]
            assert len(sku_kardex) == 2

            # 6. Test: 1-Click Extract from Local Purchase
            # Create a mock Local Purchase
            lp = LocalPurchase(
                supplier_id=supp.id,
                supplier_name=supp.company_name,
                invoice_no=f"TEST-INV-{uuid.uuid4().hex[:6]}",
                invoice_date=date.today(),
                currency="RMB",
                invoice_total_value=1000.0,
                total_quantity=20.0,
                status="Confirmed",
            )
            session.add(lp)
            await session.flush()

            lp_item = LocalPurchaseItem(
                purchase_id=lp.id,
                product_name="Vacuum Nozzle Spare",
                product_code="VNS-01",
                quantity=20.0,
                unit_rate=50.0,
                vat_rate=13.0,
                item_total=1000.0,
                expense_per_unit=0.0,
                unit_landing_rate=50.0,
                total_landing_rate=1000.0,
            )
            session.add(lp_item)
            await session.flush()

            lp_extract = await service.extract_from_local_purchase(lp.id)
            assert lp_extract.invoice_no == lp.invoice_no
            assert lp_extract.supplier_name == supp.company_name
            assert len(lp_extract.items) == 1
            assert lp_extract.items[0].product_name == "Vacuum Nozzle Spare"
            assert lp_extract.items[0].quantity == 20.0

            # 7. Test: 1-Click Extract from Sale Order
            comp = (await session.execute(select(MasterCompany))).scalars().first()
            so = SaleOrder(
                order_no=f"TEST-SO-{uuid.uuid4().hex[:6]}",
                organization_id=comp.id if comp else None,
                organization_name=comp.name if comp else "Yinglima",
                buyer_id=buyer.id,
                buyer_name=buyer.company_name,
                order_date=date.today(),
                currency="RMB",
                total_quantity=15.0,
                status="sales_confirmed",
                container_no="CONT-7788",
                transporter_name="SafeExpress",
            )
            session.add(so)
            await session.flush()

            so_item = SaleOrderItem(
                order_id=so.id,
                product_name="Vacuum Nozzle Spare",
                product_code="VNS-01",
                quantity=15.0,
                unit_rate=80.0,
            )
            session.add(so_item)
            await session.flush()

            so_extract = await service.extract_from_sale_order(so.id)
            assert so_extract.order_no == so.order_no
            assert so_extract.buyer_name == buyer.company_name
            assert so_extract.container_no == "CONT-7788"
            assert len(so_extract.items) == 1
            assert so_extract.items[0].product_name == "Vacuum Nozzle Spare"
            assert so_extract.items[0].quantity == 15.0

        finally:
            # 8. Clean up: Delete all test records cleanly
            if inward_mov and outward_mov:
                await session.execute(text("DELETE FROM stock_movement_items WHERE movement_id IN (:m1, :m2)"), {"m1": inward_mov.id, "m2": outward_mov.id})
                await session.execute(text("DELETE FROM stock_movements WHERE id IN (:m1, :m2)"), {"m1": inward_mov.id, "m2": outward_mov.id})
            if lp:
                await session.execute(text("DELETE FROM local_purchase_items WHERE purchase_id = :lpid"), {"lpid": lp.id})
                await session.execute(text("DELETE FROM local_purchases WHERE id = :lpid"), {"lpid": lp.id})
            if so:
                await session.execute(text("DELETE FROM sales_order_items WHERE order_id = :soid"), {"soid": so.id})
                await session.execute(text("DELETE FROM sales_orders WHERE id = :soid"), {"soid": so.id})
            await session.commit()


@pytest.mark.asyncio
async def test_stock_movement_strict_block_outward_insufficient_stock():
    """Verify that Outward movement is strictly BLOCKED when requested qty exceeds available stock."""
    from app.core.exceptions import BadRequestException, NotFoundException


    sm = get_sessionmaker()
    async with sm() as session:
        service = StockMovementService(session)

        supp = (await session.execute(select(Supplier))).scalars().first()
        assert supp is not None

        buyer = (await session.execute(select(Buyer))).scalars().first()
        assert buyer is not None


        test_sku = f"BLOCK-TEST-{uuid.uuid4().hex[:6]}"
        inward_mov = None

        try:
            # 1. Inward 5 units
            inward_payload = StockMovementCreate(
                movement_type="inward",
                movement_date=date.today(),
                source_type="direct",
                supplier_id=supp.id,
                supplier_name=supp.company_name,
                warehouse_location="Warehouse Strict Block",
                items=[
                    StockMovementItemCreate(
                        product_name="Heavy Packaging Machine",
                        product_code=test_sku,
                        expected_quantity=5.0,
                        quantity=5.0,
                        damaged_quantity=0.0,
                        accepted_quantity=5.0,
                        unit_rate=500.0,
                    )
                ],
            )
            inward_mov = await service.create_movement(inward_payload)
            assert inward_mov.id is not None

            # 2. Attempt outward of 10 units (Available is only 5!) -> MUST RAISE BadRequestException
            outward_payload_excess = StockMovementCreate(
                movement_type="outward",
                movement_date=date.today(),
                source_type="direct",
                buyer_id=buyer.id,
                buyer_name=buyer.company_name,
                warehouse_location="Warehouse Strict Block",
                items=[
                    StockMovementItemCreate(
                        product_name="Heavy Packaging Machine",
                        product_code=test_sku,
                        expected_quantity=10.0,
                        quantity=100.0,
                        damaged_quantity=0.0,
                        accepted_quantity=10.0,
                        unit_rate=750.0,
                    )
                ],
            )

            with pytest.raises(BadRequestException) as exc_info:
                await service.create_movement(outward_payload_excess)

            assert "Insufficient Stock" in str(exc_info.value)
            assert "Available stock in warehouse is 5 units" in str(exc_info.value)
            assert "blocked to prevent negative inventory" in str(exc_info.value)

            # 3. Test delete_movement on inward: if not dispatched, it can be deleted
            await service.delete_movement(inward_mov.id)
            with pytest.raises(NotFoundException):
                await service.get_movement(inward_mov.id)


        finally:
            if inward_mov:
                await session.execute(text("DELETE FROM stock_movement_items WHERE movement_id = :mid"), {"mid": inward_mov.id})
                await session.execute(text("DELETE FROM stock_movements WHERE id = :mid"), {"mid": inward_mov.id})
            await session.commit()

