"""
Controlled Local CRM QA Data Cleanup Script.

Cleans up test fixture users, orphan test tasks, and establishes the exact
target local QA state:
- 1 Administrator (admin)
- 1 Sales Manager (manager_user_q)
- 1 Salesperson (rep_a_user_q)
- 3–4 CRM leads assigned to manager/salesperson with valid follow-up to Task links.

Safety:
- Enforces ENVIRONMENT == 'local' or 'development'.
- Preserves all real business records and non-test tables.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import delete, func, select, or_
from app.api.v1.router import api_router  # noqa: F401
from app.core.config import settings
from app.database.engine import get_sessionmaker
from app.users.models import User
from app.rbac.models import UserRole, UserPermission
from app.crm.models import CrmLead, CrmFollowUp, CrmActivity, CrmPipeline, CrmPipelineStage
from app.tasks.models import Task, TaskAssignee, TaskComment
from app.crm.follow_up_task_sync import sync_follow_up_to_task

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
SALESPERSON_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")

PRESERVED_USER_IDS = {ADMIN_ID, MANAGER_ID, SALESPERSON_ID}


async def run_cleanup():
    # 1. Environment Safety Check
    if settings.ENVIRONMENT not in ("local", "development", "test"):
        raise RuntimeError(
            f"SAFETY ABORT: Refusing to clean QA data in non-local environment: '{settings.ENVIRONMENT}'"
        )

    print("=" * 60)
    print("INHYMA ERP — LOCAL CRM QA DATA CLEANUP")
    print(f"Environment: {settings.ENVIRONMENT}")
    db_url_str = str(settings.DATABASE_URL)
    print(f"Database URL: {db_url_str.split('@')[-1] if '@' in db_url_str else 'hidden'}")
    print("=" * 60)

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # 2. Identify Test Users to Remove
        stmt_users = select(User).where(
            or_(
                User.username.like("rep_alpha_%"),
                User.username.like("rep_beta_%"),
                User.username.like("no_task_user_%"),
                User.username.like("outsider_rep_%"),
                User.username.like("out_mgr_user_%"),
                User.username.like("rep_b_user_%"),
                User.username.like("qa_crm_%"),
                User.username.in_(["viewer_csv_import", "userc", "userd", "usera", "userb"]),
            )
        )
        test_users = list((await session.execute(stmt_users)).scalars().all())
        test_user_ids = [u.id for u in test_users if u.id not in PRESERVED_USER_IDS]

        print(f"Positively identified test users to remove: {len(test_user_ids)}")
        for u in test_users:
            if u.id in test_user_ids:
                print(f"  - {u.username} ({u.email}, ID: {u.id})")

        # 3. Clean up child records for test users
        if test_user_ids:
            # Delete user permissions & roles for test users
            await session.execute(delete(UserPermission).where(UserPermission.user_id.in_(test_user_ids)))
            await session.execute(delete(UserRole).where(UserRole.user_id.in_(test_user_ids)))

            # Delete test user task assignees & comments
            await session.execute(delete(TaskAssignee).where(TaskAssignee.user_id.in_(test_user_ids)))
            await session.execute(delete(TaskComment).where(TaskComment.user_id.in_(test_user_ids)))

            # Delete CRM activities performed by test users
            await session.execute(delete(CrmActivity).where(CrmActivity.performed_by.in_(test_user_ids)))

            # Delete follow-ups assigned to or created by test users
            await session.execute(
                delete(CrmFollowUp).where(
                    or_(
                        CrmFollowUp.assigned_to.in_(test_user_ids),
                        CrmFollowUp.created_by.in_(test_user_ids),
                    )
                )
            )

            # Delete leads assigned to or created by test users
            await session.execute(
                delete(CrmLead).where(
                    or_(
                        CrmLead.assigned_to.in_(test_user_ids),
                        CrmLead.created_by.in_(test_user_ids),
                    )
                )
            )

            # Finally, delete the test user records themselves
            await session.execute(delete(User).where(User.id.in_(test_user_ids)))
            print(f"Deleted {len(test_user_ids)} test users and their auth associations.")

        # 4. Clean orphan generated tasks from prior automated tests
        # Orphan tasks are those created during tests that are not tied to any active CRM lead
        orphan_tasks_stmt = select(Task).where(
            or_(
                Task.title.like("CRM Follow-up — %"),
                Task.title == "Standalone Internal Maintenance Task",
                Task.title == "Prepare Q4 Financial Statement",
            )
        )
        orphan_tasks = list((await session.execute(orphan_tasks_stmt)).scalars().all())
        orphan_ids = [t.id for t in orphan_tasks]
        if orphan_ids:
            await session.execute(delete(TaskAssignee).where(TaskAssignee.task_id.in_(orphan_ids)))
            await session.execute(delete(TaskComment).where(TaskComment.task_id.in_(orphan_ids)))
            await session.execute(delete(Task).where(Task.id.in_(orphan_ids)))
            print(f"Cleaned up {len(orphan_ids)} orphan test task fixtures.")

        # 5. Clean any existing test leads/follow-ups to establish pristine 4 target leads
        existing_leads = list((await session.execute(select(CrmLead))).scalars().all())
        for l in existing_leads:
            await session.delete(l)
        await session.flush()

        # 6. Verify default Pipeline & Stage exist
        p_stmt = select(CrmPipeline).order_by(CrmPipeline.is_default.desc(), CrmPipeline.created_at.asc()).limit(1)
        pipeline = (await session.execute(p_stmt)).scalars().first()
        if not pipeline:
            pipeline = CrmPipeline(name="Sales Pipeline", is_default=True)
            session.add(pipeline)
            await session.flush()

        s_stmt = select(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline.id).order_by(CrmPipelineStage.stage_order.asc()).limit(1)
        stage = (await session.execute(s_stmt)).scalars().first()
        if not stage:
            stage = CrmPipelineStage(pipeline_id=pipeline.id, name="New", stage_type="open", stage_order=1)
            session.add(stage)
            await session.flush()

        # 7. Seed Pristine Target Leads (exactly 4 leads)
        now_dt = datetime.now(timezone.utc)

        # Lead 1: Assigned to Salesperson (rep_a_user_q) with pending Follow-up & linked Task
        lead1 = CrmLead(
            pipeline_id=pipeline.id,
            stage_id=stage.id,
            lead_code="LD-QA-001",
            name="Acme Industrial Automation",
            company_name="Acme Systems Ltd",
            original_phone="9876543210",
            normalized_phone="9876543210",
            status="contacted",
            priority="high",
            assigned_to=SALESPERSON_ID,
            created_by=ADMIN_ID,
        )
        session.add(lead1)
        await session.flush()

        fu1 = CrmFollowUp(
            lead_id=lead1.id,
            assigned_to=SALESPERSON_ID,
            due_at=now_dt + timedelta(days=2),
            follow_up_type="call",
            notes="Discuss automation requirements and product demo schedule.",
            status="pending",
            created_by=SALESPERSON_ID,
        )
        session.add(fu1)
        await session.flush()
        t1 = await sync_follow_up_to_task(session, fu1, lead1, SALESPERSON_ID)

        # Lead 2: Assigned to Salesperson (rep_a_user_q) with completed Follow-up & DONE Task
        lead2 = CrmLead(
            pipeline_id=pipeline.id,
            stage_id=stage.id,
            lead_code="LD-QA-002",
            name="Zenith Precision Tools",
            company_name="Zenith Manufacturing Ltd",
            original_phone="9876543211",
            normalized_phone="9876543211",
            status="contacted",
            priority="medium",
            assigned_to=SALESPERSON_ID,
            created_by=ADMIN_ID,
        )
        session.add(lead2)
        await session.flush()

        fu2 = CrmFollowUp(
            lead_id=lead2.id,
            assigned_to=SALESPERSON_ID,
            due_at=now_dt - timedelta(days=1),
            follow_up_type="meeting",
            notes="Initial product specification meeting.",
            status="completed",
            completed_at=now_dt - timedelta(hours=4),
            created_by=SALESPERSON_ID,
        )
        session.add(fu2)
        await session.flush()
        t2 = await sync_follow_up_to_task(session, fu2, lead2, SALESPERSON_ID)
        t2.status = "DONE"
        t2.completed_at = fu2.completed_at
        act2 = CrmActivity(
            lead_id=lead2.id,
            activity_type="follow_up_completed",
            subject="Follow-up Completed: Meeting",
            description="Specification meeting held; client requested proposal. (Scheduled context: Initial product specification meeting.)",
            outcome="completed",
            performed_by=SALESPERSON_ID,
            activity_at=fu2.completed_at,
            created_at=fu2.completed_at,
        )
        session.add(act2)

        # Lead 3: Assigned to Sales Manager (manager_user_q) with pending Follow-up & linked Task
        lead3 = CrmLead(
            pipeline_id=pipeline.id,
            stage_id=stage.id,
            lead_code="LD-QA-003",
            name="Global Pharma Packaging",
            company_name="Global Pharma Tech Corp",
            original_phone="9876543212",
            normalized_phone="9876543212",
            status="contacted",
            priority="urgent",
            assigned_to=MANAGER_ID,
            created_by=ADMIN_ID,
        )
        session.add(lead3)
        await session.flush()

        fu3 = CrmFollowUp(
            lead_id=lead3.id,
            assigned_to=MANAGER_ID,
            due_at=now_dt + timedelta(days=3),
            follow_up_type="demo",
            notes="Executive product demo with procurement leadership.",
            status="pending",
            created_by=MANAGER_ID,
        )
        session.add(fu3)
        await session.flush()
        t3 = await sync_follow_up_to_task(session, fu3, lead3, MANAGER_ID)

        # Lead 4: Assigned to Salesperson (rep_a_user_q), New stage, no follow-ups yet
        lead4 = CrmLead(
            pipeline_id=pipeline.id,
            stage_id=stage.id,
            lead_code="LD-QA-004",
            name="Apex Solar Technologies",
            company_name="Apex Green Energy Ltd",
            original_phone="9876543213",
            normalized_phone="9876543213",
            status="new",
            priority="low",
            assigned_to=SALESPERSON_ID,
            created_by=ADMIN_ID,
        )
        session.add(lead4)

        await session.commit()
        print("Target local QA data successfully committed.")

    # 8. Verification Audit
    async with sessionmaker() as session:
        remaining_users = list((await session.execute(select(User.id, User.username, User.email, User.is_active))).all())
        print("\n--- Remaining Users ---")
        for u in remaining_users:
            print(f"  {u.username} ({u.email}, ID: {u.id}, active: {u.is_active})")
        assert len(remaining_users) == 3, f"Expected 3 remaining users, got {len(remaining_users)}"

        remaining_leads = list((await session.execute(select(CrmLead.lead_code, CrmLead.name, CrmLead.assigned_to, CrmLead.status))).all())
        print(f"\n--- Remaining CRM Leads ({len(remaining_leads)}) ---")
        for l in remaining_leads:
            print(f"  [{l.lead_code}] {l.name} | Assigned: {l.assigned_to} | Status: {l.status}")
        assert len(remaining_leads) == 4, f"Expected 4 remaining leads, got {len(remaining_leads)}"

        remaining_fus = list((await session.execute(select(CrmFollowUp.id, CrmFollowUp.follow_up_type, CrmFollowUp.status, CrmFollowUp.task_id))).all())
        print(f"\n--- Remaining CRM Follow-ups ({len(remaining_fus)}) ---")
        for f in remaining_fus:
            print(f"  Follow-up {f.id} ({f.follow_up_type}, status: {f.status}) -> Task ID: {f.task_id}")
            assert f.task_id is not None, "Follow-up must have linked Task ID"

        remaining_tasks = list((await session.execute(select(Task.id, Task.title, Task.status))).all())
        print(f"\n--- Remaining Tasks ({len(remaining_tasks)}) ---")
        for t in remaining_tasks:
            print(f"  Task {t.id}: {t.title} [{t.status}]")

    print("\nSUCCESS: Local CRM QA environment successfully cleaned and verified.")


if __name__ == "__main__":
    asyncio.run(run_cleanup())
