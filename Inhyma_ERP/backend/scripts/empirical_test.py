"""
Empirical Verification Test for Standalone Task Module.
Tests models, TaskService, NotificationService, Subtasks, Comments, Escalations, and Soft Delete.
"""

import asyncio
import uuid
from datetime import date, timedelta

from sqlalchemy import select

from app.core.exceptions import ValidationException
from app.database.engine import get_sessionmaker
from app.users.models import User
from app.auth.security import hash_password
from app.search.service import search_universal
from app.tasks.models import (
    DependencyType,
    IssueType,
    SprintStatus,
    Task,
    TaskPriority,
    TaskStatus,
)
from app.tasks.schemas import (
    TaskApprovalActionRequest,
    TaskBulkActionRequest,
    TaskCreate,
    TaskDependencyCreate,
    TaskDuplicateRequest,
    TaskLabelCreate,
    TaskSavedFilterCreate,
    TaskSavedFilterUpdate,
    TaskSprintCreate,
    TaskSprintUpdate,
    TaskSubmitApprovalRequest,
    TaskSubtaskCreate,
    TaskTemplateCreate,
    TaskUpdate,
)
from app.tasks.routes import get_task_service
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.auth.dependencies import CurrentUser


async def run_test():
    print("=== STARTING TASK MODULE EMPIRICAL TEST ===")

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # 1. Fetch test users
        result = await session.execute(select(User).limit(2))
        users = list(result.scalars().all())
        if len(users) < 2:
            print("Need at least 2 users for test")
            return

        u1, u2 = users[0], users[1]
        print(f"Test users ready: {u1.username} ({u1.id}) and {u2.username} ({u2.id})")

        current_user = CurrentUser(
            id=u1.id,
            username=u1.username,
            permissions=["task.view", "task.organization_view", "task.assign", "task.escalate", "task.manage"],
        )

        task_service = get_task_service(session)
        notif_repo = NotificationRepository(session)
        notif_service = NotificationService(notif_repo)

        # 2. Create Task with Assignee and Subtasks
        print("\n--- Test 1: Task Creation ---")
        payload = TaskCreate(
            title="Empirical Validation Task",
            description="Testing end-to-end task functionality",
            priority=TaskPriority.HIGH,
            status=TaskStatus.TODO,
            due_date=date(2026, 9, 30),
            assignee_ids=[u2.id],
            subtasks=["Review specifications", "Implement core logic", "Run unit tests"],
        )

        created_task = await task_service.create_task(payload, current_user)
        await session.commit()
        print(f"Task created successfully: ID={created_task.id}, Title='{created_task.title}', Status={created_task.status}")
        assert created_task.title == "Empirical Validation Task"
        assert len(created_task.assignees) == 1
        assert len(created_task.subtasks) == 3

        # 3. Verify Notification dispatched to Assignee
        print("\n--- Test 2: In-App Notification Check ---")
        items, unread = await notif_service.list_notifications(u2.id)
        print(f"Notifications for user {u2.username}: Total={len(items)}, Unread={unread}")
        assert len(items) >= 1

        # 4. Update Task Status & Priority
        print("\n--- Test 3: Update Task Status & Priority ---")
        update_payload = TaskUpdate(
            status=TaskStatus.IN_PROGRESS,
            priority=TaskPriority.CRITICAL,
        )
        updated_task = await task_service.update_task(created_task.id, update_payload, current_user)
        await session.commit()
        print(f"Task updated: Status={updated_task.status}, Priority={updated_task.priority}")
        assert updated_task.status == TaskStatus.IN_PROGRESS
        assert updated_task.priority == TaskPriority.CRITICAL

        # 5. Toggle Subtask completion
        print("\n--- Test 4: Subtask Toggle ---")
        first_subtask = updated_task.subtasks[0]
        completed_sub = await task_service.update_subtask(
            first_subtask.id,
            completed=True,
            current_user=current_user,
        )
        await session.commit()
        print(f"Subtask '{completed_sub.title}' completed status: {completed_sub.completed}")
        assert completed_sub.completed is True

        # 6. Add Comment
        print("\n--- Test 5: Add Comment ---")
        comment = await task_service.add_comment(
            created_task.id,
            "Progress update: specs reviewed, proceeding to implementation.",
            current_user,
        )
        await session.commit()
        print(f"Comment added by {comment.user_id}: '{comment.message}'")
        assert comment.message == "Progress update: specs reviewed, proceeding to implementation."

        # 7. Escalate Task
        print("\n--- Test 6: Escalate Task ---")
        escalation = await task_service.escalate_task(
            created_task.id,
            to_user=u2.id,
            reason="Blocked by upstream dependency, need manager review.",
            current_user=current_user,
        )
        await session.commit()
        print(f"Task escalated from {escalation.from_user} to {escalation.to_user} for reason: '{escalation.reason}'")
        assert escalation.to_user == u2.id

        # 8. List tasks with filters
        print("\n--- Test 7: Query Filter & Scoping ---")
        items, total_count = await task_service.list_tasks(
            current_user_id=current_user.id,
            user_permissions=set(current_user.permissions),
            search="Empirical",
            page=1,
            page_size=10,
        )
        print(f"Filtered task list count: {total_count}, returned: {len(items)}")
        assert total_count >= 1

        # 9. Enterprise Task Creation (start_date, watchers, mini-task subtasks)
        print("\n--- Test 9: Enterprise Task Creation with Watchers & Mini-Task Subtasks ---")
        ent_task = await task_service.create_task(
            TaskCreate(
                title="Enterprise Website Redesign",
                description="<p>Full redesign with multiple assignees, watchers, and mini-task subtasks.</p>",
                priority=TaskPriority.HIGH,
                status=TaskStatus.TODO,
                start_date=date.today(),
                due_date=date.today() + timedelta(days=14),
                assignee_ids=[u1.id, u2.id],
                watcher_ids=[u2.id],
                subtasks=[
                    TaskSubtaskCreate(
                        title="Homepage Wireframe",
                        description="Desktop and mobile wireframes",
                        priority=TaskPriority.HIGH,
                        status=TaskStatus.TODO,
                        start_date=date.today(),
                        due_date=date.today() + timedelta(days=5),
                        assignee_ids=[u1.id, u2.id],
                    ),
                    TaskSubtaskCreate(
                        title="Login API Endpoint",
                        description="JWT auth and rate limiting",
                        priority=TaskPriority.CRITICAL,
                        status=TaskStatus.TODO,
                        assignee_ids=[u2.id],
                    ),
                ],
            ),
            current_user,
        )
        await session.commit()
        print(f"Enterprise task created: ID={ent_task.id}, start_date={ent_task.start_date}, assignees={len(ent_task.assignees)}, subtasks={len(ent_task.subtasks)}")
        assert ent_task.start_date == date.today()
        assert len(ent_task.assignees) >= 2
        assert len(ent_task.subtasks) == 2
        assert len(ent_task.subtasks[0].assignees) == 2

        # 10. Multi-Escalation with escalation_type and due_date
        print("\n--- Test 10: Multi-Escalation with Target Options & Due Date ---")
        esc1 = await task_service.escalate_task(
            ent_task.id,
            to_user=u2.id,
            reason="Design assets delayed",
            current_user=current_user,
            escalation_type="REPORTING_MANAGER",
            due_date=date.today() + timedelta(days=3),
        )
        esc2 = await task_service.escalate_task(
            ent_task.id,
            to_user=u2.id,
            reason="Scope expansion requested by stakeholders",
            current_user=current_user,
            escalation_type="DEPARTMENT_MANAGER",
            due_date=date.today() + timedelta(days=5),
        )
        await session.commit()
        refreshed_ent = await task_service.get_task(ent_task.id)
        print(f"Unlimited escalations count: {len(refreshed_ent.escalations)}")
        assert len(refreshed_ent.escalations) == 2
        assert refreshed_ent.escalations[0].escalation_type == "REPORTING_MANAGER"
        assert refreshed_ent.escalations[1].escalation_type == "DEPARTMENT_MANAGER"

        # 11. Mini-task Subtask Update & Completion
        print("\n--- Test 11: Mini-Task Subtask Completion Tracking ---")
        sub1 = refreshed_ent.subtasks[0]
        updated_sub = await task_service.update_subtask(
            sub1.id,
            status="DONE",
            current_user=current_user,
        )
        await session.commit()
        print(f"Subtask '{updated_sub.title}' completed: {updated_sub.completed}, status: {updated_sub.status}")
        assert updated_sub.completed is True
        assert updated_sub.status == "DONE"

        # 12. Activity Timeline Generation
        print("\n--- Test 12: Activity Timeline Generation ---")
        timeline = await task_service.get_task_timeline(ent_task.id)
        print(f"Timeline events captured: {len(timeline)}")
        for evt in timeline:
            print(f"  - [{evt['event_type']}] {evt['description']}")
        assert len(timeline) >= 4  # created + assignees + subtask + escalations

        # 13. Task Creation with Initial Escalation
        print("\n--- Test 13: Task Creation with Initial Escalation ---")
        from app.tasks.schemas import TaskInitialEscalationInput
        init_esc_task = await task_service.create_task(
            TaskCreate(
                title="Urgent Security Vulnerability Patch",
                description="Remediate dependency alert",
                priority=TaskPriority.CRITICAL,
                status=TaskStatus.TODO,
                start_date=date.today(),
                due_date=date.today() + timedelta(days=2),
                assignee_ids=[u1.id],
                initial_escalation=TaskInitialEscalationInput(
                    escalation_type="REPORTING_MANAGER",
                    escalated_to_id=u2.id,
                    reason="Needs immediate security review by manager",
                    due_date=date.today() + timedelta(days=1),
                ),
            ),
            current_user,
        )
        await session.commit()
        refreshed_init = await task_service.get_task(init_esc_task.id)
        print(f"Task with initial escalation created: ID={refreshed_init.id}, escalations={len(refreshed_init.escalations)}")
        assert len(refreshed_init.escalations) == 1
        assert refreshed_init.escalations[0].to_user == u2.id
        assert refreshed_init.escalations[0].reason == "Needs immediate security review by manager"

        # 14. On Hold Transition with Reason & Hold Until Date
        print("\n--- Test 14: On Hold Transition with Reason & Hold Until ---")
        hold_date = date.today() + timedelta(days=5)
        on_hold_task = await task_service.update_task(
            init_esc_task.id,
            TaskUpdate(
                status=TaskStatus.ON_HOLD,
                hold_reason="Waiting for client architectural signoff",
                hold_until=hold_date,
            ),
            current_user,
        )
        await session.commit()
        print(f"Task put on hold: status={on_hold_task.status}, reason={on_hold_task.hold_reason}, until={on_hold_task.hold_until}")
        assert on_hold_task.status == TaskStatus.ON_HOLD
        assert on_hold_task.hold_reason == "Waiting for client architectural signoff"
        assert on_hold_task.hold_until == hold_date

        # 15. Check Expired Holds Worker
        print("\n--- Test 15: Check Expired Holds ---")
        # Temporarily backdate hold_until to yesterday to verify expiry detection
        on_hold_task.hold_until = date.today() - timedelta(days=1)
        await session.commit()
        expired_count = await task_service.check_expired_holds()
        print(f"Expired holds detected and notified: {expired_count}")
        assert expired_count >= 1

        # 16. Task Attachments
        print("\n--- Test 16: Task File Attachments ---")
        att = await task_service.add_attachment(
            ent_task.id,
            file_name="architecture_specs_v1.pdf",
            file_url="/uploads/tasks/test_arch_specs.pdf",
            file_size=1048576,
            file_type="application/pdf",
            current_user=current_user,
        )
        print(f"Attachment added: ID={att.id}, file_name={att.file_name}")
        assert att.file_name == "architecture_specs_v1.pdf"

        # 17. Task Voice Notes
        print("\n--- Test 17: Task Voice Notes ---")
        vn = await task_service.add_voice_note(
            ent_task.id,
            audio_url="/uploads/tasks/voice_brief_42s.webm",
            duration_seconds=42,
            file_size=65536,
            mime_type="audio/webm",
            title="Design briefing notes",
            current_user=current_user,
        )
        print(f"Voice note added: ID={vn.id}, duration={vn.duration_seconds}s, url={vn.audio_url}")
        assert vn.duration_seconds == 42

        # 18. Upgraded Task Comment with Voice Note & Attachment
        print("\n--- Test 18: Comment with Audio & Attachment ---")
        comment_with_media = await task_service.add_comment(
            ent_task.id,
            "Reviewed layout wireframe and recorded voice clarification.",
            current_user,
            audio_url="/uploads/tasks/comment_voice.webm",
            attachments=[{"file_name": "screenshot.png", "file_url": "/uploads/tasks/screenshot.png", "file_size": 204800, "file_type": "image/png"}],
        )
        print(f"Comment with media created: ID={comment_with_media.id}, audio={comment_with_media.audio_url}, attachments={len(comment_with_media.attachments)}")
        assert comment_with_media.audio_url == "/uploads/tasks/comment_voice.webm"
        assert len(comment_with_media.attachments) == 1
        assert comment_with_media.attachments[0].file_name == "screenshot.png"

        # 19. Subtask Stage-Level Independent Collaboration
        print("\n--- Test 19: Subtask Stage-Level Collaboration ---")
        sub_comment = await task_service.add_subtask_comment(
            sub1.id,
            "Wireframe for mobile navigation drawer is ready for feedback.",
            current_user,
            audio_url="/uploads/tasks/subtask_audio.webm",
        )
        sub_att = await task_service.add_subtask_attachment(
            sub1.id,
            file_name="mobile_drawer_mockup.png",
            file_url="/uploads/tasks/mockup.png",
            file_size=345000,
            file_type="image/png",
            current_user=current_user,
        )
        sub_comments = await task_service.list_subtask_comments(sub1.id)
        sub_atts = await task_service.list_subtask_attachments(sub1.id)
        print(f"Subtask independent discussions: {len(sub_comments)} comments, {len(sub_atts)} attachments")
        assert len(sub_comments) >= 1
        assert len(sub_atts) >= 1
        assert sub_comments[0].audio_url == "/uploads/tasks/subtask_audio.webm"

        # 20. Escalation Stage-Level Independent Collaboration
        print("\n--- Test 20: Escalation Stage-Level Collaboration ---")
        esc_comment = await task_service.add_escalation_comment(
            esc1.id,
            "Meeting scheduled with vendor to clear design asset roadblock.",
            current_user,
            audio_url="/uploads/tasks/esc_audio.webm",
        )
        esc_comments = await task_service.list_escalation_comments(esc1.id)
        print(f"Escalation independent discussions: {len(esc_comments)} comments")
        assert len(esc_comments) >= 1
        assert esc_comments[0].message == "Meeting scheduled with vendor to clear design asset roadblock."

        # 21. Timeline reflects Attachments & Voice Notes
        print("\n--- Test 21: Timeline includes Attachments & Voice Notes ---")
        refreshed_ent = await task_service.get_task(ent_task.id)
        timeline_v2 = await task_service.get_task_timeline(ent_task.id)
        timeline_types = [t["event_type"] for t in timeline_v2]
        print(f"Timeline events now captured: {len(timeline_v2)}, types: {set(timeline_types)}")
        assert "ATTACHMENT_ADDED" in timeline_types
        assert "VOICE_NOTE_ADDED" in timeline_types

        # --- Part A & Part B Jira-Inspired Features Empirical Verification ---

        # 22. Issue Type Validation & Query Filtering
        print("\n--- Test 22: Issue Type Validation & Query Filtering ---")
        bug_task = await task_service.create_task(
            TaskCreate(
                title="Critical Production Bug in Auth",
                description="OAuth token refresh fails intermittently",
                priority=TaskPriority.CRITICAL,
                status=TaskStatus.TODO,
                issue_type=IssueType.BUG,
                assignee_ids=[u1.id],
            ),
            current_user,
        )
        story_task = await task_service.create_task(
            TaskCreate(
                title="User Story: Dark Mode Theme Support",
                description="Allow user to switch to dark mode in settings",
                priority=TaskPriority.MEDIUM,
                status=TaskStatus.TODO,
                issue_type=IssueType.STORY,
                assignee_ids=[u2.id],
            ),
            current_user,
        )
        await session.commit()
        print(f"Bug task created: ID={bug_task.id}, issue_type={bug_task.issue_type}")
        print(f"Story task created: ID={story_task.id}, issue_type={story_task.issue_type}")
        assert str(getattr(bug_task.issue_type, "value", bug_task.issue_type)) == "BUG"
        assert str(getattr(story_task.issue_type, "value", story_task.issue_type)) == "STORY"

        # Verify filter by issue_type
        bug_items, bug_total = await task_service.list_tasks(
            current_user_id=current_user.id,
            user_permissions=set(current_user.permissions),
            issue_type="BUG",
        )
        print(f"Filter by issue_type=BUG count: {bug_total}")
        assert bug_total >= 1
        assert any(t.id == bug_task.id for t in bug_items)

        # 23. Epic Hierarchy & Automatic Progress Rollup
        print("\n--- Test 23: Epic Hierarchy & Automatic Progress Rollup ---")
        epic_task = await task_service.create_task(
            TaskCreate(
                title="Q4 Modernization Epic",
                description="High level initiatives for Q4",
                priority=TaskPriority.HIGH,
                status=TaskStatus.IN_PROGRESS,
                issue_type=IssueType.EPIC,
                assignee_ids=[u1.id],
            ),
            current_user,
        )
        child_task_1 = await task_service.create_task(
            TaskCreate(
                title="Child Task 1: Database Migration",
                description="Implement alembic migration",
                priority=TaskPriority.HIGH,
                status=TaskStatus.TODO,
                issue_type=IssueType.TASK,
                parent_task_id=epic_task.id,
                assignee_ids=[u1.id],
            ),
            current_user,
        )
        child_task_2 = await task_service.create_task(
            TaskCreate(
                title="Child Task 2: API Endpoints",
                description="Implement routes and tests",
                priority=TaskPriority.HIGH,
                status=TaskStatus.TODO,
                issue_type=IssueType.TASK,
                parent_task_id=epic_task.id,
                assignee_ids=[u2.id],
            ),
            current_user,
        )
        await session.commit()

        # Rollup with 0 child tasks done -> 0%
        refreshed_epic = await task_service.get_task(epic_task.id)
        print(f"Epic initial progress: {refreshed_epic.progress_percent}% (child tasks: {len(refreshed_epic.child_tasks)})")
        assert refreshed_epic.progress_percent == 0.0

        # Complete child task 1 -> 50%
        await task_service.update_task(child_task_1.id, TaskUpdate(status=TaskStatus.DONE), current_user)
        await session.commit()
        refreshed_epic = await task_service.get_task(epic_task.id)
        print(f"Epic progress after 1 child done: {refreshed_epic.progress_percent}%")
        assert refreshed_epic.progress_percent == 50.0

        # Complete child task 2 -> 100%
        await task_service.update_task(child_task_2.id, TaskUpdate(status=TaskStatus.DONE), current_user)
        await session.commit()
        refreshed_epic = await task_service.get_task(epic_task.id)
        print(f"Epic progress after 2 child done: {refreshed_epic.progress_percent}%")
        assert refreshed_epic.progress_percent == 100.0

        # 24. Color-Coded Labels (Create, Assign, Filter, Unlink)
        print("\n--- Test 24: Color-Coded Labels (Create, Assign, Filter, Unlink) ---")
        lbl_frontend = await task_service.create_label(
            TaskLabelCreate(name=f"Frontend-{uuid.uuid4().hex[:6]}", color="#3b82f6", description="Frontend tasks"),
            current_user,
        )
        lbl_backend = await task_service.create_label(
            TaskLabelCreate(name=f"Backend-{uuid.uuid4().hex[:6]}", color="#10b981", description="Backend tasks"),
            current_user,
        )
        await session.commit()
        all_labels = await task_service.list_labels()
        print(f"Total labels in system: {len(all_labels)}")
        assert any(l.id == lbl_frontend.id for l in all_labels)
        assert any(l.id == lbl_backend.id for l in all_labels)

        # Set labels on bug_task
        await task_service.repository.set_task_labels(bug_task.id, [lbl_frontend.id, lbl_backend.id])
        await session.commit()
        bug_task_refreshed = await task_service.get_task(bug_task.id)
        print(f"Bug task linked labels: {[l.name for l in bug_task_refreshed.labels]}")
        assert len(bug_task_refreshed.labels) == 2

        # Filter tasks by label_id
        labeled_tasks, lbl_total = await task_service.list_tasks(
            current_user_id=current_user.id,
            user_permissions=set(current_user.permissions),
            label_id=lbl_frontend.id,
        )
        print(f"Tasks with label {lbl_frontend.name}: {lbl_total}")
        assert lbl_total >= 1
        assert any(t.id == bug_task.id for t in labeled_tasks)

        # Unlink one label
        await task_service.repository.remove_task_label(bug_task.id, lbl_frontend.id)
        await session.commit()
        bug_task_refreshed = await task_service.get_task(bug_task.id)
        assert len(bug_task_refreshed.labels) == 1
        assert bug_task_refreshed.labels[0].id == lbl_backend.id

        # 25. Sprints Lifecycle & Backlog Scoping
        print("\n--- Test 25: Sprints Lifecycle & Backlog Scoping ---")
        sprint_payload = TaskSprintCreate(
            name=f"Sprint-Alpha-{uuid.uuid4().hex[:4]}",
            goal="Complete Jira-Inspired Enhancement V2",
            start_date=date.today(),
            end_date=date.today() + timedelta(days=14),
            status=SprintStatus.ACTIVE,
        )
        sprint = await task_service.create_sprint(sprint_payload, current_user)
        await session.commit()
        print(f"Sprint created: ID={sprint.id}, Name='{sprint.name}', Status={sprint.status}")
        assert "Sprint-Alpha" in sprint.name

        # Assign story_task to sprint
        await task_service.update_task(story_task.id, TaskUpdate(sprint_id=sprint.id), current_user)
        await session.commit()

        # Query Backlog (sprint_id is NULL) -> story_task should NOT be in backlog
        backlog_tasks, backlog_count = await task_service.list_tasks(
            current_user_id=current_user.id,
            user_permissions=set(current_user.permissions),
            is_backlog=True,
        )
        print(f"Backlog task count: {backlog_count}")
        assert not any(t.id == story_task.id for t in backlog_tasks)

        # Query sprint tasks
        sprint_tasks, sprint_count = await task_service.list_tasks(
            current_user_id=current_user.id,
            user_permissions=set(current_user.permissions),
            sprint_id=sprint.id,
        )
        print(f"Sprint tasks count: {sprint_count}")
        assert sprint_count >= 1
        assert any(t.id == story_task.id for t in sprint_tasks)

        # Update sprint status
        updated_sprint = await task_service.update_sprint(
            sprint.id,
            TaskSprintUpdate(status=SprintStatus.COMPLETED),
            current_user,
        )
        await session.commit()
        assert str(getattr(updated_sprint.status, "value", updated_sprint.status)) == "COMPLETED"

        # 26. Reusable Task Templates
        print("\n--- Test 26: Reusable Task Templates ---")
        tpl_payload = TaskTemplateCreate(
            name=f"Security Bug Template {uuid.uuid4().hex[:4]}",
            description="Pre-configures security bug remediation",
            category="Security",
            template_data={
                "issue_type": "BUG",
                "priority": "CRITICAL",
                "default_subtasks": ["Isolate vulnerability", "Apply patch", "Regression testing"],
                "default_labels": ["Security", "Patch"],
            },
        )
        tpl = await task_service.create_template(tpl_payload, current_user)
        await session.commit()
        print(f"Template created: ID={tpl.id}, Name='{tpl.name}', Data={tpl.template_data}")
        assert "Security Bug Template" in tpl.name
        assert tpl.template_data["issue_type"] == "BUG"

        templates = await task_service.list_templates(category="Security")
        assert len(templates) >= 1
        assert any(t.id == tpl.id for t in templates)

        # 27. @user Mention Parsing & Notification
        print("\n--- Test 27: @user Mention Parsing & Notification ---")
        mention_comment = await task_service.add_comment(
            created_task.id,
            f"Hello @{u2.username}, please take a look at the priority issue.",
            current_user,
        )
        await session.commit()
        # Verify mention created in repository
        mentions = await task_service.repository.list_mentions(task_id=created_task.id)
        print(f"Task mentions count: {len(mentions)}")
        assert any(m.mentioned_user_id == u2.id for m in mentions)

        # 28. Emoji Reactions on Tasks & Comments
        print("\n--- Test 28: Emoji Reactions on Tasks & Comments ---")
        # Toggle add reaction on task
        added1 = await task_service.toggle_task_reaction(created_task.id, "rocket", current_user)
        await session.commit()
        print(f"Reaction 'rocket' toggled on task: {added1}")
        assert added1 is True

        # Toggle remove reaction on task
        added2 = await task_service.toggle_task_reaction(created_task.id, "rocket", current_user)
        await session.commit()
        print(f"Reaction 'rocket' toggled again (remove): {added2}")
        assert added2 is False

        # Toggle on comment
        c_added = await task_service.toggle_comment_reaction(mention_comment.id, "thumbsup", current_user)
        await session.commit()
        print(f"Reaction 'thumbsup' toggled on comment: {c_added}")
        assert c_added is True

        # 29. Saved Filters (Create, Update, List, Delete)
        print("\n--- Test 29: Saved Filters (Create, Update, List, Delete) ---")
        filter_payload = TaskSavedFilterCreate(
            name="My High Priority Bugs",
            filter_config={"priority": "HIGH", "issue_type": "BUG"},
            is_default=True,
        )
        saved_f = await task_service.create_saved_filter(filter_payload, current_user)
        await session.commit()
        print(f"Saved filter created: ID={saved_f.id}, Name='{saved_f.name}'")
        assert saved_f.name == "My High Priority Bugs"
        assert saved_f.filter_config == {"priority": "HIGH", "issue_type": "BUG"}

        my_filters = await task_service.list_saved_filters(current_user)
        assert any(f.id == saved_f.id for f in my_filters)

        updated_f = await task_service.update_saved_filter(
            saved_f.id,
            TaskSavedFilterUpdate(name="Renamed Filter"),
            current_user,
        )
        await session.commit()
        assert updated_f.name == "Renamed Filter"

        await task_service.delete_saved_filter(saved_f.id, current_user)
        await session.commit()
        my_filters_after = await task_service.list_saved_filters(current_user)
        assert not any(f.id == saved_f.id for f in my_filters_after)

        # 30. Task Duplicate Functionality
        print("\n--- Test 30: Task Duplicate Functionality ---")
        dup_req = TaskDuplicateRequest(
            include_subtasks=True,
            include_labels=True,
            include_watchers=True,
            include_attachments=False,
            new_title="Duplicated Enterprise Website Redesign",
        )
        duplicated = await task_service.duplicate_task(ent_task.id, dup_req, current_user)
        await session.commit()
        print(f"Duplicated task created: ID={duplicated.id}, Title='{duplicated.title}'")
        assert duplicated.title == "Duplicated Enterprise Website Redesign"
        assert len(duplicated.subtasks) == len(ent_task.subtasks)
        assert len(duplicated.assignees) >= 1

        # 31. Bulk Actions (Status, Priority, Delete)
        print("\n--- Test 31: Bulk Actions (Status, Priority) ---")
        bulk_t1 = await task_service.create_task(
            TaskCreate(title="Bulk Task 1", priority=TaskPriority.LOW, status=TaskStatus.TODO, assignee_ids=[u1.id]),
            current_user,
        )
        bulk_t2 = await task_service.create_task(
            TaskCreate(title="Bulk Task 2", priority=TaskPriority.LOW, status=TaskStatus.TODO, assignee_ids=[u1.id]),
            current_user,
        )
        await session.commit()

        # Bulk update priority to CRITICAL
        bulk_resp1 = await task_service.bulk_action(
            TaskBulkActionRequest(task_ids=[bulk_t1.id, bulk_t2.id], action="PRIORITY", value="CRITICAL"),
            current_user,
        )
        await session.commit()
        print(f"Bulk PRIORITY update success: {bulk_resp1.success_count}")
        assert bulk_resp1.success_count == 2
        refreshed_b1 = await task_service.get_task(bulk_t1.id)
        assert refreshed_b1.priority == TaskPriority.CRITICAL

        # Bulk update status to IN_PROGRESS
        bulk_resp2 = await task_service.bulk_action(
            TaskBulkActionRequest(task_ids=[bulk_t1.id, bulk_t2.id], action="STATUS", value="IN_PROGRESS"),
            current_user,
        )
        await session.commit()
        print(f"Bulk STATUS update success: {bulk_resp2.success_count}")
        assert bulk_resp2.success_count == 2
        refreshed_b2 = await task_service.get_task(bulk_t2.id)
        assert refreshed_b2.status == TaskStatus.IN_PROGRESS

        # 32. Task Dependencies (BLOCKS, BLOCKED_BY, RELATES_TO)
        print("\n--- Test 32: Task Dependencies (BLOCKS, BLOCKED_BY, RELATES_TO) ---")
        dep_task_a = await task_service.create_task(
            TaskCreate(title="Dependency Node A", priority=TaskPriority.HIGH, status=TaskStatus.TODO, assignee_ids=[u1.id]),
            current_user,
        )
        dep_task_b = await task_service.create_task(
            TaskCreate(title="Dependency Node B", priority=TaskPriority.HIGH, status=TaskStatus.TODO, assignee_ids=[u2.id]),
            current_user,
        )
        await session.commit()

        # Node A BLOCKS Node B
        dep = await task_service.add_dependency(
            dep_task_a.id,
            TaskDependencyCreate(depends_on_task_id=dep_task_b.id, dependency_type=DependencyType.BLOCKS),
            current_user,
        )
        await session.commit()
        print(f"Dependency added: {dep_task_a.id} BLOCKS {dep_task_b.id}")
        assert dep.task_id == dep_task_a.id
        assert dep.depends_on_task_id == dep_task_b.id

        # 33. Dependency Blocker Circular Cycle Detection
        print("\n--- Test 33: Dependency Blocker Circular Cycle Detection ---")
        # Attempting Node B BLOCKS Node A must raise ValidationException
        cycle_detected = False
        try:
            await task_service.add_dependency(
                dep_task_b.id,
                TaskDependencyCreate(depends_on_task_id=dep_task_a.id, dependency_type=DependencyType.BLOCKS),
                current_user,
            )
        except ValidationException as e:
            cycle_detected = True
            print(f"Cycle detection successfully blocked circular dependency: {e.message}")
        assert cycle_detected is True

        # 34. Team Workload Dashboard
        print("\n--- Test 34: Team Workload Dashboard ---")
        workload = await task_service.get_workload_dashboard()
        print(f"Team Workload users count: {len(workload.users)}, total tasks: {workload.total_tasks}")
        assert len(workload.users) >= 1
        assert workload.total_tasks >= 1

        # 35. Team Capacity View Matrix
        print("\n--- Test 35: Team Capacity View Matrix ---")
        capacity = await task_service.get_capacity_view(
            start_date=date.today() - timedelta(days=2),
            end_date=date.today() + timedelta(days=5),
        )
        print(f"Capacity view returned for {len(capacity.users)} users")
        assert len(capacity.users) >= 1
        assert len(capacity.users[0].allocations) >= 7

        # 36. Approval Workflow (Submit, Approve Lifecycle)
        print("\n--- Test 36: Approval Workflow (Submit, Approve Lifecycle) ---")
        appr_task = await task_service.create_task(
            TaskCreate(
                title=f"Budget Increase Request #{uuid.uuid4().hex[:4]}",
                description="Requesting extra compute infrastructure budget",
                priority=TaskPriority.CRITICAL,
                status=TaskStatus.TODO,
                issue_type=IssueType.APPROVAL,
                assignee_ids=[u1.id],
            ),
            current_user,
        )
        await session.commit()

        # Submit for approval
        subm = await task_service.submit_for_approval(
            appr_task.id,
            TaskSubmitApprovalRequest(approver_id=u2.id, notes="Please review hardware cost breakdown."),
            current_user,
        )
        await session.commit()
        print(f"Task submitted for approval: status={subm.status}, approval_status={subm.approval_status}")
        assert subm.status == TaskStatus.PENDING_APPROVAL
        assert subm.approval_status == "PENDING_APPROVAL"

        # u2 approves task
        approver_user = CurrentUser(id=u2.id, username=u2.username, permissions=["task.view", "task.manage"])
        approved = await task_service.action_approval(
            appr_task.id,
            TaskApprovalActionRequest(approved=True, notes="Budget increase approved as required."),
            approver_user,
        )
        await session.commit()
        print(f"Task approval actioned: status={approved.status}, approval_status={approved.approval_status}")
        assert approved.status == TaskStatus.DONE
        assert approved.approval_status == "APPROVED"

        # 37. Universal Search Integration with Tasks
        print("\n--- Test 37: Universal Search Integration with Tasks ---")
        search_res = await search_universal(
            db=session,
            query_str=appr_task.title,
        )
        print(f"Search query hits for '{appr_task.title}': {search_res.total_hits}")
        task_hits = [r for r in search_res.results if r.category == "Tasks"]
        print(f"Tasks category hits: {len(task_hits)}")
        assert len(task_hits) >= 1
        assert any(t.id == str(appr_task.id) for t in task_hits)

        # --- Cleanup All Test Tasks ---
        cleanup_tasks = [
            init_esc_task, ent_task, created_task, bug_task, story_task,
            epic_task, child_task_1, child_task_2, duplicated, bulk_t1,
            bulk_t2, dep_task_a, dep_task_b, appr_task
        ]
        for t in cleanup_tasks:
            try:
                await task_service.soft_delete_task(t.id, current_user)
            except Exception:
                pass
        await session.commit()
        deleted_fetch = await session.get(Task, created_task.id)
        print(f"\nTask soft-deleted: is_deleted={deleted_fetch.is_deleted}, deleted_at={deleted_fetch.deleted_at}")
        assert deleted_fetch.is_deleted is True

    print("\n=== ALL 37 ENTERPRISE TASK MODULE V2.0 EMPIRICAL CHECKS PASSED PERFECTLY ===")


if __name__ == "__main__":
    asyncio.run(run_test())
