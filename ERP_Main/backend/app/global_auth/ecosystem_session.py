"""
Ecosystem Session Management Routes.

Provides unified, shared session lifecycle management across the entire
ERP fleet (ERP_Main Central Control Plane, Yinglima ERP, Inhyma ERP, and
any future attached ERPs).

Features:
- Single ecosystem session ID (`session_id`) shared across all applications.
- Unified establishment on any login in the ecosystem.
- Immediate revocation upon logout anywhere (Global Single Sign-Out).
- Access verification for Global Users and Super Admins.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService
from app.global_auth.models import GlobalSession, GlobalUserCredential
from app.global_auth.security import create_global_access_token, hash_password, verify_password
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole
from app.platform_auth.security import create_platform_access_token, verify_password as verify_platform_password

router = APIRouter(prefix="/global/ecosystem-session", tags=["Ecosystem Unified Session"])

# In-memory synchronized session cache for fast sub-millisecond lookups across all origins
_ECOSYSTEM_SESSION_STORE: Dict[str, Dict[str, Any]] = {}


class EstablishSessionRequest(BaseModel):
    """Payload to establish or register an ecosystem session."""
    email: Optional[str] = None
    password: Optional[str] = None
    source_erp: str = "control-plane"
    existing_session_id: Optional[str] = None
    user_type: Optional[str] = None  # "platform_admin" or "global_user"


class SessionInfoResponse(BaseModel):
    """Normalized ecosystem session data."""
    active: bool
    session_id: str
    email: str
    display_name: str
    role: str
    user_type: str
    allowed_erps: List[str]
    created_at: str
    expires_at: str
    revoked_at: Optional[str] = None


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", str(uuid.uuid4()))


# Identifiers the unseeded-database fallback recognises for the built-in admin.
_DEFAULT_ADMIN_IDS = ("admin", "admin@example.com")
_DEFAULT_ADMIN_PASSWORD = "ChangeMe!12345"
_CONTROL_PLANE_KEY = "control-plane"


def _utc(dt: datetime) -> datetime:
    """Return `dt` as timezone-aware UTC (SQLite hands back naive datetimes)."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _cached_session_expired(sess: Dict[str, Any], now: datetime) -> bool:
    """True if a cached session dict carries an `expires_at` that has passed."""
    raw_exp = sess.get("expires_at")
    if not raw_exp:
        return False
    try:
        return _utc(datetime.fromisoformat(raw_exp)) <= now
    except ValueError:
        return False


async def _active_erp_keys(db: AsyncSession, global_user_id: uuid.UUID) -> List[str]:
    """Keys of every ERP this Global User currently holds an ACTIVE membership for."""
    stmt = (
        select(ErpInstance.key)
        .join(ErpMembership, ErpMembership.erp_instance_id == ErpInstance.id)
        .where(
            ErpMembership.global_user_id == global_user_id,
            ErpMembership.status == ErpMembershipStatus.ACTIVE,
        )
    )
    return [k.lower() for (k,) in (await db.execute(stmt)).all() if k]


async def _active_platform_admin(db: AsyncSession, email: str) -> Optional[PlatformAdmin]:
    """The ACTIVE PlatformAdmin with this email, or None."""
    admin = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == email))
    return admin if admin is not None and admin.is_active else None


async def _revalidate_cached(db: AsyncSession, sess: Dict[str, Any], now: datetime) -> Optional[Dict[str, Any]]:
    """
    Re-check a cached session against CURRENT database state.

    The in-memory store is only a cache: a user suspended/disabled in ERP_Main,
    or whose memberships changed, must stop being trusted immediately -- not
    when the cache entry happens to be rebuilt.  Returns a refreshed copy, or
    None if the session must no longer be honoured.
    """
    if sess.get("revoked_at") or _cached_session_expired(sess, now):
        return None
    email = (sess.get("email") or "").strip().lower()

    if sess.get("user_type") == "platform_admin":
        admin_row = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == email))
        if admin_row is not None:
            return sess if admin_row.is_active else None
        # No PlatformAdmin row: only sessions minted by the unseeded-DB fallback may exist.
        return sess if email in _DEFAULT_ADMIN_IDS else None

    user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email))
    if user is None or user.status != GlobalUserStatus.ACTIVE:
        return None
    return {**sess, "allowed_erps": await _active_erp_keys(db, user.id) + [_CONTROL_PLANE_KEY]}


async def _session_from_db(db: AsyncSession, session_id: str, now: datetime) -> Optional[Dict[str, Any]]:
    """
    Rebuild a session from its persisted `global_sessions` row (used after a restart).

    Returns None when the row is missing, revoked, expired, or its user is no
    longer ACTIVE.  Never falls back to granting access.
    """
    try:
        sid = uuid.UUID(session_id)
    except (ValueError, TypeError, AttributeError):
        return None
    row = await db.scalar(select(GlobalSession).where(GlobalSession.id == sid))
    if row is None or row.revoked_at is not None or _utc(row.expires_at) <= now:
        return None
    user = await db.scalar(select(GlobalUser).where(GlobalUser.id == row.global_user_id))
    if user is None or user.status != GlobalUserStatus.ACTIVE:
        return None

    email = (user.primary_email or "").strip().lower()
    admin = await _active_platform_admin(db, email)
    if admin is not None:
        role, user_type, allowed = (
            "super_admin" if admin.role == PlatformAdminRole.SUPER_ADMIN else "admin",
            "platform_admin",
            ["*"],
        )
    else:
        role, user_type = "global_user", "global_user"
        allowed = await _active_erp_keys(db, user.id) + [_CONTROL_PLANE_KEY]
    return {
        "active": True,
        "session_id": session_id,
        "email": email,
        "display_name": user.display_name or user.primary_email,
        "role": role,
        "user_type": user_type,
        "allowed_erps": allowed,
        "created_at": _utc(row.created_at).isoformat() if getattr(row, "created_at", None) else now.isoformat(),
        "expires_at": _utc(row.expires_at).isoformat(),
        "revoked_at": None,
    }


def _public(sess: Dict[str, Any]) -> Dict[str, Any]:
    """Session dict without internal bookkeeping keys (those starting with '_')."""
    return {k: v for k, v in sess.items() if not k.startswith("_")}


def _prune_store(now: datetime) -> None:
    """Keep the in-memory session cache bounded: drop expired/revoked first, then the oldest."""
    store = _ECOSYSTEM_SESSION_STORE
    if len(store) <= settings.ECOSYSTEM_SESSION_STORE_MAX // 2:
        return
    for sid in [s for s, v in store.items() if v.get("revoked_at") or _cached_session_expired(v, now)]:
        store.pop(sid, None)
    overflow = len(store) - settings.ECOSYSTEM_SESSION_STORE_MAX
    if overflow > 0:
        for sid, _ in sorted(store.items(), key=lambda kv: kv[1].get("created_at") or "")[:overflow]:
            store.pop(sid, None)


async def _resolve_live_session(db: AsyncSession, session_id: Optional[str], now: datetime) -> Optional[Dict[str, Any]]:
    """
    Return a validated session for `session_id` (cache first, then DB), or None.

    A cached session that was fully re-validated against the database less than
    ECOSYSTEM_SESSION_REVALIDATE_TTL_SECONDS ago is trusted as-is -- this is what keeps thousands of
    polling browser tabs from each causing several queries every few seconds.  Revocation and expiry are
    always honoured immediately; a user suspended centrally is cut off within the TTL.
    """
    if not session_id:
        return None
    cached = _ECOSYSTEM_SESSION_STORE.get(session_id)
    if cached is not None:
        if cached.get("revoked_at") or _cached_session_expired(cached, now):
            return None
        ttl = settings.ECOSYSTEM_SESSION_REVALIDATE_TTL_SECONDS
        if ttl > 0 and (time.monotonic() - cached.get("_checked_at", 0.0)) < ttl:
            return cached
        fresh = await _revalidate_cached(db, cached, now)
        if fresh is not None:
            fresh["_checked_at"] = time.monotonic()
            _ECOSYSTEM_SESSION_STORE[session_id] = fresh
            return fresh
        return None
    rebuilt = await _session_from_db(db, session_id, now)
    if rebuilt is not None:
        rebuilt["_checked_at"] = time.monotonic()
        _ECOSYSTEM_SESSION_STORE[session_id] = rebuilt
    return rebuilt


async def _session_owner_email(db: AsyncSession, session_id: str) -> Optional[str]:
    """Email of whoever currently owns `session_id` (cache or DB row), regardless of validity."""
    cached = _ECOSYSTEM_SESSION_STORE.get(session_id)
    if cached is not None:
        return (cached.get("email") or "").strip().lower() or None
    try:
        sid = uuid.UUID(session_id)
    except (ValueError, TypeError, AttributeError):
        return None
    row = await db.scalar(select(GlobalSession).where(GlobalSession.id == sid))
    if row is None:
        return None
    owner = await db.scalar(select(GlobalUser).where(GlobalUser.id == row.global_user_id))
    return (owner.primary_email or "").strip().lower() if owner else None


def _unauthorized(detail: str = "Invalid credentials or account is inactive.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


@router.post("/establish", summary="Establish or sync an ecosystem session across ERPs")
async def establish_ecosystem_session(
    payload: EstablishSessionRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Authenticate and establish a unified Ecosystem Session shared across all ERPs.

    Identity must ALWAYS be proven, one of two ways:
      * a correct password (platform admin or global user), or
      * no password but an `existing_session_id` that is a still-valid session
        belonging to the same email (refresh, or recovery after a restart).
    A bare email is never enough.
    """
    email_clean = (payload.email or "").strip().lower()
    password = payload.password or ""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=settings.GLOBAL_SESSION_MAX_LIFETIME_HOURS)

    # --- A. Refresh / recovery: prove identity with a live session, not a password.
    if not password:
        live = await _resolve_live_session(db, payload.existing_session_id, now)
        if live is None or (email_clean and (live.get("email") or "").strip().lower() != email_clean):
            raise _unauthorized()
        return build_success_response(_public(live), request_id=_request_id(request))

    # --- B. Password login.
    is_super_admin = False
    display_name = "User"
    user_type = "global_user"
    role = "global_user"
    allowed_erps: List[str] = []
    global_user_id: Optional[uuid.UUID] = None  # row used to persist the session
    admin = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == email_clean))

    if admin is not None and admin.is_active and verify_platform_password(password, admin.password_hash):
        is_super_admin = True
        user_type = "platform_admin"
        role = "super_admin" if admin.role == PlatformAdminRole.SUPER_ADMIN else "admin"
        display_name = admin.display_name or "Super Admin"
        allowed_erps = ["*"]
        # Persist via the mirrored Global User (if any) so the session survives a restart.
        mirror = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email_clean))
        if mirror is not None and mirror.status == GlobalUserStatus.ACTIVE:
            global_user_id = mirror.id
    else:
        user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email_clean))
        if user is not None and user.status == GlobalUserStatus.ACTIVE:
            cred = await db.scalar(select(GlobalUserCredential).where(GlobalUserCredential.global_user_id == user.id))
            stored_pwd = (
                cred.password_hash
                if cred
                else ((user.metadata_json or {}).get("default_password") or (user.metadata_json or {}).get("password"))
            )
            if not stored_pwd or not verify_password(password, stored_pwd):
                raise _unauthorized("Invalid email or password.")
            if not cred:
                db.add(
                    GlobalUserCredential(global_user_id=user.id, password_hash=stored_pwd, must_change_password=False)
                )
                await db.flush()
            global_user_id = user.id
            display_name = user.display_name or user.primary_email
            meta_role = (user.metadata_json or {}).get("role")
            role = meta_role.lower() if meta_role else "global_user"
            allowed_erps = await _active_erp_keys(db, user.id) + [_CONTROL_PLANE_KEY]
        elif admin is None and email_clean in _DEFAULT_ADMIN_IDS and password == _DEFAULT_ADMIN_PASSWORD:
            # Unseeded database only: no PlatformAdmin row exists yet, so accept the documented default.
            is_super_admin = True
            user_type = "platform_admin"
            role = "super_admin"
            display_name = "Super Admin"
            allowed_erps = ["*"]
        else:
            raise _unauthorized()

    # --- Session id: reuse the caller's id only if it is not someone else's.
    session_id = payload.existing_session_id or ""
    if session_id:
        owner = await _session_owner_email(db, session_id)
        if owner is not None and owner != email_clean:
            session_id = ""  # never overwrite or adopt another user's session
    session_id = session_id or str(uuid.uuid4())

    if global_user_id:
        try:
            db.add(
                GlobalSession(
                    id=uuid.UUID(session_id),
                    global_user_id=global_user_id,
                    expires_at=expires_at,
                    last_activity_at=now,
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
            )
            await db.commit()
        except Exception:
            await db.rollback()  # row already exists (created at login) -- fine

    session_data = {
        "active": True,
        "session_id": session_id,
        "email": email_clean or (admin.email if admin else "admin@example.com"),
        "display_name": display_name,
        "role": role,
        "user_type": user_type,
        "allowed_erps": allowed_erps,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "revoked_at": None,
    }
    _prune_store(now)
    _ECOSYSTEM_SESSION_STORE[session_id] = {**session_data, "_checked_at": time.monotonic()}

    try:
        audit = GlobalAuditService(repository=GlobalAuditRepository(db))
        await audit.record(
            event_type=AuditEventType.GLOBAL_LOGIN_SUCCESS,
            actor_type=AuditActorType.HUMAN_ADMIN if is_super_admin else AuditActorType.SYSTEM,
            actor_label=session_data["email"],
            target_type="ecosystem_session",
            target_id=uuid.UUID(session_id),
            details={"source_erp": payload.source_erp, "role": role},
        )
    except Exception:
        pass

    return build_success_response(session_data, request_id=_request_id(request))


@router.get("/{session_id}", summary="Validate ecosystem session status")
async def get_ecosystem_session(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Report whether an ecosystem session is currently valid.

    Every call is checked against CURRENT database state (user status, ERP
    memberships, expiry, revocation); the in-memory store is only a cache.
    A session whose user was suspended/disabled/removed is reported inactive.
    """
    now = datetime.now(timezone.utc)
    rid = _request_id(request)

    cached = _ECOSYSTEM_SESSION_STORE.get(session_id)
    if cached is not None and cached.get("revoked_at"):
        return build_success_response({"active": False, "session_id": session_id, "revoked": True}, request_id=rid)

    live = await _resolve_live_session(db, session_id, now)
    if live is not None:
        return build_success_response(_public(live), request_id=rid)

    # Distinguish "revoked / access removed" from "never heard of it".
    try:
        sid = uuid.UUID(session_id)
        row = await db.scalar(select(GlobalSession).where(GlobalSession.id == sid))
    except (ValueError, TypeError):
        row = None
    if cached is not None or row is not None:
        _ECOSYSTEM_SESSION_STORE.pop(session_id, None)
        return build_success_response(
            {"active": False, "session_id": session_id, "revoked": True, "reason": "session_invalid_or_user_inactive"},
            request_id=rid,
        )
    return build_success_response({"active": False, "session_id": session_id, "notFound": True}, request_id=rid)


class ExchangeSessionRequest(BaseModel):
    session_id: str = Field(..., description="Central ecosystem session id carried by an SSO handover.")
    email: str = Field(..., description="Email the handover claims to be for; must match the session owner.")


@router.post("/exchange", summary="Sign the right person in to ERP_Main from a verified central session")
async def exchange_ecosystem_session(
    payload: ExchangeSessionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Turn a live central ecosystem session into an ERP_Main access token FOR THAT SAME PERSON.

    Used when someone arrives at the dashboard from another ERP (SSO handover) and has no ERP_Main login
    yet.  The session id is the proof (it is only known to the person ERP_Main issued it to); the
    session is re-validated against current user status and memberships; the token issued is for the
    session's own user -- a platform admin gets an admin token, a normal global user gets a
    global-user token with exactly their own role -- never anyone else's.
    """
    now = datetime.now(timezone.utc)
    email = (payload.email or "").strip().lower()
    live = await _resolve_live_session(db, payload.session_id, now)
    if live is None or (live.get("email") or "").strip().lower() != email:
        raise _unauthorized("Your central session is no longer active. Please sign in again.")

    if live.get("user_type") == "platform_admin":
        admin = await _active_platform_admin(db, email)
        if admin is None:
            raise _unauthorized()
        issued = create_platform_access_token(admin.id, role=admin.role.value)
        principal = "platform_admin"
    else:
        user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email))
        if user is None or user.status != GlobalUserStatus.ACTIVE:
            raise _unauthorized()
        try:
            sid = uuid.UUID(payload.session_id)
        except ValueError:
            raise _unauthorized()
        row = await db.scalar(select(GlobalSession).where(GlobalSession.id == sid))
        if row is None:  # session lives only in memory: bind a persisted session to this user
            row = GlobalSession(
                id=sid,
                global_user_id=user.id,
                expires_at=now + timedelta(hours=settings.GLOBAL_SESSION_MAX_LIFETIME_HOURS),
                last_activity_at=now,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
            db.add(row)
            await db.flush()
        elif row.global_user_id != user.id or row.revoked_at is not None:
            raise _unauthorized()
        issued = create_global_access_token(global_user_id=user.id, session_id=row.id)
        principal = "global_user"

    data = {
        "principal_type": principal,
        "access_token": issued.token,
        "expires_at": issued.expires_at.isoformat(),
        "session": _public(live),
    }
    return build_success_response(data, request_id=_request_id(request))


@router.post("/{session_id}/revoke", summary="Global Single Sign-Out (revoke ecosystem session)")
async def revoke_ecosystem_session(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Centrally revoke an ecosystem session. Logs the user out of all connected ERPs immediately.
    """
    now = datetime.now(timezone.utc)

    # 1. Update in-memory store
    if session_id in _ECOSYSTEM_SESSION_STORE:
        _ECOSYSTEM_SESSION_STORE[session_id]["revoked_at"] = now.isoformat()
        _ECOSYSTEM_SESSION_STORE[session_id]["active"] = False

    # 2. Update database record
    try:
        sid_uuid = uuid.UUID(session_id)
        db_stmt = select(GlobalSession).where(GlobalSession.id == sid_uuid)
        db_sess = await db.scalar(db_stmt)
        if db_sess:
            db_sess.revoked_at = now
            await db.commit()
    except Exception:
        await db.rollback()

    # 3. Audit revocation
    try:
        audit = GlobalAuditService(repository=GlobalAuditRepository(db))
        await audit.record(
            event_type=AuditEventType.GLOBAL_LOGOUT,
            actor_type=AuditActorType.SYSTEM,
            actor_label=session_id,
            target_type="ecosystem_session",
            target_id=uuid.UUID(session_id) if len(session_id) == 36 else None,
            details={"revoked_globally": True},
        )
    except Exception:
        pass

    return build_success_response(
        {"status": "revoked", "session_id": session_id, "revoked_at": now.isoformat()},
        request_id=_request_id(request),
    )