"""
Federation Routes.

Three trust boundaries in this one file (mirroring the same pattern
`app.service_identity.routes` established in Phase 3):

- Discovery/JWKS (`/.well-known/...`): public, no authentication --
  standard OIDC practice, and contains only public key material/metadata
  (Step 4/7).
- Client registration/management: platform-admin gated.
- `/federation/authorize`: Global-User-session gated (Step 19 -- an
  authenticated call, not a raw unauthenticated redirect).
- `/federation/token`: gated by the ERP's own client_id/client_secret in
  the request body, not by any user session -- this is a server-to-
  server call from the target ERP's backend (Step 23).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.responses import build_success_response
from app.federation.dependencies import get_federation_service, get_signing_key_manager
from app.federation.key_manager import SigningKeyManager
from app.federation.schemas import (
    AuthorizeRequest,
    AuthorizeResponse,
    FederationClientCreate,
    FederationClientRead,
    FederationClientSecretIssued,
    FederationClientUpdate,
    OidcDiscoveryDocument,
    TokenExchangeRequest,
    TokenExchangeResponse,
)
from app.federation.service import FederationService
from app.global_auth.dependencies import require_global_user
from app.global_users.models import GlobalUser
from app.platform_authz.dependencies import (
    AuthorizedPrincipal,
    require_authenticated_principal,
    require_platform_permission,
)

discovery_router = APIRouter(tags=["Federation Discovery"])
client_router = APIRouter(prefix="/global/erps/{erp_id}/federation", tags=["Federation Clients"])
flow_router = APIRouter(prefix="/federation", tags=["Federation Flow"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


@discovery_router.get("/.well-known/openid-configuration", summary="OIDC discovery document")
async def discovery(request: Request) -> OidcDiscoveryDocument:
    """
    Return minimal OIDC discovery metadata (Phase 4 Step 4).

    Returned as a plain model (not the usual envelope) since this is a
    standard, externally-consumed OIDC document -- wrapping it would
    break any off-the-shelf OIDC client library trying to parse it.
    """
    from app.core.config import settings

    base = settings.FEDERATION_ISSUER.rstrip("/")
    return OidcDiscoveryDocument(
        issuer=settings.FEDERATION_ISSUER,
        authorization_endpoint=f"{base}{settings.API_V1_PREFIX}/federation/authorize",
        token_endpoint=f"{base}{settings.API_V1_PREFIX}/federation/token",
        jwks_uri=f"{base}{settings.API_V1_PREFIX}/.well-known/jwks.json",
    )


@discovery_router.get("/.well-known/jwks.json", summary="JSON Web Key Set (public keys only)")
async def jwks(key_manager: SigningKeyManager = Depends(get_signing_key_manager)) -> dict:
    """Return the public JWKS document -- PRIVATE key material never leaves this process (Step 7)."""
    await key_manager.ensure_active_key()  # guarantee at least one key exists to publish
    return await key_manager.build_jwks()


@client_router.post(
    "", status_code=status.HTTP_201_CREATED, summary="Register an ERP as a federation client (SUPER_ADMIN)"
)
async def register_client(
    request: Request,
    erp_id: uuid.UUID,
    payload: FederationClientCreate,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.federation.create", erp_scope_param="erp_id")
    ),
    service: FederationService = Depends(get_federation_service),
) -> dict:
    """Register an ERP as an OIDC federation client. The plaintext client_secret is shown only once."""
    client, client_secret = await service.register_client(erp_id, payload, actor=principal)
    response = FederationClientSecretIssued(
        id=client.id,
        client_id=client.client_id,
        client_secret=client_secret,
        redirect_uris=client.redirect_uris,
        federation_enabled=client.federation_enabled,
    )
    return build_success_response(
        response.model_dump(mode="json"),
        request_id=_request_id(request),
        message="Federation client registered. Store the client_secret now -- it will not be shown again.",
    )


@client_router.patch("/{client_row_id}", summary="Update a federation client")
async def update_client(
    request: Request,
    erp_id: uuid.UUID,
    client_row_id: uuid.UUID,
    payload: FederationClientUpdate,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.federation.update", erp_scope_param="erp_id")
    ),
    service: FederationService = Depends(get_federation_service),
) -> dict:
    """Update a federation client's redirect URIs and/or federation_enabled flag (Step 38)."""
    client = await service.update_client(client_row_id, payload, actor=principal)
    return build_success_response(
        FederationClientRead.model_validate(client).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Federation client updated.",
    )


@client_router.get("", summary="Get federation client for an ERP")
async def get_client(
    request: Request,
    erp_id: uuid.UUID,
    _principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: FederationService = Depends(get_federation_service),
) -> dict:
    """Fetch the federation client for an ERP instance. Exposes no secrets."""
    client = await service.client_repository.get_by_erp_instance_id(erp_id)
    if client is None:
        return build_success_response(None, request_id=_request_id(request))
    return build_success_response(
        FederationClientRead.model_validate(client).model_dump(mode="json"),
        request_id=_request_id(request),
    )


@flow_router.post("/authorize", summary="Authorize a launch request for an ERP (Global User session required)")
async def authorize(
    request: Request,
    payload: AuthorizeRequest,
    user_and_session: tuple[GlobalUser, uuid.UUID] = Depends(require_global_user),
    service: FederationService = Depends(get_federation_service),
) -> dict:
    """
    Validate and authorize a Global User's request to launch a specific ERP.

    Requires an authenticated Global User session (Step 19/47) -- never
    a bare, unauthenticated `?erp=key` redirect. Fail-closed at every
    internal check (ERP status, federation-enabled, redirect_uri,
    membership status) -- see `FederationService.authorize`.
    """
    user, _session_id = user_and_session
    auth_request = await service.authorize(payload, global_user_id=user.id)
    response = AuthorizeResponse(
        authorization_code=auth_request.authorization_code,
        state=auth_request.state,
        redirect_uri=auth_request.redirect_uri,
    )
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))


@flow_router.post("/token", summary="Exchange an authorization code for a federation ID token")
async def token(
    request: Request,
    payload: TokenExchangeRequest,
    service: FederationService = Depends(get_federation_service),
) -> dict:
    """
    Exchange a short-lived authorization code for a signed ID token.

    Authenticated by the ERP's own `client_id`/`client_secret` in the
    body (server-to-server call, Step 23) -- no Global User session is
    involved in this specific call.
    """
    id_token, expires_in = await service.exchange_token(payload)
    response = TokenExchangeResponse(id_token=id_token, expires_in=expires_in)
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))
