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

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import logging
import secrets
import threading
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
from app.global_auth.security import (
    InvalidGlobalTokenError,
    create_global_access_token,
    decode_global_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.global_auth.session_ops import ensure_admin_mirror_user, parse_session_id
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole
from app.platform_auth.security import (
    InvalidPlatformTokenError,
    create_platform_access_token,
    decode_platform_access_token,
    hash_password as hash_platform_password,
    needs_rehash as needs_platform_rehash,
    verify_password as verify_platform_password,
)

router = APIRouter(prefix="/global/ecosystem-session", tags=["Ecosystem Unified Session"])
logger = logging.getLogger(__name__)

# In-memory synchronized session cache for fast sub-millisecond lookups across all origins
_ECOSYSTEM_SESSION_STORE: Dict[str, Dict[str, Any]] = {}

# BUG-003: Single-use signed exchange authorization code registry: jti -> (expires_at_epoch, consumed)
_EXCHANGE_ISS = "erp-main-ecosystem-session"
_EXCHANGE_AUD = "erp-main-session-exchange"
_SESSION_COOKIE_AUD = "erp-main-session-cookie"
_EXCHANGE_LOCK = threading.Lock()
_EXCHANGE_CODE_REGISTRY: Dict[str, tuple[float, bool]] = {}
_MAX_EXCHANGE_CODES = 20000


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


# Identifiers the explicit dev-only unseeded-database fallback may recognise.
# BUG-016: Hardcoded fallback password removed; never active in production.
_DEFAULT_ADMIN_IDS = ("admin", "admin@example.com")
_CONTROL_PLANE_KEY = "control-plane"


def _allow_unseeded_dev_fallback() -> bool:
    """Dev-only opt-in fallback; strictly impossible in production."""
    if settings.is_production:
        return False
    if not bool(getattr(settings, "ALLOW_UNSEEDED_DEV_ADMIN_FALLBACK", False)):
        return False
    configured = (getattr(settings, "BOOTSTRAP_ADMIN_PASSWORD", "") or "").strip()
    return bool(configured)


def _session_fingerprint(session_id: str) -> str:
    """Non-reversible short digest for audit logs & diagnostics (never log raw session IDs)."""
    return hashlib.sha256(f"eco-session-audit:{session_id}".encode("utf-8")).hexdigest()[:16]


def _signing_key(purpose: str) -> bytes:
    """Derive a domain-separated HMAC signing key for exchange codes / HttpOnly session cookies."""
    material = f"{purpose}:{settings.GLOBAL_AUTH_JWT_SECRET_KEY}:{settings.PLATFORM_JWT_SECRET_KEY}".encode("utf-8")
    return hashlib.sha256(material).digest()


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(val: str) -> bytes:
    pad = "=" * (-len(val) % 4)
    return base64.urlsafe_b64decode((val + pad).encode("ascii"))


def _sign_compact_payload(payload: dict[str, Any], *, purpose: str) -> str:
    body = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = hmac.new(_signing_key(purpose), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _verify_compact_payload(token: str, *, purpose: str, expected_aud: str) -> Optional[dict[str, Any]]:
    if not token or "." not in token:
        return None
    parts = token.split(".", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    body_b64, sig_hex = parts
    expected_sig = hmac.new(_signing_key(purpose), body_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig.lower(), sig_hex.lower()):
        return None
    try:
        data = json.loads(_b64url_decode(body_b64).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if data.get("iss") != _EXCHANGE_ISS or data.get("aud") != expected_aud:
        return None
    exp = data.get("exp")
    if not isinstance(exp, (int, float)) or time.time() >= float(exp):
        return None
    return data


def _prune_exchange_codes(now_ts: float) -> None:
    expired = [j for j, (exp_ts, _) in _EXCHANGE_CODE_REGISTRY.items() if exp_ts <= now_ts]
    for j in expired:
        _EXCHANGE_CODE_REGISTRY.pop(j, None)
    overflow = len(_EXCHANGE_CODE_REGISTRY) - _MAX_EXCHANGE_CODES
    if overflow > 0:
        oldest = sorted(_EXCHANGE_CODE_REGISTRY.items(), key=lambda kv: kv[1][0])[:overflow]
        for j, _ in oldest:
            _EXCHANGE_CODE_REGISTRY.pop(j, None)


def issue_exchange_code(
    *,
    session_id: str,
    email: str,
    user_id: str,
    user_type: str,
    ttl_seconds: Optional[int] = None,
) -> str:
    """Mint a signed, short-lived, single-use exchange authorization code bound to user + session."""
    ttl = int(ttl_seconds if ttl_seconds is not None else getattr(settings, "ECOSYSTEM_EXCHANGE_CODE_EXPIRE_SECONDS", 60))
    ttl = max(5, min(ttl, 300))
    now_ts = time.time()
    exp_ts = now_ts + ttl
    jti = secrets.token_urlsafe(24)
    payload = {
        "iss": _EXCHANGE_ISS,
        "aud": _EXCHANGE_AUD,
        "jti": jti,
        "sid": str(session_id),
        "sub": str(user_id),
        "email": (email or "").strip().lower(),
        "utype": user_type,
        "iat": int(now_ts),
        "exp": exp_ts,
    }
    with _EXCHANGE_LOCK:
        _prune_exchange_codes(now_ts)
        _EXCHANGE_CODE_REGISTRY[jti] = (exp_ts, False)
    return _sign_compact_payload(payload, purpose="exchange-code")


def consume_exchange_code(
    code: Optional[str],
    *,
    expected_session_id: str,
    expected_email: str,
) -> dict[str, Any]:
    """
    Verify signature, expiry, iss, aud, session+email binding, and atomically mark single-use code consumed.
    Raises 401 on any failure (missing, invalid signature, expired, replay, mismatched binding).
    """
    if not code or not isinstance(code, str):
        raise _unauthorized("A signed single-use exchange_code is required.")
    claims = _verify_compact_payload(code.strip(), purpose="exchange-code", expected_aud=_EXCHANGE_AUD)
    if claims is None:
        raise _unauthorized("Invalid or expired exchange authorization code.")
    jti = str(claims.get("jti") or "")
    claim_sid = str(claims.get("sid") or "")
    claim_email = str(claims.get("email") or "").strip().lower()
    if not jti or claim_sid != str(expected_session_id) or claim_email != (expected_email or "").strip().lower():
        raise _unauthorized("Exchange authorization code does not match the requested session or user.")

    now_ts = time.time()
    with _EXCHANGE_LOCK:
        _prune_exchange_codes(now_ts)
        entry = _EXCHANGE_CODE_REGISTRY.get(jti)
        if entry is None:
            raise _unauthorized("Exchange authorization code is unknown or expired.")
        exp_ts, consumed = entry
        if consumed or now_ts >= exp_ts:
            raise _unauthorized("Exchange authorization code has already been used or expired.")
        # Atomic one-time consumption before any token is minted.
        _EXCHANGE_CODE_REGISTRY[jti] = (exp_ts, True)
    return claims


def _issue_session_cookie_value(session_id: str, email: str, expires_at: datetime) -> str:
    payload = {
        "iss": _EXCHANGE_ISS,
        "aud": _SESSION_COOKIE_AUD,
        "sid": str(session_id),
        "email": (email or "").strip().lower(),
        "exp": _utc(expires_at).timestamp(),
    }
    return _sign_compact_payload(payload, purpose="session-cookie")


def _set_httponly_session_cookie(response: Response, session_id: str, email: str, expires_at: datetime) -> None:
    cookie_name = getattr(settings, "ECOSYSTEM_SESSION_COOKIE_NAME", "ihm_eco_sid")
    max_age = max(60, int((_utc(expires_at) - datetime.now(timezone.utc)).total_seconds()))
    val = _issue_session_cookie_value(session_id, email, expires_at)
    response.set_cookie(
        key=cookie_name,
        value=val,
        max_age=max_age,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
    )


def _clear_httponly_session_cookie(response: Response) -> None:
    cookie_name = getattr(settings, "ECOSYSTEM_SESSION_COOKIE_NAME", "ihm_eco_sid")
    response.delete_cookie(key=cookie_name, path="/", httponly=True, secure=settings.is_production, samesite="lax")


def _verify_cookie_for_session(request: Request, session_id: str) -> Optional[dict[str, Any]]:
    cookie_name = getattr(settings, "ECOSYSTEM_SESSION_COOKIE_NAME", "ihm_eco_sid")
    raw = request.cookies.get(cookie_name)
    if not raw:
        return None
    claims = _verify_compact_payload(raw, purpose="session-cookie", expected_aud=_SESSION_COOKIE_AUD)
    if claims is None:
        return None
    return claims


async def _authorize_session_access(
    request: Request,
    db: AsyncSession,
    session_id: str,
    *,
    allow_revoked_own_session: bool = False,
) -> dict[str, Any]:
    """
    BUG-003: Authenticate and authorize callers of GET /{session_id}, POST /{session_id}/revoke,
    and POST /exchange-code.

    Permitted callers:
      1. Authenticated spoke ERP service credential (Authorization: Bearer <cred> + X-ERP-Key)
      2. Authenticated PlatformAdmin JWT (SUPER_ADMIN / PLATFORM_ADMIN for any session; others only own session)
      3. Authenticated GlobalUser JWT (only own session / own email)
      4. Valid signed HttpOnly session cookie bound strictly to `session_id`
    """
    auth_header = (request.headers.get("authorization") or "").strip()
    x_erp_key = (request.headers.get("x-erp-key") or "").strip()

    # 1. Server-to-server spoke ERP service credential
    if x_erp_key:
        from app.global_users.password_sync import _verify_erp_caller

        try:
            erp_key = _verify_erp_caller(auth_header, x_erp_key)
            return {"kind": "service", "erp_key": erp_key, "is_admin": True}
        except Exception as exc:
            raise _unauthorized("Invalid service credential.") from exc

    owner_email = await _session_owner_email(db, session_id)

    # 2. Bearer JWT (PlatformAdmin OR GlobalUser)
    if auth_header.lower().startswith("bearer "):
        raw_token = auth_header[7:].strip()
        if not raw_token:
            raise _unauthorized("Missing bearer token.")

        # 2a. Try PlatformAdmin JWT
        try:
            p_claims = decode_platform_access_token(raw_token)
        except InvalidPlatformTokenError:
            p_claims = None

        if p_claims is not None:
            try:
                admin_id = uuid.UUID(str(p_claims.get("sub")))
            except (ValueError, TypeError):
                raise _unauthorized("Invalid administrator token.")
            admin = await db.scalar(select(PlatformAdmin).where(PlatformAdmin.id == admin_id))
            if admin is None or not admin.is_active:
                raise _unauthorized("Administrator account is inactive.")
            token_sid = str(p_claims.get("sid") or "")
            is_same_sid = bool(token_sid and token_sid == session_id)
            if not allow_revoked_own_session or not is_same_sid:
                if token_sid:
                    from app.global_auth.session_ops import session_is_live

                    if not await session_is_live(db, token_sid):
                        raise _unauthorized("Session has expired or been revoked.")
                if admin.tokens_revoked_before is not None:
                    iat = p_claims.get("iat")
                    if iat is not None and float(iat) <= _utc(admin.tokens_revoked_before).timestamp():
                        raise _unauthorized("Token has been revoked.")

            is_privileged_admin = admin.role in (PlatformAdminRole.SUPER_ADMIN, PlatformAdminRole.PLATFORM_ADMIN)
            admin_email = (admin.email or "").strip().lower()
            if is_privileged_admin or is_same_sid or (owner_email is not None and owner_email == admin_email):
                return {
                    "kind": "platform_admin",
                    "email": admin_email,
                    "user_id": str(admin.id),
                    "is_admin": is_privileged_admin,
                }
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access or revoke another user's session.",
            )

        # 2b. Try GlobalUser JWT
        try:
            g_claims = decode_global_access_token(raw_token)
        except InvalidGlobalTokenError:
            raise _unauthorized("Invalid or expired authentication token.")

        try:
            user_id = uuid.UUID(str(g_claims.get("sub")))
            token_sid_uuid = uuid.UUID(str(g_claims.get("jti") or g_claims.get("sid")))
        except (ValueError, TypeError):
            raise _unauthorized("Invalid user token.")

        user = await db.scalar(select(GlobalUser).where(GlobalUser.id == user_id))
        if user is None or user.status != GlobalUserStatus.ACTIVE:
            raise _unauthorized("User account is inactive.")

        token_sid_str = str(token_sid_uuid)
        is_same_sid = token_sid_str == session_id
        if not allow_revoked_own_session or not is_same_sid:
            sess_row = await db.scalar(select(GlobalSession).where(GlobalSession.id == token_sid_uuid))
            if sess_row is None or sess_row.revoked_at is not None or _utc(sess_row.expires_at) <= datetime.now(timezone.utc):
                raise _unauthorized("Session has expired or been revoked.")

        user_email = (user.primary_email or "").strip().lower()
        if is_same_sid or (owner_email is not None and owner_email == user_email):
            return {
                "kind": "global_user",
                "email": user_email,
                "user_id": str(user.id),
                "is_admin": False,
            }
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access or revoke another user's session.",
        )

    # 3. Signed HttpOnly session cookie strictly bound to THIS session_id
    cookie_claims = _verify_cookie_for_session(request, session_id)
    if cookie_claims is not None:
        if str(cookie_claims.get("sid") or "") == session_id:
            return {
                "kind": "session_cookie",
                "email": str(cookie_claims.get("email") or ""),
                "is_admin": False,
            }
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Session cookie does not authorize access to another session.",
        )

    raise _unauthorized("Authentication is required to access or modify ecosystem sessions.")


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
            return {**sess, "display_name": admin_row.display_name or sess.get("display_name") or "Super Admin"}
        # No PlatformAdmin row: only sessions minted by the explicit dev-only fallback may exist.
        return sess if (_allow_unseeded_dev_fallback() and email in _DEFAULT_ADMIN_IDS) else None

    user = await db.scalar(select(GlobalUser).where(func.lower(GlobalUser.primary_email) == email))
    if user is None or user.status != GlobalUserStatus.ACTIVE:
        return None
    return {**sess, "display_name": user.display_name or user.primary_email, "allowed_erps": await _active_erp_keys(db, user.id) + [_CONTROL_PLANE_KEY]}


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

    # --- A. Refresh / recovery: prove identity with a live session AND caller authorization, not a bare session_id.
    if not password:
        if not payload.existing_session_id:
            raise _unauthorized()
        await _authorize_session_access(request, db, payload.existing_session_id)
        live = await _resolve_live_session(db, payload.existing_session_id, now)
        if live is None:
            raise _unauthorized()
        live_email = (live.get("email") or "").strip().lower()
        live_name = (live.get("display_name") or "").strip().lower()
        if email_clean and live_email != email_clean and live_name not in search_keys:
            raise _unauthorized()
        public_live = _public(live)
        live_exp = _utc(datetime.fromisoformat(public_live["expires_at"])) if public_live.get("expires_at") else expires_at
        _set_httponly_session_cookie(response, public_live["session_id"], live_email, live_exp)
        public_live["exchange_code"] = issue_exchange_code(
            session_id=public_live["session_id"],
            email=live_email,
            user_id=str(live.get("_principal_id") or live_email),
            user_type=str(public_live.get("user_type") or "global_user"),
        )
        return build_success_response(await attach_landing(db, public_live), request_id=_request_id(request))

    # --- B. Password login.
    is_super_admin = False
    display_name = "User"
    user_type = "global_user"
    role = "global_user"
    allowed_erps: List[str] = []
    global_user_id: Optional[uuid.UUID] = None  # row used to persist the session
    principal_id: str = ""

    admin_conditions = [func.lower(PlatformAdmin.email) == email_clean]
    for key in search_keys:
        admin_conditions.append(func.lower(PlatformAdmin.display_name) == key)
        admin_conditions.append(func.lower(PlatformAdmin.email).like(f"{key}@%"))
    admin = await db.scalar(select(PlatformAdmin).where(or_(*admin_conditions)))

    if admin is not None and admin.is_active and verify_platform_password(password, admin.password_hash):
        # BUG-001: Conditional Argon2id rehash on successful legacy PlatformAdmin login
        old_admin_hash = admin.password_hash
        if old_admin_hash and needs_platform_rehash(old_admin_hash):
            upgraded = hash_platform_password(password)
            res = await db.execute(
                update(PlatformAdmin)
                .where(PlatformAdmin.id == admin.id, PlatformAdmin.password_hash == old_admin_hash)
                .values(password_hash=upgraded)
            )
            if (res.rowcount or 0) > 0:
                admin.password_hash = upgraded

        is_super_admin = True
        user_type = "platform_admin"
        role = "super_admin" if admin.role == PlatformAdminRole.SUPER_ADMIN else "admin"
        display_name = admin.display_name or "Super Admin"
        allowed_erps = ["*"]
        email_clean = (admin.email or "").strip().lower()
        principal_id = str(admin.id)
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
                # BUG-001: Always persist an Argon2id hash, never plaintext
                db.add(
                    GlobalUserCredential(
                        global_user_id=user.id,
                        password_hash=hash_password(password),
                        must_change_password=False,
                    )
                )
                await db.flush()
            elif needs_rehash(cred.password_hash):
                old_cred_hash = cred.password_hash
                upgraded = hash_password(password)
                res = await db.execute(
                    update(GlobalUserCredential)
                    .where(
                        GlobalUserCredential.id == cred.id,
                        GlobalUserCredential.password_hash == old_cred_hash,
                    )
                    .values(password_hash=upgraded)
                )
                if (res.rowcount or 0) > 0:
                    cred.password_hash = upgraded

            global_user_id = user.id
            principal_id = str(user.id)
            display_name = user.display_name or user.primary_email
            meta_role = (user.metadata_json or {}).get("role")
            role = meta_role.lower() if meta_role else "global_user"
            allowed_erps = await _active_erp_keys(db, user.id) + [_CONTROL_PLANE_KEY]
        elif (
            admin is None
            and _allow_unseeded_dev_fallback()
            and email_clean in _DEFAULT_ADMIN_IDS
            and (await db.scalar(select(func.count(PlatformAdmin.id)))) == 0
            and hmac.compare_digest(password, settings.BOOTSTRAP_ADMIN_PASSWORD)
        ):
            # Explicit development-only opt-in on an unseeded DB (never available in production).
            is_super_admin = True
            user_type = "platform_admin"
            role = "super_admin"
            display_name = "Super Admin"
            allowed_erps = ["*"]
            principal_id = "dev-bootstrap-admin"
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
    _ECOSYSTEM_SESSION_STORE[session_id] = {
        **session_data,
        "_checked_at": time.monotonic(),
        "_principal_id": principal_id or session_data["email"],
    }

    # BUG-003: Bind browser session via signed HttpOnly cookie & issue single-use exchange code.
    _set_httponly_session_cookie(response, session_id, session_data["email"], expires_at)
    exchange_code = issue_exchange_code(
        session_id=session_id,
        email=session_data["email"],
        user_id=principal_id or session_data["email"],
        user_type=user_type,
    )

    try:
        audit = GlobalAuditService(repository=GlobalAuditRepository(db))
        await audit.record(
            event_type=AuditEventType.GLOBAL_LOGIN_SUCCESS,
            actor_type=AuditActorType.HUMAN_ADMIN if is_super_admin else AuditActorType.SYSTEM,
            actor_label=session_data["email"],
            target_type="ecosystem_session",
            target_id=None,  # BUG-003: never store raw session_id in audit target_id
            details={
                "source_erp": payload.source_erp,
                "role": role,
                "session_ref": _session_fingerprint(session_id),
            },
        )
    except Exception:
        pass

    response_payload = await attach_landing(db, {**session_data, "exchange_code": exchange_code})
    return build_success_response(response_payload, request_id=_request_id(request))


class IssueExchangeCodeRequest(BaseModel):
    session_id: str = Field(..., description="Active ecosystem session ID owned by the authenticated caller.")


@router.post("/exchange-code", summary="Mint a short-lived single-use signed exchange code for an authenticated session")
async def create_ecosystem_exchange_code(
    payload: IssueExchangeCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Issue a signed, short-lived, single-use exchange authorization code for SSO handover into ERP_Main.
    Requires authenticated ownership (Bearer JWT, signed HttpOnly session cookie, or spoke service credential).
    """
    await _authorize_session_access(request, db, payload.session_id)
    now = datetime.now(timezone.utc)
    live = await _resolve_live_session(db, payload.session_id, now)
    if live is None:
        raise _unauthorized("Session is no longer active.")
    email = (live.get("email") or "").strip().lower()
    user_type = str(live.get("user_type") or "global_user")
    principal_id = str(live.get("_principal_id") or email)
    code = issue_exchange_code(
        session_id=payload.session_id,
        email=email,
        user_id=principal_id,
        user_type=user_type,
    )
    ttl = int(getattr(settings, "ECOSYSTEM_EXCHANGE_CODE_EXPIRE_SECONDS", 60))
    return build_success_response(
        {
            "exchange_code": code,
            "session_id": payload.session_id,
            "expires_in_seconds": ttl,
        },
        request_id=_request_id(request),
    )


@router.get("/{session_id}", summary="Validate ecosystem session status")
async def get_ecosystem_session(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Report whether an ecosystem session is currently valid.

    BUG-003: Authenticated and authorized — requires a valid Bearer JWT belonging to the session owner
    or an administrator, a signed HttpOnly session cookie bound to `session_id`, or a spoke ERP service credential.
    """
    await _authorize_session_access(request, db, session_id, allow_revoked_own_session=True)
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
    exchange_code: Optional[str] = Field(
        default=None,
        description="Signed, short-lived, single-use exchange authorization code bound to user + session (required).",
    )


@router.post("/exchange", summary="Sign the right person in to ERP_Main using a signed single-use exchange code")
async def exchange_ecosystem_session(
    payload: ExchangeSessionRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    BUG-003 Hardened Exchange:
    Never mints a JWT from `(session_id, email)` alone. Requires a valid, unexpired, single-use,
    HMAC-signed `exchange_code` cryptographically bound to `(session_id, email, user_type, iss, aud)`
    and atomically consumed on first use so replays are rejected.
    """
    now = datetime.now(timezone.utc)
    email = (payload.email or "").strip().lower()

    # 1. Verify and atomically consume the signed single-use exchange authorization code FIRST.
    claims = consume_exchange_code(
        payload.exchange_code,
        expected_session_id=payload.session_id,
        expected_email=email,
    )

    # 2. Re-validate live session against CURRENT database state.
    live = await _resolve_live_session(db, payload.session_id, now)
    if live is None or (live.get("email") or "").strip().lower() != email:
        raise _unauthorized("Your central session is no longer active. Please sign in again.")
    if claims.get("utype") and live.get("user_type") and claims.get("utype") != live.get("user_type"):
        raise _unauthorized("Exchange code principal type mismatch.")

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

    # Bind the HttpOnly session cookie on ERP_Main after verified exchange
    live_exp = (
        _utc(datetime.fromisoformat(live["expires_at"]))
        if live.get("expires_at")
        else now + timedelta(hours=settings.GLOBAL_SESSION_MAX_LIFETIME_HOURS)
    )
    _set_httponly_session_cookie(response, payload.session_id, email, live_exp)

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
        logging.getLogger(__name__).warning(
            "Could not fan out revoke of session ref=%s: %s",
            _session_fingerprint(session_id),
            exc,
        )
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
            logging.getLogger(__name__).exception(
                "Could not revoke central session ref=%s", _session_fingerprint(sid)
            )
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
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Centrally revoke an ecosystem session. Logs the user out of all connected ERPs immediately.
    BUG-003: Requires authenticated owner, administrator, signed HttpOnly session cookie, or spoke service credential.
    """
    caller = await _authorize_session_access(request, db, session_id)
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

    # Clear HttpOnly session cookie if this caller revoked their own cookie-bound session
    cookie_claims = _verify_cookie_for_session(request, session_id)
    if cookie_claims and str(cookie_claims.get("sid") or "") == session_id:
        _clear_httponly_session_cookie(response)

    # 4. Audit revocation without exposing raw session_id
    try:
        audit = GlobalAuditService(repository=GlobalAuditRepository(db))
        await audit.record(
            event_type=AuditEventType.GLOBAL_LOGOUT,
            actor_type=AuditActorType.HUMAN_ADMIN if caller.get("is_admin") else AuditActorType.SYSTEM,
            actor_label=user_email or caller.get("email") or caller.get("erp_key") or "authenticated_caller",
            target_type="ecosystem_session",
            target_id=None,  # BUG-003: never store raw session_id in audit target_id
            details={
                "revoked_globally": True,
                "email": user_email,
                "session_ref": _session_fingerprint(session_id),
            },
        )
    except Exception:
        pass

    return build_success_response(
        {"status": "revoked", "session_id": session_id, "revoked_at": now.isoformat()},
        request_id=_request_id(request),
    )