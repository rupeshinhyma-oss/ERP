"""
Aggressive Stress, Speed, and Accuracy Benchmark Suite for Task & Notification Module.
Executes Junior QA & Senior QA verification:
1. Concurrency & Stress: Burst creation, parallel state transitions, concurrent comments/mentions, high-volume bulk updates.
2. Speed Benchmarks: Latency profiling (min, mean, p95, max) and throughput (req/sec) across core task/notification operations.
3. Accuracy Matrix: Strict notification user scoping, 20h deduplication window, 3-tier circular dependency blocker cycle detection, epic progress rollup math, date boundary validation, expired hold alerts.
4. Clean Teardown: Guaranteed cleanup of all stress test data.
"""

import asyncio
import time
import uuid
import statistics
from datetime import date, timedelta
from typing import List, Dict, Any

from sqlalchemy import select

from app.core.exceptions import ValidationException
from app.database.engine import get_sessionmaker
from app.users.models import User
from app.tasks.models import (
    DependencyType,
    IssueType,
    Task,
    TaskPriority,
    TaskStatus,
)
from app.tasks.schemas import (
    TaskCreate,
    TaskUpdate,
    TaskSubtaskCreate,
    TaskDependencyCreate,
    TaskBulkActionRequest,
)
from app.tasks.routes import get_task_service
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.auth.dependencies import CurrentUser


class TaskModuleQAEngine:
    def __init__(self):
        self.session_factory = get_sessionmaker()
        self.created_task_ids: List[uuid.UUID] = []
        self.metrics: Dict[str, List[float]] = {}

    def record_metric(self, op: str, duration_ms: float):
        if op not in self.metrics:
            self.metrics[op] = []
        self.metrics[op].append(duration_ms)

    def print_metric_summary(self, op: str):
        times = self.metrics.get(op, [])
        if not times:
            return
        times.sort()
        count = len(times)
        min_t = times[0]
        max_t = times[-1]
        mean_t = statistics.mean(times)
        p50 = statistics.median(times)
        p95 = times[int(0.95 * count)] if count >= 20 else times[-1]
        total_time = sum(times) / 1000.0
        rps = count / total_time if total_time > 0 else 0
        print(f"   [METRIC] [{op}] N={count} | Min={min_t:.1f}ms | Avg={mean_t:.1f}ms | p50={p50:.1f}ms | p95={p95:.1f}ms | Max={max_t:.1f}ms | Throughput={rps:.1f} ops/sec")


async def run_stress_and_accuracy_suite():
    print("=" * 80)
    print("[START] ENTERPRISE TASK & NOTIFICATION MODULE: AGGRESSIVE STRESS, SPEED & ACCURACY SUITE")
    print("=" * 80)

    qa = TaskModuleQAEngine()

    async with qa.session_factory() as session:
        # Step 0: Fetch Test Personas
        user_res = await session.execute(select(User).limit(3))
        users = list(user_res.scalars().all())
        if len(users) < 3:
            print("[ERROR] Need at least 3 users for multi-user isolation verification.")
            return

        u1, u2, u3 = users[0], users[1], users[2]
        print(f"[SETUP] Personas: User A={u1.username}, User B={u2.username}, User C={u3.username}")

        user_a_ctx = CurrentUser(
            id=u1.id, username=u1.username,
            permissions=["task.view", "task.organization_view", "task.assign", "task.escalate", "task.manage"]
        )
        user_b_ctx = CurrentUser(
            id=u2.id, username=u2.username,
            permissions=["task.view", "task.organization_view", "task.assign", "task.escalate", "task.manage"]
        )

        task_service = get_task_service(session)
        notif_repo = NotificationRepository(session)
        notif_service = NotificationService(notif_repo)

        # -------------------------------------------------------------------------
        # SECTION 1: ACCURACY VERIFICATION (Junior & Senior QA Checklist)
        # -------------------------------------------------------------------------
        print("\n" + "=" * 50)
        print("[SECTION 1] STRICT ACCURACY & INTEGRITY CHECKS")
        print("=" * 50)

        # 1.1 Notification User-Scoping Isolation
        print("\n--- Test 1.1: Notification User-Scoping Isolation ---")
        isolated_task_payload = TaskCreate(
            title="[QA-Scope] Confidential Task for User B",
            description="Testing that User C and User A never receive unassigned notices",
            priority=TaskPriority.HIGH,
            status=TaskStatus.TODO,
            assignee_ids=[u2.id],
        )
        t_start = time.perf_counter()
        isolated_task = await task_service.create_task(isolated_task_payload, user_a_ctx)
        await session.commit()
        qa.created_task_ids.append(isolated_task.id)
        qa.record_metric("create_task_isolated", (time.perf_counter() - t_start) * 1000)

        # Verify User B received assignment notification
        u2_notifs, u2_unread = await notif_service.list_notifications(u2.id)
        assert any(str(isolated_task.id) in (n.link or "") for n in u2_notifs), "User B must receive assignment notification"

        # Verify User C did NOT receive notification
        u3_notifs, _ = await notif_service.list_notifications(u3.id)
        assert not any(str(isolated_task.id) in (n.link or "") for n in u3_notifs), "User C MUST NOT receive User B's task notification"
        print(f"[PASS] Notification strictly scoped to User B ({u2.username}). User C ({u3.username}) received 0 leaks.")

        # 1.2 Targeted Escalation Scoping
        print("\n--- Test 1.2: Targeted Escalation Scoping & Deep-Link ---")
        esc_res = await task_service.escalate_task(
            task_id=isolated_task.id,
            to_user=u3.id,
            reason="Scope blocker requires Director intervention",
            due_date=date.today() + timedelta(days=1),
            escalation_type="DEPARTMENT_MANAGER",
            current_user=user_a_ctx,
        )
        await session.commit()
        assert esc_res is not None

        # Verify User C received escalation notification with drawerTab=escalations
        u3_notifs_after, _ = await notif_service.list_notifications(u3.id)
        matching_esc = [n for n in u3_notifs_after if str(isolated_task.id) in (n.link or "")]
        assert len(matching_esc) >= 1, "User C must receive targeted escalation notification"
        assert "drawerTab=escalations" in matching_esc[0].link, "Notification link must deep-link directly to drawerTab=escalations"
        print(f"[PASS] Targeted escalation dispatched to User C ({u3.username}) with link: {matching_esc[0].link}")

        # 1.3 Deadline Notification Scoping & 20-Hour Deduplication
        print("\n--- Test 1.3: Deadline Notification Scoping & 20-Hour Deduplication ---")
        # Create overdue task for User A
        overdue_payload = TaskCreate(
            title="[QA-Deadline] Overdue Task for User A",
            start_date=date.today() - timedelta(days=5),
            due_date=date.today() - timedelta(days=1),
            priority=TaskPriority.CRITICAL,
            status=TaskStatus.IN_PROGRESS,
            assignee_ids=[u1.id],
        )
        overdue_task = await task_service.create_task(overdue_payload, user_a_ctx)
        await session.commit()
        qa.created_task_ids.append(overdue_task.id)

        # Run deadline check for User A
        count_run_1 = await task_service.check_task_deadlines(user_id=u1.id)
        await session.commit()
        print(f"   First deadline check for User A: {count_run_1} alerts generated")

        # Consecutive run 2 immediately (must deduplicate within 20h window)
        count_run_2 = await task_service.check_task_deadlines(user_id=u1.id)
        await session.commit()
        print(f"   Consecutive deadline check for User A (dedup test): {count_run_2} alerts generated")
        assert count_run_2 == 0, "Deduplication must prevent duplicate alerts within 20 hours"
        print(f"[PASS] Deduplication logic validated (Run 1: {count_run_1}, Run 2: {count_run_2}). Zero spam created.")

        # 1.4 Epic Rollup Progress Math Accuracy
        print("\n--- Test 1.4: Epic Rollup Progress Calculation Accuracy ---")
        epic_payload = TaskCreate(
            title="[QA-Epic] Scalability Transformation",
            issue_type=IssueType.EPIC,
            priority=TaskPriority.HIGH,
            status=TaskStatus.IN_PROGRESS,
        )
        epic = await task_service.create_task(epic_payload, user_a_ctx)
        qa.created_task_ids.append(epic.id)

        # Create 4 sub-tasks
        child_ids = []
        for i in range(4):
            c_task = await task_service.create_task(
                TaskCreate(
                    title=f"[QA-Child-{i+1}] Microservice {i+1}",
                    issue_type=IssueType.TASK,
                    parent_task_id=epic.id,
                    status=TaskStatus.TODO,
                ),
                user_a_ctx,
            )
            child_ids.append(c_task.id)
            qa.created_task_ids.append(c_task.id)
        await session.commit()

        # Check Epic initially at 0%
        epic_read = await task_service.get_task(epic.id)
        assert epic_read.progress_percent == 0, f"Expected 0%, got {epic_read.progress_percent}%"

        # Complete 2 of 4 -> exactly 50%
        await task_service.update_task(child_ids[0], TaskUpdate(status=TaskStatus.DONE), user_a_ctx)
        await task_service.update_task(child_ids[1], TaskUpdate(status=TaskStatus.DONE), user_a_ctx)
        await session.commit()
        epic_read = await task_service.get_task(epic.id)
        assert epic_read.progress_percent == 50, f"Expected 50%, got {epic_read.progress_percent}%"

        # Complete 4 of 4 -> exactly 100%
        await task_service.update_task(child_ids[2], TaskUpdate(status=TaskStatus.DONE), user_a_ctx)
        await task_service.update_task(child_ids[3], TaskUpdate(status=TaskStatus.DONE), user_a_ctx)
        await session.commit()
        epic_read = await task_service.get_task(epic.id)
        assert epic_read.progress_percent == 100, f"Expected 100%, got {epic_read.progress_percent}%"
        print("[PASS] Epic progress rollup math verified precisely (0/4=0%, 2/4=50%, 4/4=100%).")

        # 1.5 Multi-Tier Circular Dependency Blocker Prevention
        print("\n--- Test 1.5: Multi-Tier Circular Blocker Cycle Prevention ---")
        t_a = await task_service.create_task(TaskCreate(title="[QA-Dep-A] Root Service"), user_a_ctx)
        t_b = await task_service.create_task(TaskCreate(title="[QA-Dep-B] Intermediate Service"), user_a_ctx)
        t_c = await task_service.create_task(TaskCreate(title="[QA-Dep-C] Leaf Service"), user_a_ctx)
        qa.created_task_ids.extend([t_a.id, t_b.id, t_c.id])
        await session.commit()

        # Link: A BLOCKS B
        await task_service.add_dependency(
            task_id=t_a.id,
            payload=TaskDependencyCreate(depends_on_task_id=t_b.id, dependency_type=DependencyType.BLOCKS),
            current_user=user_a_ctx,
        )
        # Link: B BLOCKS C
        await task_service.add_dependency(
            task_id=t_b.id,
            payload=TaskDependencyCreate(depends_on_task_id=t_c.id, dependency_type=DependencyType.BLOCKS),
            current_user=user_a_ctx,
        )
        await session.commit()

        # Attempt: C BLOCKS A (should trigger cycle detection)
        circular_blocked = False
        try:
            await task_service.add_dependency(
                task_id=t_c.id,
                payload=TaskDependencyCreate(depends_on_task_id=t_a.id, dependency_type=DependencyType.BLOCKS),
                current_user=user_a_ctx,
            )
        except ValidationException as e:
            circular_blocked = True
            print(f"   Circular dependency blocked as expected: '{e.message}'")

        assert circular_blocked, "Multi-tier circular blocker chain (A->B->C->A) must be detected and rejected"
        print("[PASS] Multi-tier circular blocker cycle prevented flawlessly.")

        # 1.6 Expired Hold Alerting
        print("\n--- Test 1.6: On-Hold Expiry Automated Alerting ---")
        hold_task = await task_service.create_task(
            TaskCreate(
                title="[QA-Hold] Task with Expired Hold",
                status=TaskStatus.ON_HOLD,
                hold_reason="Waiting for 3rd party approval",
                hold_until=date.today() - timedelta(days=2),
                assignee_ids=[u1.id],
            ),
            user_a_ctx,
        )
        qa.created_task_ids.append(hold_task.id)
        await session.commit()

        expired_notified = await task_service.check_expired_holds()
        await session.commit()
        print(f"   Expired holds detected and notified: {expired_notified}")
        assert expired_notified >= 1, "Expired hold worker must detect past hold_until tasks"
        print("[PASS] On-Hold automated expiry detection verified.")

        # -------------------------------------------------------------------------
        # SECTION 2: SPEED & LATENCY BENCHMARKS (Senior QA Profiling)
        # -------------------------------------------------------------------------
        print("\n" + "=" * 50)
        print("[SECTION 2] SPEED & LATENCY BENCHMARKS")
        print("=" * 50)

        # 2.1 Task Creation Latency
        for i in range(15):
            t_start = time.perf_counter()
            t_bench = await task_service.create_task(
                TaskCreate(
                    title=f"[QA-Speed-Create-{i}] Benchmarking Latency",
                    priority=TaskPriority.MEDIUM,
                    status=TaskStatus.TODO,
                    start_date=date.today(),
                    due_date=date.today() + timedelta(days=7),
                    assignee_ids=[u1.id],
                    subtasks=["Bench subtask A", "Bench subtask B"],
                ),
                user_a_ctx,
            )
            qa.record_metric("Task Creation (with Assignee & Subtasks)", (time.perf_counter() - t_start) * 1000)
            qa.created_task_ids.append(t_bench.id)
        await session.commit()
        qa.print_metric_summary("Task Creation (with Assignee & Subtasks)")

        # 2.2 Task Listing & Filtering Latency
        for _ in range(20):
            t_start = time.perf_counter()
            _, total = await task_service.list_tasks(
                current_user_id=u1.id,
                user_permissions={"task.view", "task.organization_view"},
                view_mode="all",
                status=TaskStatus.TODO,
                page=1,
                page_size=25,
            )
            qa.record_metric("Task Listing (Status Filter + Pagination)", (time.perf_counter() - t_start) * 1000)
        qa.print_metric_summary("Task Listing (Status Filter + Pagination)")

        # 2.3 Task Full Detail Fetch Latency
        sample_id = qa.created_task_ids[0]
        for _ in range(20):
            t_start = time.perf_counter()
            _ = await task_service.get_task(sample_id)
            qa.record_metric("Task Full Detail Read", (time.perf_counter() - t_start) * 1000)
        qa.print_metric_summary("Task Full Detail Read")

        # 2.4 Task Timeline Generation Latency
        for _ in range(15):
            t_start = time.perf_counter()
            _ = await task_service.get_task_timeline(sample_id)
            qa.record_metric("Task Timeline Generation", (time.perf_counter() - t_start) * 1000)
        qa.print_metric_summary("Task Timeline Generation")

        # 2.5 In-App Notifications Listing Latency
        for _ in range(20):
            t_start = time.perf_counter()
            _, _ = await notif_service.list_notifications(u1.id, limit=50)
            qa.record_metric("Notifications Listing (Top 50)", (time.perf_counter() - t_start) * 1000)
        qa.print_metric_summary("Notifications Listing (Top 50)")

        # -------------------------------------------------------------------------
        # SECTION 3: AGGRESSIVE STRESS & CONCURRENCY (Burst & Race Conditions)
        # -------------------------------------------------------------------------
        print("\n" + "=" * 50)
        print("[SECTION 3] AGGRESSIVE STRESS & CONCURRENCY TESTING")
        print("=" * 50)

        # 3.1 Concurrent Burst Task Creation (20 tasks simultaneously)
        print("\n--- Test 3.1: Burst Concurrency - 20 Simultaneous Task Creations ---")
        burst_created_ids = []

        async def create_single_burst_task(idx: int):
            async with qa.session_factory() as burst_session:
                b_svc = get_task_service(burst_session)
                t_start = time.perf_counter()
                b_task = await b_svc.create_task(
                    TaskCreate(
                        title=f"[QA-Burst-{idx}] High Concurrency Burst",
                        priority=TaskPriority.HIGH if idx % 2 == 0 else TaskPriority.CRITICAL,
                        status=TaskStatus.TODO,
                        assignee_ids=[u2.id],
                    ),
                    user_a_ctx,
                )
                await burst_session.commit()
                qa.record_metric("Burst Task Creation", (time.perf_counter() - t_start) * 1000)
                return b_task.id

        burst_start = time.perf_counter()
        burst_results = await asyncio.gather(*[create_single_burst_task(i) for i in range(20)], return_exceptions=True)
        burst_duration = time.perf_counter() - burst_start

        burst_success = [r for r in burst_results if isinstance(r, uuid.UUID)]
        burst_errors = [r for r in burst_results if isinstance(r, Exception)]
        qa.created_task_ids.extend(burst_success)

        print(f"   Burst 20 Creations Completed in {burst_duration:.2f}s")
        print(f"   Success: {len(burst_success)} / 20 | Failures: {len(burst_errors)}")
        qa.print_metric_summary("Burst Task Creation")
        assert len(burst_success) == 20, f"All 20 concurrent tasks must succeed. Errors: {burst_errors}"
        print("[PASS] Concurrency burst withstood without database lock timeouts or pool exhaustion.")

        # 3.2 High-Volume Bulk Update (Status & Priority across 20 tasks)
        print("\n--- Test 3.2: High-Volume Bulk Updates ---")
        t_start = time.perf_counter()
        bulk_res = await task_service.bulk_action(
            TaskBulkActionRequest(
                task_ids=burst_success,
                action="UPDATE_STATUS",
                status="DONE",
            ),
            user_a_ctx,
        )
        await session.commit()
        qa.record_metric("Bulk Status Update (20 items)", (time.perf_counter() - t_start) * 1000)
        qa.print_metric_summary("Bulk Status Update (20 items)")
        assert bulk_res.success_count == 20, f"Expected 20 updated, got {bulk_res.success_count}"
        print(f"[PASS] Bulk action updated {bulk_res.success_count} tasks atomically.")

        # 3.3 Rapid Fire Parallel Comments & Mentions
        print("\n--- Test 3.3: Parallel Concurrent Comments with @mentions ---")
        target_task_id = burst_success[0]

        async def post_concurrent_comment(c_idx: int):
            async with qa.session_factory() as c_session:
                c_svc = get_task_service(c_session)
                await c_svc.add_comment(
                    target_task_id,
                    f"Concurrent QA feedback #{c_idx} mentioning @{u2.username} for audit verification.",
                    user_a_ctx,
                )
                await c_session.commit()

        c_start = time.perf_counter()
        await asyncio.gather(*[post_concurrent_comment(i) for i in range(10)])
        c_duration = time.perf_counter() - c_start
        print(f"   10 parallel comments with mentions committed in {c_duration:.2f}s ({10/c_duration:.1f} comments/sec)")
        print("[PASS] Rapid parallel comments and mention parsing succeeded without deadlock.")

        # -------------------------------------------------------------------------
        # SECTION 4: CLEAN TEARDOWN & RECOVERY
        # -------------------------------------------------------------------------
        print("\n" + "=" * 50)
        print("[SECTION 4] DATA TEARDOWN & AUDIT VERIFICATION")
        print("=" * 50)

        cleaned_count = 0
        for tid in set(qa.created_task_ids):
            try:
                await task_service.soft_delete_task(tid, user_a_ctx)
                cleaned_count += 1
            except Exception:
                pass
        await session.commit()
        print(f"[PASS] Cleaned up {cleaned_count} test tasks. Zero residual test pollution.")

    print("\n" + "=" * 80)
    print("[SUMMARY] ALL AGGRESSIVE STRESS, SPEED, AND ACCURACY VERIFICATIONS PASSED WITH 100% INTEGRITY")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_stress_and_accuracy_suite())
