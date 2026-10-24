import pytest
import uuid
from datetime import date
from sqlalchemy import select
from app.database.engine import get_sessionmaker
from app.masters.company_list.models import MasterCompany
from app.buyers.models import Buyer
from app.planning.models import PlanningSheet, PlanningColumn, PlanningColumnDataType
from app.sales.service import SaleService
from app.sales.schemas import SaleOrderCreate, SaleOrderItemCreate
from app.sales.models import SaleOrder


from app.users.models import User


@pytest.mark.asyncio
async def test_sale_planning_sheet_hierarchy_and_consignments():
    sm = get_sessionmaker()
    async with sm() as session:
        service = SaleService(session)

        # 1. Fetch or create company and user for test
        comp = (await session.execute(select(MasterCompany))).scalars().first()
        assert comp is not None

        user = (await session.execute(select(User))).scalars().first()
        assert user is not None
        user_id = user.id

        # 2. Create test sheet A (e.g. Inhyma Mumbai) and sheet B (e.g. Inhyma Ahmedabad)
        sheet_a = PlanningSheet(
            name=f"Test Sheet Mumbai {uuid.uuid4().hex[:6]}",
            organization_id=comp.id,
            position=0,
            created_by=user_id,
        )
        sheet_b = PlanningSheet(
            name=f"Test Sheet Ahmedabad {uuid.uuid4().hex[:6]}",
            organization_id=comp.id,
            position=1,
            created_by=user_id,
        )
        session.add_all([sheet_a, sheet_b])
        await session.flush()

        # Add consignment column to sheet A
        col_a1 = PlanningColumn(
            sheet_id=sheet_a.id,
            name="Mum 99",
            data_type=PlanningColumnDataType.NUMBER,
            position=1,
            created_by=user_id,
        )
        # Add consignment column to sheet B
        col_b1 = PlanningColumn(
            sheet_id=sheet_b.id,
            name="GJ 99",
            data_type=PlanningColumnDataType.NUMBER,
            position=1,
            created_by=user_id,
        )
        session.add_all([col_a1, col_b1])
        await session.flush()

        # 3. Test: get_planning_consignments with sheet_id=sheet_a.id must ONLY return col_a1
        consignments_a = await service.get_planning_consignments(sheet_id=sheet_a.id)
        col_ids_a = [c.column_id for c in consignments_a]
        assert col_a1.id in col_ids_a
        assert col_b1.id not in col_ids_a

        # 4. Test: get_planning_consignments with sheet_id=sheet_b.id must ONLY return col_b1
        consignments_b = await service.get_planning_consignments(sheet_id=sheet_b.id)
        col_ids_b = [c.column_id for c in consignments_b]
        assert col_b1.id in col_ids_b
        assert col_a1.id not in col_ids_b

        # 5. Test: create SaleOrder with sheet and consignment, with nullable buyer_id
        order_payload = SaleOrderCreate(
            organization_id=comp.id,
            organization_name=comp.name,
            buyer_id=None,
            buyer_name=sheet_a.name,
            planning_sheet_id=sheet_a.id,
            planning_column_id=col_a1.id,
            consignment_code="Mum 99",
            order_date=date.today(),
            currency="RMB",
            items=[
                SaleOrderItemCreate(
                    product_name="Test Sealer Spare Part",
                    quantity=10,
                    unit_rate=150.0,
                    tax_percent=13.0,
                )
            ],
        )

        created_order = await service.create_order(order_payload)
        assert created_order.id is not None
        assert created_order.planning_sheet_id == sheet_a.id
        assert created_order.planning_column_id == col_a1.id
        assert created_order.consignment_code == "Mum 99"
        assert created_order.buyer_id is None
        assert created_order.buyer_name == sheet_a.name

        # 6. Cleanup: Delete test data completely so DB remains clean
        from sqlalchemy import text
        await session.execute(text("DELETE FROM sales_order_items WHERE order_id = :oid"), {"oid": created_order.id})
        await session.execute(text("DELETE FROM sales_orders WHERE id = :oid"), {"oid": created_order.id})
        await session.delete(col_a1)
        await session.delete(col_b1)
        await session.delete(sheet_a)
        await session.delete(sheet_b)
        await session.commit()
