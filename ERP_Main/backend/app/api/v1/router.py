"""
Versioned API Router.

Single place where every module's router is aggregated before `app.main`
mounts it once under the versioned prefix. Mirrors Yinglima_ERP's
`app.api.v1.router` pattern: adding a new module later means adding one
`include_router` line here.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.erp_memberships.routes import (
    erp_members_router,
    membership_router,
    user_memberships_router,
)
from app.erp_registry.routes import router as erp_registry_router
from app.global_audit.routes import router as global_audit_router
from app.global_users.routes import router as global_users_router
from app.health.routes import router as health_router
from app.platform_auth.routes import router as platform_auth_router
from app.service_identity.routes import router as service_identity_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(platform_auth_router)
api_router.include_router(erp_registry_router)
api_router.include_router(service_identity_router)
api_router.include_router(global_users_router)
api_router.include_router(user_memberships_router)
api_router.include_router(erp_members_router)
api_router.include_router(membership_router)
api_router.include_router(global_audit_router)
