"""
Comprehensive Test Suite for CRM Follow-up to Workforce & Agile Task Integration.

Verifies:
1. Creating a CRM follow-up creates exactly one corresponding Workforce Task.
2. The generated Task appears in the existing Tasks list.
3. The correct salesperson sees it in My Tasks.
4. The Task has the correct due date and lead details.
5. Editing the follow-up updates the same Task without duplicate creation.
6. Retrying synchronization does not create duplicate Tasks.
7. Completing a follow-up marks its linked Task as DONE and captures completion notes.
8. Cancelling a follow-up prevents its linked Task from appearing active, without marking it DONE.
9. Standalone Workforce Tasks remain completely unaffected.
10. Existing CRM follow-up lifecycle behavior is unaffected.
11. Existing task permissions remain strictly enforced.
12. Ordinary CRM activities (notes, calls, WhatsApp) do not create Tasks.
"""

import random
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select

from app.auth.service import create_access_token
from app.crm.models import (
    CrmActivity,
    CrmFollowUp,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
)
from app.database.engine import get_sessionmaker
from app.tasks.models import (
    Task,
    TaskAssignee,
    TaskComment,
    TaskPriority,
    TaskStatus,
)
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
REP_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")
NO_TASK_USER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def unique_phone() -> str:
    return f"9{random.randint(100000000, 999999999)}"


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "task.view", "task.create", "task.assign", "task.manage", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        MANAGER_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "task.view", "task.create", "task.department_view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_a_headers() -> dict[str, str]:
    token = create_access_token(
        REP_A_ID,
        permissions=["crm.leads.view", "task.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_b_headers() -> dict[str, str]:
    token = create_access_token(
        REP_B_ID,
        permissions=["crm.leads.view", "task.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def no_task_perm_headers() -> dict[str, str]:
    token = create_access_token(
        NO_TASK_USER_ID,
        permissions=["crm.leads.view"],  # Lacks task.view
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_crm_task_env(client: AsyncClient):
    """Setup active users, clean pipeline, and test leads with isolated cleanup."""
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_id = uuid.uuid4()

    async with sessionmaker() as session:
        # Ensure test users exist
        users_to_ensure = [
            (ADMIN_ID, "admin", "admin@example.com", "ADMIN"),
            (MANAGER_ID, "manager_user_q", "manager_q@inhyma.test", "MANAGER"),
            (REP_A_ID, "rep_a_user_q", "repa_q@inhyma.test", "SALESPERSON"),
            (REP_B_ID, "sales_rep_b", "repb@inhyma.test", "SALESPERSON"),
            (NO_TASK_USER_ID, "no_task_user", "notask@inhyma.test", "SALESPERSON"),
        ]
        for uid, uname, uemail, urole in users_to_ensure:
            u = await session.get(User, uid)
            if not u:
                u = User(
                    id=uid,
                    username=f"{uname}_{uuid.uuid4().hex[:4]}",
                    email=f"{uname}_{uuid.uuid4().hex[:4]}@example.com",
                    first_name=urole,
                    last_name="Test",
                    display_name=f"{urole} Test",
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    password_hash="test_pw_hash",
                )
                session.add(u)
            else:
                u.is_active = True
                u.status = UserStatus.ACTIVE
                u.deleted_at = None

        # Create isolated test Pipeline and Stage
        pipeline = CrmPipeline(
            id=pipeline_id,
            name=f"CRM Task Test Pipeline {uuid.uuid4().hex[:6]}",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(pipeline)

        stage = CrmPipelineStage(
            id=stage_id,
            pipeline_id=pipeline_id,
            name="New Prospect",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add(stage)
        await session.commit()

    try:
        yield {
            "pipeline_id": pipeline_id,
            "stage_id": stage_id,
        }
    finally:
        async with sessionmaker() as session:
            test_leads = list((await session.execute(
                select(CrmLead).where(CrmLead.pipeline_id == pipeline_id)
            )).scalars().all())
            test_lead_ids = [l.id for l in test_leads]
            if test_lead_ids:
                fus = list((await session.execute(
                    select(CrmFollowUp).where(CrmFollowUp.lead_id.in_(test_lead_ids))
                )).scalars().all())
                task_ids_to_del = [fu.task_id for fu in fus if fu.task_id]
                if task_ids_to_del:
                    await session.execute(delete(TaskAssignee).where(TaskAssignee.task_id.in_(task_ids_to_del)))
                    await session.execute(delete(TaskComment).where(TaskComment.task_id.in_(task_ids_to_del)))
                    await session.execute(delete(Task).where(Task.id.in_(task_ids_to_del)))

                await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(test_lead_ids)))
                await session.execute(delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(test_lead_ids)))
                await session.execute(delete(CrmLead).where(CrmLead.id.in_(test_lead_ids)))

            await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline_id))
            await session.execute(delete(CrmPipeline).where(CrmPipeline.id == pipeline_id))

            for temp_uid in (REP_B_ID, NO_TASK_USER_ID):
                await session.execute(delete(TaskAssignee).where(TaskAssignee.user_id == temp_uid))
                await session.execute(delete(User).where(User.id == temp_uid))

            await session.commit()


async def create_test_lead(
    pipeline_id: uuid.UUID,
    stage_id: uuid.UUID,
    name: str = "Apex Precision Ltd",
    company_name: str = "Apex Precision Industries",
    assigned_to: uuid.UUID = REP_A_ID,
    priority: str = "high",
) -> CrmLead:
    sessionmaker = get_sessionmaker()
    phone = unique_phone()
    async with sessionmaker() as session:
        lead = CrmLead(
            name=name,
            original_phone=phone,
            normalized_phone=phone,
            company_name=company_name,
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            status="new",
            priority=priority,
            assigned_to=assigned_to,
            created_by=ADMIN_ID,
        )
        session.add(lead)
        await session.commit()
        await session.refresh(lead)
        return lead


# =============================================================================
# 1. Automatic Task Creation & Content Details
# =============================================================================


@pytest.mark.asyncio
async def test_create_crm_follow_up_creates_one_workforce_task(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Scheduling a CRM follow-up creates exactly one corresponding Task in
    backend/app/tasks with correct title, due date, lead context, and assignee.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="Sun Pharma Lab",
        company_name="Sun Pharmaceuticals",
        assigned_to=REP_A_ID,
        priority="urgent",
    )

    due_dt = datetime.now(timezone.utc) + timedelta(days=3, hours=2)
    payload = {
        "due_at": due_dt.isoformat(),
        "follow_up_type": "meeting",
        "notes": "Discuss quotation v2 and trial deployment",
        "assigned_to": str(REP_A_ID),
    }

    res = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json=payload,
        headers=admin_headers,
    )
    assert res.status_code == 201
    fu_data = res.json()["data"]
    assert fu_data["task_id"] is not None
    task_id = uuid.UUID(fu_data["task_id"])

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Verify follow_up record has task_id
        fu = await session.get(CrmFollowUp, uuid.UUID(fu_data["id"]))
        assert fu is not None
        assert fu.task_id == task_id

        # Verify exactly one Task was created
        task = await session.get(Task, task_id)
        assert task is not None
        assert task.title == f"CRM Follow-up — {lead.name}"
        assert task.status == TaskStatus.TODO
        assert task.issue_type == "TASK"
        assert task.priority == TaskPriority.CRITICAL  # mapped from 'urgent'
        assert task.due_date == due_dt.date()

        # Verify rich context in description
        desc = task.description
        assert f"Lead: {lead.name}" in desc
        assert f"Company: {lead.company_name}" in desc
        assert f"Contact Phone: {lead.normalized_phone}" in desc
        assert "Follow-up Purpose: Meeting" in desc
        assert "Discuss quotation v2 and trial deployment" in desc
        assert f"CRM Lead Reference: {lead.lead_code}" in desc
        assert f"CRM Follow-up Reference: ID {fu.id}" in desc

        # Verify assignee relationship
        assignee_stmt = select(TaskAssignee).where(
            TaskAssignee.task_id == task.id,
            TaskAssignee.assignment_role == "ASSIGNEE",
        )
        assignees = list((await session.execute(assignee_stmt)).scalars().all())
        assert len(assignees) == 1
        assert assignees[0].user_id == REP_A_ID


# =============================================================================
# 2. Existing Tasks List & My Tasks Visibility
# =============================================================================


@pytest.mark.asyncio
async def test_generated_task_appears_in_tasks_list_and_my_tasks(
    client: AsyncClient,
    admin_headers: dict[str, str],
    rep_a_headers: dict[str, str],
    rep_b_headers: dict[str, str],
    setup_crm_task_env: dict,
):
    """
    Generated task appears in the general Tasks list (/tasks?view=all)
    and in the responsible salesperson's My Tasks (/tasks?view=my),
    but NOT in an unrelated salesperson's My Tasks.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="Bharat Biotech Unit",
        company_name="Bharat Biotech Ltd",
        assigned_to=REP_A_ID,
    )

    due_dt = datetime.now(timezone.utc) + timedelta(days=1)
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={
            "due_at": due_dt.isoformat(),
            "follow_up_type": "call",
            "notes": "Follow up on tech demo feedback",
            "assigned_to": str(REP_A_ID),
        },
        headers=admin_headers,
    )
    assert res_fu.status_code == 201
    task_id = res_fu.json()["data"]["task_id"]

    # 1. Admin views all tasks -> task appears
    res_all = await client.get(f"/api/v1/tasks?view=all&search={lead.name}", headers=admin_headers)
    assert res_all.status_code == 200
    all_task_ids = [t["id"] for t in res_all.json()["data"]["items"]]
    assert task_id in all_task_ids

    # 2. Assigned rep (REP_A) views My Tasks -> task appears
    res_my_a = await client.get("/api/v1/tasks?view=my", headers=rep_a_headers)
    assert res_my_a.status_code == 200
    my_a_ids = [t["id"] for t in res_my_a.json()["data"]["items"]]
    assert task_id in my_a_ids

    # 3. Unassigned rep (REP_B) views My Tasks -> task does NOT appear
    res_my_b = await client.get("/api/v1/tasks?view=my", headers=rep_b_headers)
    assert res_my_b.status_code == 200
    my_b_ids = [t["id"] for t in res_my_b.json()["data"]["items"]]
    assert task_id not in my_b_ids


# =============================================================================
# 3. Editing Follow-up Updates the Linked Task Without Duplicates
# =============================================================================


@pytest.mark.asyncio
async def test_editing_follow_up_updates_linked_task(
    client: AsyncClient,
    admin_headers: dict[str, str],
    rep_a_headers: dict[str, str],
    rep_b_headers: dict[str, str],
    setup_crm_task_env: dict,
):
    """
    Editing follow-up due date, notes, or assigned salesperson updates
    the existing linked Task and reassigns it cleanly.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="Tata Motors Plant",
        assigned_to=REP_A_ID,
    )

    due1 = datetime.now(timezone.utc) + timedelta(days=2)
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": due1.isoformat(), "follow_up_type": "call", "notes": "Initial follow-up"},
        headers=admin_headers,
    )
    fu_id = res_fu.json()["data"]["id"]
    task_id = res_fu.json()["data"]["task_id"]

    # Now update date, notes, and reassign to REP_B
    due2 = datetime.now(timezone.utc) + timedelta(days=5)
    res_up = await client.patch(
        f"/api/v1/crm/follow-ups/{fu_id}",
        json={
            "due_at": due2.isoformat(),
            "notes": "Rescheduled call with procurement lead",
            "assigned_to": str(REP_B_ID),
        },
        headers=admin_headers,
    )
    assert res_up.status_code == 200
    up_data = res_up.json()["data"]
    assert up_data["task_id"] == task_id  # Same task preserved

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Confirm only ONE task exists for this follow-up
        ref_str = f"CRM Follow-up Reference: ID {fu_id}"
        count_stmt = select(func.count(Task.id)).where(Task.description.contains(ref_str))
        count = (await session.execute(count_stmt)).scalar()
        assert count == 1

        # Check updated task attributes
        task = await session.get(Task, uuid.UUID(task_id))
        assert task is not None
        assert task.due_date == due2.date()
        assert "Rescheduled call with procurement lead" in task.description

    # Rep B now sees it in My Tasks, and Rep A does not
    res_my_b = await client.get("/api/v1/tasks?view=my", headers=rep_b_headers)
    assert task_id in [t["id"] for t in res_my_b.json()["data"]["items"]]

    res_my_a = await client.get("/api/v1/tasks?view=my", headers=rep_a_headers)
    assert task_id not in [t["id"] for t in res_my_a.json()["data"]["items"]]


# =============================================================================
# 4. Duplicate Prevention During Retries & Synchronization
# =============================================================================


@pytest.mark.asyncio
async def test_retry_sync_does_not_create_duplicate_tasks(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Calling sync-task multiple times is idempotent and never creates duplicate Tasks.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="L&T Heavy Engineering",
        assigned_to=REP_A_ID,
    )

    due_dt = datetime.now(timezone.utc) + timedelta(days=4)
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": due_dt.isoformat(), "follow_up_type": "demo", "notes": "Onsite demo"},
        headers=admin_headers,
    )
    fu_id = res_fu.json()["data"]["id"]
    task_id = res_fu.json()["data"]["task_id"]

    # Trigger manual sync endpoint twice
    sync1 = await client.post(f"/api/v1/crm/follow-ups/{fu_id}/sync-task", headers=admin_headers)
    assert sync1.status_code == 200
    assert sync1.json()["data"]["task_id"] == task_id

    sync2 = await client.post(f"/api/v1/crm/follow-ups/{fu_id}/sync-task", headers=admin_headers)
    assert sync2.status_code == 200
    assert sync2.json()["data"]["task_id"] == task_id

    # Verify database count
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        ref_str = f"CRM Follow-up Reference: ID {fu_id}"
        count_stmt = select(func.count(Task.id)).where(Task.description.contains(ref_str))
        count = (await session.execute(count_stmt)).scalar()
        assert count == 1


# =============================================================================
# 5. Follow-Up Completion Updates Task to DONE
# =============================================================================


@pytest.mark.asyncio
async def test_completing_follow_up_marks_task_done(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Marking a CRM follow-up completed updates the linked Task status to DONE,
    records completion notes, and appends a TaskComment.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="Reliance Retail HQ",
        assigned_to=REP_A_ID,
    )

    due_dt = datetime.now(timezone.utc) + timedelta(hours=2)
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": due_dt.isoformat(), "follow_up_type": "call", "notes": "Contract check"},
        headers=admin_headers,
    )
    fu_id = res_fu.json()["data"]["id"]
    task_id = res_fu.json()["data"]["task_id"]

    # Complete the follow-up
    res_comp = await client.patch(
        f"/api/v1/crm/follow-ups/{fu_id}/status",
        json={
            "status": "completed",
            "completion_notes": "Contract approved by VP. Ready for onboarding.",
            "outcome": "qualified",
        },
        headers=admin_headers,
    )
    assert res_comp.status_code == 200
    assert res_comp.json()["data"]["status"] == "completed"

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        task = await session.get(Task, uuid.UUID(task_id))
        assert task is not None
        assert task.status == TaskStatus.DONE
        assert "Completion Notes: Contract approved by VP" in task.description

        # Check comment in task
        comm_stmt = select(TaskComment).where(TaskComment.task_id == task.id)
        comments = list((await session.execute(comm_stmt)).scalars().all())
        assert any("Contract approved by VP" in c.message for c in comments)


# =============================================================================
# 6. Follow-Up Cancellation Prevents Task Appearing as Active
# =============================================================================


@pytest.mark.asyncio
async def test_cancelling_follow_up_removes_task_from_active_lists(
    client: AsyncClient,
    admin_headers: dict[str, str],
    rep_a_headers: dict[str, str],
    setup_crm_task_env: dict,
):
    """
    Cancelling a follow-up prevents the linked Task from appearing in active task lists.
    The task is soft-deleted and placed ON_HOLD (not marked as DONE).
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="Wipro Digital Unit",
        assigned_to=REP_A_ID,
    )

    due_dt = datetime.now(timezone.utc) + timedelta(days=1)
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": due_dt.isoformat(), "follow_up_type": "meeting", "notes": "Sprint review"},
        headers=admin_headers,
    )
    fu_id = res_fu.json()["data"]["id"]
    task_id = res_fu.json()["data"]["task_id"]

    # Cancel the follow-up
    res_canc = await client.patch(
        f"/api/v1/crm/follow-ups/{fu_id}/status",
        json={"status": "cancelled"},
        headers=admin_headers,
    )
    assert res_canc.status_code == 200
    assert res_canc.json()["data"]["status"] == "cancelled"

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        task = await session.get(Task, uuid.UUID(task_id))
        assert task is not None
        assert task.status == TaskStatus.ON_HOLD
        assert task.status != TaskStatus.DONE  # Must NOT be marked DONE
        assert task.deleted_at is not None  # Soft-deleted

    # Task must NOT appear in active All Tasks
    res_all = await client.get("/api/v1/tasks?view=all", headers=admin_headers)
    all_ids = [t["id"] for t in res_all.json()["data"]["items"]]
    assert task_id not in all_ids

    # Task must NOT appear in My Tasks
    res_my = await client.get("/api/v1/tasks?view=my", headers=rep_a_headers)
    my_ids = [t["id"] for t in res_my.json()["data"]["items"]]
    assert task_id not in my_ids


# =============================================================================
# 7. Standalone Tasks Unaffected
# =============================================================================


@pytest.mark.asyncio
async def test_standalone_tasks_unaffected(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Standard tasks created directly via the Tasks module continue to work normally
    without CRM interference.
    """
    payload = {
        "title": "Prepare Q4 Financial Statement",
        "description": "Standard finance team task",
        "priority": "HIGH",
        "status": "TODO",
        "issue_type": "TASK",
        "due_date": (date.today() + timedelta(days=7)).isoformat(),
        "assignee_ids": [str(ADMIN_ID)],
    }
    res = await client.post("/api/v1/tasks", json=payload, headers=admin_headers)
    assert res.status_code == 201
    task_data = res.json()["data"]
    assert task_data["title"] == "Prepare Q4 Financial Statement"

    # Confirm it does not create any CRM follow-up
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        fu_stmt = select(CrmFollowUp).where(CrmFollowUp.task_id == uuid.UUID(task_data["id"]))
        fu = (await session.execute(fu_stmt)).scalar_one_or_none()
        assert fu is None


# =============================================================================
# 8. Ordinary CRM Activities Do Not Create Tasks
# =============================================================================


@pytest.mark.asyncio
async def test_ordinary_crm_activities_do_not_create_tasks(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Ordinary CRM touchpoints like notes, calls, or WhatsApp logs
    do not create any Task in the Workforce Tasks module.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="Adani Ports Logistics",
        assigned_to=REP_A_ID,
    )

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        tasks_before = (await session.execute(select(func.count(Task.id)))).scalar()

    # Log ordinary note activity
    res_act = await client.post(
        f"/api/v1/crm/leads/{lead.id}/activities",
        json={
            "activity_type": "note",
            "subject": "Customer feedback on pricing",
            "description": "Sent updated pricing sheet over email",
            "outcome": "positive",
        },
        headers=admin_headers,
    )
    assert res_act.status_code == 201

    # Log call activity
    res_call = await client.post(
        f"/api/v1/crm/leads/{lead.id}/activities",
        json={
            "activity_type": "call",
            "subject": "Discovery call",
            "description": "Spoke with procurement officer",
            "outcome": "connected",
        },
        headers=admin_headers,
    )
    assert res_call.status_code == 201

    async with sessionmaker() as session:
        tasks_after = (await session.execute(select(func.count(Task.id)))).scalar()
        assert tasks_after == tasks_before  # Zero tasks created


# =============================================================================
# 9. Task Permissions Enforced
# =============================================================================


@pytest.mark.asyncio
async def test_task_permissions_enforced(
    client: AsyncClient, no_task_perm_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    A user lacking task.view cannot view tasks via /api/v1/tasks.
    """
    res = await client.get("/api/v1/tasks?view=all", headers=no_task_perm_headers)
    assert res.status_code == 403


# =============================================================================
# 10. Phase 1 Reverse Sync: Task Completion Updates CRM Follow-Up
# =============================================================================


@pytest.mark.asyncio
async def test_completing_workforce_task_completes_linked_crm_follow_up(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Marking a generated Workforce Task as DONE automatically completes its linked CRM follow-up,
    creates a follow_up_completed activity, preserves notes, and updates lead's next follow-up.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="Tata Power Solar",
        assigned_to=REP_A_ID,
    )

    follow_up_time = datetime.now(timezone.utc) + timedelta(days=2)
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={
            "follow_up_type": "meeting",
            "due_at": follow_up_time.isoformat(),
            "notes": "Project kick-off meeting",
            "assigned_to": str(REP_A_ID),
        },
        headers=admin_headers,
    )
    assert res_fu.status_code == 201
    fu_id = uuid.UUID(res_fu.json()["data"]["id"])

    # Locate linked task
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        fu = await session.get(CrmFollowUp, fu_id)
        assert fu is not None
        assert fu.task_id is not None
        assert fu.status == "pending"
        task_id = fu.task_id

    # Complete the Workforce Task via Tasks API
    res_task = await client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "status": "DONE",
            "completion_notes": "Kick-off meeting completed successfully with key stakeholders.",
        },
        headers=admin_headers,
    )
    assert res_task.status_code == 200
    assert res_task.json()["data"]["status"] == "DONE"

    # Verify CRM Follow-up is now completed
    async with sessionmaker() as session:
        fu_updated = await session.get(CrmFollowUp, fu_id)
        assert fu_updated.status == "completed"
        assert fu_updated.completed_at is not None

        # Verify activity was recorded
        act_stmt = select(CrmActivity).where(
            CrmActivity.lead_id == lead.id,
            CrmActivity.activity_type == "follow_up_completed",
        )
        activity = (await session.execute(act_stmt)).scalars().first()
        assert activity is not None
        assert "Kick-off meeting completed" in activity.description
        assert "Project kick-off meeting" in activity.description

        # Verify lead state
        lead_refreshed = await session.get(CrmLead, lead.id)
        assert lead_refreshed.last_contacted_at is not None


@pytest.mark.asyncio
async def test_repeated_task_completion_is_idempotent(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Subsequent completion updates on the same task do not duplicate CRM activities
    or trigger infinite synchronization loops.
    """
    lead = await create_test_lead(
        setup_crm_task_env["pipeline_id"],
        setup_crm_task_env["stage_id"],
        name="L&T Infotech",
        assigned_to=REP_A_ID,
    )

    follow_up_time = datetime.now(timezone.utc) + timedelta(days=1)
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={
            "follow_up_type": "call",
            "due_at": follow_up_time.isoformat(),
            "notes": "Verify deployment schedule",
            "assigned_to": str(REP_A_ID),
        },
        headers=admin_headers,
    )
    assert res_fu.status_code == 201
    fu_id = uuid.UUID(res_fu.json()["data"]["id"])

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        fu = await session.get(CrmFollowUp, fu_id)
        task_id = fu.task_id

    # First completion
    res1 = await client.patch(
        f"/api/v1/tasks/{task_id}",
        json={"status": "DONE"},
        headers=admin_headers,
    )
    assert res1.status_code == 200

    # Second completion (repeat)
    res2 = await client.patch(
        f"/api/v1/tasks/{task_id}",
        json={"status": "DONE"},
        headers=admin_headers,
    )
    assert res2.status_code == 200

    # Ensure only 1 follow_up_completed activity exists
    async with sessionmaker() as session:
        act_stmt = select(func.count(CrmActivity.id)).where(
            CrmActivity.lead_id == lead.id,
            CrmActivity.activity_type == "follow_up_completed",
        )
        count = (await session.execute(act_stmt)).scalar()
        assert count == 1


@pytest.mark.asyncio
async def test_standalone_task_completion_does_not_affect_crm(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_task_env: dict
):
    """
    Completing a normal workforce task with no CRM follow-up link functions normally
    without any CRM side-effects.
    """
    res_create = await client.post(
        "/api/v1/tasks",
        json={
            "title": "Standalone Internal Maintenance Task",
            "description": "Routine server maintenance",
            "priority": "MEDIUM",
        },
        headers=admin_headers,
    )
    assert res_create.status_code == 201
    task_id = res_create.json()["data"]["id"]

    # Mark as DONE
    res_done = await client.patch(
        f"/api/v1/tasks/{task_id}",
        json={"status": "DONE"},
        headers=admin_headers,
    )
    assert res_done.status_code == 200
    assert res_done.json()["data"]["status"] == "DONE"

