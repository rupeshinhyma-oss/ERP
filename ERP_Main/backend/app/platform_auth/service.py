"""
Platform Admin Service.

Business rules for platform-admin authentication and account management:

- Login verifies credentials and issues a short-lived session token.
- Creating a new platform admin requires an existing SUPER_ADMIN caller
  (Phase 3 Step 20's minimal authorization boundary) -- EXCEPT for the
  very first admin account ever created, which has no caller to require
  (see `bootstrap_first_admin`, used only by
  `scripts/seed_platform_admin.py`, never exposed over HTTP).
- Every login attempt (success or failure) and every admin creation is
  recorded to the global audit log (Phase 3 Step 41/19).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from app.core.exceptions import ConflictException, ForbiddenException, UnauthorizedException
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole
from app.platform_auth.repository import PlatformAdminRepository
from app.platform_auth.schemas import PlatformAdminCreate
from app.platform_auth.security import create_platform_access_token, hash_password, verify_password


class PlatformAuthService:
    """Orchestrates platform-admin login and account management."""

    def __init__(self, repository: PlatformAdminRepository, audit: GlobalAuditService) -> None:
        """Wire the service to its repository and the global audit service."""
        self.repository = repository
        self.audit = audit

    async def login(self, *, email: str, password: str) -> tuple[PlatformAdmin, str, datetime]:
        """
        Verify credentials and issue a session token.

        Uses one identical error message and constant-shape response
        for both "no such admin" and "wrong password" so a caller can't
        enumerate valid admin emails by observing which failure they got
        -- the same pattern Yinglima's own login endpoint follows.
        """
        admin = await self.repository.get_by_email(email)
        if admin is None or not admin.is_active or not verify_password(password, admin.password_hash):
            await self.audit.record(
                event_type=AuditEventType.PLATFORM_ADMIN_LOGIN_FAILED,
                actor_type=AuditActorType.HUMAN_ADMIN,
                actor_label=email,
            )
            # Explicitly commit here: the exception raised immediately
            # below would otherwise make `get_db_session()`'s dependency
            # roll back this whole request's session on the way out,
            # silently discarding the audit entry just written above.
            # Discovered as a real, pre-existing bug during Phase 4
            # (the identical pattern in app.global_auth.service.login
            # surfaced it first) -- failed platform-admin logins were
            # never actually reaching the audit log before this fix.
            await self.repository.db.commit()
            raise UnauthorizedException("Invalid email or password.")

        issued = create_platform_access_token(admin.id, role=admin.role.value)
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_ADMIN_LOGIN_SUCCEEDED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=admin.id,
            actor_label=admin.email,
        )
        return admin, issued.token, issued.expires_at

    async def create_admin(self, payload: PlatformAdminCreate, *, created_by: PlatformAdmin) -> PlatformAdmin:
        """Create a new platform admin. Caller must already be an authenticated SUPER_ADMIN."""
        if created_by.role != PlatformAdminRole.SUPER_ADMIN:
            raise ForbiddenException("Only a SUPER_ADMIN can create platform admin accounts.")
        return await self._create(payload, actor_id=created_by.id, actor_label=created_by.email)

    async def bootstrap_first_admin(self, payload: PlatformAdminCreate) -> PlatformAdmin:
        """
        Create the very first platform admin account, with no caller to authorize against.

        Only ever invoked from `scripts/seed_platform_admin.py` (never
        from an HTTP route) and only succeeds while zero admin accounts
        exist -- see the guard in `_create`'s caller here vs.
        `create_admin` above, which always requires a SUPER_ADMIN.
        """
        existing_count = await self.repository.count()
        if existing_count > 0:
            raise ConflictException(
                "Platform admin accounts already exist; use create_admin (as an existing "
                "SUPER_ADMIN) instead of bootstrap_first_admin."
            )
        return await self._create(payload, actor_id=None, actor_label="bootstrap")

    async def _create(self, payload: PlatformAdminCreate, *, actor_id: uuid.UUID | None, actor_label: str) -> PlatformAdmin:
        """Shared creation logic for both `create_admin` and `bootstrap_first_admin`."""
        existing = await self.repository.get_by_email(payload.email)
        if existing is not None:
            raise ConflictException(f"A platform admin with email {payload.email!r} already exists.")

        admin = PlatformAdmin(
            email=payload.email,
            display_name=payload.display_name,
            password_hash=hash_password(payload.password),
            role=payload.role,
        )
        created = await self.repository.create(admin)
        await self.audit.record(
            event_type=AuditEventType.PLATFORM_ADMIN_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN if actor_id else AuditActorType.SYSTEM,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="platform_admin",
            target_id=created.id,
            details={"role": payload.role.value},
        )
        return created
