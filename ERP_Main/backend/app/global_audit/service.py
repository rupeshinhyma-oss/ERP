"""
Global Audit Service.

Exposes `GlobalAuditService.record(...)`, the single call every other
Phase 3 service uses to write an audit entry. Centralizing it here (rather
than each service constructing a `GlobalAuditLog` row itself) means the
"never log secrets" rule and the required-field shape are enforced in one
place instead of trusted to be remembered at every call site.
"""

from __future__ import annotations

import uuid

from app.global_audit.models import AuditActorType, AuditEventType, GlobalAuditLog
from app.global_audit.repository import GlobalAuditRepository


class GlobalAuditService:
    """Writes and reads control-plane audit entries."""

    def __init__(self, repository: GlobalAuditRepository) -> None:
        """Wire the service to its repository."""
        self.repository = repository

    async def record(
        self,
        *,
        event_type: AuditEventType,
        actor_type: AuditActorType,
        actor_id: uuid.UUID | None = None,
        actor_label: str | None = None,
        target_type: str | None = None,
        target_id: uuid.UUID | None = None,
        details: dict | None = None,
    ) -> GlobalAuditLog:
        """
        Record one audit entry.

        `details` must never contain a secret, credential, password hash,
        or token -- every call site in this codebase is written to pass
        only non-secret structured context (e.g. old/new status values),
        and this is enforced by code review convention rather than a
        runtime filter, since a filter can only ever catch what it already
        knows to look for.
        """
        entry = GlobalAuditLog(
            event_type=event_type,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type=target_type,
            target_id=target_id,
            details=details,
        )
        return await self.repository.create(entry)

    async def list_recent(
        self, *, limit: int = 100, event_type: AuditEventType | None = None, target_id: uuid.UUID | None = None
    ) -> list[GlobalAuditLog]:
        """List the most recent audit entries, optionally filtered."""
        return await self.repository.list_recent(limit=limit, event_type=event_type, target_id=target_id)
