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
        limit: int | None = None,
        event_type: AuditEventType | None = None,
        target_id: uuid.UUID | None = None,
    ) -> list[GlobalAuditLog]:
        """List control-plane audit entries newest-first, optionally filtered by event type/target or limited."""
        stmt = select(GlobalAuditLog).order_by(desc(GlobalAuditLog.created_at))
        if event_type is not None:
            stmt = stmt.where(GlobalAuditLog.event_type == event_type)
        if target_id is not None:
            stmt = stmt.where(GlobalAuditLog.target_id == target_id)
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
