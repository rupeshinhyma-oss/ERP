"""
CRM Lead Management Central Notifications Integration.

Coordinates actionable in-app + live WebSocket notifications across CRM Lead Management:
- Manual lead creation assigned to a salesperson
- Lead reassignment (notifies new owner with lead deep-link and previous owner with safe list link)
- Automated / CSV-import lead distribution (per-lead for single assignment, concise batch summary for CSV imports)
- Pipeline stage transitions (notifies assigned salesperson when updated by another user, and notifies reporting manager on Won/Lost outcomes)
- Follow-up completion / cancellation by another user
- Sales quotation creation and lifecycle status changes on another user's lead

Rules & Boundaries:
- Strict SAVEPOINT isolation (`session.begin_nested()`) so notification flush failures NEVER abort outer CRM transactions.
- Pre-savepoint flush ensures core CRM entity changes are validated first.
- Deduplication via `NotificationService.has_recent_notification`.
- Self-notification exclusion (actors are never notified of their own actions).
- RBAC-safe links: former lead owners receive `/crm/leads` (never `?leadId=`) since they lose visibility after reassignment.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.users.models import EmploymentStatus, User, UserStatus

logger = logging.getLogger(__name__)


def _actor_display_name(actor: object | None, fallback: str = "CRM User") -> str:
    if actor is None:
        return fallback
    if isinstance(actor, str):
        return actor.strip() or fallback
    dn = getattr(actor, "display_name", None)
    if isinstance(dn, str) and dn.strip():
        return dn.strip()
    fn = getattr(actor, "full_name", None)
    if isinstance(fn, str) and fn.strip():
        return fn.strip()
    first = getattr(actor, "first_name", "")
    last = getattr(actor, "last_name", "")
    combined = f"{first if isinstance(first, str) else ''} {last if isinstance(last, str) else ''}".strip()
    if combined:
        return combined
    un = getattr(actor, "username", None)
    if isinstance(un, str) and un.strip():
        return un.strip()
    return fallback


def _is_notifiable_active_user(user: User | None) -> bool:
    if user is None:
        return False
    if getattr(user, "deleted_at", None) is not None:
        return False
    if not getattr(user, "is_active", True):
        return False
    if getattr(user, "status", None) in (UserStatus.INACTIVE, UserStatus.SUSPENDED, UserStatus.LOCKED):
        return False
    if getattr(user, "employment_status", None) in (
        EmploymentStatus.TERMINATED,
        EmploymentStatus.RESIGNED,
        EmploymentStatus.INACTIVE,
    ):
        return False
    return True


async def send_isolated_crm_notification(
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
    Dispatch a single CRM notification inside a SAVEPOINT (`begin_nested()`).
    Pre-flushes outer core CRM writes first so core errors propagate normally while
    notification-only errors roll back only the savepoint and leave the outer session healthy.
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
            "Failed to persist CRM notification (rolled back savepoint).",
            extra={"recipient_id": str(recipient_id), "type": type, "link": link},
        )


async def notify_crm_lead_assigned(
    db: AsyncSession,
    *,
    lead_id: uuid.UUID,
    lead_code: str | None,
    lead_name: str,
    assignee_id: Optional[uuid.UUID],
    actor_id: Optional[uuid.UUID] = None,
    actor_name: Optional[str] = None,
    reassigned: bool = False,
    reason: Optional[str] = None,
) -> None:
    """Notify the salesperson when a CRM lead is assigned or reassigned to them."""
    if not assignee_id:
        return
    if actor_id and assignee_id == actor_id:
        return

    code_prefix = f"{lead_code} — " if lead_code else ""
    by_suffix = f" by {actor_name.strip()}" if actor_name and actor_name.strip() else ""
    reason_suffix = f" Reason: {reason.strip()}" if reason and reason.strip() else ""

    notif_type = "crm_lead_reassigned" if reassigned else "crm_lead_assigned"
    title = "Lead Reassigned to You" if reassigned else "New Lead Assigned"
    verb = "reassigned" if reassigned else "assigned"
    message = f"Lead {code_prefix}{lead_name} has been {verb} to you{by_suffix}.{reason_suffix}"
    link = f"/crm/leads?leadId={lead_id}"

    await send_isolated_crm_notification(
        db,
        recipient_id=assignee_id,
        type=notif_type,
        title=title,
        message=message,
        link=link,
    )


async def notify_crm_lead_transferred_away(
    db: AsyncSession,
    *,
    lead_code: str | None,
    lead_name: str,
    previous_owner_id: Optional[uuid.UUID],
    actor_id: Optional[uuid.UUID] = None,
    new_owner_name: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    """
    Notify the previous owner when a lead is reassigned away from them.
    Uses `/crm/leads` (without `?leadId=`) so clicking never triggers a 403 error
    after ownership transfer removes their visibility to the lead.
    """
    if not previous_owner_id:
        return
    if actor_id and previous_owner_id == actor_id:
        return

    code_prefix = f"{lead_code} — " if lead_code else ""
    to_suffix = f" to {new_owner_name.strip()}" if new_owner_name and new_owner_name.strip() else ""
    reason_suffix = f" Reason: {reason.strip()}" if reason and reason.strip() else ""

    await send_isolated_crm_notification(
        db,
        recipient_id=previous_owner_id,
        type="crm_lead_transferred",
        title="Lead Reassigned Away",
        message=f"Lead {code_prefix}{lead_name} has been reassigned{to_suffix}.{reason_suffix}",
        link="/crm/leads",
        within_hours=1,
    )


async def notify_crm_batch_leads_assigned(
    db: AsyncSession,
    *,
    assignee_id: uuid.UUID,
    leads: Sequence[tuple[uuid.UUID, str | None, str]],
    batch_name: str,
    batch_id: uuid.UUID,
    actor_id: Optional[uuid.UUID] = None,
    actor_name: Optional[str] = None,
) -> None:
    """
    Notify a salesperson about leads assigned during a CSV import batch.
    - 1 lead assigned -> direct single-lead deep link (`/crm/leads?leadId=<id>`).
    - Multiple leads assigned -> single concise summary notification (prevents bell spam).
    """
    if not leads:
        return
    if actor_id and assignee_id == actor_id:
        return

    if len(leads) == 1:
        lead_id, lead_code, lead_name = leads[0]
        await notify_crm_lead_assigned(
            db,
            lead_id=lead_id,
            lead_code=lead_code,
            lead_name=lead_name,
            assignee_id=assignee_id,
            actor_id=actor_id,
            actor_name=actor_name,
            reassigned=False,
        )
        return

    count = len(leads)
    await send_isolated_crm_notification(
        db,
        recipient_id=assignee_id,
        type="crm_leads_batch_assigned",
        title=f"{count} New Leads Assigned",
        message=f"{count} new leads from import batch '{batch_name}' have been assigned to you.",
        link=f"/crm/leads?batch_id={batch_id}",
    )


async def notify_crm_lead_stage_changed(
    db: AsyncSession,
    *,
    lead_id: uuid.UUID,
    lead_code: str | None,
    lead_name: str,
    assignee_id: Optional[uuid.UUID],
    from_stage_name: Optional[str],
    to_stage_name: str,
    stage_type: str,
    actor_id: Optional[uuid.UUID] = None,
    actor_name: Optional[str] = None,
) -> None:
    """
    Notify relevant stakeholders on pipeline stage transitions:
    1. If someone other than the assigned salesperson transitions the lead, notify the salesperson.
    2. If the lead reaches a Won or Lost stage, notify the salesperson's active reporting manager (excluding actor).
    """
    code_prefix = f"{lead_code} — " if lead_code else ""
    by_label = actor_name.strip() if actor_name and actor_name.strip() else "a team member"
    link = f"/crm/leads?leadId={lead_id}"
    stage_kind = (stage_type or "open").strip().lower()

    # 1. Notify assigned salesperson if changed by another user
    if assignee_id and (not actor_id or assignee_id != actor_id):
        from_part = f" from '{from_stage_name}'" if from_stage_name else ""
        if stage_kind == "won":
            notif_type = "crm_lead_won"
            title = "Lead Marked Won"
        elif stage_kind == "lost":
            notif_type = "crm_lead_lost"
            title = "Lead Marked Lost"
        else:
            notif_type = "crm_lead_stage_changed"
            title = "Lead Stage Updated"

        await send_isolated_crm_notification(
            db,
            recipient_id=assignee_id,
            type=notif_type,
            title=title,
            message=f"Lead {code_prefix}{lead_name} was moved{from_part} to '{to_stage_name}' by {by_label}.",
            link=link,
            within_hours=1,
        )

    # 2. Notify reporting manager on terminal Won / Lost milestones
    if stage_kind in ("won", "lost") and assignee_id:
        owner = await db.get(User, assignee_id)
        manager_id = getattr(owner, "manager_id", None) if owner else None
        if manager_id and manager_id != actor_id and manager_id != assignee_id:
            mgr = await db.get(User, manager_id)
            if _is_notifiable_active_user(mgr):
                notif_type = "crm_lead_won" if stage_kind == "won" else "crm_lead_lost"
                title = "Deal Won" if stage_kind == "won" else "Lead Lost"
                outcome_word = "won" if stage_kind == "won" else "marked lost"
                await send_isolated_crm_notification(
                    db,
                    recipient_id=manager_id,
                    type=notif_type,
                    title=title,
                    message=f"Lead {code_prefix}{lead_name} was {outcome_word} (stage: {to_stage_name}) by {by_label}.",
                    link=link,
                    within_hours=1,
                )


async def notify_crm_follow_up_status_changed(
    db: AsyncSession,
    *,
    lead_id: uuid.UUID,
    lead_code: str | None,
    lead_name: str,
    follow_up_id: uuid.UUID,
    follow_up_type: str,
    new_status: str,
    assignee_id: Optional[uuid.UUID],
    actor_id: Optional[uuid.UUID] = None,
    actor_name: Optional[str] = None,
) -> None:
    """Notify the assigned salesperson when another user completes or cancels their follow-up."""
    if not assignee_id:
        return
    if actor_id and assignee_id == actor_id:
        return

    status_lower = (new_status or "").strip().lower()
    if status_lower not in ("completed", "cancelled"):
        return

    code_prefix = f"{lead_code} — " if lead_code else ""
    by_label = actor_name.strip() if actor_name and actor_name.strip() else "a team member"
    fu_label = (follow_up_type or "follow-up").strip().capitalize()

    notif_type = f"crm_follow_up_{status_lower}"
    title = "Follow-Up Completed" if status_lower == "completed" else "Follow-Up Cancelled"
    link = f"/crm/leads?leadId={lead_id}&drawerTab=followups"

    await send_isolated_crm_notification(
        db,
        recipient_id=assignee_id,
        type=notif_type,
        title=title,
        message=f"{fu_label} follow-up on lead {code_prefix}{lead_name} was marked {status_lower} by {by_label}.",
        link=link,
        within_hours=1,
    )


async def notify_crm_quotation_event(
    db: AsyncSession,
    *,
    lead_id: uuid.UUID,
    lead_code: str | None,
    lead_name: str,
    quotation_number: str,
    action: str,  # "created" or "status_changed"
    status_label: Optional[str] = None,
    assignee_id: Optional[uuid.UUID] = None,
    actor_id: Optional[uuid.UUID] = None,
    actor_name: Optional[str] = None,
) -> None:
    """Notify the lead's assigned salesperson when another user creates or changes status on a quotation."""
    if not assignee_id:
        return
    if actor_id and assignee_id == actor_id:
        return

    code_prefix = f"{lead_code} — " if lead_code else ""
    by_label = actor_name.strip() if actor_name and actor_name.strip() else "a team member"
    link = f"/crm/leads?leadId={lead_id}&drawerTab=quotations"

    if action == "created":
        notif_type = "crm_quotation_created"
        title = "Quotation Created"
        message = f"Sales quotation {quotation_number} was created for lead {code_prefix}{lead_name} by {by_label}."
    else:
        notif_type = "crm_quotation_status_changed"
        status_disp = (status_label or "updated").strip()
        title = f"Quotation {status_disp.capitalize()}"
        message = f"Sales quotation {quotation_number} for lead {code_prefix}{lead_name} was marked '{status_disp}' by {by_label}."

    await send_isolated_crm_notification(
        db,
        recipient_id=assignee_id,
        type=notif_type,
        title=title,
        message=message,
        link=link,
        within_hours=1,
    )
