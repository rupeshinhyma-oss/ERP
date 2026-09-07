"""Global Audit Log Pydantic Schemas (read-only -- entries are never created via the API directly)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.global_audit.models import AuditActorType, AuditEventType


class GlobalAuditLogRead(BaseModel):
    """A single audit entry as returned by the API."""

    id: uuid.UUID
    event_type: AuditEventType
    actor_type: AuditActorType
    actor_id: uuid.UUID | None
    actor_label: str | None
    target_type: str | None
    target_id: uuid.UUID | None
    details: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}
