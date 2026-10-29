"""
Seed the ERP Registry (Phase 3 update).

Registers/reconciles both Yinglima and Inhyma as real ERP instances.
All frontend URLs are sourced strictly from environment configuration
(`YINGLIMA_FRONTEND_URL` and `INHYMA_FRONTEND_URL` in `.env` locally or
platform environment variables in production) with zero hard-coded URLs/ports.
"""

from __future__ import annotations

import asyncio

from app.core.config import EnvironmentEnum, settings
from app.database.base import Base
from app.database.engine import dispose_engine, get_engine, get_sessionmaker
from app.erp_registry.models import ErpStatus
from app.erp_registry.repository import ErpInstanceRepository, ErpModuleRepository
from app.erp_registry.schemas import ErpInstanceCreate, ErpInstanceUpdate, ErpModuleCreate
from app.erp_registry.service import ErpRegistryService

_SHARED_MODULES: list[tuple[str, str]] = [
    ("buyers", "Buyer & Client Management"),
    ("suppliers", "Supplier Directory"),
    ("products", "Product Catalog"),
    ("inquiries", "Inquiries & RFQs"),
    ("planning", "Master Shipment Planning"),
    ("organizations", "Organization Profile"),
]

_INHYMA_ONLY_MODULES: list[tuple[str, str]] = [
    ("notifications", "Notifications"),
    ("tasks", "Task & Project Management"),
]


def _dashboard_url(erp_key: str, env_key: str) -> str:
    """
    Resolve an ERP frontend dashboard URL strictly from `<env_key>` in `.env` / OS environment.
    Never falls back to hard-coded localhost ports.
    """
    resolved = settings.get_erp_frontend_url(erp_key)
    if resolved:
        return resolved
    raise RuntimeError(
        f"{env_key} is not set. Set it in `.env` (for local development) or in the ERP_Main service environment."
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

    yinglima_url = _dashboard_url("yinglima", "YINGLIMA_FRONTEND_URL")
    inhyma_url = _dashboard_url("inhyma", "INHYMA_FRONTEND_URL")
    is_local = settings.ENVIRONMENT in (EnvironmentEnum.LOCAL, EnvironmentEnum.TEST)

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
        # Never overwrite an existing shared DB row from a local run so production's registry stays intact.
        if not yinglima_is_new and not is_local:
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
                description="Independent ERP for Inhyma's own operations.",
                status=ErpStatus.ACTIVE,
                base_url=inhyma_url,
            ),
        )
        if not inhyma_is_new and not is_local:
            await service.update_metadata(inhyma.id, ErpInstanceUpdate(base_url=inhyma_url))
            print("Updated inhyma's base_url from INHYMA_FRONTEND_URL.")
        await _declare_modules(service, inhyma.id, _SHARED_MODULES + _INHYMA_ONLY_MODULES)

        await db.commit()

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(seed())
