"""
ERP Service Credential Service.

Business rules for issuing, verifying, rotating, and revoking ERP service
credentials, plus the heartbeat flow that consumes them.

- `issue` and `rotate` both return the plaintext bearer token exactly
  once, in the same response, and never store it (Phase 3 Step 24).
- `verify` is the single function the heartbeat route (and any future
  service-to-service route) calls to authenticate a caller -- it never
  trusts an ERP UUID/key posted in a request body by itself (Step 26:
  "Do NOT trust a caller simply because it posts an ERP UUID"); identity
  is derived entirely from the credential.
- `revoke` never deletes a row -- a revoked credential remains in the
  table with `revoked_at` set, so "who revoked what, when" stays
  reconstructable from the row plus the audit log.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.core.exceptions import ForbiddenException, NotFoundException, UnauthorizedException
from app.erp_registry.models import ErpInstance, ErpStatus
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.platform_auth.models import PlatformAdmin
from app.service_identity.models import ErpServiceCredential
from app.service_identity.repository import ErpServiceCredentialRepository
from app.service_identity.schemas import ErpServiceCredentialCreate
from app.service_identity.security import (
    generate_credential_identifier,
    generate_service_secret,
    hash_service_secret,
    split_bearer_credential,
    verify_service_secret,
)


class ErpServiceIdentityService:
    """Orchestrates ERP service credential lifecycle and heartbeat verification."""

    def __init__(
        self,
        credential_repository: ErpServiceCredentialRepository,
        instance_repository: ErpInstanceRepository,
        audit: GlobalAuditService,
    ) -> None:
        """Wire the service to its repositories and the global audit service."""
        self.credential_repository = credential_repository
        self.instance_repository = instance_repository
        self.audit = audit

    async def issue(
        self, erp_instance_id: uuid.UUID, payload: ErpServiceCredentialCreate, *, actor: PlatformAdmin
    ) -> tuple[ErpServiceCredential, str]:
        """Issue a brand-new service credential for an ERP instance. Returns (row, plaintext_bearer_token)."""
        erp_instance = await self.instance_repository.get_by_id(erp_instance_id)
        if erp_instance is None:
            raise NotFoundException(f"No ERP instance found with id {erp_instance_id}.")

        identifier = generate_credential_identifier()
        secret = generate_service_secret()
        credential = ErpServiceCredential(
            erp_instance_id=erp_instance.id,
            credential_identifier=identifier,
            secret_hash=hash_service_secret(secret),
            expires_at=payload.expires_at,
        )
        created = await self.credential_repository.create(credential)

        await self.audit.record(
            event_type=AuditEventType.ERP_CREDENTIAL_CREATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_instance",
            target_id=erp_instance.id,
            details={"credential_identifier": identifier},  # never the secret itself
        )
        return created, f"{identifier}.{secret}"

    async def rotate(
        self, erp_instance_id: uuid.UUID, payload: ErpServiceCredentialCreate, *, actor: PlatformAdmin
    ) -> tuple[ErpServiceCredential, str]:
        """
        Issue a new credential for an ERP instance without revoking existing ones.

        Rotation is issuing a new credential, deploying it, verifying it
        works, and only then revoking the old one via `revoke` -- exactly
        the flow Phase 3 Step 25 describes. This method performs the
        "create B" step only; the caller decides when to revoke A.
        """
        created, bearer_token = await self.issue(erp_instance_id, payload, actor=actor)
        await self.audit.record(
            event_type=AuditEventType.ERP_CREDENTIAL_ROTATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_instance",
            target_id=erp_instance_id,
            details={"new_credential_identifier": created.credential_identifier},
        )
        return created, bearer_token

    async def revoke(self, credential_id: uuid.UUID, *, actor: PlatformAdmin) -> ErpServiceCredential:
        """Revoke a service credential. The row remains, with `revoked_at` set."""
        credential = await self.credential_repository.get_by_id(credential_id)
        if credential is None:
            raise NotFoundException(f"No service credential found with id {credential_id}.")

        credential.revoked_at = datetime.now(timezone.utc)
        updated = await self.credential_repository.create(credential)  # flush + refresh

        await self.audit.record(
            event_type=AuditEventType.ERP_CREDENTIAL_REVOKED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="erp_instance",
            target_id=updated.erp_instance_id,
            details={"credential_identifier": updated.credential_identifier},
        )
        return updated

    async def list_for_erp(self, erp_instance_id: uuid.UUID) -> list[ErpServiceCredential]:
        """List every credential (active or not) belonging to an ERP instance."""
        return await self.credential_repository.list_for_erp(erp_instance_id)

    async def verify_bearer_credential(self, bearer_value: str) -> ErpServiceCredential:
        """
        Verify a `<identifier>.<secret>` bearer credential and return its row if valid.

        Raises `UnauthorizedException` for every failure mode (malformed,
        unknown identifier, wrong secret, revoked, expired) so callers
        have exactly one exception to handle and can never distinguish
        "wrong secret" from "unknown identifier" by the error alone.
        """
        split = split_bearer_credential(bearer_value)
        if split is None:
            raise UnauthorizedException("Malformed service credential.")
        identifier, secret = split

        credential = await self.credential_repository.get_by_identifier(identifier)
        if credential is None or not verify_service_secret(secret, credential.secret_hash):
            raise UnauthorizedException("Invalid service credential.")
        if not credential.is_active:
            raise UnauthorizedException("This service credential has been revoked or has expired.")

        return credential

    async def record_heartbeat(
        self, credential: ErpServiceCredential, *, version: str | None, environment: str | None
    ) -> ErpInstance:
        """
        Update `last_seen_at` (and optionally version/environment) for the ERP this credential belongs to.

        Deliberately does NOT touch `status` -- Phase 3 Step 49 is explicit
        that lifecycle status and reachability are separate concerns; a
        heartbeat never auto-activates or auto-decommissions an ERP.
        Also refuses to record a heartbeat for a DECOMMISSIONED ERP, since
        that status means "no longer available for normal access" and a
        heartbeat updating its liveness would contradict that.
        """
        erp_instance = await self.instance_repository.get_by_id(credential.erp_instance_id)
        if erp_instance is None:
            raise NotFoundException("The ERP instance this credential belongs to no longer exists.")
        if erp_instance.status == ErpStatus.DECOMMISSIONED:
            raise ForbiddenException("This ERP instance is decommissioned and cannot send a heartbeat.")

        now = datetime.now(timezone.utc)
        erp_instance.last_seen_at = now
        if version:
            erp_instance.version = version
        if environment:
            erp_instance.environment = environment
        await self.instance_repository.create(erp_instance)  # flush + refresh

        credential.last_used_at = now
        await self.credential_repository.create(credential)  # flush + refresh

        await self.audit.record(
            event_type=AuditEventType.ERP_HEARTBEAT_RECEIVED,
            actor_type=AuditActorType.ERP_SERVICE,
            actor_id=erp_instance.id,
            actor_label=erp_instance.key,
            target_type="erp_instance",
            target_id=erp_instance.id,
            details={"version": version, "environment": environment},
        )
        return erp_instance
