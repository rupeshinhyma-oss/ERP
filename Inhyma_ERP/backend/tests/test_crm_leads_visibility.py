"""
Test Suite for CRM Lead Database Visibility, Ownership Verification, and Assignment History.

Verifies:
1. Lead database listing with ownership status (salesperson name vs "Unassigned").
2. Server-side search, pagination, and multi-parameter filtering.
3. Dedicated unassigned filtering returning persisted unassigned reasons.
4. Salesperson scoping (can only see assigned or self-created leads).
5. Manager departmental scoping (can see team members and unassigned leads, cannot see other teams).
6. Persisted assignment history endpoint (/crm/assignment-history) with pagination and scoping.
7. Single lead detail endpoint with RBAC enforcement.
8. Import batch history enriched with assigned_count and unassigned_count.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.service import CurrentUser
from app.crm.dependencies import get_crm_lead_service
from app.crm.lead_service import CrmLeadService
from app.crm.models import (
    CrmAssignmentHistory,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmSalespersonConfig,
)
from app.database.engine import get_sessionmaker
from app.main import app
from app.users.models import User, UserStatus


ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
SALES_MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")  # Direct report of manager
REP_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")  # External user / other team


@pytest.fixture
def admin_actor() -> CurrentUser:
    return CurrentUser(
        id=ADMIN_ID,
        username="admin",
        permissions={"crm.leads.view", "crm.leads.manage", "*"},
        is_super_admin=True,
    )


@pytest.fixture
def manager_actor() -> CurrentUser:
    return CurrentUser(
        id=SALES_MANAGER_ID,
        username="sales_manager",
        permissions={"crm.leads.view", "crm.leads.manage"},
        is_super_admin=False,
    )


@pytest.fixture
def rep_a_actor() -> CurrentUser:
    return CurrentUser(
        id=REP_A_ID,
        username="rep_a",
        permissions={"crm.leads.view"},
        is_super_admin=False,
    )


@pytest.fixture
async def setup_visibility_data():
    """Create test pipeline, stages, users, leads, and assignment history."""
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_id = uuid.uuid4()
    batch_id = uuid.uuid4()

    suffix = uuid.uuid4().hex[:6]
    phone_suffix = str(uuid.uuid4().int)[:6]

    async with sessionmaker() as session:
        # 1. Clean existing test leads and history
        await session.execute(delete(CrmAssignmentHistory))
        await session.execute(delete(CrmLead))
        await session.execute(delete(CrmImportBatch))

        # Ensure test users exist
        for u_id, u_name, u_role, mgr_id in [
            (ADMIN_ID, "admin_user", "Admin", None),
            (SALES_MANAGER_ID, "sales_mgr", "Manager", None),
            (REP_A_ID, "rep_alpha", "Rep A", SALES_MANAGER_ID),
            (REP_B_ID, "rep_beta", "Rep B", None),
        ]:
            u = await session.get(User, u_id)
            if not u:
                u = User(
                    id=u_id,
                    username=f"{u_name}_{uuid.uuid4().hex[:6]}",
                    email=f"{u_name}_{uuid.uuid4().hex[:6]}@example.com",
                    first_name=u_role,
                    last_name="Test",
                    display_name=f"{u_role} Test",
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    password_hash="test_hash",
                    manager_id=mgr_id,
                )
                session.add(u)
            else:
                u.manager_id = mgr_id
        await session.flush()

        # 2. Pipeline and stage
        pipe = CrmPipeline(
            id=pipeline_id,
            name=f"Visibility Pipeline {suffix}",
            is_default=False,
            is_active=True,
        )
        stage = CrmPipelineStage(
            id=stage_id,
            pipeline_id=pipeline_id,
            name="New Landing Stage",
            stage_order=1,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add_all([pipe, stage])

        # 3. Import Batch
        batch = CrmImportBatch(
            id=batch_id,
            batch_name=f"Visibility Batch {suffix}",
            import_source="csv",
            selected_pipeline_id=pipeline_id,
            initiated_by=ADMIN_ID,
            status="completed",
            total_count=3,
            success_count=3,
            failed_count=0,
            skipped_count=0,
        )
        session.add(batch)

        # 4. Create Leads:
        # Lead 1: Assigned to Rep A
        lead_1 = CrmLead(
            id=uuid.uuid4(),
            lead_code=f"LD-{suffix}-001",
            name="Alpha Customer",
            original_phone=f"+9198{phone_suffix}01",
            normalized_phone=f"+9198{phone_suffix}01",
            email=f"alpha_{suffix}@example.com",
            company_name="Alpha Tech",
            campaign="Google Ads 2026",
            source_type="company_campaign",
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            status="new",
            priority="high",
        )
        # Lead 2: Assigned to Rep B (Other team)
        lead_2 = CrmLead(
            id=uuid.uuid4(),
            lead_code=f"LD-{suffix}-002",
            name="Beta Enterprise",
            original_phone=f"+9198{phone_suffix}02",
            normalized_phone=f"+9198{phone_suffix}02",
            email=f"beta_{suffix}@example.com",
            company_name="Beta Logistics",
            campaign="LinkedIn Outreach",
            source_type="company_campaign",
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            created_by=ADMIN_ID,
            assigned_to=REP_B_ID,
            status="contacted",
            priority="medium",
        )
        # Lead 3: Unassigned with persisted reason
        lead_3 = CrmLead(
            id=uuid.uuid4(),
            lead_code=f"LD-{suffix}-003",
            name="Gamma Unassigned Lead",
            original_phone=f"+9198{phone_suffix}03",
            normalized_phone=f"+9198{phone_suffix}03",
            email=f"gamma_{suffix}@example.com",
            company_name="Gamma Industries",
            campaign="Webinar Q3",
            source_type="import",
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            created_by=ADMIN_ID,
            assigned_to=None,
            status="new",
            priority="medium",
            custom_fields={
                "assignment_status": "unassigned",
                "unassigned_reason": "all_candidates_at_capacity",
            },
        )
        session.add_all([lead_1, lead_2, lead_3])

        # 5. Assignment History Records
        hist_1 = CrmAssignmentHistory(
            id=uuid.uuid4(),
            lead_id=lead_1.id,
            previous_owner_id=None,
            new_owner_id=REP_A_ID,
            assignment_method="round_robin",
            assigned_by=ADMIN_ID,
            reason="Initial automated round-robin assignment",
            batch_id=batch_id,
        )
        hist_2 = CrmAssignmentHistory(
            id=uuid.uuid4(),
            lead_id=lead_2.id,
            previous_owner_id=None,
            new_owner_id=REP_B_ID,
            assignment_method="state_priority",
            assigned_by=ADMIN_ID,
            reason="Territory state priority assignment",
            batch_id=batch_id,
        )
        session.add_all([hist_1, hist_2])
        await session.commit()

        return {
            "pipeline_id": pipeline_id,
            "stage_id": stage_id,
            "batch_id": batch_id,
            "pipeline_name": pipe.name,
            "batch_name": batch.batch_name,
            "lead_1_id": lead_1.id,
            "lead_2_id": lead_2.id,
            "lead_3_id": lead_3.id,
            "lead_1_code": lead_1.lead_code,
            "lead_2_code": lead_2.lead_code,
            "lead_3_code": lead_3.lead_code,
        }


@pytest.mark.asyncio
async def test_admin_lead_listing_and_filtering(client: AsyncClient, admin_actor: CurrentUser, setup_visibility_data):
    """Admin can list all leads, search, filter by unassigned, and see full ownership details."""
    data = setup_visibility_data
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        service = CrmLeadService(session=session)
        # 1. Unfiltered: should return 3 leads
        res = await service.list_leads(actor=admin_actor, page=1, page_size=10)
        assert res.total == 3
        assert len(res.items) == 3

        # Check fields
        lead_alpha = next(x for x in res.items if x.lead_code == data["lead_1_code"])
        assert lead_alpha.name == "Alpha Customer"
        assert lead_alpha.assignment_status == "assigned"
        assert lead_alpha.assigned_to == REP_A_ID
        assert lead_alpha.pipeline_name == data["pipeline_name"]

        # 2. Unassigned filter only
        res_unassigned = await service.list_leads(actor=admin_actor, unassigned_only=True)
        assert res_unassigned.total == 1
        assert res_unassigned.items[0].lead_code == data["lead_3_code"]
        assert res_unassigned.items[0].assigned_to is None
        assert res_unassigned.items[0].assignment_status == "unassigned"
        assert res_unassigned.items[0].unassigned_reason == "all_candidates_at_capacity"

        # 3. Search query
        res_search = await service.list_leads(actor=admin_actor, search="Gamma")
        assert res_search.total == 1
        assert res_search.items[0].lead_code == data["lead_3_code"]

        # 4. Campaign filter
        res_campaign = await service.list_leads(actor=admin_actor, campaign="Google Ads")
        assert res_campaign.total == 1
        assert res_campaign.items[0].lead_code == data["lead_1_code"]


@pytest.mark.asyncio
async def test_salesperson_scoping(client: AsyncClient, rep_a_actor: CurrentUser, setup_visibility_data):
    """Salesperson only sees leads assigned to or created by them; cannot see other team leads."""
    data = setup_visibility_data
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        service = CrmLeadService(session=session)

        # Rep A should only see Lead 1
        res = await service.list_leads(actor=rep_a_actor, page=1, page_size=10)
        assert res.total == 1
        assert res.items[0].lead_code == data["lead_1_code"]
        assert res.items[0].assigned_to == REP_A_ID

        # Rep A requesting someone else's leads receives empty response
        res_other = await service.list_leads(actor=rep_a_actor, assigned_to=REP_B_ID)
        assert res_other.total == 0
        assert len(res_other.items) == 0


@pytest.mark.asyncio
async def test_manager_scoping(client: AsyncClient, manager_actor: CurrentUser, setup_visibility_data):
    """Department manager sees direct reports (Rep A) and unassigned leads, but not other teams (Rep B)."""
    data = setup_visibility_data
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        service = CrmLeadService(session=session)

        # In our seed data, REP_A is a direct report of manager_actor (SALES_MANAGER_ID).
        res = await service.list_leads(actor=manager_actor, page=1, page_size=10)
        # Should see Lead 1 (assigned to Rep A) and Lead 3 (unassigned)
        lead_codes = {item.lead_code for item in res.items}
        assert data["lead_1_code"] in lead_codes
        assert data["lead_3_code"] in lead_codes
        assert data["lead_2_code"] not in lead_codes  # Rep B is not in manager's scope

        # Manager explicitly filtering for Rep B returns empty
        res_forbidden_rep = await service.list_leads(actor=manager_actor, assigned_to=REP_B_ID)
        assert res_forbidden_rep.total == 0


@pytest.mark.asyncio
async def test_single_lead_detail_and_authorization(client: AsyncClient, rep_a_actor: CurrentUser, setup_visibility_data):
    """Fetching individual lead detail verifies ownership and enforces RBAC."""
    data = setup_visibility_data
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        service = CrmLeadService(session=session)

        # Authorized fetch
        lead = await service.get_lead(lead_id=data["lead_1_id"], actor=rep_a_actor)
        assert lead.lead_code == data["lead_1_code"]
        assert lead.assigned_to == REP_A_ID

        # Unauthorized fetch of another representative's lead raises Forbidden
        with pytest.raises(Exception) as exc_info:
            await service.get_lead(lead_id=data["lead_2_id"], actor=rep_a_actor)
        assert "permission" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_assignment_history_pagination_and_scoping(client: AsyncClient, admin_actor: CurrentUser, rep_a_actor: CurrentUser, setup_visibility_data):
    """Exposes persisted crm_assignment_history records with pagination and actor scoping."""
    data = setup_visibility_data
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        service = CrmLeadService(session=session)

        # 1. Admin can see all assignment history records
        hist_admin = await service.list_assignment_history(actor=admin_actor, page=1, page_size=10)
        assert hist_admin.total == 2
        assert len(hist_admin.items) == 2

        # Check fields of record
        rec = next(x for x in hist_admin.items if x.new_owner_id == REP_A_ID)
        assert rec.lead_code == data["lead_1_code"]
        assert rec.lead_name == "Alpha Customer"
        assert rec.assignment_method == "round_robin"
        assert rec.batch_name == data["batch_name"]
        assert rec.reason == "Initial automated round-robin assignment"

        # 2. Filter by lead_id
        hist_lead1 = await service.list_assignment_history(actor=admin_actor, lead_id=data["lead_1_id"])
        assert hist_lead1.total == 1
        assert hist_lead1.items[0].new_owner_id == REP_A_ID

        # 3. Rep A can only see history involving themselves
        hist_rep = await service.list_assignment_history(actor=rep_a_actor)
        assert hist_rep.total == 1
        assert hist_rep.items[0].new_owner_id == REP_A_ID


@pytest.mark.asyncio
async def test_import_batch_history_counts(client: AsyncClient, admin_actor: CurrentUser, setup_visibility_data):
    """Import batches correctly compute assigned_count and unassigned_count from CrmAssignmentHistory."""
    data = setup_visibility_data
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        from app.crm.import_service import CrmImportService
        import_service = CrmImportService(session=session)

        batches = await import_service.list_batches(actor=admin_actor)
        assert len(batches) >= 1
        test_batch = next(b for b in batches if b.id == data["batch_id"])
        assert test_batch.total_count == 3
        assert test_batch.success_count == 3
        # 2 leads were assigned in history for this batch, 1 unassigned
        assert test_batch.assigned_count == 2
        assert test_batch.unassigned_count == 1

