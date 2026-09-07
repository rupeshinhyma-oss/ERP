"""
ERP Registry Routes.

Endpoint layout follows the Phase 2 brief's suggested shape (Step 8),
mounted under `/global/erps` since this is a global-control-plane concern,
not a `/erps` top-level resource that might collide with future
ERP-scoped APIs.

`DELETE /global/erps/{erp_id}` is intentionally a decommission (status
change), not a row deletion -- see `service.py::decommission` and Phase 2
Step 3/8.

Phase 3 authorization (Step 21): every mutating route now requires an
authenticated platform admin (`require_platform_admin`). Read routes
(`GET`) remain open -- registry metadata (which ERPs exist, their status,
declared capabilities) is the kind of directory information a future
ERP-launcher UI needs before a user has even logged into the control
plane, and it contains no secrets, credentials, or business data. This is
a deliberate choice, not an oversight; revisit if that assumption changes.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.responses import build_success_response
from app.erp_registry.dependencies import get_erp_registry_service
from app.erp_registry.schemas import (
    ErpInstanceCreate,
    ErpInstanceRead,
    ErpInstanceUpdate,
    ErpModuleCreate,
    ErpModuleRead,
    ErpStatusUpdate,
)
from app.erp_registry.service import ErpRegistryService
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.platform_auth.dependencies import require_platform_admin
from app.platform_auth.models import PlatformAdmin

router = APIRouter(prefix="/global/erps", tags=["ERP Registry"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


@router.post("", status_code=status.HTTP_201_CREATED, summary="Register a new ERP instance")
async def register_erp(
    request: Request,
    payload: ErpInstanceCreate,
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpRegistryService = Depends(get_erp_registry_service),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> dict:
    """Register a new ERP instance in the global registry. Requires an authenticated platform admin."""
    erp_instance = await service.register(payload)
    await audit.record(
        event_type=AuditEventType.ERP_REGISTERED,
        actor_type=AuditActorType.HUMAN_ADMIN,
        actor_id=admin.id,
        actor_label=admin.email,
        target_type="erp_instance",
        target_id=erp_instance.id,
        details={"key": erp_instance.key, "status": erp_instance.status.value},
    )
    return build_success_response(
        ErpInstanceRead.model_validate(erp_instance).model_dump(mode="json"),
        request_id=_request_id(request),
        message="ERP instance registered.",
    )


@router.get("", summary="List all registered ERP instances")
async def list_erps(request: Request, service: ErpRegistryService = Depends(get_erp_registry_service)) -> dict:
    """List every ERP instance in the registry. Read-only; no authentication required (see module docstring)."""
    erp_instances = await service.list_all()
    data = [ErpInstanceRead.model_validate(e).model_dump(mode="json") for e in erp_instances]
    return build_success_response(data, request_id=_request_id(request))


@router.get("/by-key/{key}", summary="Fetch an ERP instance by its stable key")
async def get_erp_by_key(
    request: Request, key: str, service: ErpRegistryService = Depends(get_erp_registry_service)
) -> dict:
    """Fetch a single ERP instance by its machine-readable key (e.g. 'yinglima'). Read-only."""
    erp_instance = await service.get_by_key(key)
    return build_success_response(
        ErpInstanceRead.model_validate(erp_instance).model_dump(mode="json"), request_id=_request_id(request)
    )


@router.get("/{erp_id}", summary="Fetch an ERP instance by internal id")
async def get_erp(
    request: Request, erp_id: uuid.UUID, service: ErpRegistryService = Depends(get_erp_registry_service)
) -> dict:
    """Fetch a single ERP instance by its internal UUID. Read-only."""
    erp_instance = await service.get(erp_id)
    return build_success_response(
        ErpInstanceRead.model_validate(erp_instance).model_dump(mode="json"), request_id=_request_id(request)
    )


@router.patch("/{erp_id}", summary="Update ERP instance metadata")
async def update_erp(
    request: Request,
    erp_id: uuid.UUID,
    payload: ErpInstanceUpdate,
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpRegistryService = Depends(get_erp_registry_service),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> dict:
    """Update non-identity metadata (name, display_name, description, base_url, ...) for an ERP instance."""
    erp_instance = await service.update_metadata(erp_id, payload)
    await audit.record(
        event_type=AuditEventType.ERP_UPDATED,
        actor_type=AuditActorType.HUMAN_ADMIN,
        actor_id=admin.id,
        actor_label=admin.email,
        target_type="erp_instance",
        target_id=erp_instance.id,
        details={"fields_updated": sorted(payload.model_dump(exclude_unset=True).keys())},
    )
    return build_success_response(
        ErpInstanceRead.model_validate(erp_instance).model_dump(mode="json"),
        request_id=_request_id(request),
        message="ERP instance updated.",
    )


@router.patch("/{erp_id}/status", summary="Change an ERP instance's status")
async def change_erp_status(
    request: Request,
    erp_id: uuid.UUID,
    payload: ErpStatusUpdate,
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpRegistryService = Depends(get_erp_registry_service),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> dict:
    """Change an ERP instance's lifecycle status (ACTIVE/INACTIVE/MAINTENANCE/SUSPENDED/DECOMMISSIONED)."""
    old_status = (await service.get(erp_id)).status.value
    erp_instance = await service.change_status(erp_id, payload.status)
    await audit.record(
        event_type=AuditEventType.ERP_STATUS_CHANGED,
        actor_type=AuditActorType.HUMAN_ADMIN,
        actor_id=admin.id,
        actor_label=admin.email,
        target_type="erp_instance",
        target_id=erp_instance.id,
        details={"old_status": old_status, "new_status": erp_instance.status.value},
    )
    return build_success_response(
        ErpInstanceRead.model_validate(erp_instance).model_dump(mode="json"),
        request_id=_request_id(request),
        message="ERP instance status updated.",
    )


@router.delete("/{erp_id}", summary="Decommission an ERP instance (controlled, non-destructive)")
async def decommission_erp(
    request: Request,
    erp_id: uuid.UUID,
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpRegistryService = Depends(get_erp_registry_service),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> dict:
    """
    Decommission an ERP instance.

    Sets status to DECOMMISSIONED. Does NOT delete the row, its history,
    or its declared modules -- see Phase 2 Step 3.
    """
    erp_instance = await service.decommission(erp_id)
    await audit.record(
        event_type=AuditEventType.ERP_DECOMMISSIONED,
        actor_type=AuditActorType.HUMAN_ADMIN,
        actor_id=admin.id,
        actor_label=admin.email,
        target_type="erp_instance",
        target_id=erp_instance.id,
        details={"key": erp_instance.key},
    )
    return build_success_response(
        ErpInstanceRead.model_validate(erp_instance).model_dump(mode="json"),
        request_id=_request_id(request),
        message="ERP instance decommissioned.",
    )


@router.post("/{erp_id}/modules", status_code=status.HTTP_201_CREATED, summary="Declare a module/capability")
async def declare_module(
    request: Request,
    erp_id: uuid.UUID,
    payload: ErpModuleCreate,
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpRegistryService = Depends(get_erp_registry_service),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> dict:
    """Declare (or update, if module_key already exists) a capability/module for an ERP instance."""
    module = await service.declare_module(erp_id, payload)
    await audit.record(
        event_type=AuditEventType.CAPABILITY_UPDATED,
        actor_type=AuditActorType.HUMAN_ADMIN,
        actor_id=admin.id,
        actor_label=admin.email,
        target_type="erp_instance",
        target_id=erp_id,
        details={"module_key": module.module_key, "enabled": module.enabled},
    )
    return build_success_response(
        ErpModuleRead.model_validate(module).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Module declared.",
    )
