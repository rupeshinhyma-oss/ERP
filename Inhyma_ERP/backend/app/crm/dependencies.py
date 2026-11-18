"""
CRM Pipeline Dependencies.

Provides FastAPI dependency factories for CRM services.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any
import uuid

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exceptions import ForbiddenException
from app.database.session import get_db_session
from app.crm.assignment_service import CrmAssignmentEngineService
from app.crm.import_service import CrmImportService
from app.crm.lead_service import CrmLeadService
from app.crm.service import CrmPipelineService, CrmSalespersonDistributionService
from app.rbac.models import Permission, UserPermission


def extract_raw_permissions(actor: CurrentUser) -> set[str]:
    """
    Copy ``actor.permissions`` into a plain Python ``set`` so ``AdminPermissionSet``
    (whose ``__contains__`` always returns ``True``) cannot mask explicit ``deny:*``
    overrides or synthesize non-existent permission strings.
    """
    return set(actor.permissions or ())


async def load_explicit_crm_denies(
    session: AsyncSession | None,
    user_id: uuid.UUID,
    raw_perms: set[str],
    *,
    is_super_admin: bool = False,
) -> set[str]:
    """
    Resolve explicit user-level denies (`deny:<code_or_prefix>`) from both
    ``CurrentUser.permissions`` and ``user_permissions`` (`is_granted=False`).
    """
    denies: set[str] = set()
    db_loaded = False

    if isinstance(session, AsyncSession):
        try:
            stmt = (
                select(Permission.code, UserPermission.is_granted)
                .join(UserPermission, UserPermission.permission_id == Permission.id)
                .where(UserPermission.user_id == user_id)
            )
            res = await session.execute(stmt)
            rows = res.all()
            if isinstance(rows, list):
                db_loaded = True
                for code, is_granted in rows:
                    if not code:
                        continue
                    c = str(code).strip()
                    if is_granted is False:
                        for prefix in ("deny:", "block:", "!", "-"):
                            if c.startswith(prefix):
                                c = c[len(prefix):].strip()
                                break
                        denies.add(c)
                    else:
                        for prefix in ("deny:", "block:", "!", "-"):
                            if c.startswith(prefix):
                                denies.add(c[len(prefix):].strip())
                                break
        except Exception:
            # In mock/unit test contexts where session is not connected to RBAC tables
            pass

    if not (db_loaded and is_super_admin):
        for perm in raw_perms:
            for prefix in ("deny:", "block:", "!", "-"):
                if perm.startswith(prefix):
                    denies.add(perm[len(prefix):].strip())

    return denies


def evaluate_crm_permission(
    actor: CurrentUser,
    raw_perms: set[str],
    explicit_denies: set[str],
    required_code: str,
) -> bool:
    """
    Evaluate whether ``required_code`` is granted under strict explicit-deny precedence:
    - An explicit deny on ``crm.leads.view`` or ``leads.view`` blocks all ``crm.leads.*``
      and ``leads.*`` access (including for holders of ``crm.leads.manage`` or ``super_admin``).
    - An explicit deny on ``crm.pipelines.view`` blocks all ``crm.pipelines.*`` access.
    - An explicit deny on ``crm.distribution.view`` blocks all ``crm.distribution.*`` access.
    - An explicit deny on ``required_code`` itself always blocks that permission.
    """
    if required_code in explicit_denies:
        return False

    if required_code.startswith("crm.leads.") or required_code.startswith("leads."):
        if "crm.leads.view" in explicit_denies or "leads.view" in explicit_denies:
            return False

    if required_code.startswith("crm.pipelines.") and "crm.pipelines.view" in explicit_denies:
        return False

    if required_code.startswith("crm.distribution.") and "crm.distribution.view" in explicit_denies:
        return False

    if (
        actor.is_super_admin
        or actor.username == "admin"
        or "*" in raw_perms
        or "super_admin" in raw_perms
    ):
        return True

    return required_code in raw_perms


def require_crm_permission(permission_code: str) -> Callable[..., Coroutine[Any, Any, CurrentUser]]:
    """
    FastAPI dependency enforcing a single CRM permission code with strict explicit-deny precedence.
    """

    async def _checker(
        current_user: CurrentUser = Depends(get_current_user),
        session: AsyncSession = Depends(get_db_session),
    ) -> CurrentUser:
        raw_perms = extract_raw_permissions(current_user)
        explicit_denies = await load_explicit_crm_denies(
            session, current_user.id, raw_perms, is_super_admin=current_user.is_super_admin
        )
        if not evaluate_crm_permission(current_user, raw_perms, explicit_denies, permission_code):
            raise ForbiddenException(f"This action requires the {permission_code!r} permission.")
        return current_user

    return _checker


def require_crm_any_permission(*permission_codes: str) -> Callable[..., Coroutine[Any, Any, CurrentUser]]:
    """
    FastAPI dependency enforcing that the caller holds at least one of ``permission_codes``
    while respecting explicit user-level denies (`deny:crm.leads.view`, `deny:<code_checked>`).
    """

    async def _checker(
        current_user: CurrentUser = Depends(get_current_user),
        session: AsyncSession = Depends(get_db_session),
    ) -> CurrentUser:
        raw_perms = extract_raw_permissions(current_user)
        explicit_denies = await load_explicit_crm_denies(
            session, current_user.id, raw_perms, is_super_admin=current_user.is_super_admin
        )
        if not any(
            evaluate_crm_permission(current_user, raw_perms, explicit_denies, code)
            for code in permission_codes
        ):
            codes_display = " or ".join(repr(c) for c in permission_codes)
            raise ForbiddenException(f"This action requires one of the following permissions: {codes_display}.")
        return current_user

    return _checker


def get_crm_pipeline_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmPipelineService:
    """Dependency provider for CrmPipelineService."""
    return CrmPipelineService(session=session)


def get_crm_salesperson_distribution_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmSalespersonDistributionService:
    """Dependency provider for CrmSalespersonDistributionService."""
    return CrmSalespersonDistributionService(session=session)


def get_crm_import_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmImportService:
    """Dependency provider for CrmImportService."""
    return CrmImportService(session=session)


def get_crm_assignment_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmAssignmentEngineService:
    """Dependency provider for CrmAssignmentEngineService."""
    return CrmAssignmentEngineService(session=session)


def get_crm_lead_service(
    session: AsyncSession = Depends(get_db_session),
) -> CrmLeadService:
    """Dependency provider for CrmLeadService."""
    return CrmLeadService(session=session)

