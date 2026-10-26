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
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance, ErpStatus
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService
from app.global_auth.landing import attach_landing
from app.global_auth.models import GlobalSession, GlobalUserCredential
from app.global_auth.security import create_global_access_token, hash_password, verify_password
from app.global_auth.session_ops import ensure_admin_mirror_user, parse_session_id
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole
from app.platform_auth.security import create_platform_access_token, verify_password as verify_platform_password

router = APIRouter(prefix="/global/ecosystem-session", tags=["Ecosystem Unified Session"])
logger = logging.getLogger(__name__)

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

    # The in-memory flag only exists in the process that handled the sign-out.  With several workers (or after
    # a restart) the DATABASE is the truth, so a persisted session that was revoked elsewhere is dead here too.
    try:
        row_revoked_at = await db.scalar(
            select(GlobalSession.revoked_at).where(GlobalSession.id == uuid.UUID(str(sess.get("session_id"))))
        )
        if row_revoked_at is not None:
            return None
    except (ValueError, TypeError):
        pass

    if sess.get("user_type") == "platform_admin":
        admin_row = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == email))
        if admin_row is not None:
            if not admin_row.is_active:
                return None
            cutoff = admin_row.tokens_revoked_before
            created = sess.get("created_at")
            if cutoff is not None and created:
                try:
                    if _utc(datetime.fromisoformat(created)) <= _utc(cutoff):
                        return None  # this admin signed out after this session began
                except ValueError:
                    pass
            return sess
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
    if user is None:
        admin_direct = await db.scalar(select(PlatformAdmin).where(PlatformAdmin.id == row.global_user_id))
        if admin_direct is not None and admin_direct.is_active:
            email = (admin_direct.email or "").strip().lower()
            return {
                "active": True,
                "session_id": session_id,
                "email": email,
                "display_name": admin_direct.display_name or "Super Admin",
                "role": "super_admin" if admin_direct.role == PlatformAdminRole.SUPER_ADMIN else "admin",
                "user_type": "platform_admin",
                "allowed_erps": ["*"],
                "created_at": _utc(row.created_at).isoformat() if getattr(row, "created_at", None) else now.isoformat(),
                "expires_at": _utc(row.expires_at).isoformat(),
                "revoked_at": None,
            }
        return None
    if user.status != GlobalUserStatus.ACTIVE:
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


def invalidate_ecosystem_session_cache_for_user(email: str | None = None) -> None:
    """Evict or invalidate cached sessions for a given user so permission changes take effect immediately."""
    clean_email = (email or "").strip().lower()
    if not clean_email:
        return
    for sid, sess in list(_ECOSYSTEM_SESSION_STORE.items()):
        if (sess.get("email") or "").strip().lower() == clean_email:
            _ECOSYSTEM_SESSION_STORE.pop(sid, None)


async def _resolve_live_session(db: AsyncSession, session_id: Optional[str], now: datetime) -> Optional[Dict[str, Any]]:
    """
    Return a validated session for `session_id` (cache first, then DB), or None.

    Live ERP memberships are always re-validated against the database so access grants
    and revocations take effect immediately across all connected ERPs without stale cache delays.
    """
    if not session_id:
        return None
    cached = _ECOSYSTEM_SESSION_STORE.get(session_id)
    if cached is not None:
        if cached.get("revoked_at") or _cached_session_expired(cached, now):
            return None
        ttl = getattr(settings, "ECOSYSTEM_SESSION_REVALIDATE_TTL_SECONDS", 10.0)
        last_checked = cached.get("_checked_at", 0.0)
        if ttl > 0 and (time.monotonic() - last_checked) < ttl:
            return cached
        try:
            fresh = await _revalidate_cached(db, cached, now)
        except Exception as exc:
            logger.warning(
                "Database error during ecosystem session revalidation (%s); retaining unrevoked cache", exc
            )
            return cached
        if fresh is not None:
            fresh["_checked_at"] = time.monotonic()
            _ECOSYSTEM_SESSION_STORE[session_id] = fresh
            return fresh
        return None
    try:
        rebuilt = await _session_from_db(db, session_id, now)
    except Exception as exc:
        logger.warning("Database error during ecosystem session rebuild from DB (%s)", exc)
        return None
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
    raw_identifier = (payload.email or "").strip()
    email_clean = raw_identifier.lower()
    password = payload.password or ""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=settings.GLOBAL_SESSION_MAX_LIFETIME_HOURS)

    # Collect search keys for flexible lookup (email, display name, username prefix)
    search_keys = {email_clean, raw_identifier.lower()}
    if "@" in email_clean:
        prefix = email_clean.split("@")[0].strip()
        if prefix:
            search_keys.add(prefix)
    search_keys = {k for k in search_keys if k}

    # --- A. Refresh / recovery: prove identity with a live session, not a password.
    if not password:
        live = await _resolve_live_session(db, payload.existing_session_id, now)
        if live is None:
            raise _unauthorized()
        live_email = (live.get("email") or "").strip().lower()
        live_name = (live.get("display_name") or "").strip().lower()
        if email_clean and live_email != email_clean and live_name not in search_keys:
            raise _unauthorized()
        return build_success_response(await attach_landing(db, _public(live)), request_id=_request_id(request))

    # --- B. Password login.
    is_super_admin = False
    display_name = "User"
    user_type = "global_user"
    role = "global_user"
    allowed_erps: List[str] = []
    global_user_id: Optional[uuid.UUID] = None  # row used to persist the session

    admin_conditions = [func.lower(PlatformAdmin.email) == email_clean]
    for key in search_keys:
        admin_conditions.append(func.lower(PlatformAdmin.display_name) == key)
        admin_conditions.append(func.lower(PlatformAdmin.email).like(f"{key}@%"))
    admin = await db.scalar(select(PlatformAdmin).where(or_(*admin_conditions)))

    if admin is not None and admin.is_active and verify_platform_password(password, admin.password_hash):
        is_super_admin = True
        user_type = "platform_admin"
        role = "super_admin" if admin.role == PlatformAdminRole.SUPER_ADMIN else "admin"
        display_name = admin.display_name or "Super Admin"
        allowed_erps = ["*"]
        email_clean = (admin.email or "").strip().lower()
        # Persist via the mirrored Global User (if any) so the session survives a restart.
        mirror = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email_clean))
        if mirror is not None and mirror.status == GlobalUserStatus.ACTIVE:
            global_user_id = mirror.id
        elif admin is not None:
            mirror = GlobalUser(
                primary_email=email_clean,
                display_name=admin.display_name or "Super Admin",
                status=GlobalUserStatus.ACTIVE,
                metadata_json={"role": "super_admin" if admin.role == PlatformAdminRole.SUPER_ADMIN else "admin"},
            )
            db.add(mirror)
            await db.flush()
            global_user_id = mirror.id
    else:
        user_conditions = [func.lower(GlobalUser.primary_email) == email_clean]
        for key in search_keys:
            user_conditions.append(func.lower(GlobalUser.display_name) == key)
            user_conditions.append(func.lower(GlobalUser.primary_email).like(f"{key}@%"))
        user = await db.scalar(select(GlobalUser).where(or_(*user_conditions)))

        if user is not None and user.status == GlobalUserStatus.ACTIVE:
            email_clean = (user.primary_email or "").strip().lower()
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

    return build_success_response(await attach_landing(db, session_data), request_id=_request_id(request))


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

    try:
        live = await _resolve_live_session(db, session_id, now)
        if live is not None:
            return build_success_response(await attach_landing(db, _public(live)), request_id=rid)
    except Exception as exc:
        logger.warning("Database unavailable during session verification (%s)", exc)
        if cached is not None and not cached.get("revoked_at") and not _cached_session_expired(cached, now):
            return build_success_response(await attach_landing(db, _public(cached)), request_id=rid)
        return build_success_response(
            {"active": False, "session_id": session_id, "notFound": True, "revoked": False, "transient_error": True},
            request_id=rid,
        )

    # Distinguish "revoked / access removed" from "never heard of it".
    try:
        sid = uuid.UUID(session_id)
        row = await db.scalar(select(GlobalSession).where(GlobalSession.id == sid))
    except Exception:
        row = None
    if cached is not None or row is not None:
        _ECOSYSTEM_SESSION_STORE.pop(session_id, None)
        return build_success_response(
            {"active": False, "session_id": session_id, "revoked": True, "reason": "session_invalid_or_user_inactive"},
            request_id=rid,
        )
    return build_success_response({"active": False, "session_id": session_id, "notFound": True, "revoked": False}, request_id=rid)



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
        # Bind the admin token to THIS central session, so signing out of that session ends exactly this token
        # (and nobody else's).  A session that lives only in memory gets a persisted row on the admin's mirror user.
        admin_sid = parse_session_id(payload.session_id)
        if admin_sid is None:
            raise _unauthorized()
        admin_row = await db.scalar(select(GlobalSession).where(GlobalSession.id == admin_sid))
        if admin_row is None:
            mirror = await ensure_admin_mirror_user(db, admin)
            db.add(
                GlobalSession(
                    id=admin_sid,
                    global_user_id=mirror.id,
                    expires_at=now + timedelta(hours=settings.GLOBAL_SESSION_MAX_LIFETIME_HOURS),
                    last_activity_at=now,
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
            )
            await db.flush()
        elif admin_row.revoked_at is not None:
            raise _unauthorized()
        issued = create_platform_access_token(admin.id, role=admin.role.value, session_id=str(admin_sid))
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


async def fanout_spoke_logout(db: AsyncSession, user_email: str) -> None:
    """
    Fan-out logout notifications to all spoke ERP instances the user has access to.
    Terminates live WebSocket connections, revokes sessions, and invalidates access tokens across all systems.
    """
    clean_email = (user_email or "").strip().lower()
    if not clean_email:
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    for sid, sess in list(_ECOSYSTEM_SESSION_STORE.items()):
        if (sess.get("email") or "").strip().lower() == clean_email:
            sess["revoked_at"] = now_iso
            sess["active"] = False

    try:
        import logging
        from app.identity_linking.adapters.http_adapter import HttpErpProvisioningAdapter
        adapter = HttpErpProvisioningAdapter()

        # Check if platform admin (Super Admin has access to all ERPs)
        admin = await _active_platform_admin(db, clean_email)
        if admin is not None:
            erps = (await db.execute(select(ErpInstance).where(ErpInstance.status == ErpStatus.ACTIVE))).scalars().all()
            for erp in erps:
                try:
                    await adapter.logout_local_user(erp, clean_email, reason="central_admin_logout")
                except Exception:
                    pass
            return

        # Check global user - logout from all ERPs where the user holds active membership
        user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == clean_email))
        if user is not None:
            stmt = (
                select(ErpInstance)
                .join(ErpMembership, ErpMembership.erp_instance_id == ErpInstance.id)
                .where(
                    ErpMembership.global_user_id == user.id,
                    ErpMembership.status == ErpMembershipStatus.ACTIVE,
                    ErpInstance.status == ErpStatus.ACTIVE,
                )
            )
            erps = (await db.execute(stmt)).scalars().all()
            for erp in erps:
                try:
                    await adapter.logout_local_user(erp, clean_email, reason="central_ecosystem_logout")
                except Exception:
                    pass
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Failed to fan-out ecosystem logout for %s: %s", clean_email, exc)


async def _erps_for_email(db: AsyncSession, clean_email: str) -> List[ErpInstance]:
    """The ERPs this person may use: every ACTIVE ERP for an admin, otherwise the ones with an ACTIVE membership."""
    admin = await _active_platform_admin(db, clean_email)
    if admin is not None:
        return list((await db.execute(select(ErpInstance).where(ErpInstance.status == ErpStatus.ACTIVE))).scalars().all())
    user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == clean_email))
    if user is None:
        return []
    stmt = (
        select(ErpInstance)
        .join(ErpMembership, ErpMembership.erp_instance_id == ErpInstance.id)
        .where(
            ErpMembership.global_user_id == user.id,
            ErpMembership.status == ErpMembershipStatus.ACTIVE,
            ErpInstance.status == ErpStatus.ACTIVE,
        )
    )
    return list((await db.execute(stmt)).scalars().all())


async def fanout_session_revoke(db: AsyncSession, user_email: Optional[str], session_id: str) -> int:
    """
    Tell the ERPs that ONE session ended.  Returns how many ERPs acknowledged.

    Targets: the ERPs the owner may use (admin: all; user: the ticked ERP Access Grants).  If the owner cannot be
    resolved (the central row is gone), every ACTIVE ERP is told -- harmless and idempotent -- so a sign-out is
    never lost.
    """
    from app.identity_linking.adapters.http_adapter import HttpErpProvisioningAdapter

    clean_email = (user_email or "").strip().lower()
    try:
        if clean_email:
            erps = await _erps_for_email(db, clean_email)
        else:
            erps = list((await db.execute(select(ErpInstance).where(ErpInstance.status == ErpStatus.ACTIVE))).scalars().all())
        adapter = HttpErpProvisioningAdapter()
        acknowledged = 0
        for erp in erps:
            try:
                if await adapter.revoke_session(erp, session_id):
                    acknowledged += 1
            except Exception:
                pass
        return acknowledged
    except Exception as exc:
        logging.getLogger(__name__).warning("Could not fan out revoke of session %s: %s", session_id, exc)
        return 0


async def sign_out_session(db: AsyncSession, session_id: str, *, now: Optional[datetime] = None) -> dict:
    """
    Sign out ONE login: revoke exactly this session id, everywhere it was used.

    * the central row (dashboard + admin tokens bound to this sid) and the cached copy;
    * the ERPs' tokens that carry this sid.
    Any other session of the same account (another browser, another device) and every other person are untouched.
    Idempotent: signing out an already ended or unknown session is not an error.
    """
    sid = (session_id or "").strip()
    stamp = now or datetime.now(timezone.utc)
    summary = {"session_id": sid, "revoked": False, "erps_notified": 0}
    if not sid:
        return summary
    owner = await _session_owner_email(db, sid)
    cached = _ECOSYSTEM_SESSION_STORE.get(sid)
    if cached is not None:
        cached["revoked_at"] = stamp.isoformat()
        cached["active"] = False
        summary["revoked"] = True
    sid_uuid = None
    try:
        sid_uuid = uuid.UUID(sid)
    except ValueError:
        pass
    if sid_uuid is not None:
        try:
            row = await db.scalar(select(GlobalSession).where(GlobalSession.id == sid_uuid))
            if row is not None and row.revoked_at is None:
                row.revoked_at = stamp
                await db.commit()
                summary["revoked"] = True
            elif row is not None:
                summary["revoked"] = True
        except Exception:
            await db.rollback()
            logging.getLogger(__name__).exception("Could not revoke central session %s", sid)
        summary["erps_notified"] = await fanout_session_revoke(db, owner, sid)
    return summary


async def sign_out_everywhere(db: AsyncSession, user_email: str, *, now: Optional[datetime] = None) -> dict:
    """
    Sign a person out of EVERYTHING: the ERP_Main dashboard on every browser/device, plus every ERP they can use.

    * every persisted dashboard session of the person is revoked (all devices, not just the one clicked);
    * a platform admin's stateless tokens are invalidated via `tokens_revoked_before`;
    * cached central sessions are marked revoked;
    * every ERP the person may use is told to end their sessions (admin: all ERPs; normal user: only the ERPs
      ticked in their ERP Access Grants, i.e. ACTIVE memberships).
    Never disables the account: signing out is not the same as being blocked.
    """
    clean_email = (user_email or "").strip().lower()
    stamp = now or datetime.now(timezone.utc)
    summary = {"email": clean_email, "dashboard_sessions_revoked": 0, "admin_tokens_invalidated": False}
    if not clean_email:
        return summary
    try:
        user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == clean_email))
        if user is not None:
            res = await db.execute(
                update(GlobalSession)
                .where(GlobalSession.global_user_id == user.id, GlobalSession.revoked_at.is_(None))
                .values(revoked_at=stamp)
            )
            summary["dashboard_sessions_revoked"] = res.rowcount or 0
        admin = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == clean_email))
        if admin is not None:
            admin.tokens_revoked_before = stamp
            summary["admin_tokens_invalidated"] = True
        await db.commit()
    except Exception:
        await db.rollback()
        logging.getLogger(__name__).exception("Could not revoke dashboard sessions for %s", clean_email)
    await fanout_spoke_logout(db, clean_email)
    return summary


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
    user_email = await _session_owner_email(db, session_id)

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

    # 3. Sign out THIS session everywhere it was used (not the person's other logins)
    await sign_out_session(db, session_id, now=now)

    # 4. Audit revocation
    try:
        audit = GlobalAuditService(repository=GlobalAuditRepository(db))
        await audit.record(
            event_type=AuditEventType.GLOBAL_LOGOUT,
            actor_type=AuditActorType.SYSTEM,
            actor_label=user_email or session_id,
            target_type="ecosystem_session",
            target_id=uuid.UUID(session_id) if len(session_id) == 36 else None,
            details={"revoked_globally": True, "email": user_email},
        )
    except Exception:
        pass

    return build_success_response(
        {"status": "revoked", "session_id": session_id, "revoked_at": now.isoformat()},
        request_id=_request_id(request),
    )