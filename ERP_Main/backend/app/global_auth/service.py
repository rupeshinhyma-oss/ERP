"""
Global Authentication Service.

Business rules for Global User self-registration, login, session
lifecycle, password change, and password reset (Phase 4 Steps 8-13, 43).

Security notes
--------------
- Login uses one identical error message/response shape for "no such
  email," "wrong password," and "locked out due to failed attempts" so a
  caller can't enumerate valid emails or lockout state from the response
  alone -- mirrors Yinglima's own login endpoint.
- Every login attempt (success or failure), logout, password change, and
  password reset request/completion is recorded to the global audit log.
- Sessions are revocable rows (`GlobalSession`), not bare JWTs -- see
  `app.global_auth.security` for why the token's own `exp` is a ceiling,
  not the sole source of truth.
- Password reset tokens are short-lived, single-use, and never logged in
  plaintext (only their hash is compared) -- Step 43.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException, UnauthorizedException
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_auth.models import GlobalSession, GlobalUserCredential
from app.global_auth.rate_limit import RateLimiter
from app.global_auth.repository import GlobalSessionRepository, GlobalUserCredentialRepository
from app.global_auth.schemas import GlobalLoginRequest, GlobalRegisterRequest
from app.global_auth.security import (
    create_global_access_token,
    hash_password,
    validate_password_strength,
    verify_password,
)
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.global_users.repository import GlobalUserRepository

# Module-level limiter instances: shared across requests within this
# process (see rate_limit.py's own docstring re: single-process scope).
_login_limiter = RateLimiter(
    max_attempts=settings.GLOBAL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    window_seconds=settings.GLOBAL_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
)
_reset_request_limiter = RateLimiter(max_attempts=5, window_seconds=300)

# In-memory single-use password reset tokens: {token_hash: (global_user_id, expires_at)}.
# Deliberately not a database table -- these are ephemeral, short-lived
# (30 min default), single-use secrets; keeping them in-memory means a
# stale one is never visible in a database dump or backup. Same
# single-process caveat as RateLimiter above.
_password_reset_tokens: dict[str, tuple[uuid.UUID, datetime]] = {}


def _is_locked(credential: GlobalUserCredential) -> bool:
    """Return True if this credential is currently locked out due to failed attempts."""
    if credential.locked_until is None:
        return False
    locked_until = credential.locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    return locked_until > datetime.now(timezone.utc)


class GlobalAuthService:
    """Orchestrates Global User registration, login, session lifecycle, and password management."""

    def __init__(
        self,
        user_repository: GlobalUserRepository,
        credential_repository: GlobalUserCredentialRepository,
        session_repository: GlobalSessionRepository,
        audit: GlobalAuditService,
    ) -> None:
        """Wire the service to its repositories and the global audit service."""
        self.user_repository = user_repository
        self.credential_repository = credential_repository
        self.session_repository = session_repository
        self.audit = audit

    async def register(self, payload: GlobalRegisterRequest) -> GlobalUser:
        """
        Self-register a new Global User with a password credential.

        Rejects a duplicate email (409) and a weak password (422-shaped
        `ForbiddenException`... actually raises `ConflictException`/a
        dedicated validation path -- see route layer for the exact HTTP
        mapping). Never treats a Global User created via the Phase 3
        admin-only `POST /global/users` path as pre-registered for this
        flow's purposes if it has no credential yet: those two creation
        paths are independent by design.
        """
        existing = await self.user_repository.get_by_email(payload.email)
        if existing is not None:
            raise ConflictException(f"A Global User with email {payload.email!r} already exists.")

        violations = validate_password_strength(payload.password)
        if violations:
            raise ForbiddenException("Password does not meet the required strength policy.", details=violations)

        user = GlobalUser(display_name=payload.display_name, primary_email=payload.email)
        created_user = await self.user_repository.create(user)

        credential = GlobalUserCredential(
            global_user_id=created_user.id,
            password_hash=hash_password(payload.password),
            password_changed_at=datetime.now(timezone.utc),
        )
        await self.credential_repository.create(credential)

        await self.audit.record(
            event_type=AuditEventType.GLOBAL_USER_REGISTERED,
            actor_type=AuditActorType.SYSTEM,
            target_type="global_user",
            target_id=created_user.id,
            details={"primary_email": created_user.primary_email},
        )
        return created_user

    async def login(
        self, payload: GlobalLoginRequest, *, ip_address: str | None, user_agent: str | None
    ) -> tuple[GlobalUser, str, datetime, uuid.UUID]:
        """
        Verify credentials, enforce lockout/rate-limiting, and issue a new session + access token.

        Returns (global_user, access_token, expires_at, session_id).
        """
        rate_key = f"{ip_address or 'unknown'}:{payload.email}"
        if not _login_limiter.check_and_record(rate_key):
            raise ForbiddenException("Too many login attempts. Please try again later.")

        user = await self.user_repository.get_by_email(payload.email)
        credential = await self.credential_repository.get_by_global_user_id(user.id) if user else None

        if user is None or credential is None or user.status != GlobalUserStatus.ACTIVE or _is_locked(credential):
            if credential is not None:
                await self._record_failed_attempt(credential)
            await self.audit.record(
                event_type=AuditEventType.GLOBAL_LOGIN_FAILURE,
                actor_type=AuditActorType.SYSTEM,
                actor_label=payload.email,
            )
            # Explicitly commit here (not just flush): the exception
            # raised immediately below would otherwise make
            # `get_db_session()`'s dependency roll back this whole
            # request's session on the way out -- silently undoing the
            # failed-attempt counter and the audit entry just written
            # above, making lockout unenforceable and the audit trail for
            # failed logins incomplete. This is the one deliberate
            # exception to "let the request-level session own the
            # transaction" in this codebase, and it exists for exactly
            # this reason: a failure path that itself needs durable state.
            await self.credential_repository.db.commit()
            raise UnauthorizedException("Invalid email or password.")

        if not verify_password(payload.password, credential.password_hash):
            await self._record_failed_attempt(credential)
            await self.audit.record(
                event_type=AuditEventType.GLOBAL_LOGIN_FAILURE,
                actor_type=AuditActorType.SYSTEM,
                actor_id=user.id,
                actor_label=payload.email,
            )
            await self.credential_repository.db.commit()  # see comment above
            raise UnauthorizedException("Invalid email or password.")

        # Successful login: clear lockout state and the rate-limit bucket.
        credential.failed_login_count = 0
        credential.locked_until = None
        await self.credential_repository.create(credential)  # flush + refresh
        _login_limiter.reset(rate_key)

        now = datetime.now(timezone.utc)
        session = GlobalSession(
            global_user_id=user.id,
            expires_at=now + timedelta(hours=settings.GLOBAL_SESSION_MAX_LIFETIME_HOURS),
            last_activity_at=now,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        created_session = await self.session_repository.create(session)

        issued = create_global_access_token(global_user_id=user.id, session_id=created_session.id)

        await self.audit.record(
            event_type=AuditEventType.GLOBAL_LOGIN_SUCCESS,
            actor_type=AuditActorType.SYSTEM,
            actor_id=user.id,
            actor_label=user.primary_email,
            target_type="global_session",
            target_id=created_session.id,
        )
        return user, issued.token, issued.expires_at, created_session.id

    async def _record_failed_attempt(self, credential: GlobalUserCredential) -> None:
        """Increment the failed-attempt counter and lock the credential if the threshold is reached."""
        credential.failed_login_count += 1
        if credential.failed_login_count >= settings.GLOBAL_MAX_FAILED_LOGIN_ATTEMPTS:
            credential.locked_until = datetime.now(timezone.utc) + timedelta(
                minutes=settings.GLOBAL_ACCOUNT_LOCK_MINUTES
            )
        await self.credential_repository.create(credential)  # flush + refresh

    async def resolve_session(self, session_id: uuid.UUID) -> GlobalSession:
        """
        Fetch a session by id and verify it is still valid (not revoked, not expired).

        This is the check `require_global_user` runs on every request --
        the JWT's own `exp` is only a ceiling; this row is the actual
        source of truth for revocation (Step 12).
        """
        session = await self.session_repository.get_by_id(session_id)
        if session is None:
            raise UnauthorizedException("This session no longer exists.")
        if session.revoked_at is not None:
            raise UnauthorizedException("This session has been revoked.")
        now = datetime.now(timezone.utc)
        expires_at = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= now:
            raise UnauthorizedException("This session has expired.")

        session.last_activity_at = now
        await self.session_repository.create(session)  # flush + refresh
        return session

    async def logout(self, session_id: uuid.UUID, *, global_user_id: uuid.UUID) -> None:
        """
        Revoke a session (global logout, Step 29).

        Distinct from any ERP's own local logout -- this only ever
        revokes the GlobalSession row; it has no way to reach into, and
        never touches, any local ERP's own session/JWT state.
        """
        session = await self.session_repository.get_by_id(session_id)
        if session is None or session.global_user_id != global_user_id:
            raise NotFoundException("Session not found.")
        session.revoked_at = datetime.now(timezone.utc)
        await self.session_repository.create(session)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.GLOBAL_LOGOUT,
            actor_type=AuditActorType.SYSTEM,
            actor_id=global_user_id,
            target_type="global_session",
            target_id=session_id,
        )

    async def list_sessions(self, global_user_id: uuid.UUID) -> list[GlobalSession]:
        """List every session (active or not) belonging to a Global User."""
        return await self.session_repository.list_for_user(global_user_id)

    async def revoke_session(self, session_id: uuid.UUID, *, global_user_id: uuid.UUID) -> GlobalSession:
        """Revoke a specific session by id (e.g. 'log out of that other device')."""
        session = await self.session_repository.get_by_id(session_id)
        if session is None or session.global_user_id != global_user_id:
            raise NotFoundException("Session not found.")
        session.revoked_at = datetime.now(timezone.utc)
        updated = await self.session_repository.create(session)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.GLOBAL_SESSION_REVOKED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=global_user_id,
            target_type="global_session",
            target_id=session_id,
        )
        return updated

    async def change_password(
        self, global_user_id: uuid.UUID, *, current_password: str, new_password: str
    ) -> None:
        """Change the authenticated Global User's own password, verifying the current one first."""
        credential = await self.credential_repository.get_by_global_user_id(global_user_id)
        if credential is None or not verify_password(current_password, credential.password_hash):
            raise UnauthorizedException("Current password is incorrect.")

        violations = validate_password_strength(new_password)
        if violations:
            raise ForbiddenException("Password does not meet the required strength policy.", details=violations)

        credential.password_hash = hash_password(new_password)
        credential.password_changed_at = datetime.now(timezone.utc)
        credential.must_change_password = False
        await self.credential_repository.create(credential)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.GLOBAL_PASSWORD_CHANGED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=global_user_id,
        )

    async def request_password_reset(self, email: str, *, ip_address: str | None) -> None:
        """
        Issue a short-lived, single-use password reset token (Step 43).

        Always returns normally (no exception, no distinguishable
        response) whether or not the email is registered -- this method
        has no return value on purpose, so the route layer can give an
        identical generic response either way, preventing email
        enumeration.
        """
        rate_key = f"{ip_address or 'unknown'}:{email}"
        if not _reset_request_limiter.check_and_record(rate_key):
            return  # silently drop -- same generic response either way

        user = await self.user_repository.get_by_email(email)
        await self.audit.record(
            event_type=AuditEventType.GLOBAL_PASSWORD_RESET_REQUESTED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=user.id if user else None,
            actor_label=email,
        )
        if user is None:
            return

        raw_token = secrets.token_urlsafe(32)
        token_hash = hash_password(raw_token)
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.GLOBAL_PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
        )
        _password_reset_tokens[token_hash] = (user.id, expires_at)
        # In a real deployment this raw_token would be emailed to the
        # user, never returned over the API or logged -- see the route
        # layer / delivery report for what this phase does instead
        # (there is no email-sending integration in ERP_Main yet).

    async def confirm_password_reset(self, *, raw_token: str, new_password: str) -> None:
        """Complete a password reset using a single-use token issued by `request_password_reset`."""
        matched_hash: str | None = None
        matched_user_id: uuid.UUID | None = None
        now = datetime.now(timezone.utc)
        for token_hash, (user_id, expires_at) in list(_password_reset_tokens.items()):
            if expires_at <= now:
                _password_reset_tokens.pop(token_hash, None)
                continue
            if verify_password(raw_token, token_hash):
                matched_hash = token_hash
                matched_user_id = user_id
                break

        if matched_hash is None or matched_user_id is None:
            raise UnauthorizedException("Invalid or expired password reset token.")

        violations = validate_password_strength(new_password)
        if violations:
            raise ForbiddenException("Password does not meet the required strength policy.", details=violations)

        credential = await self.credential_repository.get_by_global_user_id(matched_user_id)
        if credential is None:
            raise NotFoundException("No credential found for this account.")

        credential.password_hash = hash_password(new_password)
        credential.password_changed_at = now
        credential.failed_login_count = 0
        credential.locked_until = None
        await self.credential_repository.create(credential)  # flush + refresh

        _password_reset_tokens.pop(matched_hash, None)  # single-use: consumed now

        await self.audit.record(
            event_type=AuditEventType.GLOBAL_PASSWORD_RESET_COMPLETED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=matched_user_id,
        )
