"""
Consumer Handlers (Phase 6).

Registers one real, working cross-ERP synchronization consumer:
`buyer.created`, syncing Yinglima buyers into Inhyma. This was
originally a log-only stub (an earlier session's Phase 6 explicitly
deferred the real write pending an explicit synchronization policy --
Section 26/27's "do not invent one"). This new Phase 6 pass defines
that policy explicitly (see the handler's own docstring: system of
record, field mapping, conflict behavior, loop prevention) and
implements the actual write.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.integration.consumer_service import register_consumer

logger = get_logger(__name__)


@register_consumer("buyer.created")
async def handle_buyer_created(payload: dict, source_erp_id: str) -> None:
    """
    Handle a `buyer.created` event from another ERP (Phase 6 pilot -- see PHASE6_INTEGRATION.md).

    Real synchronization, not a stub: creates a local Inhyma Buyer from
    the source event.

    System of record / ownership (Section 23, documented here as the
    binding policy, not inferred): Yinglima is the sole system of
    record for buyers created via THIS event. Inhyma's resulting Buyer
    row is a synchronized COPY -- Inhyma must not treat it as its own
    independently-editable master record for cross-ERP purposes, and no
    reciprocal buyer event is ever emitted from Inhyma for a buyer that
    arrived via this handler (Section 22: this is what prevents a
    Yinglima->Inhyma->Yinglima->... loop -- there is no code path that
    could even start one, since Inhyma's own buyer-creation route is
    untouched and this handler never calls it recursively).

    Field mapping (Section 23): company_name maps directly. country_code
    (added in event_version 2 specifically to make this handler possible
    -- v1 only carried country_id, a Yinglima-local UUID meaningless in
    Inhyma's own countries table) is resolved to Inhyma's own local
    country_id via CountryRepository.get_by_code. If the country code
    cannot be resolved (unknown/inactive code, or a v1 event with no
    country_code at all), the buyer is intentionally NOT created -- the
    honest "payload insufficient" case Section 48 describes, not a
    silent partial write; the failure is logged and the event is
    retried on the next poll exactly like any other handler exception.

    Idempotency (Section 9 -- the actual mechanism, not the fallback
    below): SyncedBuyerSource tracks (source_erp_id, source_buyer_id) ->
    local_buyer_id in Inhyma's own database and is checked FIRST.
    ConsumerService.poll_and_process's own ProcessedIntegrationEvent
    check already prevents the same event_id from reaching this handler
    twice, but that alone does NOT prevent a dead-letter REPLAY (a
    genuinely new event_id for the same logical source buyer) from
    creating a second Buyer -- this table closes that gap, which an
    earlier version of this handler (relying only on
    BuyerService.create's own name+phone duplicate rule) did not: that
    rule requires a matching phone number, and this event's payload
    carries none, so two syncs of the same source buyer with no phone
    number on file would otherwise NOT be recognized as duplicates.

    Conflict policy (Section 23), a secondary safety net that in
    practice rarely fires given today's payload shape: if
    SyncedBuyerSource shows no prior sync but BuyerService.create's own
    name+phone duplicate rule still rejects the write, creation is
    skipped and logged rather than raising. Honest limitation: that
    rule's own find_duplicate query returns None unconditionally when
    no phone number is supplied at all (see app/buyers/repository.py),
    and today's buyer.created payload carries no phone number -- so two
    DIFFERENT source buyers that happen to share a company name are
    NOT currently deduplicated by this path; only SyncedBuyerSource's
    check above protects against the SAME source buyer being
    synchronized twice. Closing the "different buyers, same name" gap
    would require adding phone-number fields to the event payload, not
    attempted in this pilot.
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
                "buyer.created event's country_code does not match any known Inhyma country; skipping sync.",
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
