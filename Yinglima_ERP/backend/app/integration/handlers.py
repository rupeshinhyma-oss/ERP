"""
Consumer Handlers (Phase 6/7).

Registers one real, working cross-ERP synchronization consumer:
buyer.created, syncing Inhyma buyers into Yinglima -- the reverse
direction of Inhyma's own identically-shaped consumer (built in Phase
6 for Yinglima -> Inhyma). Phase 7 adds this direction, completing a
bidirectional pilot where each ERP is independently the system of
record for the buyers IT creates.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.integration.consumer_service import register_consumer

logger = get_logger(__name__)


@register_consumer("buyer.created")
async def handle_buyer_created(payload: dict, source_erp_id: str) -> None:
    """
    Handle a buyer.created event from another ERP (Phase 7).

    Real synchronization, not a stub: creates a local Yinglima Buyer
    from the source event.

    System of record / ownership: the SOURCE ERP that created this
    buyer (Inhyma, in this direction) is the sole system of record for
    it. Yinglima's resulting Buyer row is a synchronized COPY -- no
    reciprocal buyer.created event is ever emitted from Yinglima for a
    buyer that arrived via this handler (loop prevention: this handler
    calls BuyerService.create directly, never the HTTP route where the
    reciprocal publish call lives).

    Field mapping: company_name maps directly. country_code (event
    version 2) is resolved to Yinglima's own local country_id via
    CountryRepository.get_by_code. A v1 event or an unresolvable code
    is the honest "payload insufficient" case -- skipped, not guessed.

    Idempotency: SyncedBuyerSource tracks (source_erp_id,
    source_buyer_id) -> local_buyer_id and is checked first, mirroring
    Inhyma's own identical table and the exact gap it closes (a
    dead-letter replay carrying a new event_id for the same logical
    source buyer must not create a duplicate local Buyer).

    Conflict policy: same honest limitation as Inhyma's own handler --
    BuyerService.create's own name+phone duplicate rule cannot catch
    two DIFFERENT source buyers sharing a company name, since this
    payload carries no phone number. SyncedBuyerSource protects against
    the SAME source buyer being synced twice; it does not deduplicate
    across genuinely different source buyers with matching names.
    """
    from sqlalchemy import select

    from app.buyers.repository import BuyerContactRepository, BuyerRepository
    from app.buyers.service import BuyerService
    from app.cache.dependency import get_cache
    from app.cache.manager import CacheManager
    from app.core.exceptions import ConflictException, NotFoundException
    from app.database.engine import get_sessionmaker
    from app.integration.consumer_models import SyncedBuyerSource
    from app.masters.countries.repository import CountryRepository
    from app.masters.product_categories.repository import ProductCategoryRepository
    from app.masters.product_sub_categories.repository import ProductSubCategoryRepository

    company_name = payload.get("company_name")
    country_code = payload.get("country_code")
    source_buyer_id = payload.get("buyer_id")

    if not company_name:
        logger.warning(
            "buyer.created event missing company_name; skipping sync.", extra={"source_erp_id": source_erp_id}
        )
        return
    if not source_buyer_id:
        logger.warning(
            "buyer.created event missing buyer_id; cannot track sync idempotency, skipping.",
            extra={"source_erp_id": source_erp_id},
        )
        return
    if not country_code:
        logger.info(
            "buyer.created event has no country_code (likely a v1 event, pre-dating this field); "
            "skipping sync -- cannot satisfy Buyer.country_id without it.",
            extra={"source_erp_id": source_erp_id, "buyer_id": source_buyer_id},
        )
        return

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        existing_sync = await session.execute(
            select(SyncedBuyerSource).where(
                SyncedBuyerSource.source_erp_id == source_erp_id,
                SyncedBuyerSource.source_buyer_id == source_buyer_id,
            )
        )
        if existing_sync.scalar_one_or_none() is not None:
            logger.info(
                "buyer.created sync skipped: this source buyer was already synchronized (idempotent replay).",
                extra={"source_erp_id": source_erp_id, "source_buyer_id": source_buyer_id},
            )
            return

        country = await CountryRepository(session).get_by_code(country_code)
        if country is None:
            logger.warning(
                "buyer.created event's country_code does not match any known Yinglima country; skipping sync.",
                extra={"source_erp_id": source_erp_id, "country_code": country_code},
            )
            return

        service = BuyerService(
            BuyerRepository(session),
            BuyerContactRepository(session),
            CountryRepository(session),
            ProductCategoryRepository(session),
            ProductSubCategoryRepository(session),
            CacheManager(get_cache()),
        )
        try:
            buyer = await service.create(company_name=company_name, country_id=country.id)
            session.add(
                SyncedBuyerSource(
                    source_erp_id=source_erp_id, source_buyer_id=source_buyer_id, local_buyer_id=buyer.id
                )
            )
            from app.integration.sync_models import SyncedEntityMapping
            session.add(
                SyncedEntityMapping(
                    source_erp_id=source_erp_id,
                    entity_type="buyer",
                    source_entity_id=source_buyer_id,
                    local_entity_id=buyer.id,
                    source_version=payload.get("version", 1),
                    local_version=getattr(buyer, "version", 1),
                    sync_status="ACTIVE",
                )
            )
            await session.commit()
            logger.info(
                "Synchronized buyer.created from source ERP into a new local Buyer.",
                extra={
                    "source_erp_id": source_erp_id,
                    "source_buyer_id": source_buyer_id,
                    "local_buyer_id": str(buyer.id),
                },
            )
        except ConflictException:
            await session.rollback()
            logger.info(
                "buyer.created sync skipped: a local buyer with the same name/contact already exists "
                "(pre-existing local record wins).",
                extra={"source_erp_id": source_erp_id, "company_name": company_name},
            )
        except NotFoundException:
            await session.rollback()
            logger.warning(
                "buyer.created sync failed: resolved country_id was rejected by BuyerService validation.",
                extra={"source_erp_id": source_erp_id, "country_code": country_code},
            )
