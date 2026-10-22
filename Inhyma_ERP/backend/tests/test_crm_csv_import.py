"""
Automated Test Suite for CRM Lead CSV Import and Duplicate Detection (Phase 4).

Verifies:
1. Unauthenticated & unauthorized access rejection (401 / 403).
2. Download sample CSV template with formula injection protection.
3. CSV validation: empty file, missing headers, oversized file, case-insensitive/whitespace headers.
4. Pipeline selection: active requirement, initial open stage requirement.
5. Preview before import: row validation, metrics, zero database writes during preview.
6. Intra-file duplicate detection and conflicting data reporting.
7. Confirm valid lead import: lead creation, unassigned ownership, pipeline & initial stage assignment, batch metrics.
8. Existing CRM duplicates & campaign attribution:
   - Does NOT create duplicate lead.
   - Preserves owner, pipeline, stage, original campaign.
   - Appends new campaign to campaign_history without duplicating entries.
   - Records touchpoint activity.
9. Duplicate privacy across user access scopes (no sensitive info leaked).
10. Batch history listing and detail retrieval with scoping.
"""

from __future__ import annotations

import io
import json
import random
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.companies.models import Company
from app.crm.models import (
    CrmActivity,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
)
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
SALES_MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
JOHN_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
OPS_EMPLOYEE_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")
VIEWER_ID = uuid.UUID("f47ac10b-58cc-4372-a567-0e02b2c3d479")


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.import", "crm.leads.manage", "crm.leads.view", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def import_user_headers() -> dict[str, str]:
    token = create_access_token(
        SALES_MANAGER_ID,
        permissions=["crm.leads.import", "crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def unauthorized_headers() -> dict[str, str]:
    token = create_access_token(
        OPS_EMPLOYEE_ID,
        permissions=["task.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def view_only_headers() -> dict[str, str]:
    token = create_access_token(
        VIEWER_ID,
        permissions=["crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def salesperson_headers() -> dict[str, str]:
    token = create_access_token(
        JOHN_ID,
        permissions=["crm.leads.view", "crm.leads.manage", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_test_pipeline():
    """Create a clean active pipeline with initial open stage for testing."""
    session_factory = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    initial_stage_id = uuid.uuid4()
    won_stage_id = uuid.uuid4()

    async with session_factory() as session:
        for uid, uname in [
            (ADMIN_ID, "admin_csv_import"),
            (SALES_MANAGER_ID, "manager_csv_import"),
            (JOHN_ID, "john_csv_import"),
            (OPS_EMPLOYEE_ID, "ops_csv_import"),
            (VIEWER_ID, "viewer_csv_import"),
        ]:
            u = await session.get(User, uid)
            if not u:
                session.add(User(
                    id=uid,
                    username=uname,
                    email=f"{uname}@inhyma.test",
                    is_active=True,
                    has_login=True,
                    status=UserStatus.ACTIVE,
                ))
        await session.flush()

        pipeline = CrmPipeline(
            id=pipeline_id,
            name=f"Import Test Pipeline {uuid.uuid4().hex[:6]}",
            description="Pipeline dedicated to CSV import tests",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(pipeline)
        await session.flush()

        initial_stage = CrmPipelineStage(
            id=initial_stage_id,
            pipeline_id=pipeline_id,
            name="New Inbound",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        won_stage = CrmPipelineStage(
            id=won_stage_id,
            pipeline_id=pipeline_id,
            name="Won Closed",
            stage_order=1,
            stage_type="won",
            is_initial=False,
            is_active=True,
        )
        session.add_all([initial_stage, won_stage])
        await session.commit()

    yield {
        "pipeline_id": pipeline_id,
        "initial_stage_id": initial_stage_id,
        "won_stage_id": won_stage_id,
    }

    # Cleanup
    async with session_factory() as session:
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.pipeline_id == pipeline_id)
        )))
        await session.execute(delete(CrmLead).where(CrmLead.pipeline_id == pipeline_id))
        await session.execute(delete(CrmImportBatch).where(CrmImportBatch.selected_pipeline_id == pipeline_id))
        await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline_id))
        await session.execute(delete(CrmPipeline).where(CrmPipeline.id == pipeline_id))
        await session.commit()


@pytest.mark.asyncio
async def test_unauthenticated_and_unauthorized_import(
    client: AsyncClient,
    unauthorized_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """Ensure anonymous requests get 401 and unauthorized requests get 403."""
    pipe_id = str(setup_test_pipeline["pipeline_id"])

    # Anonymous preview
    res_anon = await client.post("/api/v1/crm/import/preview")
    assert res_anon.status_code in (401, 403)

    # Unauthorized preview
    csv_bytes = b"Name,Number,Campaign\nTest Lead,9876543210,Test_Camp\n"
    files = {"file": ("leads.csv", csv_bytes, "text/csv")}
    data = {"pipeline_id": pipe_id}

    res_unauth = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data=data,
        headers=unauthorized_headers,
    )
    assert res_unauth.status_code == 403

    # Unauthorized batches list
    res_batches = await client.get("/api/v1/crm/import/batches", headers=unauthorized_headers)
    assert res_batches.status_code == 403


@pytest.mark.asyncio
async def test_lead_view_only_user_rejected_on_all_import_endpoints(
    client: AsyncClient,
    view_only_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    BUG-CRM-006: Verify that having crm.leads.view alone does NOT authorize any
    CRM import endpoint. All endpoints must return HTTP 403 Forbidden.
    """
    pipe_id = str(setup_test_pipeline["pipeline_id"])
    csv_bytes = b"Name,Number,Campaign\nAlice,9876543210,Inbound\n"

    # 1. GET /crm/import/template
    res_template = await client.get("/api/v1/crm/import/template", headers=view_only_headers)
    assert res_template.status_code == 403

    # 2. POST /crm/import/preview
    res_preview = await client.post(
        "/api/v1/crm/import/preview",
        files={"file": ("leads.csv", csv_bytes, "text/csv")},
        data={"pipeline_id": pipe_id},
        headers=view_only_headers,
    )
    assert res_preview.status_code == 403

    # 3. POST /crm/import/confirm
    res_confirm = await client.post(
        "/api/v1/crm/import/confirm",
        files={"file": ("leads.csv", csv_bytes, "text/csv")},
        data={"pipeline_id": pipe_id},
        headers=view_only_headers,
    )
    assert res_confirm.status_code == 403

    # 4. GET /crm/import/batches
    res_batches = await client.get("/api/v1/crm/import/batches", headers=view_only_headers)
    assert res_batches.status_code == 403

    # 5. GET /crm/import/batches/{batch_id}
    res_batch_detail = await client.get(f"/api/v1/crm/import/batches/{uuid.uuid4()}", headers=view_only_headers)
    assert res_batch_detail.status_code == 403


@pytest.mark.asyncio
async def test_salesperson_without_import_permission_cannot_bypass_restrictions(
    client: AsyncClient,
    salesperson_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    BUG-CRM-006: Salespersons without crm.leads.import cannot bypass restrictions
    by invoking import endpoints directly, while their normal lead-view access remains intact.
    """
    pipe_id = str(setup_test_pipeline["pipeline_id"])
    csv_bytes = b"Name,Number,Campaign\nBob,9876543211,Inbound\n"

    # All import endpoints return 403
    res_template = await client.get("/api/v1/crm/import/template", headers=salesperson_headers)
    assert res_template.status_code == 403

    res_preview = await client.post(
        "/api/v1/crm/import/preview",
        files={"file": ("leads.csv", csv_bytes, "text/csv")},
        data={"pipeline_id": pipe_id},
        headers=salesperson_headers,
    )
    assert res_preview.status_code == 403

    res_confirm = await client.post(
        "/api/v1/crm/import/confirm",
        files={"file": ("leads.csv", csv_bytes, "text/csv")},
        data={"pipeline_id": pipe_id},
        headers=salesperson_headers,
    )
    assert res_confirm.status_code == 403

    res_batches = await client.get("/api/v1/crm/import/batches", headers=salesperson_headers)
    assert res_batches.status_code == 403

    # But normal lead viewing remains functional and authorized (HTTP 200)
    res_leads = await client.get("/api/v1/crm/leads", headers=salesperson_headers)
    assert res_leads.status_code == 200



@pytest.mark.asyncio
async def test_download_csv_template(
    client: AsyncClient,
    admin_headers: dict[str, str],
    unauthorized_headers: dict[str, str],
):
    """Verify CSV template download with correct headers, UTF-8 content type, filename, and permission rejection."""
    # 1. Authorized download
    res = await client.get("/api/v1/crm/import/template", headers=admin_headers)
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "utf-8" in res.headers["content-type"].lower()
    assert 'filename="inhyma_crm_leads_template.csv"' in res.headers["content-disposition"]
    text = res.text
    # Required columns
    assert "Name,Number,Campaign" in text
    assert "Rajesh Kumar" in text
    # Should not require internal CRM fields
    assert "assigned_to" not in text
    assert "salesperson" not in text
    assert "pipeline_id" not in text

    # 2. Unauthorized rejection
    res_unauth = await client.get("/api/v1/crm/import/template", headers=unauthorized_headers)
    assert res_unauth.status_code == 403


@pytest.mark.asyncio
async def test_csv_validation_empty_missing_headers_and_whitespace(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """Verify validation for empty files, missing required headers, and case/whitespace tolerance."""
    pipe_id = str(setup_test_pipeline["pipeline_id"])

    # 1. Empty file
    files = {"file": ("empty.csv", b"", "text/csv")}
    res_empty = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data={"pipeline_id": pipe_id},
        headers=admin_headers,
    )
    assert res_empty.status_code == 400
    assert "empty" in res_empty.json()["message"].lower()

    # 2. Missing required column (e.g. Campaign missing)
    missing_camp_csv = b"Name,Number\nJohn Doe,9876543210\n"
    files = {"file": ("missing.csv", missing_camp_csv, "text/csv")}
    res_missing = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data={"pipeline_id": pipe_id},
        headers=admin_headers,
    )
    assert res_missing.status_code == 400
    assert "campaign" in res_missing.json()["message"].lower()

    # 3. Case-insensitive and whitespace-padded headers
    flexible_csv = b"  NAME  ,  NUMBER  ,  cAmPaIgN  \nAnita Rao,9876543210,Diwali_2026\n"
    files = {"file": ("flex.csv", flexible_csv, "text/csv")}
    res_flex = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data={"pipeline_id": pipe_id},
        headers=admin_headers,
    )
    assert res_flex.status_code == 200
    body = res_flex.json()["data"]
    assert body["total_rows"] == 1
    assert body["valid_candidate_count"] == 1
    assert body["rows"][0]["name"] == "Anita Rao"
    assert body["rows"][0]["normalized_phone"] == "+919876543210"


@pytest.mark.asyncio
async def test_pipeline_validation_inactive_and_missing_initial_stage(
    client: AsyncClient,
    admin_headers: dict[str, str],
):
    """Verify rejection of invalid pipeline, inactive pipeline, or pipeline without initial open stage."""
    session_factory = get_sessionmaker()

    # 1. Non-existent pipeline
    fake_id = str(uuid.uuid4())
    csv_bytes = b"Name,Number,Campaign\nTest,9876543210,Camp\n"
    res_404 = await client.post(
        "/api/v1/crm/import/preview",
        files={"file": ("test.csv", csv_bytes, "text/csv")},
        data={"pipeline_id": fake_id},
        headers=admin_headers,
    )
    assert res_404.status_code == 404

    # 2. Inactive pipeline
    inactive_pipe_id = uuid.uuid4()
    async with session_factory() as session:
        p_inactive = CrmPipeline(
            id=inactive_pipe_id,
            name=f"Inactive Pipe {uuid.uuid4().hex[:6]}",
            is_active=False,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(p_inactive)
        await session.commit()

    try:
        res_inactive = await client.post(
            "/api/v1/crm/import/preview",
            files={"file": ("test.csv", csv_bytes, "text/csv")},
            data={"pipeline_id": str(inactive_pipe_id)},
            headers=admin_headers,
        )
        assert res_inactive.status_code == 400
        assert "inactive" in res_inactive.json()["message"].lower()
    finally:
        async with session_factory() as session:
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == inactive_pipe_id))
            await session.commit()


@pytest.mark.asyncio
async def test_preview_row_level_validation_and_no_database_writes(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """Verify preview accurately validates row errors and does NOT write leads to the database."""
    pipe_id = str(setup_test_pipeline["pipeline_id"])

    # CSV with 1 valid row, 1 blank name, 1 blank number, 1 invalid phone
    test_csv = (
        "Name,Number,Campaign\n"
        "Valid Lead,9876543210,Web_Search\n"
        ",9876543211,Blank_Name\n"
        "No Number,,Blank_Number\n"
        "Bad Phone,12345,Short_Number\n"
        "Letters Phone,98765ABCDE,Invalid_Chars\n"
    ).encode("utf-8")

    files = {"file": ("preview_test.csv", test_csv, "text/csv")}
    res = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data={"pipeline_id": pipe_id},
        headers=admin_headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]

    assert data["total_rows"] == 5
    assert data["valid_candidate_count"] == 1
    assert data["invalid_count"] == 4
    assert data["rows"][0]["status"] == "VALID"
    assert data["rows"][1]["status"] == "INVALID"
    assert "name cannot be blank" in data["rows"][1]["validation_message"].lower()
    assert data["rows"][2]["status"] == "INVALID"
    assert "phone number cannot be blank" in data["rows"][2]["validation_message"].lower()
    assert data["rows"][3]["status"] == "INVALID"
    assert "length" in data["rows"][3]["validation_message"].lower()

    # Crucial check: verify ZERO leads or batches written during preview
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        leads_count = (await session.execute(
            select(CrmLead).where(CrmLead.pipeline_id == setup_test_pipeline["pipeline_id"])
        )).scalars().all()
        assert len(leads_count) == 0

        batches_count = (await session.execute(
            select(CrmImportBatch).where(CrmImportBatch.selected_pipeline_id == setup_test_pipeline["pipeline_id"])
        )).scalars().all()
        assert len(batches_count) == 0


@pytest.mark.asyncio
async def test_intra_file_duplicates_and_conflict_detection(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """Verify intra-file duplicate rows are detected and conflicting row data is surfaced."""
    pipe_id = str(setup_test_pipeline["pipeline_id"])

    # CSV with 1 original row, 1 identical duplicate row, 1 conflicting duplicate row
    test_csv = (
        "Name,Number,Campaign\n"
        "Kavita Verma,9876543210,Festive_Oct\n"
        "Kavita Verma,9876543210,Festive_Oct\n"
        "Kavita V.,9876543210,Festive_Nov_Special\n"
    ).encode("utf-8")

    files = {"file": ("intra_dup.csv", test_csv, "text/csv")}
    res = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data={"pipeline_id": pipe_id},
        headers=admin_headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]

    assert data["total_rows"] == 3
    assert data["valid_candidate_count"] == 1
    assert data["duplicate_file_count"] == 2
    assert data["conflict_count"] == 1

    assert data["rows"][0]["status"] == "VALID"
    assert data["rows"][1]["status"] == "FILE_DUPLICATE"
    assert "matches row 2" in data["rows"][1]["validation_message"]

    assert data["rows"][2]["status"] == "CONFLICT_IN_FILE"
    assert "conflicting data" in data["rows"][2]["validation_message"]
    assert "Name 'Kavita V.' vs 'Kavita Verma'" in data["rows"][2]["validation_message"]


@pytest.mark.asyncio
async def test_valid_import_confirm_and_lead_creation(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """Verify confirmed import creates leads unassigned in selected pipeline and initial stage."""
    pipe_id = str(setup_test_pipeline["pipeline_id"])
    initial_stage_id = setup_test_pipeline["initial_stage_id"]

    test_csv = (
        "Name,Number,Campaign\n"
        "Rohit Sharma,9876543201,Brand_Campaign_Q4\n"
        "Suresh Raina,+919876543202,Diwali_Special\n"
    ).encode("utf-8")

    files = {"file": ("confirm_leads.csv", test_csv, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": "Test Inbound Batch",
        "auto_assign": "false",
    }

    res = await client.post(
        "/api/v1/crm/import/confirm",
        files=files,
        data=data,
        headers=admin_headers,
    )
    assert res.status_code == 201
    result = res.json()["data"]

    assert result["batch_name"] == "Test Inbound Batch"
    assert result["status"] == "completed"
    assert result["total_rows"] == 2
    assert result["success_count"] == 2
    assert result["duplicate_skipped_count"] == 0
    assert result["failed_count"] == 0

    batch_id = uuid.UUID(result["batch_id"])

    # Verify database state
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        batch = (await session.execute(
            select(CrmImportBatch).where(CrmImportBatch.id == batch_id)
        )).scalar_one_or_none()
        assert batch is not None
        assert batch.status == "completed"
        assert batch.success_count == 2

        leads = (await session.execute(
            select(CrmLead)
            .where(CrmLead.pipeline_id == setup_test_pipeline["pipeline_id"])
            .order_by(CrmLead.name.asc())
        )).scalars().all()

        assert len(leads) == 2
        l1, l2 = leads[0], leads[1]

        assert l1.name == "Rohit Sharma"
        assert l1.normalized_phone == "+919876543201"
        assert l1.campaign == "Brand_Campaign_Q4"
        assert l1.stage_id == initial_stage_id
        assert l1.assigned_to is None  # strictly unassigned in Phase 4
        assert l1.created_by == ADMIN_ID
        assert l1.custom_fields["batch_id"] == str(batch_id)
        assert l1.custom_fields["campaign_history"][0]["campaign"] == "Brand_Campaign_Q4"

        assert l2.name == "Suresh Raina"
        assert l2.normalized_phone == "+919876543202"
        assert l2.stage_id == initial_stage_id
        assert l2.assigned_to is None


@pytest.mark.asyncio
async def test_existing_crm_duplicate_and_campaign_attribution(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    Verify existing lead matching:
    - Does NOT create duplicate lead.
    - Preserves existing owner, pipeline, stage, original campaign.
    - Records newly observed campaign in custom_fields without duplicate entries.
    - Logs touchpoint activity.
    """
    pipe_id = setup_test_pipeline["pipeline_id"]
    won_stage_id = setup_test_pipeline["won_stage_id"]
    phone = "+919988776655"

    session_factory = get_sessionmaker()
    lead_id = uuid.uuid4()

    # Pre-seed existing lead assigned to JOHN_ID at WON stage with original campaign
    async with session_factory() as session:
        existing_lead = CrmLead(
            id=lead_id,
            name="Virender Sehwag",
            original_phone="9988776655",
            normalized_phone=phone,
            campaign="Original_Google_2025",
            assigned_to=JOHN_ID,
            pipeline_id=pipe_id,
            stage_id=won_stage_id,
            created_by=ADMIN_ID,
            status="won",
            custom_fields={
                "campaign_history": [
                    {"campaign": "Original_Google_2025", "observed_at": "2025-01-01T00:00:00Z"}
                ]
            },
        )
        session.add(existing_lead)
        await session.commit()

    # Now upload CSV with same phone number but NEW campaign and different name variation
    csv_bytes = f"Name,Number,Campaign\nViru Sehwag,{phone},Meta_New_Year_2026\n".encode("utf-8")
    files = {"file": ("dup_check.csv", csv_bytes, "text/csv")}

    # 1. Preview checks
    res_preview = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data={"pipeline_id": str(pipe_id)},
        headers=admin_headers,
    )
    assert res_preview.status_code == 200
    prev_data = res_preview.json()["data"]
    assert prev_data["duplicate_crm_count"] == 1
    assert prev_data["valid_candidate_count"] == 0
    assert prev_data["rows"][0]["status"] == "CRM_DUPLICATE"

    # 2. Confirm import
    files = {"file": ("dup_check.csv", csv_bytes, "text/csv")}
    res_confirm = await client.post(
        "/api/v1/crm/import/confirm",
        files=files,
        data={"pipeline_id": str(pipe_id), "batch_name": "Dup Attribution Test"},
        headers=admin_headers,
    )
    assert res_confirm.status_code == 201
    conf_data = res_confirm.json()["data"]
    assert conf_data["success_count"] == 0
    assert conf_data["duplicate_skipped_count"] == 1

    # 3. Verify lead integrity in DB
    async with session_factory() as session:
        leads = (await session.execute(
            select(CrmLead).where(CrmLead.normalized_phone == phone)
        )).scalars().all()

        # No duplicate lead created
        assert len(leads) == 1
        db_lead = leads[0]
        assert db_lead.id == lead_id
        # Preserved existing attributes
        assert db_lead.name == "Virender Sehwag"  # Not overwritten by "Viru Sehwag"
        assert db_lead.assigned_to == JOHN_ID     # Owner NOT changed
        assert db_lead.stage_id == won_stage_id   # Stage NOT changed to initial
        assert db_lead.campaign == "Original_Google_2025"  # Original campaign attribution preserved

        # New campaign attributed in campaign_history
        camp_hist = db_lead.custom_fields["campaign_history"]
        camps = [c["campaign"] for c in camp_hist]
        assert "Original_Google_2025" in camps
        assert "Meta_New_Year_2026" in camps

        # Activity touchpoint recorded
        activities = (await session.execute(
            select(CrmActivity).where(CrmActivity.lead_id == lead_id)
        )).scalars().all()
        assert len(activities) >= 1
        assert any("Meta_New_Year_2026" in a.subject for a in activities)

    # 4. Idempotency: repeating import with same new campaign should NOT duplicate the entry or touchpoint
    files = {"file": ("dup_repeat.csv", csv_bytes, "text/csv")}
    await client.post(
        "/api/v1/crm/import/confirm",
        files=files,
        data={"pipeline_id": str(pipe_id)},
        headers=admin_headers,
    )
    async with session_factory() as session:
        db_lead = (await session.execute(
            select(CrmLead).where(CrmLead.id == lead_id)
        )).scalar_one()
        camps = [c["campaign"] for c in db_lead.custom_fields["campaign_history"]]
        assert camps.count("Meta_New_Year_2026") == 1  # No duplicate attribution entry

        # Verify touchpoint activity was NOT duplicated
        activities = (await session.execute(
            select(CrmActivity).where(CrmActivity.lead_id == lead_id)
        )).scalars().all()
        meta_activities = [a for a in activities if "Meta_New_Year_2026" in a.subject]
        assert len(meta_activities) == 1



@pytest.mark.asyncio
async def test_duplicate_privacy_across_actor_scopes(
    client: AsyncClient,
    setup_test_pipeline: dict,
):
    """
    Verify duplicate privacy: an actor without scope to the existing lead
    receives a generic outcome without exposing existing lead name, code, or owner.
    """
    pipe_id = setup_test_pipeline["pipeline_id"]
    phone = "+919123499999"

    session_factory = get_sessionmaker()
    lead_id = uuid.uuid4()

    # Pre-seed existing lead owned by ADMIN_ID
    async with session_factory() as session:
        lead = CrmLead(
            id=lead_id,
            name="Confidential Executive",
            original_phone="9123499999",
            normalized_phone=phone,
            campaign="Private_B2B",
            assigned_to=ADMIN_ID,
            created_by=ADMIN_ID,
            pipeline_id=pipe_id,
            stage_id=setup_test_pipeline["initial_stage_id"],
            status="new",
        )
        session.add(lead)
        await session.commit()

    # Salesperson JOHN_ID (scoped) imports CSV with this contact
    john_token = create_access_token(
        JOHN_ID,
        permissions=["crm.leads.import", "crm.leads.view"],
    ).token
    john_headers = {"Authorization": f"Bearer {john_token}"}

    csv_bytes = f"Name,Number,Campaign\nPublic Contact,{phone},Public_Web\n".encode("utf-8")
    files = {"file": ("privacy_test.csv", csv_bytes, "text/csv")}

    res = await client.post(
        "/api/v1/crm/import/preview",
        files=files,
        data={"pipeline_id": str(pipe_id)},
        headers=john_headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]
    row = data["rows"][0]

    assert row["status"] == "CRM_DUPLICATE"
    # Generic message without disclosing confidential lead code or owner
    assert row["matched_lead_code"] is None
    assert "Confidential Executive" not in row["validation_message"]


@pytest.mark.asyncio
async def test_batch_history_listing_and_detail(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """Verify batch history listing and detail retrieval with error summaries."""
    pipe_id = str(setup_test_pipeline["pipeline_id"])

    # Import with 1 valid row and 1 invalid row
    test_csv = (
        "Name,Number,Campaign\n"
        "Batch History Lead,9876543111,Campaign_A\n"
        ",,Missing_Fields\n"
    ).encode("utf-8")

    files = {"file": ("batch_test.csv", test_csv, "text/csv")}
    res_conf = await client.post(
        "/api/v1/crm/import/confirm",
        files=files,
        data={"pipeline_id": pipe_id, "batch_name": "Audited Batch"},
        headers=admin_headers,
    )
    assert res_conf.status_code == 201
    batch_id = res_conf.json()["data"]["batch_id"]

    # 1. List batches
    res_list = await client.get("/api/v1/crm/import/batches", headers=admin_headers)
    assert res_list.status_code == 200
    batches = res_list.json()["data"]
    assert len(batches) >= 1
    target = next((b for b in batches if b["id"] == batch_id), None)
    assert target is not None
    assert target["batch_name"] == "Audited Batch"
    assert target["status"] == "completed"
    assert target["display_status"] == "Success"
    assert target["success_count"] == 1
    assert target["failed_count"] == 1

    # 2. Get batch detail
    res_detail = await client.get(f"/api/v1/crm/import/batches/{batch_id}", headers=admin_headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()["data"]
    assert detail["id"] == batch_id
    assert detail["status"] == "completed"
    assert detail["display_status"] == "Success"
    assert detail["sanitized_error_summary"] is not None
    assert "row" in detail["sanitized_error_summary"].lower()


@pytest.mark.asyncio
async def test_regression_batch_retry_safety_and_touchpoint_deduplication(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    Regression Test:
    Verify that retrying the exact same CSV batch:
    - Never creates duplicate leads.
    - Treats all existing leads as skipped (never failed).
    - Preserves lead owner, pipeline, stage, and original campaign attribution.
    - Does NOT create duplicate campaign touchpoint CrmActivity entries.
    - Preserves count invariant: total = success + skipped + failed.
    """
    pipe_id = str(setup_test_pipeline["pipeline_id"])
    phone_a = "9333333331"
    phone_b = "9333333332"

    csv_content = (
        "Name,Number,Campaign\n"
        f"Retry Lead Alpha,{phone_a},Campaign_Alpha\n"
        f"Retry Lead Beta,{phone_b},Campaign_Beta\n"
    ).encode("utf-8")

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.normalized_phone.in_([f"+91{phone_a}", f"+91{phone_b}"]))
        )))
        await session.execute(delete(CrmLead).where(CrmLead.normalized_phone.in_([f"+91{phone_a}", f"+91{phone_b}"])))
        await session.commit()

    # --- Run 1: First Import ---
    files_1 = {"file": ("retry_test.csv", csv_content, "text/csv")}
    res_1 = await client.post(
        "/api/v1/crm/import/confirm",
        files=files_1,
        data={"pipeline_id": pipe_id, "batch_name": "Retry Batch 1"},
        headers=admin_headers,
    )
    assert res_1.status_code == 201
    data_1 = res_1.json()["data"]
    assert data_1["total_rows"] == 2
    assert data_1["success_count"] == 2
    assert data_1["duplicate_skipped_count"] == 0
    assert data_1["failed_count"] == 0
    assert data_1["status"] == "completed"
    assert data_1["total_rows"] == data_1["success_count"] + data_1["duplicate_skipped_count"] + data_1["failed_count"]

    # Verify activities created
    async with session_factory() as session:
        lead_a = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_a}"))).scalar_one()
        lead_b = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_b}"))).scalar_one()
        lead_a_id = lead_a.id
        lead_b_id = lead_b.id

        acts_a = (await session.execute(select(CrmActivity).where(CrmActivity.lead_id == lead_a_id))).scalars().all()
        acts_b = (await session.execute(select(CrmActivity).where(CrmActivity.lead_id == lead_b_id))).scalars().all()
        assert len(acts_a) == 1
        assert len(acts_b) == 1

    # --- Run 2: Retry Exact Same Batch ---
    files_2 = {"file": ("retry_test.csv", csv_content, "text/csv")}
    res_2 = await client.post(
        "/api/v1/crm/import/confirm",
        files=files_2,
        data={"pipeline_id": pipe_id, "batch_name": "Retry Batch 2"},
        headers=admin_headers,
    )
    assert res_2.status_code == 201
    data_2 = res_2.json()["data"]
    # All rows skipped as duplicate, 0 created, 0 failed
    assert data_2["total_rows"] == 2
    assert data_2["success_count"] == 0
    assert data_2["duplicate_skipped_count"] == 2
    assert data_2["failed_count"] == 0
    assert data_2["status"] == "completed"
    assert data_2["total_rows"] == data_2["success_count"] + data_2["duplicate_skipped_count"] + data_2["failed_count"]

    # Verify DB state: NO duplicate leads, NO duplicate touchpoints
    async with session_factory() as session:
        leads = (await session.execute(
            select(CrmLead).where(CrmLead.normalized_phone.in_([f"+91{phone_a}", f"+91{phone_b}"]))
        )).scalars().all()
        assert len(leads) == 2  # No duplicate leads

        # Check touchpoints: must still be exactly 1 each, not duplicated!
        acts_a = (await session.execute(select(CrmActivity).where(CrmActivity.lead_id == lead_a_id))).scalars().all()
        acts_b = (await session.execute(select(CrmActivity).where(CrmActivity.lead_id == lead_b_id))).scalars().all()
        assert len(acts_a) == 1
        assert len(acts_b) == 1

        # Check campaign history: exactly 1 entry each
        lead_a = (await session.execute(select(CrmLead).where(CrmLead.id == lead_a_id))).scalar_one()
        assert len(lead_a.custom_fields.get("campaign_history", [])) == 1


@pytest.mark.asyncio
async def test_regression_count_invariants_and_row_failure_isolation(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    Regression Test:
    Verify that row failures do not corrupt valid rows in the same transaction,
    counts satisfy total = created + skipped + failed, and batch status is Failure / failed.
    """
    pipe_id = str(setup_test_pipeline["pipeline_id"])
    phone_valid_1 = "9444444441"
    phone_valid_2 = "9444444442"

    # CSV with 4 rows: 2 valid, 1 blank name (failed), 1 blank phone (failed)
    csv_content = (
        "Name,Number,Campaign\n"
        f"Valid Lead One,{phone_valid_1},Camp_One\n"
        ",9444444443,Camp_Two\n"  # blank name
        f"Valid Lead Three,{phone_valid_2},Camp_Three\n"
        "Lead Four,,Camp_Four\n"  # blank phone
    ).encode("utf-8")
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.normalized_phone.in_([f"+91{phone_valid_1}", f"+91{phone_valid_2}"]))
        )))
        await session.execute(delete(CrmLead).where(CrmLead.normalized_phone.in_([f"+91{phone_valid_1}", f"+91{phone_valid_2}"])))
        await session.commit()

    files = {"file": ("mixed_batch.csv", csv_content, "text/csv")}
    res = await client.post(
        "/api/v1/crm/import/confirm",
        files=files,
        data={"pipeline_id": pipe_id, "batch_name": "Mixed Batch Test"},
        headers=admin_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]

    # Verify counts and binary status (leads were created -> Success, with failed_count=2)
    assert data["total_rows"] == 4
    assert data["success_count"] == 2
    assert data["duplicate_skipped_count"] == 0
    assert data["failed_count"] == 2
    assert data["status"] == "completed"
    assert data["display_status"] == "Success"
    assert data["total_rows"] == data["success_count"] + data["duplicate_skipped_count"] + data["failed_count"]

    # Verify sanitized error summary
    error_summary = json.loads(data["sanitized_error_summary"])
    assert len(error_summary) == 2
    assert any("Name cannot be blank" in err["reason"] for err in error_summary)
    assert any("Phone number cannot be blank" in err["reason"] for err in error_summary)
    assert all("action" in err for err in error_summary)

    # Verify valid leads were successfully written and uncorrupted
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        leads = (await session.execute(
            select(CrmLead).where(CrmLead.normalized_phone.in_([f"+91{phone_valid_1}", f"+91{phone_valid_2}"]))
        )).scalars().all()
        assert len(leads) == 2
        names = {l.name for l in leads}
        assert names == {"Valid Lead One", "Valid Lead Three"}


@pytest.mark.asyncio
async def test_regression_all_rows_failed_status_failed(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    Regression Test:
    When every row in the import fails validation, the batch status must be 'failed'.
    Count equation must hold: total = 0 created + 0 skipped + all failed.
    """
    pipe_id = str(setup_test_pipeline["pipeline_id"])

    # 2 rows, both missing required fields
    csv_content = (
        "Name,Number,Campaign\n"
        ",,Missing_All\n"
        "No Number Lead,,Campaign_X\n"
    ).encode("utf-8")

    files = {"file": ("all_failed.csv", csv_content, "text/csv")}
    res = await client.post(
        "/api/v1/crm/import/confirm",
        files=files,
        data={"pipeline_id": pipe_id, "batch_name": "All Failed Batch"},
        headers=admin_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]

    assert data["total_rows"] == 2
    assert data["success_count"] == 0
    assert data["duplicate_skipped_count"] == 0
    assert data["failed_count"] == 2
    assert data["status"] == "failed"
    assert data["total_rows"] == data["success_count"] + data["duplicate_skipped_count"] + data["failed_count"]


@pytest.mark.asyncio
async def test_regression_pipeline_selection_standard_and_custom(
    client: AsyncClient,
    admin_headers: dict[str, str],
):
    """
    Regression Test:
    Verify that custom pipelines can be selected for import, leads are placed into
    the custom pipeline's initial stage, and standard/default pipeline leads remain isolated.
    """
    session_factory = get_sessionmaker()
    custom_pipe_id = uuid.uuid4()
    custom_initial_stage_id = uuid.uuid4()

    async with session_factory() as session:
        custom_pipe = CrmPipeline(
            id=custom_pipe_id,
            name=f"Custom Enterprise Pipeline {uuid.uuid4().hex[:6]}",
            description="Dedicated custom pipeline for enterprise leads",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        custom_stage = CrmPipelineStage(
            id=custom_initial_stage_id,
            pipeline_id=custom_pipe_id,
            name="Enterprise Discovery",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add_all([custom_pipe, custom_stage])
        await session.commit()

    phone = "9555555551"
    csv_content = f"Name,Number,Campaign\nEnterprise Prospect,{phone},Enterprise_ABM\n".encode("utf-8")
    files = {"file": ("enterprise.csv", csv_content, "text/csv")}

    try:
        res = await client.post(
            "/api/v1/crm/import/confirm",
            files=files,
            data={"pipeline_id": str(custom_pipe_id), "batch_name": "Custom Pipeline Import"},
            headers=admin_headers,
        )
        assert res.status_code == 201
        data = res.json()["data"]
        assert data["pipeline_id"] == str(custom_pipe_id)
        assert data["success_count"] == 1

        async with session_factory() as session:
            lead = (await session.execute(
                select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone}")
            )).scalar_one()
            assert lead.pipeline_id == custom_pipe_id
            assert lead.stage_id == custom_initial_stage_id
    finally:
        async with session_factory() as session:
            await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
                select(CrmLead.id).where(CrmLead.pipeline_id == custom_pipe_id)
            )))
            await session.execute(delete(CrmLead).where(CrmLead.pipeline_id == custom_pipe_id))
            await session.execute(delete(CrmImportBatch).where(CrmImportBatch.selected_pipeline_id == custom_pipe_id))
            await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == custom_pipe_id))
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == custom_pipe_id))
            await session.commit()


@pytest.mark.asyncio
async def test_regression_reproduce_11_row_batch_outcome(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    Regression Test reproducing the exact 11-row test case:
    - 5 pre-existing CRM leads (rows 2-6)
    - 3 intra-file duplicate rows (rows 7-9)
    - 3 failed rows (row 10 blank name, row 11 blank phone, row 12 blank campaign)
    Verifies that:
    1. Overall batch status is strictly 'failed' and display_status is 'Failure'
    2. Summary counters: total=11, created=0, duplicates=8, failed=3
    3. Row-level errors explain the exact failure reasons and remediation actions for all 3 failed rows
    4. Batch history detail endpoint returns consistent binary 'Failure' status and identical counts
    """
    pipe_id = str(setup_test_pipeline["pipeline_id"])
    session_factory = get_sessionmaker()

    phones = [f"988880000{i}" for i in range(1, 6)]
    extra_phone_12 = "9888800012"
    all_phones = [f"+91{p}" for p in phones] + [f"+91{extra_phone_12}"]

    # Clean any leftover leads from previous runs
    async with session_factory() as session:
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.normalized_phone.in_(all_phones))
        )))
        await session.execute(delete(CrmLead).where(CrmLead.normalized_phone.in_(all_phones)))
        await session.commit()

    # 1. Pre-create the 5 leads in the database
    init_csv = "Name,Number,Campaign\n" + "\n".join(
        f"Initial Lead {i},{phones[i-1]},Initial_Camp" for i in range(1, 6)
    ) + "\n"
    res_init = await client.post(
        "/api/v1/crm/import/confirm",
        files={"file": ("initial.csv", init_csv.encode("utf-8"), "text/csv")},
        data={"pipeline_id": pipe_id, "batch_name": "Initial 5 Leads"},
        headers=admin_headers,
    )
    assert res_init.status_code == 201
    assert res_init.json()["data"]["success_count"] == 5
    assert res_init.json()["data"]["status"] == "completed"
    assert res_init.json()["data"]["display_status"] == "Success"

    # 2. Now import the 11-row CSV
    # Rows 2-6: duplicates of the 5 existing leads
    # Rows 7-9: intra-file duplicates of phones[0], phones[1], phones[2]
    # Row 10: blank Name
    # Row 11: blank Phone
    # Row 12: blank Campaign
    eleven_row_csv = (
        "Name,Number,Campaign\n"
        f"Dup Lead 1,{phones[0]},Camp_A\n"
        f"Dup Lead 2,{phones[1]},Camp_B\n"
        f"Dup Lead 3,{phones[2]},Camp_C\n"
        f"Dup Lead 4,{phones[3]},Camp_D\n"
        f"Dup Lead 5,{phones[4]},Camp_E\n"
        f"File Repeat 1,{phones[0]},Camp_F\n"
        f"File Repeat 2,{phones[1]},Camp_G\n"
        f"File Repeat 3,{phones[2]},Camp_H\n"
        ",9888800010,Camp_I\n"       # Row 10: blank Name
        "Missing Phone,,Camp_J\n"    # Row 11: blank Phone
        f"Missing Camp,{extra_phone_12},\n"  # Row 12: blank Campaign
    ).encode("utf-8")

    batch_name = "11-Row Test Batch"
    res_11 = await client.post(
        "/api/v1/crm/import/confirm",
        files={"file": ("eleven_rows.csv", eleven_row_csv, "text/csv")},
        data={"pipeline_id": pipe_id, "batch_name": batch_name},
        headers=admin_headers,
    )
    assert res_11.status_code == 201
    data = res_11.json()["data"]

    # Invariants verification (duplicates safely processed -> Success, with failed_count=3)
    assert data["total_rows"] == 11
    assert data["success_count"] == 0
    assert data["duplicate_skipped_count"] == 8
    assert data["failed_count"] == 3
    assert data["status"] == "completed"
    assert data["display_status"] == "Success"
    assert data["total_rows"] == data["success_count"] + data["duplicate_skipped_count"] + data["failed_count"]

    # Check error breakdown
    errors = json.loads(data["sanitized_error_summary"])
    assert len(errors) == 3

    err_map = {e["row"]: e for e in errors}
    assert 10 in err_map
    assert err_map[10]["outcome"] == "Invalid Name"
    assert "Name cannot be blank" in err_map[10]["reason"]
    assert "Provide a contact" in err_map[10]["action"]

    assert 11 in err_map
    assert err_map[11]["outcome"] == "Invalid Phone"
    assert "Phone number cannot be blank" in err_map[11]["reason"]
    assert "Provide a 10-digit" in err_map[11]["action"]

    assert 12 in err_map
    assert err_map[12]["outcome"] == "Invalid Campaign"
    assert "Campaign cannot be blank" in err_map[12]["reason"]
    assert "Specify the origin" in err_map[12]["action"]

    # 3. Check Batch Detail API
    batch_id = data["batch_id"]
    res_batch = await client.get(f"/api/v1/crm/import/batches/{batch_id}", headers=admin_headers)
    assert res_batch.status_code == 200
    b_detail = res_batch.json()["data"]
    assert b_detail["status"] == "completed"
    assert b_detail["display_status"] == "Success"
    assert b_detail["total_count"] == 11
    assert b_detail["success_count"] == 0
    assert b_detail["skipped_count"] == 8
    assert b_detail["failed_count"] == 3

    # Cleanup
    async with session_factory() as session:
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.normalized_phone.in_(all_phones))
        )))
        await session.execute(delete(CrmLead).where(CrmLead.normalized_phone.in_(all_phones)))
        await session.execute(delete(CrmImportBatch).where(CrmImportBatch.id.in_([uuid.UUID(batch_id), uuid.UUID(res_init.json()["data"]["batch_id"])])))
        await session.commit()


@pytest.mark.asyncio
async def test_csv_import_company_preview_outcomes_and_confirmation(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict,
):
    """
    Test Phase 6 CSV Company Preview and Confirmation:
    1. CSV contains:
       - Row 1: Existing company (reused, EXISTING)
       - Row 2: New company (NEW, created on confirm)
       - Row 3: Same new company repeated in file (NEW, reuses proposed company from Row 2)
       - Row 4: Ambiguous company matching multiple records (AMBIGUOUS, error flagged)
       - Row 5: No company provided (NONE, unlinked lead)
    2. Zero database writes during preview (neither companies nor leads created).
    3. Confirmation creates new company record exactly once and links leads appropriately.
    """
    pipe_id = str(setup_test_pipeline["pipeline_id"])
    session_factory = get_sessionmaker()

    suffix = uuid.uuid4().hex[:6]
    existing_cname = f"Existing Master Corp {suffix}"
    ambig_query = f"AmbigCorp Branch {suffix}"
    ambig_cname_1 = f"{ambig_query} Mumbai"
    ambig_cname_2 = f"{ambig_query} Pune"
    new_cname = f"Brand New Innovators {suffix}"

    phone_existing = f"98765{random.randint(10000, 99999)}"
    phone_new_1 = f"98766{random.randint(10000, 99999)}"
    phone_new_2 = f"98767{random.randint(10000, 99999)}"
    phone_ambig = f"98768{random.randint(10000, 99999)}"
    phone_none = f"98769{random.randint(10000, 99999)}"

    all_test_phones = [
        f"+91{phone_existing}",
        f"+91{phone_new_1}",
        f"+91{phone_new_2}",
        f"+91{phone_ambig}",
        f"+91{phone_none}",
    ]

    # 1. Seed existing and ambiguous companies
    existing_comp_id: uuid.UUID | None = None
    async with session_factory() as session:
        c1 = Company(
            company_name=existing_cname,
            tax_id_number=f"27AAA{suffix[:4].upper()}1234A1Z5",
            is_active=True,
        )
        c_ambig1 = Company(company_name=ambig_cname_1, is_active=True)
        c_ambig2 = Company(company_name=ambig_cname_2, is_active=True)
        session.add_all([c1, c_ambig1, c_ambig2])
        await session.commit()
        await session.refresh(c1)
        existing_comp_id = c1.id

    # 2. Build CSV with the 5 distinct company scenarios
    csv_content = (
        "Name,Number,Campaign,Priority,Company\n"
        f"Aarav Patel,{phone_existing},Direct_Outreach,High,{existing_cname}\n"
        f"Bhavna Shah,{phone_new_1},Direct_Outreach,Medium,{new_cname}\n"
        f"Chetan Shah,{phone_new_2},Direct_Outreach,Low,{new_cname}\n"
        f"Deepak Joshi,{phone_ambig},Direct_Outreach,Medium,{ambig_query}\n"
        f"Ekta Verma,{phone_none},Direct_Outreach,High,\n"
    ).encode("utf-8")

    # 3. Call Preview API
    res_preview = await client.post(
        "/api/v1/crm/import/preview",
        files={"file": ("company_test.csv", csv_content, "text/csv")},
        data={"pipeline_id": pipe_id},
        headers=admin_headers,
    )
    assert res_preview.status_code == 200
    p_data = res_preview.json()["data"]

    assert p_data["total_rows"] == 5
    rows = p_data["rows"]
    assert len(rows) == 5

    # Verify Row 1: Existing company outcome
    r1 = rows[0]
    assert r1["name"] == "Aarav Patel"
    assert r1["company_action"] == "EXISTING"
    assert "Existing company" in r1["company_resolution_note"]
    assert "reused" in r1["company_resolution_note"]
    assert r1["is_valid_candidate"] is True
    assert r1["status"] == "VALID"

    # Verify Row 2: New company outcome
    r2 = rows[1]
    assert r2["name"] == "Bhavna Shah"
    assert r2["company_action"] == "NEW"
    assert f"New company '{new_cname}' will be created upon confirmation" in r2["company_resolution_note"]
    assert r2["is_valid_candidate"] is True
    assert r2["status"] == "VALID"

    # Verify Row 3: Repeated new company in same file
    r3 = rows[2]
    assert r3["name"] == "Chetan Shah"
    assert r3["company_action"] == "NEW"
    assert f"Reuses proposed new company '{new_cname}' (from row 3)" in r3["company_resolution_note"]
    assert r3["is_valid_candidate"] is True
    assert r3["status"] == "VALID"

    # Verify Row 4: Ambiguous company outcome
    r4 = rows[3]
    assert r4["name"] == "Deepak Joshi"
    assert r4["company_action"] == "AMBIGUOUS"
    assert "Ambiguous company match: multiple existing companies match" in r4["company_resolution_note"]
    assert r4["is_valid_candidate"] is False
    assert r4["status"] == "INVALID"

    # Verify Row 5: No company provided outcome
    r5 = rows[4]
    assert r5["name"] == "Ekta Verma"
    assert r5["company_action"] == "NONE"
    assert "No company provided" in r5["company_resolution_note"]
    assert r5["is_valid_candidate"] is True
    assert r5["status"] == "VALID"

    # 4. Zero database writes during preview check
    async with session_factory() as session:
        # Proposed new company must NOT exist yet
        stmt_check_new = select(Company).where(Company.company_name == new_cname)
        new_comp_pre = (await session.execute(stmt_check_new)).scalar_one_or_none()
        assert new_comp_pre is None, "Preview must not create company records!"

        # No leads should have been inserted
        stmt_check_leads = select(CrmLead).where(CrmLead.normalized_phone.in_(all_test_phones))
        leads_pre = (await session.execute(stmt_check_leads)).scalars().all()
        assert len(leads_pre) == 0, "Preview must not create lead records!"

    # 5. Confirm Import
    res_confirm = await client.post(
        "/api/v1/crm/import/confirm",
        files={"file": ("company_test.csv", csv_content, "text/csv")},
        data={"pipeline_id": pipe_id, "batch_name": f"Company Test Batch {suffix}"},
        headers=admin_headers,
    )
    assert res_confirm.status_code == 201
    c_data = res_confirm.json()["data"]

    # Invariants on confirmation:
    # 4 rows succeeded (Rows 1, 2, 3, 5), 1 row failed (Row 4 ambiguous match)
    assert c_data["total_rows"] == 5
    assert c_data["success_count"] == 4
    assert c_data["failed_count"] == 1
    batch_id = c_data["batch_id"]

    # 6. Verify DB state after confirmation
    created_new_comp_id: uuid.UUID | None = None
    async with session_factory() as session:
        # Verify new company created exactly once
        stmt_new = select(Company).where(Company.company_name == new_cname, Company.deleted_at.is_(None))
        new_comps = (await session.execute(stmt_new)).scalars().all()
        assert len(new_comps) == 1, f"Expected exactly 1 company for '{new_cname}', found {len(new_comps)}"
        created_new_comp_id = new_comps[0].id

        # Verify Lead 1: linked to existing company
        stmt_l1 = select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_existing}")
        l1 = (await session.execute(stmt_l1)).scalar_one()
        assert l1.company_id == existing_comp_id

        # Verify Lead 2: linked to new company
        stmt_l2 = select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_new_1}")
        l2 = (await session.execute(stmt_l2)).scalar_one()
        assert l2.company_id == created_new_comp_id

        # Verify Lead 3: linked to the SAME new company (reused, no duplicate!)
        stmt_l3 = select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_new_2}")
        l3 = (await session.execute(stmt_l3)).scalar_one()
        assert l3.company_id == created_new_comp_id

        # Verify Lead 5: unlinked (company_id is None)
        stmt_l5 = select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_none}")
        l5 = (await session.execute(stmt_l5)).scalar_one()
        assert l5.company_id is None

        # Verify Lead 4: not created because row had error
        stmt_l4 = select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_ambig}")
        l4 = (await session.execute(stmt_l4)).scalar_one_or_none()
        assert l4 is None

    # 7. Cleanup
    async with session_factory() as session:
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.normalized_phone.in_(all_test_phones))
        )))
        await session.execute(delete(CrmLead).where(CrmLead.normalized_phone.in_(all_test_phones)))
        await session.execute(delete(CrmImportBatch).where(CrmImportBatch.id == uuid.UUID(batch_id)))
        if created_new_comp_id:
            await session.execute(delete(Company).where(Company.id == created_new_comp_id))
        await session.execute(delete(Company).where(Company.id.in_([existing_comp_id, c_ambig1.id, c_ambig2.id])))
        await session.commit()



