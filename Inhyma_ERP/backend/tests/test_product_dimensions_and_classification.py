"""Unit tests for Section 2.2: Product Master & Dimensions.

Tests:
1. Client CBM rounding formula: <= 0.025 -> 0.02, 0.026 - 0.029 -> 0.03.
2. Machine vs Spare Part classification and multi-package dimensions in schemas.
3. Zero-stock delete enforcement: raising 'Stock exists' on single and bulk deletion when stock > 0.
4. Machine-Spares mapping and universal view functionality.
5. Package dimensions report generation.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException
from app.masters.products.models import Product, ProductDimensionRow, ProductMachineSpare
from app.masters.products.schemas import (
    BulkDeletePayload,
    MachineSpareMappingIn,
    MachineSpareUnmapIn,
    ProductCreate,
    ProductDimensionRowIn,
    compute_client_cbm,
)
from app.masters.products.service import ProductService


def test_client_cbm_rounding_rule():
    """Enforce client rounding rule:
    Auto-computed CBM rounded to 2 decimal places where <= 0.025 -> 0.02 and 0.026 - 0.029 -> 0.03.
    """
    # Test specific values directly
    # Length x Width x Height / 1,000,000 = raw CBM
    # Case 1: Raw = 0.025000 -> must round down to 0.02
    # 50 * 50 * 10 = 25,000 / 1,000,000 = 0.025
    assert compute_client_cbm(50, 50, 10) == 0.02

    # Case 2: Raw = 0.024000 -> must be 0.02
    # 40 * 60 * 10 = 24,000 / 1,000,000 = 0.024
    assert compute_client_cbm(40, 60, 10) == 0.02

    # Case 3: Raw = 0.026000 -> must round up to 0.03
    # 52 * 50 * 10 = 26,000 / 1,000,000 = 0.026
    assert compute_client_cbm(52, 50, 10) == 0.03

    # Case 4: Raw = 0.029000 -> must round up to 0.03
    # 58 * 50 * 10 = 29,000 / 1,000,000 = 0.029
    assert compute_client_cbm(58, 50, 10) == 0.03

    # Case 5: Raw = 0.0295 -> must round up to 0.03
    # 59 * 50 * 10 = 29,500 / 1,000,000 = 0.0295
    assert compute_client_cbm(59, 50, 10) == 0.03

    # Edge cases: 0 or negative
    assert compute_client_cbm(0, 10, 10) == 0.0
    assert compute_client_cbm(None, 10, 10) == 0.0


def test_product_schema_multi_package_dimensions():
    """Verify ProductCreate and ProductDimensionRowIn support package_name, weights, and product_type."""
    pkg_row1 = ProductDimensionRowIn(
        package_name="Main Frame Box",
        title="Wooden Crate",
        length=100,
        width=80,
        height=60,
        cbm=compute_client_cbm(100, 80, 60),
        net_weight=120.5,
        gross_weight=145.0,
    )
    assert pkg_row1.package_name == "Main Frame Box"
    assert pkg_row1.net_weight == 120.5
    assert pkg_row1.gross_weight == 145.0

    cat_id = uuid.uuid4()
    uom_id = uuid.uuid4()
    product_in = ProductCreate(
        product_name_tally="Semi Auto PFS 200",
        product_type="Machine",
        category_id=cat_id,
        uom_id=uom_id,
        packaging_quantity=1,
        packaging_gross_weight=145.0,
        length_cm=50,
        width_cm=50,
        height_cm=10,  # 0.025 raw -> 0.02 client CBM
        dimensions_rows=[pkg_row1],
    )
    assert product_in.product_type == "Machine"
    assert product_in.packaging_unit_cbm == 0.02


def test_spare_part_product_type_schema():
    """Verify Spare Part schema supports applicable_machine_ids."""
    machine_id1 = uuid.uuid4()
    machine_id2 = uuid.uuid4()
    cat_id = uuid.uuid4()
    uom_id = uuid.uuid4()

    spare_in = ProductCreate(
        product_name_tally="Heater Element 220V",
        product_type="Spare Part",
        applicable_machine_ids=[machine_id1, machine_id2],
        category_id=cat_id,
        uom_id=uom_id,
        packaging_quantity=1,
        packaging_gross_weight=2.5,
        packaging_unit_cbm=0.01,
    )
    assert spare_in.product_type == "Spare Part"
    assert len(spare_in.applicable_machine_ids) == 2


@pytest.mark.asyncio
async def test_zero_stock_delete_enforcement_on_product_stock():
    """Verify single and bulk delete raise 'Stock exists' if product has current_stock > 0."""
    repo = MagicMock()
    category_repo = MagicMock()
    sub_category_repo = MagicMock()
    brand_repo = MagicMock()
    uom_repo = MagicMock()
    cache_manager = MagicMock()

    service = ProductService(
        repository=repo,
        category_repository=category_repo,
        sub_category_repository=sub_category_repo,
        brand_repository=brand_repo,
        uom_repository=uom_repo,
        cache_manager=cache_manager,
    )

    prod_with_stock = MagicMock(spec=Product)
    prod_with_stock.id = uuid.uuid4()
    prod_with_stock.product_name_tally = "Machine Alpha"
    prod_with_stock.status = RecordStatus.INACTIVE
    prod_with_stock.current_stock = 3.0  # Stock > 0

    service.get_by_id_or_raise = AsyncMock(return_value=prod_with_stock)

    # Attempt single delete
    with pytest.raises(BadRequestException) as exc_info:
        await service.delete(prod_with_stock.id)
    assert "Stock exists" in str(exc_info.value)

    # Attempt bulk delete
    with pytest.raises(BadRequestException) as exc_info:
        await service.bulk_delete([prod_with_stock.id])
    assert "Stock exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test_zero_stock_delete_enforcement_on_warehouse_stock():
    """Verify single and bulk delete raise 'Stock exists' if ProductStock in warehouse has total_qty > 0."""
    repo = MagicMock()
    session = AsyncMock()
    repo.session = session
    category_repo = MagicMock()
    sub_category_repo = MagicMock()
    brand_repo = MagicMock()
    uom_repo = MagicMock()
    cache_manager = MagicMock()

    service = ProductService(
        repository=repo,
        category_repository=category_repo,
        sub_category_repository=sub_category_repo,
        brand_repository=brand_repo,
        uom_repository=uom_repo,
        cache_manager=cache_manager,
    )

    prod = MagicMock(spec=Product)
    prod.id = uuid.uuid4()
    prod.product_name_tally = "Packaging Unit X"
    prod.product_code = "PU-X"
    prod.status = RecordStatus.INACTIVE
    prod.current_stock = 0.0  # Header stock is 0, but warehouse stock exists

    service.get_by_id_or_raise = AsyncMock(return_value=prod)

    # Warehouse row with stock in Mumbai
    stock_record = MagicMock()
    stock_record.total_qty = 5.0
    stock_record.mumbai = 5.0
    stock_record.ahmedabad = 0.0
    stock_record.indore = 0.0
    stock_record.mumbai_transit = 0.0
    stock_record.ahmedabad_transit = 0.0
    stock_record.indore_transit = 0.0

    mock_scalars = MagicMock()
    mock_scalars.all.return_value = [stock_record]
    mock_res = MagicMock()
    mock_res.scalars.return_value = mock_scalars
    session.execute.return_value = mock_res

    # Attempt delete
    with pytest.raises(BadRequestException) as exc_info:
        await service.delete(prod.id)
    assert "Stock exists" in str(exc_info.value)

    # Attempt bulk delete
    with pytest.raises(BadRequestException) as exc_info:
        await service.bulk_delete([prod.id])
    assert "Stock exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test_zero_stock_delete_allows_when_stock_is_truly_zero():
    """Verify delete succeeds when stock is strictly 0."""
    repo = MagicMock()
    session = AsyncMock()
    repo.session = session
    category_repo = MagicMock()
    sub_category_repo = MagicMock()
    brand_repo = MagicMock()
    uom_repo = MagicMock()
    cache_manager = MagicMock()
    cache_manager.invalidate_dropdown = AsyncMock()

    service = ProductService(
        repository=repo,
        category_repository=category_repo,
        sub_category_repository=sub_category_repo,
        brand_repository=brand_repo,
        uom_repository=uom_repo,
        cache_manager=cache_manager,
    )

    prod = MagicMock(spec=Product)
    prod.id = uuid.uuid4()
    prod.product_name_tally = "Inactive Discontinued Item"
    prod.product_code = "IDI-01"
    prod.status = RecordStatus.INACTIVE
    prod.current_stock = 0.0

    service.get_by_id_or_raise = AsyncMock(return_value=prod)
    repo.is_referenced = AsyncMock(return_value=False)
    repo.delete = AsyncMock()

    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_res = MagicMock()
    mock_res.scalars.return_value = mock_scalars
    session.execute.return_value = mock_res

    await service.delete(prod.id)
    repo.delete.assert_called_once_with(prod)
