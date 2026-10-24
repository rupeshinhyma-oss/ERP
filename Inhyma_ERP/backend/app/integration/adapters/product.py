"""
Product Entity Sync Adapter.

Plugs the Product domain model into the generic cross-ERP synchronization engine.
Handles creation, field updates, deactivation (soft archival), OCC version extraction,
and natural-key conflict/repair matching for products synced from Yinglima.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

from app.cache.dependency import get_cache
from app.cache.manager import CacheManager
from app.core.constants import RecordStatus
from app.core.logging import get_logger
from app.integration.adapters.base import BaseEntitySyncAdapter
from app.masters.brands.models import Brand
from app.masters.company_list.models import MasterCompany
from app.masters.product_categories.models import ProductCategory
from app.masters.product_sub_categories.models import ProductSubCategory
from app.masters.products.constants import DROPDOWN_CACHE_NAME
from app.masters.products.models import Product
from app.masters.products.schemas import compute_client_cbm
from app.masters.taxes.models import Tax
from app.masters.uom.models import UnitOfMeasurement

logger = get_logger(__name__)


async def _broadcast_product_live_event(event_type: str, product_id: uuid.UUID | str, product_name: str | None = None) -> None:
    try:
        from app.events.channels import module_channel
        from app.events.dispatcher import EventDispatcher
        from app.events.models import Event

        dispatcher = EventDispatcher()
        evt = Event(
            event_type=event_type,
            entity="product",
            entity_id=str(product_id),
            changes={"id": str(product_id), "product_name_tally": product_name or ""},
        )
        await dispatcher.publish(module_channel("inventory"), evt)
    except Exception as e:
        logger.debug("Live product event broadcast skipped: %s", e)


class ProductSyncAdapter(BaseEntitySyncAdapter):
    """Adapter bridging the generic sync engine to the local Inhyma Product domain."""

    @property
    def entity_type(self) -> str:
        return "product"

    async def _resolve_category(self, session: AsyncSession, payload: dict[str, Any]) -> uuid.UUID:
        cat_name = (payload.get("category_name") or "").strip()
        cat_code = (payload.get("category_code") or "").strip()

        if cat_name or cat_code:
            conditions = []
            if cat_name:
                conditions.append(func.lower(ProductCategory.name) == cat_name.lower())
            if cat_code:
                conditions.append(func.lower(ProductCategory.code) == cat_code.lower())
            stmt = select(ProductCategory).where(or_(*conditions)).limit(1)
            cat = (await session.execute(stmt)).scalar_one_or_none()
            if cat:
                return cat.id

            # Auto-provision category in Inhyma if missing
            code_val = cat_code if cat_code else f"CAT-{cat_name[:8].upper().replace(' ', '')}"
            new_cat = ProductCategory(
                name=cat_name or cat_code,
                code=code_val[:50],
                status=RecordStatus.ACTIVE,
            )
            session.add(new_cat)
            await session.flush()
            return new_cat.id

        # Fallback to first active category
        first_cat = (await session.execute(select(ProductCategory).where(ProductCategory.status == RecordStatus.ACTIVE).limit(1))).scalar_one_or_none()
        if first_cat:
            return first_cat.id

        # Create generic default category if database is completely empty
        default_cat = ProductCategory(name="General", code="CAT-GEN", status=RecordStatus.ACTIVE)
        session.add(default_cat)
        await session.flush()
        return default_cat.id

    async def _resolve_sub_category(
        self, session: AsyncSession, category_id: uuid.UUID, payload: dict[str, Any]
    ) -> uuid.UUID | None:
        sub_name = (payload.get("sub_category_name") or "").strip()
        sub_code = (payload.get("sub_category_code") or "").strip()

        if not sub_name and not sub_code:
            return None

        conditions = []
        if sub_name:
            conditions.append(func.lower(ProductSubCategory.name) == sub_name.lower())
        if sub_code:
            conditions.append(func.lower(ProductSubCategory.code) == sub_code.lower())

        stmt = select(ProductSubCategory).where(
            ProductSubCategory.category_id == category_id,
            or_(*conditions)
        ).limit(1)
        sub = (await session.execute(stmt)).scalar_one_or_none()
        if sub:
            return sub.id

        # Auto-provision subcategory in Inhyma under this category
        code_val = sub_code if sub_code else f"SUB-{sub_name[:8].upper().replace(' ', '')}"
        new_sub = ProductSubCategory(
            category_id=category_id,
            name=sub_name or sub_code,
            code=code_val[:50],
            status=RecordStatus.ACTIVE,
        )
        session.add(new_sub)
        await session.flush()
        return new_sub.id

    async def _resolve_brand(self, session: AsyncSession, payload: dict[str, Any]) -> uuid.UUID | None:
        brand_name = (payload.get("brand_name") or "").strip()
        brand_code = (payload.get("brand_code") or "").strip()

        if not brand_name and not brand_code:
            return None

        conditions = []
        if brand_name:
            conditions.append(func.lower(Brand.name) == brand_name.lower())
        if brand_code:
            conditions.append(func.lower(Brand.code) == brand_code.lower())

        stmt = select(Brand).where(or_(*conditions)).limit(1)
        brand = (await session.execute(stmt)).scalar_one_or_none()
        if brand:
            return brand.id

        code_val = brand_code if brand_code else f"BRD-{brand_name[:8].upper().replace(' ', '')}"
        new_brand = Brand(
            name=brand_name or brand_code,
            code=code_val[:50],
            status=RecordStatus.ACTIVE,
        )
        session.add(new_brand)
        await session.flush()
        return new_brand.id

    async def _resolve_uom(self, session: AsyncSession, payload: dict[str, Any]) -> uuid.UUID:
        uom_code = (payload.get("uom_code") or "").strip()
        uom_name = (payload.get("uom_name") or "").strip()

        if uom_code or uom_name:
            conditions = []
            if uom_code:
                conditions.append(func.lower(UnitOfMeasurement.code) == uom_code.lower())
            if uom_name:
                conditions.append(func.lower(UnitOfMeasurement.name) == uom_name.lower())
            stmt = select(UnitOfMeasurement).where(or_(*conditions)).limit(1)
            uom = (await session.execute(stmt)).scalar_one_or_none()
            if uom:
                return uom.id

            code_val = uom_code if uom_code else uom_name[:10].upper()
            new_uom = UnitOfMeasurement(
                code=code_val[:20].upper(),
                name=uom_name or uom_code,
                status=RecordStatus.ACTIVE,
            )
            session.add(new_uom)
            await session.flush()
            return new_uom.id

        first_uom = (await session.execute(select(UnitOfMeasurement).where(UnitOfMeasurement.status == RecordStatus.ACTIVE).limit(1))).scalar_one_or_none()
        if first_uom:
            return first_uom.id

        default_uom = UnitOfMeasurement(code="PCS", name="Pieces", status=RecordStatus.ACTIVE)
        session.add(default_uom)
        await session.flush()
        return default_uom.id

    async def _resolve_tax(self, session: AsyncSession, payload: dict[str, Any]) -> uuid.UUID | None:
        hsn_code = (payload.get("hsn_code") or "").strip()
        if not hsn_code:
            first_tax = (await session.execute(select(Tax).where(Tax.status == RecordStatus.ACTIVE).limit(1))).scalar_one_or_none()
            return first_tax.id if first_tax else None

        stmt = select(Tax).where(func.lower(Tax.hsn_number) == hsn_code.lower()).limit(1)
        tax = (await session.execute(stmt)).scalar_one_or_none()
        if tax:
            updated = False
            if "gst_percent" in payload and payload["gst_percent"] is not None:
                tax.gst_percent = float(payload["gst_percent"])
                updated = True
            if "import_duty_percent" in payload and payload["import_duty_percent"] is not None:
                tax.import_duty_percent = float(payload["import_duty_percent"])
                updated = True
            if updated:
                await session.flush()
            return tax.id

        gst_val = payload.get("gst_percent")
        if gst_val is None:
            gst_val = payload.get("refund_vat_percent") or 0.0

        new_tax = Tax(
            hsn_number=hsn_code[:50],
            gst_percent=float(gst_val),
            import_duty_percent=float(payload.get("import_duty_percent") or 0.0),
            status=RecordStatus.ACTIVE,
        )
        session.add(new_tax)
        await session.flush()
        return new_tax.id

    async def _resolve_organization(self, session: AsyncSession) -> tuple[uuid.UUID | None, list[str] | None]:
        stmt = select(MasterCompany).where(
            or_(
                func.lower(MasterCompany.name).ilike("%inhyma%"),
                func.lower(MasterCompany.code).ilike("%inh%"),
            )
        ).limit(1)
        company = (await session.execute(stmt)).scalar_one_or_none()
        if company:
            return company.id, [str(company.id)]
        return None, None

    async def apply_create(
        self, session: AsyncSession, payload: dict[str, Any], source_erp_id: str
    ) -> tuple[uuid.UUID, int]:
        """Create a new local Inhyma product or update existing if natural match found."""
        # 1. Deduplication / natural match check first
        existing_match = await self.find_existing_by_natural_key(session, payload)
        if existing_match is not None:
            existing_id, _ = existing_match
            new_ver = await self.apply_update(session, existing_id, payload)
            return existing_id, new_ver

        product_name_tally = (payload.get("product_name_tally") or payload.get("product_name") or "").strip()
        if not product_name_tally:
            raise ValueError("Cannot create Product: missing product_name / product_name_tally in payload.")

        product_code = (payload.get("product_code") or "").strip()
        if not product_code:
            product_code = f"PRD-{uuid.uuid4().hex[:8].upper()}"

        category_id = await self._resolve_category(session, payload)
        sub_category_id = await self._resolve_sub_category(session, category_id, payload)
        brand_id = await self._resolve_brand(session, payload)
        uom_id = await self._resolve_uom(session, payload)
        tax_id = await self._resolve_tax(session, payload)
        org_id, org_ids = await self._resolve_organization(session)

        # Packaging & Gross Weight constraints
        raw_gross = payload.get("packaging_gross_weight") or payload.get("weight") or 1.0
        try:
            packaging_gross_weight = max(float(raw_gross), 0.001)
        except (ValueError, TypeError):
            packaging_gross_weight = 1.0

        raw_net = payload.get("packaging_net_weight")
        packaging_net_weight = float(raw_net) if raw_net is not None else None

        # Dimensions & CBM
        l = payload.get("length_cm") or payload.get("length")
        w = payload.get("width_cm") or payload.get("width")
        h = payload.get("height_cm") or payload.get("height")
        length_val = float(l) if l is not None else None
        width_val = float(w) if w is not None else None
        height_val = float(h) if h is not None else None

        cbm_val = payload.get("packaging_unit_cbm")
        if (cbm_val is None or float(cbm_val or 0) <= 0) and length_val and width_val and height_val:
            packaging_unit_cbm = compute_client_cbm(length_val, width_val, height_val)
        elif cbm_val is not None and float(cbm_val) > 0:
            packaging_unit_cbm = float(cbm_val)
        else:
            packaging_unit_cbm = 0.000001

        status_str = payload.get("status")
        is_active = payload.get("is_active")
        record_status = RecordStatus.ACTIVE
        if is_active is False or status_str == "inactive":
            record_status = RecordStatus.INACTIVE

        product = Product(
            product_name=payload.get("product_name") or product_name_tally,
            product_name_tally=product_name_tally,
            product_name_invoice=payload.get("product_name_invoice"),
            product_code=product_code,
            barcode=payload.get("barcode"),
            product_type=payload.get("product_type") or "Machine",
            category_id=category_id,
            sub_category_id=sub_category_id,
            brand_id=brand_id,
            uom_id=uom_id,
            hsn_id=tax_id,
            organization_id=org_id,
            organization_ids=org_ids,
            branch_ids=payload.get("branch_ids"),
            refund_vat_percent=float(payload.get("refund_vat_percent") or 0.0),
            license_certificate_required=payload.get("license_certificate_required"),
            specification=payload.get("specification"),
            description=payload.get("description"),
            images=payload.get("images") or [],
            packaging_quantity=float(payload.get("packaging_quantity") or 1.0),
            packaging_gross_weight=packaging_gross_weight,
            packaging_net_weight=packaging_net_weight,
            weight=packaging_gross_weight,
            length=length_val,
            width=width_val,
            height=height_val,
            length_cm=length_val,
            width_cm=width_val,
            height_cm=height_val,
            packaging_unit_cbm=packaging_unit_cbm,
            color=payload.get("color"),
            material=payload.get("material"),
            status=record_status,
        )

        session.add(product)
        await session.flush()

        try:
            cache = CacheManager(get_cache())
            await cache.invalidate_dropdown(DROPDOWN_CACHE_NAME)
        except Exception:
            pass

        logger.info(
            "Created Inhyma Product '%s' (%s) synced from %s.",
            product.product_name_tally,
            product.product_code,
            source_erp_id,
            extra={"local_product_id": str(product.id)},
        )
        await _broadcast_product_live_event("product.created", product.id, product.product_name_tally)
        return product.id, getattr(product, "version", 1)

    async def apply_update(
        self,
        session: AsyncSession,
        local_id: uuid.UUID,
        payload: dict[str, Any],
        field_ownership: dict[str, str] | None = None,
    ) -> int:
        """Update an existing local Inhyma product record."""
        stmt = select(Product).where(Product.id == local_id).limit(1)
        product = (await session.execute(stmt)).scalar_one_or_none()
        if product is None:
            logger.warning("Product '%s' not found for update; skipping.", local_id)
            return 1

        if "product_name_tally" in payload and payload["product_name_tally"]:
            product.product_name_tally = payload["product_name_tally"]
        if "product_name" in payload and payload["product_name"]:
            product.product_name = payload["product_name"]
        if "product_name_invoice" in payload:
            product.product_name_invoice = payload["product_name_invoice"]
        if "barcode" in payload:
            product.barcode = payload["barcode"]
        if "specification" in payload:
            product.specification = payload["specification"]
        if "description" in payload:
            product.description = payload["description"]
        if "images" in payload and payload["images"] is not None:
            product.images = payload["images"]
        if "color" in payload:
            product.color = payload["color"]
        if "material" in payload:
            product.material = payload["material"]
        if "license_certificate_required" in payload:
            product.license_certificate_required = payload["license_certificate_required"]
        if "refund_vat_percent" in payload and payload["refund_vat_percent"] is not None:
            product.refund_vat_percent = float(payload["refund_vat_percent"])

        # Update physical & packaging
        if "packaging_gross_weight" in payload and payload["packaging_gross_weight"] is not None:
            gw = max(float(payload["packaging_gross_weight"]), 0.001)
            product.packaging_gross_weight = gw
            product.weight = gw
        if "packaging_net_weight" in payload:
            nw = payload["packaging_net_weight"]
            product.packaging_net_weight = float(nw) if nw is not None else None
        if "packaging_quantity" in payload and payload["packaging_quantity"] is not None:
            product.packaging_quantity = float(payload["packaging_quantity"])

        # Dimensions & CBM
        l = payload.get("length_cm") or payload.get("length")
        w = payload.get("width_cm") or payload.get("width")
        h = payload.get("height_cm") or payload.get("height")
        if l is not None or w is not None or h is not None:
            length_val = float(l) if l is not None else product.length_cm
            width_val = float(w) if w is not None else product.width_cm
            height_val = float(h) if h is not None else product.height_cm
            product.length = length_val
            product.width = width_val
            product.height = height_val
            product.length_cm = length_val
            product.width_cm = width_val
            product.height_cm = height_val
            if length_val and width_val and height_val:
                product.packaging_unit_cbm = compute_client_cbm(length_val, width_val, height_val)

        if "packaging_unit_cbm" in payload and payload["packaging_unit_cbm"] is not None:
            cbm_float = float(payload["packaging_unit_cbm"])
            if cbm_float > 0:
                product.packaging_unit_cbm = cbm_float

        # Status & deactivation updates
        status_val = payload.get("status")
        is_active_val = payload.get("is_active")
        if is_active_val is False or status_val == "inactive":
            product.status = RecordStatus.INACTIVE
            product.deleted_at = None
            logger.info("Deactivated Inhyma product '%s' (%s) per source sync.", product.product_name_tally, product.id)
        elif is_active_val is True or status_val == "active":
            product.status = RecordStatus.ACTIVE
            product.deleted_at = None

        # Re-resolve classifications if names provided
        if payload.get("category_name") or payload.get("category_code"):
            product.category_id = await self._resolve_category(session, payload)
        if payload.get("sub_category_name") or payload.get("sub_category_code"):
            product.sub_category_id = await self._resolve_sub_category(session, product.category_id, payload)
        if payload.get("brand_name") or payload.get("brand_code"):
            product.brand_id = await self._resolve_brand(session, payload)
        if payload.get("uom_code") or payload.get("uom_name"):
            product.uom_id = await self._resolve_uom(session, payload)
        if payload.get("hsn_code"):
            product.hsn_id = await self._resolve_tax(session, payload)

        org_id, org_ids = await self._resolve_organization(session)
        if org_id:
            product.organization_id = org_id
            product.organization_ids = org_ids

        await session.flush()

        try:
            cache = CacheManager(get_cache())
            await cache.invalidate_dropdown(DROPDOWN_CACHE_NAME)
        except Exception:
            pass

        await _broadcast_product_live_event("product.updated", product.id, product.product_name_tally)
        return getattr(product, "version", 1)

    async def apply_delete(
        self, session: AsyncSession, local_id: uuid.UUID, delete_strategy: str
    ) -> None:
        """Handle deactivation of local Inhyma product when source deactivates/deletes."""
        stmt = select(Product).where(Product.id == local_id).limit(1)
        product = (await session.execute(stmt)).scalar_one_or_none()
        if product is None:
            return

        # Soft-delete the product when deleted in source ERP
        product.status = RecordStatus.INACTIVE
        product.deleted_at = _utcnow()
        await session.flush()

        try:
            cache = CacheManager(get_cache())
            await cache.invalidate_dropdown(DROPDOWN_CACHE_NAME)
        except Exception:
            pass

        logger.info("Automatically soft-deleted Inhyma product '%s' (ID: %s) per source deletion.", product.product_name_tally, local_id)
        await _broadcast_product_live_event("product.deleted", local_id, product.product_name_tally)

    async def get_local_version(self, session: AsyncSession, local_id: uuid.UUID) -> int | None:
        """Return the current OCC version integer of the local entity, or None if not found."""
        stmt = select(Product.version).where(Product.id == local_id).limit(1)
        return (await session.execute(stmt)).scalar_one_or_none()

    async def find_existing_by_natural_key(
        self, session: AsyncSession, payload: dict[str, Any]
    ) -> tuple[uuid.UUID, int] | None:
        """Lookup a pre-existing local product by product_code or product_name_tally."""
        code = (payload.get("product_code") or "").strip()
        name_tally = (payload.get("product_name_tally") or payload.get("product_name") or "").strip()

        conditions = []
        if code:
            conditions.append(func.lower(Product.product_code) == code.lower())
        if name_tally:
            conditions.append(func.lower(Product.product_name_tally) == name_tally.lower())
            conditions.append(func.lower(Product.product_name) == name_tally.lower())

        if not conditions:
            return None

        stmt = select(Product).where(or_(*conditions)).limit(1)
        product = (await session.execute(stmt)).scalar_one_or_none()
        if product:
            return product.id, getattr(product, "version", 1)
        return None
