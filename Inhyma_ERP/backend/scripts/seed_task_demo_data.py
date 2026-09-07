"""
Development Seed Script: Generate realistic Enterprise Tasks for existing ERP users.

Requirements:
- Uses ONLY existing users from the ERP database (NO fake users created).
- For every active ERP user:
    - 2 Todo tasks
    - 1 In Progress task
    - 1 Completed task
    - 1 On Hold task (with hold_reason and hold_until)
- Includes multiple assignees, watchers, subtasks (with assignees & dates), comments, and escalations.
- Safe for development only.
"""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select

import app.org_structure.models  # noqa: F401
import app.rbac.models  # noqa: F401
import app.users.models  # noqa: F401
from app.database.engine import get_sessionmaker
from app.org_structure.models import (
    DepartmentLeadershipAssignment,
    LeadershipType,
    OrgRecordStatus,
)
from app.rbac.models import Role, UserRole
from app.tasks.models import (
    Task,
    TaskAssignee,
    TaskAssignmentRole,
    TaskComment,
    TaskDependency,
    TaskEscalation,
    TaskLabel,
    TaskLabelLink,
    TaskPriority,
    TaskSprint,
    TaskStatus,
    TaskSubtask,
    TaskSubtaskAssignee,
    TaskTemplate,
)
from app.users.models import User

TASK_SEEDS = [
    {
        "title": "Website & Catalog Redesign",
        "description": "Revamp online buyer-facing portal and product specification sheets for European clientele.",
        "subtasks": [
            ("Homepage UI Wireframes", "Design high-fidelity Figma mockups", "DONE", 1),
            ("Client Quotation Form Integration", "Connect inquiry quotation requests to ERP webhook", "IN_PROGRESS", 2),
            ("Multi-Currency Pricing Matrix Test", "Validate USD, EUR, and GBP currency conversions", "TODO", 3),
        ],
    },
    {
        "title": "Q4 Supplier Price Renegotiation",
        "description": "Consolidate supplier quotation history and negotiate 5% volume discounts across category suppliers.",
        "subtasks": [
            ("Extract Historical Bids Matrix", "Collate previous year supplier bids into comparison sheet", "DONE", 1),
            ("Supplier Strategy Meeting", "Schedule meeting with top 3 fabric and packaging suppliers", "TODO", 2),
        ],
    },
    {
        "title": "Warehouse Inventory Barcode Verification",
        "description": "Conduct quarterly physical stock count across Inhyma Mumbai and Ahmedabad warehouse branches.",
        "subtasks": [
            ("Scan High-Value SKU Inventory", "Perform barcode verification for electronics and machinery items", "IN_PROGRESS", 1),
            ("Discrepancy Audit Log Generation", "Record variances and log adjustment proformas", "TODO", 2),
        ],
    },
    {
        "title": "Export Container Logistics & Customs Clearance",
        "description": "Coordinate 40FT HC container stuffing, container CBM optimization, and draft export manifest.",
        "subtasks": [
            ("Container CBM Optimization Calculation", "Verify 68 CBM volume allocation", "DONE", 1),
            ("Bill of Lading & Commercial Invoice Check", "Verify customs HSN codes and port tariffs", "DONE", 2),
            ("Port Gate Inward Dispatch", "Obtain terminal gate-in pass from freight forwarder", "DONE", 3),
        ],
    },
    {
        "title": "Client Specification Custom Field Extension",
        "description": "Add dynamic technical specification attributes to Product Master catalog for customized inquiries.",
        "subtasks": [
            ("Review Field Specification Requirements", "Collect attribute lists from sales and operations leads", "DONE", 1),
            ("Engineering Implementation & Test", "Build dynamic attributes and run schema validation", "TODO", 2),
        ],
    },
]


async def seed_demo_tasks() -> None:
    print("=== SEEDING REALISTIC ENTERPRISE TASK DEMO DATA ===")

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # 1. Fetch active users from ERP
        user_stmt = select(User).where(User.deleted_at.is_(None), User.is_active == True)  # noqa: E712
        user_res = await session.execute(user_stmt)
        users = list(user_res.scalars().all())

        if not users:
            print("[ERROR] No active ERP users found in database! Please seed or create users first.")
            return

        print(f"Found {len(users)} active ERP users: {[u.username for u in users]}")

        # 2. Fetch or setup roles / departments
        role_stmt = select(Role).where(Role.deleted_at.is_(None))
        role_res = await session.execute(role_stmt)
        roles = list(role_res.scalars().all())

        # Ensure active leadership assignment for department managers
        if roles:
            lead_stmt = select(DepartmentLeadershipAssignment).limit(1)
            lead_res = await session.execute(lead_stmt)
            if not lead_res.scalars().first():
                # Pick first user to be manager of first role
                mgr_user = users[0]
                target_dept = roles[0]
                lead_assign = DepartmentLeadershipAssignment(
                    department_id=target_dept.id,
                    employee_id=mgr_user.id,
                    leadership_type=LeadershipType.PRIMARY_MANAGER,
                    is_primary=True,
                    status=OrgRecordStatus.ACTIVE,
                )
                session.add(lead_assign)
                await session.flush()
                print(f"Configured Department Manager: {mgr_user.username} for {target_dept.name}")

        today = date.today()
        created_tasks_count = 0

        # 3. Seed V2.0 Sprints
        sprint1 = TaskSprint(
            name="Sprint 24 - Core ERP Enhancements",
            goal="Deliver Jira-inspired task management and high-priority customer commitments.",
            status="ACTIVE",
            start_date=today - timedelta(days=5),
            end_date=today + timedelta(days=9),
            created_by=users[0].id,
        )
        sprint2 = TaskSprint(
            name="Sprint 25 - Next Gen Planning",
            goal="Architect multi-warehouse routing and inventory optimizations.",
            status="PLANNED",
            start_date=today + timedelta(days=10),
            end_date=today + timedelta(days=24),
            created_by=users[0].id,
        )
        session.add_all([sprint1, sprint2])
        await session.flush()
        print("[SEED] Sprints seeded.")

        # 4. Seed V2.0 Color Labels
        label_configs = [
            ("Frontend", "#3b82f6", "UI and user experience improvements"),
            ("Backend", "#10b981", "API, database, and infrastructure services"),
            ("Critical Path", "#ef4444", "Blocker for milestone delivery"),
            ("Customer Impact", "#f59e0b", "Directly client-facing changes"),
            ("Security", "#8b5cf6", "Access control, audit, and hardening"),
        ]
        labels: list[TaskLabel] = []
        for l_name, l_color, l_desc in label_configs:
            lbl = TaskLabel(name=l_name, color=l_color, description=l_desc, created_by=users[0].id)
            session.add(lbl)
            labels.append(lbl)
        await session.flush()
        print(f"[SEED] {len(labels)} Labels seeded.")

        # 5. Seed V2.0 Reusable Task Templates
        template1 = TaskTemplate(
            name="Bug Incident Report",
            description="Template for reproducible production bugs and regressions",
            issue_type="BUG",
            priority="CRITICAL",
            default_subtasks=[
                {"title": "Log reproduction steps and browser environment", "priority": "HIGH"},
                {"title": "Inspect server trace and database error log", "priority": "HIGH"},
                {"title": "Formulate hotfix pull request and test suite", "priority": "CRITICAL"},
                {"title": "Deploy to staging and verify client acceptance", "priority": "HIGH"},
            ],
            default_labels=["Backend", "Critical Path"],
            created_by=users[0].id,
        )
        template2 = TaskTemplate(
            name="Feature Deployment",
            description="Comprehensive rollout workflow for enterprise features",
            issue_type="STORY",
            priority="HIGH",
            default_subtasks=[
                {"title": "Technical design review & schema migration", "priority": "HIGH"},
                {"title": "Frontend UI component implementation", "priority": "MEDIUM"},
                {"title": "Integration test checklist verification", "priority": "HIGH"},
                {"title": "Documentation manual update", "priority": "MEDIUM"},
            ],
            default_labels=["Frontend", "Backend"],
            created_by=users[0].id,
        )
        session.add_all([template1, template2])
        await session.flush()
        print("[SEED] Task Templates seeded.")

        # 6. Seed an Epic Task
        epic_task = Task(
            title="Global Supply Chain Modernization (Epic 2026)",
            description="Cross-functional initiative to modernize procurement, RFQ lifecycle, and task execution.",
            priority=TaskPriority.HIGH,
            status=TaskStatus.IN_PROGRESS,
            issue_type="EPIC",
            sprint_id=sprint1.id,
            start_date=today - timedelta(days=10),
            due_date=today + timedelta(days=30),
            created_by=users[0].id,
        )
        session.add(epic_task)
        await session.flush()
        session.add(TaskAssignee(task_id=epic_task.id, user_id=users[0].id, assignment_role="ASSIGNEE"))
        session.add(TaskLabelLink(task_id=epic_task.id, label_id=labels[2].id))  # Critical Path
        created_tasks_count += 1

        all_seeded_task_ids: list[uuid.UUID] = [epic_task.id]

        # 7. For every active ERP user, generate tasks with Issue Types, Rollup parent, and Sprints
        issue_type_cycle = ["TASK", "BUG", "IMPROVEMENT", "STORY", "APPROVAL"]

        for u_idx, primary_user in enumerate(users):
            other_users = [u for u in users if u.id != primary_user.id] or [primary_user]

            task_configs = [
                # 1. Todo Task 1 (Linked to Epic)
                {
                    "title": f"{TASK_SEEDS[0]['title']} – {primary_user.first_name or primary_user.username}",
                    "description": TASK_SEEDS[0]["description"],
                    "status": TaskStatus.TODO,
                    "priority": TaskPriority.HIGH,
                    "issue_type": issue_type_cycle[0],
                    "parent_task_id": epic_task.id if u_idx == 0 else None,
                    "sprint_id": sprint1.id,
                    "start_date": today,
                    "due_date": today + timedelta(days=7),
                    "hold_reason": None,
                    "hold_until": None,
                    "subtasks": TASK_SEEDS[0]["subtasks"],
                    "needs_escalation": False,
                    "label_idx": 0,
                },
                # 2. Todo Task 2 (Bug)
                {
                    "title": f"{TASK_SEEDS[1]['title']} – {primary_user.first_name or primary_user.username}",
                    "description": TASK_SEEDS[1]["description"],
                    "status": TaskStatus.TODO,
                    "priority": TaskPriority.MEDIUM,
                    "issue_type": issue_type_cycle[1],
                    "parent_task_id": epic_task.id if u_idx == 0 else None,
                    "sprint_id": sprint2.id,
                    "start_date": today + timedelta(days=1),
                    "due_date": today + timedelta(days=12),
                    "hold_reason": None,
                    "hold_until": None,
                    "subtasks": TASK_SEEDS[1]["subtasks"],
                    "needs_escalation": False,
                    "label_idx": 1,
                },
                # 3. In Progress Task (Improvement)
                {
                    "title": f"{TASK_SEEDS[2]['title']} – {primary_user.first_name or primary_user.username}",
                    "description": TASK_SEEDS[2]["description"],
                    "status": TaskStatus.IN_PROGRESS,
                    "priority": TaskPriority.CRITICAL,
                    "issue_type": issue_type_cycle[2],
                    "parent_task_id": None,
                    "sprint_id": sprint1.id,
                    "start_date": today - timedelta(days=2),
                    "due_date": today + timedelta(days=3),
                    "hold_reason": None,
                    "hold_until": None,
                    "subtasks": TASK_SEEDS[2]["subtasks"],
                    "needs_escalation": True,
                    "label_idx": 2,
                },
                # 4. Completed Task (Story)
                {
                    "title": f"{TASK_SEEDS[3]['title']} – {primary_user.first_name or primary_user.username}",
                    "description": TASK_SEEDS[3]["description"],
                    "status": TaskStatus.DONE,
                    "priority": TaskPriority.MEDIUM,
                    "issue_type": issue_type_cycle[3],
                    "parent_task_id": None,
                    "sprint_id": None,  # Backlog
                    "start_date": today - timedelta(days=10),
                    "due_date": today - timedelta(days=1),
                    "hold_reason": None,
                    "hold_until": None,
                    "subtasks": TASK_SEEDS[3]["subtasks"],
                    "needs_escalation": False,
                    "label_idx": 3,
                },
                # 5. On Hold / Approval Task
                {
                    "title": f"{TASK_SEEDS[4]['title']} – {primary_user.first_name or primary_user.username}",
                    "description": TASK_SEEDS[4]["description"],
                    "status": TaskStatus.ON_HOLD,
                    "priority": TaskPriority.HIGH,
                    "issue_type": issue_type_cycle[4],
                    "parent_task_id": None,
                    "sprint_id": sprint1.id,
                    "start_date": today - timedelta(days=1),
                    "due_date": today + timedelta(days=14),
                    "hold_reason": "Waiting for client architectural signoff and security review.",
                    "hold_until": today + timedelta(days=5),
                    "subtasks": TASK_SEEDS[4]["subtasks"],
                    "needs_escalation": True,
                    "label_idx": 4,
                },
            ]

            for cfg in task_configs:
                task = Task(
                    title=cfg["title"],
                    description=cfg["description"],
                    priority=cfg["priority"],
                    status=cfg["status"],
                    issue_type=cfg["issue_type"],
                    parent_task_id=cfg["parent_task_id"],
                    sprint_id=cfg["sprint_id"],
                    start_date=cfg["start_date"],
                    due_date=cfg["due_date"],
                    hold_reason=cfg["hold_reason"],
                    hold_until=cfg["hold_until"],
                    created_by=primary_user.id,
                )
                session.add(task)
                await session.flush()
                all_seeded_task_ids.append(task.id)

                # Assign label
                session.add(TaskLabelLink(task_id=task.id, label_id=labels[cfg["label_idx"]].id))

                # Assignees (Owner/Assignee role)
                assignee_user = random.choice(other_users)
                session.add(TaskAssignee(task_id=task.id, user_id=primary_user.id, assignment_role="ASSIGNEE"))
                if assignee_user.id != primary_user.id:
                    session.add(TaskAssignee(task_id=task.id, user_id=assignee_user.id, assignment_role="ASSIGNEE"))

                # Watchers (1 watcher from other users)
                watcher_candidates = [u for u in other_users if u.id != assignee_user.id]
                if watcher_candidates:
                    watcher_user = random.choice(watcher_candidates)
                    session.add(TaskAssignee(task_id=task.id, user_id=watcher_user.id, assignment_role="WATCHER"))

                # Subtasks
                for sub_title, sub_desc, sub_stat, sub_idx in cfg["subtasks"]:
                    is_completed = sub_stat == "DONE"
                    sub = TaskSubtask(
                        task_id=task.id,
                        title=sub_title,
                        description=sub_desc,
                        priority="MEDIUM",
                        status=sub_stat,
                        start_date=cfg["start_date"],
                        due_date=cfg["due_date"],
                        completed=is_completed,
                        order_index=sub_idx,
                    )
                    session.add(sub)
                    await session.flush()
                    session.add(TaskSubtaskAssignee(subtask_id=sub.id, user_id=primary_user.id))

                # Comments with @mentions
                mention_target = assignee_user if assignee_user.id != primary_user.id else primary_user
                session.add(
                    TaskComment(
                        task_id=task.id,
                        user_id=mention_target.id,
                        message=f"Initialized workflow for {task.title}. Cc: @{primary_user.username}",
                    )
                )

                # Escalation History (if required)
                if cfg["needs_escalation"] and other_users:
                    esc_target = random.choice(other_users)
                    session.add(
                        TaskEscalation(
                            task_id=task.id,
                            from_user=primary_user.id,
                            to_user=esc_target.id,
                            reason="Critical dependency requires management coordination and review.",
                            escalation_type="REPORTING_MANAGER",
                            due_date=today + timedelta(days=2),
                        )
                    )

                created_tasks_count += 1

        # 8. Seed Task Dependencies (Demonstrate BLOCKS / BLOCKED_BY)
        if len(all_seeded_task_ids) >= 3:
            dep1 = TaskDependency(
                task_id=all_seeded_task_ids[1],
                depends_on_task_id=all_seeded_task_ids[2],
                dependency_type="BLOCKED_BY",
            )
            session.add(dep1)
            print("[SEED] Task dependency seeded.")

        await session.commit()
        print(f"[SUCCESS] Successfully seeded {created_tasks_count} realistic enterprise V2 tasks for {len(users)} users!")


if __name__ == "__main__":
    asyncio.run(seed_demo_tasks())
