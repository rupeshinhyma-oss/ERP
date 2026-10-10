"""
One password per person, shared across ERP_Main and every ERP they may use.

* ERP_Main -> ERPs: when a person's password is changed in ERP_Main, `push_password_to_memberships`
  re-provisions it into every ERP where their membership is ACTIVE (the ERP's provisioning endpoint
  already updates an existing user's password).
* ERP -> ERP_Main: an ERP that changes a password calls `POST /internal/users/password` (below); ERP_Main
  stores it centrally and fans it out to the person's OTHER ERPs.

Everything here is best-effort and never raises into the caller: a password change that succeeded where
the user made it must not fail because another ERP was asleep.  Sign-in on any ERP also falls back to a
central check, so a missed push does not lock anybody out.
"""

from __future__ import annotations

import hmac
import logging
from typing import Any

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import NotFoundException, UnauthorizedException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.global_auth.models import GlobalUserCredential
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.identity_linking.adapters.registry import get_adapter_registry
from app.platform_auth.models import PlatformAdmin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/users", tags=["Internal (service credential)"])


async def push_password_to_memberships(
    db: AsyncSession, user: GlobalUser, new_password: str, *, exclude_erp_key: str | None = None
) -> dict[str, list[str]]:
    """Push `new_password` to every ERP the user has an ACTIVE membership in. Never raises."""
    result: dict[str, list[str]] = {"synced": [], "failed": []}
    try:
        rows = (
            await db.execute(
                select(ErpInstance)
                .join(ErpMembership, ErpMembership.erp_instance_id == ErpInstance.id)
                .where(
                    ErpMembership.global_user_id == user.id,
                    ErpMembership.status == ErpMembershipStatus.ACTIVE,
                )
            )
        ).scalars().all()
    except Exception:  # pragma: no cover - defensive
        logger.exception("Could not list memberships for password push.")
        return result
    skip = (exclude_erp_key or "").strip().lower()
    for erp in rows:
        if skip and (erp.key or "").strip().lower() == skip:
            continue
        try:
            adapter = get_adapter_registry().get_adapter(erp)
            res = await adapter.provision_local_user(
                erp, email=user.primary_email, display_name=user.display_name, password=new_password
            )
            (result["synced"] if res is not None else result["failed"]).append(erp.key)
        except Exception:
            logger.warning("Password push to ERP %s failed; sign-in falls back to a central check.", erp.key)
            result["failed"].append(erp.key)
    return result


def store_central_password(db_user: GlobalUser, credential: GlobalUserCredential | None, new_password: str, db: AsyncSession):
    """Record the person's password centrally (metadata is what provisioning reads) -- no I/O, caller flushes."""
    db_user.metadata_json = {**(db_user.metadata_json or {}), "default_password": new_password}
    if credential is None:
        db.add(GlobalUserCredential(global_user_id=db_user.id, password_hash=new_password, must_change_password=False))
    else:
        credential.password_hash = new_password
        credential.must_change_password = False


class PasswordSyncRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    new_password: str = Field(..., min_length=1, max_length=256)


def _verify_erp_caller(authorization: str | None, erp_key: str | None) -> str:
    """Authenticate an ERP with the shared per-ERP service credential (same secret ERP_Main uses toward it)."""
    key = (erp_key or "").strip().lower()
    expected = settings.get_service_credential_for_erp(key) if key else ""
    presented = (authorization or "")
    presented = presented[7:].strip() if presented.lower().startswith("bearer ") else ""
    if not key or not expected or not presented or not hmac.compare_digest(presented.encode(), expected.encode()):
        raise UnauthorizedException("Invalid service credential.")
    return key


@router.post("/password", summary="An ERP reports that a user's password changed there")
async def sync_password_from_erp(
    payload: PasswordSyncRequest,
    request: Request,
    authorization: str | None = Header(default=None),
    x_erp_key: str | None = Header(default=None, alias="X-ERP-Key"),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Store the new password centrally and fan it out to the person's other ERPs (best effort)."""
    erp_key = _verify_erp_caller(authorization, x_erp_key)
    email = payload.email.strip().lower()
    user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email))
    if user is None or user.status != GlobalUserStatus.ACTIVE:
        raise NotFoundException("No active central user for that email.")

    credential = await db.scalar(select(GlobalUserCredential).where(GlobalUserCredential.global_user_id == user.id))
    store_central_password(user, credential, payload.new_password, db)
    admin = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == email))
    if admin is not None:
        admin.password_hash = payload.new_password
    await db.flush()
    await db.commit()  # persist before any network fan-out

    fanout = await push_password_to_memberships(db, user, payload.new_password, exclude_erp_key=erp_key)
    data: dict[str, Any] = {"stored": True, "pushed_to": fanout["synced"], "push_failed": fanout["failed"]}
    return build_success_response(data, request_id=getattr(request.state, "request_id", ""))
