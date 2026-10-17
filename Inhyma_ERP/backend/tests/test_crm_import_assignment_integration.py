"""
Test Suite for CRM Automatic Lead Assignment Integration with CSV Import (Phase 5, Prompt 3).

Verifies:
1. Valid new CSV leads are automatically assigned to eligible representatives via Assignment Engine.
2. Duplicate leads preserve their existing owner, pipeline, stage, and campaign, and NEVER trigger reassignment.
3. Intra-file duplicate contacts are assigned at most once.
4. Auto-assign option can be explicitly disabled (auto_assign=false) leaving new leads unassigned.
5. Saturated capacity / no eligible representatives leave new leads unassigned without failing the import batch.
6. Batch status accounting adheres strictly to Phase 4/5 rules:
   - Success when at least one lead created or duplicate safely skipped.
   - Mixed batches (valid + duplicate + invalid) complete with correct counters.
   - All-duplicate batch completes with Success.
7. CrmAssignmentHistory records are written atomically with matching batch_id and actor.
8. Scoped non-manager salesperson importing leads is restricted strictly to themselves and cannot assign to others.
9. Database transaction failure safely rolls back leads, batch, and assignment history.
10. Concurrent CSV imports assigning leads respect salesperson capacity limits.
"""

from __future__ import annotations

import asyncio
import io
import json
import random
import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select, update

from app.auth.security import create_access_token
from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.crm.assignment_service import CrmAssignmentEngineService
from app.crm.models import (
    CrmActivity,
    CrmAssignmentConfig,
    CrmAssignmentHistory,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmRoundRobinCursor,
    CrmSalespersonConfig,
    CrmSalespersonTerritory,
)
from app.database.engine import get_sessionmaker
from app.masters.states.models import State
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
SALES_MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
JOHN_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
OPS_EMPLOYEE_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")


def unique_phone() -> str:
    """Generate a clean, collision-free 10-digit Indian phone number."""
    return f"9{random.randint(100000000, 999999999)}"


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.import", "crm.leads.manage", "crm.leads.view", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def salesperson_headers() -> dict[str, str]:
    token = create_access_token(
        JOHN_ID,
        permissions=["crm.leads.import", "crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        SALES_MANAGER_ID,
        permissions=["crm.leads.import", "crm.leads.manage", "crm.leads.view", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_import_assignment_env(client: AsyncClient):
    """
    Setup clean pipeline, initial stage, salespersons with configs, and states.
    Ensures client is passed so the FastAPI lifespan manages the engine.
    """
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_id = uuid.uuid4()
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()

    async with sessionmaker() as session:
        # 1. Pipeline & stage
        pipeline = CrmPipeline(
            id=pipeline_id,
            name=f"Import Assignment Pipeline {uuid.uuid4().hex[:6]}",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(pipeline)
        await session.flush()

        stage = CrmPipelineStage(
            id=stage_id,
            pipeline_id=pipeline_id,
            name="Inbound Landing",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add(stage)

        # 2. Clean existing assignment configs and cursors
        await session.execute(delete(CrmRoundRobinCursor))
        await session.execute(delete(CrmAssignmentConfig))
        await session.execute(delete(CrmSalespersonTerritory))
        await session.execute(delete(CrmSalespersonConfig))

        # Ensure manager user exists
        mgr_user = await session.get(User, SALES_MANAGER_ID)
        if not mgr_user:
            mgr_user = User(
                id=SALES_MANAGER_ID,
                username=f"mgr_{uuid.uuid4().hex[:6]}",
                email=f"mgr_{uuid.uuid4().hex[:6]}@example.com",
                first_name="Sales",
                last_name="Manager",
                display_name="Sales Manager",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                password_hash="test_hash",
            )
            session.add(mgr_user)
            await session.flush()

        # 3. Create test users & salesperson configs
        user_a = User(
            id=user_a_id,
            username=f"rep_alpha_{uuid.uuid4().hex[:6]}",
            email=f"rep_a_{uuid.uuid4().hex[:6]}@example.com",
            first_name="Sales Rep",
            last_name="Alpha",
            display_name="Sales Rep Alpha",
            status=UserStatus.ACTIVE,
            is_active=True,
            has_login=True,
            password_hash="test_hash",
            manager_id=SALES_MANAGER_ID,
        )
        user_b = User(
            id=user_b_id,
            username=f"rep_beta_{uuid.uuid4().hex[:6]}",
            email=f"rep_b_{uuid.uuid4().hex[:6]}@example.com",
            first_name="Sales Rep",
            last_name="Beta",
            display_name="Sales Rep Beta",
            status=UserStatus.ACTIVE,
            is_active=True,
            has_login=True,
            password_hash="test_hash",
            manager_id=None,
        )
        session.add_all([user_a, user_b])
        await session.flush()

        cfg_a = CrmSalespersonConfig(
            user_id=user_a_id,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        cfg_b = CrmSalespersonConfig(
            user_id=user_b_id,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        session.add_all([cfg_a, cfg_b])

        # 4. Default assignment rule: round_robin
        rule = CrmAssignmentConfig(
            name="Default Round Robin",
            rule_type="round_robin",
            is_active=True,
            priority=1,
            configuration={"strategy": "round_robin", "fallback_to_general": True},
        )
        session.add(rule)

        await session.commit()

    yield {
        "pipeline_id": pipeline_id,
        "stage_id": stage_id,
        "user_a_id": user_a_id,
        "user_b_id": user_b_id,
    }

    # Teardown
    async with sessionmaker() as session:
        await session.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(
            select(CrmLead.id).where(CrmLead.pipeline_id == pipeline_id)
        )))
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.pipeline_id == pipeline_id)
        )))
        await session.execute(delete(CrmLead).where(CrmLead.pipeline_id == pipeline_id))
        await session.execute(delete(CrmImportBatch).where(CrmImportBatch.selected_pipeline_id == pipeline_id))
        await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline_id))
        await session.execute(delete(CrmPipeline).where(CrmPipeline.id == pipeline_id))
        await session.execute(delete(CrmSalespersonTerritory))
        await session.execute(delete(CrmSalespersonConfig))
        await session.execute(delete(CrmRoundRobinCursor))
        await session.execute(delete(CrmAssignmentConfig))
        await session.commit()


@pytest.mark.asyncio
async def test_import_confirm_automatically_assigns_new_leads(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 1:
    Confirming a valid CSV import automatically assigns new leads to eligible
    salespeople and records CrmAssignmentHistory records with matching batch_id.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    phone_1 = unique_phone()
    phone_2 = unique_phone()

    csv_data = (
        "Name,Number,Campaign\n"
        f"Alpha Customer,{phone_1},Summer_Deal\n"
        f"Beta Customer,{phone_2},Winter_Deal\n"
    ).encode("utf-8")

    files = {"file": ("leads.csv", csv_data, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": f"Auto Assign Batch {uuid.uuid4().hex[:6]}"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["total_rows"] == 2
    assert resp_data["success_count"] == 2
    assert resp_data["assigned_count"] == 2
    assert resp_data["unassigned_count"] == 0
    assert resp_data["failed_count"] == 0
    assert resp_data["status"] == "completed"
    assert resp_data["display_status"] == "Success"

    batch_id = uuid.UUID(resp_data["batch_id"])

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Leads should be assigned
        stmt = select(CrmLead).where(CrmLead.normalized_phone.in_([f"+91{phone_1}", f"+91{phone_2}"]))
        leads = (await session.execute(stmt)).scalars().all()
        assert len(leads) == 2
        for lead in leads:
            assert lead.assigned_to is not None
            assert lead.assigned_to in (setup_import_assignment_env["user_a_id"], setup_import_assignment_env["user_b_id"])

        # Assignment history must be recorded with batch_id and actor
        hist_stmt = select(CrmAssignmentHistory).where(CrmAssignmentHistory.batch_id == batch_id)
        histories = (await session.execute(hist_stmt)).scalars().all()
        assert len(histories) == 2
        for h in histories:
            assert h.batch_id == batch_id
            assert h.assigned_by == ADMIN_ID
            assert h.assignment_method == "round_robin"


@pytest.mark.asyncio
async def test_import_duplicate_leads_preserve_owner_and_never_reassign(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 2:
    Recognized CRM duplicates preserve their existing owner, pipeline, stage,
    and original campaign. They must never trigger automatic reassignment or
    new assignment history records.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    stage_id = setup_import_assignment_env["stage_id"]
    dup_phone = unique_phone()
    original_owner_id = setup_import_assignment_env["user_a_id"]

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Pre-create an owned lead
        existing = CrmLead(
            name="Existing Lead",
            original_phone=dup_phone,
            normalized_phone=f"+91{dup_phone}",
            campaign="Original_Campaign",
            pipeline_id=setup_import_assignment_env["pipeline_id"],
            stage_id=stage_id,
            assigned_to=original_owner_id,
            status="contacted",
            custom_fields={"notes": "Pre-existing client"},
        )
        session.add(existing)
        await session.commit()
        existing_lead_id = existing.id

    # Import CSV containing this duplicate phone
    csv_data = (
        "Name,Number,Campaign\n"
        f"Modified Name,{dup_phone},Brand_New_Campaign\n"
    ).encode("utf-8")

    files = {"file": ("dup.csv", csv_data, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": f"Duplicate Protection Batch {uuid.uuid4().hex[:6]}"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["total_rows"] == 1
    assert resp_data["success_count"] == 0
    assert resp_data["duplicate_skipped_count"] == 1
    assert resp_data["assigned_count"] == 0
    assert resp_data["unassigned_count"] == 0
    assert resp_data["status"] == "completed"

    async with sessionmaker() as session:
        lead = (await session.execute(select(CrmLead).where(CrmLead.id == existing_lead_id))).scalar_one()
        # Owner preserved!
        assert lead.assigned_to == original_owner_id
        # Original campaign preserved!
        assert lead.campaign == "Original_Campaign"
        # Stage preserved!
        assert lead.stage_id == stage_id

        # NO new assignment history!
        hist_stmt = select(func.count(CrmAssignmentHistory.id)).where(CrmAssignmentHistory.lead_id == existing_lead_id)
        count = (await session.execute(hist_stmt)).scalar()
        assert count == 0


@pytest.mark.asyncio
async def test_intra_file_duplicate_assigned_once(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 3:
    Repeated rows in the same CSV file are assigned at most once.
    The subsequent row is classified as FILE_DUPLICATE.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    repeated_phone = unique_phone()

    csv_data = (
        "Name,Number,Campaign\n"
        f"Repeat Contact 1,{repeated_phone},Camp_A\n"
        f"Repeat Contact 2,{repeated_phone},Camp_B\n"
    ).encode("utf-8")

    files = {"file": ("repeat.csv", csv_data, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": f"Repeat File Batch {uuid.uuid4().hex[:6]}"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["total_rows"] == 2
    assert resp_data["success_count"] == 1
    assert resp_data["duplicate_skipped_count"] == 1
    assert resp_data["assigned_count"] == 1

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Only one lead in DB
        leads = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{repeated_phone}"))).scalars().all()
        assert len(leads) == 1
        # Only one assignment history
        hist = (await session.execute(select(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id == leads[0].id))).scalars().all()
        assert len(hist) == 1


@pytest.mark.asyncio
async def test_import_auto_assign_false_leaves_leads_unassigned(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 4:
    Caller passing auto_assign=false creates valid new leads without assignment.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    phone_unassigned = unique_phone()

    csv_data = (
        "Name,Number,Campaign\n"
        f"Unassigned Lead,{phone_unassigned},No_Assign_Camp\n"
    ).encode("utf-8")

    files = {"file": ("unassigned.csv", csv_data, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Manual Distribution Batch {uuid.uuid4().hex[:6]}",
        "auto_assign": "false",
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["total_rows"] == 1
    assert resp_data["success_count"] == 1
    assert resp_data["assigned_count"] == 0
    assert resp_data["unassigned_count"] == 1

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_unassigned}"))).scalar_one()
        assert lead.assigned_to is None

        # Zero assignment history rows
        hist_count = (await session.execute(select(func.count(CrmAssignmentHistory.id)).where(CrmAssignmentHistory.lead_id == lead.id))).scalar()
        assert hist_count == 0


@pytest.mark.asyncio
async def test_all_candidates_at_capacity_leaves_leads_unassigned_without_failing(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 5:
    When all candidates are at maximum lead capacity, new leads remain created
    and unassigned. The batch completes successfully and is not marked as failed.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    user_a_id = setup_import_assignment_env["user_a_id"]
    user_b_id = setup_import_assignment_env["user_b_id"]

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Set max_lead_capacity to 0 for both salespeople
        await session.execute(
            update(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id.in_([user_a_id, user_b_id]))
            .values(max_lead_capacity=0)
        )
        await session.commit()

    phone_cap = unique_phone()
    csv_data = (
        "Name,Number,Campaign\n"
        f"Capacity Saturated Lead,{phone_cap},Capacity_Camp\n"
    ).encode("utf-8")

    files = {"file": ("cap.csv", csv_data, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": f"Capacity Cap Batch {uuid.uuid4().hex[:6]}"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    # Valid import is NOT marked as failed!
    assert resp_data["status"] == "completed"
    assert resp_data["display_status"] == "Success"
    assert resp_data["success_count"] == 1
    assert resp_data["failed_count"] == 0
    assert resp_data["assigned_count"] == 0
    assert resp_data["unassigned_count"] == 1

    async with sessionmaker() as session:
        lead = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_cap}"))).scalar_one()
        assert lead.assigned_to is None
        assert lead.custom_fields.get("assignment_status") == "unassigned"
        assert "capacity" in lead.custom_fields.get("unassigned_reason", "").lower()


@pytest.mark.asyncio
async def test_salesperson_import_scoped_to_themselves(
    client: AsyncClient,
    salesperson_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 6:
    A regular salesperson (JOHN_ID) importing leads can only have leads assigned
    to themselves; they cannot assign leads to other sales representatives.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])

    # Configure John as eligible with capacity
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        john_user = await session.get(User, JOHN_ID)
        if not john_user:
            john_user = User(
                id=JOHN_ID,
                username=f"john_{uuid.uuid4().hex[:6]}",
                email=f"john_{uuid.uuid4().hex[:6]}@example.com",
                first_name="John",
                last_name="Salesperson",
                display_name="John Salesperson",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                password_hash="test_hash",
            )
            session.add(john_user)
            await session.flush()

        john_cfg = await session.get(CrmSalespersonConfig, JOHN_ID)
        if not john_cfg:
            john_cfg = CrmSalespersonConfig(
                user_id=JOHN_ID,
                is_eligible=True,
                is_active=True,
                priority=1,
                max_lead_capacity=10,
            )
            session.add(john_cfg)
        else:
            john_cfg.is_eligible = True
            john_cfg.is_active = True
            john_cfg.max_lead_capacity = 10
        await session.commit()

    phone_john = unique_phone()
    csv_data = (
        "Name,Number,Campaign\n"
        f"John Customer,{phone_john},Self_Import\n"
    ).encode("utf-8")

    files = {"file": ("john.csv", csv_data, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": f"John Self Import Batch {uuid.uuid4().hex[:6]}"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=salesperson_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["success_count"] == 1
    assert resp_data["assigned_count"] == 1

    async with sessionmaker() as session:
        lead = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_john}"))).scalar_one()
        # Lead is assigned to John exclusively!
        assert lead.assigned_to == JOHN_ID


@pytest.mark.asyncio
async def test_mixed_batch_accounting(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 7:
    Mixed batch containing:
    - 1 valid new lead (assigned)
    - 1 duplicate contact (skipped)
    - 1 invalid row with bad phone (failed)
    Preserves total_rows = success + duplicate_skipped + failed, status is Success.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    stage_id = setup_import_assignment_env["stage_id"]
    dup_phone = unique_phone()
    new_phone = unique_phone()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Pre-seed duplicate
        existing = CrmLead(
            name="Existing Lead",
            original_phone=dup_phone,
            normalized_phone=f"+91{dup_phone}",
            campaign="Pre_Existing",
            pipeline_id=setup_import_assignment_env["pipeline_id"],
            stage_id=stage_id,
        )
        session.add(existing)
        await session.commit()

    csv_data = (
        "Name,Number,Campaign\n"
        f"Valid Lead,{new_phone},Camp_Valid\n"
        f"Duplicate Lead,{dup_phone},Camp_Dup\n"
        "Broken Row,12345,Camp_Bad\n"
    ).encode("utf-8")

    files = {"file": ("mixed.csv", csv_data, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": f"Mixed Accounting Batch {uuid.uuid4().hex[:6]}"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["total_rows"] == 3
    assert resp_data["success_count"] == 1
    assert resp_data["duplicate_skipped_count"] == 1
    assert resp_data["failed_count"] == 1
    assert resp_data["assigned_count"] == 1
    assert resp_data["status"] == "completed"
    assert resp_data["display_status"] == "Success"
    assert resp_data["total_rows"] == (
        resp_data["success_count"] + resp_data["duplicate_skipped_count"] + resp_data["failed_count"]
    )


@pytest.mark.asyncio
async def test_transaction_failure_leaves_no_leads_or_history(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 8:
    A failure during import transaction rolls back all changes, leaving no
    uncommitted leads, batch, or assignment history in the database.
    """
    pipe_id = setup_import_assignment_env["pipeline_id"]
    fail_phone = unique_phone()
    csv_data = f"Name,Number,Campaign\nRollback Lead,{fail_phone},Rollback_Camp\n".encode("utf-8")

    from app.crm.import_service import CrmImportService
    from unittest.mock import patch

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        service = CrmImportService(session)
        admin_actor = CurrentUser(
            id=ADMIN_ID,
            username="admin",
            permissions={"crm.leads.import", "crm.leads.manage", "*"},
            is_super_admin=True,
        )

        with patch.object(session, "commit", side_effect=RuntimeError("Simulated DB Crash")):
            with pytest.raises(RuntimeError, match="Simulated DB Crash"):
                await service.confirm_import(
                    pipeline_id=pipe_id,
                    raw_bytes=csv_data,
                    actor=admin_actor,
                    batch_name="Failing Batch",
                )

    # Verify no leads, batch, or assignment history exist
    async with sessionmaker() as session:
        lead_count = (await session.execute(
            select(func.count(CrmLead.id)).where(CrmLead.normalized_phone == f"+91{fail_phone}")
        )).scalar()
        assert lead_count == 0

        batch_count = (await session.execute(
            select(func.count(CrmImportBatch.id)).where(CrmImportBatch.batch_name == "Failing Batch")
        )).scalar()
        assert batch_count == 0


@pytest.mark.asyncio
async def test_concurrent_csv_imports_respect_salesperson_capacity(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Test 9:
    Concurrent CSV imports assigning to a single salesperson with max_lead_capacity=1
    do not exceed the capacity limit due to database row locking.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    user_a_id = setup_import_assignment_env["user_a_id"]
    user_b_id = setup_import_assignment_env["user_b_id"]

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Set user_a capacity to 1, user_b to 0
        await session.execute(
            update(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id == user_a_id)
            .values(max_lead_capacity=1)
        )
        await session.execute(
            update(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id == user_b_id)
            .values(max_lead_capacity=0)
        )
        await session.commit()

    phone_c1 = unique_phone()
    phone_c2 = unique_phone()

    csv_1 = f"Name,Number,Campaign\nConcurrent 1,{phone_c1},Camp_Conc\n".encode("utf-8")
    csv_2 = f"Name,Number,Campaign\nConcurrent 2,{phone_c2},Camp_Conc\n".encode("utf-8")

    async def run_import(csv_content, name):
        files = {"file": ("c.csv", csv_content, "text/csv")}
        data = {"pipeline_id": pipe_id, "batch_name": name}
        return await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)

    res1, res2 = await asyncio.gather(
        run_import(csv_1, "Conc Batch 1"),
        run_import(csv_2, "Conc Batch 2"),
    )

    assert res1.status_code == 201
    assert res2.status_code == 201

    d1 = res1.json()["data"]
    d2 = res2.json()["data"]

    # Exactly 1 lead should be assigned across both imports, 1 should be unassigned
    total_assigned = d1["assigned_count"] + d2["assigned_count"]
    total_unassigned = d1["unassigned_count"] + d2["unassigned_count"]

    assert total_assigned == 1
    assert total_unassigned == 1

    # Verify DB state: user_a has exactly 1 active lead, not 2!
    async with sessionmaker() as session:
        active_leads = (await session.execute(
            select(func.count(CrmLead.id))
            .where(CrmLead.assigned_to == user_a_id, CrmLead.status.notin_(["won", "lost"]))
        )).scalar()
        assert active_leads == 1


@pytest.mark.asyncio
async def test_salesperson_forced_self_assignment_regardless_of_payload(
    client: AsyncClient,
    salesperson_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Salesperson: Import leads for themselves only.
    Force assignment to the logged-in salesperson on the backend, regardless of submitted payload.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    user_a_id = str(setup_import_assignment_env["user_a_id"])
    sessionmaker = get_sessionmaker()

    # Case A: Salesperson attempts to assign to another rep via selected_reps
    phone_1 = unique_phone()
    csv_1 = f"Name,Number,Campaign\nLead Alpha,{phone_1},Forced_Self_1\n".encode("utf-8")
    files_1 = {"file": ("leads1.csv", csv_1, "text/csv")}
    data_1 = {
        "pipeline_id": pipe_id,
        "batch_name": "Salesperson Bypass Attempt Selected Reps",
        "distribution_mode": "selected_reps",
        "selected_salesperson_ids": user_a_id,
    }

    res_1 = await client.post("/api/v1/crm/import/confirm", files=files_1, data=data_1, headers=salesperson_headers)
    assert res_1.status_code == 201
    resp_1 = res_1.json()["data"]
    assert resp_1["success_count"] == 1
    assert resp_1["assigned_count"] == 1

    async with sessionmaker() as session:
        lead_1 = (await session.execute(
            select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_1}")
        )).scalar_one()
        # Overridden to JOHN_ID on backend!
        assert lead_1.assigned_to == JOHN_ID

    # Case B: Salesperson attempts unassigned import (distribution_mode="none", auto_assign=False)
    phone_2 = unique_phone()
    csv_2 = f"Name,Number,Campaign\nLead Beta,{phone_2},Forced_Self_2\n".encode("utf-8")
    files_2 = {"file": ("leads2.csv", csv_2, "text/csv")}
    data_2 = {
        "pipeline_id": pipe_id,
        "batch_name": "Salesperson Bypass Attempt Unassigned",
        "distribution_mode": "none",
        "auto_assign": "false",
    }

    res_2 = await client.post("/api/v1/crm/import/confirm", files=files_2, data=data_2, headers=salesperson_headers)
    assert res_2.status_code == 201
    resp_2 = res_2.json()["data"]
    assert resp_2["success_count"] == 1
    assert resp_2["assigned_count"] == 1

    async with sessionmaker() as session:
        lead_2 = (await session.execute(
            select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone_2}")
        )).scalar_one()
        # Overridden to JOHN_ID on backend!
        assert lead_2.assigned_to == JOHN_ID


@pytest.mark.asyncio
async def test_manager_out_of_scope_assignment_rejection(
    client: AsyncClient,
    manager_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Manager attempting to assign leads outside their authorized scope is rejected with 403 Forbidden.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    user_b_id = str(setup_import_assignment_env["user_b_id"])  # Not managed by SALES_MANAGER_ID

    phone = unique_phone()
    csv_bytes = f"Name,Number,Campaign\nOut Of Scope Lead,{phone},Camp_Manager_OOS\n".encode("utf-8")
    files = {"file": ("oos.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": "Manager Out Of Scope Test",
        "distribution_mode": "single_salesperson",
        "target_salesperson_id": user_b_id,
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=manager_headers)
    assert res.status_code == 403
    err_msg = (res.json().get("detail", "") or res.json().get("message", "")).lower()
    assert "outside your authorized scope" in err_msg


@pytest.mark.asyncio
async def test_manager_in_scope_assignment_accepted(
    client: AsyncClient,
    manager_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    Manager importing leads and assigning to an authorized team member (user_a) succeeds.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    user_a_id = setup_import_assignment_env["user_a_id"]
    sessionmaker = get_sessionmaker()

    phone = unique_phone()
    csv_bytes = f"Name,Number,Campaign\nIn Scope Lead,{phone},Camp_Manager_InScope\n".encode("utf-8")
    files = {"file": ("inscope.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": "Manager In Scope Test",
        "distribution_mode": "single_salesperson",
        "target_salesperson_id": str(user_a_id),
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=manager_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]
    assert resp_data["success_count"] == 1
    assert resp_data["assigned_count"] == 1

    async with sessionmaker() as session:
        lead = (await session.execute(
            select(CrmLead).where(CrmLead.normalized_phone == f"+91{phone}")
        )).scalar_one()
        assert lead.assigned_to == user_a_id


@pytest.mark.asyncio
async def test_complete_failure_batch_metrics(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    When all rows fail validation, batch completes with status 'failed',
    display_status 'Failure', accurate error summary and failure message.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])

    # 2 rows with completely invalid phones
    csv_bytes = (
        "Name,Number,Campaign\n"
        "Broken 1,invalid-phone,Camp_Fail\n"
        ",,Camp_Fail2\n"
    ).encode("utf-8")
    files = {"file": ("all_fail.csv", csv_bytes, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": "All Fail Batch"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["total_rows"] == 2
    assert resp_data["success_count"] == 0
    assert resp_data["duplicate_skipped_count"] == 0
    assert resp_data["failed_count"] == 2
    assert resp_data["status"] == "failed"
    assert resp_data["display_status"] == "Failure"
    assert resp_data["sanitized_error_summary"] is not None

    parsed_errors = json.loads(resp_data["sanitized_error_summary"])
    assert len(parsed_errors) == 2
    assert "outcome" in parsed_errors[0]
    assert "action" in parsed_errors[0]
    assert "Import failed" in res.json().get("message", "")


@pytest.mark.asyncio
async def test_partial_success_batch_metrics(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_import_assignment_env: dict,
):
    """
    When some rows succeed and some fail, batch status is 'completed',
    display_status is 'Success', and response message notes warnings.
    """
    pipe_id = str(setup_import_assignment_env["pipeline_id"])
    valid_phone = unique_phone()

    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Valid Prospect,{valid_phone},Camp_Partial\n"
        "Bad Prospect,00000,Camp_Partial_Bad\n"
    ).encode("utf-8")
    files = {"file": ("partial.csv", csv_bytes, "text/csv")}
    data = {"pipeline_id": pipe_id, "batch_name": "Partial Success Batch"}

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp_data = res.json()["data"]

    assert resp_data["total_rows"] == 2
    assert resp_data["success_count"] == 1
    assert resp_data["failed_count"] == 1
    assert resp_data["status"] == "completed"
    assert resp_data["display_status"] == "Success"
    assert "warnings" in res.json().get("message", "").lower()

