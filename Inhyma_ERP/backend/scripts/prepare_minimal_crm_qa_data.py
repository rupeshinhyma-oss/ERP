"""
Controlled Local CRM QA Minimal Dataset Preparation.

Prepares exactly:
- 1 Administrator (admin)
- 1 Sales Manager (manager_user_q)
- 1 Salesperson (rep_a_user_q)
- 4 clearly identified QA leads:
  * CRM QA - Acme (Assigned to salesperson)
  * CRM QA - Zenith (Assigned to salesperson)
  * CRM QA - Global (Assigned to manager)
  * CRM QA - Apex (Assigned to salesperson)
- Minimal follow-up and generated Task records to test integration.

Safety:
- Enforces ENVIRONMENT == 'local' or 'development'.
- Preserves all real business records.
- Reuses existing QA users and leads where possible without creating duplicates.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import delete, func, select, or_
from app.api.v1.router import api_router  # noqa: F401 - registers all ORM models
from app.core.config import settings
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus
from app.rbac.models import Role, UserRole, UserPermission
from app.crm.models import CrmLead, CrmFollowUp, CrmActivity, CrmPipeline, CrmPipelineStage
from app.tasks.models import Task, TaskAssignee, TaskComment, TaskPriority, TaskStatus
from app.crm.follow_up_task_sync import sync_follow_up_to_task

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
SALESPERSON_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")


async def prepare_qa_data():
    # 1. Environment Safety Check
    env = str(settings.ENVIRONMENT).lower()
    if "prod" in env or "stag" in env:
        raise RuntimeError(f"ABORT: Cannot run QA dataset preparation on non-development environment: {settings.ENVIRONMENT}")
    print(f"Environment Safety Check: OK ({settings.ENVIRONMENT})")

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # 2. Clean temporary test users (REP_B_ID, NO_TASK_USER_ID, etc.)
        temp_ids = [
            uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df"),
            uuid.UUID("44444444-4444-4444-4444-444444444444"),
        ]
        await session.execute(delete(TaskAssignee).where(TaskAssignee.user_id.in_(temp_ids)))
        await session.execute(delete(UserRole).where(UserRole.user_id.in_(temp_ids)))
        await session.execute(delete(UserPermission).where(UserPermission.user_id.in_(temp_ids)))
        await session.execute(delete(User).where(User.id.in_(temp_ids)))

        # 3. Ensure the 3 core QA users exist and are active
        admin_u = await session.get(User, ADMIN_ID)
        if not admin_u:
            admin_u = User(
                id=ADMIN_ID,
                username="admin",
                email="admin@example.com",
                first_name="System",
                last_name="Admin",
                display_name="Admin User",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                is_superuser=True,
                password_hash="test_pw_hash",
            )
            session.add(admin_u)
        else:
            admin_u.is_active = True
            admin_u.status = UserStatus.ACTIVE
            admin_u.deleted_at = None

        mgr_u = await session.get(User, MANAGER_ID)
        if not mgr_u:
            mgr_u = User(
                id=MANAGER_ID,
                username="manager_user_q",
                email="manager_q@inhyma.test",
                first_name="Sales",
                last_name="Manager",
                display_name="Sales Manager QA",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                password_hash="test_pw_hash",
            )
            session.add(mgr_u)
        else:
            mgr_u.is_active = True
            mgr_u.status = UserStatus.ACTIVE
            mgr_u.deleted_at = None

        rep_u = await session.get(User, SALESPERSON_ID)
        if not rep_u:
            rep_u = User(
                id=SALESPERSON_ID,
                username="rep_a_user_q",
                email="repa_q@inhyma.test",
                first_name="Sales",
                last_name="Rep A",
                display_name="Sales Rep A QA",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                password_hash="test_pw_hash",
            )
            session.add(rep_u)
        else:
            rep_u.is_active = True
            rep_u.status = UserStatus.ACTIVE
            rep_u.deleted_at = None

        await session.flush()

        # 4. Clean out prior tasks, activities, follow-ups, and leads first
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

        all_leads = list((await session.execute(select(CrmLead))).scalars().all())
        lead_ids = [l.id for l in all_leads]
        if lead_ids:
            await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(lead_ids)))
            await session.execute(delete(CrmFollowUp).where(CrmFollowUp.lead_id.in_(lead_ids)))
            await session.execute(delete(CrmLead).where(CrmLead.id.in_(lead_ids)))
        await session.flush()

        # 5. Clean orphan test pipelines and ensure standard Sales Pipeline and stages exist
        test_pipes = list((await session.execute(
            select(CrmPipeline).where(CrmPipeline.name.like("CRM Task Test Pipeline%"))
        )).scalars().all())
        for tp in test_pipes:
            await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == tp.id))
            await session.delete(tp)
        await session.flush()

        p_stmt = select(CrmPipeline).where(CrmPipeline.name == "Sales Pipeline").limit(1)
        pipeline = (await session.execute(p_stmt)).scalars().first()
        if not pipeline:
            pipeline = CrmPipeline(
                name="Sales Pipeline",
                description="Default Enterprise Sales Workflow",
                is_default=True,
                is_active=True,
                created_by=ADMIN_ID,
            )
            session.add(pipeline)
            await session.flush()
        else:
            pipeline.is_default = True
            pipeline.is_active = True
            pipeline.deleted_at = None

        # Clean existing stages for this pipeline to avoid unique constraint collisions
        await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline.id))
        await session.flush()

        # Re-create canonical stages
        stages_data = [
            ("New", 0, "open", True),
            ("Contacted", 1, "open", False),
            ("Proposal", 2, "open", False),
            ("Won", 3, "won", False),
            ("Lost", 4, "lost", False),
        ]
        stages_map: dict[str, CrmPipelineStage] = {}
        for sname, sorder, stype, sinit in stages_data:
            stage_rec = CrmPipelineStage(
                pipeline_id=pipeline.id,
                name=sname,
                stage_order=sorder,
                stage_type=stype,
                is_initial=sinit,
                is_active=True,
            )
            session.add(stage_rec)
            await session.flush()
            stages_map[sname] = stage_rec

        initial_stage = stages_map["New"]
        contacted_stage = stages_map["Contacted"]

        # 5. Clean any old test tasks/follow-ups/leads that aren't the 4 target leads
        target_names = [
            "CRM QA - Acme",
            "CRM QA - Zenith",
            "CRM QA - Global",
            "CRM QA - Apex",
        ]
        
        # Clean up existing leads with target names or other test leads
        all_leads = list((await session.execute(select(CrmLead))).scalars().all())
        leads_by_name = {l.name: l for l in all_leads}
        
        # 6. Create / Reuse the 4 QA Leads
        now_dt = datetime.now(timezone.utc)
        leads_spec = [
            {
                "name": "CRM QA - Acme",
                "company_name": "Acme Industrial Automation",
                "phone": "+919876543210",
                "email": "rajesh@acme-ind.test",
                "assigned_to": SALESPERSON_ID,
                "stage": contacted_stage,
                "status": "contacted",
                "priority": "high",
                "lead_code": "CRM-QA-ACME-01",
                "follow_up": {
                    "type": "call",
                    "due_at": now_dt + timedelta(days=2),
                    "notes": "Follow-up on smart factory motor drives quotation v2.",
                    "status": "pending",
                },
            },
            {
                "name": "CRM QA - Zenith",
                "company_name": "Zenith Precision Tools",
                "phone": "+919876543211",
                "email": "sunita@zenith-tools.test",
                "assigned_to": SALESPERSON_ID,
                "stage": contacted_stage,
                "status": "contacted",
                "priority": "medium",
                "lead_code": "CRM-QA-ZENITH-02",
                "follow_up": {
                    "type": "meeting",
                    "due_at": now_dt - timedelta(days=1),
                    "notes": "Initial product specification meeting.",
                    "status": "completed",
                    "completed_at": now_dt - timedelta(hours=4),
                    "completion_notes": "Specification meeting held; client requested proposal.",
                },
            },
            {
                "name": "CRM QA - Global",
                "company_name": "Global Pharma Packaging",
                "phone": "+919876543212",
                "email": "vikram@global-pharma.test",
                "assigned_to": MANAGER_ID,
                "stage": contacted_stage,
                "status": "contacted",
                "priority": "urgent",
                "lead_code": "CRM-QA-GLOBAL-03",
                "follow_up": {
                    "type": "demo",
                    "due_at": now_dt + timedelta(days=5),
                    "notes": "Live on-site machinery demo for cleanroom sealing.",
                    "status": "pending",
                },
            },
            {
                "name": "CRM QA - Apex",
                "company_name": "Apex Solar Technologies",
                "phone": "+919876543213",
                "email": "pooja@apex-solar.test",
                "assigned_to": SALESPERSON_ID,
                "stage": initial_stage,
                "status": "new",
                "priority": "low",
                "lead_code": "CRM-QA-APEX-04",
                "follow_up": None,
            },
        ]


        # Create the 4 pristine leads
        created_leads: list[CrmLead] = []
        for spec in leads_spec:
            lead = CrmLead(
                pipeline_id=pipeline.id,
                stage_id=spec["stage"].id,
                lead_code=spec["lead_code"],
                name=spec["name"],
                company_name=spec["company_name"],
                email=spec["email"],
                original_phone=spec["phone"],
                normalized_phone=spec["phone"],
                assigned_to=spec["assigned_to"],
                status=spec["status"],
                priority=spec["priority"],
                created_by=ADMIN_ID,
            )
            session.add(lead)
            await session.flush()
            created_leads.append(lead)

            fu_spec = spec["follow_up"]
            if fu_spec:
                fu = CrmFollowUp(
                    lead_id=lead.id,
                    assigned_to=spec["assigned_to"],
                    due_at=fu_spec["due_at"],
                    follow_up_type=fu_spec["type"],
                    notes=fu_spec["notes"],
                    status=fu_spec["status"],
                    completed_at=fu_spec.get("completed_at"),
                    created_by=ADMIN_ID,
                )
                session.add(fu)
                await session.flush()

                task = await sync_follow_up_to_task(session, fu, lead, spec["assigned_to"])
                if fu_spec["status"] == "completed":
                    task.status = "DONE"
                    task.completed_at = fu_spec.get("completed_at")
                    act = CrmActivity(
                        lead_id=lead.id,
                        activity_type="follow_up_completed",
                        subject=f"Follow-up Completed: {fu_spec['type'].capitalize()}",
                        description=f"{fu_spec['completion_notes']} (Scheduled context: {fu_spec['notes']})",
                        outcome="completed",
                        performed_by=spec["assigned_to"],
                        activity_at=fu_spec["completed_at"],
                        created_at=fu_spec["completed_at"],
                    )
                    session.add(act)
                else:
                    lead.next_follow_up_at = fu_spec["due_at"]

        await session.commit()
        print("Pristine Minimal CRM QA Data successfully prepared and committed.")

        # 7. Print summary for verification
        rem_users = list((await session.execute(select(User).where(User.deleted_at.is_(None)))).scalars().all())
        print(f"\n--- Active Users ({len(rem_users)}) ---")
        for u in rem_users:
            print(f"  {u.username} ({u.email}, ID: {u.id}, active: {u.is_active})")

        rem_leads = list((await session.execute(select(CrmLead).where(CrmLead.deleted_at.is_(None)))).scalars().all())
        print(f"\n--- CRM Leads ({len(rem_leads)}) ---")
        for l in rem_leads:
            print(f"  [{l.lead_code}] {l.name} | Assigned: {l.assigned_to} | Stage: {l.stage_id} | Next Follow-up: {l.next_follow_up_at}")

        rem_fus = list((await session.execute(select(CrmFollowUp))).scalars().all())
        print(f"\n--- CRM Follow-ups ({len(rem_fus)}) ---")
        for fu in rem_fus:
            print(f"  Follow-up {fu.id} ({fu.follow_up_type}, status: {fu.status}) -> Task ID: {fu.task_id}")

        rem_tasks = list((await session.execute(select(Task))).scalars().all())
        print(f"\n--- Workforce Tasks ({len(rem_tasks)}) ---")
        for t in rem_tasks:
            print(f"  Task {t.id}: {t.title} [{t.status}] Due: {t.due_date}")


if __name__ == "__main__":
    asyncio.run(prepare_qa_data())
