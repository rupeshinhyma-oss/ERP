"""
ERP Membership Service.

Business rules for linking Global Users to local ERP accounts (Phase 3
Steps 16-18, 38, 46-48):

- Before activating a link: GlobalUser must exist, ERP must exist, ERP
  must not be DECOMMISSIONED, no duplicate membership for this
  (GlobalUser, ERP) pair, no duplicate binding for this (ERP,
  local_user_id) pair.
- No automatic verification against the local ERP happens in Phase 3 --
  there is no local-account-verification service call wired up yet (that
  would need each ERP to expose the internal endpoint from Step 36,
  which is out of scope here). Every membership is created `PENDING` and
  a platform admin can mark it `verified`/`ACTIVE` once they've confirmed
  the local account out-of-band. This is deliberately conservative: Step
  16 says "do not pretend unverified local user IDs are confirmed
  identities."
- `suspend`/`restore`/`revoke` are separate, explicit actions (Step 12),
  and NONE of them ever call out to the local ERP or touch its User
  table (Step 48: revoking a membership is not deleting a local user).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_memberships.schemas import ErpMembershipCreate
from app.erp_registry.models import ErpStatus
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.platform_auth.models import PlatformAdmin


class ErpMembershipService:
    """Orchestrates ERP Membership creation, lookup, verification, and lifecycle."""

    def __init__(
        self,
        membership_repository: ErpMembershipRepository,
        global_user_repository: GlobalUserRepository,
        erp_instance_repository: ErpInstanceRepository,
        audit: GlobalAuditService,
    ) -> None:
        """Wire the service to its repositories and the global audit service."""
        self.membership_repository = membership_repository
        self.global_user_repository = global_user_repository
        self.erp_instance_repository = erp_instance_repository
        self.audit = audit

    async def create(
        self, global_user_id: uuid.UUID, erp_instance_id: uuid.UUID, payload: ErpMembershipCreate, *, actor: PlatformAdmin
    ) -> ErpMembership:
        """
        Create (link) a new ERP Membership. Starts PENDING (see module docstring).

        Raises 404 if the GlobalUser or ERP doesn't exist, 403 if the ERP
        is DECOMMISSIONED, and 409 for either duplicate-binding case
        (Phase 3 Step 11).
        """
        global_user = await self.global_user_repository.get_by_id(global_user_id)
        if global_user is None:
            raise NotFoundException(f"No Global User found with id {global_user_id}.")

        erp_instance = await self.erp_instance_repository.get_by_id(erp_instance_id)
        if erp_instance is None:
            raise NotFoundException(f"No ERP instance found with id {erp_instance_id}.")
        if erp_instance.status == ErpStatus.DECOMMISSIONED:
            raise ForbiddenException("This ERP instance is decommissioned and cannot accept new memberships.")

        existing_for_pair = await self.membership_repository.get_by_user_and_erp(global_user_id, erp_instance_id)
        if existing_for_pair is not None:
            raise ConflictException(
                f"Global User {global_user_id} already has a membership for ERP {erp_instance.key!r}."
            )

        existing_for_local_user = await self.membership_repository.get_by_erp_and_local_user(
            erp_instance_id, payload.local_user_id
        )
        if existing_for_local_user is not None:
            raise ConflictException(
                f"Local user {payload.local_user_id!r} in ERP {erp_instance.key!r} is already linked to a "
                "different Global User."
            )

        now = datetime.now(timezone.utc)
        membership = ErpMembership(
            global_user_id=global_user_id,
            erp_instance_id=erp_instance_id,
            local_user_id=payload.local_user_id,
            status=ErpMembershipStatus.PENDING,
            linked_at=now,
        )
        created = await self.membership_repository.create(membership)
        await self.audit.record(
            event_type=AuditEventType.MEMBERSHIP_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_membership",
            target_id=created.id,
            details={
                "global_user_id": str(global_user_id),
                "erp_key": erp_instance.key,
                "local_user_id": payload.local_user_id,
            },
        )
        return created

    async def get(self, membership_id: uuid.UUID) -> ErpMembership:
        """Fetch a single membership by id, or raise 404."""
        membership = await self.membership_repository.get_by_id(membership_id)
        if membership is None:
            raise NotFoundException(f"No ERP Membership found with id {membership_id}.")
        return membership

    async def list_for_user(self, global_user_id: uuid.UUID) -> list[ErpMembership]:
        """List every membership a Global User holds (Phase 3 Step 34: 'which ERPs does this user belong to')."""
        return await self.membership_repository.list_for_user(global_user_id)

    async def list_for_erp(self, erp_instance_id: uuid.UUID, *, limit: int = 100, offset: int = 0) -> list[ErpMembership]:
        """List memberships for one ERP, paged (Phase 3 Step 35: 'which Global Users belong to this ERP')."""
        return await self.membership_repository.list_for_erp(erp_instance_id, limit=limit, offset=offset)

    async def verify(self, membership_id: uuid.UUID, *, actor: PlatformAdmin) -> ErpMembership:
        """
        Mark a PENDING membership as verified and ACTIVE.

        In Phase 3, verification is a deliberate platform-admin action
        (the operator has confirmed the local account out-of-band) rather
        than an automated service-to-service check -- see module
        docstring. A future phase can add automatic verification via the
        Step 36 internal endpoint without changing this method's
        contract, only what calls it.
        """
        membership = await self.get(membership_id)
        membership.status = ErpMembershipStatus.ACTIVE
        membership.verified_at = datetime.now(timezone.utc)
        updated = await self.membership_repository.create(membership)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.MEMBERSHIP_VERIFIED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_membership",
            target_id=updated.id,
        )
        return updated

    async def suspend(self, membership_id: uuid.UUID, *, actor: PlatformAdmin, reason: str | None = None) -> ErpMembership:
        """Suspend a membership. Reversible via `restore`. Never touches the local ERP account (Step 48)."""
        return await self._transition(
            membership_id,
            ErpMembershipStatus.SUSPENDED,
            AuditEventType.MEMBERSHIP_SUSPENDED,
            actor=actor,
            reason=reason,
        )

    async def restore(self, membership_id: uuid.UUID, *, actor: PlatformAdmin, reason: str | None = None) -> ErpMembership:
        """Restore a suspended membership back to ACTIVE."""
        return await self._transition(
            membership_id, ErpMembershipStatus.ACTIVE, AuditEventType.MEMBERSHIP_RESTORED, actor=actor, reason=reason
        )

    async def revoke(self, membership_id: uuid.UUID, *, actor: PlatformAdmin, reason: str | None = None) -> ErpMembership:
        """
        Revoke a membership permanently.

        This closes the GlobalUser<->ERP association only. It does NOT
        call, and never has called, any local ERP's user-deletion
        endpoint -- see module docstring and Phase 3 Step 48.
        """
        return await self._transition(
            membership_id, ErpMembershipStatus.REVOKED, AuditEventType.MEMBERSHIP_REVOKED, actor=actor, reason=reason
        )

    async def _transition(
        self,
        membership_id: uuid.UUID,
        new_status: ErpMembershipStatus,
        event_type: AuditEventType,
        *,
        actor: PlatformAdmin,
        reason: str | None,
    ) -> ErpMembership:
        """Shared status-transition logic for suspend/restore/revoke."""
        membership = await self.get(membership_id)
        old_status = membership.status
        membership.status = new_status
        updated = await self.membership_repository.create(membership)  # flush + refresh
        await self.audit.record(
            event_type=event_type,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_membership",
            target_id=updated.id,
            details={"old_status": old_status.value, "new_status": new_status.value, "reason": reason},
        )
        return updated
