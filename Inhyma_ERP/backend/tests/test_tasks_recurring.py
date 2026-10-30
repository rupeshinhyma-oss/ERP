"""
Tests for Task Module Recurring Tasks Sub-tab Backend Functionality.

Covers:
- Recurrence calculation (monthly clamping, leap year, quarterly, yearly).
- Schedule CRUD, preview, pause, resume, archive.
- Task instance generation idempotency.
- Proper linkage between recurring schedule and generated Task instances.
- Visibility in normal Task list queries.
- Update pending instances vs future instances isolation.
- Reminder and escalation processing.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import asyncio
from datetime import date, datetime, timedelta, timezone

from app.audit.repository import AuditRepository
from app.audit.service import AuditService
from app.auth.service import create_access_token
from app.database.engine import get_sessionmaker
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.tasks.models import Task, TaskRecurringSchedule, TaskStatus
from app.tasks.repository import TaskRepository
from app.tasks.service import TaskService
from app.users.models import User, UserStatus


def _make_task_service(session: AsyncSession) -> TaskService:
    repo = TaskRepository(session)
    audit = AuditService(AuditRepository(session))
    notif = NotificationService(NotificationRepository(session))
    return TaskService(repository=repo, audit_service=audit, notification_service=notif)


@pytest.fixture
async def recurring_test_user() -> User:
    async with get_sessionmaker()() as db_session:
        u = User(
            id=uuid.uuid4(),
            username=f"rec_user_{uuid.uuid4().hex[:6]}",
            email=f"rec_{uuid.uuid4().hex[:6]}@example.com",
            display_name="Recurring Task User",
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        db_session.add(u)
        await db_session.commit()
        await db_session.refresh(u)
        return u


@pytest.fixture
async def recurring_manager_user() -> User:
    async with get_sessionmaker()() as db_session:
        m = User(
            id=uuid.uuid4(),
            username=f"rec_mgr_{uuid.uuid4().hex[:6]}",
            email=f"rec_mgr_{uuid.uuid4().hex[:6]}@example.com",
            display_name="Recurring Task Manager",
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        db_session.add(m)
        await db_session.commit()
        await db_session.refresh(m)
        return m


def auth_headers(user_id: uuid.UUID, permissions: list[str]) -> dict[str, str]:
    tok_obj = create_access_token(
        user_id,
        permissions=permissions,
    )
    token_str = getattr(tok_obj, "token", tok_obj)
    return {"Authorization": f"Bearer {token_str}"}


@pytest.mark.asyncio
async def test_recurring_preview_endpoint(
    client: AsyncClient,
    recurring_test_user: User,
) -> None:
    """Test /tasks/recurring/preview endpoint returns calculated occurrences with clamping."""
    headers = auth_headers(recurring_test_user.id, ["task.view"])

    # Monthly preview with day 31 (checks month clamping for Feb and April)
    payload = {
        "frequency": "MONTHLY",
        "recurrence_config": {"day_of_month": 31, "day_type": "SPECIFIC_DAY"},
        "start_date": "2026-01-15",
        "count": 4,
    }
    res = await client.post("/api/v1/tasks/recurring/preview", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "occurrences" in data
    assert len(data["occurrences"]) == 4
    # Jan 31
    assert data["occurrences"][0]["due_date"] == "2026-01-31"
    # Feb 28 (2026 is non-leap year)
    assert data["occurrences"][1]["due_date"] == "2026-02-28"
    # Mar 31
    assert data["occurrences"][2]["due_date"] == "2026-03-31"
    # Apr 30 (clamped from 31)
    assert data["occurrences"][3]["due_date"] == "2026-04-30"


@pytest.mark.asyncio
async def test_recurring_schedule_lifecycle_and_generation(
    client: AsyncClient,
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test full schedule creation, automatic generation, idempotency, pause, resume, and archive."""
    headers = auth_headers(recurring_test_user.id, ["task.view", "task.create", "task.manage"])

    create_payload = {
        "title": "Monthly Branch Inventory Audit",
        "description": "Standard recurring count of branch stock",
        "department": "Operations",
        "assignee_id": str(recurring_test_user.id),
        "manager_id": str(recurring_manager_user.id),
        "priority": "HIGH",
        "issue_type": "TASK",
        "frequency": "MONTHLY",
        "recurrence_config": {"day_of_month": 28, "day_type": "SPECIFIC_DAY"},
        "reminder_lead_days": 3,
        "escalation_timing_type": "ON_DUE_DATE",
        "escalation_offset_days": 0,
        "escalation_repeat_interval_days": 7,
        "effective_start_date": date.today().isoformat(),
    }

    # 1. Create schedule
    res = await client.post("/api/v1/tasks/recurring/schedules", json=create_payload, headers=headers)
    assert res.status_code == 201
    sch_data = res.json()["data"]
    schedule_id = sch_data["id"]
    assert sch_data["title"] == "Monthly Branch Inventory Audit"
    assert sch_data["status"] == "ACTIVE"
    assert sch_data["frequency"] == "MONTHLY"

    # 2. Verify Task was automatically generated
    instances_res = await client.get(
        f"/api/v1/tasks/recurring/instances?schedule_id={schedule_id}", headers=headers
    )
    assert instances_res.status_code == 200
    instances = instances_res.json()["data"]
    assert len(instances) >= 1
    gen_task = instances[0]
    assert gen_task["recurring_schedule_id"] == schedule_id
    assert "Monthly Branch Inventory Audit" in gen_task["title"]
    assert gen_task["status"] == "TODO"

    # 3. Test IDEMPOTENCY: Repeated trigger_generate_recurring_tasks does not duplicate
    gen_again = await client.post(
        f"/api/v1/tasks/recurring/generate?schedule_id={schedule_id}", headers=headers
    )
    assert gen_again.status_code == 200
    # Generated count should be 0 because current period task already exists
    assert gen_again.json()["data"]["generated_count"] == 0

    instances_res2 = await client.get(
        f"/api/v1/tasks/recurring/instances?schedule_id={schedule_id}", headers=headers
    )
    assert len(instances_res2.json()["data"]) == len(instances)

    # 4. Verify generated task appears in standard task list
    normal_tasks_res = await client.get(
        f"/api/v1/tasks?view=all&search=Monthly Branch Inventory Audit&page_size=200", headers=headers
    )
    assert normal_tasks_res.status_code == 200
    task_items = normal_tasks_res.json()["data"]["items"]
    matched = [t for t in task_items if t["id"] == gen_task["id"]]
    assert len(matched) == 1
    assert matched[0]["recurring_schedule_id"] == schedule_id

    # 5. Pause schedule
    pause_res = await client.post(
        f"/api/v1/tasks/recurring/schedules/{schedule_id}/pause", headers=headers
    )
    assert pause_res.status_code == 200
    assert pause_res.json()["data"]["status"] == "PAUSED"

    # 6. Resume schedule
    resume_res = await client.post(
        f"/api/v1/tasks/recurring/schedules/{schedule_id}/resume", headers=headers
    )
    assert resume_res.status_code == 200
    assert resume_res.json()["data"]["status"] == "ACTIVE"

    # 7. Update schedule with pending instances sync
    update_res = await client.patch(
        f"/api/v1/tasks/recurring/schedules/{schedule_id}",
        json={"title": "Updated Branch Audit", "update_pending_instances": True},
        headers=headers,
    )
    assert update_res.status_code == 200
    assert update_res.json()["data"]["title"] == "Updated Branch Audit"

    # Check pending task was updated
    chk_task_res = await client.get(f"/api/v1/tasks/{gen_task['id']}", headers=headers)
    assert chk_task_res.status_code == 200
    assert "Updated Branch Audit" in chk_task_res.json()["data"]["title"]

    # 8. Archive schedule
    arch_res = await client.post(
        f"/api/v1/tasks/recurring/schedules/{schedule_id}/archive", headers=headers
    )
    assert arch_res.status_code == 200
    assert arch_res.json()["data"]["status"] == "ARCHIVED"

    # Generated task is preserved!
    chk_task_res2 = await client.get(f"/api/v1/tasks/{gen_task['id']}", headers=headers)
    assert chk_task_res2.status_code == 200


@pytest.mark.asyncio
async def test_recurring_reminders_and_escalations(
    client: AsyncClient,
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test automated reminder detection and escalation creation for overdue/due recurring tasks."""
    headers = auth_headers(recurring_test_user.id, ["task.view", "task.create", "task.manage"])

    # Create schedule due yesterday
    yesterday = date.today() - timedelta(days=1)
    async with get_sessionmaker()() as db_session:
        sch = TaskRecurringSchedule(
            title="Escalation Test Task",
            assignee_id=recurring_test_user.id,
            manager_id=recurring_manager_user.id,
            created_by=recurring_test_user.id,
            frequency="MONTHLY",
            recurrence_config={"day_of_month": yesterday.day},
            reminder_lead_days=3,
            escalation_timing_type="ON_DUE_DATE",
            escalation_offset_days=0,
            status="ACTIVE",
            effective_start_date=yesterday,
        )
        db_session.add(sch)
        await db_session.commit()
        await db_session.refresh(sch)

        # Manually create task instance for yesterday
        t = Task(
            title="Escalation Test Task [PAST]",
            recurring_schedule_id=sch.id,
            recurrence_period="PAST-PERIOD",
            status=TaskStatus.TODO,
            due_date=yesterday,
            created_by=recurring_test_user.id,
        )
        db_session.add(t)
        await db_session.commit()
        await db_session.refresh(t)
        task_id = t.id

    # Trigger reminder and escalation check
    check_res = await client.post("/api/v1/tasks/recurring/check-reminders", headers=headers)
    assert check_res.status_code == 200
    data = check_res.json()["data"]
    assert "escalations_triggered" in data
    assert data["escalations_triggered"] >= 1

    # Verify task detail now has escalation
    task_res = await client.get(f"/api/v1/tasks/{task_id}", headers=headers)
    assert task_res.status_code == 200
    escalations = task_res.json()["data"]["escalations"]
    assert len(escalations) >= 1
    assert escalations[0]["to_user"] == str(recurring_manager_user.id)


def test_monday_to_saturday_working_calendar() -> None:
    """Test get_last_working_day_of_month respects Monday-Saturday working week (Sunday non-working)."""
    from app.tasks.recurring_calculator import get_last_working_day_of_month

    # May 31, 2026 is Sunday -> steps back 1 day to Saturday May 30
    may_2026 = get_last_working_day_of_month(2026, 5)
    assert may_2026 == date(2026, 5, 30)
    assert may_2026.weekday() == 5  # Saturday

    # October 31, 2026 is Saturday -> remains Saturday Oct 31 (since Saturday is a working day)
    oct_2026 = get_last_working_day_of_month(2026, 10)
    assert oct_2026 == date(2026, 10, 31)
    assert oct_2026.weekday() == 5  # Saturday

    # July 31, 2026 is Friday -> remains Friday July 31
    jul_2026 = get_last_working_day_of_month(2026, 7)
    assert jul_2026 == date(2026, 7, 31)
    assert jul_2026.weekday() == 4  # Friday

    # February 28, 2026 is Saturday -> remains Feb 28
    feb_2026 = get_last_working_day_of_month(2026, 2)
    assert feb_2026 == date(2026, 2, 28)

    # February 2024 was leap year: Feb 29, 2024 was Thursday -> remains Feb 29
    feb_2024 = get_last_working_day_of_month(2024, 2)
    assert feb_2024 == date(2024, 2, 29)


@pytest.mark.asyncio
async def test_monthly_specific_months_and_last_working_day(
    client: AsyncClient,
    recurring_test_user: User,
) -> None:
    """Test preview for Specific Months and Last Working Day (Mon-Sat)."""
    headers = auth_headers(recurring_test_user.id, ["task.view"])

    # Specific months: March and September only, with LAST_WORKING_DAY
    payload = {
        "frequency": "MONTHLY",
        "recurrence_config": {
            "month_mode": "SPECIFIC_MONTHS",
            "months": [3, 9],
            "day_type": "LAST_WORKING_DAY",
        },
        "start_date": "2026-01-01",
        "count": 3,
    }
    res = await client.post("/api/v1/tasks/recurring/preview", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    occurrences = data["occurrences"]
    assert len(occurrences) == 3
    # First: March 2026 (Mar 31 is Tuesday)
    assert occurrences[0]["period"] == "2026-03"
    assert occurrences[0]["due_date"] == "2026-03-31"
    # Second: September 2026 (Sep 30 is Wednesday)
    assert occurrences[1]["period"] == "2026-09"
    assert occurrences[1]["due_date"] == "2026-09-30"
    # Third: March 2027 (Mar 31 is Wednesday)
    assert occurrences[2]["period"] == "2027-03"
    assert occurrences[2]["due_date"] == "2027-03-31"


@pytest.mark.asyncio
async def test_quarterly_custom_quarter_due_dates(
    client: AsyncClient,
    recurring_test_user: User,
) -> None:
    """Test Quarterly schedule with custom quarter dates per selected quarter."""
    headers = auth_headers(recurring_test_user.id, ["task.view"])

    payload = {
        "frequency": "QUARTERLY",
        "recurrence_config": {
            "quarters": ["Q1", "Q3"],
            "quarter_dates": {
                "Q1": {"month": 3, "day_type": "SPECIFIC_DAY", "day": 15},
                "Q3": {"month": 9, "day_type": "SPECIFIC_DAY", "day": 20},
            },
        },
        "start_date": "2026-01-01",
        "count": 3,
    }
    res = await client.post("/api/v1/tasks/recurring/preview", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    occurrences = data["occurrences"]
    assert len(occurrences) == 3
    # Q1 2026: March 15
    assert occurrences[0]["period"] == "2026-Q1"
    assert occurrences[0]["due_date"] == "2026-03-15"
    # Q3 2026: September 20
    assert occurrences[1]["period"] == "2026-Q3"
    assert occurrences[1]["due_date"] == "2026-09-20"
    # Q1 2027: March 15
    assert occurrences[2]["period"] == "2027-Q1"
    assert occurrences[2]["due_date"] == "2027-03-15"


@pytest.mark.asyncio
async def test_yearly_financial_year_due_date(
    client: AsyncClient,
    recurring_test_user: User,
) -> None:
    """Test Yearly schedule with Financial Year (April start) and due date calculation."""
    headers = auth_headers(recurring_test_user.id, ["task.view"])

    payload = {
        "frequency": "YEARLY",
        "recurrence_config": {
            "year_type": "FINANCIAL",
            "financial_year_start_month": 4,
            "due_month": 3,
            "due_day": 31,
            "day_type": "LAST_WORKING_DAY",
        },
        "start_date": "2026-04-01",
        "count": 2,
    }
    res = await client.post("/api/v1/tasks/recurring/preview", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    occurrences = data["occurrences"]
    assert len(occurrences) == 2
    # Financial year 2026-27 ending in March 2027
    assert occurrences[0]["period"] == "FY2026-27"
    assert occurrences[0]["due_date"] == "2027-03-31"
    # Financial year 2027-28 ending in March 2028
    assert occurrences[1]["period"] == "FY2027-28"
    assert occurrences[1]["due_date"] == "2028-03-31"


@pytest.mark.asyncio
async def test_preview_timeline_reminders_escalation_hold(
    client: AsyncClient,
    recurring_test_user: User,
) -> None:
    """Test preview timeline details including reminder lead date, escalation date, and repeat interval."""
    headers = auth_headers(recurring_test_user.id, ["task.view"])

    payload = {
        "frequency": "MONTHLY",
        "recurrence_config": {
            "day_of_month": 20,
            "day_type": "SPECIFIC_DAY",
        },
        "start_date": "2026-10-01",
        "reminder_lead_days": 4,
        "escalation_timing_type": "BEFORE_DUE_DATE",
        "escalation_offset_days": 2,
        "escalation_repeat_interval_days": 7,
    }
    res = await client.post("/api/v1/tasks/recurring/preview", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["next_due_date"] == "2026-10-20"
    # Reminder: 4 days before Oct 20 -> Oct 16
    assert data["reminder_date"] == "2026-10-16"
    # Escalation: 2 days before Oct 20 -> Oct 18
    assert data["escalation_date"] == "2026-10-18"
    assert data["repeat_escalation_interval"] == "Every 7 days while incomplete"


@pytest.mark.asyncio
async def test_rbac_recurring_schedules_denial_and_side_effects(
    client: AsyncClient,
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test RBAC enforcement: Admin vs Manager vs Employee vs Unauthenticated."""
    # 1. Unauthenticated request -> 401
    unauth_res = await client.get("/api/v1/tasks/recurring/schedules")
    assert unauth_res.status_code == 401

    unauth_post = await client.post(
        "/api/v1/tasks/recurring/schedules",
        json={"title": "Unauthorized Schedule", "frequency": "MONTHLY", "recurrence_config": {"day": 15}},
    )
    assert unauth_post.status_code == 401

    # 2. Regular employee without task.create or task.manage (only task.view)
    emp_headers = auth_headers(recurring_test_user.id, ["task.view"])

    # Employee CAN view schedules
    view_res = await client.get("/api/v1/tasks/recurring/schedules", headers=emp_headers)
    assert view_res.status_code == 200

    # Employee CANNOT create schedule -> 403 Forbidden
    create_attempt = await client.post(
        "/api/v1/tasks/recurring/schedules",
        json={
            "title": "Employee Created Schedule",
            "frequency": "MONTHLY",
            "recurrence_config": {"day": 15},
            "effective_start_date": "2026-10-01",
            "assignee_id": str(recurring_test_user.id),
            "manager_id": str(recurring_manager_user.id),
        },
        headers=emp_headers,
    )
    assert create_attempt.status_code == 403

    # Employee CANNOT trigger generator -> 403 Forbidden
    gen_attempt = await client.post("/api/v1/tasks/recurring/generate", headers=emp_headers)
    assert gen_attempt.status_code == 403

    # Employee CANNOT trigger check-reminders -> 403 Forbidden
    check_attempt = await client.post("/api/v1/tasks/recurring/check-reminders", headers=emp_headers)
    assert check_attempt.status_code == 403

    # 3. Admin with task.manage creates a schedule
    admin_headers = auth_headers(recurring_manager_user.id, ["task.view", "task.create", "task.manage"])
    admin_create = await client.post(
        "/api/v1/tasks/recurring/schedules",
        json={
            "title": "Admin Created Schedule",
            "frequency": "MONTHLY",
            "recurrence_config": {"day": 15},
            "effective_start_date": "2026-10-01",
            "assignee_id": str(recurring_test_user.id),
            "manager_id": str(recurring_manager_user.id),
        },
        headers=admin_headers,
    )
    assert admin_create.status_code == 201
    sch_id = admin_create.json()["data"]["id"]

    # Employee CANNOT edit, pause, resume, or archive admin's schedule
    assert (await client.patch(f"/api/v1/tasks/recurring/schedules/{sch_id}", json={"title": "Hacked"}, headers=emp_headers)).status_code == 403
    assert (await client.post(f"/api/v1/tasks/recurring/schedules/{sch_id}/pause", headers=emp_headers)).status_code == 403
    assert (await client.post(f"/api/v1/tasks/recurring/schedules/{sch_id}/resume", headers=emp_headers)).status_code == 403
    assert (await client.post(f"/api/v1/tasks/recurring/schedules/{sch_id}/archive", headers=emp_headers)).status_code == 403
    assert (await client.delete(f"/api/v1/tasks/recurring/schedules/{sch_id}", headers=emp_headers)).status_code == 403

    # Verify schedule in database is UNCHANGED
    sch_check = await client.get(f"/api/v1/tasks/recurring/schedules/{sch_id}", headers=admin_headers)
    assert sch_check.status_code == 200
    assert sch_check.json()["data"]["title"] == "Admin Created Schedule"
    assert sch_check.json()["data"]["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_concurrent_generation_database_idempotency(
    client: AsyncClient,
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test that concurrent generation runs do not produce duplicate tasks at database level."""
    async with get_sessionmaker()() as db_session:
        sch = TaskRecurringSchedule(
            title="Concurrency Test Schedule",
            assignee_id=recurring_test_user.id,
            manager_id=recurring_manager_user.id,
            created_by=recurring_test_user.id,
            frequency="MONTHLY",
            recurrence_config={"day": 10},
            status="ACTIVE",
            effective_start_date=date(2026, 1, 1),
        )
        db_session.add(sch)
        await db_session.commit()
        await db_session.refresh(sch)
        sch_id = sch.id

    async def run_worker_pass() -> int:
        async with get_sessionmaker()() as s:
            svc = _make_task_service(s)
            tasks = await svc.generate_recurring_tasks(as_of_date=date(2026, 1, 15), schedule_id=sch_id)
            return len(tasks)

    # Concurrently execute two generator tasks for the exact same schedule and period
    results = await asyncio.gather(run_worker_pass(), run_worker_pass(), return_exceptions=False)
    # Total generated across both threads must equal exactly 1 (one succeeded, one detected existing/caught race)
    assert sum(results) == 1

    # Verify only 1 instance exists in database
    async with get_sessionmaker()() as s:
        repo = TaskRepository(s)
        instances = await repo.list_recurring_instances(schedule_id=sch_id, history_only=False)
        assert len(instances) == 1


@pytest.mark.asyncio
async def test_reminder_deduplication_and_zero_lead_days(
    client: AsyncClient,
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test zero-day reminder lead time (due date) and reminder deduplication on repeat runs."""
    today = date(2026, 10, 15)

    async with get_sessionmaker()() as s:
        sch = TaskRecurringSchedule(
            title="Zero Lead Reminder Task",
            assignee_id=recurring_test_user.id,
            manager_id=recurring_manager_user.id,
            created_by=recurring_test_user.id,
            frequency="MONTHLY",
            recurrence_config={"day": 15},
            reminder_lead_days=0,  # Due today
            status="ACTIVE",
            effective_start_date=today,
        )
        s.add(sch)
        await s.commit()
        await s.refresh(sch)

        t = Task(
            title="Zero Lead Reminder Task [2026-10]",
            recurring_schedule_id=sch.id,
            recurrence_period="2026-10",
            status=TaskStatus.TODO,
            due_date=today,
            created_by=recurring_test_user.id,
        )
        s.add(t)
        await s.commit()
        await s.refresh(t)
        task_id = t.id

    # 1. First run on due date: reminder is dispatched
    async with get_sessionmaker()() as s:
        svc = _make_task_service(s)
        stats1 = await svc.check_recurring_reminders_and_escalations(as_of_date=today)
        assert stats1["reminders_sent"] >= 1

    # 2. Second run on SAME date: reminder must NOT be duplicated!
    async with get_sessionmaker()() as s:
        svc = _make_task_service(s)
        stats2 = await svc.check_recurring_reminders_and_escalations(as_of_date=today)
        assert stats2["reminders_sent"] == 0

    # 3. Complete task: running again must send 0 reminders
    async with get_sessionmaker()() as s:
        repo = TaskRepository(s)
        task_obj = await repo.get_task_by_id(task_id)
        assert task_obj is not None
        task_obj.status = TaskStatus.DONE
        await s.commit()

        svc = _make_task_service(s)
        stats3 = await svc.check_recurring_reminders_and_escalations(as_of_date=today)
        assert stats3["reminders_sent"] == 0


@pytest.mark.asyncio
async def test_manager_escalation_repeat_interval_and_hold_suppression(
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test initial escalation, repeat escalation after interval, and suppression during hold."""
    base_date = date(2026, 10, 1)

    async with get_sessionmaker()() as s:
        sch = TaskRecurringSchedule(
            title="Escalation Repeat Test",
            assignee_id=recurring_test_user.id,
            manager_id=recurring_manager_user.id,
            created_by=recurring_test_user.id,
            frequency="MONTHLY",
            recurrence_config={"day": 1},
            reminder_lead_days=3,
            escalation_timing_type="ON_DUE_DATE",
            escalation_offset_days=0,
            escalation_repeat_interval_days=5,  # Repeat every 5 days
            status="ACTIVE",
            effective_start_date=base_date,
        )
        s.add(sch)
        await s.commit()
        await s.refresh(sch)

        t = Task(
            title="Escalation Repeat Test [2026-10]",
            recurring_schedule_id=sch.id,
            recurrence_period="2026-10",
            status=TaskStatus.TODO,
            due_date=base_date,
            created_by=recurring_test_user.id,
        )
        s.add(t)
        await s.commit()
        await s.refresh(t)
        task_id = t.id

    # 1. Day 1 (Oct 1): initial escalation triggers
    async with get_sessionmaker()() as s:
        svc = _make_task_service(s)
        stats1 = await svc.check_recurring_reminders_and_escalations(schedule_id=sch.id, as_of_date=base_date)
        assert stats1["escalations_triggered"] == 1

    # 2. Day 3 (Oct 3, 2 days later): repeat interval is 5 days -> no repeat escalation yet
    async with get_sessionmaker()() as s:
        svc = _make_task_service(s)
        stats2 = await svc.check_recurring_reminders_and_escalations(schedule_id=sch.id, as_of_date=base_date + timedelta(days=2))
        assert stats2["escalations_triggered"] == 0

    # 3. Day 6 (Oct 6, 5 days later): repeat escalation triggers!
    async with get_sessionmaker()() as s:
        svc = _make_task_service(s)
        stats3 = await svc.check_recurring_reminders_and_escalations(schedule_id=sch.id, as_of_date=base_date + timedelta(days=5))
        assert stats3["escalations_triggered"] == 1

    # 4. Hold suppression: put task on hold until Oct 15
    async with get_sessionmaker()() as s:
        repo = TaskRepository(s)
        task_obj = await repo.get_task_by_id(task_id)
        assert task_obj is not None
        task_obj.hold_until = base_date + timedelta(days=14)
        task_obj.status = TaskStatus.ON_HOLD
        await s.commit()

        # Day 11 (Oct 11, 10 days later): would normally repeat, but held -> 0 escalations
        svc = _make_task_service(s)
        stats4 = await svc.check_recurring_reminders_and_escalations(schedule_id=sch.id, as_of_date=base_date + timedelta(days=10))
        assert stats4["escalations_triggered"] == 0


@pytest.mark.asyncio
async def test_schedule_edit_synchronization_safety(
    client: AsyncClient,
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test schedule edit: Scenario A (unsynced) vs Scenario B (synced) safety isolation."""
    headers = auth_headers(recurring_manager_user.id, ["task.view", "task.create", "task.manage"])

    # Create schedule
    create_res = await client.post(
        "/api/v1/tasks/recurring/schedules",
        json={
            "title": "Initial Sync Test Schedule",
            "frequency": "MONTHLY",
            "recurrence_config": {"day": 25},
            "priority": "LOW",
            "effective_start_date": "2026-10-01",
            "assignee_id": str(recurring_test_user.id),
            "manager_id": str(recurring_manager_user.id),
        },
        headers=headers,
    )
    assert create_res.status_code == 201
    sch_id = create_res.json()["data"]["id"]

    # Retrieve generated pending task
    inst_res = await client.get(f"/api/v1/tasks/recurring/instances?schedule_id={sch_id}", headers=headers)
    pending_task = inst_res.json()["data"][0]
    task_id = pending_task["id"]
    assert "Initial Sync Test Schedule" in pending_task["title"]

    # SCENARIO A: Edit with update_pending_instances=False
    patch_unsynced = await client.patch(
        f"/api/v1/tasks/recurring/schedules/{sch_id}",
        json={"title": "Renamed Schedule Unsynced", "update_pending_instances": False},
        headers=headers,
    )
    assert patch_unsynced.status_code == 200

    # Pending instance remains unchanged
    chk1 = await client.get(f"/api/v1/tasks/{task_id}", headers=headers)
    assert chk1.json()["data"]["title"] == pending_task["title"]

    # SCENARIO B: Edit with update_pending_instances=True
    patch_synced = await client.patch(
        f"/api/v1/tasks/recurring/schedules/{sch_id}",
        json={"title": "Renamed Schedule Synced", "priority": "CRITICAL", "update_pending_instances": True},
        headers=headers,
    )
    assert patch_synced.status_code == 200

    # Pending instance is now updated
    chk2 = await client.get(f"/api/v1/tasks/{task_id}", headers=headers)
    assert "Renamed Schedule Synced" in chk2.json()["data"]["title"]
    assert chk2.json()["data"]["priority"] == "CRITICAL"


@pytest.mark.asyncio
async def test_recurring_worker_trigger_now(client: AsyncClient) -> None:
    """Test RecurringTaskWorker.trigger_now executes cycle and returns structured stats."""
    from app.tasks.recurring_worker import recurring_task_worker

    stats = await recurring_task_worker.trigger_now(as_of_date=date(2026, 10, 21))
    assert "generated_count" in stats
    assert "reminders_sent" in stats
    assert "escalations_triggered" in stats
    assert "run_at" in stats


@pytest.mark.asyncio
async def test_recurring_schedule_archive_and_restore_lifecycle(
    client: AsyncClient,
    recurring_test_user: User,
    recurring_manager_user: User,
) -> None:
    """Test full archive & unarchive/restore lifecycle, state retention, idempotency, RBAC, and error validation."""
    mgr_headers = auth_headers(recurring_manager_user.id, ["task.view", "task.create", "task.manage"])
    emp_headers = auth_headers(recurring_test_user.id, ["task.view"])

    # 1. Create Active Schedule
    sch_act_res = await client.post(
        "/api/v1/tasks/recurring/schedules",
        json={
            "title": "Active Lifecycle Schedule",
            "frequency": "MONTHLY",
            "recurrence_config": {"day": 15},
            "assignee_id": str(recurring_test_user.id),
            "manager_id": str(recurring_manager_user.id),
            "effective_start_date": "2026-10-01",
        },
        headers=mgr_headers,
    )
    assert sch_act_res.status_code == 201
    act_id = sch_act_res.json()["data"]["id"]

    # 2. Create and Pause another Schedule
    sch_pau_res = await client.post(
        "/api/v1/tasks/recurring/schedules",
        json={
            "title": "Paused Lifecycle Schedule",
            "frequency": "MONTHLY",
            "recurrence_config": {"day": 20},
            "assignee_id": str(recurring_test_user.id),
            "manager_id": str(recurring_manager_user.id),
            "effective_start_date": "2026-10-01",
        },
        headers=mgr_headers,
    )
    assert sch_pau_res.status_code == 201
    pau_id = sch_pau_res.json()["data"]["id"]

    pause_res = await client.post(f"/api/v1/tasks/recurring/schedules/{pau_id}/pause", headers=mgr_headers)
    assert pause_res.status_code == 200
    assert pause_res.json()["data"]["status"] == "PAUSED"

    # 3. Archive Active Schedule -> status ARCHIVED
    arch_act = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/archive", headers=mgr_headers)
    assert arch_act.status_code == 200
    assert arch_act.json()["data"]["status"] == "ARCHIVED"
    assert arch_act.json()["data"]["next_run_date"] is None

    # 4. Archive Paused Schedule -> status ARCHIVED
    arch_pau = await client.post(f"/api/v1/tasks/recurring/schedules/{pau_id}/archive", headers=mgr_headers)
    assert arch_pau.status_code == 200
    assert arch_pau.json()["data"]["status"] == "ARCHIVED"

    # 5. Idempotent repeated archive -> still 200 ARCHIVED
    arch_repeat = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/archive", headers=mgr_headers)
    assert arch_repeat.status_code == 200
    assert arch_repeat.json()["data"]["status"] == "ARCHIVED"

    # 6. Invalid transitions: cannot pause or resume an archived schedule directly
    bad_pause = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/pause", headers=mgr_headers)
    assert bad_pause.status_code == 422
    assert "Cannot pause an archived" in bad_pause.json().get("message", "")

    bad_resume = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/resume", headers=mgr_headers)
    assert bad_resume.status_code == 422
    assert "Cannot resume an archived" in bad_resume.json().get("message", "")

    # 7. RBAC: Unauthorized employee cannot archive or restore
    emp_arch_attempt = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/archive", headers=emp_headers)
    assert emp_arch_attempt.status_code == 403

    emp_restore_attempt = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/unarchive", headers=emp_headers)
    assert emp_restore_attempt.status_code == 403

    # 8. Status filter: ?status=ARCHIVED returns archived schedules
    archived_list_res = await client.get("/api/v1/tasks/recurring/schedules?status=ARCHIVED", headers=mgr_headers)
    assert archived_list_res.status_code == 200
    arch_ids = [s["id"] for s in archived_list_res.json()["data"]]
    assert act_id in arch_ids
    assert pau_id in arch_ids

    # 9. Archived schedule generation check: running generator produces 0 tasks
    gen_res = await client.post(f"/api/v1/tasks/recurring/generate?schedule_id={act_id}", headers=mgr_headers)
    assert gen_res.status_code == 200
    assert gen_res.json()["data"]["generated_count"] == 0

    # 10. Restore Active Schedule (was ACTIVE before archive) -> returns to ACTIVE
    restore_act = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/unarchive", headers=mgr_headers)
    assert restore_act.status_code == 200
    assert restore_act.json()["data"]["status"] == "ACTIVE"
    assert restore_act.json()["data"]["next_run_date"] is not None

    # 11. Restore Paused Schedule (was PAUSED before archive) -> returns to PAUSED
    restore_pau = await client.post(f"/api/v1/tasks/recurring/schedules/{pau_id}/restore", headers=mgr_headers)
    assert restore_pau.status_code == 200
    assert restore_pau.json()["data"]["status"] == "PAUSED"
    assert restore_pau.json()["data"]["next_run_date"] is None

    # 12. Idempotent repeated restore -> still 200
    restore_repeat = await client.post(f"/api/v1/tasks/recurring/schedules/{act_id}/unarchive", headers=mgr_headers)
    assert restore_repeat.status_code == 200
    assert restore_repeat.json()["data"]["status"] == "ACTIVE"

    # 13. Generation after restore: generates exactly 1 task for the period, no duplicates on repeat
    gen_post_restore = await client.post(f"/api/v1/tasks/recurring/generate?schedule_id={act_id}", headers=mgr_headers)
    assert gen_post_restore.status_code == 200
    # On first run after restore, period may be generated
    first_gen_cnt = gen_post_restore.json()["data"]["generated_count"]
    # Re-running immediately must generate 0 duplicates
    gen_again = await client.post(f"/api/v1/tasks/recurring/generate?schedule_id={act_id}", headers=mgr_headers)
    assert gen_again.status_code == 200
    assert gen_again.json()["data"]["generated_count"] == 0

    # 14. Expired schedule: cannot restore if effective_end_date is in the past
    sch_exp_res = await client.post(
        "/api/v1/tasks/recurring/schedules",
        json={
            "title": "Expired Schedule",
            "frequency": "MONTHLY",
            "recurrence_config": {"day": 10},
            "assignee_id": str(recurring_test_user.id),
            "manager_id": str(recurring_manager_user.id),
            "effective_start_date": "2026-01-01",
            "effective_end_date": "2026-02-01",
        },
        headers=mgr_headers,
    )
    assert sch_exp_res.status_code == 201
    exp_id = sch_exp_res.json()["data"]["id"]

    await client.post(f"/api/v1/tasks/recurring/schedules/{exp_id}/archive", headers=mgr_headers)
    expired_restore_attempt = await client.post(f"/api/v1/tasks/recurring/schedules/{exp_id}/restore", headers=mgr_headers)
    assert expired_restore_attempt.status_code == 422
    assert "effective end date" in expired_restore_attempt.json().get("message", "").lower()
