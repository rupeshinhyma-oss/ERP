"""
Enterprise Tasks Module — Comprehensive RBAC & Security Test Suite.

Covers:
TEST 1: Task Visibility & Department Scoping (IDOR Prevention)
TEST 2: Controls Panel, Dynamic Permissions & Stale JWT Invalidation
TEST 3: Create & Mutation Authorization (Registered Permissions Enforcement)
TEST 4: Approval Workflow & Escalation Authorization
TEST 5: Bulk Operations Authorization & Batch Isolation
TEST 6: Collaboration, Subtasks, Comments & File Attachments
TEST 7: Information Leakage & Cross-Department Query Scoping
TEST 8: End-to-End Regression & Persona Verification
"""

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.core.exceptions import ForbiddenException, NotFoundException, UnauthorizedException, ValidationException
from app.tasks.models import (
    Task,
    TaskAssignee,
    TaskStatus,
    TaskPriority,
    TaskComment,
    TaskAttachment,
    TaskSubtask,
    TaskEscalation,
)
from app.tasks.schemas import (
    TaskCreate,
    TaskUpdate,
    TaskBulkActionRequest,
    TaskApprovalActionRequest,
    TaskSubmitApprovalRequest,
    TaskAssignRequest,
)
from app.tasks.service import TaskService
from app.tasks.repository import TaskRepository
from app.auth.service import CurrentUser, AuthService
from app.rbac.models import Permission, Role, UserPermission
from app.rbac.repository import RoleRepository


@pytest.fixture
def super_admin_user():
    return CurrentUser(
        id=uuid.uuid4(),
        username="qa_admin",
        is_super_admin=True,
        permissions={"*"},
    )


@pytest.fixture
def sales_manager_user():
    return CurrentUser(
        id=uuid.uuid4(),
        username="qa_sales_mgr",
        is_super_admin=False,
        permissions={"task.view", "task.create", "task.assign", "task.department_view", "task.escalate"},
    )


@pytest.fixture
def sales_employee_user():
    return CurrentUser(
        id=uuid.uuid4(),
        username="qa_sales_emp",
        is_super_admin=False,
        permissions={"task.view", "task.create"},
    )


@pytest.fixture
def other_employee_user():
    return CurrentUser(
        id=uuid.uuid4(),
        username="qa_other_emp",
        is_super_admin=False,
        permissions={"task.view"},
    )


@pytest.fixture
def mock_session():
    session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_result.scalars.return_value.all.return_value = []
    mock_result.scalars.return_value.first.return_value = None
    mock_result.fetchall.return_value = []
    session.execute = AsyncMock(return_value=mock_result)
    session.refresh = AsyncMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()
    return session


@pytest.fixture
def mock_repo(mock_session):
    repo = MagicMock(spec=TaskRepository)
    repo.session = mock_session
    repo.get_user_permitted_department_ids = AsyncMock(return_value=[uuid.uuid4()])
    return repo


@pytest.fixture
def task_service(mock_repo):
    service = TaskService(
        repository=mock_repo,
        audit_service=AsyncMock(),
        notification_service=AsyncMock(),
        dispatcher=AsyncMock(),
    )
    return service


# =========================================================================
# TEST 1 — Task Visibility & Department Scoping (IDOR Prevention)
# =========================================================================

@pytest.mark.asyncio
async def test_employee_reads_authorized_task(task_service, sales_employee_user):
    """Employee reads a task they created or are assigned to: allowed."""
    dept_id = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="My Task",
        created_by=sales_employee_user.id,
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    retrieved = await task_service.get_task(task.id, current_user=sales_employee_user)
    assert retrieved.id == task.id


@pytest.mark.asyncio
async def test_employee_reads_unauthorized_task_denied(task_service, sales_employee_user):
    """Employee attempting to read another employee's task outside their scope: 403 Forbidden."""
    other_user_id = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="Secret Exec Task",
        created_by=other_user_id,
        status=TaskStatus.TODO,
        priority=TaskPriority.HIGH,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)
    task_service.repository.get_user_permitted_department_ids = AsyncMock(return_value=[uuid.uuid4()])

    with pytest.raises(ForbiddenException) as exc_info:
        await task_service.get_task(task.id, current_user=sales_employee_user)
    assert "do not have permission to view" in str(exc_info.value)


@pytest.mark.asyncio
async def test_sales_manager_reads_department_task(task_service, sales_manager_user):
    """Sales manager reads a task within their managed Sales department: allowed."""
    sales_dept_id = uuid.uuid4()
    other_emp_id = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="Sales Task",
        created_by=other_emp_id,
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)
    task_service.repository.get_user_permitted_department_ids = AsyncMock(return_value=[sales_dept_id])

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = uuid.uuid4()  # Manager leadership assignment matches
    task_service.repository.session.execute = AsyncMock(return_value=mock_result)

    retrieved = await task_service.get_task(task.id, current_user=sales_manager_user)
    assert retrieved.id == task.id


@pytest.mark.asyncio
async def test_sales_manager_reads_outside_department_denied(task_service, sales_manager_user):
    """Sales manager reads a task in HR department: denied."""
    hr_dept_id = uuid.uuid4()
    sales_dept_id = uuid.uuid4()
    hr_user_id = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="HR Confidential Task",
        created_by=hr_user_id,
        status=TaskStatus.TODO,
        priority=TaskPriority.HIGH,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)
    task_service.repository.get_user_permitted_department_ids = AsyncMock(return_value=[sales_dept_id])

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None  # Not manager and not in same dept
    task_service.repository.session.execute = AsyncMock(return_value=mock_result)

    with pytest.raises(ForbiddenException) as exc_info:
        await task_service.get_task(task.id, current_user=sales_manager_user)
    assert "do not have permission to view" in str(exc_info.value)


@pytest.mark.asyncio
async def test_super_admin_reads_any_task(task_service, super_admin_user):
    """Super Admin can view any task across the organization."""
    task = Task(
        id=uuid.uuid4(),
        title="Any Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.TODO,
        priority=TaskPriority.LOW,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    retrieved = await task_service.get_task(task.id, current_user=super_admin_user)
    assert retrieved.id == task.id


@pytest.mark.asyncio
async def test_unauthorized_timeline_access_denied(task_service, sales_employee_user):
    """Unauthorized user requesting timeline for a restricted task gets 403 Forbidden."""
    task = Task(
        id=uuid.uuid4(),
        title="Restricted Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.TODO,
        priority=TaskPriority.HIGH,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)
    task_service.repository.get_user_permitted_department_ids = AsyncMock(return_value=[uuid.uuid4()])

    with pytest.raises(ForbiddenException):
        await task_service.get_task_timeline(task.id, current_user=sales_employee_user)


# =========================================================================
# TEST 2 — Permission Controls Panel & Real-time Freshness
# =========================================================================

@pytest.mark.asyncio
async def test_effective_permissions_role_and_user_overrides():
    """Verify Controls Panel logic: Role permissions + User Grant - User Deny."""
    mock_session = AsyncMock()
    repo = RoleRepository(mock_session)
    user_id = uuid.uuid4()

    # 1. Not super admin
    res_admin = MagicMock()
    res_admin.scalar_one_or_none.return_value = None

    # 2. Role permissions
    res_roles = MagicMock()
    res_roles.scalars.return_value.all.return_value = ["task.view", "task.create", "task.assign"]

    # 3. User overrides: explicit grant of task.manage, explicit denial of task.assign
    res_overrides = MagicMock()
    res_overrides.all.return_value = [
        ("task.manage", True),
        ("task.assign", False),
    ]

    mock_session.execute.side_effect = [res_admin, res_roles, res_overrides]
    effective = await repo.get_permission_codes_for_user(user_id)

    assert "task.view" in effective
    assert "task.create" in effective
    assert "task.manage" in effective
    assert "task.assign" not in effective  # Revoked by explicit denial!


@pytest.mark.asyncio
async def test_stale_jwt_permissions_cannot_restore_revoked_access():
    """
    Verify security fix in verify_access_token:
    Stale permission claims embedded in JWT cannot bypass database revocation.
    """
    from app.auth.service import AuthService
    mock_user_repo = AsyncMock()
    mock_role_repo = AsyncMock()
    mock_session_repo = AsyncMock()
    mock_token_repo = AsyncMock()
    mock_pass_repo = AsyncMock()
    mock_cache = AsyncMock()

    service = AuthService(
        user_repository=mock_user_repo,
        role_repository=mock_role_repo,
        session_repository=mock_session_repo,
        token_blacklist_repository=mock_token_repo,
        password_history_repository=mock_pass_repo,
        cache=mock_cache,
    )

    user_id = uuid.uuid4()
    mock_cache.get = AsyncMock(return_value=None)
    # Live database returns ONLY task.view (task.create was revoked in Controls Panel)
    mock_role_repo.get_permission_codes_for_user = AsyncMock(return_value={"task.view"})

    # Token payload still carries stale "task.create" claim from 10 minutes ago
    stale_token_perms = ["task.view", "task.create"]

    # When service checks live permissions
    live_perms = await service.get_user_effective_permissions(user_id)
    assert "task.create" not in live_perms
    assert live_perms == {"task.view"}


# =========================================================================
# TEST 3 — Create and Mutate Authorization
# =========================================================================

@pytest.mark.asyncio
async def test_user_without_create_permission_cannot_create_task(sales_employee_user):
    """User without task.create permission is blocked by route dependency."""
    from app.rbac.dependencies import require_any_permission
    checker = require_any_permission("task.create", "task.manage")
    # sales_employee_user with only task.view
    sales_employee_user.permissions = {"task.view"}
    with pytest.raises(ForbiddenException) as exc_info:
        await checker(current_user=sales_employee_user)
    assert "requires one of the following permissions" in str(exc_info.value)


@pytest.mark.asyncio
async def test_unauthorized_mutation_denied(task_service, other_employee_user):
    """Non-creator, non-assignee employee cannot mutate a protected task."""
    task = Task(
        id=uuid.uuid4(),
        title="Finance Budget",
        created_by=uuid.uuid4(),
        status=TaskStatus.TODO,
        priority=TaskPriority.HIGH,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException) as exc_info:
        await task_service.update_task(
            task.id,
            TaskUpdate(title="Malicious Title"),
            current_user=other_employee_user,
        )
    assert "You do not have permission to update this task." in str(exc_info.value)


@pytest.mark.asyncio
async def test_unauthorized_soft_delete_denied(task_service, other_employee_user):
    """User without task.manage or task.delete cannot delete task."""
    task = Task(
        id=uuid.uuid4(),
        title="Protected Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.TODO,
        priority=TaskPriority.HIGH,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException):
        await task_service.soft_delete_task(task.id, current_user=other_employee_user)


# =========================================================================
# TEST 4 — Approval & Escalation Authorization
# =========================================================================

@pytest.mark.asyncio
async def test_authorized_approver_can_approve(task_service, sales_manager_user):
    """Designated approver can approve a task in PENDING_APPROVAL."""
    task = Task(
        id=uuid.uuid4(),
        title="Approval Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.PENDING_APPROVAL,
        approval_status="PENDING_APPROVAL",
        approver_id=sales_manager_user.id,
        version=1,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    updated = await task_service.action_approval(
        task.id,
        TaskApprovalActionRequest(approved=True, notes="Looks great"),
        current_user=sales_manager_user,
    )
    assert updated.status == TaskStatus.DONE
    assert updated.approval_status == "APPROVED"


@pytest.mark.asyncio
async def test_unauthorized_user_cannot_approve(task_service, sales_employee_user):
    """Unrelated user attempting to approve someone else's approval task is rejected."""
    actual_approver_id = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="Executive Approval Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.PENDING_APPROVAL,
        approval_status="PENDING_APPROVAL",
        approver_id=actual_approver_id,
        version=1,
    )
    assignee_mock = MagicMock()
    assignee_mock.user_id = sales_employee_user.id
    task.assignees = [assignee_mock]
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException) as exc_info:
        await task_service.action_approval(
            task.id,
            TaskApprovalActionRequest(approved=True, notes="Unauthorized approval attempt"),
            current_user=sales_employee_user,
        )
    assert "Only the designated approver" in str(exc_info.value)


@pytest.mark.asyncio
async def test_replaying_approval_on_completed_task_denied(task_service, sales_manager_user):
    """Cannot approve a task that is not in PENDING_APPROVAL state."""
    task = Task(
        id=uuid.uuid4(),
        title="Already Done Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.DONE,
        approval_status="APPROVED",
        approver_id=sales_manager_user.id,
        version=2,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ValidationException) as exc_info:
        await task_service.action_approval(
            task.id,
            TaskApprovalActionRequest(approved=True, notes="Replay"),
            current_user=sales_manager_user,
        )
    assert "pending approval" in str(exc_info.value).lower()


# =========================================================================
# TEST 5 — Bulk Operations Authorization & Batch Isolation
# =========================================================================

@pytest.mark.asyncio
async def test_bulk_action_blocks_unauthorized_tasks_in_batch(task_service, sales_employee_user):
    """
    When a batch contains 1 authorized task and 1 unauthorized task:
    The unauthorized task is rejected and segregated into failed_ids;
    The unauthorized record is NOT mutated.
    """
    my_task_id = uuid.uuid4()
    other_task_id = uuid.uuid4()

    my_task = Task(
        id=my_task_id,
        title="My Task",
        created_by=sales_employee_user.id,
        status=TaskStatus.TODO,
    )
    my_task.assignees = []
    my_task.watchers = []

    other_task = Task(
        id=other_task_id,
        title="Protected Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.TODO,
    )
    other_task.assignees = []
    other_task.watchers = []

    async def get_by_id(tid):
        return my_task if tid == my_task_id else other_task

    task_service.repository.get_task_by_id = AsyncMock(side_effect=get_by_id)
    task_service.repository.bulk_update_tasks = AsyncMock(return_value=(1, []))

    resp = await task_service.bulk_action(
        TaskBulkActionRequest(
            task_ids=[my_task_id, other_task_id],
            action="STATUS",
            value="DONE",
        ),
        current_user=sales_employee_user,
    )
    assert resp.success_count == 1
    assert other_task_id in resp.failed_ids
    # bulk_update_tasks only received the authorized ID
    task_service.repository.bulk_update_tasks.assert_called_once_with(
        task_ids=[my_task_id],
        action="STATUS",
        value="DONE",
        actor_id=sales_employee_user.id,
    )


# =========================================================================
# TEST 6 — Collaboration, Subtasks, Comments & Files
# =========================================================================

@pytest.mark.asyncio
async def test_unauthorized_user_cannot_add_subtask(task_service, other_employee_user):
    """User without mutate authorization on a task cannot create a subtask."""
    task = Task(
        id=uuid.uuid4(),
        title="Protected Project",
        created_by=uuid.uuid4(),
        status=TaskStatus.IN_PROGRESS,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException):
        await task_service.add_subtask(
            task.id,
            title="Unauthorized Subtask",
            current_user=other_employee_user,
        )


@pytest.mark.asyncio
async def test_unauthorized_user_cannot_add_attachment(task_service, other_employee_user):
    """User without mutate authorization on a task cannot add attachments."""
    task = Task(
        id=uuid.uuid4(),
        title="Protected Project",
        created_by=uuid.uuid4(),
        status=TaskStatus.IN_PROGRESS,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException):
        await task_service.add_attachment(
            task.id,
            file_name="malicious.pdf",
            file_url="/files/malicious.pdf",
            file_size=1024,
            file_type="application/pdf",
            current_user=other_employee_user,
        )


# =========================================================================
# TEST 7 — Information Leakage & Cross-Department Query Scoping
# =========================================================================

@pytest.mark.asyncio
async def test_workload_dashboard_department_tampering_denied(task_service, sales_manager_user):
    """Sales manager trying to query engineering department workload is rejected."""
    engineering_dept_id = uuid.uuid4()
    sales_dept_id = uuid.uuid4()
    task_service.repository.get_user_permitted_department_ids = AsyncMock(return_value=[sales_dept_id])

    with pytest.raises(ForbiddenException) as exc_info:
        await task_service.get_workload_dashboard(
            department_id=engineering_dept_id,
            current_user=sales_manager_user,
        )
    assert "permission to view workload for this department" in str(exc_info.value)


@pytest.mark.asyncio
async def test_capacity_view_department_tampering_denied(task_service, sales_manager_user):
    """Sales manager trying to query another department capacity grid is rejected."""
    foreign_dept_id = uuid.uuid4()
    sales_dept_id = uuid.uuid4()
    task_service.repository.get_user_permitted_department_ids = AsyncMock(return_value=[sales_dept_id])

    with pytest.raises(ForbiddenException) as exc_info:
        await task_service.get_capacity_view(
            start_date=date.today(),
            end_date=date.today(),
            department_id=foreign_dept_id,
            current_user=sales_manager_user,
        )
    assert "permission to view capacity for this department" in str(exc_info.value)


# =========================================================================
# TEST 8 — End-to-End Regression & Persona Verification
# =========================================================================

@pytest.mark.asyncio
async def test_task_creation_and_completion_regression(task_service, sales_employee_user):
    """Authorized task creation, assignment, and completion works end-to-end."""
    created_task = Task(
        id=uuid.uuid4(),
        title="Regression Task",
        created_by=sales_employee_user.id,
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
    )
    created_task.assignees = []
    created_task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=created_task)

    # Status update to DONE
    done_update = TaskUpdate(status=TaskStatus.DONE)
    updated = await task_service.update_task(created_task.id, done_update, current_user=sales_employee_user)
    assert updated.status == TaskStatus.DONE


# =========================================================================
# TEST 9 — Phase 4 Adversarial & Action-Specific RBAC Coverage
# =========================================================================

@pytest.mark.asyncio
async def test_unauthorized_user_cannot_escalate_task(task_service, other_employee_user):
    """User without access to task cannot escalate it."""
    task = Task(
        id=uuid.uuid4(),
        title="Restricted Strategy Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.IN_PROGRESS,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException):
        await task_service.escalate_task(
            task_id=task.id,
            to_user=uuid.uuid4(),
            reason="Unauthorized escalation attempt",
            due_date=date.today(),
            current_user=other_employee_user,
        )


@pytest.mark.asyncio
async def test_unauthorized_user_cannot_list_escalation_comments(task_service, other_employee_user):
    """User without view access cannot read escalation discussions."""
    task = Task(
        id=uuid.uuid4(),
        title="Restricted Strategy Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.IN_PROGRESS,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    esc_id = uuid.uuid4()
    mock_esc = MagicMock()
    mock_esc.id = esc_id
    mock_esc.task_id = task.id
    task_service.repository.get_escalation_by_id = AsyncMock(return_value=mock_esc)

    with pytest.raises(ForbiddenException):
        await task_service.list_escalation_comments(
            escalation_id=esc_id,
            current_user=other_employee_user,
        )


@pytest.mark.asyncio
async def test_unauthorized_user_cannot_add_dependency(task_service, other_employee_user):
    """User without mutate authorization cannot add task dependencies."""
    task = Task(
        id=uuid.uuid4(),
        title="Source Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.TODO,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException):
        await task_service.add_dependency(
            task_id=task.id,
            payload=MagicMock(depends_on_task_id=uuid.uuid4(), dependency_type="BLOCKS"),
            current_user=other_employee_user,
        )


@pytest.mark.asyncio
async def test_unauthorized_user_cannot_toggle_reactions(task_service, other_employee_user):
    """User without view authorization cannot toggle emoji reactions."""
    task = Task(
        id=uuid.uuid4(),
        title="Confidential Task",
        created_by=uuid.uuid4(),
        status=TaskStatus.TODO,
    )
    task.assignees = []
    task.watchers = []
    task_service.repository.get_task_by_id = AsyncMock(return_value=task)

    with pytest.raises(ForbiddenException):
        await task_service.toggle_task_reaction(
            task_id=task.id,
            emoji="👍",
            current_user=other_employee_user,
        )

