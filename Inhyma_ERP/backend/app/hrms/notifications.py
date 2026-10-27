"""
HRMS Central Notifications Integration (Phase 4).

Coordinates actionable event notifications across HRMS modules:
- Leave requests (submission to manager/HR, approval/rejection to employee)
- Attendance regularization (submission to manager/HR, approval/rejection to employee)
- Expense claims (submission to manager/HR, approval/rejection to employee)
- Asset assignment (assignment to employee)

Rules & Boundaries:
- Manager-first routing with HR fallback when the responsible manager is unassigned or unavailable.
- Strict SAVEPOINT isolation (session.begin_nested()) so notification flush failures do not abort outer transactions.
- Pre-savepoint flush ensuring core business changes are validated and pending.
- In-memory/query deduplication via NotificationRepository.has_recent_notification.
- Self-notification exclusion.
"""

from __future__ import annotations

import logging
import uuid
from typing import List, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.hrms.rbac import check_manager_availability
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User

logger = logging.getLogger(__name__)


async def resolve_hrms_approvers(
    db: AsyncSession,
    employee_id: uuid.UUID,
) -> List[uuid.UUID]:
    """
    Resolve responsible approvers following Manager-First with HR Fallback.
    1. If the employee has an assigned, active manager who is available (not on leave),
       the notification routes strictly to that manager.
    2. If the manager is unassigned, inactive, or unavailable, routes to active HR/Admin users.
    3. Self-notification is excluded (the employee is never returned as their own approver).
    """
    emp = await db.get(User, employee_id)
    if not emp:
        return []

    # 1. Check Manager-First availability
    if emp.manager_id and emp.manager_id != employee_id:
        mgr_available, reason = await check_manager_availability(db, emp.manager_id)
        if mgr_available:
            return [emp.manager_id]

    # 2. HR Fallback: active users with HR or Admin role
    hr_stmt = (
        select(User.id)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            User.is_active.is_(True),
            User.deleted_at.is_(None),
            UserRole.status == RoleAssignmentStatus.ACTIVE,
            Role.deleted_at.is_(None),
            Role.name.in_(["HR", "hr", "admin", "super_admin", "Super Admin", "Admin", "HR Admin"]),
        )
        .distinct()
    )
    hr_res = await db.execute(hr_stmt)
    hr_user_ids = list(hr_res.scalars().all())

    # Exclude employee themself
    return [uid for uid in hr_user_ids if uid != employee_id]


async def send_isolated_hrms_notification(
    db: AsyncSession,
    *,
    recipient_id: uuid.UUID,
    type: str,
    title: str,
    message: str,
    link: str,
    within_hours: int = 24,
) -> None:
    """
    Dispatch a single HRMS notification with SAVEPOINT isolation.
    Ensures pre-existing pending DB changes are flushed before savepoint creation.
    A failure to persist/flush the notification rolls back only the savepoint,
    is logged, and leaves the outer transaction healthy.
    """
    await db.flush()
    try:
        async with db.begin_nested():
            repo = NotificationRepository(db)
            service = NotificationService(repo)

            already_notified = await service.has_recent_notification(
                user_id=recipient_id,
                type=type,
                link=link,
                within_hours=within_hours,
            )
            if not already_notified:
                await service.notify_user(
                    user_id=recipient_id,
                    type=type,
                    title=title,
                    message=message,
                    link=link,
                )
    except Exception:
        logger.exception(
            "Failed to persist HRMS notification (rolled back savepoint).",
            extra={"recipient_id": str(recipient_id), "type": type, "link": link},
        )


async def notify_leave_requested(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    from_date: str,
    to_date: str,
    number_of_days: float,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify responsible manager or HR fallback about a new leave request."""
    emp = await db.get(User, employee_id)
    emp_name = f"{emp.first_name or ''} {emp.last_name or ''}".strip() or (emp.username if emp else "Employee")

    approvers = await resolve_hrms_approvers(db, employee_id)
    num_disp = int(number_of_days) if float(number_of_days).is_integer() else number_of_days

    for approver_id in approvers:
        if actor_id and approver_id == actor_id:
            continue
        await send_isolated_hrms_notification(
            db,
            recipient_id=approver_id,
            type="hrms_leave_requested",
            title="Leave Request Submitted",
            message=f"{emp_name} submitted a leave request ({num_disp} day(s), {from_date} to {to_date}).",
            link="/hrms/leave",
        )


async def notify_leave_decision(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    decision: str,  # "APPROVED" or "REJECTED"
    from_date: str,
    to_date: str,
    number_of_days: float,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify employee about approval or rejection of their leave request."""
    if actor_id and employee_id == actor_id:
        return

    num_disp = int(number_of_days) if float(number_of_days).is_integer() else number_of_days
    if decision.upper() == "APPROVED":
        notif_type = "hrms_leave_approved"
        title = "Leave Request Approved"
        message = f"Your leave request for {num_disp} day(s) from {from_date} to {to_date} has been approved."
    else:
        notif_type = "hrms_leave_rejected"
        title = "Leave Request Rejected"
        message = f"Your leave request for {num_disp} day(s) from {from_date} to {to_date} was rejected."

    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type=notif_type,
        title=title,
        message=message,
        link="/hrms/leave",
    )


async def notify_regularization_requested(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    attendance_date: str,
    reason: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify responsible manager or HR fallback about an attendance regularization request."""
    emp = await db.get(User, employee_id)
    emp_name = f"{emp.first_name or ''} {emp.last_name or ''}".strip() or (emp.username if emp else "Employee")

    approvers = await resolve_hrms_approvers(db, employee_id)
    for approver_id in approvers:
        if actor_id and approver_id == actor_id:
            continue
        await send_isolated_hrms_notification(
            db,
            recipient_id=approver_id,
            type="hrms_regularization_requested",
            title="Attendance Regularization Requested",
            message=f"{emp_name} requested attendance regularization for {attendance_date}.",
            link="/hrms/attendance",
        )


async def notify_regularization_decision(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    decision: str,  # "APPROVED" or "REJECTED"
    attendance_date: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify employee about approval or rejection of their regularization request."""
    if actor_id and employee_id == actor_id:
        return

    if decision.upper() == "APPROVED":
        notif_type = "hrms_regularization_approved"
        title = "Regularization Request Approved"
        message = f"Your attendance regularization request for {attendance_date} has been approved."
    else:
        notif_type = "hrms_regularization_rejected"
        title = "Regularization Request Rejected"
        message = f"Your attendance regularization request for {attendance_date} was rejected."

    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type=notif_type,
        title=title,
        message=message,
        link="/hrms/attendance",
    )


async def notify_expense_submitted(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    expense_code: str,
    category: str,
    amount: float,
    currency: str = "INR",
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify responsible manager or HR fallback about a submitted expense claim."""
    emp = await db.get(User, employee_id)
    emp_name = f"{emp.first_name or ''} {emp.last_name or ''}".strip() or (emp.username if emp else "Employee")

    approvers = await resolve_hrms_approvers(db, employee_id)
    for approver_id in approvers:
        if actor_id and approver_id == actor_id:
            continue
        await send_isolated_hrms_notification(
            db,
            recipient_id=approver_id,
            type="hrms_expense_submitted",
            title="Expense Claim Submitted",
            message=f"{emp_name} submitted expense claim {expense_code} ({category}, {currency} {amount:.2f}).",
            link="/hrms/expenses",
        )


async def notify_expense_decision(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    decision: str,  # "APPROVED" or "REJECTED"
    expense_code: str,
    category: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify employee about approval or rejection of their expense claim."""
    if actor_id and employee_id == actor_id:
        return

    if decision.upper() == "APPROVED":
        notif_type = "hrms_expense_approved"
        title = "Expense Claim Approved"
        message = f"Your expense claim {expense_code} ({category}) has been approved."
    else:
        notif_type = "hrms_expense_rejected"
        title = "Expense Claim Rejected"
        message = f"Your expense claim {expense_code} ({category}) was rejected."

    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type=notif_type,
        title=title,
        message=message,
        link="/hrms/expenses",
    )


async def notify_asset_assigned(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    asset_name: str,
    asset_code: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify employee about an asset being assigned to them."""
    if actor_id and employee_id == actor_id:
        return

    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type="hrms_asset_assigned",
        title="Asset Assigned",
        message=f"Asset {asset_name} ({asset_code}) has been assigned to you.",
        link="/hrms/assets",
    )
