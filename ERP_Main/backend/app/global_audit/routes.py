"""
Global Audit Log Routes.

Read-only. Entries are written internally by other services calling
`GlobalAuditService.record(...)` directly -- there is no `POST` route
here, since an audit log that could be written arbitrarily over HTTP
would not be trustworthy as an audit log.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.core.responses import build_success_response
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.models import AuditEventType
from app.global_audit.schemas import GlobalAuditLogRead
from app.global_audit.service import GlobalAuditService
from app.platform_auth.dependencies import require_platform_admin
from app.platform_auth.models import PlatformAdmin

router = APIRouter(prefix="/global/audit", tags=["Global Audit"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


@router.get("", summary="List recent control-plane audit entries")
async def list_audit_entries(
    request: Request,
    limit: int = Query(default=100, ge=1, le=1000),
    event_type: AuditEventType | None = None,
    target_id: uuid.UUID | None = None,
    _admin: PlatformAdmin = Depends(require_platform_admin),
    service: GlobalAuditService = Depends(get_global_audit_service),
) -> dict:
    """List the most recent control-plane audit entries, optionally filtered by event type or target."""
    entries = await service.list_recent(limit=limit, event_type=event_type, target_id=target_id)
    data = [GlobalAuditLogRead.model_validate(e).model_dump(mode="json") for e in entries]
    return build_success_response(data, request_id=_request_id(request))
