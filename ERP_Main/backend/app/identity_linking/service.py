"""
Identity Linking & Provisioning Service (Prompt 2).

Orchestrates bidirectional identity linking between GlobalUsers,
ErpMemberships, and local ERP user accounts.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, ConflictException, ForbiddenException, NotFoundException
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_registry.models import ErpInstance, ErpStatus
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.global_users.repository import GlobalUserRepository
from app.identity_linking.adapters.registry import ErpAdapterRegistry, get_adapter_registry
from app.identity_linking.models import ConflictStatus, ConflictType, IdentityConflict
from app.identity_linking.repository import IdentityConflictRepository
from app.identity_linking.schemas import (
    ConflictResolutionAction,
    IdentityMatchingState,
    IdentityMatchResult,
)
from app.platform_auth.models import PlatformAdmin

logger = logging.getLogger(__name__)


def normalize_email(email: str) -> str:
    """Deterministic email normalization policy: strip whitespace, lowercase."""
    if not email:
        return ""
    return email.strip().lower()


class IdentityLinkingService:
    """Core domain service for bidirectional identity linking and conflict management."""

    def __init__(
        self,
        *,
        db: AsyncSession,
        global_user_repository: GlobalUserRepository,
        membership_repository: ErpMembershipRepository,
        erp_instance_repository: ErpInstanceRepository,
        conflict_repository: IdentityConflictRepository,
        audit_service: GlobalAuditService,
        adapter_registry: ErpAdapterRegistry | None = None,
    ) -> None:
        self.db = db
        self.global_user_repo = global_user_repository
        self.membership_repo = membership_repository
        self.erp_repo = erp_instance_repository
        self.conflict_repo = conflict_repository
        self.audit = audit_service
        self.adapter_registry = adapter_registry or get_adapter_registry()

    # -------------------------------------------------------------------------
    # FLOW B: ERP -> Global (Evaluate & Link incoming user.created event)
    # -------------------------------------------------------------------------
    async def evaluate_and_link_user(
        self,
        *,
        erp_instance_id: uuid.UUID,
        local_user_id: str,
        email: str,
        display_name: str,
        username: str | None = None,
        details: dict | None = None,
    ) -> IdentityMatchResult:
        """
        Evaluate an incoming local ERP user and match against GlobalUser identities.

        Deterministically handles:
        - ALREADY_LINKED
        - EXACT_MATCH -> auto-links and activates membership
        - NO_MATCH -> creates new GlobalUser and links membership
        - AMBIGUOUS_MATCH -> records IdentityConflict (PENDING)
        - CONFLICT -> records IdentityConflict (PENDING)
        """
        local_user_id = str(local_user_id).strip()
        norm_email = normalize_email(email)

        # 1. Check if this local user is ALREADY linked in this ERP
        existing_by_local = await self.membership_repo.get_by_erp_and_local_user(erp_instance_id, local_user_id)
        if existing_by_local is not None:
            return IdentityMatchResult(
                state=IdentityMatchingState.ALREADY_LINKED,
                global_user_id=existing_by_local.global_user_id,
                membership_id=existing_by_local.id,
                message="Local user is already linked to an existing GlobalUser.",
            )

        if not norm_email:
            # Fallback for accounts without email: record conflict
            conflict = IdentityConflict(
                erp_instance_id=erp_instance_id,
                local_user_id=local_user_id,
                normalized_email="no-email@placeholder.local",
                status=ConflictStatus.PENDING,
                conflict_type=ConflictType.AMBIGUOUS_MATCH,
                candidate_global_user_ids=[],
                details_json=details or {"reason": "Local user has no email address."},
            )
            created_conflict = await self.conflict_repo.create(conflict)
            return IdentityMatchResult(
                state=IdentityMatchingState.AMBIGUOUS_MATCH,
                conflict_id=created_conflict.id,
                message="Local user has no email; identity conflict recorded.",
            )

        # 2. Find GlobalUser candidates by normalized primary email
        stmt = select(GlobalUser).where(func.lower(GlobalUser.primary_email) == norm_email)
        res = await self.db.execute(stmt)
        candidates = list(res.scalars().all())

        now = datetime.now(timezone.utc)

        # 3. Handle matching states
        if len(candidates) == 1:
            candidate = candidates[0]

            # Check if this candidate already has a membership for this ERP
            existing_for_user_erp = await self.membership_repo.get_by_user_and_erp(candidate.id, erp_instance_id)
            if existing_for_user_erp is not None:
                if existing_for_user_erp.local_user_id == local_user_id:
                    return IdentityMatchResult(
                        state=IdentityMatchingState.ALREADY_LINKED,
                        global_user_id=candidate.id,
                        membership_id=existing_for_user_erp.id,
                        message="Local user is already linked.",
                    )
                # CONFLICT: The matching GlobalUser is already linked to a DIFFERENT local user in this ERP
                conflict = await self._record_conflict(
                    erp_instance_id=erp_instance_id,
                    local_user_id=local_user_id,
                    normalized_email=norm_email,
                    conflict_type=ConflictType.CONFLICT,
                    candidate_ids=[str(candidate.id)],
                    details=details or {"reason": f"GlobalUser already bound to local user {existing_for_user_erp.local_user_id}."},
                )
                return IdentityMatchResult(
                    state=IdentityMatchingState.CONFLICT,
                    conflict_id=conflict.id,
                    global_user_id=candidate.id,
                    message="Matching GlobalUser is already linked to a different local account in this ERP.",
                )

            # EXACT_MATCH: Exactly one matching GlobalUser, not yet linked to this ERP
            membership = ErpMembership(
                global_user_id=candidate.id,
                erp_instance_id=erp_instance_id,
                local_user_id=local_user_id,
                status=ErpMembershipStatus.ACTIVE,
                linked_at=now,
                verified_at=now,
                metadata_json={"source": "outbox_auto_link", "username": username},
            )
            created_membership = await self.membership_repo.create(membership)

            await self.audit.record(
                event_type=AuditEventType.GLOBAL_USER_LINKED,
                actor_type=AuditActorType.ERP_SERVICE,
                actor_id=erp_instance_id,
                actor_label="ERP Outbox Integration",
                target_type="erp_membership",
                target_id=created_membership.id,
                details={
                    "global_user_id": str(candidate.id),
                    "erp_instance_id": str(erp_instance_id),
                    "local_user_id": local_user_id,
                    "match_state": "EXACT_MATCH",
                },
            )

            return IdentityMatchResult(
                state=IdentityMatchingState.EXACT_MATCH,
                global_user_id=candidate.id,
                membership_id=created_membership.id,
                message="Successfully auto-linked local user to matching GlobalUser.",
            )

        elif len(candidates) == 0:
            # NO_MATCH: Create brand new GlobalUser and link membership
            new_global_user = GlobalUser(
                display_name=display_name.strip() if display_name else (username or norm_email.split("@")[0]),
                primary_email=norm_email,
                status=GlobalUserStatus.ACTIVE,
                metadata_json={"provisioned_from_erp": str(erp_instance_id)},
            )
            created_user = await self.global_user_repo.create(new_global_user)

            await self.audit.record(
                event_type=AuditEventType.GLOBAL_USER_CREATED,
                actor_type=AuditActorType.ERP_SERVICE,
                actor_id=erp_instance_id,
                actor_label="ERP Outbox Integration",
                target_type="global_user",
                target_id=created_user.id,
                details={"primary_email": norm_email, "source_erp_id": str(erp_instance_id)},
            )

            membership = ErpMembership(
                global_user_id=created_user.id,
                erp_instance_id=erp_instance_id,
                local_user_id=local_user_id,
                status=ErpMembershipStatus.ACTIVE,
                linked_at=now,
                verified_at=now,
                metadata_json={"source": "outbox_auto_provision", "username": username},
            )
            created_membership = await self.membership_repo.create(membership)

            await self.audit.record(
                event_type=AuditEventType.GLOBAL_USER_LINKED,
                actor_type=AuditActorType.ERP_SERVICE,
                actor_id=erp_instance_id,
                actor_label="ERP Outbox Integration",
                target_type="erp_membership",
                target_id=created_membership.id,
                details={
                    "global_user_id": str(created_user.id),
                    "erp_instance_id": str(erp_instance_id),
                    "local_user_id": local_user_id,
                    "match_state": "NO_MATCH",
                },
            )

            return IdentityMatchResult(
                state=IdentityMatchingState.NO_MATCH,
                global_user_id=created_user.id,
                membership_id=created_membership.id,
                message="Created new GlobalUser and linked local ERP user.",
            )

        else:
            # AMBIGUOUS_MATCH: Multiple GlobalUsers found
            conflict = await self._record_conflict(
                erp_instance_id=erp_instance_id,
                local_user_id=local_user_id,
                normalized_email=norm_email,
                conflict_type=ConflictType.AMBIGUOUS_MATCH,
                candidate_ids=[str(c.id) for c in candidates],
                details=details or {"reason": f"Found {len(candidates)} candidate GlobalUsers for email."},
            )
            return IdentityMatchResult(
                state=IdentityMatchingState.AMBIGUOUS_MATCH,
                conflict_id=conflict.id,
                message=f"Ambiguous match: {len(candidates)} GlobalUsers found. Conflict recorded for admin resolution.",
            )

    async def _record_conflict(
        self,
        *,
        erp_instance_id: uuid.UUID,
        local_user_id: str,
        normalized_email: str,
        conflict_type: ConflictType,
        candidate_ids: list[str],
        details: dict,
    ) -> IdentityConflict:
        """Create or reuse an existing PENDING conflict record."""
        existing = await self.conflict_repo.get_pending_by_erp_and_local_user(erp_instance_id, local_user_id)
        if existing is not None:
            return existing

        conflict = IdentityConflict(
            erp_instance_id=erp_instance_id,
            local_user_id=local_user_id,
            normalized_email=normalized_email,
            status=ConflictStatus.PENDING,
            conflict_type=conflict_type,
            candidate_global_user_ids=candidate_ids,
            details_json=details,
        )
        created = await self.conflict_repo.create(conflict)
        await self.audit.record(
            event_type=AuditEventType.IDENTITY_CONFLICT_CREATED,
            actor_type=AuditActorType.ERP_SERVICE,
            actor_id=erp_instance_id,
            actor_label="Identity Reconciliation",
            target_type="identity_conflict",
            target_id=created.id,
            details={
                "erp_instance_id": str(erp_instance_id),
                "local_user_id": local_user_id,
                "conflict_type": conflict_type.value,
                "candidate_count": len(candidate_ids),
            },
        )
        return created

    # -------------------------------------------------------------------------
    # FLOW A: Global -> ERP (Provisioning from Control Plane)
    # -------------------------------------------------------------------------
    async def provision_global_user_to_erp(
        self,
        *,
        global_user_id: uuid.UUID,
        erp_instance_id: uuid.UUID,
        target_organization_id: uuid.UUID | None = None,
        notes: str | None = None,
        actor: PlatformAdmin,
    ) -> ErpMembership:
        """
        Provision a GlobalUser into an ERP instance using the adapter pattern.

        Idempotent: if the membership or local user already exists, reuses it safely.
        """
        global_user = await self.global_user_repo.get_by_id(global_user_id)
        if global_user is None:
            raise NotFoundException(f"GlobalUser {global_user_id} not found.")
        if global_user.status != GlobalUserStatus.ACTIVE:
            raise ForbiddenException(f"Cannot provision GlobalUser with status {global_user.status.value}.")

        erp_instance = await self.erp_repo.get_by_id(erp_instance_id)
        if erp_instance is None:
            raise NotFoundException(f"ERP instance {erp_instance_id} not found.")
        if erp_instance.status != ErpStatus.ACTIVE:
            raise ForbiddenException(f"ERP instance {erp_instance.key!r} is not ACTIVE (status={erp_instance.status.value}).")

        # Check existing membership (Idempotency: return existing relationship)
        existing_membership = await self.membership_repo.get_by_user_and_erp(global_user_id, erp_instance_id)
        if existing_membership is not None:
            logger.info("GlobalUser %s already has membership %s in ERP %s; returning existing.", global_user_id, existing_membership.id, erp_instance.key)
            return existing_membership

        # Resolve ERP adapter
        adapter = self.adapter_registry.get_adapter(erp_instance)

        # Check if local user already exists in target ERP
        local_user_id: str | None = None
        existing_local = await adapter.check_local_user(erp_instance, global_user.primary_email)
        if existing_local and "local_user_id" in existing_local:
            local_user_id = str(existing_local["local_user_id"])
        else:
            # Provision minimal user in the ERP
            provision_res = await adapter.provision_local_user(
                erp_instance,
                email=global_user.primary_email,
                display_name=global_user.display_name,
                target_organization_id=str(target_organization_id) if target_organization_id else None,
            )
            local_user_id = str(provision_res["local_user_id"])

        # Check if this local_user_id is already claimed by a different GlobalUser
        existing_by_local = await self.membership_repo.get_by_erp_and_local_user(erp_instance_id, local_user_id)
        if existing_by_local is not None and existing_by_local.global_user_id != global_user_id:
            raise ConflictException(
                f"Local user {local_user_id!r} in ERP {erp_instance.key!r} is already linked to another GlobalUser."
            )

        now = datetime.now(timezone.utc)
        membership = ErpMembership(
            global_user_id=global_user_id,
            erp_instance_id=erp_instance_id,
            local_user_id=local_user_id,
            status=ErpMembershipStatus.ACTIVE,
            linked_at=now,
            verified_at=now,
            metadata_json={"notes": notes, "provisioned_by": str(actor.id)},
        )
        created = await self.membership_repo.create(membership)

        await self.audit.record(
            event_type=AuditEventType.LOCAL_USER_PROVISIONED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_membership",
            target_id=created.id,
            details={
                "global_user_id": str(global_user_id),
                "erp_key": erp_instance.key,
                "local_user_id": local_user_id,
            },
        )

        return created

    # -------------------------------------------------------------------------
    # CONFLICT RESOLUTION
    # -------------------------------------------------------------------------
    async def resolve_conflict(
        self,
        conflict_id: uuid.UUID,
        *,
        action: ConflictResolutionAction,
        target_global_user_id: uuid.UUID | None = None,
        notes: str | None = None,
        actor: PlatformAdmin,
    ) -> IdentityConflict:
        """Resolve a pending identity conflict according to explicit admin decision."""
        conflict = await self.conflict_repo.get_by_id(conflict_id)
        if conflict is None:
            raise NotFoundException(f"IdentityConflict {conflict_id} not found.")
        if conflict.status != ConflictStatus.PENDING:
            raise ConflictException(f"Conflict {conflict_id} is already {conflict.status.value}.")

        now = datetime.now(timezone.utc)

        if action == ConflictResolutionAction.LINK:
            if target_global_user_id is None:
                raise BadRequestException("target_global_user_id is required when action is 'LINK'.")

            target_user = await self.global_user_repo.get_by_id(target_global_user_id)
            if target_user is None:
                raise NotFoundException(f"Target GlobalUser {target_global_user_id} not found.")

            # Ensure no duplicate membership exists
            existing_for_pair = await self.membership_repo.get_by_user_and_erp(target_global_user_id, conflict.erp_instance_id)
            if existing_for_pair is not None:
                raise ConflictException(f"GlobalUser {target_global_user_id} already has a membership for this ERP.")

            existing_for_local = await self.membership_repo.get_by_erp_and_local_user(conflict.erp_instance_id, conflict.local_user_id)
            if existing_for_local is not None:
                raise ConflictException(f"Local user {conflict.local_user_id} is already linked to a GlobalUser.")

            membership = ErpMembership(
                global_user_id=target_global_user_id,
                erp_instance_id=conflict.erp_instance_id,
                local_user_id=conflict.local_user_id,
                status=ErpMembershipStatus.ACTIVE,
                linked_at=now,
                verified_at=now,
                metadata_json={"resolved_from_conflict": str(conflict.id)},
            )
            created_membership = await self.membership_repo.create(membership)

            conflict.status = ConflictStatus.RESOLVED
            conflict.resolution_action = "LINK"
            conflict.resolved_by = actor.id
            conflict.resolved_at = now
            updated_conflict = await self.conflict_repo.create(conflict)

            await self.audit.record(
                event_type=AuditEventType.IDENTITY_CONFLICT_RESOLVED,
                actor_type=AuditActorType.HUMAN_ADMIN,
                actor_id=actor.id,
                actor_label=actor.email,
                target_type="identity_conflict",
                target_id=conflict.id,
                details={"action": "LINK", "target_global_user_id": str(target_global_user_id), "membership_id": str(created_membership.id)},
            )
            return updated_conflict

        elif action == ConflictResolutionAction.CREATE_NEW:
            # Create a distinct new GlobalUser
            new_user = GlobalUser(
                display_name=conflict.details_json.get("display_name", conflict.normalized_email.split("@")[0]) if conflict.details_json else conflict.normalized_email.split("@")[0],
                primary_email=conflict.normalized_email,
                status=GlobalUserStatus.ACTIVE,
                metadata_json={"created_from_conflict_resolution": str(conflict.id)},
            )
            created_user = await self.global_user_repo.create(new_user)

            membership = ErpMembership(
                global_user_id=created_user.id,
                erp_instance_id=conflict.erp_instance_id,
                local_user_id=conflict.local_user_id,
                status=ErpMembershipStatus.ACTIVE,
                linked_at=now,
                verified_at=now,
                metadata_json={"resolved_from_conflict": str(conflict.id)},
            )
            await self.membership_repo.create(membership)

            conflict.status = ConflictStatus.RESOLVED
            conflict.resolution_action = "CREATE_NEW"
            conflict.resolved_by = actor.id
            conflict.resolved_at = now
            updated_conflict = await self.conflict_repo.create(conflict)

            await self.audit.record(
                event_type=AuditEventType.IDENTITY_CONFLICT_RESOLVED,
                actor_type=AuditActorType.HUMAN_ADMIN,
                actor_id=actor.id,
                actor_label=actor.email,
                target_type="identity_conflict",
                target_id=conflict.id,
                details={"action": "CREATE_NEW", "new_global_user_id": str(created_user.id)},
            )
            return updated_conflict

        elif action == ConflictResolutionAction.REJECT:
            conflict.status = ConflictStatus.REJECTED
            conflict.resolution_action = "REJECT"
            conflict.resolved_by = actor.id
            conflict.resolved_at = now
            updated_conflict = await self.conflict_repo.create(conflict)

            await self.audit.record(
                event_type=AuditEventType.IDENTITY_LINK_REJECTED,
                actor_type=AuditActorType.HUMAN_ADMIN,
                actor_id=actor.id,
                actor_label=actor.email,
                target_type="identity_conflict",
                target_id=conflict.id,
                details={"action": "REJECT", "notes": notes},
            )
            return updated_conflict

        raise BadRequestException(f"Unsupported conflict resolution action {action.value!r}.")

    # -------------------------------------------------------------------------
    # UNLINKING & DIRECT LINKING
    # -------------------------------------------------------------------------
    async def unlink_membership(self, membership_id: uuid.UUID, *, actor: PlatformAdmin, reason: str | None = None) -> ErpMembership:
        """
        Safely unlink a GlobalUser from an ERP.

        Revokes the ErpMembership relationship without deleting the local ERP user account.
        """
        membership = await self.membership_repo.get_by_id(membership_id)
        if membership is None:
            raise NotFoundException(f"ErpMembership {membership_id} not found.")

        membership.status = ErpMembershipStatus.REVOKED
        updated = await self.membership_repo.create(membership)

        await self.audit.record(
            event_type=AuditEventType.GLOBAL_USER_UNLINKED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_membership",
            target_id=updated.id,
            details={"global_user_id": str(updated.global_user_id), "local_user_id": updated.local_user_id, "reason": reason},
        )
        return updated

    async def list_identities_for_user(self, global_user_id: uuid.UUID) -> list[dict]:
        """Fetch all linked ERP accounts and statuses for a GlobalUser."""
        memberships = await self.membership_repo.list_for_user(global_user_id)
        identities = []
        for m in memberships:
            erp = await self.erp_repo.get_by_id(m.erp_instance_id)
            identities.append({
                "membership_id": str(m.id),
                "global_user_id": str(m.global_user_id),
                "erp_instance_id": str(m.erp_instance_id),
                "erp_key": erp.key if erp else "unknown",
                "erp_name": erp.name if erp else "unknown",
                "local_user_id": m.local_user_id,
                "status": m.status.value,
                "linked_at": m.linked_at.isoformat() if m.linked_at else None,
                "verified_at": m.verified_at.isoformat() if m.verified_at else None,
            })
        return identities
