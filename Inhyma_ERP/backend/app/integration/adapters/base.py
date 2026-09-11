"""
Generic Entity Sync Adapter Base Interface (Phase 8E).

Defines the pluggable adapter interface allowing the generic synchronization engine
to operate on arbitrary domain entities (Buyer, Supplier, Product, etc.) without
hard-coding domain-specific models, schemas, or services into the sync engine.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


class BaseEntitySyncAdapter(ABC):
    """Abstract adapter defining the entity-specific mutation contract for synchronization."""

    @property
    @abstractmethod
    def entity_type(self) -> str:
        """The canonical entity type key, e.g. 'buyer', 'supplier', 'product'."""

    @abstractmethod
    async def apply_create(
        self, session: AsyncSession, payload: dict[str, Any], source_erp_id: str
    ) -> tuple[uuid.UUID, int]:
        """
        Create a new local domain record from incoming source payload.

        Returns (local_entity_id, local_entity_version).
        """

    @abstractmethod
    async def apply_update(
        self,
        session: AsyncSession,
        local_id: uuid.UUID,
        payload: dict[str, Any],
        field_ownership: dict[str, str] | None = None,
    ) -> int:
        """
        Update an existing local domain record, respecting field ownership rules.

        Returns updated local_entity_version.
        """

    @abstractmethod
    async def apply_delete(
        self, session: AsyncSession, local_id: uuid.UUID, delete_strategy: str
    ) -> None:
        """
        Handle deletion or archival of an existing local record.

        Supports: 'PROPAGATE_DELETE', 'PROPAGATE_ARCHIVE', 'IGNORE_DELETE'.
        """

    @abstractmethod
    async def get_local_version(self, session: AsyncSession, local_id: uuid.UUID) -> int | None:
        """Return the current OCC version integer of the local entity, or None if not found."""

    @abstractmethod
    async def find_existing_by_natural_key(
        self, session: AsyncSession, payload: dict[str, Any]
    ) -> tuple[uuid.UUID, int] | None:
        """
        Lookup a pre-existing local entity by natural key (e.g. name / tax ID)
        for duplicate detection or repair reconciliation.
        """
