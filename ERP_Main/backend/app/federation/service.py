"""
Federation Service.

Business rules for the OIDC-flavored authorization-code flow (Phase 4
Steps 16-27, 53):

- `register_client` / `update_client`: ERP client registration, exact
  redirect URI allow-listing (Step 17).
- `authorize`: the Global User has selected an ERP to launch. Verifies
  (in order, fail-closed at every step, Step 53): the ERP exists and is
  not DECOMMISSIONED; the ERP has federation enabled; the redirect_uri
  exactly matches one pre-registered for that client; the Global User
  holds an ACTIVE membership for that ERP. Issues a short-lived,
  single-use authorization code.
- `exchange_token`: the ERP calls this with the code + its own client
  credentials. Verifies client_id/client_secret, the code's existence/
  freshness/single-use status, the redirect_uri matches exactly what was
  authorized, and (if present) the PKCE code_verifier. Issues the signed
  ID token whose `aud` is that ERP's `client_id` and whose `sub` is the
  Global User's own id (Step 14) -- never their local_user_id, which the
  target ERP resolves for itself via its own ErpMembership lookup
  (Step 24), not from anything in this token.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException, UnauthorizedException
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_registry.models import ErpStatus
from app.erp_registry.repository import ErpInstanceRepository
from app.federation.key_manager import SigningKeyManager
from app.federation.models import AuthorizationRequest, FederationClient
from app.federation.repository import AuthorizationRequestRepository, FederationClientRepository
from app.federation.schemas import (
    AuthorizeRequest,
    FederationClientCreate,
    FederationClientUpdate,
    TokenExchangeRequest,
)
from app.federation.security import create_id_token, verify_pkce
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.platform_auth.models import PlatformAdmin
from app.platform_auth.security import hash_password as _hash_secret
from app.platform_auth.security import verify_password as _verify_secret


def _generate_client_id(erp_key: str) -> str:
    """Build a public client_id from the ERP's own key, plus a short random suffix for uniqueness."""
    return f"{erp_key}-{secrets.token_hex(4)}"


def _hash_client_secret(plain_secret: str) -> str:
    """Hash a plaintext client secret with Argon2id, peppered with FEDERATION_CLIENT_SECRET_PEPPER."""
    return _hash_secret(plain_secret + settings.FEDERATION_CLIENT_SECRET_PEPPER)


def _verify_client_secret(plain_secret: str, secret_hash: str) -> bool:
    """Verify a plaintext client secret against its peppered Argon2id hash."""
    return _verify_secret(plain_secret + settings.FEDERATION_CLIENT_SECRET_PEPPER, secret_hash)


class FederationService:
    """Orchestrates federation client registration and the authorization-code flow."""

    def __init__(
        self,
        client_repository: FederationClientRepository,
        erp_instance_repository: ErpInstanceRepository,
        membership_repository: ErpMembershipRepository,
        authorization_repository: AuthorizationRequestRepository,
        key_manager: SigningKeyManager,
        audit: GlobalAuditService,
    ) -> None:
        """Wire the service to its repositories, the signing key manager, and the global audit service."""
        self.client_repository = client_repository
        self.erp_instance_repository = erp_instance_repository
        self.membership_repository = membership_repository
        self.authorization_repository = authorization_repository
        self.key_manager = key_manager
        self.audit = audit

    async def register_client(
        self, erp_instance_id: uuid.UUID, payload: FederationClientCreate, *, actor: PlatformAdmin
    ) -> tuple[FederationClient, str]:
        """Register an ERP as a federation client. Returns (row, plaintext_client_secret)."""
        erp_instance = await self.erp_instance_repository.get_by_id(erp_instance_id)
        if erp_instance is None:
            raise NotFoundException(f"No ERP instance found with id {erp_instance_id}.")

        existing = await self.client_repository.get_by_erp_instance_id(erp_instance_id)
        if existing is not None:
            raise ConflictException(f"ERP {erp_instance.key!r} is already registered as a federation client.")

        client_secret = secrets.token_urlsafe(32)
        client = FederationClient(
            erp_instance_id=erp_instance.id,
            client_id=_generate_client_id(erp_instance.key),
            client_secret_hash=_hash_client_secret(client_secret),
            redirect_uris=payload.redirect_uris,
            federation_enabled=payload.federation_enabled,
        )
        created = await self.client_repository.create(client)
        await self.audit.record(
            event_type=AuditEventType.FEDERATION_CLIENT_REGISTERED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="federation_client",
            target_id=created.id,
            details={"erp_key": erp_instance.key, "client_id": created.client_id},
        )
        return created, client_secret

    async def update_client(
        self, client_row_id: uuid.UUID, payload: FederationClientUpdate, *, actor: PlatformAdmin
    ) -> FederationClient:
        """Update a federation client's redirect URIs and/or federation_enabled flag."""
        client = await self.client_repository.get_by_id(client_row_id)
        if client is None:
            raise NotFoundException(f"No federation client found with id {client_row_id}.")

        updates = payload.model_dump(exclude_unset=True)
        for field, value in updates.items():
            setattr(client, field, value)
        await self.client_repository.create(client)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.FEDERATION_CLIENT_UPDATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor.id,
            actor_label=actor.email,
            target_type="federation_client",
            target_id=client.id,
            details={"fields_updated": sorted(updates.keys())},
        )
        return client

    async def authorize(self, payload: AuthorizeRequest, *, global_user_id: uuid.UUID) -> AuthorizationRequest:
        """
        Validate an authorization request and issue a short-lived, single-use authorization code.

        Fail-closed at every step (Phase 4 Step 53): any failure raises
        immediately, denying access, with no fallback "allow anyway."
        """
        erp_instance = await self.erp_instance_repository.get_by_id(payload.erp_instance_id)
        if erp_instance is None:
            raise NotFoundException(f"No ERP instance found with id {payload.erp_instance_id}.")
        if erp_instance.status == ErpStatus.DECOMMISSIONED:
            await self._deny(erp_instance.id, global_user_id, "erp_decommissioned")
            raise ForbiddenException("This ERP is decommissioned and cannot be launched.")

        client = await self.client_repository.get_by_erp_instance_id(erp_instance.id)
        if client is None or not client.federation_enabled:
            await self._deny(erp_instance.id, global_user_id, "federation_not_enabled")
            raise ForbiddenException("Federation is not enabled for this ERP.")

        if payload.redirect_uri not in client.redirect_uris:
            await self.audit.record(
                event_type=AuditEventType.SECURITY_INVALID_REDIRECT_URI,
                actor_type=AuditActorType.SYSTEM,
                actor_id=global_user_id,
                target_type="federation_client",
                target_id=client.id,
                details={"attempted_redirect_uri": payload.redirect_uri},
            )
            raise ForbiddenException("redirect_uri is not registered for this client.")

        membership = await self.membership_repository.get_by_user_and_erp(global_user_id, erp_instance.id)
        if membership is None or membership.status != ErpMembershipStatus.ACTIVE:
            await self._deny(erp_instance.id, global_user_id, "membership_not_active")
            raise ForbiddenException("You do not have an active membership for this ERP.")

        if payload.code_challenge is not None and payload.code_challenge_method != "S256":
            raise ForbiddenException("Only the S256 PKCE method is supported.")

        now = datetime.now(timezone.utc)
        authorization_code = secrets.token_urlsafe(32)
        auth_request = AuthorizationRequest(
            global_user_id=global_user_id,
            federation_client_id=client.id,
            authorization_code=authorization_code,
            redirect_uri=payload.redirect_uri,
            state=payload.state,
            nonce=payload.nonce,
            code_challenge=payload.code_challenge,
            code_challenge_method=payload.code_challenge_method,
            expires_at=now + timedelta(seconds=settings.FEDERATION_AUTHORIZATION_CODE_EXPIRE_SECONDS),
        )
        created = await self.authorization_repository.create(auth_request)
        await self.audit.record(
            event_type=AuditEventType.FEDERATION_STARTED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=global_user_id,
            target_type="erp_instance",
            target_id=erp_instance.id,
            details={"erp_key": erp_instance.key},
        )
        return created

    async def _deny(self, erp_instance_id: uuid.UUID, global_user_id: uuid.UUID, reason: str) -> None:
        """Record a MEMBERSHIP_ACCESS_DENIED audit entry (Phase 4 Step 40/53)."""
        await self.audit.record(
            event_type=AuditEventType.MEMBERSHIP_ACCESS_DENIED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=global_user_id,
            target_type="erp_instance",
            target_id=erp_instance_id,
            details={"reason": reason},
        )

    async def _reverify_membership(self, auth_request: AuthorizationRequest) -> ErpMembership:
        """Re-verify the membership is still ACTIVE at token-exchange time (see exchange_token comment)."""
        client = await self.client_repository.get_by_id(auth_request.federation_client_id)
        membership = await self.membership_repository.get_by_user_and_erp(
            auth_request.global_user_id, client.erp_instance_id
        )
        if membership is None or membership.status != ErpMembershipStatus.ACTIVE:
            await self.audit.record(
                event_type=AuditEventType.FEDERATION_FAILURE,
                actor_type=AuditActorType.SYSTEM,
                actor_id=auth_request.global_user_id,
                details={"reason": "membership_no_longer_active_at_exchange"},
            )
            raise ForbiddenException("Membership is no longer active.")
        return membership

    async def exchange_token(self, payload: TokenExchangeRequest) -> tuple[str, int]:
        """
        Exchange an authorization code for a signed federation ID token.

        Returns (id_token, expires_in_seconds). Fail-closed at every
        step; every failure is a generic 401/403 to the caller so no
        step leaks which specific check failed (Step 53).
        """
        client = await self.client_repository.get_by_client_id(payload.client_id)
        if client is None or not _verify_client_secret(payload.client_secret, client.client_secret_hash):
            await self.audit.record(
                event_type=AuditEventType.SECURITY_INVALID_CLIENT,
                actor_type=AuditActorType.SYSTEM,
                actor_label=payload.client_id,
            )
            raise UnauthorizedException("Invalid client credentials.")

        auth_request = await self.authorization_repository.get_by_code(payload.code)
        if auth_request is None or auth_request.federation_client_id != client.id:
            await self.audit.record(
                event_type=AuditEventType.SECURITY_REPLAY_ATTEMPT,
                actor_type=AuditActorType.SYSTEM,
                actor_label=payload.client_id,
                details={"reason": "unknown_or_mismatched_code"},
            )
            raise UnauthorizedException("Invalid or unknown authorization code.")

        if auth_request.code_used_at is not None:
            await self.audit.record(
                event_type=AuditEventType.SECURITY_REPLAY_ATTEMPT,
                actor_type=AuditActorType.SYSTEM,
                actor_id=auth_request.global_user_id,
                target_type="federation_client",
                target_id=client.id,
                details={"reason": "code_already_used"},
            )
            raise UnauthorizedException("This authorization code has already been used.")

        now = datetime.now(timezone.utc)
        expires_at = auth_request.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= now:
            await self.audit.record(
                event_type=AuditEventType.SECURITY_EXPIRED_TOKEN,
                actor_type=AuditActorType.SYSTEM,
                actor_id=auth_request.global_user_id,
                details={"reason": "authorization_code_expired"},
            )
            raise UnauthorizedException("This authorization code has expired.")

        if auth_request.redirect_uri != payload.redirect_uri:
            await self.audit.record(
                event_type=AuditEventType.SECURITY_INVALID_REDIRECT_URI,
                actor_type=AuditActorType.SYSTEM,
                actor_id=auth_request.global_user_id,
                details={"reason": "redirect_uri_mismatch_at_token_exchange"},
            )
            raise UnauthorizedException("redirect_uri does not match the original authorization request.")

        if auth_request.code_challenge is not None:
            if payload.code_verifier is None or not verify_pkce(
                code_verifier=payload.code_verifier,
                code_challenge=auth_request.code_challenge,
                method=auth_request.code_challenge_method or "",
            ):
                await self.audit.record(
                    event_type=AuditEventType.SECURITY_REPLAY_ATTEMPT,
                    actor_type=AuditActorType.SYSTEM,
                    actor_id=auth_request.global_user_id,
                    details={"reason": "pkce_verification_failed"},
                )
                raise UnauthorizedException("PKCE verification failed.")

        # Re-verify membership at exchange time too, not just at
        # authorize time -- a membership could have been revoked in the
        # (short) window between the two calls, and Step 53 requires
        # fail-closed behavior at every step, not just the first one.
        await self._reverify_membership(auth_request)

        auth_request.code_used_at = now
        await self.authorization_repository.create(auth_request)  # flush + refresh, marks single-use

        issued = await create_id_token(
            key_manager=self.key_manager,
            global_user_id=auth_request.global_user_id,
            audience_client_id=client.client_id,
            nonce=auth_request.nonce,
        )

        await self.audit.record(
            event_type=AuditEventType.TOKEN_ISSUED,
            actor_type=AuditActorType.SYSTEM,
            actor_id=auth_request.global_user_id,
            target_type="federation_client",
            target_id=client.id,
            details={"jti": issued.jti},
        )
        await self.audit.record(
            event_type=AuditEventType.FEDERATION_SUCCESS,
            actor_type=AuditActorType.SYSTEM,
            actor_id=auth_request.global_user_id,
            target_type="federation_client",
            target_id=client.id,
        )
        return issued.token, settings.FEDERATION_ID_TOKEN_EXPIRE_MINUTES * 60
