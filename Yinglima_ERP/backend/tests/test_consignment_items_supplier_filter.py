import uuid
import pytest
from sqlalchemy import delete, select

from app.database.engine import get_sessionmaker
from app.masters.countries.models import Country
from app.masters.product_categories.models import ProductCategory
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.planning.models import (
    PlanningCell,
    PlanningColumn,
    PlanningColumnDataType,
    PlanningRow,
    PlanningSheet,
)
from app.purchases.local.service import LocalPurchaseService
from app.suppliers.models import Supplier, SupplierProductLink
from app.users.models import User

pytestmark = pytest.mark.postgres


@pytest.mark.asyncio
async def test_consignment_items_supplier_filtering():
    """Verify consignment item extraction and strict primary/linked supplier filtering on isolated data."""
    sm = get_sessionmaker()
    created: dict[str, list[uuid.UUID]] = {
        "cells": [],
        "rows": [],
        "cols": [],
        "sheets": [],
        "links": [],
        "products": [],
        "suppliers": [],
    }
    async with sm() as session:
        try:
            cntry = (await session.execute(select(Country).limit(1))).scalars().first()
            if cntry is None:
                cntry = Country(name=f"China-{uuid.uuid4().hex[:4]}", code=f"C{uuid.uuid4().hex[:3].upper()}")
                session.add(cntry)
                await session.flush()

            from app.masters.states.models import State
            from app.masters.cities.models import City
            st = (await session.execute(select(State).where(State.country_id == cntry.id).limit(1))).scalars().first()
            if st is None:
                st = State(name=f"Zhejiang-{uuid.uuid4().hex[:4]}", code=f"Z{uuid.uuid4().hex[:3].upper()}", country_id=cntry.id)
                session.add(st)
                await session.flush()
            cty = (await session.execute(select(City).where(City.state_id == st.id).limit(1))).scalars().first()
            if cty is None:
                cty = City(name=f"Wenzhou-{uuid.uuid4().hex[:4]}", state_id=st.id, country_id=cntry.id)
                session.add(cty)
                await session.flush()

            user = (await session.execute(select(User).limit(1))).scalars().first()
            if user is None:
                from app.auth.security import hash_password
                user = User(
                    username=f"consign_user_{uuid.uuid4().hex[:6]}",
                    email=f"consign_{uuid.uuid4().hex[:6]}@test.local",
                    password_hash=hash_password("TestPass!12345"),
                    first_name="Consignment",
                    last_name="Tester",
                )
                session.add(user)
                await session.flush()

            cat = (await session.execute(select(ProductCategory).limit(1))).scalars().first()
            if cat is None:
                cat = ProductCategory(name=f"ConsignCat-{uuid.uuid4().hex[:4]}", code=f"CC-{uuid.uuid4().hex[:4]}")
                session.add(cat)
                await session.flush()

            uom = (await session.execute(select(UnitOfMeasurement).limit(1))).scalars().first()
            if uom is None:
                uom = UnitOfMeasurement(name=f"Pieces-{uuid.uuid4().hex[:4]}", code=f"P{uuid.uuid4().hex[:4].upper()}")
                session.add(uom)
                await session.flush()

            sup_a = Supplier(
                company_name=f"Consign Supplier A {uuid.uuid4().hex[:4]}",
                country_id=cntry.id,
                state_id=st.id,
                city_id=cty.id,
            )
            sup_b = Supplier(
                company_name=f"Consign Supplier B {uuid.uuid4().hex[:4]}",
                country_id=cntry.id,
                state_id=st.id,
                city_id=cty.id,
            )
            session.add_all([sup_a, sup_b])
            await session.flush()
            created["suppliers"].extend([sup_a.id, sup_b.id])

            prod_a = Product(
                product_code=f"PROD-MUM-{uuid.uuid4().hex[:4].upper()}",
                product_name="Consignment Machine A",
                product_name_tally="Consignment Machine A",
                category_id=cat.id,
                uom_id=uom.id,
                supplier_id=sup_a.id,
                purchase_vat_percent=0.0,
            )
            prod_b = Product(
                product_code=f"PROD-MUM-{uuid.uuid4().hex[:4].upper()}",
                product_name="Consignment Machine B",
                product_name_tally="Consignment Machine B",
                category_id=cat.id,
                uom_id=uom.id,
                supplier_id=sup_b.id,
                purchase_vat_percent=13.0,
            )
            session.add_all([prod_a, prod_b])
            await session.flush()
            created["products"].extend([prod_a.id, prod_b.id])

            link_ab = SupplierProductLink(supplier_id=sup_a.id, product_id=prod_b.id)
            session.add(link_ab)
            await session.flush()
            created["links"].append(link_ab.id)

            sheet = PlanningSheet(
                name=f"Consign Test Sheet {uuid.uuid4().hex[:6]}",
                position=0,
                created_by=user.id,
            )
            session.add(sheet)
            await session.flush()
            created["sheets"].append(sheet.id)

            col = PlanningColumn(
                sheet_id=sheet.id,
                name="Mum 48",
                data_type=PlanningColumnDataType.NUMBER,
                position=0,
                created_by=user.id,
            )
            session.add(col)
            await session.flush()
            created["cols"].append(col.id)

            row_a = PlanningRow(
                sheet_id=sheet.id,
                label=prod_a.product_name,
                position=0,
                linked_record_id=prod_a.id,
                created_by=user.id,
            )
            row_b = PlanningRow(
                sheet_id=sheet.id,
                label=prod_b.product_name,
                position=1,
                linked_record_id=prod_b.id,
                created_by=user.id,
            )
            session.add_all([row_a, row_b])
            await session.flush()
            created["rows"].extend([row_a.id, row_b.id])

            cell_a = PlanningCell(row_id=row_a.id, column_id=col.id, value="10")
            cell_b = PlanningCell(row_id=row_b.id, column_id=col.id, value="5")
            session.add_all([cell_a, cell_b])
            await session.commit()
            created["cells"].extend([cell_a.id, cell_b.id])

            service = LocalPurchaseService(session)

            # 1. Fetch all items (no supplier_id filter)
            all_items = await service.get_consignment_items(col.id)
            assert len(all_items) == 2

            # 2. Filter by Supplier A (primary on prod_a + secondary link on prod_b)
            sup_a_items = await service.get_consignment_items(col.id, supplier_id=sup_a.id)
            assert len(sup_a_items) == 2
            for it in sup_a_items:
                assert it.supplier_id == sup_a.id or sup_a.id in it.linked_supplier_ids
                if it.product_code == prod_a.product_code:
                    assert it.vat_rate == 0.0

            # 3. Filter by Supplier B (only prod_b)
            sup_b_items = await service.get_consignment_items(col.id, supplier_id=sup_b.id)
            assert len(sup_b_items) == 1
            assert sup_b_items[0].product_code == prod_b.product_code

            # 4. Non-existent supplier returns empty list
            empty_items = await service.get_consignment_items(col.id, supplier_id=uuid.uuid4())
            assert len(empty_items) == 0
        finally:
            await session.rollback()
            async with sm() as clean:
                if created["cells"]:
                    await clean.execute(delete(PlanningCell).where(PlanningCell.id.in_(created["cells"])))
                if created["rows"]:
                    await clean.execute(delete(PlanningRow).where(PlanningRow.id.in_(created["rows"])))
                if created["cols"]:
                    await clean.execute(delete(PlanningColumn).where(PlanningColumn.id.in_(created["cols"])))
                if created["sheets"]:
                    await clean.execute(delete(PlanningSheet).where(PlanningSheet.id.in_(created["sheets"])))
                if created["links"]:
                    await clean.execute(delete(SupplierProductLink).where(SupplierProductLink.id.in_(created["links"])))
                if created["products"]:
                    await clean.execute(delete(Product).where(Product.id.in_(created["products"])))
                if created["suppliers"]:
                    await clean.execute(delete(Supplier).where(Supplier.id.in_(created["suppliers"])))
                await clean.commit()
