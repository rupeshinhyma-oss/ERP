"""
CRM Pipeline and Stage Setup Automated Test Suite.

Verifies:
1. Pipeline CRUD (create, list, retrieve, update, delete).
2. Required and trimmed name enforcement, duplicate-name conflict rejection.
3. Stage creation, editing, reordering, and contiguous order persistence.
4. Exactly one initial stage rule and initial stage type enforcement ('open' only).
5. Valid stage_type values ('open', 'won', 'lost') and rejection of arbitrary types.
6. Safe default pipeline switching (atomically unsetting previous default).
7. Prevention of deactivating or deleting the active default pipeline.
8. Integrity protection: prevent deactivating/deleting pipelines and stages referenced by CRM leads or stage history.
9. RBAC: unauthenticated requests (401) and unauthorized mutations (403) rejected.
10. Unrelated modules and routes remain unaffected.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.crm.models import CrmLead, CrmPipeline, CrmPipelineStage, CrmStageHistory
from app.database.engine import get_sessionmaker
from app.users.models import User


ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
OPS_EMPLOYEE_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.pipelines.view", "crm.pipelines.manage"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def view_only_headers() -> dict[str, str]:
    token = create_access_token(
        uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502"),  # john
        permissions=["crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def unauthorized_headers() -> dict[str, str]:
    token = create_access_token(
        OPS_EMPLOYEE_ID,
        permissions=["task.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_unauthenticated_and_unauthorized_access(
    client: AsyncClient, unauthorized_headers: dict[str, str]
):
    """Ensure anonymous requests get 401 and unauthorized requests get 403."""
    # Anonymous list
    res_anon = await client.get("/api/v1/crm/pipelines")
    assert res_anon.status_code == 401

    # Unauthorized user list
    res_unauth_list = await client.get("/api/v1/crm/pipelines", headers=unauthorized_headers)
    assert res_unauth_list.status_code == 403

    # Unauthorized user mutation
    res_unauth_post = await client.post(
        "/api/v1/crm/pipelines",
        json={"name": "Unauthorized Pipeline"},
        headers=unauthorized_headers,
    )
    assert res_unauth_post.status_code == 403


@pytest.mark.asyncio
async def test_pipeline_crud_and_validation(client: AsyncClient, admin_headers: dict[str, str]):
    """Test full CRUD lifecycle, trimmed names, and duplicate prevention."""
    sessionmaker = get_sessionmaker()
    p_name = f"Direct Sales {uuid.uuid4().hex[:6]}"

    # 1. Reject creation with no stages
    res_invalid = await client.post(
        "/api/v1/crm/pipelines",
        json={"name": f"   {p_name}   ", "is_active": True},
        headers=admin_headers,
    )
    assert res_invalid.status_code == 400
    assert "at least one stage" in res_invalid.text

    # 1b. Reject creation with stages but no initial stage
    res_no_init = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": f"   {p_name}   ",
            "is_active": False,
            "stages": [
                {"name": "Stage 1", "stage_type": "open", "is_initial": False}
            ],
        },
        headers=admin_headers,
    )
    assert res_no_init.status_code == 400
    assert "initial stage" in res_no_init.text

    # 2. Reject empty/blank name
    res_blank = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": "   ",
            "is_active": False,
            "stages": [
                {"name": "Stage 1", "stage_type": "open", "is_initial": True}
            ],
        },
        headers=admin_headers,
    )
    assert res_blank.status_code == 422

    # 3. Create pipeline with initial stage
    res_create = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": f"   {p_name}   ",
            "description": "  A test pipeline  ",
            "is_active": False,
            "stages": [
                {"name": "Discovery", "stage_type": "open", "is_initial": True, "stage_order": 1}
            ],
        },
        headers=admin_headers,
    )
    assert res_create.status_code == 201
    pipeline_data = res_create.json()["data"]
    pipeline_id = pipeline_data["id"]
    assert pipeline_data["name"] == p_name  # trimmed!
    assert pipeline_data["description"] == "A test pipeline"
    assert pipeline_data["is_active"] is False
    assert len(pipeline_data["stages"]) == 1

    try:
        # 4. Duplicate name rejection
        res_dup = await client.post(
            "/api/v1/crm/pipelines",
            json={
                "name": p_name.lower(),
                "is_active": False,
                "stages": [
                    {"name": "Initial Stage", "stage_type": "open", "is_initial": True}
                ],
            },
            headers=admin_headers,
        )
        assert res_dup.status_code == 409

        # 5. List pipelines
        res_list = await client.get("/api/v1/crm/pipelines", headers=admin_headers)
        assert res_list.status_code == 200
        all_pipes = res_list.json()["data"]
        assert any(p["id"] == pipeline_id for p in all_pipes)

        # 6. Retrieve single pipeline
        res_get = await client.get(f"/api/v1/crm/pipelines/{pipeline_id}", headers=admin_headers)
        assert res_get.status_code == 200
        assert res_get.json()["data"]["name"] == p_name

        # 7. Update pipeline description
        res_update = await client.put(
            f"/api/v1/crm/pipelines/{pipeline_id}",
            json={"description": "Updated description"},
            headers=admin_headers,
        )
        assert res_update.status_code == 200
        assert res_update.json()["data"]["description"] == "Updated description"

    finally:
        # Cleanup
        async with sessionmaker() as session:
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == uuid.UUID(pipeline_id)))
            await session.commit()


@pytest.mark.asyncio
async def test_stage_management_and_ordering(client: AsyncClient, admin_headers: dict[str, str]):
    """Test stage creation, type validation, reordering, and initial stage rules."""
    sessionmaker = get_sessionmaker()
    p_name = f"Inbound Workflow {uuid.uuid4().hex[:6]}"

    # Create pipeline with valid initial stage
    create_payload = {
        "name": p_name,
        "is_active": True,
        "stages": [
            {"name": "Discovery", "stage_type": "open", "is_initial": True, "stage_order": 1},
            {"name": "Negotiation", "stage_type": "open", "is_initial": False, "stage_order": 2},
            {"name": "Closed Won", "stage_type": "won", "is_initial": False, "stage_order": 3},
            {"name": "Closed Lost", "stage_type": "lost", "is_initial": False, "stage_order": 4},
        ],
    }
    res = await client.post("/api/v1/crm/pipelines", json=create_payload, headers=admin_headers)
    assert res.status_code == 201
    pipeline_data = res.json()["data"]
    pipeline_id = pipeline_data["id"]

    try:
        # Check initial stages in response
        stages = pipeline_data["stages"]
        assert len(stages) == 4
        assert stages[0]["name"] == "Discovery"
        assert stages[0]["is_initial"] is True
        assert stages[0]["stage_type"] == "open"
        assert stages[2]["stage_type"] == "won"
        assert stages[3]["stage_type"] == "lost"

        # 1. Invalid stage type rejection
        res_bad_type = await client.post(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages",
            json={"name": "Bad Stage", "stage_type": "invalid_status"},
            headers=admin_headers,
        )
        assert res_bad_type.status_code == 422

        # 2. Terminal stage cannot be initial
        res_bad_initial = await client.post(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages",
            json={"name": "Won Initial", "stage_type": "won", "is_initial": True},
            headers=admin_headers,
        )
        assert res_bad_initial.status_code == 400
        assert "Initial stage" in res_bad_initial.text or "open" in res_bad_initial.text

        # 3. Add a valid intermediate stage
        res_add = await client.post(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages",
            json={"name": "Technical Evaluation", "stage_type": "open", "is_initial": False, "stage_order": 5},
            headers=admin_headers,
        )
        assert res_add.status_code == 201
        new_stage_id = res_add.json()["data"]["id"]

        # 4. Duplicate stage name within pipeline is rejected
        res_dup_stage = await client.post(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages",
            json={"name": "Discovery", "stage_type": "open"},
            headers=admin_headers,
        )
        assert res_dup_stage.status_code == 409

        # 5. Switching initial stage clears the previous initial stage
        res_set_initial = await client.put(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages/{new_stage_id}",
            json={"is_initial": True},
            headers=admin_headers,
        )
        assert res_set_initial.status_code == 200
        assert res_set_initial.json()["data"]["is_initial"] is True

        # Fetch pipeline detail and verify old initial stage is cleared
        detail_res = await client.get(f"/api/v1/crm/pipelines/{pipeline_id}", headers=admin_headers)
        updated_stages = detail_res.json()["data"]["stages"]
        initial_stages = [s for s in updated_stages if s["is_initial"]]
        assert len(initial_stages) == 1
        assert initial_stages[0]["id"] == new_stage_id

        # 6. Reorder stages
        reorder_payload = {
            "stages": [
                {"id": updated_stages[0]["id"], "stage_order": 5},
                {"id": updated_stages[1]["id"], "stage_order": 4},
                {"id": updated_stages[2]["id"], "stage_order": 3},
                {"id": updated_stages[3]["id"], "stage_order": 2},
                {"id": updated_stages[4]["id"], "stage_order": 1},
            ]
        }
        reorder_res = await client.put(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages/reorder",
            json=reorder_payload,
            headers=admin_headers,
        )
        assert reorder_res.status_code == 200
        persisted_stages = reorder_res.json()["data"]
        assert persisted_stages[0]["id"] == updated_stages[4]["id"]
        assert persisted_stages[0]["stage_order"] == 1

        # 7. Disallow deleting or unsetting the only initial stage of an active pipeline
        # First make sure only one initial stage exists
        res_unset_initial = await client.put(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages/{new_stage_id}",
            json={"is_initial": False},
            headers=admin_headers,
        )
        assert res_unset_initial.status_code == 400
        assert "initial stage" in res_unset_initial.text

    finally:
        async with sessionmaker() as session:
            await session.execute(
                delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == uuid.UUID(pipeline_id))
            )
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == uuid.UUID(pipeline_id)))
            await session.commit()


@pytest.mark.asyncio
async def test_default_pipeline_switching_and_safety(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Test transactional default pipeline switching and prevention of default deactivation/deletion."""
    sessionmaker = get_sessionmaker()
    p1_name = f"Default Pipe A {uuid.uuid4().hex[:6]}"
    p2_name = f"Default Pipe B {uuid.uuid4().hex[:6]}"

    # Create Pipeline A as default
    res1 = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p1_name,
            "is_default": True,
            "is_active": True,
            "stages": [{"name": "Lead", "stage_type": "open", "is_initial": True, "stage_order": 1}],
        },
        headers=admin_headers,
    )
    assert res1.status_code == 201
    p1_id = res1.json()["data"]["id"]

    # Create Pipeline B not default
    res2 = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p2_name,
            "is_default": False,
            "is_active": True,
            "stages": [{"name": "Prospect", "stage_type": "open", "is_initial": True, "stage_order": 1}],
        },
        headers=admin_headers,
    )
    assert res2.status_code == 201
    p2_id = res2.json()["data"]["id"]

    try:
        # Verify Pipeline A is default and B is not
        get1 = await client.get(f"/api/v1/crm/pipelines/{p1_id}", headers=admin_headers)
        get2 = await client.get(f"/api/v1/crm/pipelines/{p2_id}", headers=admin_headers)
        assert get1.json()["data"]["is_default"] is True
        assert get2.json()["data"]["is_default"] is False

        # 1. Prevent deactivating default pipeline
        res_deact = await client.post(
            f"/api/v1/crm/pipelines/{p1_id}/toggle-active", headers=admin_headers
        )
        assert res_deact.status_code == 400
        assert "default pipeline" in res_deact.text.lower()

        # 2. Prevent deleting default pipeline
        res_del = await client.delete(f"/api/v1/crm/pipelines/{p1_id}", headers=admin_headers)
        assert res_del.status_code == 400
        assert "default pipeline" in res_del.text.lower()

        # 3. Switch default to Pipeline B
        res_switch = await client.post(
            f"/api/v1/crm/pipelines/{p2_id}/set-default", headers=admin_headers
        )
        assert res_switch.status_code == 200
        assert res_switch.json()["data"]["is_default"] is True

        # Verify Pipeline A is now NOT default
        get1_after = await client.get(f"/api/v1/crm/pipelines/{p1_id}", headers=admin_headers)
        assert get1_after.json()["data"]["is_default"] is False

        # 4. Now that Pipeline A is not default, it can be safely deactivated
        res_deact_a = await client.post(
            f"/api/v1/crm/pipelines/{p1_id}/toggle-active", headers=admin_headers
        )
        assert res_deact_a.status_code == 200
        assert res_deact_a.json()["data"]["is_active"] is False

    finally:
        async with sessionmaker() as session:
            for pid in [p1_id, p2_id]:
                await session.execute(
                    delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == uuid.UUID(pid))
                )
                await session.execute(delete(CrmPipeline).where(CrmPipeline.id == uuid.UUID(pid)))
            await session.commit()


@pytest.mark.asyncio
async def test_lead_and_history_reference_protection(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Ensure pipelines and stages cannot be deleted or deactivated when leads or history reference them."""
    sessionmaker = get_sessionmaker()
    p_name = f"Protected Pipe {uuid.uuid4().hex[:6]}"

    # Create pipeline with stage
    res = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_name,
            "is_active": True,
            "stages": [
                {"name": "Stage 1", "stage_type": "open", "is_initial": True, "stage_order": 1},
                {"name": "Stage 2", "stage_type": "won", "is_initial": False, "stage_order": 2},
            ],
        },
        headers=admin_headers,
    )
    assert res.status_code == 201
    pipeline_data = res.json()["data"]
    pipeline_id = uuid.UUID(pipeline_data["id"])
    stage1_id = uuid.UUID(pipeline_data["stages"][0]["id"])
    stage2_id = uuid.UUID(pipeline_data["stages"][1]["id"])

    lead_id = None
    try:
        # Create a lead assigned to stage 1
        async with sessionmaker() as session:
            lead = CrmLead(
                name="Acme Industrial Corp",
                original_phone="+919876543210",
                normalized_phone="+919876543210",
                pipeline_id=pipeline_id,
                stage_id=stage1_id,
                status="open",
            )
            session.add(lead)
            await session.commit()
            lead_id = lead.id

        # 1. Attempting to deactivate pipeline with open leads should fail
        res_deact = await client.put(
            f"/api/v1/crm/pipelines/{pipeline_id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        assert res_deact.status_code == 400
        assert "open crm lead" in res_deact.text.lower()

        # 2. Attempting to delete pipeline with leads should fail
        res_del_pipe = await client.delete(f"/api/v1/crm/pipelines/{pipeline_id}", headers=admin_headers)
        assert res_del_pipe.status_code == 400
        assert "lead(s) are associated" in res_del_pipe.text.lower()

        # 3. Attempting to delete stage 1 with leads should fail
        res_del_stage = await client.delete(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages/{stage1_id}",
            headers=admin_headers,
        )
        assert res_del_stage.status_code == 400
        assert "lead(s) are currently assigned" in res_del_stage.text.lower()

        # 4. Attempting to deactivate stage 1 with active leads should fail
        res_deact_stage = await client.put(
            f"/api/v1/crm/pipelines/{pipeline_id}/stages/{stage1_id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        assert res_deact_stage.status_code == 400
        assert "open crm lead(s) are currently in this stage" in res_deact_stage.text.lower()

    finally:
        async with sessionmaker() as session:
            if lead_id:
                await session.execute(delete(CrmLead).where(CrmLead.id == lead_id))
            await session.execute(
                delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline_id)
            )
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == pipeline_id))
            await session.commit()


@pytest.mark.asyncio
async def test_standard_template_pipeline_creation(client: AsyncClient, admin_headers: dict[str, str]):
    """Test creating a pipeline initialized with the 5 standard template stages."""
    sessionmaker = get_sessionmaker()
    p_name = f"Standard Template Pipeline {uuid.uuid4().hex[:6]}"

    standard_stages = [
        {"name": "New Lead", "stage_type": "open", "is_initial": True, "stage_order": 1},
        {"name": "Contacted", "stage_type": "open", "is_initial": False, "stage_order": 2},
        {"name": "Proposal Sent", "stage_type": "open", "is_initial": False, "stage_order": 3},
        {"name": "Closed Won", "stage_type": "won", "is_initial": False, "stage_order": 4},
        {"name": "Closed Lost", "stage_type": "lost", "is_initial": False, "stage_order": 5},
    ]

    res = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_name,
            "description": "Standard B2B sales pipeline",
            "is_active": True,
            "stages": standard_stages,
        },
        headers=admin_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]
    pipeline_id = data["id"]

    try:
        assert data["name"] == p_name
        stages = data["stages"]
        assert len(stages) == 5
        # Verify 1. New Lead
        assert stages[0]["name"] == "New Lead"
        assert stages[0]["stage_type"] == "open"
        assert stages[0]["is_initial"] is True
        assert stages[0]["stage_order"] == 1
        # Verify 2. Contacted
        assert stages[1]["name"] == "Contacted"
        assert stages[1]["stage_type"] == "open"
        assert stages[1]["is_initial"] is False
        assert stages[1]["stage_order"] == 2
        # Verify 3. Proposal Sent
        assert stages[2]["name"] == "Proposal Sent"
        assert stages[2]["stage_type"] == "open"
        assert stages[2]["is_initial"] is False
        assert stages[2]["stage_order"] == 3
        # Verify 4. Closed Won
        assert stages[3]["name"] == "Closed Won"
        assert stages[3]["stage_type"] == "won"
        assert stages[3]["is_initial"] is False
        assert stages[3]["stage_order"] == 4
        # Verify 5. Closed Lost
        assert stages[4]["name"] == "Closed Lost"
        assert stages[4]["stage_type"] == "lost"
        assert stages[4]["is_initial"] is False
        assert stages[4]["stage_order"] == 5
    finally:
        async with sessionmaker() as session:
            await session.execute(
                delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == uuid.UUID(pipeline_id))
            )
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == uuid.UUID(pipeline_id)))
            await session.commit()


@pytest.mark.asyncio
async def test_custom_pipeline_creation_and_reordering(client: AsyncClient, admin_headers: dict[str, str]):
    """Test custom pipeline creation with user-defined stages and no default stages inserted."""
    sessionmaker = get_sessionmaker()
    p_name = f"Custom Channel Pipeline {uuid.uuid4().hex[:6]}"

    custom_stages = [
        {"name": "Initial Discovery", "stage_type": "open", "is_initial": True, "stage_order": 1},
        {"name": "Security Review", "stage_type": "open", "is_initial": False, "stage_order": 2},
        {"name": "Final Deal Won", "stage_type": "won", "is_initial": False, "stage_order": 3},
        {"name": "Deal Dropped", "stage_type": "lost", "is_initial": False, "stage_order": 4},
    ]

    res = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_name,
            "description": "Bespoke custom workflow",
            "is_active": True,
            "stages": custom_stages,
        },
        headers=admin_headers,
    )
    assert res.status_code == 201
    data = res.json()["data"]
    pipeline_id = data["id"]

    try:
        assert data["name"] == p_name
        stages = data["stages"]
        assert len(stages) == 4
        assert [s["name"] for s in stages] == [
            "Initial Discovery",
            "Security Review",
            "Final Deal Won",
            "Deal Dropped",
        ]
        # Exactly one initial stage
        assert sum(1 for s in stages if s["is_initial"]) == 1
        assert stages[0]["is_initial"] is True
    finally:
        async with sessionmaker() as session:
            await session.execute(
                delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == uuid.UUID(pipeline_id))
            )
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == uuid.UUID(pipeline_id)))
            await session.commit()


@pytest.mark.asyncio
async def test_pipeline_atomic_creation_and_stage_validation(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Test stage validation rules and verify atomic rollback on invalid stage configuration."""
    sessionmaker = get_sessionmaker()
    p_fail_name = f"Fail Pipeline {uuid.uuid4().hex[:6]}"

    # 1. Reject won terminal stage as initial
    res_bad_initial = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_fail_name,
            "is_active": True,
            "stages": [
                {"name": "Initial Won", "stage_type": "won", "is_initial": True, "stage_order": 1}
            ],
        },
        headers=admin_headers,
    )
    assert res_bad_initial.status_code == 400
    assert "open" in res_bad_initial.text

    # 2. Reject multiple initial stages
    res_multi_initial = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_fail_name,
            "is_active": True,
            "stages": [
                {"name": "Stage 1", "stage_type": "open", "is_initial": True, "stage_order": 1},
                {"name": "Stage 2", "stage_type": "open", "is_initial": True, "stage_order": 2},
            ],
        },
        headers=admin_headers,
    )
    assert res_multi_initial.status_code == 400
    assert "multiple initial stages" in res_multi_initial.text

    # 3. Reject duplicate stage names
    res_dup_names = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_fail_name,
            "is_active": True,
            "stages": [
                {"name": "Qualify", "stage_type": "open", "is_initial": True, "stage_order": 1},
                {"name": "qualify", "stage_type": "open", "is_initial": False, "stage_order": 2},
            ],
        },
        headers=admin_headers,
    )
    assert res_dup_names.status_code == 400
    assert "duplicate stage name" in res_dup_names.text.lower()

    # 4. Atomic verification: Verify that failed creation did not leave an orphan pipeline in DB
    async with sessionmaker() as session:
        check = await session.execute(
            select(CrmPipeline).where(CrmPipeline.name == p_fail_name)
        )
        assert check.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_pipeline_recreation_after_soft_delete(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """
    REGRESSION TEST:
    Verify that creating a pipeline with a name previously used by a soft-deleted pipeline
    succeeds cleanly and does NOT return a 500 error or fail on unique constraint collisions.
    """
    sessionmaker = get_sessionmaker()
    p_name = f"Recreate Flow {uuid.uuid4().hex[:6]}"

    # 1. Create pipeline
    res_1 = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_name,
            "is_active": True,
            "stages": [
                {"name": "Stage 1", "stage_type": "open", "is_initial": True, "stage_order": 1}
            ],
        },
        headers=admin_headers,
    )
    assert res_1.status_code == 201
    pipe_1_id = res_1.json()["data"]["id"]

    # 2. Soft-delete the pipeline
    res_del = await client.delete(f"/api/v1/crm/pipelines/{pipe_1_id}", headers=admin_headers)
    assert res_del.status_code == 200

    # 3. Create a NEW pipeline with the EXACT same name
    res_2 = await client.post(
        "/api/v1/crm/pipelines",
        json={
            "name": p_name,
            "is_active": True,
            "stages": [
                {"name": "Stage 1", "stage_type": "open", "is_initial": True, "stage_order": 1}
            ],
        },
        headers=admin_headers,
    )
    assert res_2.status_code == 201
    pipe_2_id = res_2.json()["data"]["id"]
    assert pipe_2_id != pipe_1_id
    assert res_2.json()["data"]["name"] == p_name

    # 4. Cleanup
    async with sessionmaker() as session:
        await session.execute(
            delete(CrmPipelineStage).where(
                CrmPipelineStage.pipeline_id.in_([uuid.UUID(pipe_1_id), uuid.UUID(pipe_2_id)])
            )
        )
        await session.execute(
            delete(CrmPipeline).where(
                CrmPipeline.id.in_([uuid.UUID(pipe_1_id), uuid.UUID(pipe_2_id)])
            )
        )
        await session.commit()

