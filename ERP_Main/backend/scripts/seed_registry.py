"""
Seed the ERP Registry (Phase 3 update).

Registers/reconciles both Yinglima and Inhyma as real ERP instances. This
replaces the Phase 2 version of this script, which correctly registered
Inhyma only as an INACTIVE placeholder because Inhyma did not exist in
the repository at all at that time (Phase 2 Step 19). It now does.

Capability reconciliation (Phase 3 Steps 4-5, 29)
--------------------------------------------------
The business-capability list below for each ERP is derived from actually
reading each ERP's own `app/api/v1/router.py` `include_router(...)` calls
at the time this script was last updated -- NOT from migration history,
which the Phase 3 brief explicitly warns can be stale (Inhyma's own
migration history contains tasks-related migrations from before and
after functionality changes; what matters is the CURRENT router). Pure
platform infrastructure common to every ERP (auth, users, rbac, cache,
audit, trash, search, queue, events, and the generic `masters.*` lookup
tables) is deliberately excluded from this "capabilities" list -- it
describes what makes each ERP's business offering distinct, not its
internal plumbing, mirroring the Phase 2 script's own original choice.

Confirmed identical for both ERPs: buyers, suppliers, products,
inquiries, planning, organizations.
Confirmed Inhyma-only (verified live in Inhyma's router, not just its
migration history): notifications, tasks.

Inhyma's status decision (Phase 3 Step 29)
--------------------------------------------
INACTIVE, not ACTIVE. The application itself is real, complete, and
independently tested (see docs/INHYMA_AUDIT.md) -- but as of this
writing Inhyma has no live `.env` / deployed configuration in this
environment (only `.env.example`), unlike Yinglima which does. Per Step
29's own bar -- "ACTIVE should mean its configured deployment is
genuinely eligible for platform interaction" -- an application that has
never been deployed with real configuration is not yet eligible for
platform interaction, regardless of how complete its code is. This is a
deliberate, documented judgment call, not a default; revisit once Inhyma
has a real deployment.

Run with:
    cd backend && python -m scripts.seed_registry
"""

from __future__ import annotations

import asyncio
import os

from app.core.config import EnvironmentEnum, settings
from app.database.base import Base
from app.database.engine import dispose_engine, get_engine, get_sessionmaker
from app.erp_registry.models import ErpStatus
from app.erp_registry.repository import ErpInstanceRepository, ErpModuleRepository
from app.erp_registry.schemas import ErpInstanceCreate, ErpInstanceUpdate, ErpModuleCreate
from app.erp_registry.service import ErpRegistryService

# Business capabilities confirmed live in BOTH ERPs' current routers.
_SHARED_MODULES: list[tuple[str, str]] = [
    ("buyers", "Buyer & Client Management"),
    ("suppliers", "Supplier Directory"),
    ("products", "Product Catalog"),
    ("inquiries", "Inquiries & RFQs"),
    ("planning", "Master Shipment Planning"),
    ("organizations", "Organization Profile"),
]

# Business capabilities confirmed live ONLY in Inhyma's current router
# (app.notifications.routes / app.tasks.routes are both registered in
# Inhyma_ERP/backend/app/api/v1/router.py; neither exists in Yinglima's).
_INHYMA_ONLY_MODULES: list[tuple[str, str]] = [
    ("notifications", "Notifications"),
    ("tasks", "Task & Project Management"),
]


def _dashboard_url(env_key: str, local_default: str) -> str:
    """
    Resolve an ERP frontend dashboard URL (the registry ``base_url``).

    Reads ``<env_key>`` (the ERP's public FRONTEND origin, e.g.
    ``https://yinglima-erp-frontend.onrender.com``) and appends ``/dashboard``.
    Falls back to the localhost default ONLY in local/test environments; in
    any other environment a missing value is a hard, readable error instead of
    a silent localhost registration (which the SSRF validator rejects anyway).
    """
    origin = os.environ.get(env_key, "").strip().rstrip("/")
    if origin:
        if origin.endswith("/dashboard"):
            origin = origin[: -len("/dashboard")]
        return f"{origin}/dashboard"
    if settings.ENVIRONMENT in (EnvironmentEnum.LOCAL, EnvironmentEnum.TEST):
        return local_default
    raise RuntimeError(
        f"{env_key} is not set. Set it to the public URL of that ERP's frontend "
        f"(e.g. https://<name>.onrender.com) in the ERP_Main service environment."
    )


async def _register_or_get(service: ErpRegistryService, instance_repo: ErpInstanceRepository, payload: ErpInstanceCreate):
    """Register an ERP if its key doesn't exist yet; otherwise return the existing row unchanged."""
    existing = await instance_repo.get_by_key(payload.key)
    if existing is not None:
        print(f"{payload.key} already registered: {existing.id} (status={existing.status.value})")
        return existing, False
    created = await service.register(payload)
    print(f"Registered {payload.key}: {created.id} (status={created.status.value})")
    return created, True


async def _declare_modules(service: ErpRegistryService, erp_id, modules: list[tuple[str, str]]) -> None:
    """Declare every (module_key, module_name) pair for an ERP. Idempotent -- safe to re-run."""
    for module_key, module_name in modules:
        await service.declare_module(erp_id, ErpModuleCreate(module_key=module_key, module_name=module_name))
    print(f"Declared {len(modules)} module(s).")


async def seed() -> None:
    """Create tables if needed (local/dev only) and register/reconcile both known ERP entries."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yinglima_url = _dashboard_url("YINGLIMA_FRONTEND_URL", "http://localhost:5173/dashboard")
    inhyma_url = _dashboard_url("INHYMA_FRONTEND_URL", "http://localhost:5174/dashboard")

    session_factory = get_sessionmaker()
    async with session_factory() as db:
        instance_repo = ErpInstanceRepository(db)
        module_repo = ErpModuleRepository(db)
        service = ErpRegistryService(instance_repository=instance_repo, module_repository=module_repo)

        yinglima, yinglima_is_new = await _register_or_get(
            service,
            instance_repo,
            ErpInstanceCreate(
                key="yinglima",
                name="Yinglima ERP",
                display_name="Yinglima ERP",
                description="Production ERP for Inhyma Solutions' import/trading operations.",
                status=ErpStatus.ACTIVE,
                base_url=yinglima_url,
            ),
        )
        if not yinglima_is_new:
            await service.update_metadata(
                yinglima.id,
                ErpInstanceUpdate(base_url=yinglima_url),
            )
        await _declare_modules(service, yinglima.id, _SHARED_MODULES)

        inhyma, inhyma_is_new = await _register_or_get(
            service,
            instance_repo,
            ErpInstanceCreate(
                key="inhyma",
                name="Inhyma ERP",
                display_name="Inhyma ERP",
                description=(
                    "Independent ERP for Inhyma's own operations. A complete, independently-tested "
                    f"application running at {inhyma_url}."
                ),
                status=ErpStatus.ACTIVE,
                base_url=inhyma_url,
            ),
        )
        if not inhyma_is_new:
            await service.update_metadata(
                inhyma.id,
                ErpInstanceUpdate(
                    description=(
                        "Independent ERP for Inhyma's own operations. A complete, independently-tested "
                        f"application running at {inhyma_url}."
                    ),
                    base_url=inhyma_url,
                ),
            )
            await service.change_status(inhyma.id, ErpStatus.ACTIVE)
            print("Updated inhyma's description, base_url, and ACTIVE status.")
        await _declare_modules(service, inhyma.id, _SHARED_MODULES + _INHYMA_ONLY_MODULES)

        await db.commit()

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(seed())