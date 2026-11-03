"""
Technical Task Service.

Business rules are enforced HERE (not only in the browser) so every client -- web, the future technician app,
imports -- gets identical, accurate behaviour:

* conditional required fields (third-party city, chargeable amount + payment terms, contact number)
* the status machine (Pending -> Approved -> Completed / Payment Pending, Cancel, Reopen)
* the three separate remarks (creator / approver / technician) -- completion never overwrites the approver's note
* payment rules (Free tasks never go to Payment Pending; chargeable tasks need a payment answer on completion)
* concurrency: status changes lock the row; edits honour the optimistic ``version``
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.technical_tasks.models import TechnicalTask, TechnicalTaskCallLog, TechnicalTaskLog
from app.technical_tasks.repository import TechnicalTaskRepository, invalidate_counts_cache
from app.technical_tasks.schemas import (
    TechnicalTaskCallLogCreate,
    TechnicalTaskCreate,
    TechnicalTaskStatusUpdate,
    TechnicalTaskUpdate,
)

logger = logging.getLogger(__name__)

PENDING, APPROVED, PAYMENT_PENDING, COMPLETED, CANCEL = "Pending", "Approved", "Payment Pending", "Completed", "Cancel"

# current status -> statuses it may move to (same-status is allowed for Pending/Approved: edit / re-allot).
_TRANSITIONS: dict[str, set[str]] = {
    PENDING: {PENDING, APPROVED, CANCEL},
    APPROVED: {APPROVED, PENDING, COMPLETED, PAYMENT_PENDING, CANCEL},
    PAYMENT_PENDING: {COMPLETED, CANCEL},
    COMPLETED: set(),
    CANCEL: {APPROVED, PENDING},
}

# Fields that only the status workflow may change -- never writable through create / generic edit.
_WORKFLOW_FIELDS = (
    "status", "task_approved_by", "task_approved_date", "approver_remarks", "technician_remarks", "cancel_remarks",
    "completed_date", "payment_status", "payment_mode", "payment_screenshot", "collected_amount",
)


# Fields re-validated and re-persisted when an edit / approval override can change what depends on them.
_NORMALISED_FIELDS = (
    "third_party", "third_party_city", "third_party_contact_name", "third_party_contact_phone",
    "scheduled_visit_date", "service_charge", "payment_terms", "priority",
)
_APPROVER_OVERRIDES = ("task_type", "service_type", "service_charge", "payment_terms")


def canonical_status(raw: str | None) -> str:
    """Map any stored/requested spelling to Pending / Approved / Payment Pending / Completed / Cancel."""
    key = (raw or "").strip().lower().replace("_", " ")
    return {
        "pending": PENDING, "approved": APPROVED, "payment pending": PAYMENT_PENDING,
        "completed": COMPLETED, "cancel": CANCEL, "cancelled": CANCEL,
    }.get(key, (raw or "").strip().capitalize())


def _is_chargeable(service_type: str | None) -> bool:
    return (service_type or "").strip().lower() == "chargeable"


def _is_third_party(task_type: str | None) -> bool:
    t = (task_type or "").lower()
    return "third" in t and "party" in t


def _is_onsite(task_type: str | None) -> bool:
    return "onsite" in (task_type or "").lower() or "on-site" in (task_type or "").lower()


def validate_business_rules(data: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalise a full task dict (create, or existing task merged with an edit)."""
    if not (data.get("company_name") or "").strip():
        raise BadRequestException("Company Name is required.")
    if not (data.get("contact_phone") or "").strip():
        raise BadRequestException("Contact Number is required.")
    if not (data.get("task_type") or "").strip():
        raise BadRequestException("Task Type is required.")
    if not (data.get("machine_model") or "").strip():
        raise BadRequestException("Machine & Model is required.")
    if not (data.get("task_description") or "").strip():
        raise BadRequestException("Description (Nature of Complaint) is required.")
    if not (data.get("service_type") or "").strip():
        raise BadRequestException("Service Type is required.")
    if not (data.get("call_type") or "").strip():
        raise BadRequestException("Call Type is required.")

    if _is_third_party(data.get("task_type")):
        if not (data.get("third_party_city") or "").strip():
            raise BadRequestException("Third-Party City is required for Onsite Visit - Third-Party Location.")
    else:
        data["third_party"] = data["third_party_city"] = None
        data["third_party_contact_name"] = data["third_party_contact_phone"] = None

    if not _is_onsite(data.get("task_type")):
        data["scheduled_visit_date"] = None

    if _is_chargeable(data.get("service_type")):
        charge = data.get("service_charge")
        if charge is None or Decimal(str(charge)) <= 0:
            raise BadRequestException("Amount is required (and must be greater than 0) for chargeable tasks.")
        if not (data.get("payment_terms") or "").strip():
            raise BadRequestException("Payment Terms are required for chargeable tasks.")
    else:
        data["service_charge"] = None
        data["payment_terms"] = None

    if data.get("priority"):
        data["priority"] = str(data["priority"]).strip().upper()
    return data


class TechnicalTaskService:
    """Business logic for TechnicalTask lifecycle."""

    def __init__(self, repository: TechnicalTaskRepository) -> None:
        self.repository = repository

    async def get_by_id(self, task_id: uuid.UUID) -> TechnicalTask:
        task = await self.repository.get_by_id(task_id)
        if not task:
            raise NotFoundException(f"Technical task {task_id} not found.")
        return task

    async def resolve_task(self, task_ref: str | uuid.UUID, **scope: Any) -> TechnicalTask:
        """Resolve a technical task by UUID ``id`` or sequential ``task_number``."""
        task = await self.repository.get_by_ref(task_ref, **scope)
        if not task:
            raise NotFoundException(f"Technical task {task_ref} not found.")
        return task

    async def get_counts(self, **scope: Any) -> dict[str, int]:
        return await self.repository.get_counts(**scope)

    async def get_payment_summary(self, **scope: Any) -> dict[str, Any]:
        return await self.repository.get_payment_summary(**scope)

    async def list_tasks(self, **kwargs: Any) -> tuple[list[TechnicalTask], int]:
        return await self.repository.list_tasks(**kwargs)

    # ------------------------------------------------------------------ create / edit
    async def create(
        self, payload: TechnicalTaskCreate, creator_name: str = "Admin", creator_user_id: uuid.UUID | None = None
    ) -> TechnicalTask:
        data = payload.model_dump()
        for field in _WORKFLOW_FIELDS:  # a new task always starts clean in Pending
            data[field] = None
        data["status"] = PENDING
        data["created_by_name"] = creator_name or data.get("created_by_name") or "Admin"
        data["created_by_user_id"] = creator_user_id
        data["task_created_date"] = data.get("task_created_date") or date.today()
        validate_business_rules(data)
        task = await self.repository.create(**data)
        await self.repository.create_task_log(
            task_id=task.id,
            updated_by=task.created_by_name or "Admin",
            title="Create Technical Task",
            status=PENDING,
            created_at=task.created_at,
        )
        invalidate_counts_cache()
        return task

    async def update(
        self, task_id: uuid.UUID, payload: TechnicalTaskUpdate, user_name: str | None = None, privileged: bool = True
    ) -> TechnicalTask:
        task = await self.repository.get_for_update(task_id)
        if not task:
            raise NotFoundException(f"Technical task {task_id} not found.")
        updates = payload.model_dump(exclude_unset=True)
        expected_version = updates.pop("version", None)

        if canonical_status(task.status) in (COMPLETED, CANCEL, PAYMENT_PENDING):
            raise BadRequestException(
                f"A {canonical_status(task.status)} task cannot be edited. Reopen it first if changes are needed."
            )
        # Workflow doc: at Approved stage "Edit" is admin level (admin, or the approver of this task).
        if canonical_status(task.status) == APPROVED and not (
            privileged or (user_name and user_name == task.task_approved_by)
        ):
            raise ForbiddenException("Only an admin or the approver can edit an approved task.")

        # Workflow-owned fields (status, approval, payment, remarks of other roles) are changed only through the
        # status endpoint; an edit form that echoes them back must not be able to rewrite them.
        for field in (*_WORKFLOW_FIELDS, "created_by_name", "task_created_date", "created_by_user_id"):
            updates.pop(field, None)

        merged = {c.key: getattr(task, c.key) for c in TechnicalTask.__table__.columns if c.key != "status_rank"}
        merged.update(updates)
        validate_business_rules(merged)
        # Persist only what validation may have normalised plus the caller's own changes.
        final = {k: merged[k] for k in set(updates) | set(_NORMALISED_FIELDS)}
        result = await self.repository.update(task, expected_version=expected_version, **final)
        await self.repository.create_task_log(
            task_id=result.id,
            updated_by=user_name or "Admin",
            title="Update Technical Task",
            status=canonical_status(result.status),
        )
        invalidate_counts_cache()
        return result

    # ------------------------------------------------------------------ status workflow
    async def update_status(
        self,
        task_id: uuid.UUID,
        payload: TechnicalTaskStatusUpdate,
        user_name: str | None = None,
        privileged: bool = True,
    ) -> TechnicalTask:
        task = await self.repository.get_for_update(task_id)  # row lock: concurrent changes queue up
        if not task:
            raise NotFoundException(f"Technical task {task_id} not found.")

        current = canonical_status(task.status)
        target = canonical_status(payload.status)
        if target not in _TRANSITIONS.get(current, set()) and not (current == target and target in (PENDING, APPROVED)):
            raise BadRequestException(f"A {current} task cannot be moved to {target}.")

        actor = user_name or "Admin"
        remarks = (payload.remarks or "").strip()
        updates: dict[str, Any] = {"status": target}
        logs: list[tuple[str, str]] = []
        reopening = current == CANCEL and target in (APPROVED, PENDING)
        if reopening and not (privileged or not task.task_approved_by or task.task_approved_by == user_name):
            # Workflow doc: only the admin and the task approver can reopen / reassign a cancelled task.
            raise ForbiddenException("Only an admin or the task approver can reopen a cancelled task.")

        if target == APPROVED:
            allotted = (payload.task_allotted_to or task.task_allotted_to or "").strip()
            if not allotted:
                raise BadRequestException("Select the technician (Task Allotted To) before approving a task.")
            updates["task_allotted_to"] = allotted
            updates["task_approved_by"] = payload.task_approved_by or user_name or task.task_approved_by or "Manager"
            updates["task_approved_date"] = payload.task_approved_date or date.today()
            if payload.scheduled_visit_date:
                updates["scheduled_visit_date"] = payload.scheduled_visit_date
            if remarks:
                updates["approver_remarks"] = remarks
            if reopening:
                updates["cancel_remarks"] = None
                msg = f"Task reopened and reassigned to {allotted}."
                logs.append(("Reopen / Reassign", msg + (f" Remarks: {remarks}" if remarks else "")))

            # Approver may override Task Type / Service Type / Amount / Payment Terms set by the creator.
            overrides = {k: getattr(payload, k) for k in _APPROVER_OVERRIDES if getattr(payload, k) is not None}
            if overrides:
                merged = {c.key: getattr(task, c.key) for c in TechnicalTask.__table__.columns if c.key != "status_rank"}
                merged.update(updates)
                merged.update(overrides)
                validate_business_rules(merged)  # same rules as create (e.g. Chargeable needs amount + terms)
                changed = [k for k in _APPROVER_OVERRIDES if k in overrides and merged[k] != getattr(task, k)]
                for key in set(overrides) | set(_NORMALISED_FIELDS):
                    updates[key] = merged[key]
                if changed:
                    logs.append(("Approver Override", "Approver changed: " + ", ".join(
                        f"{k.replace('_', ' ')} -> {merged[k]}" for k in changed)))

        elif target == PENDING:
            if payload.task_allotted_to:
                updates["task_allotted_to"] = payload.task_allotted_to
            if remarks:
                updates["approver_remarks"] = remarks
            if reopening:
                updates["cancel_remarks"] = None
                logs.append(("Reopen", "Task reopened to Pending queue." + (f" Remarks: {remarks}" if remarks else "")))

        elif target == CANCEL:
            reason = (payload.cancel_remarks or payload.remarks or "").strip()
            if not reason:
                raise BadRequestException("Cancellation remarks are strictly mandatory when cancelling a technical task.")
            updates["cancel_remarks"] = reason
            logs.append(("Cancellation", f"Task cancelled. Reason: {reason}"))

        was_paid = (task.payment_status or "").strip().lower() == "paid"
        if target in (COMPLETED, PAYMENT_PENDING):
            updates.update(self._completion_updates(task, current, target, payload, remarks))
            target = updates["status"]
            if remarks:
                logs.append(("Completion", remarks))  # technician remark shows in the call-log history
            if target == PAYMENT_PENDING:
                logs.append(("Payment Pending", "Work completed; payment not yet collected."))
            elif _is_chargeable(task.service_type) and updates.get("payment_status") == "Paid":
                amt = updates.get("collected_amount")
                logs.append(("Payment Collected", f"Collected {amt} via {updates.get('payment_mode') or '-'}."))

        for log_type, log_remarks in logs:
            await self.repository.create_call_log(
                task_id=task.id, call_date=date.today(), call_type=log_type, remarks=log_remarks, created_by=actor
            )
        result = await self.repository.update(task, expected_version=task.version, **updates)
        if (
            not was_paid
            and updates.get("payment_status") == "Paid"
            and (updates.get("payment_mode") or "").strip().lower() == "self collect"
            and updates.get("collected_amount")
        ):
            await self._sync_self_collect_wallet(
                task=result,
                amount=Decimal(str(updates["collected_amount"])),
                payment_date=updates.get("completed_date") or date.today(),
                reference_no=None,
                receipt_url=updates.get("payment_screenshot"),
                notes=remarks or f"Self-collected on task completion ({result.company_name})",
                actor=actor,
            )
        final_status = canonical_status(result.status)
        if reopening:
            task_log_title = "Reopen Technical Task"
        elif final_status == APPROVED:
            task_log_title = "Approve Technical Task" if current != APPROVED else "Update Technical Task"
        elif final_status == COMPLETED:
            task_log_title = "Complete Technical Task"
        elif final_status == PAYMENT_PENDING:
            task_log_title = "Task Payment Pending"
        elif final_status == CANCEL:
            task_log_title = "Cancel Technical Task"
        else:
            task_log_title = "Update Technical Task"
        await self.repository.create_task_log(
            task_id=result.id,
            updated_by=actor,
            title=task_log_title,
            status=final_status,
        )
        invalidate_counts_cache()
        return result

    async def record_payment(
        self,
        task_id: uuid.UUID,
        amount: Decimal,
        payment_mode: str,
        payment_date: date | None = None,
        reference_no: str | None = None,
        payment_screenshot: str | None = None,
        remarks: str | None = None,
        user_name: str | None = None,
    ) -> TechnicalTask:
        task = await self.get_by_id(task_id)
        if not task:
            raise NotFoundException(f"Technical task {task_id} not found.")

        current_collected = task.collected_amount or Decimal(0)
        new_collected = current_collected + amount
        updates: dict[str, Any] = {
            "collected_amount": new_collected,
            "payment_mode": payment_mode,
        }
        if payment_screenshot:
            updates["payment_screenshot"] = payment_screenshot

        target_charge = task.service_charge or Decimal(0)
        if target_charge > 0 and new_collected >= target_charge:
            updates["payment_status"] = "Paid"
            if canonical_status(task.status) == PAYMENT_PENDING:
                updates["status"] = COMPLETED
                if not task.completed_date:
                    updates["completed_date"] = payment_date or date.today()
        else:
            updates["payment_status"] = "Pending"

        log_remarks = f"Collected ₹{amount:,.2f} via {payment_mode}."
        if reference_no:
            log_remarks += f" Ref: {reference_no}."
        if remarks:
            log_remarks += f" Remarks: {remarks}."

        await self.repository.create_call_log(
            task_id=task.id,
            call_date=payment_date or date.today(),
            call_type="Payment Collected",
            remarks=log_remarks,
            created_by=user_name or "Accounts",
        )
        result = await self.repository.update(task, expected_version=task.version, **updates)
        if payment_mode.strip().lower() == "self collect" and amount > 0:
            await self._sync_self_collect_wallet(
                task=result,
                amount=amount,
                payment_date=payment_date or date.today(),
                reference_no=reference_no,
                receipt_url=payment_screenshot,
                notes=remarks or f"Self-collected payment ({result.company_name})",
                actor=user_name or "Accounts",
            )
        await self.repository.create_task_log(
            task_id=result.id,
            updated_by=user_name or "Accounts",
            title="Record Task Payment",
            status=canonical_status(result.status),
        )
        invalidate_counts_cache()
        return result

    async def _sync_self_collect_wallet(
        self,
        *,
        task: TechnicalTask,
        amount: Decimal,
        payment_date: date,
        reference_no: str | None,
        receipt_url: str | None,
        notes: str | None,
        actor: str,
    ) -> None:
        """Auto-post Self collect task payments into Technician Wallet Ledger (COLLECTION)."""
        try:
            from sqlalchemy import func, select
            from app.technician_operations.models import TechnicianWalletTransaction

            tech_name = (task.task_allotted_to or actor or "Technician").strip()
            async with self.repository.session.begin_nested():
                year = payment_date.year
                count_res = await self.repository.session.execute(select(func.count(TechnicianWalletTransaction.id)))
                next_seq = (count_res.scalar() or 0) + 1
                txn_num = f"TXN-TECH-{year}-{next_seq:04d}-{uuid.uuid4().hex[:4].upper()}"
                txn = TechnicianWalletTransaction(
                    transaction_number=txn_num,
                    technician_id=None,
                    technician_name=tech_name,
                    technical_task_id=task.id,
                    customer_name=task.company_name,
                    transaction_type="COLLECTION",
                    amount=float(amount),
                    payment_mode="Self collect",
                    reference_no=(reference_no or "").strip() or None,
                    transaction_date=payment_date,
                    receipt_url=receipt_url,
                    status="VERIFIED",
                    verified_by=actor,
                    verified_at=datetime.now(timezone.utc),
                    notes=notes,
                )
                self.repository.session.add(txn)
                await self.repository.session.flush()
        except Exception as exc:
            logger.warning("Could not auto-sync Self collect wallet entry for task %s: %s", task.id, exc)

    def _completion_updates(
        self, task: TechnicalTask, current: str, target: str, payload: TechnicalTaskStatusUpdate, remarks: str
    ) -> dict[str, Any]:
        """Server-side completion / payment rules. Returns the column updates (including the final status)."""
        if current not in (APPROVED, PAYMENT_PENDING):
            raise BadRequestException("Only an Approved task can be completed.")
        updates: dict[str, Any] = {}
        if not task.completed_date:
            updates["completed_date"] = payload.completed_date or date.today()
        if remarks:
            updates["technician_remarks"] = remarks  # never overwrites the approver's remarks

        if not _is_chargeable(task.service_type):
            if target == PAYMENT_PENDING:
                raise BadRequestException("A Free task has no payment, so it cannot be set to Payment Pending.")
            updates.update(status=COMPLETED, payment_status=None, payment_mode=None, payment_screenshot=None, collected_amount=None)
            return updates

        collected = payload.payment_collected
        if collected is None:
            collected = (payload.payment_status or "").strip().lower() == "paid"
        if target == PAYMENT_PENDING:
            collected = False
        if not collected:
            updates.update(status=PAYMENT_PENDING, payment_status="Pending")
            return updates

        mode = (payload.payment_mode or task.payment_mode or "").strip()
        if not mode:
            raise BadRequestException("Payment mode (Company Acc / Self collect) is required when payment is collected.")
        amount = payload.collected_amount if payload.collected_amount is not None else task.service_charge
        if amount is None or Decimal(str(amount)) <= 0:
            raise BadRequestException("Collected amount is required when payment is collected.")
        updates.update(
            status=COMPLETED, payment_status="Paid", payment_mode=mode, collected_amount=amount,
            payment_screenshot=payload.payment_screenshot or task.payment_screenshot,
        )
        return updates

    # ------------------------------------------------------------------ serial lookup
    async def lookup_serial(self, serial_number: str) -> dict[str, Any]:
        """Look up machine info, warranty details, and past service tasks by machine serial number."""
        clean_sn = serial_number.strip()
        if not clean_sn:
            raise BadRequestException("Serial number is required for lookup.")

        past_tasks = await self.repository.find_by_serial(clean_sn)
        past_tasks_data = [
            {
                "id": str(t.id),
                "company_name": t.company_name,
                "task_created_date": t.task_created_date.isoformat() if t.task_created_date else None,
                "task_type": t.task_type,
                "call_type": t.call_type,
                "status": t.status,
                "machine_model": t.machine_model,
                "technician": t.task_allotted_to,
                "task_description": t.task_description,
            }
            for t in past_tasks
        ]

        info: dict[str, Any] = {}
        try:
            from sqlalchemy import func, select
            from app.technician_operations.models import MachineWarranty

            stmt = select(MachineWarranty).where(
                func.upper(MachineWarranty.serial_number) == clean_sn.upper(),
                MachineWarranty.deleted_at.is_(None),
            ).limit(1)
            # SAVEPOINT: a failure here must not poison the surrounding transaction (Postgres aborts it otherwise).
            async with self.repository.session.begin_nested():
                warranty = (await self.repository.session.execute(stmt)).scalars().first()
            if warranty:
                info = {
                    "machine_model": warranty.machine_model, "company_name": warranty.company_name,
                    "city": warranty.installation_city, "contact_person": warranty.contact_person,
                    "contact_phone": warranty.contact_phone, "warranty_status": warranty.status,
                    "warranty_end_date": warranty.warranty_end_date, "invoice_number": warranty.invoice_number,
                    "invoice_date": warranty.invoice_date,
                }
        except Exception:
            logger.exception("Warranty lookup failed for serial %s; continuing with task history only", clean_sn)

        if past_tasks:
            latest = past_tasks[0]
            info.setdefault("machine_model", latest.machine_model)
            info.setdefault("company_name", latest.company_name)
            info.setdefault("city", latest.city)
            info.setdefault("contact_person", latest.contact_person_name)
            info.setdefault("contact_phone", latest.contact_phone)
            for key, fallback in (
                ("machine_model", latest.machine_model), ("company_name", latest.company_name), ("city", latest.city),
                ("contact_person", latest.contact_person_name), ("contact_phone", latest.contact_phone),
            ):
                if not info.get(key):
                    info[key] = fallback

        return {
            "serial_number": clean_sn,
            "machine_model": info.get("machine_model"),
            "company_name": info.get("company_name"),
            "city": info.get("city"),
            "contact_person": info.get("contact_person"),
            "contact_phone": info.get("contact_phone"),
            "warranty_status": info.get("warranty_status"),
            "warranty_end_date": info.get("warranty_end_date"),
            "invoice_number": info.get("invoice_number"),
            "invoice_date": info.get("invoice_date"),
            "past_tasks_count": len(past_tasks),
            "past_tasks": past_tasks_data,
        }

    async def delete(self, task_id: uuid.UUID, privileged: bool = True) -> None:
        task = await self.get_by_id(task_id)
        if canonical_status(task.status) != PENDING and not privileged:
            raise ForbiddenException("Only an admin can delete a task that is no longer Pending.")
        await self.repository.delete(task)
        invalidate_counts_cache()

    async def bulk_delete(self, ids: list[uuid.UUID], privileged: bool = True) -> int:
        deleted = await self.repository.bulk_soft_delete(ids, only_pending=not privileged)
        invalidate_counts_cache()
        return deleted

    async def add_call_log(
        self, task_ref: str | uuid.UUID, payload: TechnicalTaskCallLogCreate, creator_name: str, **scope: Any
    ) -> TechnicalTaskCallLog:
        """Log a call or physical visit for a task."""
        task = await self.resolve_task(task_ref, **scope)
        return await self.repository.create_call_log(
            task_id=task.id,
            call_date=payload.call_date or date.today(),
            call_type=payload.call_type or "Telecall",
            remarks=payload.remarks,
            created_by=creator_name,
        )

    async def list_call_logs(self, task_ref: str | uuid.UUID, **scope: Any) -> list[TechnicalTaskCallLog]:
        task = await self.resolve_task(task_ref, **scope)
        return await self.repository.list_call_logs(task.id)

    async def list_task_logs(self, task_ref: str | uuid.UUID, **scope: Any) -> list[TechnicalTaskLog]:
        """Return lifecycle Task Log Summary entries for a task (synthesizing baseline creation if absent)."""
        task = await self.resolve_task(task_ref, **scope)
        logs = await self.repository.list_task_logs(task.id)
        if logs:
            return logs
        return [
            TechnicalTaskLog(
                id=task.id,
                task_id=task.id,
                updated_by=task.created_by_name or "Admin",
                title="Create Technical Task",
                status="Pending",
                created_at=task.created_at or datetime.now(timezone.utc),
            )
        ]

    async def call_log_report(self, **kwargs: Any) -> tuple[list[dict[str, Any]], int]:
        return await self.repository.call_log_report(**kwargs)

    async def monthly_summary(self, months: int = 12, **scope: Any) -> dict[str, Any]:
        """Open vs Closed month-wise: tasks raised and completed per month, plus the current open/closed split."""
        series = await self.repository.monthly_summary(months, **scope)
        counts = await self.repository.get_counts(**scope)
        open_now = counts["pending"] + counts["approved"] + counts["payment_pending"]
        closed_now = counts["completed"] + counts["cancel"]
        return {"months": series, "open_now": open_now, "closed_now": closed_now}