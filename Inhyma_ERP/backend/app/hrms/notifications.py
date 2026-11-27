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
from app.rbac.models import Permission, Role, RoleAssignmentStatus, UserPermission, UserRole
from app.users.models import EmploymentStatus, User, UserStatus

logger = logging.getLogger(__name__)


def _emp_display_name(emp: object) -> str:
    if emp is None:
        return "Employee"
    dn = getattr(emp, "display_name", None)
    if isinstance(dn, str) and dn.strip():
        return dn.strip()
    first = getattr(emp, "first_name", "")
    last = getattr(emp, "last_name", "")
    fn = f"{first if isinstance(first, str) else ''} {last if isinstance(last, str) else ''}".strip()
    if fn:
        return fn
    un = getattr(emp, "username", None)
    if isinstance(un, str) and un.strip():
        return un.strip()
    return "Employee" 


async def resolve_hrms_approvers(
    db: AsyncSession,
    employee_id: uuid.UUID,
    *,
    module_name: Optional[str] = None,
) -> List[uuid.UUID]:
    """
    Resolve responsible approvers following Manager-First with HR Fallback.
    1. If the employee has an assigned, active manager who is available (not on leave),
       the notification routes strictly to that manager.
    2. If the manager is unassigned, inactive, or unavailable, routes to active HR/Admin users
       (excluding terminated/resigned users and users explicitly denied module/approval access).
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

    # 2. HR Fallback: active non-terminated users with HR or Admin role
    hr_stmt = (
        select(User.id)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            User.is_active.is_(True),
            User.deleted_at.is_(None),
            User.status == UserStatus.ACTIVE,
            or_(
                User.employment_status.is_(None),
                User.employment_status.notin_([EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED]),
            ),
            UserRole.status == RoleAssignmentStatus.ACTIVE,
            Role.deleted_at.is_(None),
            Role.name.in_(["HR", "hr", "admin", "super_admin", "Super Admin", "Admin", "HR Admin"]),
        )
        .distinct()
    )
    hr_res = await db.execute(hr_stmt)
    hr_user_ids = [uid for uid in list(hr_res.scalars().all()) if uid != employee_id]

    # Filter out HR users explicitly denied approval or the target module (only on real AsyncSession)
    if hr_user_ids and isinstance(db, AsyncSession):
        deny_codes = ["hrms.approve", "hrms.view"]
        if module_name:
            mod = module_name.lower().replace("-", "_")
            deny_codes.extend([f"hrms.{mod}", f"hrms.{mod}s"])

        # Keep Admins unconditionally; filter non-admin HR users with explicit UserPermission is_granted=False
        admin_ids = set(
            (
                await db.execute(
                    select(UserRole.user_id)
                    .join(Role, Role.id == UserRole.role_id)
                    .where(
                        UserRole.user_id.in_(hr_user_ids),
                        UserRole.status == RoleAssignmentStatus.ACTIVE,
                        Role.deleted_at.is_(None),
                        Role.name.in_(["admin", "super_admin", "Super Admin", "Admin"]),
                    )
                )
            )
            .scalars()
            .all()
        )
        denied_ids = set(
            (
                await db.execute(
                    select(UserPermission.user_id)
                    .join(Permission, Permission.id == UserPermission.permission_id)
                    .where(
                        UserPermission.user_id.in_(hr_user_ids),
                        UserPermission.is_granted.is_(False),
                        Permission.code.in_(deny_codes),
                    )
                )
            )
            .scalars()
            .all()
        )
        hr_user_ids = [uid for uid in hr_user_ids if uid in admin_ids or uid not in denied_ids]

    return hr_user_ids


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
    request_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify responsible manager or HR fallback about a new leave request."""
    emp = await db.get(User, employee_id)
    emp_name = _emp_display_name(emp)

    approvers = await resolve_hrms_approvers(db, employee_id, module_name="leave")
    num_disp = int(number_of_days) if float(number_of_days).is_integer() else number_of_days
    link = f"/hrms/leave?request_id={request_id}" if request_id else "/hrms/leave"

    for approver_id in approvers:
        if actor_id and approver_id == actor_id:
            continue
        await send_isolated_hrms_notification(
            db,
            recipient_id=approver_id,
            type="hrms_leave_requested",
            title="Leave Request Submitted",
            message=f"{emp_name} submitted a leave request ({num_disp} day(s), {from_date} to {to_date}).",
            link=link,
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
    request_id: Optional[uuid.UUID] = None,
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

    link = f"/hrms/leave?request_id={request_id}" if request_id else "/hrms/leave"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type=notif_type,
        title=title,
        message=message,
        link=link,
    )


async def notify_leave_cancelled(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    from_date: str,
    to_date: str,
    number_of_days: float,
    actor_id: Optional[uuid.UUID] = None,
    request_id: Optional[uuid.UUID] = None,
    was_approved: bool = False,
) -> None:
    """Notify employee (when Admin cancels their leave) or approvers (when employee cancels own leave)."""
    emp = await db.get(User, employee_id)
    emp_name = _emp_display_name(emp)
    num_disp = int(number_of_days) if float(number_of_days).is_integer() else number_of_days
    link = f"/hrms/leave?request_id={request_id}" if request_id else "/hrms/leave"

    if actor_id and actor_id != employee_id:
        balance_note = " Your leave balance has been restored." if was_approved else ""
        await send_isolated_hrms_notification(
            db,
            recipient_id=employee_id,
            type="hrms_leave_cancelled",
            title="Leave Request Cancelled",
            message=f"Your leave request for {num_disp} day(s) from {from_date} to {to_date} was cancelled.{balance_note}",
            link=link,
        )
    else:
        approvers = await resolve_hrms_approvers(db, employee_id, module_name="leave")
        for approver_id in approvers:
            if actor_id and approver_id == actor_id:
                continue
            await send_isolated_hrms_notification(
                db,
                recipient_id=approver_id,
                type="hrms_leave_cancelled",
                title="Leave Request Cancelled",
                message=f"{emp_name} cancelled their leave request ({num_disp} day(s), {from_date} to {to_date}).",
                link=link,
            )


async def notify_regularization_requested(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    attendance_date: str,
    reason: str,
    actor_id: Optional[uuid.UUID] = None,
    request_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify responsible manager or HR fallback about an attendance regularization request."""
    emp = await db.get(User, employee_id)
    emp_name = _emp_display_name(emp)

    approvers = await resolve_hrms_approvers(db, employee_id, module_name="attendance")
    link = f"/hrms/attendance?regularization_id={request_id}" if request_id else "/hrms/attendance"
    for approver_id in approvers:
        if actor_id and approver_id == actor_id:
            continue
        await send_isolated_hrms_notification(
            db,
            recipient_id=approver_id,
            type="hrms_regularization_requested",
            title="Attendance Regularization Requested",
            message=f"{emp_name} requested attendance regularization for {attendance_date}.",
            link=link,
        )


async def notify_regularization_decision(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    decision: str,  # "APPROVED" or "REJECTED"
    attendance_date: str,
    actor_id: Optional[uuid.UUID] = None,
    request_id: Optional[uuid.UUID] = None,
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

    link = f"/hrms/attendance?regularization_id={request_id}" if request_id else "/hrms/attendance"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type=notif_type,
        title=title,
        message=message,
        link=link,
    )


async def notify_regularization_cancelled(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    attendance_date: str,
    actor_id: Optional[uuid.UUID] = None,
    request_id: Optional[uuid.UUID] = None,
    reason: Optional[str] = None,
) -> None:
    """Notify approvers (when requester cancels) or employee (when admin/manager cancels) about cancellation."""
    emp = await db.get(User, employee_id)
    emp_name = _emp_display_name(emp)
    link = f"/hrms/attendance?regularization_id={request_id}" if request_id else "/hrms/attendance"
    reason_suffix = f" ({reason.strip()})" if reason and reason.strip() else ""

    if actor_id and actor_id != employee_id:
        await send_isolated_hrms_notification(
            db,
            recipient_id=employee_id,
            type="hrms_regularization_cancelled",
            title="Regularization Request Cancelled",
            message=f"Your attendance regularization request for {attendance_date} was cancelled{reason_suffix}.",
            link=link,
        )
    else:
        approvers = await resolve_hrms_approvers(db, employee_id, module_name="attendance")
        for approver_id in approvers:
            if actor_id and approver_id == actor_id:
                continue
            await send_isolated_hrms_notification(
                db,
                recipient_id=approver_id,
                type="hrms_regularization_cancelled",
                title="Regularization Request Cancelled",
                message=f"{emp_name} cancelled their attendance regularization request for {attendance_date}{reason_suffix}.",
                link=link,
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
    expense_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify responsible manager or HR fallback about a submitted expense claim."""
    emp = await db.get(User, employee_id)
    emp_name = _emp_display_name(emp)

    approvers = await resolve_hrms_approvers(db, employee_id, module_name="expenses")
    link = f"/hrms/expenses?expense_id={expense_id}" if expense_id else "/hrms/expenses"
    for approver_id in approvers:
        if actor_id and approver_id == actor_id:
            continue
        await send_isolated_hrms_notification(
            db,
            recipient_id=approver_id,
            type="hrms_expense_submitted",
            title="Expense Claim Submitted",
            message=f"{emp_name} submitted expense claim {expense_code} ({category}, {currency} {amount:.2f}).",
            link=link,
        )


async def notify_expense_decision(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    decision: str,  # "APPROVED" or "REJECTED"
    expense_code: str,
    category: str,
    actor_id: Optional[uuid.UUID] = None,
    expense_id: Optional[uuid.UUID] = None,
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

    link = f"/hrms/expenses?expense_id={expense_id}" if expense_id else "/hrms/expenses"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type=notif_type,
        title=title,
        message=message,
        link=link,
    )


async def notify_expense_reimbursed(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    expense_code: str,
    amount: float,
    currency: str = "INR",
    actor_id: Optional[uuid.UUID] = None,
    expense_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify employee when their approved expense claim has been reimbursed."""
    if actor_id and employee_id == actor_id:
        return

    link = f"/hrms/expenses?expense_id={expense_id}" if expense_id else "/hrms/expenses"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type="hrms_expense_reimbursed",
        title="Expense Claim Reimbursed",
        message=f"Your expense claim {expense_code} ({currency} {amount:.2f}) has been marked as reimbursed.",
        link=link,
    )


async def notify_asset_assigned(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    asset_name: str,
    asset_code: str,
    actor_id: Optional[uuid.UUID] = None,
    asset_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify employee about an asset being assigned to them."""
    if actor_id and employee_id == actor_id:
        return

    link = f"/hrms/assets?asset_id={asset_id}" if asset_id else "/hrms/assets"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type="hrms_asset_assigned",
        title="Asset Assigned",
        message=f"Asset {asset_name} ({asset_code}) has been assigned to you.",
        link=link,
    )


async def notify_asset_returned(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    asset_name: str,
    asset_code: str,
    actor_id: Optional[uuid.UUID] = None,
    asset_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify employee when an asset assigned to them has been recorded as returned."""
    if actor_id and employee_id == actor_id:
        return

    link = f"/hrms/assets?asset_id={asset_id}" if asset_id else "/hrms/assets"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type="hrms_asset_returned",
        title="Asset Return Recorded",
        message=f"Return of asset {asset_name} ({asset_code}) has been recorded.",
        link=link,
    )


async def notify_site_visit_assigned(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    customer_name: str,
    visit_date: str,
    actor_id: Optional[uuid.UUID] = None,
    visit_id: Optional[uuid.UUID] = None,
    reassigned: bool = False,
) -> None:
    """Notify employee when a site visit is assigned or reassigned to them."""
    if actor_id and employee_id == actor_id:
        return

    link = f"/hrms/site-visit?visit_id={visit_id}" if visit_id else "/hrms/site-visit"
    notif_type = "hrms_site_visit_reassigned" if reassigned else "hrms_site_visit_assigned"
    title = "Site Visit Reassigned" if reassigned else "Site Visit Assigned"
    verb = "reassigned" if reassigned else "scheduled"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type=notif_type,
        title=title,
        message=f"A site visit to {customer_name} on {visit_date} has been {verb} for you.",
        link=link,
    )


async def notify_site_visit_cancelled(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    customer_name: str,
    visit_date: str,
    actor_id: Optional[uuid.UUID] = None,
    visit_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify assigned employee when a scheduled site visit is cancelled."""
    if actor_id and employee_id == actor_id:
        return

    link = f"/hrms/site-visit?visit_id={visit_id}" if visit_id else "/hrms/site-visit"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type="hrms_site_visit_cancelled",
        title="Site Visit Cancelled",
        message=f"Your scheduled site visit to {customer_name} on {visit_date} has been cancelled.",
        link=link,
    )


async def notify_site_visit_reassigned_away(
    db: AsyncSession,
    *,
    previous_employee_id: uuid.UUID,
    customer_name: str,
    visit_date: str,
    actor_id: Optional[uuid.UUID] = None,
    visit_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify the previously assigned employee when their scheduled site visit is reassigned away."""
    if actor_id and previous_employee_id == actor_id:
        return

    link = f"/hrms/site-visit?visit_id={visit_id}" if visit_id else "/hrms/site-visit"
    await send_isolated_hrms_notification(
        db,
        recipient_id=previous_employee_id,
        type="hrms_site_visit_reassigned_away",
        title="Site Visit Reassigned",
        message=f"Your scheduled site visit to {customer_name} on {visit_date} has been reassigned to another team member.",
        link=link,
    )


async def notify_payslip_published(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    payroll_month: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify an employee when their monthly payroll is approved and their payslip is available."""
    if actor_id and employee_id == actor_id:
        return

    link = f"/hrms/payroll?month={payroll_month}"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type="hrms_payslip_published",
        title="Payslip Available",
        message=f"Your payslip for {payroll_month} has been approved and is now available to view.",
        link=link,
    )


async def notify_salary_updated(
    db: AsyncSession,
    *,
    employee_id: uuid.UUID,
    effective_from: str,
    actor_id: Optional[uuid.UUID] = None,
    salary_id: Optional[uuid.UUID] = None,
) -> None:
    """Notify an employee when HR/Admin assigns or revises their salary structure."""
    if actor_id and employee_id == actor_id:
        return

    link = f"/hrms/payroll?salary_id={salary_id}" if salary_id else "/hrms/payroll"
    await send_isolated_hrms_notification(
        db,
        recipient_id=employee_id,
        type="hrms_salary_updated",
        title="Salary Structure Updated",
        message=f"Your salary structure has been updated effective {effective_from}.",
        link=link,
    )
