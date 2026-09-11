"""
Buyer Entity Sync Adapter (Phase 8E).

Plugs the Buyer domain model into the generic cross-ERP synchronization engine.
Handles creation, field updates, soft-delete/deactivation, OCC version extraction,
and natural-key conflict/repair matching.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.buyers.models import Buyer
from app.buyers.repository import BuyerContactRepository, BuyerRepository
from app.buyers.service import BuyerService
from app.cache.dependency import get_cache
from app.cache.manager import CacheManager
from app.core.exceptions import ConflictException
from app.core.logging import get_logger
from app.integration.adapters.base import BaseEntitySyncAdapter
from app.masters.countries.repository import CountryRepository
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository

logger = get_logger(__name__)


class BuyerSyncAdapter(BaseEntitySyncAdapter):
    """Adapter bridging the generic sync engine to the local Buyer domain service."""

    @property
    def entity_type(self) -> str:
        return "buyer"

    def _get_buyer_service(self, session: AsyncSession) -> BuyerService:
        return BuyerService(
            BuyerRepository(session),
            BuyerContactRepository(session),
            CountryRepository(session),
            ProductCategoryRepository(session),
            ProductSubCategoryRepository(session),
            CacheManager(get_cache()),
        )

    async def apply_create(
        self, session: AsyncSession, payload: dict[str, Any], source_erp_id: str
    ) -> tuple[uuid.UUID, int]:
        company_name = payload.get("company_name")
        country_code = payload.get("country_code")
        source_buyer_id = str(payload.get("buyer_id") or payload.get("entity_id") or uuid.uuid4())
        if not company_name:
            raise ValueError("Cannot create Buyer: missing company_name in payload.")

        country = None
        if country_code:
            country = await CountryRepository(session).get_by_code(country_code)

        if country is None:
            if country_code:
                raise ValueError(f"Country code '{country_code}' does not match any known local country.")
            all_countries = await CountryRepository(session).list_all()
            if all_countries:
                country = all_countries[0]
            else:
                raise ValueError("No country found to assign to Buyer.")

        service = self._get_buyer_service(session)
        buyer = await service.create(company_name=company_name, country_id=country.id)

        from app.integration.consumer_models import SyncedBuyerSource
        session.add(
            SyncedBuyerSource(
                source_erp_id=source_erp_id,
                source_buyer_id=source_buyer_id,
                local_buyer_id=buyer.id,
            )
        )
        return buyer.id, getattr(buyer, "version", 1)

    async def apply_update(
        self,
        session: AsyncSession,
        local_id: uuid.UUID,
        payload: dict[str, Any],
        field_ownership: dict[str, str] | None = None,
    ) -> int:
        buyer_repo = BuyerRepository(session)
        buyer = await buyer_repo.get_by_id(local_id)
        if buyer is None:
            raise ValueError(f"Local Buyer with ID {local_id} not found.")

        field_ownership = field_ownership or {}

        if "company_name" in payload and field_ownership.get("company_name") not in ("TARGET_OWNED", "LOCAL_OWNED"):
            buyer.company_name = payload["company_name"]

        if "city" in payload and field_ownership.get("city") not in ("TARGET_OWNED", "LOCAL_OWNED"):
            buyer.city = payload["city"]

        if "address" in payload and field_ownership.get("address") not in ("TARGET_OWNED", "LOCAL_OWNED"):
            buyer.address = payload["address"]

        if "tax_id_number" in payload and field_ownership.get("tax_id_number") not in ("TARGET_OWNED", "LOCAL_OWNED"):
            buyer.tax_id_number = payload["tax_id_number"]

        if "website" in payload and field_ownership.get("website") not in ("TARGET_OWNED", "LOCAL_OWNED"):
            buyer.website = payload["website"]

        buyer.version = getattr(buyer, "version", 1) + 1
        await session.flush()
        return buyer.version

    async def apply_delete(
        self, session: AsyncSession, local_id: uuid.UUID, delete_strategy: str
    ) -> None:
        service = self._get_buyer_service(session)
        buyer_repo = BuyerRepository(session)
        buyer = await buyer_repo.get_by_id(local_id)
        if buyer is None or buyer.is_deleted:
            return

        if delete_strategy in ("PROPAGATE_DELETE", "DELETE"):
            try:
                await service.delete(local_id)
            except ConflictException:
                await service.deactivate(local_id)
        elif delete_strategy in ("PROPAGATE_ARCHIVE", "ARCHIVE"):
            await service.deactivate(local_id)

    async def get_local_version(self, session: AsyncSession, local_id: uuid.UUID) -> int | None:
        buyer = await BuyerRepository(session).get_by_id(local_id)
        if buyer is None:
            return None
        return getattr(buyer, "version", 1)

    async def find_existing_by_natural_key(
        self, session: AsyncSession, payload: dict[str, Any]
    ) -> tuple[uuid.UUID, int] | None:
        company_name = payload.get("company_name", "").strip()
        if not company_name:
            return None

        stmt = select(Buyer).where(
            func.lower(Buyer.company_name) == company_name.lower(),
            Buyer.deleted_at.is_(None),
        )
        res = await session.execute(stmt)
        buyer = res.scalars().first()
        if buyer is None:
            return None
        return buyer.id, getattr(buyer, "version", 1)
