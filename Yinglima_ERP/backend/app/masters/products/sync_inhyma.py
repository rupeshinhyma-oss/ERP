"""
Product Cross-ERP Synchronization to Inhyma (Yinglima -> Inhyma).

Rules:
1. Strict One-Way: Yinglima -> Inhyma only. Never Inhyma -> Yinglima.
2. Triggered when Organization = Inhyma is selected (or when a previously synced product is updated/deactivated).
3. Deactivation in Yinglima automatically deactivates in Inhyma.
4. Resilience & Fallbacks:
   - Immediate direct HTTP delivery to Inhyma peer endpoint.
   - Durable outbox event & delivery persistence with exponential backoff retries via queue worker.
   - Classification natural key auto-resolution (Category, SubCategory, Brand, UOM, HSN).
   - Natural key deduplication to prevent duplicate records in Inhyma.
   - Non-blocking: failures in target network never abort the local Yinglima transaction.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.users.models  # noqa: F401

from app.core.constants import RecordStatus
from app.core.logging import get_logger
from app.integration.jobs import enqueue_dispatch
from app.integration.models import IntegrationOutboxDelivery, IntegrationOutboxEvent
from app.integration.repository import IntegrationOutboxRepository
from app.integration.service import IntegrationService
from app.masters.brands.models import Brand
from app.masters.company_list.models import MasterCompany
from app.masters.hsn.models import HsnCode
from app.masters.product_categories.models import ProductCategory
from app.masters.product_sub_categories.models import ProductSubCategory
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.queue.service import QueueService

logger = get_logger(__name__)

INHYMA_KNOWN_UUID = uuid.UUID("85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5")


async def is_inhyma_organization(
    db: AsyncSession,
    product: Product | None = None,
    organization_ids: list[str] | list[uuid.UUID] | list[Any] | None = None,
    organization_id: uuid.UUID | str | None = None,
) -> bool:
    """Check if Inhyma is selected as an organization for this product."""
    all_raw: set[str] = set()

    if organization_id:
        all_raw.add(str(organization_id).strip().lower())
    if organization_ids:
        for x in organization_ids:
            if x is not None:
                s = x if isinstance(x, str) else str(x)
                s = s.strip().lower()
                if s:
                    all_raw.add(s)

    if product:
        if product.organization_id:
            all_raw.add(str(product.organization_id).strip().lower())
        if product.organization_ids:
            for x in product.organization_ids:
                if x is not None:
                    s = x if isinstance(x, str) else str(x)
                    s = s.strip().lower()
                    if s:
                        all_raw.add(s)

    if not all_raw:
        return False

    # Check for exact known Inhyma UUID or slug
    if str(INHYMA_KNOWN_UUID).lower() in all_raw:
        return True
    if any("inhyma" in s for s in all_raw):
        return True

    # Check database master_companies
    valid_uuids: list[uuid.UUID] = []
    for s in all_raw:
        try:
            valid_uuids.append(uuid.UUID(s))
        except (ValueError, TypeError):
            pass

    if valid_uuids:
        stmt = select(MasterCompany).where(MasterCompany.id.in_(valid_uuids))
        companies = (await db.execute(stmt)).scalars().all()
        for c in companies:
            if "inhyma" in (c.name or "").lower() or "inhyma" in (c.code or "").lower():
                return True

    return False


async def was_product_synced_to_inhyma(db: AsyncSession, product_id: uuid.UUID) -> bool:
    """Check whether this product was previously dispatched or queued for Inhyma."""
    stmt = (
        select(IntegrationOutboxDelivery.id)
        .join(IntegrationOutboxEvent, IntegrationOutboxDelivery.outbox_event_id == IntegrationOutboxEvent.id)
        .where(
            IntegrationOutboxEvent.aggregate_type == "product",
            IntegrationOutboxEvent.aggregate_id == product_id,
            IntegrationOutboxDelivery.target_erp == "inhyma",
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none() is not None


async def build_product_sync_payload(
    db: AsyncSession,
    product: Product,
    is_active: bool | None = None,
) -> dict[str, Any]:
    """Assemble a self-contained product payload with natural keys for Inhyma."""
    # Look up natural references
    category = await db.get(ProductCategory, product.category_id) if product.category_id else None
    sub_category = await db.get(ProductSubCategory, product.sub_category_id) if product.sub_category_id else None
    brand = await db.get(Brand, product.brand_id) if product.brand_id else None
    uom = await db.get(UnitOfMeasurement, product.uom_id) if product.uom_id else None
    hsn = await db.get(HsnCode, product.hsn_id) if product.hsn_id else None

    # Handle active status
    active_flag = is_active if is_active is not None else (product.status == RecordStatus.ACTIVE)
    status_str = "active" if active_flag else "inactive"

    # Ensure packaging gross weight and cbm are valid positive numbers for Inhyma constraints
    gross_wt = max(float(product.packaging_gross_weight or product.weight or 1.0), 0.001)
    cbm = float(product.packaging_unit_cbm or 0.000001)
    if cbm <= 0:
        cbm = 0.000001

    raw_len = product.length_cm if product.length_cm is not None else product.length
    raw_width = product.width_cm if product.width_cm is not None else product.width
    raw_height = product.height_cm if product.height_cm is not None else product.height

    len_cm = float(raw_len) if raw_len is not None else None
    width_cm = float(raw_width) if raw_width is not None else None
    height_cm = float(raw_height) if raw_height is not None else None

    result = {
        "product_id": str(product.id),
        "product_code": product.product_code,
        "product_name": product.product_name,
        "product_name_tally": product.product_name_tally or product.product_name,
        "product_name_invoice": product.product_name_invoice,
        "barcode": product.barcode,
        "product_type": "Machine",
        "category_name": category.name if category else None,
        "category_code": category.code if category else None,
        "sub_category_name": sub_category.name if sub_category else None,
        "sub_category_code": sub_category.code if sub_category else None,
        "brand_name": brand.name if brand else None,
        "brand_code": brand.code if brand else None,
        "uom_name": uom.name if uom else None,
        "uom_code": uom.code if uom else "PCS",
        "hsn_code": hsn.code if hsn else None,
        "gst_percent": float(hsn.gst_percent or 0.0) if hsn else 0.0,
        "import_duty_percent": float(hsn.import_duty_percent or 0.0) if hsn else 0.0,
        "purchase_vat_percent": float(product.purchase_vat_percent or (hsn.purchase_vat_percent if hsn else 0.0) or 0.0),
        "refund_vat_percent": float(product.refund_vat_percent or 0.0),
        "license_certificate_required": product.license_certificate_required,
        "specification": product.specification,
        "description": product.description,
        "images": product.images or [],
        "packaging_quantity": float(product.packaging_quantity or 1.0),
        "packaging_gross_weight": gross_wt,
        "packaging_net_weight": float(product.packaging_net_weight) if product.packaging_net_weight is not None else None,
        "weight": gross_wt,
        "length": float(product.length) if product.length is not None else None,
        "width": float(product.width) if product.width is not None else None,
        "height": float(product.height) if product.height is not None else None,
        "length_cm": len_cm,
        "width_cm": width_cm,
        "height_cm": height_cm,
        "packaging_unit_cbm": cbm,
        "color": product.color,
        "material": product.material,
        "is_active": active_flag,
        "status": status_str,
        "organization_id": str(product.organization_id) if product.organization_id else None,
        "organization_ids": [str(x) for x in (product.organization_ids or [])],
    }

    # Ensure strictly monotonic sync_version so Inhyma OCC accepts every update/status transition
    stmt = (
        select(IntegrationOutboxEvent.payload)
        .where(
            IntegrationOutboxEvent.aggregate_type == "product",
            IntegrationOutboxEvent.aggregate_id == product.id,
        )
        .order_by(desc(IntegrationOutboxEvent.created_at))
        .limit(1)
    )
    last_payload_raw = (await db.execute(stmt)).scalar_one_or_none()
    last_version = 0
    if last_payload_raw:
        try:
            parsed = json.loads(last_payload_raw) if isinstance(last_payload_raw, str) else last_payload_raw
            last_version = int(parsed.get("version", 0))
        except Exception:
            pass

    current_ver = int(getattr(product, "version", 1) or 1)
    result["version"] = max(current_ver, last_version + 1)
    return result


async def sync_product_to_inhyma(
    db: AsyncSession,
    product: Product,
    event_type: str,
    actor_id: uuid.UUID | None = None,
    is_active: bool | None = None,
) -> bool:
    """
    Publish and deliver a cross-ERP product integration event to Inhyma.
    Attempts immediate HTTP delivery with durable outbox and background retry fallbacks.
    """
    try:
        payload = await build_product_sync_payload(db, product, is_active=is_active)
        integration_service = IntegrationService(IntegrationOutboxRepository(db))

        # 1. Publish event targeted specifically to Inhyma
        outbox_event = integration_service.publish_event(
            event_type=event_type,
            aggregate_type="product",
            aggregate_id=product.id,
            payload=payload,
            event_version=1,
            target="inhyma",
            actor_type="user",
            actor_id=actor_id,
        )
        await db.flush()

        # 2. Enqueue background queue job for retry / eventual consistency fallback
        queue_service = QueueService(db)
        await enqueue_dispatch(queue_service, outbox_event_id=outbox_event.id)

        # 3. Immediate synchronous delivery attempt
        for delivery in outbox_event.deliveries:
            if delivery.target_erp.lower() == "inhyma":
                try:
                    success = await integration_service.dispatch_delivery(delivery.id)
                    if success:
                        logger.info(
                            "Immediate sync of product '%s' (%s) to Inhyma succeeded.",
                            product.product_name_tally,
                            event_type,
                        )
                    else:
                        logger.warning(
                            "Immediate delivery to Inhyma deferred to background queue worker.",
                            extra={"product_id": str(product.id)},
                        )
                except Exception as dispatch_err:
                    logger.warning(
                        "Immediate dispatch to Inhyma failed (will be retried by queue worker): %s",
                        dispatch_err,
                        extra={"product_id": str(product.id)},
                    )
        return True
    except Exception as e:
        logger.error(
            "Failed to orchestrate product sync to Inhyma for product %s: %s",
            product.id,
            e,
            exc_info=True,
        )
        # Fail-open: do not abort local Yinglima transaction
        return False
