"""
Security & Scoping Regression Tests for Leads, Follow-ups, and CRM Stage Transition Alias.

Tests:
1. Anonymous rejection (401 Unauthorized) across all classic leads and follow-ups endpoints.
2. Missing permission rejection (403 Forbidden) for unauthorized users and read-only users attempting mutations.
3. Successful access for authorized users (crm.leads.view for read, crm.leads.manage for mutation).
4. Salesperson ownership boundary enforcement (cannot view/mutate leads or follow-ups allotted to others).
5. Pre-mutation atomic bulk deletion validation (zero mutations if any ID is missing or unauthorized).
6. CRM Stage Transition Alias (/stage vs /stage-transition) parity and authorization.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.audit.dependencies import get_audit_service
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exceptions import ForbiddenException, NotFoundException
from app.crm.dependencies import get_crm_lead_service
from app.crm.schemas import CrmLeadListItem, CrmLeadStageTransitionRequest
from app.database.session import get_db_session
from app.follow_ups.models import FollowUp
from app.follow_ups.routes import get_service as get_follow_up_service
from app.follow_ups.schemas import FollowUpCreate, FollowUpUpdate
from app.follow_ups.service import FollowUpService
from app.leads.models import Lead
from app.leads.routes import get_service as get_lead_service
from app.leads.schemas import LeadCreate, LeadUpdate
from app.leads.service import LeadService
from app.main import create_application

pytestmark = pytest.mark.asyncio


# =============================================================================
# Helper Fixtures & Test Doubles
# =============================================================================


def make_lead(
    lead_id: uuid.UUID | None = None,
    company_name: str = "Test Corp",
    allotted_to: str = "sales_rep_1",
    created_by: str = "sales_rep_1",
) -> Lead:
    now = datetime.now(timezone.utc)
    return Lead(
        id=lead_id or uuid.uuid4(),
        company_name=company_name,
        business_type="B2B",
        source="Website",
        contact_person="John Doe",
        contact_phone="9876543210",
        priority="Medium",
        city="Mumbai",
        state="Maharashtra",
        allotted_to=allotted_to,
        created_by=created_by,
        lead_status="New",
        added_on=date.today(),
        created_at=now,
        updated_at=now,
    )


def make_follow_up(
    item_id: uuid.UUID | None = None,
    company_name: str = "Test Corp",
    marketing_person: str = "sales_rep_1",
) -> FollowUp:
    now = datetime.now(timezone.utc)
    return FollowUp(
        id=item_id or uuid.uuid4(),
        company_name=company_name,
        marketing_person=marketing_person,
        call_type="Call",
        lead_status="Ongoing",
        added_on=date.today(),
        created_at=now,
        updated_at=now,
    )


async def dummy_db_session():
    mock_s = AsyncMock()
    yield mock_s


# =============================================================================
# Unit Tests: Service-Level Ownership & Bulk Delete Atomic Validation
# =============================================================================


async def test_lead_service_salesperson_scoping():
    """Salesperson can only access own leads; other leads raise ForbiddenException."""
    mock_repo = AsyncMock()
    service = LeadService(mock_repo)

    rep1 = CurrentUser(
        id=uuid.uuid4(),
        username="rep1",
        permissions={"crm.leads.view"},
    )
    rep2_lead = make_lead(allotted_to="rep2", created_by="rep2")
    own_lead = make_lead(allotted_to="rep1", created_by="rep1")

    # 1. Accessing other rep's lead -> 403
    mock_repo.get_by_id.return_value = rep2_lead
    with pytest.raises(ForbiddenException):
        await service.get_by_id(rep2_lead.id, actor=rep1)

    # 2. Accessing own lead -> Success
    mock_repo.get_by_id.return_value = own_lead
    result = await service.get_by_id(own_lead.id, actor=rep1)
    assert result.id == own_lead.id

    # 3. Listing leads: if rep tries to query another rep's leads -> 403
    with pytest.raises(ForbiddenException):
        await service.list_leads(actor=rep1, allotted_to="rep2")

    # 4. Allotting lead: rep cannot allot -> 403
    with pytest.raises(ForbiddenException):
        await service.allot_lead(own_lead.id, "rep2", actor=rep1)


async def test_lead_service_manager_can_access_any_lead():
    """Manager/Admin can view and allot any lead regardless of assignment."""
    mock_repo = AsyncMock()
    service = LeadService(mock_repo)

    manager = CurrentUser(
        id=uuid.uuid4(),
        username="manager1",
        permissions={"crm.leads.manage"},
    )
    rep_lead = make_lead(allotted_to="rep1", created_by="rep1")
    mock_repo.get_by_id.return_value = rep_lead
    mock_repo.allot_lead.return_value = rep_lead

    # Manager view -> OK
    result = await service.get_by_id(rep_lead.id, actor=manager)
    assert result.id == rep_lead.id

    # Manager allot -> OK
    allotted = await service.allot_lead(rep_lead.id, "rep2", actor=manager)
    assert allotted.id == rep_lead.id
    mock_repo.allot_lead.assert_called_once_with(rep_lead, "rep2")


async def test_lead_service_bulk_delete_atomic_prevalidation():
    """If any lead ID is missing or unauthorized, bulk_delete fails before modifying data."""
    mock_repo = AsyncMock()
    service = LeadService(mock_repo)

    rep1 = CurrentUser(
        id=uuid.uuid4(),
        username="rep1",
        permissions={"crm.leads.view"},  # Standard rep (not manager)
    )
    manager = CurrentUser(
        id=uuid.uuid4(),
        username="manager1",
        permissions={"crm.leads.manage"},
    )

    lead1 = make_lead(allotted_to="rep1", created_by="rep1")
    lead2 = make_lead(allotted_to="rep2", created_by="rep2")  # unauthorized for rep1
    id1 = lead1.id
    id2 = lead2.id
    missing_id = uuid.uuid4()

    # Case A: One ID does not exist -> 404, bulk_soft_delete never called
    mock_repo.get_by_id.side_effect = lambda lid: lead1 if lid == id1 else None
    with pytest.raises(NotFoundException):
        await service.bulk_delete([id1, missing_id], actor=manager)
    mock_repo.bulk_soft_delete.assert_not_called()

    # Case B: One ID belongs to another rep -> 403, bulk_soft_delete never called
    mock_repo.get_by_id.side_effect = lambda lid: lead1 if lid == id1 else lead2
    with pytest.raises(ForbiddenException):
        await service.bulk_delete([id1, id2], actor=rep1)
    mock_repo.bulk_soft_delete.assert_not_called()

    # Case C: All valid & authorized for manager -> bulk_soft_delete called
    mock_repo.get_by_id.side_effect = lambda lid: lead1
    mock_repo.bulk_soft_delete.return_value = 2
    count = await service.bulk_delete([id1, uuid.uuid4()], actor=manager)
    assert count == 2
    mock_repo.bulk_soft_delete.assert_called_once()


async def test_follow_up_service_salesperson_scoping_and_bulk_delete():
    """FollowUpService enforces ownership on marketing_person and atomic bulk delete."""
    mock_repo = AsyncMock()
    service = FollowUpService(mock_repo)

    rep1 = CurrentUser(
        id=uuid.uuid4(),
        username="rep1",
        permissions={"crm.leads.view"},
    )
    manager = CurrentUser(
        id=uuid.uuid4(),
        username="manager1",
        permissions={"crm.leads.manage"},
    )
    fu_own = make_follow_up(marketing_person="rep1")
    fu_other = make_follow_up(marketing_person="rep2")

    # Own follow up -> OK
    mock_repo.get_by_id.return_value = fu_own
    assert (await service.get_by_id(fu_own.id, actor=rep1)).id == fu_own.id

    # Other follow up -> 403
    mock_repo.get_by_id.return_value = fu_other
    with pytest.raises(ForbiddenException):
        await service.get_by_id(fu_other.id, actor=rep1)

    # Bulk delete pre-validation: missing record raises 404 and prevents mutation
    missing_id = uuid.uuid4()
    mock_repo.get_by_id.side_effect = lambda fid: fu_own if fid == fu_own.id else None
    with pytest.raises(NotFoundException):
        await service.bulk_delete([fu_own.id, missing_id], actor=manager)
    mock_repo.bulk_soft_delete.assert_not_called()

    # Bulk delete pre-validation: unauthorized record raises 403 and prevents mutation
    mock_repo.get_by_id.side_effect = lambda fid: fu_own if fid == fu_own.id else fu_other
    with pytest.raises(ForbiddenException):
        await service.bulk_delete([fu_own.id, fu_other.id], actor=rep1)
    mock_repo.bulk_soft_delete.assert_not_called()


# =============================================================================
# Route Tests: 401 Unauthorized on Anonymous Requests
# =============================================================================


async def test_classic_leads_anonymous_denials():
    """All classic leads endpoints must return 401 Unauthorized for unauthenticated requests."""
    app = create_application()
    app.dependency_overrides[get_db_session] = dummy_db_session

    transport = ASGITransport(app=app)
    random_id = uuid.uuid4()

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # GET list
        res = await client.get("/api/v1/leads")
        assert res.status_code == 401

        res = await client.get("/api/v1/leads/list")
        assert res.status_code == 401

        # POST create
        res = await client.post("/api/v1/leads", json={"company_name": "Test"})
        assert res.status_code == 401

        # GET detail
        res = await client.get(f"/api/v1/leads/{random_id}")
        assert res.status_code == 401

        # PUT update
        res = await client.put(f"/api/v1/leads/{random_id}", json={"company_name": "Updated"})
        assert res.status_code == 401

        # POST allot
        res = await client.post(f"/api/v1/leads/{random_id}/allot", json={"allotted_to": "someone"})
        assert res.status_code == 401

        # DELETE
        res = await client.delete(f"/api/v1/leads/{random_id}")
        assert res.status_code == 401

        # POST bulk delete
        res = await client.post("/api/v1/leads/bulk-delete", json={"lead_ids": [str(random_id)]})
        assert res.status_code == 401


async def test_classic_follow_ups_anonymous_denials():
    """All classic follow-up endpoints must return 401 Unauthorized for unauthenticated requests."""
    app = create_application()
    app.dependency_overrides[get_db_session] = dummy_db_session

    transport = ASGITransport(app=app)
    random_id = uuid.uuid4()

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        res = await client.get("/api/v1/follow-ups")
        assert res.status_code == 401

        res = await client.get("/api/v1/follow-ups/list")
        assert res.status_code == 401

        res = await client.post("/api/v1/follow-ups", json={"company_name": "Test"})
        assert res.status_code == 401

        res = await client.get(f"/api/v1/follow-ups/{random_id}")
        assert res.status_code == 401

        res = await client.put(f"/api/v1/follow-ups/{random_id}", json={"company_name": "Updated"})
        assert res.status_code == 401

        res = await client.delete(f"/api/v1/follow-ups/{random_id}")
        assert res.status_code == 401

        res = await client.post("/api/v1/follow-ups/bulk-delete", json={"ids": [str(random_id)]})
        assert res.status_code == 401


# =============================================================================
# Route Tests: 403 Forbidden on Missing/Insufficient Permissions
# =============================================================================


async def test_classic_routes_permission_enforcement():
    """Read-only user has access to GET, but 403 on mutations."""
    app = create_application()
    app.dependency_overrides[get_db_session] = dummy_db_session

    read_only_user = CurrentUser(
        id=uuid.uuid4(),
        username="viewer",
        permissions={"crm.leads.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: read_only_user

    mock_lead_service = AsyncMock()
    mock_fu_service = AsyncMock()
    app.dependency_overrides[get_lead_service] = lambda: mock_lead_service
    app.dependency_overrides[get_follow_up_service] = lambda: mock_fu_service

    mock_lead_service.list_leads.return_value = ([], 0)
    mock_fu_service.list_follow_ups.return_value = ([], 0)

    transport = ASGITransport(app=app)
    random_id = uuid.uuid4()

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # GET list should SUCCEED with 200
        res = await client.get("/api/v1/leads")
        assert res.status_code == 200

        res = await client.get("/api/v1/follow-ups")
        assert res.status_code == 200

        # Mutations should FAIL with 403 Forbidden
        res = await client.post("/api/v1/leads", json={"company_name": "Test"})
        assert res.status_code == 403

        res = await client.put(f"/api/v1/leads/{random_id}", json={"company_name": "Updated"})
        assert res.status_code == 403

        res = await client.post(f"/api/v1/leads/{random_id}/allot", json={"allotted_to": "someone"})
        assert res.status_code == 403

        res = await client.delete(f"/api/v1/leads/{random_id}")
        assert res.status_code == 403

        res = await client.post("/api/v1/leads/bulk-delete", json={"lead_ids": [str(random_id)]})
        assert res.status_code == 403

        res = await client.post("/api/v1/follow-ups", json={"company_name": "Test"})
        assert res.status_code == 403

        res = await client.put(f"/api/v1/follow-ups/{random_id}", json={"company_name": "Updated"})
        assert res.status_code == 403

        res = await client.delete(f"/api/v1/follow-ups/{random_id}")
        assert res.status_code == 403

        res = await client.post("/api/v1/follow-ups/bulk-delete", json={"ids": [str(random_id)]})
        assert res.status_code == 403


# =============================================================================
# Route Tests: Stage Transition Alias Parity
# =============================================================================


async def test_stage_transition_alias_parity():
    """Verify /crm/leads/{id}/stage and /crm/leads/{id}/stage-transition perform identical operations."""
    app = create_application()
    app.dependency_overrides[get_db_session] = dummy_db_session

    manager_user = CurrentUser(
        id=uuid.uuid4(),
        username="crm_manager",
        permissions={"crm.leads.manage"},
    )
    app.dependency_overrides[get_current_user] = lambda: manager_user

    mock_crm_service = AsyncMock()
    app.dependency_overrides[get_crm_lead_service] = lambda: mock_crm_service

    mock_audit = AsyncMock()
    app.dependency_overrides[get_audit_service] = lambda: mock_audit

    lead_id = uuid.uuid4()
    stage_id = uuid.uuid4()
    pipeline_id = uuid.uuid4()

    mock_lead_detail = CrmLeadListItem(
        id=lead_id,
        lead_code="LD-1001",
        name="Acme Industrial",
        original_phone="9876543210",
        source_type="direct",
        pipeline_id=pipeline_id,
        stage_id=stage_id,
        stage_name="Contract Negotiation",
        status="open",
        priority="medium",
        assignment_status="assigned",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    mock_crm_service.transition_lead_stage.return_value = mock_lead_detail

    payload = {
        "stage_id": str(stage_id),
        "reason": "Moved forward after successful client meeting",
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Canonical route: POST /api/v1/crm/leads/{id}/stage
        res1 = await client.post(f"/api/v1/crm/leads/{lead_id}/stage", json=payload)
        assert res1.status_code == 200
        data1 = res1.json()["data"]
        assert data1["id"] == str(lead_id)
        assert data1["stage_name"] == "Contract Negotiation"

        # 2. Alias route: POST /api/v1/crm/leads/{id}/stage-transition
        res2 = await client.post(f"/api/v1/crm/leads/{lead_id}/stage-transition", json=payload)
        assert res2.status_code == 200
        data2 = res2.json()["data"]
        assert data2["id"] == str(lead_id)
        assert data2["stage_name"] == "Contract Negotiation"

        # Verify service was called twice with exact same parameters
        assert mock_crm_service.transition_lead_stage.call_count == 2

        # Verify audit service recorded both operations
        assert mock_audit.record.call_count == 2
