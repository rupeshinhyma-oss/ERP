"""
ERP Service Identity Routes.

Two distinct trust boundaries in this one file, matching Phase 3 Step 22
("humans and ERP servers are different security principals"):

- Credential issuance/rotation/revocation/listing: gated by
  `require_platform_permission(...)` (Phase 5) -- a human, or a
  GlobalUser holding the matching permission, decides when an ERP gets a
  new credential. Additive over Phase 3's `require_platform_admin`: a
  PlatformAdmin still satisfies every one of these checks exactly as
  before.
- The heartbeat endpoint: gated by `require_erp_service` -- only a
  caller presenting a valid service credential can post a heartbeat, and
  the ERP identity is derived entirely from that credential, never from
  the `{erp_id}` path parameter alone (Step 26). Untouched by Phase 5 --
  this is a machine-to-machine credential, not a human/GlobalUser check.

Every `require_platform_permission(...)` call below passes
`erp_scope_param="erp_id"` so a GlobalUser holding an ERP-SCOPED grant
(rather than a GLOBAL one) is correctly recognized for the specific ERP
named in the path, matching Phase 5 Section 9/28's scoping rules.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.exceptions import ForbiddenException
from app.core.responses import build_success_response
from app.platform_authz.dependencies import AuthorizedPrincipal, require_platform_permission
from app.service_identity.dependencies import get_service_identity_service, require_erp_service
from app.service_identity.models import ErpServiceCredential
from app.service_identity.schemas import (
    ErpHeartbeatRequest,
    ErpHeartbeatResponse,
    ErpServiceCredentialCreate,
    ErpServiceCredentialIssued,
    ErpServiceCredentialRead,
)
from app.service_identity.service import ErpServiceIdentityService

router = APIRouter(prefix="/global/erps/{erp_id}", tags=["ERP Service Identity"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


@router.post(
    "/credentials", status_code=status.HTTP_201_CREATED, summary="Issue a new service credential (SUPER_ADMIN only)"
)
async def issue_credential(
    request: Request,
    erp_id: uuid.UUID,
    payload: ErpServiceCredentialCreate,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.service_identity.create", erp_scope_param="erp_id")
    ),
    service: ErpServiceIdentityService = Depends(get_service_identity_service),
) -> dict:
    """Issue a brand-new service credential for an ERP instance. The plaintext token is shown only once."""
    credential, bearer_token = await service.issue(erp_id, payload, actor=principal)
    response = ErpServiceCredentialIssued(
        id=credential.id,
        credential_identifier=credential.credential_identifier,
        bearer_token=bearer_token,
        expires_at=credential.expires_at,
        created_at=credential.created_at,
    )
    return build_success_response(
        response.model_dump(mode="json"),
        request_id=_request_id(request),
        message="Service credential issued. Store the bearer_token now -- it will not be shown again.",
    )


@router.post("/credentials/rotate", status_code=status.HTTP_201_CREATED, summary="Rotate service credential")
async def rotate_credential(
    request: Request,
    erp_id: uuid.UUID,
    payload: ErpServiceCredentialCreate,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.service_identity.rotate", erp_scope_param="erp_id")
    ),
    service: ErpServiceIdentityService = Depends(get_service_identity_service),
) -> dict:
    """
    Issue a new credential without revoking existing ones.

    Deploy the new credential, verify it works, then call
    `POST /credentials/{credential_id}/revoke` on the old one -- see
    Phase 3 Step 25's rotation flow.
    """
    credential, bearer_token = await service.rotate(erp_id, payload, actor=principal)
    response = ErpServiceCredentialIssued(
        id=credential.id,
        credential_identifier=credential.credential_identifier,
        bearer_token=bearer_token,
        expires_at=credential.expires_at,
        created_at=credential.created_at,
    )
    return build_success_response(
        response.model_dump(mode="json"),
        request_id=_request_id(request),
        message="New credential issued. The previous credential(s) remain active until explicitly revoked.",
    )


@router.get("/credentials", summary="List service credentials for an ERP instance")
async def list_credentials(
    request: Request,
    erp_id: uuid.UUID,
    _principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.service_identity.read", erp_scope_param="erp_id")
    ),
    service: ErpServiceIdentityService = Depends(get_service_identity_service),
) -> dict:
    """List every service credential (active or not) for an ERP instance. Never includes secrets or hashes."""
    credentials = await service.list_for_erp(erp_id)
    data = [ErpServiceCredentialRead.model_validate(c).model_dump(mode="json") for c in credentials]
    return build_success_response(data, request_id=_request_id(request))


@router.post("/credentials/{credential_id}/revoke", summary="Revoke a service credential")
async def revoke_credential(
    request: Request,
    erp_id: uuid.UUID,
    credential_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.service_identity.revoke", erp_scope_param="erp_id")
    ),
    service: ErpServiceIdentityService = Depends(get_service_identity_service),
) -> dict:
    """Revoke a service credential. The row remains for audit history; only `revoked_at` is set."""
    credential = await service.revoke(credential_id, actor=principal)
    return build_success_response(
        ErpServiceCredentialRead.model_validate(credential).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Service credential revoked.",
    )


@router.post("/heartbeat", summary="ERP service heartbeat (service-credential authenticated)")
async def heartbeat(
    request: Request,
    erp_id: uuid.UUID,
    payload: ErpHeartbeatRequest,
    credential: ErpServiceCredential = Depends(require_erp_service),
    service: ErpServiceIdentityService = Depends(get_service_identity_service),
) -> dict:
    """
    Record a heartbeat from an ERP's own backend.

    The `{erp_id}` path parameter is NOT trusted as the caller's
    identity -- `credential.erp_instance_id` (resolved from the verified
    service credential) is. If a caller presents a valid credential for a
    *different* ERP than the one named in the path, that's rejected: a
    credential authenticates its own ERP and no other.
    """
    if credential.erp_instance_id != erp_id:
        raise ForbiddenException("This service credential does not belong to the ERP instance in the request path.")

    erp_instance = await service.record_heartbeat(
        credential, version=payload.version, environment=payload.environment
    )
    response = ErpHeartbeatResponse(
        erp_instance_id=erp_instance.id, erp_key=erp_instance.key, last_seen_at=erp_instance.last_seen_at
    )
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))
