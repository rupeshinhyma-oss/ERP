"""
Global User Service.

Business rules for Global User creation and lifecycle:

- `primary_email` is unique -- creating a second GlobalUser with an
  email already in use is a 409 Conflict, not a silent duplicate.
- Status transitions (`suspend`/`reactivate`/`disable`) are their own
  explicit actions, not incidental side effects of a metadata `PATCH`
  (Phase 3 Step 7/12).
- Every creation and status change is recorded to the global audit log
  (Step 41). `suspend`/`disable` never delete or corrupt any local ERP
  account (Step 47) -- but, as of Phase 3 Global User Status & ERP
  Access Synchronization, a SUSPENDED/DISABLED GlobalUser DOES cause
  every one of its currently-ACTIVE ErpMemberships to be suspended
  (blocking local login via each ERP's own existing access endpoint),
  and re-enabling to ACTIVE restores only the memberships THIS
  transition itself suspended -- never a membership that was already
  REVOKED, or SUSPENDED independently by a platform admin for its own
  reason before this GlobalUser-level transition happened. This is a
  deliberate widening of the earlier, narrower Phase 3 access model
  (see the historical note on `GlobalUserStatus` in
  app.global_users.models), not a bug: ERP_Main is meant to be the sole
  authority for whether a user may access an ERP, which requires this
  synchronization to actually happen.
- Reuses `ErpMembershipService.suspend`/`restore` (which themselves
  call the existing adapter registry) rather than a second, parallel
  access-synchronization mechanism.
"""

from __future__ import annotations

import uuid

from app.core.exceptions import ConflictException, NotFoundException
from app.erp_memberships.models import ErpMembershipStatus
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_memberships.service import ErpMembershipService
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.global_users.repository import GlobalUserRepository
from app.global_users.schemas import GlobalUserCreate, GlobalUserUpdate
from app.platform_auth.models import PlatformAdmin

# Metadata key recording which memberships a GlobalUser-level
# suspend/disable itself suspended, so a later re-enable restores only
# those -- never a membership that was independently SUSPENDED or
# REVOKED by a platform admin for its own reason before or after this
# GlobalUser-level transition. Stored on the GlobalUser's own
# metadata_json (no schema change) rather than a new column/table.
_AUTO_SUSPENDED_MEMBERSHIPS_KEY = "_auto_suspended_membership_ids"


class GlobalUserService:
    """Orchestrates Global User creation, lookup, and lifecycle."""

    def __init__(
        self,
        repository: GlobalUserRepository,
        audit: GlobalAuditService,
        membership_repository: ErpMembershipRepository | None = None,
        membership_service: ErpMembershipService | None = None,
    ) -> None:
        """Wire the service to its repository, the global audit service, and (for status sync) membership collaborators."""
        self.repository = repository
        self.audit = audit
        self.membership_repository = membership_repository
        self.membership_service = membership_service

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
        pwd = (payload.metadata or {}).get("default_password") or (payload.metadata or {}).get("password")
        if pwd:
            from app.global_auth.models import GlobalUserCredential
            cred = GlobalUserCredential(
                global_user_id=created.id,
                password_hash=pwd,
                must_change_password=False,
            )
            self.repository.db.add(cred)
            await self.repository.db.flush()

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
        old_email = user.primary_email
        if "metadata" in updates:
            updates["metadata_json"] = updates.pop("metadata")
        if "primary_email" in updates and updates["primary_email"] != user.primary_email:
            existing = await self.repository.get_by_email(updates["primary_email"])
            if existing is not None:
                raise ConflictException(f"A Global User with email {updates['primary_email']!r} already exists.")
        for field, value in updates.items():
            setattr(user, field, value)
        await self.repository.create(user)  # flush + refresh

        # If password in metadata was updated, sync credential and PlatformAdmin login
        meta = user.metadata_json or {}
        pwd = meta.get("default_password") or meta.get("password")
        if pwd:
            from app.global_auth.models import GlobalUserCredential
            from sqlalchemy import select
            cred_stmt = select(GlobalUserCredential).where(GlobalUserCredential.global_user_id == user.id)
            cred = await self.repository.db.scalar(cred_stmt)
            if cred:
                cred.password_hash = pwd
            else:
                cred = GlobalUserCredential(
                    global_user_id=user.id,
                    password_hash=pwd,
                    must_change_password=False,
                )
                self.repository.db.add(cred)

            from app.platform_auth.models import PlatformAdmin
            admin_stmt = select(PlatformAdmin).where(
                (PlatformAdmin.email == user.primary_email) | (PlatformAdmin.email == old_email)
            )
            admin = await self.repository.db.scalar(admin_stmt)
            if admin:
                admin.email = user.primary_email
                admin.password_hash = pwd
            await self.repository.db.flush()

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
        Change a Global User's status, synchronizing ErpMembership/local
        ERP access to match (Phase 3 Global User Status & ERP Access
        Synchronization -- see module docstring for why this replaces the
        earlier, narrower "never touches ErpMembership" behavior).

        - ACTIVE -> SUSPENDED/DISABLED: every currently-ACTIVE membership
          is suspended (via `ErpMembershipService.suspend`, which itself
          best-effort blocks local login). A membership that is already
          SUSPENDED or REVOKED for its own, independent reason is left
          exactly as it is -- this transition never "downgrades" a
          REVOKED membership back to merely SUSPENDED, and never touches
          a membership an admin already suspended themselves.
        - SUSPENDED/DISABLED -> ACTIVE: restores ONLY the memberships this
          same GlobalUser-level transition itself suspended (tracked by
          membership id in this GlobalUser's own metadata_json -- no
          schema change). A REVOKED membership is never restored this
          way, and a membership an admin independently suspended for
          their own reason stays suspended until they explicitly restore
          it themselves.
        """
        user = await self.get(user_id)
        old_status = user.status
        newly_suspended_ids: list[str] = []
        restored_ids: list[str] = []

        if self.membership_repository is not None and self.membership_service is not None:
            if old_status == GlobalUserStatus.ACTIVE and new_status in (
                GlobalUserStatus.SUSPENDED,
                GlobalUserStatus.DISABLED,
            ):
                memberships = await self.membership_repository.list_for_user(user_id)
                for membership in memberships:
                    if membership.status == ErpMembershipStatus.ACTIVE:
                        await self.membership_service.suspend(
                            membership.id,
                            actor=actor,
                            reason=f"GlobalUser set to {new_status.value}",
                        )
                        newly_suspended_ids.append(str(membership.id))

            elif old_status in (GlobalUserStatus.SUSPENDED, GlobalUserStatus.DISABLED) and new_status == GlobalUserStatus.ACTIVE:
                previously_suspended_ids = set(
                    (user.metadata_json or {}).get(_AUTO_SUSPENDED_MEMBERSHIPS_KEY, [])
                )
                if previously_suspended_ids:
                    memberships = await self.membership_repository.list_for_user(user_id)
                    for membership in memberships:
                        if str(membership.id) in previously_suspended_ids and membership.status == ErpMembershipStatus.SUSPENDED:
                            await self.membership_service.restore(
                                membership.id,
                                actor=actor,
                                reason="GlobalUser re-enabled",
                            )
                            restored_ids.append(str(membership.id))

        user.status = new_status

        # Track (add newly-suspended, clear restored) which memberships
        # THIS transition suspended, so a future re-enable restores
        # exactly those and nothing an admin suspended/revoked
        # independently.
        metadata = dict(user.metadata_json or {})
        tracked = set(metadata.get(_AUTO_SUSPENDED_MEMBERSHIPS_KEY, []))
        tracked.update(newly_suspended_ids)
        tracked.difference_update(restored_ids)
        if tracked:
            metadata[_AUTO_SUSPENDED_MEMBERSHIPS_KEY] = sorted(tracked)
        else:
            metadata.pop(_AUTO_SUSPENDED_MEMBERSHIPS_KEY, None)
        user.metadata_json = metadata or None

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
            details={
                "old_status": old_status.value,
                "new_status": new_status.value,
                "memberships_suspended": newly_suspended_ids,
                "memberships_restored": restored_ids,
            },
        )
        return user