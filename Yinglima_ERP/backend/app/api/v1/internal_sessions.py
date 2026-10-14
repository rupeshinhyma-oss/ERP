"""
Service-to-service endpoint: ERP_Main tells this ERP that ONE login (session) ended.

Every token carries a session id (`sid`).  Revoking a session id stops all of its tokens here at once, and closes the
live connections of that session.  Other sessions of the same person are untouched.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.api.v1.internal_users import require_internal_service_auth
from app.auth.dependencies import get_auth_service
from app.auth.service import AuthService
from app.core.responses import build_success_response

router = APIRouter(prefix="/internal/sessions", tags=["Internal (service credential)"])


class RevokeSessionRequest(BaseModel):
    reason: str | None = "central_logout"


@router.post("/{session_id}/revoke", summary="ERP_Main reports that one login (session) ended")
async def revoke_session(
    session_id: str,
    request: Request,
    payload: RevokeSessionRequest | None = None,
    _service: None = Depends(require_internal_service_auth),
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    await auth_service.revoke_session(session_id, reason=(payload.reason if payload else None) or "central_logout")
    return build_success_response(
        data={"session_id": session_id, "revoked": True}, request_id=getattr(request.state, "request_id", "")
    )
