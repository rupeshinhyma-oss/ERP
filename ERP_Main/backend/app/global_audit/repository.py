"""Global Audit Log Repository -- pure DB access, append-only."""

from __future__ import annotations

import uuid

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.global_audit.models import AuditEventType, GlobalAuditLog


class GlobalAuditRepository:
    """Data access for the `global_audit_logs` table. No update/delete methods exist -- append-only."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def create(self, entry: GlobalAuditLog) -> GlobalAuditLog:
        """Persist a new audit entry and flush so its generated id is available."""
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry)
        return entry

    async def list_recent(
        self,
        *,
        limit: int = 100,
        event_type: AuditEventType | None = None,
        target_id: uuid.UUID | None = None,
    ) -> list[GlobalAuditLog]:
        """List the most recent audit entries, optionally filtered by event type and/or target."""
        stmt = select(GlobalAuditLog).order_by(desc(GlobalAuditLog.created_at)).limit(limit)
        if event_type is not None:
            stmt = stmt.where(GlobalAuditLog.event_type == event_type)
        if target_id is not None:
            stmt = stmt.where(GlobalAuditLog.target_id == target_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
