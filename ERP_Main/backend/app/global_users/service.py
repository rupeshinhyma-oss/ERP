"""
Global User Service.

Business rules for Global User creation and lifecycle:

- `primary_email` is unique -- creating a second GlobalUser with an
  email already in use is a 409 Conflict, not a silent duplicate.
- Status transitions (`suspend`/`reactivate`/`disable`) are their own
  explicit actions, not incidental side effects of a metadata `PATCH`
  (Phase 3 Step 7/12).
- Every creation and status change is recorded to the global audit log
  (Step 41), and `suspend`/`disable` never touch, delete, or otherwise
  reach into any local ERP's own User table (Step 47: "must NOT
  automatically delete or corrupt local ERP accounts").
"""

from __future__ import annotations

import uuid

from app.core.exceptions import ConflictException, NotFoundException
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.global_users.repository import GlobalUserRepository
from app.global_users.schemas import GlobalUserCreate, GlobalUserUpdate
from app.platform_auth.models import PlatformAdmin


class GlobalUserService:
    """Orchestrates Global User creation, lookup, and lifecycle."""

    def __init__(self, repository: GlobalUserRepository, audit: GlobalAuditService) -> None:
        """Wire the service to its repository and the global audit service."""
        self.repository = repository
        self.audit = audit

    async def create(self, payload: GlobalUserCreate, *, actor: PlatformAdmin) -> GlobalUser:
        """Create a new Global User. Rejects a duplicate `primary_email` with 409 Conflict."""
        existing = await self.repository.get_by_email(payload.primary_email)
        if existing is not None:
            raise ConflictException(f"A Global User with email {payload.primary_email!r} already exists.")

        user = GlobalUser(
            display_name=payload.display_name,
            primary_email=payload.primary_email,
            external_identity_id=payload.external_identity_id,
            metadata_json=payload.metadata,
        )
        created = await self.repository.create(user)
        await self.audit.record(
            event_type=AuditEventType.GLOBAL_USER_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="global_user",
            target_id=created.id,
            details={"primary_email": created.primary_email},
        )
        return created

    async def get(self, user_id: uuid.UUID) -> GlobalUser:
        """Fetch a single Global User by id, or raise 404."""
        user = await self.repository.get_by_id(user_id)
        if user is None:
            raise NotFoundException(f"No Global User found with id {user_id}.")
        return user

    async def list_all(self, *, limit: int = 100, offset: int = 0) -> list[GlobalUser]:
        """List Global Users, paged."""
        return await self.repository.list_all(limit=limit, offset=offset)

    async def update(self, user_id: uuid.UUID, payload: GlobalUserUpdate, *, actor: PlatformAdmin) -> GlobalUser:
        """Update Global User metadata. Cannot change `status` -- use the dedicated transition methods."""
        user = await self.get(user_id)
        updates = payload.model_dump(exclude_unset=True, by_alias=False)
        if "metadata" in updates:
            updates["metadata_json"] = updates.pop("metadata")
        if "primary_email" in updates and updates["primary_email"] != user.primary_email:
            existing = await self.repository.get_by_email(updates["primary_email"])
            if existing is not None:
                raise ConflictException(f"A Global User with email {updates['primary_email']!r} already exists.")
        for field, value in updates.items():
            setattr(user, field, value)
        await self.repository.create(user)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.GLOBAL_USER_UPDATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="global_user",
            target_id=user.id,
            details={"fields_updated": sorted(updates.keys())},
        )
        return user

    async def set_status(self, user_id: uuid.UUID, new_status: GlobalUserStatus, *, actor: PlatformAdmin) -> GlobalUser:
        """
        Change a Global User's status.

        Never touches any local ERP account or ErpMembership row -- see
        module docstring and Step 47. A suspended/disabled GlobalUser
        simply stops being eligible for NEW membership verification/
        linking; existing local ERP logins are entirely unaffected in
        Phase 3 (no SSO exists yet to even revoke).
        """
        user = await self.get(user_id)
        old_status = user.status
        user.status = new_status
        await self.repository.create(user)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.GLOBAL_USER_SUSPENDED
            if new_status == GlobalUserStatus.SUSPENDED
            else AuditEventType.GLOBAL_USER_UPDATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="global_user",
            target_id=user.id,
            details={"old_status": old_status.value, "new_status": new_status.value},
        )
        return user
