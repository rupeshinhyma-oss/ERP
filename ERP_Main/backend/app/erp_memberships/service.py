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
from app.global_users.models import GlobalUser
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

    async def list_all(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
        erp_instance_id: uuid.UUID | None = None,
        status: ErpMembershipStatus | None = None,
    ) -> list[ErpMembership]:
        """List memberships across all or specific ERP instances, paged."""
        return await self.membership_repository.list_all(
            limit=limit, offset=offset, erp_instance_id=erp_instance_id, status=status
        )

    async def get_for_user_and_erp(self, global_user_id: uuid.UUID, erp_instance_id: uuid.UUID) -> ErpMembership:
        """
        Fetch the membership (if any) linking a Global User to a specific ERP, or raise 404.

        Used by the internal, service-credential-gated lookup (Phase 4
        Step 24/36) -- `erp_instance_id` there always comes from the
        caller's own verified service credential, never a path parameter
        supplied by a browser.
        """
        membership = await self.membership_repository.get_by_user_and_erp(global_user_id, erp_instance_id)
        if membership is None:
            raise NotFoundException("No membership found for this Global User with the calling ERP.")
        return membership

    async def register_from_erp(
        self,
        *,
        erp_instance_id: uuid.UUID,
        email: str,
        display_name: str,
        local_user_id: str,
    ) -> tuple[GlobalUser, ErpMembership, bool]:
        """
        Auto-register a brand-new local user, called by the OWNING ERP's own
        backend right after it creates that user -- never by a browser.

        This is the machine-to-machine counterpart to the human-admin
        `create()` above, for the same reason `internal_lookup_membership`
        exists alongside the human-gated lookup routes: a platform admin
        manually linking accounts (via `Memberships.tsx`) remains fully
        supported and is the deliberate fallback if this call is ever
        missed (e.g. ERP_Main was unreachable at the moment the local user
        was created) -- this method does not replace that path, it just
        means most users never need it.

        Deliberately more trusting than the human `create()` flow: the
        membership starts ACTIVE, not PENDING. `create()` starts PENDING
        because a human admin could mistype a `local_user_id` for an
        account they can't directly verify; here, the claim IS the
        verification -- it can only ever arrive already authenticated as
        the ERP that just created the row, via its own service credential
        (`erp_instance_id` comes from `credential.erp_instance_id` at the
        route layer, never from this method's caller supplying it freely).

        Idempotent by design (safe to call more than once for the same
        person, e.g. on a caller-side retry after a network hiccup):
        - If a GlobalUser with this email already exists (e.g. the same
          person already has a membership in a different ERP), reuse it
          rather than rejecting with a conflict.
        - If a membership for this exact (global_user, erp) pair already
          exists, return it unchanged rather than erroring.
        - Only a genuine conflict -- this ERP's `local_user_id` already
          bound to a DIFFERENT GlobalUser -- is rejected, since silently
          repointing that link would be a real correctness bug, not a
          harmless repeat.
        """
        erp_instance = await self.erp_instance_repository.get_by_id(erp_instance_id)
        if erp_instance is None:
            raise NotFoundException(f"No ERP instance found with id {erp_instance_id}.")

        existing_for_local_user = await self.membership_repository.get_by_erp_and_local_user(
            erp_instance_id, local_user_id
        )
        if existing_for_local_user is not None and existing_for_local_user.global_user_id:
            global_user = await self.global_user_repository.get_by_id(existing_for_local_user.global_user_id)
            if global_user is not None:
                # Already registered (a retry, or this endpoint was called
                # twice for the same user) -- return the existing state
                # rather than erroring, so callers can treat this endpoint
                # as safe to call more than once.
                return global_user, existing_for_local_user, False

        global_user = await self.global_user_repository.get_by_email(email)
        created_global_user = False
        if global_user is None:
            global_user = GlobalUser(display_name=display_name, primary_email=email)
            global_user = await self.global_user_repository.create(global_user)
            created_global_user = True
            await self.audit.record(
                event_type=AuditEventType.GLOBAL_USER_CREATED,
                actor_type=AuditActorType.ERP_SERVICE,
                actor_label=erp_instance.key,
                target_type="global_user",
                target_id=global_user.id,
                details={"primary_email": email, "auto_registered_from_erp": erp_instance.key},
            )

        existing_for_pair = await self.membership_repository.get_by_user_and_erp(global_user.id, erp_instance_id)
        if existing_for_pair is not None:
            return global_user, existing_for_pair, created_global_user

        if existing_for_local_user is not None:
            # This local_user_id is already bound to a DIFFERENT
            # GlobalUser than the one we resolved by email -- a genuine
            # data conflict (e.g. the local account's email was changed
            # after its first registration), not a harmless repeat. Fail
            # closed rather than silently repointing an existing link.
            raise ConflictException(
                f"Local user {local_user_id!r} in ERP {erp_instance.key!r} is already linked to a "
                "different Global User. A platform admin must resolve this manually."
            )

        now = datetime.now(timezone.utc)
        membership = ErpMembership(
            global_user_id=global_user.id,
            erp_instance_id=erp_instance_id,
            local_user_id=local_user_id,
            status=ErpMembershipStatus.ACTIVE,
            linked_at=now,
            verified_at=now,
        )
        created_membership = await self.membership_repository.create(membership)
        await self.audit.record(
            event_type=AuditEventType.MEMBERSHIP_CREATED,
            actor_type=AuditActorType.ERP_SERVICE,
            actor_label=erp_instance.key,
            target_type="erp_membership",
            target_id=created_membership.id,
            details={
                "global_user_id": str(global_user.id),
                "erp_key": erp_instance.key,
                "local_user_id": local_user_id,
                "auto_registered": True,
            },
        )
        return global_user, created_membership, created_global_user

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
