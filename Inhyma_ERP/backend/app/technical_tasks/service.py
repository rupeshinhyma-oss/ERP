"""
Technical Task Service.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.core.exceptions import BadRequestException, NotFoundException
from app.technical_tasks.models import TechnicalTask, TechnicalTaskCallLog
from app.technical_tasks.repository import TechnicalTaskRepository
from app.technical_tasks.schemas import (
    TechnicalTaskCallLogCreate,
    TechnicalTaskCreate,
    TechnicalTaskStatusUpdate,
    TechnicalTaskUpdate,
)


class TechnicalTaskService:
    """Business logic for TechnicalTask lifecycle."""

    def __init__(self, repository: TechnicalTaskRepository) -> None:
        self.repository = repository

    async def get_by_id(self, task_id: uuid.UUID) -> TechnicalTask:
        task = await self.repository.get_by_id(task_id)
        if not task:
            raise NotFoundException(f"Technical task {task_id} not found.")
        return task

    async def get_counts(self) -> dict[str, int]:
        return await self.repository.get_counts()

    async def list_tasks(
        self,
        *,
        tab: str | None = None,
        search: str | None = None,
        serial_number: str | None = None,
        city: str | None = None,
        task_type: str | None = None,
        call_type: str | None = None,
        service_type: str | None = None,
        priority: str | None = None,
        technician: str | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[TechnicalTask], int]:
        return await self.repository.list_tasks(
            tab=tab,
            search=search,
            serial_number=serial_number,
            city=city,
            task_type=task_type,
            call_type=call_type,
            service_type=service_type,
            priority=priority,
            technician=technician,
            sort_by=sort_by,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )

    async def create(self, payload: TechnicalTaskCreate, creator_name: str = "Admin") -> TechnicalTask:
        data = payload.model_dump()
        if not data.get("created_by_name"):
            data["created_by_name"] = creator_name
        if not data.get("task_created_date"):
            data["task_created_date"] = date.today()

        return await self.repository.create(**data)

    async def update(self, task_id: uuid.UUID, payload: TechnicalTaskUpdate) -> TechnicalTask:
        task = await self.get_by_id(task_id)
        updates = payload.model_dump(exclude_unset=True)
        if updates.get("status") and str(updates["status"]).lower() in ("cancel", "cancelled"):
            cancel_rem = (updates.get("cancel_remarks") or "").strip()
            if not cancel_rem:
                raise BadRequestException("Cancellation remarks are strictly mandatory when cancelling a technical task.")
        return await self.repository.update(task, **updates)

    async def update_status(
        self, task_id: uuid.UUID, payload: TechnicalTaskStatusUpdate, user_name: str | None = None
    ) -> TechnicalTask:
        task = await self.get_by_id(task_id)
        raw_status = payload.status.strip()
        if raw_status.lower().replace("_", " ") == "payment pending":
            new_status = "Payment Pending"
        elif raw_status.lower() in ("cancel", "cancelled"):
            new_status = "Cancel"
        else:
            new_status = raw_status.capitalize()

        updates: dict = {"status": new_status}
        if payload.task_allotted_to:
            updates["task_allotted_to"] = payload.task_allotted_to
        if payload.payment_status:
            updates["payment_status"] = payload.payment_status

        # Detect reopening from Cancelled state
        is_reopening = task.status in ("Cancel", "Cancelled") and new_status in ("Approved", "Pending")

        if new_status == "Approved":
            updates["task_approved_by"] = payload.task_approved_by or user_name or "Manager"
            updates["task_approved_date"] = payload.task_approved_date or date.today()
            if payload.scheduled_visit_date:
                updates["scheduled_visit_date"] = payload.scheduled_visit_date
            if payload.remarks:
                updates["approver_remarks"] = payload.remarks
            if is_reopening:
                updates["cancel_remarks"] = None
                reopen_msg = f"Task reopened and reassigned to {payload.task_allotted_to or task.task_allotted_to or 'Technician'}."
                if payload.remarks:
                    reopen_msg += f" Remarks: {payload.remarks}"
                await self.repository.create_call_log(
                    task_id=task.id,
                    call_date=date.today(),
                    call_type="Reopen / Reassign",
                    remarks=reopen_msg,
                    created_by=user_name or "Admin",
                )
        elif new_status == "Completed":
            updates["completed_date"] = payload.completed_date or date.today()
            if payload.payment_mode:
                updates["payment_mode"] = payload.payment_mode
            if payload.payment_screenshot:
                updates["payment_screenshot"] = payload.payment_screenshot
            if payload.remarks:
                updates["approver_remarks"] = payload.remarks
        elif new_status == "Cancel":
            cancel_rem = (payload.cancel_remarks or payload.remarks or "").strip()
            if not cancel_rem:
                raise BadRequestException("Cancellation remarks are strictly mandatory when cancelling a technical task.")
            updates["cancel_remarks"] = cancel_rem
            await self.repository.create_call_log(
                task_id=task.id,
                call_date=date.today(),
                call_type="Cancellation",
                remarks=f"Task cancelled. Reason: {cancel_rem}",
                created_by=user_name or "Admin",
            )
        elif new_status == "Pending":
            if is_reopening:
                updates["cancel_remarks"] = None
                reopen_msg = "Task reopened to Pending queue."
                if payload.remarks:
                    reopen_msg += f" Remarks: {payload.remarks}"
                await self.repository.create_call_log(
                    task_id=task.id,
                    call_date=date.today(),
                    call_type="Reopen",
                    remarks=reopen_msg,
                    created_by=user_name or "Admin",
                )
            if payload.remarks:
                updates["approver_remarks"] = payload.remarks

        return await self.repository.update(task, **updates)

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

        model = None
        company = None
        city = None
        contact_person = None
        contact_phone = None
        w_status = None
        w_end = None
        inv_no = None
        inv_date = None

        try:
            from sqlalchemy import func, select
            from app.technician_operations.models import MachineWarranty
            stmt = select(MachineWarranty).where(
                func.upper(MachineWarranty.serial_number) == clean_sn.upper(),
                MachineWarranty.deleted_at.is_(None),
            )
            warranty = (await self.repository.session.execute(stmt)).scalars().first()
            if warranty:
                model = warranty.machine_model
                company = warranty.company_name
                city = warranty.installation_city
                contact_person = warranty.contact_person
                contact_phone = warranty.contact_phone
                w_status = warranty.status
                w_end = warranty.warranty_end_date
                inv_no = warranty.invoice_number
                inv_date = warranty.invoice_date
        except Exception:
            pass

        # Fallback to most recent task if not found in machine_warranties
        if past_tasks:
            latest_task = past_tasks[0]
            if not model:
                model = latest_task.machine_model
            if not company:
                company = latest_task.company_name
            if not city:
                city = latest_task.city
            if not contact_person:
                contact_person = latest_task.contact_person_name
            if not contact_phone:
                contact_phone = latest_task.contact_phone

        return {
            "serial_number": clean_sn,
            "machine_model": model,
            "company_name": company,
            "city": city,
            "contact_person": contact_person,
            "contact_phone": contact_phone,
            "warranty_status": w_status,
            "warranty_end_date": w_end,
            "invoice_number": inv_no,
            "invoice_date": inv_date,
            "past_tasks_count": len(past_tasks),
            "past_tasks": past_tasks_data,
        }

    async def delete(self, task_id: uuid.UUID) -> None:
        task = await self.get_by_id(task_id)
        await self.repository.delete(task)

    async def bulk_delete(self, ids: list[uuid.UUID]) -> int:
        return await self.repository.bulk_soft_delete(ids)

    async def add_call_log(
        self, task_id: uuid.UUID, payload: TechnicalTaskCallLogCreate, creator_name: str
    ) -> TechnicalTaskCallLog:
        """Log a call or physical visit for a task."""
        task = await self.get_by_id(task_id)
        return await self.repository.create_call_log(
            task_id=task.id,
            call_date=payload.call_date or date.today(),
            call_type=payload.call_type or "Telecall",
            remarks=payload.remarks,
            created_by=creator_name,
        )

    async def list_call_logs(self, task_id: uuid.UUID) -> list[TechnicalTaskCallLog]:
        await self.get_by_id(task_id)
        return await self.repository.list_call_logs(task_id)
