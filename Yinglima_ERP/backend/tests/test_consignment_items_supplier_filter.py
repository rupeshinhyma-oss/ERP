import pytest
import uuid
from app.database.engine import get_sessionmaker
from app.purchases.local.service import LocalPurchaseService
from app.planning.models import PlanningColumn
from sqlalchemy import select

@pytest.mark.asyncio
async def test_consignment_items_supplier_filtering():
    sm = get_sessionmaker()
    async with sm() as session:
        # Find Mum 48 column
        col_res = await session.execute(
            select(PlanningColumn).where(PlanningColumn.name == "Mum 48")
        )
        col = col_res.scalars().first()
        if not col:
            # Fallback to any consignment column
            col_res = await session.execute(
                select(PlanningColumn).where(PlanningColumn.name.ilike("%MUM%"))
            )
            col = col_res.scalars().first()
        
        assert col is not None, "Consignment column not found"
        service = LocalPurchaseService(session)

        # 1. Fetch all items (no supplier_id filter)
        all_items = await service.get_consignment_items(col.id)
        assert len(all_items) > 0, "Consignment should contain planned items"

        # Group by supplier
        suppliers_present = {it.supplier_id for it in all_items if it.supplier_id is not None}
        assert len(suppliers_present) >= 1, "Consignment should have items with suppliers"

        # 2. Pick a supplier that has items
        test_sup_id = list(suppliers_present)[0]
        sup_items = await service.get_consignment_items(col.id, supplier_id=test_sup_id)
        assert len(sup_items) > 0, "Filtered query should return items for this supplier"
        assert len(sup_items) <= len(all_items), "Filtered items should not exceed total items"

        # Verify all returned items belong to test_sup_id (either primary or secondary link)
        for it in sup_items:
            assert (it.supplier_id == test_sup_id or test_sup_id in it.linked_supplier_ids), (
                f"Item {it.product_name} does not belong to supplier {test_sup_id}"
            )
            # Ensure vat_rate does NOT erroneously pull 18% GST if purchase_vat_percent is 0%
            if it.product_code == "PROD-MUM-0002":
                assert it.vat_rate == 0.0, f"Expected 0.0% Purchase VAT for PROD-MUM-0002, got {it.vat_rate}"

        # 3. Test non-existent supplier returns empty list
        random_sup_id = uuid.uuid4()
        empty_items = await service.get_consignment_items(col.id, supplier_id=random_sup_id)
        assert len(empty_items) == 0, "Non-existent supplier should return 0 items"
