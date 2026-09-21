"""
Seed 2 realistic sample Sale Process orders with Shipment Planning items.
"""

import asyncio
import uuid
from datetime import date
from app.database.engine import get_sessionmaker
import app.users.models  # noqa: F401
import app.buyers.models  # noqa: F401
import app.masters.company_list.models  # noqa: F401
import app.planning.models  # noqa: F401
import app.sales.models  # noqa: F401
from app.sales.service import SaleService
from app.sales.schemas import SaleOrderCreate, SaleOrderItemCreate

async def seed_examples():
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        service = SaleService(session)

        from app.masters.company_list.models import MasterCompany
        from sqlalchemy import select

        q_ylm = await session.execute(select(MasterCompany).where(MasterCompany.name == "Yinglima"))
        ylm_comp = q_ylm.scalar_one_or_none()
        if not ylm_comp:
            ylm_comp = MasterCompany(
                name="Yinglima",
                code="YLM",
                description="Yinglima Machinery & Technology Co., Ltd.",
            )
            session.add(ylm_comp)
            await session.flush()

        org_id = ylm_comp.id
        buyer_inhyma_id = uuid.UUID("38dccdd6-5225-4259-8dda-11d829aa9171")
        buyer_darsh_id = uuid.UUID("3bfc7f9f-630a-45d0-b73d-78f314af2aa8")

        col1_id = uuid.UUID("dd717418-a6e2-4e40-8928-a9ac503ac26f") # Muminhyma 1
        col2_id = uuid.UUID("b4ddcded-d530-401c-b6db-9c82795b8356") # Muminhyma 2

        # -------------------------------------------------------------
        # Order 1: Inhyma Solutions LLP - Muminhyma 1
        # -------------------------------------------------------------
        print("Extracting items for Consignment 1 (Muminhyma 1)...")
        ext1 = await service.extract_consignment_items(col1_id)

        items1: list[SaleOrderItemCreate] = []
        rate_table = [1250.0, 1800.0, 950.0, 2400.0, 3100.0, 1500.0, 850.0, 4200.0]
        for idx, it in enumerate(ext1.items):
            rate = it.unit_rate if it.unit_rate > 0 else rate_table[idx % len(rate_table)]
            tax_pct = 13.0
            basic = it.quantity * rate
            tax = (basic * tax_pct) / 100.0
            tot = basic + tax

            items1.append(
                SaleOrderItemCreate(
                    product_id=it.product_id,
                    product_name=it.product_name,
                    product_code=it.product_code,
                    hsn_code=it.hsn_code,
                    quantity=it.quantity,
                    unit_rate=rate,
                    tax_percent=tax_pct,
                    tax_amount=round(tax, 2),
                    item_total=round(tot, 2),
                    planning_row_id=it.planning_row_id,
                    remarks=it.remarks or "Standard packing (wooden crate)",
                )
            )

        payload1 = SaleOrderCreate(
            organization_id=org_id,
            organization_name="Yinglima",
            buyer_id=buyer_inhyma_id,
            buyer_name="Inhyma Solutions LLP",
            buyer_branch_name="Mumbai Branch",
            consignment_code="MUMINHYMA 1",
            planning_sheet_id=ext1.sheet_id,
            planning_column_id=col1_id,
            order_date=date(2026, 9, 15),
            delivery_date=date(2026, 10, 5),
            currency="RMB",
            status="sales_confirmed",
            container_no="MSKU7891234",
            bl_no="MAEU98765432",
            transporter_name="Maersk Line",
            port_of_loading="Ningbo Port",
            port_of_discharge="Nhava Sheva, Mumbai",
            remarks="Container 1 dispatch planned for Mumbai branch fulfillment. 30 planned line items.",
            items=items1,
        )

        order1 = await service.create_order(payload1)
        print(f"Created Order 1: {order1.order_no} | Status: {order1.status} | Total: ¥{order1.total_amount:,.2f} ({order1.total_quantity} pcs)")

        # -------------------------------------------------------------
        # Order 2: Darsh Impex - Muminhyma 2
        # -------------------------------------------------------------
        print("\nExtracting items for Consignment 2 (Muminhyma 2)...")
        ext2 = await service.extract_consignment_items(col2_id)

        items2: list[SaleOrderItemCreate] = []
        rate_table2 = [115.0, 180.0, 260.0, 130.0, 210.0, 390.0]
        for idx, it in enumerate(ext2.items[:15]):  # First 15 items
            rate = it.unit_rate if it.unit_rate > 0 else rate_table2[idx % len(rate_table2)]
            tax_pct = 13.0
            basic = it.quantity * rate
            tax = (basic * tax_pct) / 100.0
            tot = basic + tax

            items2.append(
                SaleOrderItemCreate(
                    product_id=it.product_id,
                    product_name=it.product_name,
                    product_code=it.product_code,
                    hsn_code=it.hsn_code,
                    quantity=it.quantity,
                    unit_rate=rate,
                    tax_percent=tax_pct,
                    tax_amount=round(tax, 2),
                    item_total=round(tot, 2),
                    planning_row_id=it.planning_row_id,
                    remarks=it.remarks or "Priority manufacturing schedule",
                )
            )

        payload2 = SaleOrderCreate(
            organization_id=org_id,
            organization_name="Yinglima",
            buyer_id=buyer_darsh_id,
            buyer_name="Darsh Impex",
            buyer_branch_name="Headquarters",
            consignment_code="MUMINHYMA 2",
            planning_sheet_id=ext2.sheet_id,
            planning_column_id=col2_id,
            order_date=date(2026, 9, 16),
            delivery_date=date(2026, 10, 12),
            currency="USD",
            status="admin_approved",
            container_no="COSU4567890",
            bl_no="COSC12345678",
            transporter_name="COSCO Shipping",
            port_of_loading="Shanghai Port",
            port_of_discharge="Nhava Sheva, Mumbai",
            remarks="USD ($) Export Consignment order for Darsh Impex. Approved by Admin. Ready for vessel booking.",
            items=items2,
        )

        order2 = await service.create_order(payload2)
        print(f"Created Order 2: {order2.order_no} | Status: {order2.status} | Total: ${order2.total_amount:,.2f} ({order2.total_quantity} pcs)")

        await session.commit()
        print("\nSuccessfully seeded 2 realistic Sale Process examples into database!")

if __name__ == "__main__":
    asyncio.run(seed_examples())
