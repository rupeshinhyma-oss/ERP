"""
ERP Registry Service.

Business rules for the ERP Registry, on top of the plain data access in
`repository.py`:

- ERP keys must be unique and are never reassigned (Phase 2 Step 4).
- `DECOMMISSIONED` is a status, never a delete (Phase 2 Step 3) -- there is
  deliberately no `delete()` method on this service; see `routes.py` for
  how the DELETE HTTP verb maps to decommissioning instead of a row
  removal (Phase 2 Step 8).
- Registering a module for an ERP is idempotent by `(erp_instance_id,
  module_key)` -- calling it twice with the same key updates the existing
  declaration rather than creating a duplicate, matching Step 5's
  "data-driven, not hardcoded per-ERP" intent: nothing here special-cases
  any particular ERP or module name.
"""

from __future__ import annotations

import uuid

from app.core.exceptions import ConflictException, NotFoundException
from app.erp_registry.models import ErpInstance, ErpModule, ErpStatus
from app.erp_registry.repository import ErpInstanceRepository, ErpModuleRepository
from app.erp_registry.schemas import ErpInstanceCreate, ErpInstanceUpdate, ErpModuleCreate


class ErpRegistryService:
    """Orchestrates ERP instance registration, lookup, and lifecycle."""

    def __init__(self, instance_repository: ErpInstanceRepository, module_repository: ErpModuleRepository) -> None:
        """Wire the service to its repositories."""
        self.instance_repository = instance_repository
        self.module_repository = module_repository

    async def register(self, payload: ErpInstanceCreate) -> ErpInstance:
        """
        Register a new ERP instance.

        Rejects a duplicate `key` with a 409 Conflict rather than a raw
        integrity error, so the API gives a clear, actionable message
        (Phase 2 Step 4: "unique", "not reused for another ERP").
        """
        existing = await self.instance_repository.get_by_key(payload.key)
        if existing is not None:
            raise ConflictException(f"An ERP instance with key {payload.key!r} is already registered.")

        erp_instance = ErpInstance(
            key=payload.key,
            name=payload.name,
            display_name=payload.display_name,
            description=payload.description,
            status=payload.status,
            base_url=payload.base_url,
            environment=payload.environment,
            version=payload.version,
        )
        return await self.instance_repository.create(erp_instance)

    async def get(self, erp_id: uuid.UUID) -> ErpInstance:
        """Fetch a single ERP instance by internal id, or raise 404."""
        erp_instance = await self.instance_repository.get_by_id(erp_id)
        if erp_instance is None:
            raise NotFoundException(f"No ERP instance found with id {erp_id}.")
        return erp_instance

    async def get_by_key(self, key: str) -> ErpInstance:
        """Fetch a single ERP instance by its stable key, or raise 404."""
        erp_instance = await self.instance_repository.get_by_key(key)
        if erp_instance is None:
            raise NotFoundException(f"No ERP instance found with key {key!r}.")
        return erp_instance

    async def list_all(self) -> list[ErpInstance]:
        """Return every registered ERP instance."""
        return await self.instance_repository.list_all()

    async def update_metadata(self, erp_id: uuid.UUID, payload: ErpInstanceUpdate) -> ErpInstance:
        """
        Update non-identity metadata for an ERP instance.

        Deliberately cannot change `key` -- `ErpInstanceUpdate` has no
        `key` field at all (Phase 2 Step 4: the key must never change once
        assigned), and `status` is changed only via `change_status()`
        below, not this general-purpose update, so status transitions stay
        auditable as a distinct, deliberate action rather than an
        incidental side effect of a metadata edit.
        """
        erp_instance = await self.get(erp_id)
        updates = payload.model_dump(exclude_unset=True)
        for field, value in updates.items():
            setattr(erp_instance, field, value)
        await self.instance_repository.create(erp_instance)  # flush + refresh
        return erp_instance

    async def change_status(self, erp_id: uuid.UUID, new_status: ErpStatus) -> ErpInstance:
        """Change an ERP instance's lifecycle status."""
        erp_instance = await self.get(erp_id)
        erp_instance.status = new_status
        await self.instance_repository.create(erp_instance)  # flush + refresh
        return erp_instance

    async def decommission(self, erp_id: uuid.UUID) -> ErpInstance:
        """
        Decommission an ERP instance.

        This is the ONLY effect of "deleting" an ERP instance through this
        API (Phase 2 Step 8/3): the row, its history, and every
        `ErpModule` declaration it owns are left completely intact. A
        decommissioned ERP simply stops being considered available for
        normal access by anything built on top of this registry later.
        """
        return await self.change_status(erp_id, ErpStatus.DECOMMISSIONED)

    async def declare_module(self, erp_id: uuid.UUID, payload: ErpModuleCreate) -> ErpModule:
        """
        Declare (or update) a single capability/module for an ERP instance.

        Idempotent on `(erp_instance_id, module_key)`: re-declaring an
        existing module key updates its name/enabled flag in place instead
        of creating a duplicate row, so re-running registration/config
        tooling is always safe.
        """
        erp_instance = await self.get(erp_id)  # 404s if the ERP doesn't exist
        existing = await self.module_repository.get_by_instance_and_key(erp_instance.id, payload.module_key)
        if existing is not None:
            existing.module_name = payload.module_name
            existing.enabled = payload.enabled
            return await self.module_repository.create(existing)  # flush + refresh

        module = ErpModule(
            erp_instance_id=erp_instance.id,
            module_key=payload.module_key,
            module_name=payload.module_name,
            enabled=payload.enabled,
        )
        return await self.module_repository.create(module)
