"""
Database Seed & Cleanup Script for Local Purchase and Sales Process Outward.

1. Clears old stock movements and movement items cleanly.
2. Creates:
   - Inwarded Local Purchase (LP-YLM/2026/0101) with warehouse stock.
   - Confirmed Local Purchase (LP-YLM/2026/0102) ready for user to click [📦 Inward Stock].
   - Dispatched Sale Order (SO-YLM/26-27/0001) with generated OUT voucher.
   - Admin Approved Sale Order (SO-YLM/26-27/0002) ready for user to click [📤 Outward / Dispatch Stock].
   - Admin Approved Sale Order (SO-YLM/26-27/0003) requesting 100 pcs of an item with only 30 pcs available,
     ready to test the strict blocking error: "Insufficient stock in warehouse (Available: 30, Requested: 100)".
"""

import asyncio
from datetime import date
from decimal import Decimal
import uuid

from sqlalchemy import select, text
from app.database.engine import get_sessionmaker
from app.users.models import User
from app.suppliers.models import Supplier
from app.buyers.models import Buyer
from app.masters.products.models import Product
from app.purchases.local.service import LocalPurchaseService
from app.purchases.local.schemas import LocalPurchaseCreate, LocalPurchaseItemCreate, LocalPurchaseInwardRequest
from app.sales.service import SaleService
from app.sales.schemas import SaleOrderCreate, SaleOrderItemCreate, SaleOrderDispatchRequest
from app.auth.service import CurrentUser


async def setup_clean_demo_data():
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # 1. Clean up old stock movements and test transactions
        print("Cleaning up old stock movements and items...")
        await session.execute(text("UPDATE local_purchases SET stock_movement_id = NULL, stock_movement_number = NULL"))
        await session.execute(text("UPDATE sales_orders SET stock_movement_id = NULL, stock_movement_number = NULL"))
        await session.execute(text("DELETE FROM stock_movement_items"))
        await session.execute(text("DELETE FROM stock_movements"))
        
        # Clear out prior test local purchases and sales orders so list is clean
        await session.execute(text("DELETE FROM local_purchase_items"))
        await session.execute(text("DELETE FROM local_purchases"))
        await session.execute(text("DELETE FROM sales_order_items"))
        await session.execute(text("DELETE FROM sales_orders"))
        await session.commit()
        print("Old stock movements and orders cleared.")

        # 2. Get active user
        user_row = (await session.execute(select(User).limit(1))).scalar_one_or_none()
        if not user_row:
            print("Error: No user found.")
            return

        current_user = CurrentUser(
            id=user_row.id,
            username=user_row.username,
            permissions={"*"},
            is_super_admin=True,
        )

        # 3. Get master company
        from app.masters.company_list.models import MasterCompany
        company = (await session.execute(select(MasterCompany).limit(1))).scalars().first()
        if not company:
            company = MasterCompany(name="Yinglima Industrial", code="YLM-CN")
            session.add(company)
            await session.flush()

        # 4. Get suppliers
        suppliers = (await session.execute(select(Supplier).limit(2))).scalars().all()
        if not suppliers:
            print("Error: No suppliers found.")
            return
        sup1 = suppliers[0]
        sup2 = suppliers[1] if len(suppliers) > 1 else suppliers[0]

        # 5. Get buyers
        buyers = (await session.execute(select(Buyer).limit(2))).scalars().all()
        if not buyers:
            print("Error: No buyers found.")
            return
        buyer1 = buyers[0]
        buyer2 = buyers[1] if len(buyers) > 1 else buyers[0]

        # 6. Get products
        products = (await session.execute(select(Product).limit(4))).scalars().all()
        if len(products) < 2:
            print("Error: Not enough products found.")
            return
        prod1 = products[0] # e.g. GF100 Granular Filler
        prod2 = products[1] # e.g. Loadcell
        prod3 = products[2] if len(products) > 2 else products[0]

        purchase_service = LocalPurchaseService(session)
        sales_service = SaleService(session)

        # Fetch live consignments lookup to link real Organization, Branch & Consignment
        lookup = await purchase_service.get_consignments_lookup(force_refresh=True)
        lookup_inm = next((s for s in lookup if "Inhyma Mumbai" in s.sheet_name and s.consignments), None)
        col_inm = next((c for c in lookup_inm.consignments if "48" in c.consignment_code), lookup_inm.consignments[0]) if lookup_inm else None

        lookup_ina = next((s for s in lookup if "Inhyma Ahmedabad" in s.sheet_name and s.consignments), None)
        col_ina = next((c for c in lookup_ina.consignments if "15" in c.consignment_code), lookup_ina.consignments[0]) if lookup_ina else None

        # -------------------------------------------------------------
        # LOCAL PURCHASE 1: Inwarded into warehouse (INW-2026-0001)
        # -------------------------------------------------------------
        print("\nCreating Local Purchase 1 (Inwarded into Warehouse)...")
        qty1_1 = Decimal("50.00")
        rate1_1 = Decimal("462.00")
        tax_pct1_1 = Decimal("13.00")
        sub1_1 = qty1_1 * rate1_1
        tax1_1 = (sub1_1 * tax_pct1_1 / Decimal("100.00")).quantize(Decimal("0.01"))
        tot1_1 = sub1_1 + tax1_1

        qty1_2 = Decimal("30.00")
        rate1_2 = Decimal("150.00")
        tax_pct1_2 = Decimal("13.00")
        sub1_2 = qty1_2 * rate1_2
        tax1_2 = (sub1_2 * tax_pct1_2 / Decimal("100.00")).quantize(Decimal("0.01"))
        tot1_2 = sub1_2 + tax1_2

        inv_total_1 = tot1_1 + tot1_2

        lp1_payload = LocalPurchaseCreate(
            organization_id=lookup_inm.organization_id if lookup_inm else None,
            organization_name=lookup_inm.organization_name if lookup_inm else "Inhyma",
            branch_id=lookup_inm.branch_id if lookup_inm else "br_1786607288802_tg33",
            branch_name=lookup_inm.branch_name if lookup_inm else "Inhyma Mumbai (INM)",
            group_label=lookup_inm.group_label if lookup_inm else "Mum",
            planning_sheet_id=lookup_inm.sheet_id if lookup_inm else None,
            planning_column_id=col_inm.column_id if col_inm else None,
            consignment_code=col_inm.consignment_code if col_inm else "Mum 48",
            supplier_id=sup1.id,
            supplier_name=sup1.company_name,
            invoice_no="LP-YLM/2026/0101",
            invoice_date=date(2026, 10, 24),
            invoice_total_value=inv_total_1,
            payment_terms="Credit 30 Days",
            items=[
                LocalPurchaseItemCreate(
                    product_id=prod1.id,
                    product_name=prod1.product_name,
                    product_code=prod1.product_code,
                    quantity=qty1_1,
                    unit_rate=rate1_1,
                    tax_percent=tax_pct1_1,
                    tax_amount=tax1_1,
                    total_amount=tot1_1,
                    hsn_code="8422",
                    uom="PCS",
                ),
                LocalPurchaseItemCreate(
                    product_id=prod2.id,
                    product_name=prod2.product_name,
                    product_code=prod2.product_code,
                    quantity=qty1_2,
                    unit_rate=rate1_2,
                    tax_percent=tax_pct1_2,
                    tax_amount=tax1_2,
                    total_amount=tot1_2,
                    hsn_code="8423",
                    uom="PCS",
                ),
            ],
        )

        lp1 = await purchase_service.create_purchase(
            payload=lp1_payload,
            created_by_id=user_row.id,
            created_by_name=user_row.username or "Admin",
        )
        print(f"Created LP1: {lp1.invoice_no} (Org: {lp1.organization_name}, Branch: {lp1.branch_name}, Consignment: {lp1.consignment_code})")

        # Inward LP1 to generate INW-2026-0001 and stock warehouse
        inward_res = await purchase_service.inward_purchase(
            purchase_id=lp1.id,
            inward_data=LocalPurchaseInwardRequest(
                warehouse_location="Main Godown",
                vehicle_no="CH-01-GA-9921",
                transporter_name="Shenzhen Fast Express",
                remarks="Automated inward receipt from verified local purchase",
            ),
            created_by_id=user_row.id,
            created_by_name=user_row.username or "Admin",
        )
        print(f"Inwarded LP1: Movement No = {inward_res.stock_movement_number}")

        # -------------------------------------------------------------
        # LOCAL PURCHASE 2: Confirmed (Ready for user to click Inward)
        # -------------------------------------------------------------
        print("\nCreating Local Purchase 2 (Confirmed & Ready for Inward)...")
        qty2_1 = Decimal("25.00")
        rate2_1 = Decimal("80.00")
        tax_pct2_1 = Decimal("13.00")
        sub2_1 = qty2_1 * rate2_1
        tax2_1 = (sub2_1 * tax_pct2_1 / Decimal("100.00")).quantize(Decimal("0.01"))
        tot2_1 = sub2_1 + tax2_1

        lp2_payload = LocalPurchaseCreate(
            organization_id=lookup_ina.organization_id if lookup_ina else None,
            organization_name=lookup_ina.organization_name if lookup_ina else "Inhyma",
            branch_id=lookup_ina.branch_id if lookup_ina else "br_1786607390334_uitw",
            branch_name=lookup_ina.branch_name if lookup_ina else "Inhyma Ahmedabad (INA)",
            group_label=lookup_ina.group_label if lookup_ina else "GJ",
            planning_sheet_id=lookup_ina.sheet_id if lookup_ina else None,
            planning_column_id=col_ina.column_id if col_ina else None,
            consignment_code=col_ina.consignment_code if col_ina else "GJ15",
            supplier_id=sup2.id,
            supplier_name=sup2.company_name,
            invoice_no="LP-YLM/2026/0102",
            invoice_date=date(2026, 10, 25),
            invoice_total_value=tot2_1,
            payment_terms="Immediate",
            items=[
                LocalPurchaseItemCreate(
                    product_id=prod3.id,
                    product_name=prod3.product_name,
                    product_code=prod3.product_code,
                    quantity=qty2_1,
                    unit_rate=rate2_1,
                    tax_percent=tax_pct2_1,
                    tax_amount=tax2_1,
                    total_amount=tot2_1,
                    hsn_code="8541",
                    uom="PCS",
                ),
            ],
        )
        lp2 = await purchase_service.create_purchase(
            payload=lp2_payload,
            created_by_id=user_row.id,
            created_by_name=user_row.username or "Admin",
        )
        print(f"Created LP2: {lp2.invoice_no} (Org: {lp2.organization_name}, Branch: {lp2.branch_name}, Consignment: {lp2.consignment_code}) - Ready for user to click [Inward Stock]")

        # -------------------------------------------------------------
        # SALE ORDER 1: Dispatched (OUT-2026-0001 generated, stock deducted)
        # -------------------------------------------------------------
        print("\nCreating Sale Order 1 (Dispatched & Linked to OUT-2026-0001)...")
        so1_payload = SaleOrderCreate(
            order_no="SO-YLM/26-27/0001",
            organization_id=lookup_inm.organization_id if lookup_inm else company.id,
            organization_name=lookup_inm.organization_name if lookup_inm else "Inhyma",
            consignment_code=col_inm.consignment_code if col_inm else "Mum 48",
            planning_sheet_id=lookup_inm.sheet_id if lookup_inm else None,
            planning_column_id=col_inm.column_id if col_inm else None,
            order_date=date(2026, 10, 25),
            buyer_id=buyer1.id,
            buyer_name=buyer1.company_name,
            currency="RMB",
            container_no="MSKU-8829102",
            transporter_name="Ocean Wave Logistics",
            vehicle_no="WB-02-AL-4412",
            items=[
                SaleOrderItemCreate(
                    product_id=prod1.id,
                    product_name=prod1.product_name,
                    product_code=prod1.product_code,
                    quantity=10,
                    unit_rate=Decimal("650.00"),
                    tax_percent=Decimal("0.00"),
                ),
            ],
        )
        so1 = await sales_service.create_order(so1_payload, current_user=current_user)
        # Transition to admin_approved
        await sales_service.update_status(so1.id, "admin_approved", "Approved by Admin")
        # Dispatch SO1
        so1_disp = await sales_service.dispatch_order(
            order_id=so1.id,
            dispatch_data=SaleOrderDispatchRequest(
                warehouse_location="Main Godown",
                vehicle_no="WB-02-AL-4412",
                transporter_name="Ocean Wave Logistics",
                remarks="Dispatched consignment to Om Packaging",
            ),
            created_by_id=user_row.id,
            created_by_name=user_row.username or "Admin",
        )
        print(f"Dispatched SO1: {so1_disp.order_no} -> Movement No = {so1_disp.stock_movement_number}")

        # -------------------------------------------------------------
        # SALE ORDER 2: Admin Approved (Ready for user to click [Outward / Dispatch Stock])
        # Available stock: prod1 has 40 pcs, prod2 has 30 pcs
        # SO2 requests: prod1: 5 pcs, prod2: 5 pcs
        # -------------------------------------------------------------
        print("\nCreating Sale Order 2 (Admin Approved & Ready for Dispatch)...")
        so2_payload = SaleOrderCreate(
            order_no="SO-YLM/26-27/0002",
            organization_id=lookup_ina.organization_id if lookup_ina else company.id,
            organization_name=lookup_ina.organization_name if lookup_ina else "Inhyma",
            consignment_code=col_ina.consignment_code if col_ina else "GJ15",
            planning_sheet_id=lookup_ina.sheet_id if lookup_ina else None,
            planning_column_id=col_ina.column_id if col_ina else None,
            order_date=date(2026, 10, 26),
            buyer_id=buyer2.id,
            buyer_name=buyer2.company_name,
            currency="RMB",
            container_no="TCLU-5519283",
            transporter_name="Express Star Logistics",
            vehicle_no="DL-01-EE-3344",
            items=[
                SaleOrderItemCreate(
                    product_id=prod1.id,
                    product_name=prod1.product_name,
                    product_code=prod1.product_code,
                    quantity=5,
                    unit_rate=Decimal("680.00"),
                    tax_percent=Decimal("0.00"),
                ),
                SaleOrderItemCreate(
                    product_id=prod2.id,
                    product_name=prod2.product_name,
                    product_code=prod2.product_code,
                    quantity=5,
                    unit_rate=Decimal("220.00"),
                    tax_percent=Decimal("0.00"),
                ),
            ],
        )
        so2 = await sales_service.create_order(so2_payload, current_user=current_user)
        await sales_service.update_status(so2.id, "admin_approved", "Ready to dispatch")
        print(f"Created SO2: {so2.order_no} (Status: admin_approved) - Ready for user to click [Outward / Dispatch Stock]")

        # -------------------------------------------------------------
        # SALE ORDER 3: Insufficient Stock (Ready to test blockage error)
        # Available stock for prod2 is 30 - 0 = 30 pcs
        # SO3 requests 100 pcs of prod2!
        # -------------------------------------------------------------
        print("\nCreating Sale Order 3 (Admin Approved - Insufficient Stock Blockage Test)...")
        so3_payload = SaleOrderCreate(
            order_no="SO-YLM/26-27/0003",
            organization_id=lookup_inm.organization_id if lookup_inm else company.id,
            organization_name=lookup_inm.organization_name if lookup_inm else "Inhyma",
            consignment_code=col_inm.consignment_code if col_inm else "Mum 48",
            planning_sheet_id=lookup_inm.sheet_id if lookup_inm else None,
            planning_column_id=col_inm.column_id if col_inm else None,
            order_date=date(2026, 10, 26),
            buyer_id=buyer1.id,
            buyer_name=buyer1.company_name,
            currency="RMB",
            container_no="CMAU-1122334",
            transporter_name="Global Fast Movers",
            vehicle_no="HR-26-AB-9876",
            items=[
                SaleOrderItemCreate(
                    product_id=prod2.id,
                    product_name=prod2.product_name,
                    product_code=prod2.product_code,
                    quantity=100,  # Far exceeds warehouse stock (30 available)
                    unit_rate=Decimal("220.00"),
                    tax_percent=Decimal("0.00"),
                ),
            ],
        )
        so3 = await sales_service.create_order(so3_payload, current_user=current_user)
        await sales_service.update_status(so3.id, "admin_approved", "Ready for dispatch test")
        print(f"Created SO3: {so3.order_no} (Status: admin_approved, Qty: 100) - Ready to test strict blockage!")

        await session.commit()
        print("\n=== SETUP COMPLETE ===")
        print("Stock Balances in Warehouse:")
        print(f"  - {prod1.product_name}: 50 inward - 10 outward = 40 pcs in stock")
        print(f"  - {prod2.product_name}: 30 inward - 0 outward = 30 pcs in stock")
        print("Orders Ready for Testing:")
        print("  - Local Purchase LP-YLM/2026/0102: Status 'Confirmed', ready for [Inward Stock]")
        print("  - Sale Order SO-YLM/26-27/0002: Status 'admin_approved', ready for [Outward / Dispatch Stock]")
        print("  - Sale Order SO-YLM/26-27/0003: Status 'admin_approved', requests 100 pcs -> triggers Insufficient Stock error!")


if __name__ == "__main__":
    asyncio.run(setup_clean_demo_data())
