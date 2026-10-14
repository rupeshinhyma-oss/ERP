"""
Server-to-server session endpoints used by the ERPs (service credential, never a browser).

* POST /internal/sessions/open            an ERP authenticated a person locally: open their ONE central session.
* POST /internal/sessions/{sid}/signout   a person signed out at an ERP: end that session everywhere.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenException, NotFoundException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.global_auth import ecosystem_session as es
from app.global_auth.session_ops import create_session_row, ensure_admin_mirror_user
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.global_users.password_sync import _verify_erp_caller
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/sessions", tags=["Internal (service credential)"])


class OpenSessionRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)


@router.post("/open", summary="An ERP authenticated a person: open their central session")
async def open_session_for_erp(
    payload: OpenSessionRequest,
    request: Request,
    authorization: str | None = Header(default=None),
    x_erp_key: str | None = Header(default=None, alias="X-ERP-Key"),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    The calling ERP has just verified this person's password itself.  ERP_Main only has to decide whether the person
    may use THAT ERP (admin: always; other users: an ACTIVE membership) and, if so, create the session whose id
    will be embedded in every token of this login.  Refused (403) -> the ERP falls back to a clearly labelled local
    session, so a central problem never blocks a legitimate login.
    """
    erp_key = _verify_erp_caller(authorization, x_erp_key)
    email = payload.email.strip().lower()
    admin = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == email))
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")

    if admin is not None and admin.is_active:
        mirror = await ensure_admin_mirror_user(db, admin)
        row = await create_session_row(db, mirror.id, ip=ip, user_agent=ua)
        user_type, role, display_name, allowed = (
            "platform_admin",
            "super_admin" if admin.role == PlatformAdminRole.SUPER_ADMIN else "admin",
            admin.display_name or "Super Admin",
            ["*"],
        )
    else:
        user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email))
        if user is None or user.status != GlobalUserStatus.ACTIVE:
            raise NotFoundException("No active central user for that email.")
        allowed_keys = await es._active_erp_keys(db, user.id)
        if erp_key not in allowed_keys:
            raise ForbiddenException("This person has no active access grant for that ERP.")
        row = await create_session_row(db, user.id, ip=ip, user_agent=ua)
        meta_role = (user.metadata_json or {}).get("role")
        user_type, role, display_name = "global_user", (meta_role.lower() if meta_role else "global_user"), (
            user.display_name or user.primary_email
        )
        allowed = allowed_keys + [es._CONTROL_PLANE_KEY]
    await db.commit()

    session_id = str(row.id)
    data = {
        "active": True,
        "session_id": session_id,
        "email": email,
        "display_name": display_name,
        "role": role,
        "user_type": user_type,
        "allowed_erps": allowed,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": row.expires_at.isoformat(),
        "revoked_at": None,
    }
    es._prune_store(datetime.now(timezone.utc))
    es._ECOSYSTEM_SESSION_STORE[session_id] = {**data, "_checked_at": time.monotonic()}
    return build_success_response(data, request_id=getattr(request.state, "request_id", ""))


@router.post("/{session_id}/signout", summary="A person signed out at an ERP: end that session everywhere")
async def signout_session_from_erp(
    session_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
    x_erp_key: str | None = Header(default=None, alias="X-ERP-Key"),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Server-to-server twin of the browser's central sign-out (works even if the browser never reaches ERP_Main)."""
    _verify_erp_caller(authorization, x_erp_key)
    summary = await es.sign_out_session(db, session_id)
    return build_success_response(summary, request_id=getattr(request.state, "request_id", ""))
