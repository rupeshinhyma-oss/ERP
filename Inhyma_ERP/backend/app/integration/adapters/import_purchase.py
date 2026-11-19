"""
ImportPurchase Entity Sync Adapter (Yinglima -> Inhyma).

Automatically creates, updates, or cancels a pending ImportPurchase in Inhyma_ERP
when a Yinglima SaleOrder for buyer Inhyma is confirmed, updated, reverted, or cancelled.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.currency import get_usd_to_inr_rate
from app.core.logging import get_logger
from app.integration.adapters.base import BaseEntitySyncAdapter
from app.masters.products.models import Product
from app.masters.warehouses.models import Warehouse
from app.purchase import costing
from app.purchase.models import ImportPurchase, ImportPurchaseItem
from app.suppliers.models import Supplier

logger = get_logger(__name__)

_ITEM_FIELDS = (
    "product_name",
    "product_code",
    "uom",
    "quantity",
    "pkg_unit_cbm",
    "pkg_qty",
    "item_total_cbm",
    "unit_rate_usd",
    "unit_rate_inr",
    "item_total_usd",
    "duty_percent",
    "unit_import_duty",
    "item_total_duty",
    "exp_per_unit_vb",
    "exp_per_unit_cb",
    "unit_landing_vb",
    "unit_landing_cb",
    "landing_diff",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_date(val: Any) -> date | None:
    if not val:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def resolve_inhyma_warehouse_name(payload: dict[str, Any]) -> str:
    """Map Yinglima buyer branch / consignment code to Inhyma Ordered warehouse."""
    branch = str(payload.get("branch_name") or "").strip().lower()
    buyer = str(payload.get("buyer_name") or "").strip().lower()
    cons = str(payload.get("consignment_code") or "").strip().lower()

    if "ahmedabad" in branch or "gj" in branch or "ahmedabad" in buyer:
        return "Ahmedabad Ordered"
    if "indore" in branch or "indore" in buyer:
        return "Indore Ordered"
    if "mumbai" in branch or "mum" in branch or "mumbai" in buyer:
        return "Mumbai Ordered"

    if cons.startswith("gj"):
        return "Ahmedabad Ordered"
    if cons.startswith("ind"):
        return "Indore Ordered"
    return "Mumbai Ordered"


class ImportPurchaseSyncAdapter(BaseEntitySyncAdapter):
    """Synchronizes Yinglima confirmed SaleOrders into Inhyma ImportPurchase."""

    @property
    def entity_type(self) -> str:
        return "import_purchase"

    async def _resolve_supplier(self, session: AsyncSession) -> tuple[uuid.UUID | None, str]:
        stmt = (
            select(Supplier)
            .where(
                Supplier.deleted_at.is_(None),
                func.lower(Supplier.company_name).like("%yinglima%"),
            )
            .limit(1)
        )
        sup = (await session.execute(stmt)).scalar_one_or_none()
        if sup:
            return sup.id, sup.company_name
        return None, "Yinglima Packaging Machinery Co., Ltd."

    async def _resolve_warehouse(self, session: AsyncSession, target_name: str) -> str:
        stmt = (
            select(Warehouse)
            .where(
                Warehouse.deleted_at.is_(None),
                func.lower(Warehouse.name) == target_name.lower(),
            )
            .limit(1)
        )
        wh = (await session.execute(stmt)).scalar_one_or_none()
        return wh.name if wh else target_name

    async def _build_items_and_compute(
        self, session: AsyncSession, payload: dict[str, Any], conv_rate: float
    ) -> tuple[costing.ImportResult, float]:
        raw_items = payload.get("items") or []
        items_in: list[costing.ImportItemIn] = []
        total_cbm = float(payload.get("total_cbm") or 0.0)
        computed_cbm = 0.0

        for raw in raw_items:
            p_code = (raw.get("product_code") or "").strip() or None
            p_name = (raw.get("product_name") or p_code or "Synced Product").strip()
            qty = float(raw.get("quantity") or 0.0)
            unit_usd = float(raw.get("unit_price_usd") or 0.0)
            uom = (raw.get("uom") or "").strip() or None
            pkg_unit_cbm = float(raw.get("pkg_unit_cbm") or 0.0)
            pkg_qty = float(raw.get("pkg_qty") or 1.0) or 1.0
            duty_pct = float(raw.get("duty_percent") or 0.0)

            prod = None
            if p_code:
                prod = (
                    await session.execute(
                        select(Product)
                        .where(Product.deleted_at.is_(None), func.lower(Product.product_code) == p_code.lower())
                        .limit(1)
                    )
                ).scalar_one_or_none()
            if prod is None and p_name:
                prod = (
                    await session.execute(
                        select(Product)
                        .where(Product.deleted_at.is_(None), func.lower(Product.product_name) == p_name.lower())
                        .limit(1)
                    )
                ).scalar_one_or_none()

            if prod is not None:
                p_name = prod.product_name
                p_code = prod.product_code or p_code
                if not uom and getattr(prod, "uom", None):
                    uom = str(prod.uom)
                if duty_pct == 0.0 and getattr(prod, "import_duty_percent", None):
                    duty_pct = float(prod.import_duty_percent or 0.0)

            computed_cbm += (qty * pkg_unit_cbm) / pkg_qty if pkg_qty else 0.0
            items_in.append(
                costing.ImportItemIn(
                    product_name=p_name,
                    product_code=p_code,
                    uom=uom,
                    quantity=qty,
                    pkg_unit_cbm=pkg_unit_cbm,
                    pkg_qty=pkg_qty,
                    unit_rate_usd=unit_usd,
                    duty_percent=duty_pct,
                )
            )

        effective_cbm = total_cbm if total_cbm > 0 else round(computed_cbm, 4)
        inv_usd = float(payload.get("total_amount_usd") or 0.0)
        if inv_usd <= 0 and items_in:
            inv_usd = round(sum(it.quantity * it.unit_rate_usd for it in items_in), 2)

        result = costing.compute_import(
            conversion_rate=conv_rate,
            customs_conversion_rate=conv_rate,
            invoice_total_usd=inv_usd,
            total_cbm=effective_cbm,
            total_import_duty=0.0,
            expenses=[0.0] * 8,
            items=items_in,
        )
        return result, effective_cbm

    async def apply_create(
        self, session: AsyncSession, payload: dict[str, Any], source_erp_id: str
    ) -> tuple[uuid.UUID, int]:
        sup_id, sup_name = await self._resolve_supplier(session)
        wh_name = await self._resolve_warehouse(session, resolve_inhyma_warehouse_name(payload))

        conv_rate = float(payload.get("conversion_rate") or 0.0)
        if conv_rate <= 0:
            conv_rate = await get_usd_to_inr_rate()

        result, effective_cbm = await self._build_items_and_compute(session, payload, conv_rate)

        order_no = str(payload.get("order_no") or "").strip()
        cons_no = str(payload.get("consignment_code") or order_no or "YLM-SYNC").strip()
        ordered_date = _parse_date(payload.get("order_date")) or date.today()

        inv_usd = float(payload.get("total_amount_usd") or 0.0)
        if inv_usd <= 0 and result.items:
            inv_usd = round(sum(it.item_total_usd for it in result.items), 2)

        base_remark = f"Auto-synced from {source_erp_id.title()} Sale Order {order_no}".strip()
        src_remarks = str(payload.get("remarks") or "").strip()
        full_remarks = f"{base_remark}\n{src_remarks}".strip() if src_remarks else base_remark

        record = ImportPurchase(
            consignment_no=cons_no,
            supplier_name=sup_name,
            supplier_id=sup_id,
            warehouse=wh_name,
            ordered_date=ordered_date,
            etd_origin_date=_parse_date(payload.get("etd_origin_date")),
            eta_port_date=_parse_date(payload.get("eta_port_date")),
            expected_arrival_date=_parse_date(payload.get("eta_port_date")),
            invoice_date=ordered_date,
            conversion_rate=conv_rate,
            customs_conversion_rate=conv_rate,
            invoice_total_usd=inv_usd,
            invoice_total_inr=result.invoice_total_inr,
            total_cbm=effective_cbm,
            total_import_duty=0.0,
            total_expenses=result.total_expenses,
            gross_total_landing=result.gross_total_landing,
            loading_percent_vb=result.loading_percent_vb,
            loading_amount_per_cbm=result.loading_amount_per_cbm,
            remarks=full_remarks,
            status="pending",
            stock_applied=False,
            created_by=f"{source_erp_id}-sync",
        )
        for ln in result.items:
            record.items.append(ImportPurchaseItem(**{f: getattr(ln, f) for f in _ITEM_FIELDS}))

        session.add(record)
        await session.flush()
        logger.info(
            "Created ImportPurchase %s (%s -> %s) from %s order %s",
            record.id,
            cons_no,
            wh_name,
            source_erp_id,
            order_no,
        )
        return record.id, int(getattr(record, "version", 1) or 1)

    async def apply_update(
        self,
        session: AsyncSession,
        local_id: uuid.UUID,
        payload: dict[str, Any],
        field_ownership: dict[str, str] | None = None,
    ) -> int:
        record = (
            await session.execute(
                select(ImportPurchase).where(ImportPurchase.id == local_id)
            )
        ).scalar_one_or_none()
        if record is None:
            raise ValueError(f"ImportPurchase {local_id} not found for sync update.")

        if record.deleted_at is not None:
            if (record.status or "").lower() == "cancelled" and not record.stock_applied:
                record.deleted_at = None
                record.status = "pending"
            else:
                return int(getattr(record, "version", 1) or 1)

        if (record.status or "").lower() != "pending" or record.stock_applied:
            logger.info("Skipping sync update for ImportPurchase %s (status=%s)", local_id, record.status)
            return int(getattr(record, "version", 1) or 1)

        wh_name = await self._resolve_warehouse(session, resolve_inhyma_warehouse_name(payload))
        conv_rate = float(record.conversion_rate or 0.0) or await get_usd_to_inr_rate()
        result, effective_cbm = await self._build_items_and_compute(session, payload, conv_rate)

        cons_no = str(payload.get("consignment_code") or payload.get("order_no") or record.consignment_no).strip()
        record.consignment_no = cons_no
        record.warehouse = wh_name
        record.etd_origin_date = _parse_date(payload.get("etd_origin_date")) or record.etd_origin_date
        record.eta_port_date = _parse_date(payload.get("eta_port_date")) or record.eta_port_date
        record.total_cbm = effective_cbm
        inv_usd = float(payload.get("total_amount_usd") or 0.0)
        if inv_usd > 0:
            record.invoice_total_usd = inv_usd
        record.invoice_total_inr = result.invoice_total_inr
        record.gross_total_landing = result.gross_total_landing

        record.items.clear()
        for ln in result.items:
            record.items.append(ImportPurchaseItem(**{f: getattr(ln, f) for f in _ITEM_FIELDS}))

        await session.flush()
        return int(getattr(record, "version", 1) or 1)

    async def apply_delete(
        self, session: AsyncSession, local_id: uuid.UUID, delete_strategy: str
    ) -> None:
        record = (
            await session.execute(
                select(ImportPurchase).where(ImportPurchase.id == local_id, ImportPurchase.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if record is None:
            return

        if (record.status or "").lower() != "pending" or record.stock_applied:
            logger.warning(
                "Refusing to auto-delete ImportPurchase %s because status=%s, stock_applied=%s",
                local_id,
                record.status,
                record.stock_applied,
            )
            return

        if delete_strategy == "IGNORE_DELETE":
            return

        record.status = "cancelled"
        record.deleted_at = _utcnow()
        await session.flush()
        logger.info("Soft-deleted pending ImportPurchase %s due to Yinglima order revert/cancel.", local_id)

    async def get_local_version(self, session: AsyncSession, local_id: uuid.UUID) -> int | None:
        record = (
            await session.execute(
                select(ImportPurchase).where(ImportPurchase.id == local_id, ImportPurchase.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if record is None:
            return None
        return int(getattr(record, "version", 1) or 1)

    async def find_existing_by_natural_key(
        self, session: AsyncSession, payload: dict[str, Any]
    ) -> tuple[uuid.UUID, int] | None:
        order_no = str(payload.get("order_no") or "").strip()
        cons_code = str(payload.get("consignment_code") or "").strip()
        if not order_no and not cons_code:
            return None

        if cons_code:
            by_cons = (
                await session.execute(
                    select(ImportPurchase)
                    .where(
                        ImportPurchase.deleted_at.is_(None),
                        func.lower(ImportPurchase.consignment_no) == cons_code.lower(),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if by_cons is not None:
                return by_cons.id, int(getattr(by_cons, "version", 1) or 1)

        if not order_no:
            return None

        marker = f"sale order {order_no.lower()}"
        candidates = (
            await session.execute(
                select(ImportPurchase).where(
                    ImportPurchase.deleted_at.is_(None),
                    or_(
                        func.lower(ImportPurchase.consignment_no) == order_no.lower(),
                        ImportPurchase.remarks.ilike(f"%Sale Order {order_no}%"),
                    ),
                )
            )
        ).scalars().all()
        for existing in candidates:
            if (existing.consignment_no or "").strip().lower() == order_no.lower():
                return existing.id, int(getattr(existing, "version", 1) or 1)
            for line in (existing.remarks or "").splitlines():
                if line.strip().lower().endswith(marker):
                    return existing.id, int(getattr(existing, "version", 1) or 1)
        return None
