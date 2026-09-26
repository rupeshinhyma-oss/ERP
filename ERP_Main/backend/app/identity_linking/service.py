"""
Identity Linking & Provisioning Service (Prompt 2).

Orchestrates bidirectional identity linking between GlobalUsers,
ErpMemberships, and local ERP user accounts.
"""

from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
from app.identity_linking.exceptions import (
    ErpAuthError,
    ErpConflictError,
    ErpNotFoundError,
    ErpProvisioningError,
    ErpRateLimitError,
    ErpServerError,
    ErpTimeoutError,
    ErpUnreachableError,
    IdentityConflictDetectedError,
)
from app.identity_linking.models import (
    ConflictStatus,
    ConflictType,
    IdentityConflict,
    ProvisioningReconciliationTask,
    ProvisioningTaskStatus,
)
from app.identity_linking.reconciliation_repository import ProvisioningReconciliationRepository
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
    # Actor & Retry Helpers
    # -------------------------------------------------------------------------
    def _extract_actor(self, actor: Any) -> tuple[AuditActorType, uuid.UUID | None, str | None]:
        """Extract standardized audit actor fields from diverse caller principal types."""
        if actor is None:
            return AuditActorType.SYSTEM, None, "system"
        if hasattr(actor, "is_platform_admin") and actor.is_platform_admin:
            if getattr(actor, "platform_admin", None):
                return AuditActorType.HUMAN_ADMIN, actor.platform_admin.id, actor.platform_admin.email
            return AuditActorType.HUMAN_ADMIN, getattr(actor, "id", None), getattr(actor, "email", "platform_admin")
        if hasattr(actor, "global_user") and actor.global_user:
            return AuditActorType.HUMAN_ADMIN, actor.global_user.id, actor.global_user.primary_email
        if hasattr(actor, "id") and hasattr(actor, "email"):
            return AuditActorType.HUMAN_ADMIN, actor.id, actor.email
        return AuditActorType.SYSTEM, None, str(actor)

    async def _retry_transient(
        self,
        operation: Any,
        max_retries: int = 3,
        base_delay: float = 0.05,
        max_delay: float = 0.5,
    ) -> Any:
        """Execute an async operation with bounded retries and exponential backoff + jitter for transient failures."""
        last_exc: Exception | None = None
        for attempt in range(max_retries):
            try:
                return await operation()
            except ErpProvisioningError as exc:
                last_exc = exc
                if not exc.is_transient or attempt == max_retries - 1:
                    raise
                delay = min(max_delay, base_delay * (2**attempt)) + random.uniform(0, 0.02)
                await asyncio.sleep(delay)
        if last_exc:
            raise last_exc

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
        actor: PlatformAdmin | Any = None,
        max_retries: int = 3,
        base_delay: float = 0.05,
    ) -> ErpMembership:
        """
        Reliably provision or link a GlobalUser into an ERP instance (Phase 5).

        Guarantees:
        1. ERP_Main is authoritative for GlobalUser lifecycle and ERP membership.
        2. Spoke ERP remains authoritative for local User, local RBAC, and local permissions.
        3. Idempotent: repeated calls for the same GlobalUser + ERP do not duplicate users or memberships.
        4. Safe failure: transient errors mark membership PENDING_RETRY without corrupting GlobalUser.
        5. Recovery: retries recover from PENDING -> ACTIVE if remote sync succeeds or lost response is detected.
        6. Conflicts: conflicting identities create an IdentityConflict and leave membership in PENDING/error state.
        7. Audit: records all provisioning lifecycle events with zero credential leakage.
        """
        global_user = await self.global_user_repo.get_by_id(global_user_id)
        if global_user is None:
            raise NotFoundException(f"GlobalUser {global_user_id} not found.")
        if global_user.status != GlobalUserStatus.ACTIVE:
            raise ForbiddenException(f"Cannot provision GlobalUser with status {global_user.status.value}.")

        erp_instance = await self.erp_repo.get_by_id(erp_instance_id)
        if erp_instance is None:
            raise NotFoundException(f"ERP instance {erp_instance_id} not found.")
        if erp_instance.status == ErpStatus.DECOMMISSIONED:
            raise ForbiddenException("This ERP instance is decommissioned and cannot accept new memberships.")
        if erp_instance.status != ErpStatus.ACTIVE:
            raise ForbiddenException(f"ERP instance {erp_instance.key!r} is not ACTIVE (status={erp_instance.status.value}).")

        actor_type, actor_id, actor_label = self._extract_actor(actor)

        # Audit: Provisioning Requested
        await self.audit.record(
            event_type=AuditEventType.PROVISIONING_REQUESTED,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="global_user",
            target_id=global_user.id,
            details={
                "erp_instance_id": str(erp_instance_id),
                "erp_key": erp_instance.key,
                "primary_email": global_user.primary_email,
            },
        )

        # Check existing membership (Idempotency check)
        existing_membership = await self.membership_repo.get_by_user_and_erp(global_user_id, erp_instance_id)
        if existing_membership is not None:
            if existing_membership.status == ErpMembershipStatus.ACTIVE:
                logger.info(
                    "GlobalUser %s already has active membership %s in ERP %s; returning existing.",
                    global_user_id,
                    existing_membership.id,
                    erp_instance.key,
                )
                return existing_membership
            # Existing membership is PENDING/error; proceed with recovery/retry
            membership = existing_membership
        else:
            membership = None

        adapter = self.adapter_registry.get_adapter(erp_instance)
        local_user_id: str | None = None
        created_new: bool = False
        now = datetime.now(timezone.utc)

        try:
            # Step 1: Idempotent check for existing local user
            existing_local = await self._retry_transient(
                lambda: adapter.check_local_user(erp_instance, global_user.primary_email),
                max_retries=max_retries,
                base_delay=base_delay,
            )

            pwd = (global_user.metadata_json or {}).get("default_password") or (global_user.metadata_json or {}).get("password")
            extra_kwargs: dict[str, Any] = {}
            if pwd:
                import inspect
                try:
                    sig = inspect.signature(adapter.provision_local_user)
                    if "password" in sig.parameters or any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
                        extra_kwargs["password"] = pwd
                except Exception:
                    pass

            if existing_local and "local_user_id" in existing_local:
                local_user_id = str(existing_local["local_user_id"])
                created_new = False
                if "password" in extra_kwargs:
                    try:
                        await adapter.provision_local_user(
                            erp_instance,
                            email=global_user.primary_email,
                            display_name=global_user.display_name,
                            **extra_kwargs,
                        )
                    except Exception:
                        pass
            else:
                # Step 2: Provision minimal local user
                provision_res = await self._retry_transient(
                    lambda: adapter.provision_local_user(
                        erp_instance,
                        email=global_user.primary_email,
                        display_name=global_user.display_name,
                        target_organization_id=str(target_organization_id) if target_organization_id else None,
                        **extra_kwargs,
                    ),
                    max_retries=max_retries,
                    base_delay=base_delay,
                )
                local_user_id = str(provision_res["local_user_id"])
                created_new = provision_res.get("created", True)

        except ErpProvisioningError as exc:
            # Handle specific failure modes without corrupting GlobalUser
            if exc.is_transient:
                # Transient error: record PENDING membership so operation completes safely and can retry later
                temp_local_id = (
                    membership.local_user_id
                    if membership and not membership.local_user_id.startswith("pending:")
                    else f"pending:{global_user_id}"
                )
                retry_count = ((membership.metadata_json or {}).get("retry_count", 0) + 1) if membership else 1
                delay = min(
                    getattr(settings, "PROVISIONING_MAX_BACKOFF_SECONDS", 300.0),
                    getattr(settings, "PROVISIONING_BASE_BACKOFF_SECONDS", 5.0) * (2 ** retry_count),
                ) + random.uniform(0.1, 1.0)
                next_retry_at = now + timedelta(seconds=delay)
                meta = {
                    "sync_status": "PENDING_RETRY",
                    "sync_error": exc.message,
                    "error_type": exc.error_type,
                    "is_retryable": True,
                    "retry_count": retry_count,
                    "next_retry_at": next_retry_at.isoformat(),
                    "last_attempt_at": now.isoformat(),
                    "target_organization_id": str(target_organization_id) if target_organization_id else None,
                    "notes": notes,
                }
                if membership is None:
                    membership = ErpMembership(
                        global_user_id=global_user_id,
                        erp_instance_id=erp_instance_id,
                        local_user_id=temp_local_id,
                        status=ErpMembershipStatus.PENDING,
                        linked_at=now,
                        verified_at=None,
                        metadata_json=meta,
                    )
                    membership = await self.membership_repo.create(membership)
                else:
                    membership.status = ErpMembershipStatus.PENDING
                    membership.metadata_json = {**(membership.metadata_json or {}), **meta}
                    await self.membership_repo.create(membership)

                # Persist durable reconciliation task for background recovery (Phase 8)
                recon_repo = ProvisioningReconciliationRepository(self.db)
                await recon_repo.create_or_update_task(
                    membership_id=membership.id,
                    global_user_id=global_user_id,
                    erp_instance_id=erp_instance_id,
                    status=ProvisioningTaskStatus.PENDING_RETRY,
                    retry_count=retry_count,
                    max_retries=getattr(settings, "PROVISIONING_MAX_RETRIES", 10),
                    next_retry_at=next_retry_at,
                    last_error_type=exc.error_type,
                    last_error_message=exc.message,
                )

                await self.audit.record(
                    event_type=AuditEventType.PROVISIONING_RETRY_SCHEDULED,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    target_type="erp_membership",
                    target_id=membership.id,
                    details={"erp_key": erp_instance.key, "error_type": exc.error_type, "retry_count": retry_count},
                )
                await self.audit.record(
                    event_type=AuditEventType.PROVISIONING_FAILED,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    target_type="erp_membership",
                    target_id=membership.id,
                    details={"erp_key": erp_instance.key, "error": exc.message, "is_transient": True},
                )
                return membership


            elif isinstance(exc, ErpConflictError):
                # Remote ERP reported conflict
                conflict = await self._record_conflict(
                    erp_instance_id=erp_instance_id,
                    local_user_id=f"conflict:{global_user_id}",
                    normalized_email=global_user.primary_email,
                    conflict_type=ConflictType.CONFLICT,
                    candidate_ids=[str(global_user_id)],
                    details={"reason": f"Remote ERP {erp_instance.key} reported 409 Conflict: {exc.message}"},
                )
                meta = {
                    "sync_status": "CONFLICT",
                    "conflict_id": str(conflict.id),
                    "sync_error": exc.message,
                    "error_type": "REMOTE_CONFLICT",
                    "is_retryable": False,
                    "last_attempt_at": now.isoformat(),
                }
                if membership is None:
                    membership = ErpMembership(
                        global_user_id=global_user_id,
                        erp_instance_id=erp_instance_id,
                        local_user_id=f"conflict:{conflict.id}",
                        status=ErpMembershipStatus.PENDING,
                        linked_at=now,
                        verified_at=None,
                        metadata_json=meta,
                    )
                    membership = await self.membership_repo.create(membership)
                else:
                    membership.status = ErpMembershipStatus.PENDING
                    membership.metadata_json = {**(membership.metadata_json or {}), **meta}
                    await self.membership_repo.create(membership)

                await self.audit.record(
                    event_type=AuditEventType.IDENTITY_CONFLICT_CREATED,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    target_type="identity_conflict",
                    target_id=conflict.id,
                    details={"erp_key": erp_instance.key, "reason": exc.message},
                )
                await self.audit.record(
                    event_type=AuditEventType.PROVISIONING_FAILED,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    target_type="erp_membership",
                    target_id=membership.id,
                    details={"erp_key": erp_instance.key, "error": exc.message, "is_transient": False},
                )
                await self.db.commit()
                raise ConflictException(f"Identity conflict in ERP {erp_instance.key!r}: {exc.message}")

            else:
                # Permanent failure (401/403, 404, Malformed)
                meta = {
                    "sync_status": "FAILED",
                    "sync_error": exc.message,
                    "error_type": exc.error_type,
                    "is_retryable": False,
                    "last_attempt_at": now.isoformat(),
                }
                if membership is None:
                    membership = ErpMembership(
                        global_user_id=global_user_id,
                        erp_instance_id=erp_instance_id,
                        local_user_id=f"failed:{global_user_id}",
                        status=ErpMembershipStatus.PENDING,
                        linked_at=now,
                        verified_at=None,
                        metadata_json=meta,
                    )
                    membership = await self.membership_repo.create(membership)
                else:
                    membership.status = ErpMembershipStatus.PENDING
                    membership.metadata_json = {**(membership.metadata_json or {}), **meta}
                    await self.membership_repo.create(membership)

                await self.audit.record(
                    event_type=AuditEventType.PROVISIONING_FAILED,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    actor_label=actor_label,
                    target_type="erp_membership",
                    target_id=membership.id,
                    details={"erp_key": erp_instance.key, "error": exc.message, "is_transient": False},
                )
                await self.db.commit()
                if isinstance(exc, ErpAuthError):
                    raise ForbiddenException(f"ERP {erp_instance.key!r} provisioning failed: {exc.message}")
                elif isinstance(exc, ErpNotFoundError):
                    raise NotFoundException(f"ERP {erp_instance.key!r} provisioning endpoint not found: {exc.message}")
                else:
                    raise BadRequestException(f"ERP {erp_instance.key!r} provisioning failed: {exc.message}")

        # Step 3: Check for local identity collision in central ERP_Main
        existing_by_local = await self.membership_repo.get_by_erp_and_local_user(erp_instance_id, local_user_id)
        if existing_by_local is not None and existing_by_local.global_user_id != global_user_id:
            conflict = await self._record_conflict(
                erp_instance_id=erp_instance_id,
                local_user_id=local_user_id,
                normalized_email=global_user.primary_email,
                conflict_type=ConflictType.CONFLICT,
                candidate_ids=[str(existing_by_local.global_user_id), str(global_user_id)],
                details={
                    "reason": (
                        f"Local user {local_user_id} in ERP {erp_instance.key} is already linked to "
                        f"GlobalUser {existing_by_local.global_user_id}"
                    )
                },
            )
            meta = {
                "sync_status": "CONFLICT",
                "conflict_id": str(conflict.id),
                "sync_error": f"Local user '{local_user_id}' already linked to another GlobalUser",
                "is_retryable": False,
                "last_attempt_at": now.isoformat(),
            }
            if membership is None:
                membership = ErpMembership(
                    global_user_id=global_user_id,
                    erp_instance_id=erp_instance_id,
                    local_user_id=f"conflict:{conflict.id}",
                    status=ErpMembershipStatus.PENDING,
                    linked_at=now,
                    verified_at=None,
                    metadata_json=meta,
                )
                membership = await self.membership_repo.create(membership)
            else:
                membership.status = ErpMembershipStatus.PENDING
                membership.metadata_json = {**(membership.metadata_json or {}), **meta}
                await self.membership_repo.create(membership)

            await self.audit.record(
                event_type=AuditEventType.IDENTITY_CONFLICT_CREATED,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_label=actor_label,
                target_type="identity_conflict",
                target_id=conflict.id,
                details={"erp_key": erp_instance.key, "local_user_id": local_user_id},
            )
            await self.audit.record(
                event_type=AuditEventType.PROVISIONING_FAILED,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_label=actor_label,
                target_type="erp_membership",
                target_id=membership.id,
                details={"erp_key": erp_instance.key, "error": "Identity conflict detected"},
            )
            await self.db.commit()
            raise ConflictException(
                f"Local user {local_user_id!r} in ERP {erp_instance.key!r} is already linked to another GlobalUser."
            )

        # Step 4: No collision; successfully activate membership!
        was_pending = membership is not None and membership.status == ErpMembershipStatus.PENDING
        provision_method = "created_new" if created_new else "linked_existing"
        meta = {
            "sync_status": "SUCCESS",
            "provision_method": provision_method,
            "recovered": was_pending,
            "notes": notes,
            "provisioned_by": str(actor_id) if actor_id else None,
            "last_synced_at": now.isoformat(),
        }

        if membership is None:
            membership = ErpMembership(
                global_user_id=global_user_id,
                erp_instance_id=erp_instance_id,
                local_user_id=local_user_id,
                status=ErpMembershipStatus.ACTIVE,
                linked_at=now,
                verified_at=now,
                metadata_json=meta,
            )
            membership = await self.membership_repo.create(membership)
        else:
            membership.local_user_id = local_user_id
            membership.status = ErpMembershipStatus.ACTIVE
            membership.verified_at = now
            membership.metadata_json = {**(membership.metadata_json or {}), **meta}
            await self.membership_repo.create(membership)

        # Mark reconciliation task SUCCEEDED if one exists (Phase 8)
        recon_repo = ProvisioningReconciliationRepository(self.db)
        task = await recon_repo.get_by_membership_id(membership.id)
        if task is not None:
            await recon_repo.release_claim(task.id, ProvisioningTaskStatus.SUCCEEDED)


        # Audit events
        if created_new:
            await self.audit.record(
                event_type=AuditEventType.LOCAL_USER_PROVISIONED,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_label=actor_label,
                target_type="erp_membership",
                target_id=membership.id,
                details={
                    "global_user_id": str(global_user_id),
                    "erp_key": erp_instance.key,
                    "local_user_id": local_user_id,
                },
            )
        else:
            await self.audit.record(
                event_type=AuditEventType.GLOBAL_USER_LINKED,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_label=actor_label,
                target_type="erp_membership",
                target_id=membership.id,
                details={
                    "global_user_id": str(global_user_id),
                    "erp_key": erp_instance.key,
                    "local_user_id": local_user_id,
                    "match_state": "EXISTING_LOCAL_LINKED",
                },
            )

        if was_pending:
            await self.audit.record(
                event_type=AuditEventType.PROVISIONING_RECOVERED,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_label=actor_label,
                target_type="erp_membership",
                target_id=membership.id,
                details={
                    "global_user_id": str(global_user_id),
                    "erp_key": erp_instance.key,
                    "local_user_id": local_user_id,
                    "recovered_from": "PENDING",
                },
            )

        await self.audit.record(
            event_type=AuditEventType.PROVISIONING_SUCCEEDED,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="erp_membership",
            target_id=membership.id,
            details={
                "global_user_id": str(global_user_id),
                "erp_key": erp_instance.key,
                "local_user_id": local_user_id,
                "method": provision_method,
            },
        )

        return membership

    async def retry_membership_provisioning(
        self,
        membership_id: uuid.UUID,
        *,
        actor: PlatformAdmin | Any = None,
    ) -> ErpMembership:
        """
        Retry a pending or failed provisioning operation for an existing membership.
        Recovers from PENDING -> ACTIVE if remote sync succeeds.

        Coordinates with the background reconciliation worker: prevents duplicate
        concurrent runs if a worker actively holds a lease, and claims the task
        for the manual administrator.
        """
        membership = await self.membership_repo.get_by_id(membership_id)
        if membership is None:
            raise NotFoundException(f"ErpMembership {membership_id} not found.")

        if membership.status == ErpMembershipStatus.ACTIVE:
            return membership

        # Concurrency & Lease coordination with background worker (Phase 8)
        recon_repo = ProvisioningReconciliationRepository(self.db)
        task = await recon_repo.get_by_membership_id(membership_id)
        now = datetime.now(timezone.utc)

        if task is not None and task.status == ProvisioningTaskStatus.PROCESSING:
            lease_exp = task.lease_expires_at
            if lease_exp is not None and lease_exp.tzinfo is None:
                lease_exp = lease_exp.replace(tzinfo=timezone.utc)
            if lease_exp and lease_exp > now:
                raise ConflictException(
                    "Provisioning for this membership is currently being processed by the background reconciler. "
                    "Please wait for completion."
                )


        actor_type, actor_id, actor_label = self._extract_actor(actor)
        if task is not None:
            await recon_repo.claim_task(
                task.id,
                f"manual:{actor_label or actor_id or 'admin'}",
                now,
                lease_duration_seconds=getattr(settings, "PROVISIONING_LEASE_DURATION_SECONDS", 60),
            )

        notes = (membership.metadata_json or {}).get("notes")
        target_org_id_str = (membership.metadata_json or {}).get("target_organization_id")
        target_org_id = uuid.UUID(target_org_id_str) if target_org_id_str else None

        try:
            result = await self.provision_global_user_to_erp(
                global_user_id=membership.global_user_id,
                erp_instance_id=membership.erp_instance_id,
                target_organization_id=target_org_id,
                notes=notes,
                actor=actor,
            )
            if task is not None and result.status == ErpMembershipStatus.ACTIVE:
                await recon_repo.release_claim(task.id, ProvisioningTaskStatus.SUCCEEDED)
            return result
        except Exception as exc:
            if task is not None:
                if isinstance(exc, (ErpConflictError, IdentityConflictDetectedError, ConflictException)):
                    await recon_repo.release_claim(
                        task.id,
                        ProvisioningTaskStatus.FAILED,
                        last_error_type="IDENTITY_CONFLICT",
                        last_error_message=str(exc),
                    )
                else:
                    await recon_repo.release_claim(
                        task.id,
                        ProvisioningTaskStatus.FAILED,
                        last_error_type="ERROR",
                        last_error_message=str(exc),
                    )
            raise


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
