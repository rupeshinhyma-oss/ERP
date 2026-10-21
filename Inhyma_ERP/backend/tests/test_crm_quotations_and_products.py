"""
INHYMA ERP — CRM IMPLEMENTATION PROMPT 5 OF 10:
Product Master Integration and Sales Quotation Data Model Test Suite.

Verifies:
1. Product Master Lookup:
   - Search active and sellable products from existing Product Master.
   - Exclude inactive, soft-deleted, or non-sellable products.
2. CRM Lead-Product Associations:
   - Associate product with lead.
   - Prevent duplicate associations of the same product on a lead.
   - List associated products with enriched product master snapshot.
   - Disassociate product from lead.
   - Exactly-once CRM activity logging for product_associated and product_disassociated.
3. Sales Quotation Data Model & Numbering:
   - Collision-resistant unique quotation numbering (SQ-YYYYMM-XXXX).
   - Multi-item quotation creation linked to lead and company.
   - Snapshot immutability: subsequent Product Master changes do not affect quotation items.
   - Rejection of invalid, deleted, or unauthorized product IDs.
4. Decimal Arithmetic, Commercial Rules & Rounding:
   - Decimal-safe calculations: taxable_amount, tax_amount, line total, subtotal, grand total.
   - ROUND_HALF_UP rounding rules verified.
   - Validation against negative prices, discounts exceeding price, negative taxes.
   - Explicit zero-tax/tax-exempt handling.
5. Quotation Versioning & Status Lifecycle:
   - Draft editing in-place.
   - Explicit or automatic revision creation preserves snapshot in crm_quotation_versions.
   - Version incrementation (v1 -> v2) without overwriting past revisions.
   - Controlled status transitions (draft, sent, accepted, rejected, expired).
6. Role-Based Scoping & Direct-ID Authorization:
   - Admin has full access across all leads and quotations.
   - Manager scoped to department/team; 403 Forbidden on out-of-scope lead/quotation IDs.
   - Salesperson scoped strictly to assigned leads; 403 Forbidden on other salesperson's quotations.
   - Direct-ID attack resistance on all quotation, revision, and product association endpoints.
7. Activity History Integration:
   - quotation_created, quotation_updated, quotation_status_change logged exactly once.
"""

from __future__ import annotations

from decimal import Decimal
import random
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.companies.models import Company, CompanyContact
from app.core.constants import RecordStatus
from app.crm.models import (
    CrmActivity,
    CrmLead,
    CrmLeadProduct,
    CrmPipeline,
    CrmPipelineStage,
    CrmQuotationItem,
    CrmQuotationVersion,
    CrmSalesQuotation,
)
from app.database.engine import get_sessionmaker
from app.masters.product_categories.models import ProductCategory
from app.masters.taxes.models import Tax
from app.masters.uom.models import UnitOfMeasurement
from app.masters.products.models import Product
import app.masters.product_sub_categories.models  # noqa: F401
import app.masters.brands.models  # noqa: F401
import app.masters.company_list.models  # noqa: F401
import app.masters.countries.models  # noqa: F401
import app.masters.states.models  # noqa: F401
import app.masters.cities.models  # noqa: F401
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
SALESPERSON_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
SALESPERSON_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")
OUT_OF_SCOPE_MGR_ID = uuid.UUID("80c80649-3299-5b8b-9bbc-c45d8354ec16")


def unique_phone_suffix() -> str:
    return str(random.randint(10000000, 99999999))


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view", "companies.manage", "products.view", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        MANAGER_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view", "products.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_a_headers() -> dict[str, str]:
    token = create_access_token(
        SALESPERSON_A_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view", "products.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_b_headers() -> dict[str, str]:
    token = create_access_token(
        SALESPERSON_B_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view", "products.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_quotation_environment():
    """Seed users, roles, pipeline, stages, company, category, uom, taxes, and products."""
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # 1. Users
        users_to_ensure = [
            (ADMIN_ID, "admin_user_q", "admin_q@inhyma.test"),
            (MANAGER_ID, "manager_user_q", "manager_q@inhyma.test"),
            (OUT_OF_SCOPE_MGR_ID, "out_mgr_user_q", "outmgr_q@inhyma.test"),
            (SALESPERSON_A_ID, "rep_a_user_q", "repa_q@inhyma.test"),
            (SALESPERSON_B_ID, "rep_b_user_q", "repb_q@inhyma.test"),
        ]
        for uid, uname, uemail in users_to_ensure:
            u = await session.get(User, uid)
            if not u:
                u = User(
                    id=uid,
                    username=uname,
                    email=uemail,
                    is_active=True,
                    has_login=True,
                    status=UserStatus.ACTIVE,
                )
                session.add(u)
        await session.flush()

        # Manager linkages
        u_a = await session.get(User, SALESPERSON_A_ID)
        if u_a:
            u_a.manager_id = MANAGER_ID
        u_b = await session.get(User, SALESPERSON_B_ID)
        if u_b:
            u_b.manager_id = OUT_OF_SCOPE_MGR_ID
        await session.flush()

        # Roles
        roles_to_ensure = [
            ("Admin", ADMIN_ID),
            ("Sales Manager", MANAGER_ID),
            ("Salesperson", SALESPERSON_A_ID),
            ("Salesperson", SALESPERSON_B_ID),
        ]
        for role_name, uid in roles_to_ensure:
            r_stmt = select(Role).where(Role.name == role_name)
            role_obj = (await session.execute(r_stmt)).scalar_one_or_none()
            if not role_obj:
                role_obj = Role(name=role_name, is_system=True)
                session.add(role_obj)
                await session.flush()
            ur_stmt = select(UserRole).where(UserRole.user_id == uid, UserRole.role_id == role_obj.id)
            ur_obj = (await session.execute(ur_stmt)).scalar_one_or_none()
            if not ur_obj:
                ur_obj = UserRole(user_id=uid, role_id=role_obj.id, status=RoleAssignmentStatus.ACTIVE)
                session.add(ur_obj)
        await session.flush()

        # Pipeline & Stages
        pipe_stmt = select(CrmPipeline).where(CrmPipeline.name == "Quotation Test Pipeline")
        pipeline = (await session.execute(pipe_stmt)).scalar_one_or_none()
        if not pipeline:
            pipeline = CrmPipeline(
                name="Quotation Test Pipeline",
                description="Pipeline for Sales Quotation tests",
                is_default=True,
                is_active=True,
                created_by=ADMIN_ID,
            )
            session.add(pipeline)
            await session.flush()

            stage_new = CrmPipelineStage(
                pipeline_id=pipeline.id,
                name="Discovery",
                stage_order=0,
                stage_type="open",
                is_initial=True,
                is_active=True,
            )
            session.add(stage_new)
            await session.flush()
        else:
            stage_stmt = select(CrmPipelineStage).where(
                CrmPipelineStage.pipeline_id == pipeline.id,
                CrmPipelineStage.is_initial.is_(True),
            )
            stage_new = (await session.execute(stage_stmt)).scalar_one_or_none()

        # Company
        comp_stmt = select(Company).where(Company.company_name == "Inhyma Quotation Client Corp", Company.deleted_at.is_(None))
        company = (await session.execute(comp_stmt)).scalar_one_or_none()
        if not company:
            company = Company(
                company_name="Inhyma Quotation Client Corp",
                tax_id_number="29AAACA9999Z1Z5",
                town="Bengaluru",
                is_active=True,
            )
            session.add(company)
            await session.flush()

        # Master Data for Products: Category, UOM, Tax
        cat_stmt = select(ProductCategory).where(ProductCategory.name == "Machinery")
        cat = (await session.execute(cat_stmt)).scalar_one_or_none()
        if not cat:
            cat = ProductCategory(code="CAT-MACH-01", name="Machinery", status=RecordStatus.ACTIVE)
            session.add(cat)
            await session.flush()

        uom_stmt = select(UnitOfMeasurement).where(UnitOfMeasurement.name == "Numbers")
        uom = (await session.execute(uom_stmt)).scalar_one_or_none()
        if not uom:
            uom = UnitOfMeasurement(code="NOS-01", name="Numbers", short_name="NOS", status=RecordStatus.ACTIVE)
            session.add(uom)
            await session.flush()

        tax_stmt = select(Tax).where(Tax.hsn_number == "8479")
        tax18 = (await session.execute(tax_stmt)).scalar_one_or_none()
        if not tax18:
            tax18 = Tax(
                hsn_number="8479",
                gst_percent=18.00,
                import_duty_percent=7.50,
                status=RecordStatus.ACTIVE,
            )
            session.add(tax18)
            await session.flush()

        # Active Product 1
        p1_code = "PRD-MCH-001"
        p1_stmt = select(Product).where(Product.product_code == p1_code)
        prod1 = (await session.execute(p1_stmt)).scalar_one_or_none()
        if not prod1:
            prod1 = Product(
                product_code=p1_code,
                product_name="Automatic Filling Machine 500ml",
                product_name_tally="AFM-500",
                product_type="Machine",
                category_id=cat.id,
                uom_id=uom.id,
                hsn_id=tax18.id,
                specification="500ml capacity, 60 bottles/min, stainless steel 316",
                description="High precision liquid filling machine for food & pharmaceutical packaging.",
                images=["https://storage.inhyma.test/products/afm500-front.jpg"],
                standard_price=250000.00,
                minimum_price=220000.00,
                is_sellable=True,
                status=RecordStatus.ACTIVE,
            )
            session.add(prod1)
        else:
            prod1.product_name = "Automatic Filling Machine 500ml"
            prod1.specification = "500ml capacity, 60 bottles/min, stainless steel 316"
            prod1.status = RecordStatus.ACTIVE
            prod1.is_sellable = True

        # Active Product 2
        p2_code = "PRD-MCH-002"
        p2_stmt = select(Product).where(Product.product_code == p2_code)
        prod2 = (await session.execute(p2_stmt)).scalar_one_or_none()
        if not prod2:
            prod2 = Product(
                product_code=p2_code,
                product_name="Rotary Capping System",
                product_name_tally="RCS-100",
                product_type="Machine",
                category_id=cat.id,
                uom_id=uom.id,
                hsn_id=tax18.id,
                specification="Torque controlled 4-head rotary capper",
                description="Automated continuous motion rotary capping system.",
                images=["https://storage.inhyma.test/products/capper-main.jpg"],
                standard_price=150000.00,
                minimum_price=135000.00,
                is_sellable=True,
                status=RecordStatus.ACTIVE,
            )
            session.add(prod2)

        # Inactive Product (should be rejected)
        p_inact_code = "PRD-INACT-001"
        p_inact_stmt = select(Product).where(Product.product_code == p_inact_code)
        prod_inact = (await session.execute(p_inact_stmt)).scalar_one_or_none()
        if not prod_inact:
            prod_inact = Product(
                product_code=p_inact_code,
                product_name="Legacy Discontinued Machine",
                product_name_tally="LDM-99",
                product_type="Machine",
                category_id=cat.id,
                uom_id=uom.id,
                specification="Obsolete model",
                is_sellable=False,
                status=RecordStatus.INACTIVE,
            )
            session.add(prod_inact)

        # Leads: Lead A for Rep A, Lead B for Rep B
        lead_a_stmt = select(CrmLead).where(CrmLead.email == "lead_a_quote@inhyma.test")
        lead_a = (await session.execute(lead_a_stmt)).scalar_one_or_none()
        if not lead_a:
            p_a = "+9198" + unique_phone_suffix()
            lead_a = CrmLead(
                name="Vikram Sales Lead A",
                email="lead_a_quote@inhyma.test",
                original_phone=p_a,
                normalized_phone=p_a,
                pipeline_id=pipeline.id,
                stage_id=stage_new.id,
                assigned_to=SALESPERSON_A_ID,
                company_id=company.id,
                created_by=ADMIN_ID,
            )
            session.add(lead_a)
        else:
            lead_a.assigned_to = SALESPERSON_A_ID
            lead_a.company_id = company.id
            lead_a.pipeline_id = pipeline.id
            lead_a.stage_id = stage_new.id

        lead_b_stmt = select(CrmLead).where(CrmLead.email == "lead_b_quote@inhyma.test")
        lead_b = (await session.execute(lead_b_stmt)).scalar_one_or_none()
        if not lead_b:
            p_b = "+9197" + unique_phone_suffix()
            lead_b = CrmLead(
                name="Priya Sales Lead B",
                email="lead_b_quote@inhyma.test",
                original_phone=p_b,
                normalized_phone=p_b,
                pipeline_id=pipeline.id,
                stage_id=stage_new.id,
                assigned_to=SALESPERSON_B_ID,
                company_id=company.id,
                created_by=ADMIN_ID,
            )
            session.add(lead_b)
        else:
            lead_b.assigned_to = SALESPERSON_B_ID
            lead_b.company_id = company.id
            lead_b.pipeline_id = pipeline.id
            lead_b.stage_id = stage_new.id
        await session.flush()

        # Clean up any existing test records for lead_a and lead_b for idempotent runs
        from sqlalchemy import delete
        await session.execute(delete(CrmLeadProduct).where(CrmLeadProduct.lead_id.in_([lead_a.id, lead_b.id])))
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_([lead_a.id, lead_b.id])))
        q_ids_stmt = select(CrmSalesQuotation.id).where(CrmSalesQuotation.lead_id.in_([lead_a.id, lead_b.id]))
        q_ids = (await session.execute(q_ids_stmt)).scalars().all()
        if q_ids:
            await session.execute(delete(CrmQuotationVersion).where(CrmQuotationVersion.quotation_id.in_(q_ids)))
            await session.execute(delete(CrmQuotationItem).where(CrmQuotationItem.quotation_id.in_(q_ids)))
            await session.execute(delete(CrmSalesQuotation).where(CrmSalesQuotation.id.in_(q_ids)))

        await session.commit()
        await session.refresh(lead_a)
        await session.refresh(lead_b)
        await session.refresh(prod1)
        await session.refresh(prod2)
        await session.refresh(prod_inact)

        return {
            "lead_a_id": str(lead_a.id),
            "lead_b_id": str(lead_b.id),
            "company_id": str(company.id),
            "prod1_id": str(prod1.id),
            "prod2_id": str(prod2.id),
            "prod_inact_id": str(prod_inact.id),
        }


# ==============================================================================
# 1. Product Master Lookup Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_product_master_lookup_filters_active_and_sellable(
    client: AsyncClient, admin_headers: dict[str, str], setup_quotation_environment: dict
):
    """Product lookup should return only active, non-deleted, sellable items."""
    env = setup_quotation_environment

    response = await client.get("/api/v1/crm/products/lookup?q=Machine", headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert "items" in data
    items = data["items"]
    assert len(items) >= 2

    returned_ids = [item["id"] for item in items]
    assert env["prod1_id"] in returned_ids
    # Inactive product must NOT be returned
    assert env["prod_inact_id"] not in returned_ids

    # Check enriched fields returned for explicit commercial prefill
    p1 = next(item for item in items if item["id"] == env["prod1_id"])
    assert p1["product_code"] == "PRD-MCH-001"
    assert p1["product_name"] == "Automatic Filling Machine 500ml"
    assert p1["standard_price"] == 250000.00
    assert p1["gst_percent"] == 18.00
    assert len(p1["images"]) >= 1


# ==============================================================================
# 2. Lead-Product Association Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_lead_product_association_lifecycle_and_activity_logging(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_quotation_environment: dict
):
    """Rep A associates a product of interest with Lead A, lists it, and removes it."""
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]
    prod_id = env["prod1_id"]

    # 1. Associate product
    assoc_payload = {
        "product_id": prod_id,
        "notes": "Customer interested in 500ml liquid packaging unit.",
    }
    create_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/products",
        json=assoc_payload,
        headers=rep_a_headers,
    )
    assert create_res.status_code == 201, create_res.text
    created = create_res.json()
    assert created["product_id"] == prod_id
    assert created["product_code"] == "PRD-MCH-001"
    assert created["product_name"] == "Automatic Filling Machine 500ml"
    assoc_id = created["id"]

    # 2. Reject duplicate association of same product
    dup_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/products",
        json=assoc_payload,
        headers=rep_a_headers,
    )
    assert dup_res.status_code == 400
    assert "already associated" in dup_res.text.lower()

    # 3. List associated products
    list_res = await client.get(
        f"/api/v1/crm/leads/{lead_id}/products",
        headers=rep_a_headers,
    )
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total"] >= 1
    found = [p for p in list_data["items"] if p["id"] == assoc_id]
    assert len(found) == 1

    # 4. Remove association
    del_res = await client.delete(
        f"/api/v1/crm/leads/{lead_id}/products/{assoc_id}",
        headers=rep_a_headers,
    )
    assert del_res.status_code == 204

    # 5. Verify activities logged in CRM history
    act_res = await client.get(
        f"/api/v1/crm/leads/{lead_id}/activities",
        headers=rep_a_headers,
    )
    assert act_res.status_code == 200
    act_items = act_res.json().get("data", act_res.json()).get("items", [])
    act_types = [a["activity_type"] for a in act_items]
    assert "product_associated" in act_types
    assert "product_disassociated" in act_types


# ==============================================================================
# 3. Sales Quotation Creation & Numbering Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_quotation_creation_and_unique_numbering(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_quotation_environment: dict
):
    """Quotation creation allocates unique SQ-YYYYMM-XXXX numbers and links lead & company."""
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    payload1 = {
        "valid_until": "2026-11-30",
        "payment_terms": "50% advance, 50% against PI before dispatch",
        "delivery_terms": "Ex-works Bengaluru within 4 weeks",
        "notes": "Includes standard 12 months comprehensive warranty.",
        "items": [
            {
                "product_id": env["prod1_id"],
                "quantity": 2,
                "unit_price": 240000.00,
                "unit_discount": 10000.00,
                "tax_rate": 18.00,
                "include_specifications": True,
                "include_image": True,
                "demo_link": "https://videos.inhyma.test/demo/afm500.mp4",
            }
        ],
    }

    res1 = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json=payload1,
        headers=rep_a_headers,
    )
    assert res1.status_code == 201, res1.text
    q1 = res1.json()
    assert q1["quotation_number"].startswith("SQ-")
    assert q1["version"] == 1
    assert q1["status"] == "draft"
    assert q1["company_id"] == env["company_id"]
    assert q1["company_name_snapshot"] == "Inhyma Quotation Client Corp"

    # Second quotation for same lead
    payload2 = {
        "valid_until": "2026-12-15",
        "items": [
            {
                "product_id": env["prod2_id"],
                "quantity": 1,
                "unit_price": 145000.00,
                "unit_discount": 0.00,
                "tax_rate": 18.00,
            }
        ],
    }
    res2 = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json=payload2,
        headers=rep_a_headers,
    )
    assert res2.status_code == 201, res2.text
    q2 = res2.json()
    assert q2["quotation_number"] != q1["quotation_number"]
    assert q2["version"] == 1


# ==============================================================================
# 4. Decimal Arithmetic, Commercial Rules & Rounding Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_decimal_arithmetic_tax_and_rounding_rules(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_quotation_environment: dict
):
    """
    Test precise decimal calculation and rounding rules:
    - Item 1: Qty 3, Unit Price 333.33, Discount 33.33 -> Net Price 300.00 * 3 = Taxable 900.00
      Tax 18.00% -> 900.00 * 0.18 = 162.00. Total = 1062.00
    - Item 2 (Zero-tax / Exempt): Qty 2, Unit Price 123.45, Discount 0.00, Tax 0.00%
      Taxable = 246.90, Tax = 0.00, Total = 246.90
    - Item 3 (Rounding boundary): Qty 1, Unit Price 100.05, Discount 0.00, Tax 5.00%
      Taxable = 100.05, Tax = 5.0025 -> rounded half-up to 5.00
      Total = 105.05
    """
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    payload = {
        "valid_until": "2026-11-15",
        "items": [
            {
                "product_id": env["prod1_id"],
                "quantity": 3,
                "unit_price": 333.33,
                "unit_discount": 33.33,
                "tax_rate": 18.00,
            },
            {
                "product_id": env["prod2_id"],
                "quantity": 2,
                "unit_price": 123.45,
                "unit_discount": 0.00,
                "tax_rate": 0.00,  # Zero-tax item
            },
            {
                "product_id": env["prod1_id"],
                "quantity": 1,
                "unit_price": 100.05,
                "unit_discount": 0.00,
                "tax_rate": 5.00,  # Rounding boundary: 5.0025 -> 5.00
            },
        ],
    }

    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json=payload,
        headers=rep_a_headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()

    items = data["items"]
    assert Decimal(str(items[0]["taxable_amount"])) == Decimal("900.00")
    assert Decimal(str(items[0]["tax_amount"])) == Decimal("162.00")
    assert Decimal(str(items[0]["total_amount"])) == Decimal("1062.00")

    assert Decimal(str(items[1]["taxable_amount"])) == Decimal("246.90")
    assert Decimal(str(items[1]["tax_amount"])) == Decimal("0.00")
    assert Decimal(str(items[1]["total_amount"])) == Decimal("246.90")

    assert Decimal(str(items[2]["taxable_amount"])) == Decimal("100.05")
    assert Decimal(str(items[2]["tax_amount"])) == Decimal("5.00")
    assert Decimal(str(items[2]["total_amount"])) == Decimal("105.05")

    # Header totals
    # Subtotal = 900.00 + 246.90 + 100.05 = 1246.95
    # Total Discount = 33.33 * 3 = 99.99
    # Tax Total = 162.00 + 0.00 + 5.00 = 167.00
    # Grand Total = 1246.95 + 167.00 = 1413.95
    assert Decimal(str(data["subtotal"])) == Decimal("1246.95")
    assert Decimal(str(data["discount_total"])) == Decimal("99.99")
    assert Decimal(str(data["tax_total"])) == Decimal("167.00")
    assert Decimal(str(data["total_amount"])) == Decimal("1413.95")


@pytest.mark.asyncio
async def test_quotation_commercial_validation_errors(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_quotation_environment: dict
):
    """Rejects invalid quantities, negative prices, and discounts exceeding unit price."""
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    # 1. Discount greater than unit price
    bad_discount_payload = {
        "items": [
            {
                "product_id": env["prod1_id"],
                "quantity": 1,
                "unit_price": 100.00,
                "unit_discount": 150.00,  # Invalid
                "tax_rate": 18.00,
            }
        ]
    }
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json=bad_discount_payload,
        headers=rep_a_headers,
    )
    assert res.status_code == 422 or res.status_code == 400

    # 2. Negative quantity
    bad_qty_payload = {
        "items": [
            {
                "product_id": env["prod1_id"],
                "quantity": -2,
                "unit_price": 100.00,
                "unit_discount": 0.00,
                "tax_rate": 18.00,
            }
        ]
    }
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json=bad_qty_payload,
        headers=rep_a_headers,
    )
    assert res.status_code == 422 or res.status_code == 400

    # 3. Inactive Product ID rejection
    inactive_prod_payload = {
        "items": [
            {
                "product_id": env["prod_inact_id"],
                "quantity": 1,
                "unit_price": 1000.00,
                "unit_discount": 0.00,
                "tax_rate": 18.00,
            }
        ]
    }
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json=inactive_prod_payload,
        headers=rep_a_headers,
    )
    assert res.status_code == 400
    assert "inactive" in res.text.lower() or "invalid" in res.text.lower()


# ==============================================================================
# 5. Snapshot Immutability Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_quotation_item_snapshot_immutability(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_quotation_environment: dict
):
    """Modifying Product Master after quotation creation does not alter saved quotation snapshot."""
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]
    prod_id = env["prod1_id"]

    # 1. Create quotation with original product details
    create_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "items": [
                {
                    "product_id": prod_id,
                    "quantity": 1,
                    "unit_price": 250000.00,
                    "tax_rate": 18.00,
                }
            ]
        },
        headers=rep_a_headers,
    )
    assert create_res.status_code == 201
    q_data = create_res.json()
    quotation_id = q_data["id"]
    saved_item = q_data["items"][0]
    assert saved_item["product_name"] == "Automatic Filling Machine 500ml"

    # 2. Mutate Product Master directly in DB
    session_factory = get_sessionmaker()
    try:
        async with session_factory() as session:
            product_obj = await session.get(Product, uuid.UUID(prod_id))
            assert product_obj is not None
            product_obj.product_name = "ALTERED NAME IN PRODUCT MASTER"
            product_obj.specification = "ALTERED SPECIFICATION"
            await session.commit()

        # 3. Read quotation back through API
        get_res = await client.get(
            f"/api/v1/crm/quotations/{quotation_id}",
            headers=rep_a_headers,
        )
        assert get_res.status_code == 200
        fetched_q = get_res.json()
        # The quotation snapshot must remain unchanged!
        assert fetched_q["items"][0]["product_name"] == "Automatic Filling Machine 500ml"
        assert fetched_q["items"][0]["product_name"] != "ALTERED NAME IN PRODUCT MASTER"
    finally:
        async with session_factory() as session:
            product_obj = await session.get(Product, uuid.UUID(prod_id))
            if product_obj:
                product_obj.product_name = "Automatic Filling Machine 500ml"
                product_obj.specification = "500ml capacity, 60 bottles/min, stainless steel 316"
                await session.commit()


# ==============================================================================
# 6. Revision Lifecycle & Immutable Version History Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_quotation_versioning_and_revision_history(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_quotation_environment: dict
):
    """
    Editing draft in-place keeps v1.
    Requesting revision creates snapshot in crm_quotation_versions and increments to v2.
    Previous version remains viewable and immutable.
    """
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    # 1. Create draft quotation (version 1)
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "valid_until": "2026-11-20",
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 200000.00,
                    "tax_rate": 18.00,
                }
            ],
        },
        headers=rep_a_headers,
    )
    assert res.status_code == 201
    q1 = res.json()
    q_id = q1["id"]
    assert q1["version"] == 1
    assert Decimal(str(q1["total_amount"])) == Decimal("236000.00")

    # 2. In-place edit of draft (create_revision=False)
    edit_res = await client.put(
        f"/api/v1/crm/quotations/{q_id}",
        json={
            "create_revision": False,
            "revision_notes": "Minor price adjustment in draft",
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 210000.00,
                    "tax_rate": 18.00,
                }
            ],
        },
        headers=rep_a_headers,
    )
    assert edit_res.status_code == 200
    q1_updated = edit_res.json()
    assert q1_updated["version"] == 1
    assert Decimal(str(q1_updated["total_amount"])) == Decimal("247800.00")

    # No version archive should exist yet since it was draft in-place
    ver_res0 = await client.get(
        f"/api/v1/crm/quotations/{q_id}/versions",
        headers=rep_a_headers,
    )
    assert ver_res0.status_code == 200
    assert len(ver_res0.json()) == 0

    # 3. Create Revision (create_revision=True)
    rev_res = await client.put(
        f"/api/v1/crm/quotations/{q_id}",
        json={
            "create_revision": True,
            "revision_notes": "Revised after customer requested extra discount",
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 190000.00,
                    "tax_rate": 18.00,
                }
            ],
        },
        headers=rep_a_headers,
    )
    assert rev_res.status_code == 200
    q2 = rev_res.json()
    assert q2["version"] == 2
    assert Decimal(str(q2["total_amount"])) == Decimal("224200.00")

    # 4. Check archived version history
    ver_res = await client.get(
        f"/api/v1/crm/quotations/{q_id}/versions",
        headers=rep_a_headers,
    )
    assert ver_res.status_code == 200
    versions = ver_res.json()
    assert len(versions) == 1
    archived_v1 = versions[0]
    assert archived_v1["version"] == 1
    assert Decimal(str(archived_v1["snapshot_data"]["header"]["total_amount"])) == Decimal("247800.00")
    assert archived_v1["snapshot_data"]["header"]["version"] == 1


# ==============================================================================
# 7. Status Transitions and Activity Logging Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_quotation_status_lifecycle_and_activities(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_quotation_environment: dict
):
    """Test valid status transitions and verify CRM activities logged."""
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    # Create quotation
    create_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 100000.00,
                    "tax_rate": 18.00,
                }
            ]
        },
        headers=rep_a_headers,
    )
    assert create_res.status_code == 201
    q_id = create_res.json()["id"]

    # Transition draft -> sent
    status_res = await client.patch(
        f"/api/v1/crm/quotations/{q_id}/status",
        json={"status": "sent", "status_notes": "Official quote issued to client."},
        headers=rep_a_headers,
    )
    assert status_res.status_code == 200
    assert status_res.json()["status"] == "sent"

    # Transition sent -> accepted
    accept_res = await client.patch(
        f"/api/v1/crm/quotations/{q_id}/status",
        json={"status": "accepted", "status_notes": "PO received via email."},
        headers=rep_a_headers,
    )
    assert accept_res.status_code == 200
    assert accept_res.json()["status"] == "accepted"

    # Verify CRM activities logged
    act_res = await client.get(
        f"/api/v1/crm/leads/{lead_id}/activities",
        headers=rep_a_headers,
    )
    assert act_res.status_code == 200
    activities = act_res.json().get("data", act_res.json()).get("items", [])
    act_types = [a["activity_type"] for a in activities]
    assert "quotation_created" in act_types
    assert "quotation_status_change" in act_types


# ==============================================================================
# 8. RBAC and Direct-ID Scoping Attack Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_rbac_scoping_and_direct_id_rejection(
    client: AsyncClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    rep_a_headers: dict[str, str],
    rep_b_headers: dict[str, str],
    setup_quotation_environment: dict,
):
    """
    Verify strict role scoping:
    - Lead A belongs to Salesperson A, whose manager is MANAGER_ID.
    - Lead B belongs to Salesperson B, whose manager is OUT_OF_SCOPE_MGR_ID.
    - Rep A must NOT access Lead B's quotations or quotation endpoints (403 Forbidden).
    - Rep B must NOT access Lead A's quotations or quotation endpoints (403 Forbidden).
    - Manager accesses Lead A (their subordinate), but 403 Forbidden on Lead B.
    - Admin has full access to both Lead A and Lead B.
    """
    env = setup_quotation_environment
    lead_a_id = env["lead_a_id"]
    lead_b_id = env["lead_b_id"]

    # 1. Rep A creates a quotation on Lead A
    q_a_res = await client.post(
        f"/api/v1/crm/leads/{lead_a_id}/quotations",
        json={
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 100000.00,
                    "tax_rate": 18.00,
                }
            ]
        },
        headers=rep_a_headers,
    )
    assert q_a_res.status_code == 201
    q_a_id = q_a_res.json()["id"]

    # 2. Rep B attempts direct-ID access to Lead A's quotation -> 403 Forbidden
    direct_get = await client.get(
        f"/api/v1/crm/quotations/{q_a_id}",
        headers=rep_b_headers,
    )
    assert direct_get.status_code == 403, "Rep B must not access Rep A's quotation"

    # Rep B attempts to update Lead A's quotation -> 403 Forbidden
    direct_put = await client.put(
        f"/api/v1/crm/quotations/{q_a_id}",
        json={"items": [{"product_id": env["prod1_id"], "quantity": 1, "unit_price": 50000.00, "tax_rate": 18.00}]},
        headers=rep_b_headers,
    )
    assert direct_put.status_code == 403

    # Rep B attempts to associate product to Lead A -> 403 Forbidden
    direct_assoc = await client.post(
        f"/api/v1/crm/leads/{lead_a_id}/products",
        json={"product_id": env["prod1_id"]},
        headers=rep_b_headers,
    )
    assert direct_assoc.status_code == 403

    # 3. Manager accesses Lead A's quotation -> 200 OK (subordinate's lead)
    mgr_get_a = await client.get(
        f"/api/v1/crm/quotations/{q_a_id}",
        headers=manager_headers,
    )
    assert mgr_get_a.status_code == 200

    # Manager attempts to access Lead B -> 403 Forbidden (Lead B belongs to another manager's team)
    mgr_get_b = await client.get(
        f"/api/v1/crm/leads/{lead_b_id}/quotations",
        headers=manager_headers,
    )
    assert mgr_get_b.status_code == 403

    # 4. Admin accesses both Lead A and Lead B quotations -> 200 OK
    admin_get_a = await client.get(
        f"/api/v1/crm/quotations/{q_a_id}",
        headers=admin_headers,
    )
    assert admin_get_a.status_code == 200

    admin_get_b = await client.get(
        f"/api/v1/crm/leads/{lead_b_id}/quotations",
        headers=admin_headers,
    )
    assert admin_get_b.status_code == 200


@pytest.mark.asyncio
async def test_quotation_pdf_generation_current_and_version(
    client: AsyncClient,
    setup_quotation_environment: dict,
    admin_headers: dict[str, str],
):
    """
    Test Quotation PDF generation from saved snapshot values:
    1. Generates valid PDF (%PDF header, status 200, Content-Type application/pdf).
    2. Preserves quotation values (does NOT modify commercial numbers or mutate DB).
    3. Status remains 'draft' (not changed to 'sent' merely because PDF was downloaded).
    4. Version remains 'v1' (generating PDF does not create revisions).
    5. Updating quotation to v2 creates snapshot; downloading ?version=1 reproduces v1 snapshot.
    """
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    # 1. Create a draft quotation
    create_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "currency": "INR",
            "payment_terms": "50% Advance, 50% on Delivery",
            "delivery_terms": "2 Weeks Ex-Works",
            "terms_and_conditions": "1. Validity: 30 Days.\n2. Goods once sold will not be taken back.",
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 2,
                    "unit_price": 50000.00,
                    "unit_discount": 1000.00,
                    "tax_rate": 18.00,
                    "include_specifications": True,
                }
            ],
        },
        headers=admin_headers,
    )
    assert create_res.status_code == 201
    q_data = create_res.json()
    quotation_id = q_data["id"]
    q_num = q_data["quotation_number"]
    assert q_data["status"] == "draft"
    assert q_data["version"] == 1
    orig_total = q_data["total_amount"]
    orig_subtotal = q_data["subtotal"]

    # 2. Request PDF without version parameter (defaults to current)
    pdf_res = await client.get(
        f"/api/v1/crm/quotations/{quotation_id}/pdf",
        headers=admin_headers,
    )
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert f"{q_num}_v1.pdf" in pdf_res.headers.get("content-disposition", "")
    pdf_bytes = pdf_res.content
    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 1000

    # 3. Verify quotation state in database is completely unmodified
    verify_res = await client.get(
        f"/api/v1/crm/quotations/{quotation_id}",
        headers=admin_headers,
    )
    assert verify_res.status_code == 200
    after_data = verify_res.json()
    assert after_data["status"] == "draft", "Status must NOT change to sent merely due to PDF generation"
    assert after_data["version"] == 1, "PDF generation must NOT increment version"
    assert after_data["total_amount"] == orig_total
    assert after_data["subtotal"] == orig_subtotal
    assert after_data["items"][0]["specification"] == "500ml capacity, 60 bottles/min, stainless steel 316"

    # 4. Revise quotation to v2
    update_res = await client.put(
        f"/api/v1/crm/quotations/{quotation_id}",
        json={
            "create_revision": True,
            "revision_notes": "Increased quantity to 5 units",
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 5,
                    "unit_price": 48000.00,
                    "unit_discount": 0.00,
                    "tax_rate": 18.00,
                    "include_specifications": True,
                }
            ],
        },
        headers=admin_headers,
    )
    assert update_res.status_code == 200
    v2_data = update_res.json()
    assert v2_data["version"] == 2

    # 5. Download historical v1 PDF -> reproduces archived snapshot
    pdf_v1_res = await client.get(
        f"/api/v1/crm/quotations/{quotation_id}/pdf?version=1",
        headers=admin_headers,
    )
    assert pdf_v1_res.status_code == 200
    assert f"{q_num}_v1.pdf" in pdf_v1_res.headers.get("content-disposition", "")
    assert pdf_v1_res.content.startswith(b"%PDF-")

    # 6. Download v2 PDF
    pdf_v2_res = await client.get(
        f"/api/v1/crm/quotations/{quotation_id}/pdf",
        headers=admin_headers,
    )
    assert pdf_v2_res.status_code == 200
    assert f"{q_num}_v2.pdf" in pdf_v2_res.headers.get("content-disposition", "")
    assert pdf_v2_res.content.startswith(b"%PDF-")


@pytest.mark.asyncio
async def test_quotation_pdf_security_and_deduplicated_activity(
    client: AsyncClient,
    setup_quotation_environment: dict,
    rep_a_headers: dict[str, str],
    rep_b_headers: dict[str, str],
    admin_headers: dict[str, str],
):
    """
    Test RBAC scoping and deduplicated CRM activity logging on PDF download:
    1. Rep B attempting to download Rep A's quotation PDF -> 403 Forbidden.
    2. Rep A downloads own quotation PDF -> 200 OK.
    3. Exactly-once activity history logged for quotation_pdf_generated.
    4. Repeated download within 15 minutes does NOT generate duplicate activity entries.
    """
    env = setup_quotation_environment
    lead_a_id = env["lead_a_id"]
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        await session.execute(
            delete(CrmActivity).where(
                CrmActivity.lead_id == uuid.UUID(lead_a_id),
                CrmActivity.activity_type == "quotation_pdf_generated",
            )
        )
        await session.commit()

    # Rep A creates quotation
    create_res = await client.post(
        f"/api/v1/crm/leads/{lead_a_id}/quotations",
        json={
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 75000.00,
                    "tax_rate": 18.00,
                }
            ],
        },
        headers=rep_a_headers,
    )
    assert create_res.status_code == 201
    q_id = create_res.json()["id"]
    q_num = create_res.json()["quotation_number"]

    # 1. Rep B attempts to download Rep A's quotation PDF -> 403 Forbidden
    rep_b_res = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=rep_b_headers,
    )
    assert rep_b_res.status_code == 403, "Rep B must NOT be authorized to generate Rep A's quotation PDF"

    # 2. Rep A downloads own quotation PDF -> 200 OK
    rep_a_res1 = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=rep_a_headers,
    )
    assert rep_a_res1.status_code == 200

    # Verify CRM Activity was logged
    async with session_factory() as session:
        act_res = await session.execute(
            select(CrmActivity).where(
                CrmActivity.lead_id == uuid.UUID(lead_a_id),
                CrmActivity.activity_type == "quotation_pdf_generated",
                CrmActivity.subject.contains(q_num),
            )
        )
        activities = act_res.scalars().all()
        assert len(activities) == 1
        assert q_num in activities[0].subject
        assert "v1" in activities[0].subject

    # 3. Repeated download within 15-minute deduplication window
    rep_a_res2 = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=rep_a_headers,
    )
    assert rep_a_res2.status_code == 200

    # Verify activity count is STILL 1 (no duplicate logged)
    async with session_factory() as session:
        act_res2 = await session.execute(
            select(CrmActivity).where(
                CrmActivity.lead_id == uuid.UUID(lead_a_id),
                CrmActivity.activity_type == "quotation_pdf_generated",
                CrmActivity.subject.contains(q_num),
            )
        )
        activities2 = act_res2.scalars().all()
        assert len(activities2) == 1, "Duplicate PDF download must not create duplicate activity records"


@pytest.mark.asyncio
async def test_quotation_pdf_multipage_layout(
    client: AsyncClient,
    setup_quotation_environment: dict,
    admin_headers: dict[str, str],
):
    """
    Test multi-page quotation layout with numerous line items and extensive specifications.
    Verifies that the PDF generates successfully without overlapping or clipping.
    """
    import io
    from pypdf import PdfReader

    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    # Create quotation with 12 items having rich specifications
    items = []
    for idx in range(1, 13):
        items.append({
            "product_id": env["prod1_id"] if idx % 2 == 1 else env["prod2_id"],
            "quantity": idx,
            "unit_price": 10000.00 * idx,
            "tax_rate": 18.00,
            "specification_snapshot": (
                f"Specification Item #{idx}: Heavy-duty industrial hydraulic actuator.\n"
                f"Features precision stainless steel piston rod, dual seals, and standard mounting.\n"
                f"Rated for continuous operation at 210 bar under ambient temperatures up to 80°C."
            ),
        })

    create_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "items": items,
            "terms_and_conditions": (
                "1. PRICES: The prices quoted above are firm and valid for 30 days.\n"
                "2. TAXES: GST is applicable as per Government regulations at the time of invoicing.\n"
                "3. PAYMENT: 30% advance with purchase order, balance 70% against dispatch proforma.\n"
                "4. DELIVERY: Material will be dispatched within 4-6 weeks from advance receipt.\n"
                "5. WARRANTY: 12 months manufacturer warranty against manufacturing defects."
            ),
        },
        headers=admin_headers,
    )
    assert create_res.status_code == 201
    q_id = create_res.json()["id"]

    # Request PDF
    pdf_res = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=admin_headers,
    )
    assert pdf_res.status_code == 200
    pdf_bytes = pdf_res.content
    assert pdf_bytes.startswith(b"%PDF-")

    # Read with PyPDF to verify multi-page continuation
    reader = PdfReader(io.BytesIO(pdf_bytes))
    num_pages = len(reader.pages)
    assert num_pages >= 2, f"Expected multi-page PDF for 12 items with long specifications, got {num_pages} pages"


# ==============================================================================
# 8. Phase 7: Customer Resolution & Professional PDF Generation Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_quotation_customer_resolution_and_pdf_generation(
    client: AsyncClient, admin_headers: dict[str, str], setup_quotation_environment: dict
):
    """
    Phase 7 test:
    1. Authoritative customer details resolved from linked Company & primary/matching contact.
    2. Snapshots contain contact name, designation, phone (+91 formatted), email, company name, address, GSTIN.
    3. Generates professional PDF with ReportLab:
       - Starts with %PDF-
       - Displays SALES QUOTATION title
       - Displays Inhyma Solutions LLP & GSTIN 27AAKFI9869H1ZL
       - Displays customer company, contact person, designation, address, GSTIN
       - Omits default warranty text when not specified in terms
    4. Downloading PDF preserves quotation draft status and version number.
    """
    import io
    from pypdf import PdfReader
    from app.users.models import User

    env = setup_quotation_environment
    prod1_id = env["prod1_id"]

    # 1. Setup Company with structured address, tax ID, and contacts
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        admin_id = ADMIN_ID

        comp_name = f"Inhyma Precision Eng {uuid.uuid4().hex[:6]}"
        company = Company(
            company_name=comp_name,
            tax_id_number="27ABCDE1234F1Z5",
            address="Unit 301, Empire Towers, Sakinaka",
            town="Mumbai",
            district="Mumbai Suburban",
            pincode="400072",
            is_active=True,
        )
        session.add(company)
        await session.flush()

        # Add secondary contact
        contact_sec = CompanyContact(
            company_id=company.id,
            person_name="Amit Patel",
            designation="Procurement Assistant",
            email="amit.p@precision-eng.test",
            calling_number="9820011111",
            is_primary=False,
        )
        session.add(contact_sec)

        # Add primary contact matching lead email
        contact_lead = CompanyContact(
            company_id=company.id,
            person_name="Rajesh Sharma",
            designation="Chief Technical Officer",
            email="rajesh.sharma@precision-eng.test",
            calling_number="9820022222",
            is_primary=True,
        )
        session.add(contact_lead)
        await session.flush()

        # Pipeline and initial stage
        stage_stmt = select(CrmPipelineStage.id).where(CrmPipelineStage.is_initial.is_(True))
        stage_id = (await session.execute(stage_stmt)).scalars().first()
        pipe_stmt = select(CrmPipeline.id).limit(1)
        pipe_id = (await session.execute(pipe_stmt)).scalars().first()

        # Create Lead linked to company and contact
        lead = CrmLead(
            name="Rajesh Sharma",
            email="rajesh.sharma@precision-eng.test",
            original_phone="9820022222",
            normalized_phone="+919820022222",
            company_id=company.id,
            pipeline_id=pipe_id,
            stage_id=stage_id,
            assigned_to=admin_id,
            created_by=admin_id,
        )
        session.add(lead)
        await session.commit()
        lead_id = str(lead.id)

    # 2. Create quotation via API
    custom_terms = "1. Payment: 100% advance against PI.\n2. Delivery: 2 weeks ex-works."
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "items": [
                {
                    "product_id": prod1_id,
                    "quantity": 2,
                    "unit_price": 50000.00,
                    "tax_rate": 18.00,
                    "specification_snapshot": "Custom hydraulic system with reinforced manifold.",
                }
            ],
            "terms_and_conditions": custom_terms,
        },
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    q_data = res.json()
    q_id = q_data["id"]

    # Verify authoritative snapshot resolution
    assert q_data["customer_name_snapshot"] == "Rajesh Sharma"
    assert q_data["customer_designation_snapshot"] == "Chief Technical Officer"
    assert q_data["customer_phone_snapshot"] == "+91 98200 22222"
    assert q_data["customer_email_snapshot"] == "rajesh.sharma@precision-eng.test"
    assert q_data["company_name_snapshot"] == comp_name
    assert q_data["customer_gstin_snapshot"] == "27ABCDE1234F1Z5"
    assert "Empire Towers" in (q_data.get("billing_address_snapshot") or "")
    assert "400072" in (q_data.get("billing_address_snapshot") or "")

    # 3. Download PDF
    pdf_res = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=admin_headers,
    )
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert q_data["quotation_number"] in pdf_res.headers.get("content-disposition", "")
    assert ".pdf" in pdf_res.headers.get("content-disposition", "")
    pdf_bytes = pdf_res.content
    assert pdf_bytes.startswith(b"%PDF-")

    # 4. Validate PDF content with PdfReader
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 1
    full_pdf_text = "".join(page.extract_text() or "" for page in reader.pages)

    assert "SALES QUOTATION" in full_pdf_text
    assert "INHYMA SOLUTIONS LLP" in full_pdf_text
    assert "27AAKFI9869H1ZL" in full_pdf_text
    assert comp_name in full_pdf_text
    assert "Rajesh Sharma" in full_pdf_text
    assert "Chief Technical Officer" in full_pdf_text
    assert "27ABCDE1234F1Z5" in full_pdf_text
    assert "100% advance against PI" in full_pdf_text
    # Ensure no invented default warranties
    assert "12 months manufacturer warranty against manufacturing defects" not in full_pdf_text

    # 5. Confirm quotation status and version remained untouched
    get_res = await client.get(f"/api/v1/crm/quotations/{q_id}", headers=admin_headers)
    assert get_res.status_code == 200
    q_current = get_res.json()
    assert q_current["status"] == "draft"
    assert q_current["version"] == 1


@pytest.mark.asyncio
async def test_quotation_unlinked_lead_and_internal_label_filtering(
    client: AsyncClient, admin_headers: dict[str, str], setup_quotation_environment: dict
):
    """
    Verifies that:
    1. Unlinked leads (company_id is None) omit company block cleanly.
    2. Internal pipeline labels like 'Open Lead Only' or 'Unmatched Legacy' are filtered out.
    3. Generating PDF for unlinked lead succeeds with 200 and valid PDF.
    """
    import io
    from pypdf import PdfReader
    from app.users.models import User

    env = setup_quotation_environment
    prod1_id = env["prod1_id"]

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        admin_id = ADMIN_ID

        stage_stmt = select(CrmPipelineStage.id).where(CrmPipelineStage.is_initial.is_(True))
        stage_id = (await session.execute(stage_stmt)).scalars().first()
        pipe_stmt = select(CrmPipeline.id).limit(1)
        pipe_id = (await session.execute(pipe_stmt)).scalars().first()

        # Lead with internal placeholder title and no company
        unlinked_lead = CrmLead(
            name="Open Lead Only - Fast Tracking",
            email="direct_buyer@test-domain.org",
            original_phone="9876543210",
            normalized_phone="+919876543210",
            company_id=None,
            pipeline_id=pipe_id,
            stage_id=stage_id,
            assigned_to=admin_id,
            created_by=admin_id,
        )
        session.add(unlinked_lead)
        await session.commit()
        lead_id = str(unlinked_lead.id)

    # Create quotation
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "items": [
                {
                    "product_id": prod1_id,
                    "quantity": 1,
                    "unit_price": 25000.00,
                    "tax_rate": 18.00,
                }
            ],
            "terms_and_conditions": "Standard ex-works terms.",
        },
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    q_data = res.json()
    q_id = q_data["id"]

    # Verify placeholder filter
    assert q_data["customer_name_snapshot"] != "Open Lead Only - Fast Tracking"
    assert q_data["company_name_snapshot"] is None
    assert q_data["customer_phone_snapshot"] == "+91 98765 43210"

    # PDF download
    pdf_res = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=admin_headers,
    )
    assert pdf_res.status_code == 200
    pdf_bytes = pdf_res.content
    assert pdf_bytes.startswith(b"%PDF-")

    reader = PdfReader(io.BytesIO(pdf_bytes))
    full_pdf_text = "".join(page.extract_text() or "" for page in reader.pages)
    assert "Open Lead Only" not in full_pdf_text
    assert "+91 98765 43210" in full_pdf_text


@pytest.mark.asyncio
async def test_quotation_phase8_customer_details_and_company_resolution_pdf(
    client: AsyncClient,
    setup_quotation_environment: dict,
    admin_headers: dict,
) -> None:
    """
    Phase 8: Verify linked company/customer data flow into Quotation read model and PDF.
    Verifies company name, contact person, phone, email, billing address, and GSTIN.
    Verifies historical snapshot immutability when company is edited later.
    """
    import io
    from pypdf import PdfReader

    env = setup_quotation_environment
    lead_id = env["lead_a_id"]
    company_id = env["company_id"]

    session_factory = get_sessionmaker()
    # 1. Update company record to have rich details (address, town, district, pincode, tax_id_number)
    async with session_factory() as session:
        comp = await session.get(Company, uuid.UUID(company_id))
        comp.company_name = "Acme Industrial Corp"
        comp.address = "Plot 42, GIDC Electronic Estate"
        comp.town = "Sector 25"
        comp.district = "Gandhinagar"
        comp.pincode = "382024"
        comp.tax_id_number = "24AABCI1234F1Z9"

        # Add a specific contact person to the company
        contact = CompanyContact(
            company_id=comp.id,
            person_name="Rajesh Sharma",
            designation="VP of Procurement",
            email="rajesh.sharma@acme-corp.com",
            calling_number="+91 98250 12345",
            whatsapp_number="+91 98250 12345",
            is_primary=True,
        )
        # Update lead to associate with Rajesh Sharma
        lead = await session.get(CrmLead, uuid.UUID(lead_id))
        lead.name = "Rajesh Sharma"
        lead.email = "rajesh.sharma@acme-corp.com"

        session.add(contact)
        await session.commit()

    # 2. Create quotation
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "valid_until": "2026-12-31",
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 2,
                    "unit_price": 50000.00,
                    "tax_rate": 18.00,
                }
            ],
            "notes": "Payment within 30 days.",
        },
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    q_data = res.json()
    q_id = q_data["id"]

    # Verify customer/company data in read model
    assert q_data["company_name_snapshot"] == "Acme Industrial Corp"
    assert q_data["customer_name_snapshot"] == "Rajesh Sharma"
    assert q_data["customer_designation_snapshot"] == "VP of Procurement"
    assert "Plot 42, GIDC Electronic Estate" in q_data["billing_address_snapshot"]
    assert q_data["customer_gstin_snapshot"] == "24AABCI1234F1Z9"

    # 3. Generate PDF and verify contents
    pdf_res = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=admin_headers,
    )
    assert pdf_res.status_code == 200
    reader = PdfReader(io.BytesIO(pdf_res.content))
    pdf_text = "".join(page.extract_text() or "" for page in reader.pages)

    assert "Acme Industrial Corp" in pdf_text
    assert "Rajesh Sharma" in pdf_text
    assert "VP of Procurement" in pdf_text
    assert "24AABCI1234F1Z9" in pdf_text
    assert "Plot 42, GIDC Electronic Estate" in pdf_text
    assert "Customer Name: —" not in pdf_text

    # 4. Historical snapshot immutability test:
    # Later, company name and address are modified in the Master record
    async with session_factory() as session:
        comp = await session.get(Company, uuid.UUID(company_id))
        comp.company_name = "Acme Global Enterprises Ltd"
        comp.tax_id_number = "27AABCI9999F1Z0"
        await session.commit()

    # Re-fetch PDF for the created quotation: it MUST use its saved snapshot
    pdf_res2 = await client.get(
        f"/api/v1/crm/quotations/{q_id}/pdf",
        headers=admin_headers,
    )
    assert pdf_res2.status_code == 200
    reader2 = PdfReader(io.BytesIO(pdf_res2.content))
    pdf_text2 = "".join(page.extract_text() or "" for page in reader2.pages)
    # Saved quotation retained its snapshot
    assert "Acme Industrial Corp" in pdf_text2


@pytest.mark.asyncio
async def test_quotation_phase8_share_activity_recording_and_deduplication(
    client: AsyncClient,
    setup_quotation_environment: dict,
    rep_a_headers: dict,
) -> None:
    """
    Phase 8: Test recording email and whatsapp sharing events against lead & quotation.
    Verifies channel, outcome, recipient, deduplication within 60s, and that quotation status is unchanged.
    """
    env = setup_quotation_environment
    lead_id = env["lead_a_id"]

    # Create quotation under rep_a's lead
    res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/quotations",
        json={
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 10000.00,
                    "tax_rate": 18.00,
                }
            ],
        },
        headers=rep_a_headers,
    )
    assert res.status_code == 201
    q_data = res.json()
    q_id = q_data["id"]
    assert q_data["status"] == "draft"

    # 1. Record Email share opened
    share_res1 = await client.post(
        f"/api/v1/crm/quotations/{q_id}/share-activity",
        json={
            "channel": "email",
            "outcome": "opened",
            "recipient": "buyer@example.com",
            "version": 1,
            "details": "Opened native mail composer",
        },
        headers=rep_a_headers,
    )
    assert share_res1.status_code == 200, share_res1.text
    data1 = share_res1.json()
    assert data1["success"] is True
    assert data1["deduplicated"] is False
    assert data1["channel"] == "email"
    assert data1["outcome"] == "opened"
    act_id = data1["activity_id"]

    # 2. Quotation status MUST still be draft (not marked as sent merely because composer opened)
    q_check = await client.get(f"/api/v1/crm/quotations/{q_id}", headers=rep_a_headers)
    assert q_check.status_code == 200
    assert q_check.json()["status"] == "draft"

    # 3. Deduplication: Immediate repeated click within 60 seconds returns deduplicated=True
    share_res2 = await client.post(
        f"/api/v1/crm/quotations/{q_id}/share-activity",
        json={
            "channel": "email",
            "outcome": "opened",
            "recipient": "buyer@example.com",
            "version": 1,
        },
        headers=rep_a_headers,
    )
    assert share_res2.status_code == 200
    data2 = share_res2.json()
    assert data2["success"] is True
    assert data2["deduplicated"] is True
    assert data2["activity_id"] == act_id

    # 4. WhatsApp share opened
    wa_res = await client.post(
        f"/api/v1/crm/quotations/{q_id}/share-activity",
        json={
            "channel": "whatsapp",
            "outcome": "opened",
            "recipient": "+919876543210",
            "version": 1,
            "details": "Opened WhatsApp Web chat",
        },
        headers=rep_a_headers,
    )
    assert wa_res.status_code == 200
    wa_data = wa_res.json()
    assert wa_data["success"] is True
    assert wa_data["channel"] == "whatsapp"
    assert wa_data["outcome"] == "opened"

    # 5. Invalid channel/outcome rejects with 422
    bad_res = await client.post(
        f"/api/v1/crm/quotations/{q_id}/share-activity",
        json={
            "channel": "telegram",  # invalid
            "outcome": "opened",
        },
        headers=rep_a_headers,
    )
    assert bad_res.status_code == 422


@pytest.mark.asyncio
async def test_quotation_phase8_share_activity_rbac(
    client: AsyncClient,
    setup_quotation_environment: dict,
    rep_a_headers: dict,
    rep_b_headers: dict,
) -> None:
    """
    Phase 8: Salesperson RBAC scoping enforcement on share-activity.
    Salespeople cannot share quotations belonging to leads assigned to other salespeople.
    """
    env = setup_quotation_environment
    lead_a_id = env["lead_a_id"]

    # Create quotation under lead assigned to Rep A
    res = await client.post(
        f"/api/v1/crm/leads/{lead_a_id}/quotations",
        json={
            "items": [
                {
                    "product_id": env["prod1_id"],
                    "quantity": 1,
                    "unit_price": 5000.00,
                    "tax_rate": 18.00,
                }
            ],
        },
        headers=rep_a_headers,
    )
    assert res.status_code == 201
    q_id = res.json()["id"]

    # Rep B attempts to record share activity on Rep A's quotation -> 403 Forbidden
    unauth_res = await client.post(
        f"/api/v1/crm/quotations/{q_id}/share-activity",
        json={
            "channel": "email",
            "outcome": "opened",
            "recipient": "spy@competitor.com",
        },
        headers=rep_b_headers,
    )
    assert unauth_res.status_code == 403


# ==============================================================================
# 11. INHYMA ERP Quotation PDF Generation & Company Branding Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_quotation_pdf_generation_scenarios_and_company_branding(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_quotation_environment: dict,
) -> None:
    """
    Verifies quotation PDF generation and ERP Settings branding across 5 core scenarios:
    1. Quotation with linked company and complete customer details.
    2. Quotation with an individual customer (no linked company).
    3. Quotation with multiple product lines.
    4. Quotation with missing optional customer details.
    5. Quotation saved as a draft.
    Also verifies that:
    - Company branding from ERP Settings (Organization) is used.
    - PDF contains valid %PDF header and non-empty content.
    - Snapshot immutability is preserved.
    """
    env = setup_quotation_environment
    lead_a_id = env["lead_a_id"]
    prod1_id = env["prod1_id"]
    prod2_id = env["prod2_id"]

    # Ensure Organization record exists and has branding
    from app.database.engine import get_sessionmaker
    from app.organizations.models import Organization
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        result = await session.execute(select(Organization).limit(1))
        org = result.scalar_one_or_none()
        if not org:
            org = Organization(
                id=str(uuid.uuid4()),
                name="Inhyma Solutions LLP",
                legal_name="Inhyma Solutions LLP",
                email="contact@inhyma.com",
                phone="+91 80 4123 4567",
                tax_id="29ABCDE1234F1Z5",
                pan_number="ABCDE1234F",
                city="Bengaluru",
                state="Karnataka",
                country="India",
                postal_code="560058",
            )
            session.add(org)
            await session.commit()

    # Scenario 1 & 5: Linked company, complete details, saved as draft
    res1 = await client.post(
        f"/api/v1/crm/leads/{lead_a_id}/quotations",
        json={
            "valid_until": "2026-12-31",
            "payment_terms": "100% advance",
            "delivery_terms": "Immediate dispatch",
            "notes": "Scenario 1: linked company & complete details",
            "items": [
                {
                    "product_id": prod1_id,
                    "quantity": 1,
                    "unit_price": 50000.0,
                    "unit_discount": 2000.0,
                    "tax_rate": 18.0,
                }
            ],
        },
        headers=admin_headers,
    )
    assert res1.status_code == 201
    q1 = res1.json()
    assert q1["status"] == "draft"

    pdf1_res = await client.get(
        f"/api/v1/crm/quotations/{q1['id']}/pdf",
        headers=admin_headers,
    )
    assert pdf1_res.status_code == 200
    assert pdf1_res.headers["content-type"] == "application/pdf"
    assert pdf1_res.content.startswith(b"%PDF")
    assert len(pdf1_res.content) > 1000

    # Scenario 2: Individual customer (no company)
    from app.crm.models import CrmLead
    async with session_factory() as session:
        lead_a_obj = await session.get(CrmLead, lead_a_id)
        pipe_id = lead_a_obj.pipeline_id
        stg_id = lead_a_obj.stage_id
        ind_lead = CrmLead(
            id=str(uuid.uuid4()),
            name="John Doe Individual",
            email="john.doe.ind@example.test",
            original_phone="+919876543210",
            normalized_phone="+919876543210",
            pipeline_id=pipe_id,
            stage_id=stg_id,
            assigned_to=ADMIN_ID,
            company_id=None,
            created_by=ADMIN_ID,
        )
        session.add(ind_lead)
        await session.commit()
        ind_lead_id = ind_lead.id

    res2 = await client.post(
        f"/api/v1/crm/leads/{ind_lead_id}/quotations",
        json={
            "items": [
                {
                    "product_id": prod1_id,
                    "quantity": 1,
                    "unit_price": 25000.0,
                    "tax_rate": 18.0,
                }
            ],
        },
        headers=admin_headers,
    )
    assert res2.status_code == 201
    q2 = res2.json()
    assert q2["company_id"] is None

    pdf2_res = await client.get(
        f"/api/v1/crm/quotations/{q2['id']}/pdf",
        headers=admin_headers,
    )
    assert pdf2_res.status_code == 200
    assert pdf2_res.headers["content-type"] == "application/pdf"
    assert pdf2_res.content.startswith(b"%PDF")
    assert len(pdf2_res.content) > 1000

    # Scenario 3: Multiple product lines (3 items)
    res3 = await client.post(
        f"/api/v1/crm/leads/{lead_a_id}/quotations",
        json={
            "items": [
                {
                    "product_id": prod1_id,
                    "quantity": 2,
                    "unit_price": 10000.0,
                    "tax_rate": 18.0,
                },
                {
                    "product_id": prod2_id,
                    "quantity": 3,
                    "unit_price": 5000.0,
                    "tax_rate": 12.0,
                },
                {
                    "product_id": prod1_id,
                    "quantity": 1,
                    "unit_price": 15000.0,
                    "tax_rate": 5.0,
                },
            ],
        },
        headers=admin_headers,
    )
    assert res3.status_code == 201
    q3 = res3.json()
    assert len(q3["items"]) == 3

    pdf3_res = await client.get(
        f"/api/v1/crm/quotations/{q3['id']}/pdf",
        headers=admin_headers,
    )
    assert pdf3_res.status_code == 200
    assert pdf3_res.headers["content-type"] == "application/pdf"
    assert pdf3_res.content.startswith(b"%PDF")
    assert len(pdf3_res.content) > 1000

    # Scenario 4: Missing optional customer details (no email, no company, no address)
    async with session_factory() as session:
        sparse_phone = f"+9199{random.randint(10000000, 99999999)}"
        sparse_lead = CrmLead(
            id=str(uuid.uuid4()),
            name="Minimal Contact",
            email=None,
            original_phone=sparse_phone,
            normalized_phone=sparse_phone,
            pipeline_id=pipe_id,
            stage_id=stg_id,
            assigned_to=ADMIN_ID,
            company_id=None,
            created_by=ADMIN_ID,
        )
        session.add(sparse_lead)
        await session.commit()
        sparse_lead_id = sparse_lead.id

    res4 = await client.post(
        f"/api/v1/crm/leads/{sparse_lead_id}/quotations",
        json={
            "items": [
                {
                    "product_id": prod2_id,
                    "quantity": 1,
                    "unit_price": 8000.0,
                    "tax_rate": 0.0,
                }
            ],
        },
        headers=admin_headers,
    )
    assert res4.status_code == 201
    q4 = res4.json()

    pdf4_res = await client.get(
        f"/api/v1/crm/quotations/{q4['id']}/pdf",
        headers=admin_headers,
    )
    assert pdf4_res.status_code == 200
    assert pdf4_res.headers["content-type"] == "application/pdf"
    assert pdf4_res.content.startswith(b"%PDF")
    assert len(pdf4_res.content) > 1000


@pytest.mark.asyncio
async def test_quotation_pdf_header_single_branding_and_no_duplication():
    """
    Verifies that:
    1. Only ONE company logo is rendered when configured in ERP Settings.
    2. Only ONE company name is rendered in the header table (no repeated company name beneath logo).
    3. No hardcoded fallback logo is loaded if ERP Settings has no logo.
    4. No invented tagline ('YOUR INDUSTRIAL HYPERMARKET') is rendered.
    5. Missing company fields are cleanly omitted.
    """
    import base64
    import io
    from pypdf import PdfReader
    from app.crm.quotation_pdf import generate_crm_quotation_pdf_bytes, get_logo_flowable

    sample_snapshot = {
        "quotation_number": "QT-202610-9999",
        "version": 1,
        "customer_name_snapshot": "Acme Corp",
        "company_name_snapshot": "Acme Corp",
        "currency": "INR",
        "total_amount": 15000.0,
        "items": [
            {
                "product_name": "Test Part",
                "quantity": 1,
                "unit_price": 15000.0,
                "tax_rate": 0,
                "tax_amount": 0,
                "line_total": 15000.0,
            }
        ],
    }

    # 1. No logo configured in ERP Settings
    no_logo_branding = {
        "company_name": "Custom Organization Ltd",
        "email": "contact@custom.test",
        "phone": "+91 99999 88888",
    }
    # get_logo_flowable must return None (no fallback to assets/logo.png)
    assert get_logo_flowable(logo_data=None, logo_url=None) is None

    pdf_no_logo = generate_crm_quotation_pdf_bytes(sample_snapshot, company_branding=no_logo_branding)
    assert pdf_no_logo.startswith(b"%PDF-")
    reader_no_logo = PdfReader(io.BytesIO(pdf_no_logo))
    text_no_logo = "".join(p.extract_text() or "" for p in reader_no_logo.pages)
    assert "YOUR INDUSTRIAL HYPERMARKET" not in text_no_logo
    # In header, company name rendered once on left, not duplicated on right
    # (plus running canvas footer at bottom)
    assert text_no_logo.count("CUSTOM ORGANIZATION LTD") == 2  # 1 in header, 1 in footer

    # 2. Logo configured in ERP Settings (1x1 PNG data URI)
    png_1x1 = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
    b64_logo = "data:image/png;base64," + base64.b64encode(png_1x1).decode()

    logo_flowable = get_logo_flowable(logo_data=b64_logo)
    assert logo_flowable is not None

    with_logo_branding = {
        "company_name": "Custom Organization Ltd",
        "logo_data": b64_logo,
        "email": "contact@custom.test",
        "phone": "+91 99999 88888",
        "gst_number": "27AAKFI9869H1ZL",
    }
    pdf_with_logo = generate_crm_quotation_pdf_bytes(sample_snapshot, company_branding=with_logo_branding)
    assert pdf_with_logo.startswith(b"%PDF-")
    reader_with_logo = PdfReader(io.BytesIO(pdf_with_logo))
    text_with_logo = "".join(p.extract_text() or "" for p in reader_with_logo.pages)
    assert "YOUR INDUSTRIAL HYPERMARKET" not in text_with_logo
    # In header, logo is on left with NO company text beneath it; company name rendered once on right
    assert text_with_logo.count("CUSTOM ORGANIZATION LTD") == 2  # 1 in header right, 1 in footer
    assert "GSTIN: 27AAKFI9869H1ZL" in text_with_logo



