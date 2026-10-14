"""Organization Routes. Manage the single company profile, gated by ``organization.manage``."""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import RedirectResponse

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common.storage import guess_content_type, save_uploaded_file
from app.core.config import settings
from app.core.exceptions import BadRequestException
from app.core.responses import build_success_response
from app.organizations.dependencies import get_organization_service
from app.organizations.schemas import OrganizationCreate, OrganizationRead, OrganizationUpdate
from app.organizations.service import OrganizationService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/organizations", tags=["Organization"])


async def _record_org_action(
    *,
    audit_service: AuditService,
    request: Request,
    action: AuditAction,
    actor: CurrentUser,
    entity_id: str,
    description: str,
    new_values: dict | None = None,
) -> None:
    """Shared helper: record an organization-profile action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="organizations",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Organization",
        entity_id=entity_id,
        new_values=new_values,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=request.state.request_id,
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=description,
    )
    request.state.audit_logged = True


@router.get("/public", summary="Get public organization branding and ERP identity")
async def get_public_organization_branding(
    request: Request,
    organization_service: OrganizationService = Depends(get_organization_service),
) -> dict:
    """Public endpoint returning company_name, logo_url, logo_data, and erp_id without requiring authentication."""
    try:
        organization = await organization_service.get_or_raise()
        return build_success_response(
            data={
                "company_name": organization.company_name,
                "legal_name": organization.legal_name,
                "logo_url": organization.logo_url,
                "logo_data": organization.logo_data,
                "erp_id": settings.ERP_INSTANCE_ID,
            },
            request_id=request.state.request_id,
        )
    except Exception:
        return build_success_response(
            data={
                "company_name": "ERP",
                "legal_name": None,
                "logo_url": None,
                "logo_data": None,
                "erp_id": settings.ERP_INSTANCE_ID,
            },
            request_id=request.state.request_id,
        )


@router.get("/logo", summary="Direct public organization logo image")
async def get_organization_logo_image(
    organization_service: OrganizationService = Depends(get_organization_service),
) -> Response:
    """Direct image endpoint serving the company logo from DB storage or redirecting to file URL."""
    try:
        organization = await organization_service.get_or_raise()
    except Exception:
        raise HTTPException(status_code=404, detail="No organization logo found.")

    if organization.logo_data and organization.logo_data.startswith("data:"):
        try:
            header, encoded = organization.logo_data.split(",", 1)
            mime = header.split(";")[0].replace("data:", "") or "image/png"
            image_bytes = base64.b64decode(encoded)
            return Response(content=image_bytes, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})
        except Exception:
            pass

    if organization.logo_url:
        return RedirectResponse(url=organization.logo_url)

    raise HTTPException(status_code=404, detail="Logo not found.")


@router.get("", summary="Get the organization profile")
async def get_organization(
    request: Request,
    organization_service: OrganizationService = Depends(get_organization_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Fetch the single company profile. Accessible by all authenticated users for branding."""
    organization = await organization_service.get_or_raise()
    data = OrganizationRead.model_validate(organization).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create the organization profile")
async def create_organization(
    payload: OrganizationCreate,
    request: Request,
    organization_service: OrganizationService = Depends(get_organization_service),
    current_user: CurrentUser = Depends(require_permission("organization.manage")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Create the organization profile. Only one may ever exist."""
    organization = await organization_service.create(**payload.model_dump())
    data = OrganizationRead.model_validate(organization).model_dump(mode="json")
    await _record_org_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=str(organization.id),
        description=f"Created organization profile for {organization.company_name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


ALLOWED_LOGO_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif", "svg"}
MAX_LOGO_SIZE = 5 * 1024 * 1024  # 5 MB


@router.patch("", summary="Update the organization profile")
async def update_organization(
    payload: OrganizationUpdate,
    request: Request,
    organization_service: OrganizationService = Depends(get_organization_service),
    current_user: CurrentUser = Depends(require_permission("organization.manage")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Update the organization profile's fields. Restricted to Super Administrators."""
    update_data = payload.model_dump(exclude_unset=True)
    organization = await organization_service.update(**update_data)
    data = OrganizationRead.model_validate(organization).model_dump(mode="json")
    await _record_org_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=str(organization.id),
        description=f"Updated organization profile for {organization.company_name!r}.",
        new_values=update_data,
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/logo", summary="Upload organization logo")
async def upload_organization_logo(
    request: Request,
    file: UploadFile = File(...),
    organization_service: OrganizationService = Depends(get_organization_service),
    current_user: CurrentUser = Depends(require_permission("organization.manage")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Upload and set company / ERP logo. Stored directly in DB storage and static file storage."""
    content = await file.read()
    if not content:
        raise BadRequestException("Uploaded image file is empty.")
    if len(content) > MAX_LOGO_SIZE:
        raise BadRequestException("Logo image file size must not exceed 5 MB.")

    filename = file.filename or "logo.png"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_LOGO_EXTENSIONS:
        raise BadRequestException(
            f"Unsupported image format '.{ext}'. Allowed formats: PNG, JPG, JPEG, WEBP, GIF, SVG."
        )

    mime = file.content_type or guess_content_type(filename)
    b64_content = base64.b64encode(content).decode("ascii")
    data_uri = f"data:{mime};base64,{b64_content}"

    public_url, _ = await save_uploaded_file(
        content=content,
        original_filename=filename,
        bucket="public-assets",
        local_subfolder="branding",
        content_type=mime,
    )

    organization = await organization_service.update(logo_url=public_url, logo_data=data_uri)
    org_data = OrganizationRead.model_validate(organization).model_dump(mode="json")

    await _record_org_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=str(organization.id),
        description=f"Uploaded logo for organization {organization.company_name!r}.",
        new_values={"logo_url": public_url, "has_logo_data": True},
    )

    return build_success_response(
        data={
            "logo_url": organization.logo_url,
            "logo_data": organization.logo_data,
            "organization": org_data,
        },
        request_id=request.state.request_id,
        message="Logo uploaded and saved to DB storage successfully.",
    )


@router.delete("/logo", summary="Remove organization logo")
async def delete_organization_logo(
    request: Request,
    organization_service: OrganizationService = Depends(get_organization_service),
    current_user: CurrentUser = Depends(require_permission("organization.manage")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Remove company / ERP logo. Restricted to Super Administrators."""
    organization = await organization_service.update(logo_url=None, logo_data=None)
    org_data = OrganizationRead.model_validate(organization).model_dump(mode="json")

    await _record_org_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=str(organization.id),
        description=f"Removed logo for organization {organization.company_name!r}.",
        new_values={"logo_url": None, "logo_data": None},
    )

    return build_success_response(
        data={
            "logo_url": None,
            "logo_data": None,
            "organization": org_data,
        },
        request_id=request.state.request_id,
        message="Logo removed successfully.",
    )
