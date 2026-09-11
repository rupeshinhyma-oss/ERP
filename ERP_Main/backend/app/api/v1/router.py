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
    internal_router as membership_internal_router,
    membership_router,
    user_memberships_router,
)
from app.erp_registry.routes import router as erp_registry_router
from app.federation.routes import client_router as federation_client_router
from app.federation.routes import discovery_router as federation_discovery_router
from app.federation.routes import flow_router as federation_flow_router
from app.global_audit.routes import router as global_audit_router
from app.global_auth.routes import router as global_auth_router
from app.global_auth.ecosystem_session import router as ecosystem_session_router
from app.global_users.routes import router as global_users_router
from app.health.routes import router as health_router
from app.identity_linking.routes import identity_router, user_provision_router
from app.integration.routes import admin_router as integration_admin_router
from app.integration.routes import internal_router as integration_internal_router
from app.platform_auth.routes import router as platform_auth_router
from app.platform_authz.routes import router as platform_authz_router
from app.reporting.routes import router as reporting_router
from app.service_identity.routes import router as service_identity_router
from app.sync_policy.routes import router as sync_policy_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(platform_auth_router)
api_router.include_router(global_auth_router)
api_router.include_router(ecosystem_session_router)
api_router.include_router(erp_registry_router)
api_router.include_router(service_identity_router)
api_router.include_router(global_users_router)
api_router.include_router(user_memberships_router)
api_router.include_router(erp_members_router)
api_router.include_router(membership_router)
api_router.include_router(membership_internal_router)
api_router.include_router(global_audit_router)
api_router.include_router(federation_discovery_router)
api_router.include_router(federation_client_router)
api_router.include_router(federation_flow_router)
api_router.include_router(platform_authz_router)
api_router.include_router(integration_internal_router)
api_router.include_router(integration_admin_router)
api_router.include_router(reporting_router)
api_router.include_router(identity_router)
api_router.include_router(user_provision_router)
api_router.include_router(sync_policy_router)
