import pytest
import uuid
from decimal import Decimal
from sqlalchemy import select, delete

from app.database.engine import get_sessionmaker
from app.masters.products.models import Product
from app.masters.products.repository import ProductRepository
from app.suppliers.models import Supplier, SupplierProductLink
from app.masters.product_categories.models import ProductCategory
from app.masters.uom.models import UnitOfMeasurement
from app.planning.source_registry import get_source_module


@pytest.mark.asyncio
async def test_product_primary_supplier_strict_resolution_and_no_fallback():
    """
    Verify that:
    1. If a Product has Product.supplier_id set directly in Product Master:
       - attach_planning_supplier_info attaches its Brand/City.
       - source_registry._product_getter resolves supplier_name and supplier_city.
    2. If a Product does NOT have Product.supplier_id set (None):
       - Even if linked to a Supplier via SupplierProductLink (secondary/other supplier),
         attach_planning_supplier_info strictly does NOT fall back to it.
       - supplier_name and supplier_city remain None (blank in Shipment Planning).
       - Product.supplier_id is NOT mutated.
       - All other fields (product_code, packaging_quantity, standard_price) resolve properly.
    3. Clean up all created test records cleanly.
    """
    sm = get_sessionmaker()
    async with sm() as session:
        # Fetch or seed 2 active suppliers, category, and UOM so test works on fresh isolated DBs
        from app.masters.countries.models import Country
        from app.masters.states.models import State
        from app.masters.cities.models import City
        seeded_ids = {"suppliers": [], "categories": [], "uoms": [], "countries": []}
        cntry = (await session.execute(select(Country).limit(1))).scalars().first()
        if cntry is None:
            cntry = Country(name=f"China-{uuid.uuid4().hex[:4]}", code=f"C{uuid.uuid4().hex[:3].upper()}")
            session.add(cntry)
            await session.flush()
            seeded_ids["countries"].append(cntry.id)
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

        suppliers = list((await session.execute(select(Supplier).limit(2))).scalars().all())
        while len(suppliers) < 2:
            s_obj = Supplier(
                company_name=f"Primary Strict Supplier {len(suppliers) + 1} {uuid.uuid4().hex[:4]}",
                country_id=cntry.id,
                state_id=st.id,
                city_id=cty.id,
            )
            session.add(s_obj)
            await session.flush()
            suppliers.append(s_obj)
            seeded_ids["suppliers"].append(s_obj.id)
        test_supplier = suppliers[0]
        test_other_supplier = suppliers[1]

        category = (await session.execute(select(ProductCategory).limit(1))).scalars().first()
        if category is None:
            category = ProductCategory(name=f"Packaging-{uuid.uuid4().hex[:4]}", code=f"CAT-{uuid.uuid4().hex[:4]}")
            session.add(category)
            await session.flush()
            seeded_ids["categories"].append(category.id)

        uom = (await session.execute(select(UnitOfMeasurement).limit(1))).scalars().first()
        if uom is None:
            uom = UnitOfMeasurement(name=f"Pieces-{uuid.uuid4().hex[:4]}", code=f"P{uuid.uuid4().hex[:4].upper()}")
            session.add(uom)
            await session.flush()
            seeded_ids["uoms"].append(uom.id)

        # Product 1: Has explicit primary supplier in Product Master
        prod_with_primary = Product(
            id=uuid.uuid4(),
            product_code=f"TEST-PR-01-{uuid.uuid4().hex[:6]}",
            product_name="Product With Primary Supplier",
            product_name_tally="Product With Primary Supplier",
            category_id=category.id,
            uom_id=uom.id if uom else None,
            supplier_id=test_supplier.id,
            packaging_quantity=Decimal("50"),
            packaging_gross_weight=Decimal("12.5"),
            packaging_unit_cbm=Decimal("0.08"),
            standard_price=Decimal("100.00"),
        )

        # Product 2: Does NOT have primary supplier in Product Master (supplier_id=None)
        prod_without_primary = Product(
            id=uuid.uuid4(),
            product_code=f"TEST-PR-02-{uuid.uuid4().hex[:6]}",
            product_name="Product Without Primary Supplier",
            product_name_tally="Product Without Primary Supplier",
            category_id=category.id,
            uom_id=uom.id if uom else None,
            supplier_id=None,
            packaging_quantity=Decimal("20"),
            packaging_gross_weight=Decimal("5.0"),
            packaging_unit_cbm=Decimal("0.03"),
            standard_price=Decimal("45.00"),
        )
        session.add_all([prod_with_primary, prod_without_primary])
        await session.flush()

        # Create a SupplierProductLink connecting Product 2 to the other supplier
        # (This simulates a product linked in the Suppliers module)
        link = SupplierProductLink(
            id=uuid.uuid4(),
            supplier_id=test_other_supplier.id,
            product_id=prod_without_primary.id,
        )
        session.add(link)
        await session.flush()

        try:
            repo = ProductRepository(session)
            await repo.attach_planning_supplier_info([prod_with_primary, prod_without_primary])

            expected_brand = (
                test_supplier.brand_description.strip()
                if test_supplier.brand_description and test_supplier.brand_description.strip()
                else test_supplier.company_name
            )

            # 1. Product with primary supplier: populated correctly
            assert prod_with_primary.supplier_name == expected_brand
            assert getattr(prod_with_primary, "_planning_supplier_name") == expected_brand

            # 2. Product without primary supplier: MUST BE NONE (BLANK)
            # Even though `link` exists in SupplierProductLink to `test_other_supplier`!
            assert prod_without_primary.supplier_name is None, (
                f"Expected supplier_name to be None, got {prod_without_primary.supplier_name}"
            )
            assert getattr(prod_without_primary, "_planning_supplier_name") is None
            assert getattr(prod_without_primary, "_planning_supplier_city") is None
            assert prod_without_primary.supplier_id is None, "Product.supplier_id must not be mutated"

            # 3. Source registry getter check (Shipment Planning data extraction)
            prod_module = get_source_module("product")
            assert prod_module is not None

            # Primary supplier product:
            assert prod_module.value_getter(prod_with_primary, "supplier_name") == expected_brand
            assert prod_module.value_getter(prod_with_primary, "packaging_quantity") == Decimal("50")
            assert prod_module.value_getter(prod_with_primary, "standard_price") == Decimal("100.00")

            # Without primary supplier product:
            assert prod_module.value_getter(prod_without_primary, "supplier_name") is None
            assert prod_module.value_getter(prod_without_primary, "supplier_city") is None
            # Other fields work normally
            assert prod_module.value_getter(prod_without_primary, "packaging_quantity") == Decimal("20")
            assert prod_module.value_getter(prod_without_primary, "packaging_gross_weight") == Decimal("5.0")
            assert prod_module.value_getter(prod_without_primary, "packaging_unit_cbm") == Decimal("0.03")
            assert prod_module.value_getter(prod_without_primary, "standard_price") == Decimal("45.00")

        finally:
            # Clean up all created test records
            await session.rollback()
            async with sm() as clean_session:
                await clean_session.execute(
                    delete(SupplierProductLink).where(SupplierProductLink.id == link.id)
                )
                await clean_session.execute(
                    delete(Product).where(Product.id.in_([prod_with_primary.id, prod_without_primary.id]))
                )
                await clean_session.commit()
