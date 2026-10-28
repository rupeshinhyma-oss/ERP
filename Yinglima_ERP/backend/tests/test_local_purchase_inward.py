import pytest
import uuid
from datetime import date
from sqlalchemy import select, delete

from app.purchases.local.models import LocalPurchase, LocalPurchaseItem
from app.purchases.local.schemas import LocalPurchaseCreate, LocalPurchaseItemCreate, LocalPurchaseInwardRequest, LocalPurchaseInwardItem
from app.purchases.local.service import LocalPurchaseService
from app.stock.models import StockMovement, StockMovementItem
from app.suppliers.models import Supplier


from app.database.engine import get_sessionmaker

@pytest.mark.asyncio
async def test_local_purchase_inward_lifecycle():
    """
    Test full lifecycle:
    1. Create Local Purchase with status 'Confirmed'.
    2. Execute inward_purchase.
    3. Verify StockMovement (inward) is created and linked.
    4. Verify Local Purchase status changes to 'Inwarded'.
    5. Verify duplicate inwarding is strictly blocked.
    """
    sm = get_sessionmaker()
    async with sm() as db_session:
        service = LocalPurchaseService(db_session)

        # 1. Ensure test supplier exists
        stmt = select(Supplier).limit(1)
        res = await db_session.execute(stmt)
        supplier = res.scalars().first()
        if not supplier:
            supplier = Supplier(
                company_name=f"Inward Test Supplier {uuid.uuid4().hex[:4]}",
                supplier_code=f"SUP-INW-{uuid.uuid4().hex[:4]}",
                country="China",
            )
            db_session.add(supplier)
            await db_session.flush()

        test_inv_no = f"INV-TEST-INW-{uuid.uuid4().hex[:6].upper()}"
        prod_name = f"Inward Widget {uuid.uuid4().hex[:4]}"

        create_payload = LocalPurchaseCreate(
            supplier_id=supplier.id,
            supplier_name=supplier.company_name,
            invoice_no=test_inv_no,
            invoice_date=date.today(),
            currency="RMB",
            invoice_total_value=565.0,
            status="Confirmed",
            items=[
                LocalPurchaseItemCreate(
                    product_name=prod_name,
                    quantity=50.0,
                    unit_rate=10.0,
                    vat_rate=13.0,
                )
            ],
        )

        purchase = await service.create_purchase(
            payload=create_payload,
            created_by_name="Test Operator",
        )
        await db_session.flush()

        assert purchase.id is not None
        assert purchase.status == "Confirmed"
        assert purchase.stock_movement_id is None
        assert purchase.stock_movement_number is None

        # 2. Execute inward_purchase
        inward_req = LocalPurchaseInwardRequest(
            movement_date=date.today(),
            warehouse_location="Main Godown",
            vehicle_no="浙B-88888",
            transporter_name="SF Logistics",
            remarks="Test warehouse delivery receipt",
            items=[
                LocalPurchaseInwardItem(
                    product_name=prod_name,
                    expected_quantity=50.0,
                    quantity=48.0, # 48 accepted
                    damaged_quantity=2.0, # 2 damaged
                    unit_rate=10.0,
                )
            ],
        )

        inwarded_purchase = await service.inward_purchase(
            purchase_id=purchase.id,
            inward_data=inward_req,
            created_by_name="Test Warehouseman",
        )
        await db_session.flush()

        # 3. Assert status & links updated
        assert inwarded_purchase.status == "Inwarded"
        assert inwarded_purchase.stock_movement_id is not None
        assert inwarded_purchase.stock_movement_number is not None
        assert inwarded_purchase.stock_movement_number.startswith("INW-")

        # 4. Verify StockMovement record in DB
        movement = await db_session.get(StockMovement, inwarded_purchase.stock_movement_id)
        assert movement is not None
        assert movement.movement_type == "inward"
        assert movement.movement_no == inwarded_purchase.stock_movement_number
        assert movement.purchase_invoice_no == test_inv_no
        assert len(movement.items) == 1
        assert movement.items[0].accepted_quantity == 48.0
        assert movement.items[0].damaged_quantity == 2.0

        # 5. Verify duplicate inwarding is strictly blocked
        with pytest.raises(Exception) as exc_info:
            await service.inward_purchase(
                purchase_id=purchase.id,
                inward_data=inward_req,
            )
        assert "already been inwarded" in str(exc_info.value).lower()

        # Clean up test data
        await db_session.execute(delete(StockMovementItem).where(StockMovementItem.movement_id == movement.id))
        await db_session.execute(delete(StockMovement).where(StockMovement.id == movement.id))
        await db_session.execute(delete(LocalPurchaseItem).where(LocalPurchaseItem.purchase_id == purchase.id))
        await db_session.execute(delete(LocalPurchase).where(LocalPurchase.id == purchase.id))
        await db_session.commit()

