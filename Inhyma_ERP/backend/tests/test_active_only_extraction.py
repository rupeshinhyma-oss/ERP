"""
System-Wide Active-Only Cross-Module Extraction & Zero-Regression Tests.

Verifies against an isolated in-memory SQLite AsyncSession:
1. Own management list queries (unfiltered) return BOTH Active and Inactive records
   so Active/Inactive tabs and reactivation workflows continue working.
2. BaseRepository._apply_dynamic_filters bidirectionally translates `?status=active|inactive`
   and `?is_active=true|false` across both `status`-column models (even when `Product` has a
   Python `@property is_active`) and `is_active`-column models (`Supplier`, `Company`).
3. Cross-module lookup/dropdown services (`BankService`, `ProductService`, `PriceListRepository`,
   `ConsignmentCodeRepository`, `InquiryRepository`, `search_universal`, `HrmsSetupService`,
   `HrmsLeaveService`) strictly exclude Inactive records while single-record `get_by_id` preserves
   historical lookups.
4. Transactional stock/warehouse/asset/expense guards reject Inactive master records on new
   mutations, while `require_active=False` permits historical order cancellation reversals.
5. Shipment Planning non-destructively hides rows linked to Inactive source records and restores
   their preserved cell values when the source record is reactivated.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock
import uuid

from fastapi import HTTPException
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from app.buyers.models import Buyer
from app.cache.dependency import get_cache_manager
from app.common.base_repository import BaseRepository
from app.common.filtering import FilterParams
from app.common.list_query import ListQueryParams
from app.common.pagination import PageParams
from app.common.search import SearchParams
from app.common.sorting import SortParams
from app.companies.models import Company
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException
from app.database.base import Base
from app.hrms.asset_service import HrmsAssetService
from app.hrms.expense_service import HrmsExpenseService
from app.hrms.leave_service import HrmsLeaveService
from app.hrms.models import (
    HrmsAsset,
    HrmsAssetAssignment,
    HrmsAssetHistory,
    HrmsAssetMaintenance,
    HrmsEmployeeLocation,
    HrmsExpense,
    HrmsExpenseCategory,
    HrmsExpenseSettings,
    HrmsHoliday,
    HrmsLeavePlan,
    HrmsLeavePlanType,
    HrmsLeaveType,
    HrmsLocation,
    HrmsTrackingSettings,
)
from app.hrms.schemas import AssetCreate, ExpenseCreate
from app.hrms.service import HrmsSetupService
from app.inquiries.models import ConsignmentCode, Inquiry, InquiryItem, Quotation, RFQ
from app.inquiries.repository import ConsignmentCodeRepository, InquiryRepository
from app.inventory.models import ProductStock
from app.inventory.stock_service import find_product, get_warehouse
from app.masters.banks.models import Bank
from app.masters.banks.repository import BankRepository
from app.masters.banks.service import BankService
from app.masters.brands.models import Brand
from app.masters.brands.repository import BrandRepository
from app.masters.cities.models import City
from app.masters.company_list.models import MasterCompany
from app.masters.countries.models import Country
from app.masters.currencies.models import Currency
from app.masters.districts.models import District
from app.masters.price_list.repository import PriceListRepository
from app.masters.product_categories.models import ProductCategory
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.models import ProductSubCategory
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository
from app.masters.products.models import Product, ProductDimensionRow, ProductMachineSpare
from app.masters.products.repository import ProductRepository
from app.masters.products.service import ProductService
from app.masters.states.models import State
from app.masters.taxes.models import Tax
from app.masters.taxes.repository import TaxRepository
from app.masters.uom.models import UnitOfMeasurement
from app.masters.uom.repository import UomRepository
from app.masters.warehouses.models import Warehouse
from app.planning.dependencies import get_planning_service
from app.planning.models import (
    PlanningCell,
    PlanningChangeLog,
    PlanningColumn,
    PlanningColumnDataType,
    PlanningColumnRoleLock,
    PlanningColumnSourceType,
    PlanningRow,
    PlanningSheet,
    PlanningStatusTag,
)
from app.rbac.models import Permission, Role, RolePermission, UserPermission, UserRole
from app.search.service import search_universal
from app.suppliers.models import (
    Supplier,
    SupplierCategoryLink,
    SupplierContact,
    SupplierEmail,
    SupplierProductLink,
    SupplierSubCategoryLink,
)
from app.suppliers.repository import SupplierRepository
from app.users.models import User, UserStatus


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_type, _compiler, **_kw) -> str:
    return "JSON"


def _make_list_params(**raw_filters: str) -> ListQueryParams:
    return ListQueryParams(
        page=PageParams(page=1, page_size=50),
        sort=SortParams(sort_by="created_at", sort_order="desc"),
        search=SearchParams(search=None),
        filters=FilterParams(exact=raw_filters),
    )


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Create a fresh isolated in-memory SQLite database with required ERP tables."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    tables = [
        User.__table__,
        Role.__table__,
        Permission.__table__,
        RolePermission.__table__,
        UserRole.__table__,
        UserPermission.__table__,
        Country.__table__,
        State.__table__,
        District.__table__,
        City.__table__,
        Currency.__table__,
        MasterCompany.__table__,
        ProductCategory.__table__,
        ProductSubCategory.__table__,
        Brand.__table__,
        UnitOfMeasurement.__table__,
        Tax.__table__,
        Bank.__table__,
        Warehouse.__table__,
        Supplier.__table__,
        SupplierContact.__table__,
        SupplierEmail.__table__,
        SupplierCategoryLink.__table__,
        SupplierSubCategoryLink.__table__,
        Product.__table__,
        ProductDimensionRow.__table__,
        ProductMachineSpare.__table__,
        SupplierProductLink.__table__,
        ProductStock.__table__,
        Company.__table__,
        Buyer.__table__,
        ConsignmentCode.__table__,
        Inquiry.__table__,
        InquiryItem.__table__,
        RFQ.__table__,
        Quotation.__table__,
        PlanningSheet.__table__,
        PlanningRow.__table__,
        PlanningColumn.__table__,
        PlanningCell.__table__,
        PlanningStatusTag.__table__,
        PlanningColumnRoleLock.__table__,
        PlanningChangeLog.__table__,
        HrmsLocation.__table__,
        HrmsEmployeeLocation.__table__,
        HrmsLeaveType.__table__,
        HrmsHoliday.__table__,
        HrmsLeavePlan.__table__,
        HrmsLeavePlanType.__table__,
        HrmsExpenseCategory.__table__,
        HrmsExpenseSettings.__table__,
        HrmsExpense.__table__,
        HrmsTrackingSettings.__table__,
        HrmsAsset.__table__,
        HrmsAssetAssignment.__table__,
        HrmsAssetHistory.__table__,
        HrmsAssetMaintenance.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session

    await engine.dispose()


async def _seed_core_catalog(db: AsyncSession) -> dict[str, object]:
    """Seed one Active + one Inactive record across core Master and Directory models."""
    country = Country(name="India", code="IN", status=RecordStatus.ACTIVE)
    db.add(country)
    await db.flush()
    state = State(country_id=country.id, name="Maharashtra", status=RecordStatus.ACTIVE)
    db.add(state)
    await db.flush()
    city = City(country_id=country.id, state_id=state.id, name="Mumbai", status=RecordStatus.ACTIVE)

    cat = ProductCategory(code="CAT-PKG", name="Packaging Machines", status=RecordStatus.ACTIVE)
    uom = UnitOfMeasurement(code="NOS", name="Numbers", status=RecordStatus.ACTIVE)
    tax = Tax(hsn_number="84223000", gst_percent=18.0, import_duty_percent=7.5, status=RecordStatus.ACTIVE)
    bank_active = Bank(
        bank_name="HDFC Active Bank",
        account_number="111122223333",
        account_holder_name="INHYMA ACTIVE",
        ifsc_code="HDFC0000001",
        branch="Mumbai",
        status=RecordStatus.ACTIVE,
    )
    bank_inactive = Bank(
        bank_name="ICICI Inactive Bank",
        account_number="999988887777",
        account_holder_name="INHYMA INACTIVE",
        ifsc_code="ICIC0000009",
        branch="Pune",
        status=RecordStatus.INACTIVE,
    )
    wh_active = Warehouse(
        name="Mumbai",
        address="Mulund West",
        billing_company="Inhyma Solutions LLP",
        status=RecordStatus.ACTIVE,
    )
    wh_inactive = Warehouse(
        name="Gujarat",
        address="Ahmedabad GIDC",
        billing_company="Inhyma Solutions LLP",
        status=RecordStatus.INACTIVE,
    )
    db.add_all([city, cat, uom, tax, bank_active, bank_inactive, wh_active, wh_inactive])
    await db.flush()

    prod_active = Product(
        product_code="PRD-ACT-001",
        product_name="Active Sealer Machine",
        product_name_tally="Active Sealer Machine",
        product_type="Machine",
        category_id=cat.id,
        uom_id=uom.id,
        hsn_id=tax.id,
        standard_price=1000.0,
        minimum_price=900.0,
        standard_cost=700.0,
        status=RecordStatus.ACTIVE,
    )
    prod_inactive = Product(
        product_code="PRD-INA-002",
        product_name="Inactive Sealer Machine",
        product_name_tally="Inactive Sealer Machine",
        product_type="Machine",
        category_id=cat.id,
        uom_id=uom.id,
        hsn_id=tax.id,
        standard_price=2000.0,
        minimum_price=1800.0,
        standard_cost=1200.0,
        status=RecordStatus.INACTIVE,
    )
    spare_active = Product(
        product_code="SPR-ACT-001",
        product_name="Active Heating Element",
        product_name_tally="Active Heating Element",
        product_type="Spare Part",
        category_id=cat.id,
        uom_id=uom.id,
        applicable_machine_ids=[],
        status=RecordStatus.ACTIVE,
    )
    spare_inactive = Product(
        product_code="SPR-INA-002",
        product_name="Inactive Heating Element",
        product_name_tally="Inactive Heating Element",
        product_type="Spare Part",
        category_id=cat.id,
        uom_id=uom.id,
        applicable_machine_ids=[],
        status=RecordStatus.INACTIVE,
    )
    db.add_all([prod_active, prod_inactive, spare_active, spare_inactive])
    await db.flush()

    spare_active.applicable_machine_ids = [str(prod_active.id), str(prod_inactive.id)]
    spare_inactive.applicable_machine_ids = [str(prod_active.id)]
    db.add_all(
        [
            ProductMachineSpare(machine_id=prod_active.id, spare_part_id=spare_active.id),
            ProductMachineSpare(machine_id=prod_active.id, spare_part_id=spare_inactive.id),
            ProductMachineSpare(machine_id=prod_inactive.id, spare_part_id=spare_active.id),
        ]
    )

    sup_active = Supplier(
        company_name="Active Sealer Supplier Ltd",
        country_id=country.id,
        state_id=state.id,
        city_id=city.id,
        is_active=True,
    )
    sup_inactive = Supplier(
        company_name="Inactive Sealer Supplier Ltd",
        country_id=country.id,
        state_id=state.id,
        city_id=city.id,
        is_active=False,
    )
    comp_active = Company(company_name="Active Sealer Client Corp", is_active=True)
    comp_inactive = Company(company_name="Inactive Sealer Client Corp", is_active=False)
    buyer_active = Buyer(company_name="Active Sealer Buyer LLP", country_id=country.id, is_active=True)
    buyer_inactive = Buyer(company_name="Inactive Sealer Buyer LLP", country_id=country.id, is_active=False)
    user_active = User(
        username="sealer_active_user",
        email="active.sealer@inhyma.test",
        first_name="Active",
        last_name="SealerUser",
        is_active=True,
        status=UserStatus.ACTIVE,
    )
    user_inactive = User(
        username="sealer_inactive_user",
        email="inactive.sealer@inhyma.test",
        first_name="Inactive",
        last_name="SealerUser",
        is_active=False,
        status=UserStatus.INACTIVE,
    )
    db.add_all(
        [
            sup_active,
            sup_inactive,
            comp_active,
            comp_inactive,
            buyer_active,
            buyer_inactive,
            user_active,
            user_inactive,
        ]
    )
    await db.commit()

    return {
        "cat": cat,
        "uom": uom,
        "bank_active": bank_active,
        "bank_inactive": bank_inactive,
        "wh_active": wh_active,
        "wh_inactive": wh_inactive,
        "prod_active": prod_active,
        "prod_inactive": prod_inactive,
        "spare_active": spare_active,
        "spare_inactive": spare_inactive,
        "sup_active": sup_active,
        "sup_inactive": sup_inactive,
        "comp_active": comp_active,
        "comp_inactive": comp_inactive,
        "buyer_active": buyer_active,
        "buyer_inactive": buyer_inactive,
        "user_active": user_active,
        "user_inactive": user_inactive,
    }


@pytest.mark.asyncio
async def test_management_lists_preserve_both_tabs_while_filtered_queries_translate_bidirectionally(
    db_session: AsyncSession,
):
    """
    Own management list queries (unfiltered) MUST return both Active & Inactive records,
    while `?status=active` and `?is_active=true` MUST return only Active records across both
    `status`-backed (`Product`) and `is_active`-backed (`Supplier`) models.
    """
    seeded = await _seed_core_catalog(db_session)
    prod_repo = ProductRepository(db_session)
    sup_repo = SupplierRepository(db_session)

    # 1. Unfiltered management list keeps BOTH Active and Inactive rows
    all_prods, total_prods = await prod_repo.paginated_list(_make_list_params())
    assert total_prods == 4
    assert {p.product_code for p in all_prods} == {
        "PRD-ACT-001",
        "PRD-INA-002",
        "SPR-ACT-001",
        "SPR-INA-002",
    }

    all_sups, total_sups = await sup_repo.paginated_list(_make_list_params())
    assert total_sups == 2

    # 2. Product (`status` column + Python `@property is_active`) handles both `?status=` and `?is_active=`
    active_by_status, _ = await prod_repo.paginated_list(_make_list_params(status="active"))
    assert {p.product_code for p in active_by_status} == {"PRD-ACT-001", "SPR-ACT-001"}

    active_by_bool, _ = await prod_repo.paginated_list(_make_list_params(is_active="true"))
    assert {p.product_code for p in active_by_bool} == {"PRD-ACT-001", "SPR-ACT-001"}

    inactive_by_status, _ = await prod_repo.paginated_list(_make_list_params(status="inactive"))
    assert {p.product_code for p in inactive_by_status} == {"PRD-INA-002", "SPR-INA-002"}

    inactive_by_bool, _ = await prod_repo.paginated_list(_make_list_params(is_active="false"))
    assert {p.product_code for p in inactive_by_bool} == {"PRD-INA-002", "SPR-INA-002"}

    # 3. Supplier (`is_active` column, no `status` column) handles both `?status=` and `?is_active=`
    sup_active_by_status, _ = await sup_repo.paginated_list(_make_list_params(status="active"))
    assert [s.id for s in sup_active_by_status] == [seeded["sup_active"].id]

    sup_active_by_bool, _ = await sup_repo.paginated_list(_make_list_params(is_active="true"))
    assert [s.id for s in sup_active_by_bool] == [seeded["sup_active"].id]

    sup_inactive_by_status, _ = await sup_repo.paginated_list(_make_list_params(status="inactive"))
    assert [s.id for s in sup_inactive_by_status] == [seeded["sup_inactive"].id]


@pytest.mark.asyncio
async def test_master_lookup_price_list_and_machine_spares_exclude_inactive_while_get_by_id_preserves_history(
    db_session: AsyncSession,
):
    """
    Master `/lookup` services, Universal Machine-Spares view, and Price List exclude Inactive
    records, whereas single-record `get_by_id` still resolves Inactive records for historical safety.
    """
    seeded = await _seed_core_catalog(db_session)
    cache_manager = get_cache_manager()

    bank_service = BankService(BankRepository(db_session), cache_manager)
    bank_lookup = await bank_service.list_all_cached()
    assert [b["bank_name"] if isinstance(b, dict) else b.bank_name for b in bank_lookup] == ["HDFC Active Bank"]
    # Single-record read for an existing historical bank reference still works
    historical_bank = await bank_service.get_by_id_or_raise(seeded["bank_inactive"].id)
    assert historical_bank.bank_name == "ICICI Inactive Bank"

    prod_service = ProductService(
        ProductRepository(db_session),
        ProductCategoryRepository(db_session),
        ProductSubCategoryRepository(db_session),
        BrandRepository(db_session),
        UomRepository(db_session),
        cache_manager,
        TaxRepository(db_session),
    )
    prod_lookup = await prod_service.list_all_cached()
    assert {p["product_code"] if isinstance(p, dict) else p.product_code for p in prod_lookup} == {
        "PRD-ACT-001",
        "SPR-ACT-001",
    }

    # Historical single-record product fetch still succeeds
    historical_prod = await prod_service.get_by_id_or_raise(seeded["prod_inactive"].id)
    assert historical_prod.product_code == "PRD-INA-002"

    # Machine-Spares universal matrix excludes inactive machines and inactive spares
    matrix = await prod_service.get_machine_spares_universal_view()
    assert [m["machine_code"] for m in matrix] == ["PRD-ACT-001"]
    assert [s["spare_part_code"] for s in matrix[0]["spares"]] == ["SPR-ACT-001"]

    # Price List excludes inactive products from both rows and KPI metrics
    price_repo = PriceListRepository(db_session)
    price_items, price_total = await price_repo.list_price_items(page=1, page_size=50)
    assert price_total == 2
    assert {item.product_code for item in price_items} == {"PRD-ACT-001", "SPR-ACT-001"}

    metrics = await price_repo.get_metrics()
    assert metrics.total_products == 2


@pytest.mark.asyncio
async def test_stock_and_warehouse_guards_block_new_inactive_mutations_but_allow_historical_reversals(
    db_session: AsyncSession,
):
    """
    `find_product` / `get_warehouse` reject Inactive records by default (`require_active=True`)
    while allowing `require_active=False` for cancelling historical orders.
    Also verifies ProductStock cross-module join excludes Inactive products.
    """
    seeded = await _seed_core_catalog(db_session)

    stock_active = ProductStock(
        sr_no=1,
        product_id=seeded["prod_active"].id,
        product_name_tally="Active Sealer Machine",
        product_code="PRD-ACT-001",
        uom="NOS",
        mumbai=10,
    )
    stock_inactive = ProductStock(
        sr_no=2,
        product_id=seeded["prod_inactive"].id,
        product_name_tally="Inactive Sealer Machine",
        product_code="PRD-INA-002",
        uom="NOS",
        mumbai=5,
    )
    db_session.add_all([stock_active, stock_inactive])
    await db_session.commit()

    # Active product & warehouse pass `require_active=True`
    found_prod = await find_product(db_session, "Active Sealer Machine", require_active=True)
    assert found_prod.id == seeded["prod_active"].id
    found_wh = await get_warehouse(db_session, "Mumbai", require_active=True)
    assert found_wh.id == seeded["wh_active"].id

    # Inactive product & warehouse fail `require_active=True`
    with pytest.raises(BadRequestException, match="inactive"):
        await find_product(db_session, "Inactive Sealer Machine", require_active=True)

    with pytest.raises(BadRequestException, match="inactive"):
        await get_warehouse(db_session, "Gujarat", require_active=True)

    # Historical reversal path (`require_active=False`) succeeds cleanly
    rev_prod = await find_product(db_session, "Inactive Sealer Machine", require_active=False)
    assert rev_prod.id == seeded["prod_inactive"].id
    rev_wh = await get_warehouse(db_session, "Gujarat", require_active=False)
    assert rev_wh.id == seeded["wh_inactive"].id

    # Inventory ProductStock join query excludes inactive products
    active_stock_rows = (
        await db_session.execute(
            select(ProductStock)
            .join(Product, ProductStock.product_id == Product.id)
            .where(
                ProductStock.deleted_at.is_(None),
                Product.deleted_at.is_(None),
                Product.status == RecordStatus.ACTIVE,
            )
        )
    ).scalars().all()
    assert [r.product_code for r in active_stock_rows] == ["PRD-ACT-001"]


@pytest.mark.asyncio
async def test_planning_grid_hides_inactive_linked_rows_non_destructively_and_restores_on_reactivation(
    db_session: AsyncSession,
):
    """
    Shipment Planning hides rows whose `item_source_module='product'` points to an Inactive product
    WITHOUT deleting the row or its cells, and restores them intact when the product is reactivated.
    """
    seeded = await _seed_core_catalog(db_session)
    actor = seeded["user_active"]
    prod_active = seeded["prod_active"]
    prod_inactive = seeded["prod_inactive"]

    sheet = PlanningSheet(
        name="Mum Branch Test",
        item_source_type=PlanningColumnSourceType.LINKED_LOOKUP,
        item_source_module="product",
        item_source_field="product_name_tally",
        created_by=actor.id,
    )
    db_session.add(sheet)
    await db_session.flush()

    col = PlanningColumn(
        sheet_id=sheet.id,
        name="Remarks",
        position=0,
        data_type=PlanningColumnDataType.TEXT,
        source_type=PlanningColumnSourceType.MANUAL,
        created_by=actor.id,
    )
    row_active = PlanningRow(
        sheet_id=sheet.id,
        label=prod_active.product_name_tally,
        position=0,
        linked_record_id=prod_active.id,
        created_by=actor.id,
    )
    row_inactive = PlanningRow(
        sheet_id=sheet.id,
        label=prod_inactive.product_name_tally,
        position=1,
        linked_record_id=prod_inactive.id,
        created_by=actor.id,
    )
    db_session.add_all([col, row_active, row_inactive])
    await db_session.flush()

    preserved_cell = PlanningCell(
        row_id=row_inactive.id,
        column_id=col.id,
        value="Urgent China Container #9",
        updated_by=actor.id,
    )
    db_session.add(preserved_cell)
    await db_session.commit()

    audit_mock = MagicMock()
    audit_mock.record = AsyncMock()
    planning_service = get_planning_service(db=db_session, audit_service=audit_mock)

    # While `prod_inactive` and `spare_inactive` are INACTIVE, `get_grid` hides them
    # and only exposes active products (`prod_active` and auto-populated `spare_active`).
    grid_hidden = await planning_service.get_grid(sheet.id)
    hidden_linked_ids = {r.linked_record_id for r in grid_hidden["rows"]}
    assert hidden_linked_ids == {prod_active.id, seeded["spare_active"].id}
    assert prod_inactive.id not in hidden_linked_ids
    assert seeded["spare_inactive"].id not in hidden_linked_ids

    # Underlying row & cell are NOT deleted in DB
    raw_cell = await db_session.get(PlanningCell, preserved_cell.id)
    assert raw_cell is not None
    assert raw_cell.value == "Urgent China Container #9"

    # Reactivate `prod_inactive` -> row and cell value immediately reappear
    prod_inactive.status = RecordStatus.ACTIVE
    await db_session.commit()

    grid_restored = await planning_service.get_grid(sheet.id)
    restored_linked_ids = {r.linked_record_id for r in grid_restored["rows"]}
    assert restored_linked_ids == {prod_active.id, prod_inactive.id, seeded["spare_active"].id}
    restored_row = next(r for r in grid_restored["rows"] if r.linked_record_id == prod_inactive.id)
    restored_cell = next(c for c in restored_row.cells if c.column_id == col.id)
    assert restored_cell.value == "Urgent China Container #9"


@pytest.mark.asyncio
async def test_inquiries_and_global_search_strictly_exclude_inactive_records(
    db_session: AsyncSession,
):
    """
    Inquiry lookups (`ConsignmentCodeRepository.list_for_buyer`, `InquiryRepository.get_all_company_summaries`)
    and Universal Search (`search_universal`) exclude Inactive records across all modules.
    """
    seeded = await _seed_core_catalog(db_session)
    buyer_active = seeded["buyer_active"]
    buyer_inactive = seeded["buyer_inactive"]
    actor = seeded["user_active"]

    cc_active = ConsignmentCode(buyer_id=buyer_active.id, code="MUM-ACT-01", status=RecordStatus.ACTIVE)
    cc_inactive = ConsignmentCode(buyer_id=buyer_active.id, code="MUM-INA-02", status=RecordStatus.INACTIVE)
    cc_for_inactive_buyer = ConsignmentCode(
        buyer_id=buyer_inactive.id, code="PUNE-ACT-03", status=RecordStatus.ACTIVE
    )
    db_session.add_all([cc_active, cc_inactive, cc_for_inactive_buyer])
    await db_session.flush()

    inq_for_active = Inquiry(
        buyer_id=buyer_active.id,
        consignment_code_id=cc_active.id,
        created_by=actor.id,
    )
    inq_for_inactive = Inquiry(
        buyer_id=buyer_inactive.id,
        consignment_code_id=cc_for_inactive_buyer.id,
        created_by=actor.id,
    )
    db_session.add_all([inq_for_active, inq_for_inactive])
    await db_session.commit()

    cc_repo = ConsignmentCodeRepository(db_session)
    codes = await cc_repo.list_for_buyer(buyer_active.id)
    assert [c.code for c in codes] == ["MUM-ACT-01"]

    inq_repo = InquiryRepository(db_session)
    summaries = await inq_repo.get_all_company_summaries()
    buyer_ids = {row["buyer_id"] for row in summaries}
    assert buyer_active.id in buyer_ids
    assert buyer_inactive.id not in buyer_ids

    # Universal search for "Sealer" finds only Active Product, Supplier, and User (never Inactive)
    results = await search_universal(db_session, "Sealer")
    titles = {item.title for item in results.results}
    assert "Active Sealer Machine" in titles
    assert "Active Sealer Supplier Ltd" in titles
    assert "Active SealerUser" in titles
    assert not any("Inactive" in t for t in titles)


@pytest.mark.asyncio
async def test_hrms_setup_tabs_vs_active_only_extraction_and_transactional_guards(
    db_session: AsyncSession,
):
    """
    HRMS Setup lists return both Active & Inactive items when `active_only=False` (for Setup Page),
    only Active items when `active_only=True` (for Leave/Asset/Expense modules), and reject
    Inactive locations/categories in transactional create calls.
    """
    seeded = await _seed_core_catalog(db_session)
    actor = seeded["user_active"]

    loc_active = HrmsLocation(
        name="Mumbai HQ",
        address="Mulund West",
        latitude=19.17,
        longitude=72.95,
        is_active=True,
    )
    loc_inactive = HrmsLocation(
        name="Closed Warehouse Office",
        address="Old Industrial Area",
        latitude=19.10,
        longitude=72.90,
        is_active=False,
    )
    exp_cat_active = HrmsExpenseCategory(name="Client Travel", is_active=True)
    exp_cat_inactive = HrmsExpenseCategory(name="Deprecated Allowance", is_active=False)
    leave_active = HrmsLeaveType(name="Casual Leave", code="CL", is_active=True)
    leave_inactive = HrmsLeaveType(name="Retired Leave", code="RL", is_active=False)
    db_session.add_all(
        [loc_active, loc_inactive, exp_cat_active, exp_cat_inactive, leave_active, leave_inactive]
    )
    await db_session.commit()

    hrms_service = HrmsSetupService(db_session)
    leave_service = HrmsLeaveService(db_session)

    # Setup management mode (`active_only=False`) keeps both Active and Inactive
    assert {l.name for l in await hrms_service.list_locations(active_only=False)} >= {
        "Mumbai HQ",
        "Closed Warehouse Office",
    }
    assert {c.name for c in await hrms_service.list_expense_categories(active_only=False)} >= {
        "Client Travel",
        "Deprecated Allowance",
    }
    assert {lt.name for lt in await leave_service.list_leave_types(active_only=False)} >= {
        "Casual Leave",
        "Retired Leave",
    }

    # Cross-module extraction mode (`active_only=True`) returns ONLY Active
    active_locs = await hrms_service.list_locations(active_only=True)
    assert "Mumbai HQ" in {l.name for l in active_locs}
    assert "Closed Warehouse Office" not in {l.name for l in active_locs}

    active_cats = await hrms_service.list_expense_categories(active_only=True)
    assert "Client Travel" in {c.name for c in active_cats}
    assert "Deprecated Allowance" not in {c.name for c in active_cats}

    active_leaves = await leave_service.list_leave_types(active_only=True)
    assert "Casual Leave" in {lt.name for lt in active_leaves}
    assert "Retired Leave" not in {lt.name for lt in active_leaves}

    # Asset creation with inactive location fails
    asset_service = HrmsAssetService(db_session)
    with pytest.raises(BadRequestException, match="inactive"):
        await asset_service.create_asset(
            AssetCreate(
                asset_name="Dell Latitude",
                category="Laptop",
                location_id=loc_inactive.id,
            ),
            actor_id=actor.id,
        )

    # Expense creation with inactive category fails
    expense_service = HrmsExpenseService(db_session)
    with pytest.raises(HTTPException) as exc_info:
        await expense_service.create_expense(
            employee_id=actor.id,
            payload=ExpenseCreate(
                category="Deprecated Allowance",
                amount=500.0,
                expense_date=date.today(),
                description="Taxi fare",
            ),
            is_submit=False,
        )
    assert exc_info.value.status_code == 400
    assert "inactive" in str(exc_info.value.detail).lower()
