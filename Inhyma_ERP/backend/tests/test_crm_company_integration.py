"""
Test Suite for CRM Leads & Companies Master Integration (Prompt 3 of 10).

Covers:
1. Exact existing company match and linking.
2. Normalized whitespace/case matching.
3. Explicit company ID selection and validation.
4. Invalid / non-existent company ID rejection (HTTP 400).
5. Tax ID / GSTIN reliable match.
6. Company creation via existing Companies business logic when unmatched.
7. Multiple leads referencing the same company master record.
8. Ambiguous match returns disambiguation response (HTTP 409) with candidate details.
9. Consistent company_id and company_name sync on update with activity touchpoint logging.
10. CSV import company linking and deduplication.
11. Repeat campaign touches preserve company without creating duplicates.
12. Legacy backfill utility safely links single reliable matches and leaves ambiguous/unmatched untouched.
"""

from __future__ import annotations

import random
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.companies.models import Company
from app.crm.company_linking import (
    AmbiguousCompanyMatchException,
    backfill_legacy_lead_companies,
    normalize_company_name,
    resolve_or_create_company,
)
from app.crm.models import (
    CrmActivity,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
)
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus
from app.rbac.models import Role, UserRole, RoleAssignmentStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
SALESPERSON_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")


def unique_phone_suffix() -> str:
    return str(random.randint(10000000, 99999999))


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "company.view", "company.create", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def salesperson_headers() -> dict[str, str]:
    token = create_access_token(
        SALESPERSON_ID,
        permissions=["crm.leads.view", "crm.leads.manage"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_pipeline_and_seed_companies():
    """Ensure active test pipeline, users, and predictable company master records exist."""
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # 1. Ensure test admin user exists
        admin = await session.get(User, ADMIN_ID)
        if not admin:
            admin = User(
                id=ADMIN_ID,
                username="admin_crm_comp",
                email="admin_crm_comp@inhyma.test",
                is_active=True,
                has_login=True,
                status=UserStatus.ACTIVE,
            )
            session.add(admin)

        salesperson = await session.get(User, SALESPERSON_ID)
        if not salesperson:
            salesperson = User(
                id=SALESPERSON_ID,
                username="sales_crm_comp",
                email="sales_crm_comp@inhyma.test",
                is_active=True,
                has_login=True,
                status=UserStatus.ACTIVE,
            )
            session.add(salesperson)

        # 2. Pipeline setup
        pipe_stmt = select(CrmPipeline).where(CrmPipeline.name == "Company Integration Pipeline")
        pipeline = (await session.execute(pipe_stmt)).scalar_one_or_none()
        if not pipeline:
            pipeline = CrmPipeline(
                name="Company Integration Pipeline",
                description="Pipeline for testing company integration",
                is_default=True,
                is_active=True,
                created_by=ADMIN_ID,
            )
            session.add(pipeline)
            await session.flush()

            stage_new = CrmPipelineStage(
                pipeline_id=pipeline.id,
                name="New Landing",
                stage_order=0,
                stage_type="open",
                is_initial=True,
                is_active=True,
            )
            stage_won = CrmPipelineStage(
                pipeline_id=pipeline.id,
                name="Deal Won",
                stage_order=1,
                stage_type="won",
                is_initial=False,
                is_active=True,
            )
            session.add_all([stage_new, stage_won])
            await session.flush()
        else:
            stage_stmt = select(CrmPipelineStage).where(
                CrmPipelineStage.pipeline_id == pipeline.id,
                CrmPipelineStage.is_initial.is_(True),
            )
            stage_new = (await session.execute(stage_stmt)).scalar_one()

        # 3. Predictable test companies in master
        c1_name = "Acme Heavy Industries Pvt Ltd"
        c1_stmt = select(Company).where(Company.company_name == c1_name, Company.deleted_at.is_(None))
        comp1 = (await session.execute(c1_stmt)).scalar_one_or_none()
        if not comp1:
            comp1 = Company(
                company_name=c1_name,
                tax_id_number="27AAACA1234A1Z5",
                contact_full_name="Vikram Mehta",
                contact_calling_number="+91 9820011223",
                is_active=True,
            )
            session.add(comp1)
            await session.flush()

        # Ambiguous candidate companies: pair of companies with similar names
        ambig1_name = "Global Pack Solutions Mumbai"
        ambig2_name = "Global Pack Solutions Delhi"
        a1 = (await session.execute(select(Company).where(Company.company_name == ambig1_name, Company.deleted_at.is_(None)))).scalar_one_or_none()
        if not a1:
            a1 = Company(company_name=ambig1_name, is_active=True)
            session.add(a1)
        a2 = (await session.execute(select(Company).where(Company.company_name == ambig2_name, Company.deleted_at.is_(None)))).scalar_one_or_none()
        if not a2:
            a2 = Company(company_name=ambig2_name, is_active=True)
            session.add(a2)

        await session.commit()

        pipeline_id = pipeline.id
        stage_id = stage_new.id
        company1_id = comp1.id

    yield {
        "pipeline_id": pipeline_id,
        "stage_id": stage_id,
        "company1_id": company1_id,
        "company1_name": c1_name,
        "ambig1_name": ambig1_name,
        "ambig2_name": ambig2_name,
    }


@pytest.mark.asyncio
async def test_exact_existing_company_match(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify that a typed exact company name reliably reuses the existing company record."""
    c_name = setup_pipeline_and_seed_companies["company1_name"]
    expected_id = str(setup_pipeline_and_seed_companies["company1_id"])
    phone = f"+91 91{unique_phone_suffix()}"

    payload = {
        "name": "Arjun Singhania",
        "phone": phone,
        "company_name": c_name,
        "campaign": "Industrial_Expo_2026",
    }
    res = await client.post("/api/v1/crm/leads", json=payload, headers=admin_headers)
    assert res.status_code == 201, res.text
    data = res.json()["data"]

    assert data["company_name"] == c_name
    assert str(data["company_id"]) == expected_id


@pytest.mark.asyncio
async def test_normalized_name_match(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify that whitespace variations and case differences match the existing company."""
    # "  acme   heavy  industries  pvt   ltd  "
    varied_name = "   acme   heavy   industries   pvt   ltd   "
    expected_id = str(setup_pipeline_and_seed_companies["company1_id"])
    expected_canonical_name = setup_pipeline_and_seed_companies["company1_name"]
    phone = f"+91 92{unique_phone_suffix()}"

    payload = {
        "name": "Kavita Reddy",
        "phone": phone,
        "company_name": varied_name,
        "campaign": "Website_Contact_Form",
    }
    res = await client.post("/api/v1/crm/leads", json=payload, headers=admin_headers)
    assert res.status_code == 201, res.text
    data = res.json()["data"]

    assert str(data["company_id"]) == expected_id
    assert data["company_name"] == expected_canonical_name


@pytest.mark.asyncio
async def test_explicit_company_id_linking(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify explicit company_id from UI takes priority and synchronizes display name snapshot."""
    company_id = str(setup_pipeline_and_seed_companies["company1_id"])
    phone = f"+91 93{unique_phone_suffix()}"

    payload = {
        "name": "Nikhil Bose",
        "phone": phone,
        "company_id": company_id,
        "company_name": "Overridden Draft Name",  # Should be normalized to company master record name
        "campaign": "Referral_Partner",
    }
    res = await client.post("/api/v1/crm/leads", json=payload, headers=admin_headers)
    assert res.status_code == 201, res.text
    data = res.json()["data"]

    assert str(data["company_id"]) == company_id
    assert data["company_name"] == setup_pipeline_and_seed_companies["company1_name"]


@pytest.mark.asyncio
async def test_invalid_company_id_rejected(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify that submitting an invalid or non-existent company_id returns 400 Bad Request."""
    fake_id = str(uuid.uuid4())
    phone = f"+91 94{unique_phone_suffix()}"

    payload = {
        "name": "Rohan Deshmukh",
        "phone": phone,
        "company_id": fake_id,
        "company_name": "Ghost Corp",
    }
    res = await client.post("/api/v1/crm/leads", json=payload, headers=admin_headers)
    assert res.status_code == 400, res.text
    assert "not found" in res.json()["message"].lower()


@pytest.mark.asyncio
async def test_company_creation_when_unmatched(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify that an unmatched company name automatically creates a company in the Companies master."""
    unique_company_name = f"Nova Robotics Tech {unique_phone_suffix()} Pvt Ltd"
    phone = f"+91 95{unique_phone_suffix()}"

    payload = {
        "name": "Sneha Roy",
        "phone": phone,
        "company_name": unique_company_name,
        "campaign": "Product_Demo_Q4",
    }
    res = await client.post("/api/v1/crm/leads", json=payload, headers=admin_headers)
    assert res.status_code == 201, res.text
    data = res.json()["data"]

    assert data["company_id"] is not None
    created_comp_id = uuid.UUID(data["company_id"])
    assert data["company_name"] == unique_company_name

    # Check that company actually exists in the companies master table
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        comp = await session.get(Company, created_comp_id)
        assert comp is not None
        assert comp.company_name == unique_company_name
        assert comp.contact_full_name == "Sneha Roy"


@pytest.mark.asyncio
async def test_multiple_leads_linked_to_one_company(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify that multiple leads and contacts reuse the exact same company master record."""
    company_name = f"Paramount Automations {unique_phone_suffix()} Ltd"

    # Lead 1: contact Rajesh
    phone1 = f"+91 96{unique_phone_suffix()}"
    res1 = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Rajesh Gupta", "phone": phone1, "company_name": company_name, "campaign": "Inbound_Web"},
        headers=admin_headers,
    )
    assert res1.status_code == 201
    comp1_id = res1.json()["data"]["company_id"]

    # Lead 2: contact Sunita (different person, different campaign, same company)
    phone2 = f"+91 97{unique_phone_suffix()}"
    res2 = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Sunita Verma", "phone": phone2, "company_name": company_name, "campaign": "Email_Outreach"},
        headers=admin_headers,
    )
    assert res2.status_code == 201
    comp2_id = res2.json()["data"]["company_id"]

    # Both leads must share the exact same company_id
    assert comp1_id == comp2_id

    # Verify in DB only 1 company record exists with this name
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        comps = (
            await session.execute(
                select(Company).where(Company.company_name == company_name, Company.deleted_at.is_(None))
            )
        ).scalars().all()
        assert len(comps) == 1


@pytest.mark.asyncio
async def test_ambiguous_company_match_disambiguation(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify that multiple plausible matches return HTTP 409 with candidate companies for disambiguation."""
    # "Global Pack Solutions" matches both "Global Pack Solutions Mumbai" and "Global Pack Solutions Delhi"
    phone = f"+91 98{unique_phone_suffix()}"
    payload = {
        "name": "Manish Shah",
        "phone": phone,
        "company_name": "Global Pack Solutions",
        "campaign": "Packaging_Fair",
    }
    res = await client.post("/api/v1/crm/leads", json=payload, headers=admin_headers)
    assert res.status_code == 409, res.text
    err = res.json()
    assert "multiple companies match" in err["message"].lower()
    error_entry = err.get("errors", [{}])[0]
    assert error_entry.get("code") == "AMBIGUOUS_COMPANY_MATCH"
    details = error_entry.get("details", {})
    assert "candidates" in details
    assert len(details["candidates"]) >= 2


@pytest.mark.asyncio
async def test_lead_company_update_and_activity_logging(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify that updating a lead's company updates company_id & company_name together and logs an activity."""
    # 1. Create initial lead
    init_comp = f"Initial Firm {unique_phone_suffix()} Pvt Ltd"
    phone = f"+91 99{unique_phone_suffix()}"
    create_res = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Karan Mehra", "phone": phone, "company_name": init_comp},
        headers=admin_headers,
    )
    assert create_res.status_code == 201
    lead_id = create_res.json()["data"]["id"]

    # 2. Update company to existing seeded company
    target_comp_name = setup_pipeline_and_seed_companies["company1_name"]
    target_comp_id = str(setup_pipeline_and_seed_companies["company1_id"])

    patch_res = await client.patch(
        f"/api/v1/crm/leads/{lead_id}",
        json={"company_id": target_comp_id},
        headers=admin_headers,
    )
    assert patch_res.status_code == 200, patch_res.text
    updated = patch_res.json()["data"]
    assert str(updated["company_id"]) == target_comp_id
    assert updated["company_name"] == target_comp_name

    # 3. Check activity log
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        activities = (
            await session.execute(
                select(CrmActivity).where(
                    CrmActivity.lead_id == uuid.UUID(lead_id),
                    CrmActivity.subject.ilike("%Company Changed%"),
                )
            )
        ).scalars().all()
        assert len(activities) >= 1
        assert "Company Changed" in activities[0].subject


@pytest.mark.asyncio
async def test_csv_import_company_linking_and_deduplication(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_pipeline_and_seed_companies: dict,
):
    """Verify CSV import links existing companies and creates unmatched companies without duplicating."""
    pipeline_id = str(setup_pipeline_and_seed_companies["pipeline_id"])
    c1_name = setup_pipeline_and_seed_companies["company1_name"]
    new_csv_comp = f"Delta Pneumatics {unique_phone_suffix()} Ltd"

    p1 = f"98{unique_phone_suffix()[:8]}"
    p2 = f"97{unique_phone_suffix()[:8]}"
    csv_text = f"""Name,Number,Campaign,Priority,Company
Amitabh Sen,{p1},Industrial_Drive,High,{c1_name}
Bhavna Joshi,{p2},Industrial_Drive,Medium,{new_csv_comp}
"""
    # 1. Preview
    res_prev = await client.post(
        "/api/v1/crm/import/preview",
        data={"pipeline_id": pipeline_id},
        files={"file": ("leads.csv", csv_text.encode("utf-8"), "text/csv")},
        headers=admin_headers,
    )
    assert res_prev.status_code == 200
    prev_data = res_prev.json()["data"]
    assert prev_data["valid_candidate_count"] == 2

    # 2. Confirm
    res_conf = await client.post(
        "/api/v1/crm/import/confirm",
        data={"pipeline_id": pipeline_id, "batch_name": "Test Company Batch"},
        files={"file": ("leads.csv", csv_text.encode("utf-8"), "text/csv")},
        headers=admin_headers,
    )
    assert res_conf.status_code == 201, res_conf.text
    conf_data = res_conf.json()["data"]
    assert conf_data["success_count"] == 2

    # Verify both leads have company_id linked
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        leads = (
            await session.execute(
                select(CrmLead).where(CrmLead.original_phone.in_([p1, p2]), CrmLead.deleted_at.is_(None))
            )
        ).scalars().all()
        assert len(leads) == 2
        for l in leads:
            assert l.company_id is not None
            if l.name == "Amitabh Sen":
                assert l.company_id == setup_pipeline_and_seed_companies["company1_id"]
            elif l.name == "Bhavna Joshi":
                assert l.company_name == new_csv_comp


@pytest.mark.asyncio
async def test_legacy_backfill_safe_linking(
    setup_pipeline_and_seed_companies: dict,
):
    """Verify backfill utility safely links single reliable matches and leaves ambiguous/unmatched untouched."""
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # Create 3 unlinked legacy leads
        c1_name = setup_pipeline_and_seed_companies["company1_name"]
        ambig_name = "Global Pack Solutions"
        unmatched_name = f"Nonexistent Entity {unique_phone_suffix()}"

        lead_safe = CrmLead(
            name="Safe Legacy",
            original_phone=f"+91 81{unique_phone_suffix()}",
            normalized_phone=f"+91 81{unique_phone_suffix()}",
            company_name=c1_name,
            company_id=None,
            pipeline_id=setup_pipeline_and_seed_companies["pipeline_id"],
            stage_id=setup_pipeline_and_seed_companies["stage_id"],
            status="new",
        )
        lead_ambig = CrmLead(
            name="Ambig Legacy",
            original_phone=f"+91 82{unique_phone_suffix()}",
            normalized_phone=f"+91 82{unique_phone_suffix()}",
            company_name=ambig_name,
            company_id=None,
            pipeline_id=setup_pipeline_and_seed_companies["pipeline_id"],
            stage_id=setup_pipeline_and_seed_companies["stage_id"],
            status="new",
        )
        lead_unmatched = CrmLead(
            name="Unmatched Legacy",
            original_phone=f"+91 83{unique_phone_suffix()}",
            normalized_phone=f"+91 83{unique_phone_suffix()}",
            company_name=unmatched_name,
            company_id=None,
            pipeline_id=setup_pipeline_and_seed_companies["pipeline_id"],
            stage_id=setup_pipeline_and_seed_companies["stage_id"],
            status="new",
        )
        session.add_all([lead_safe, lead_ambig, lead_unmatched])
        await session.commit()

        # Run backfill
        report = await backfill_legacy_lead_companies(session)
        assert report["safely_linked"] >= 1
        assert report["ambiguous"] >= 1
        assert report["unmatched"] >= 1

        # Check DB state
        await session.refresh(lead_safe)
        await session.refresh(lead_ambig)
        await session.refresh(lead_unmatched)

        # Single reliable match was safely linked
        assert lead_safe.company_id == setup_pipeline_and_seed_companies["company1_id"]
        # Ambiguous and unmatched legacy rows were left unmodified (company_id remains None)
        assert lead_ambig.company_id is None
        assert lead_unmatched.company_id is None
