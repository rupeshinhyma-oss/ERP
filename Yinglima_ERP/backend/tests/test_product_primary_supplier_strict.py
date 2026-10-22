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
        # Fetch up to 2 existing active suppliers
        suppliers = (await session.execute(select(Supplier).limit(2))).scalars().all()
        assert len(suppliers) >= 2, "Test requires at least 2 suppliers in database"
        test_supplier = suppliers[0]
        test_other_supplier = suppliers[1]

        category = (await session.execute(select(ProductCategory))).scalars().first()
        assert category is not None, "Test requires at least 1 product category"

        uom = (await session.execute(select(UnitOfMeasurement))).scalars().first()

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
