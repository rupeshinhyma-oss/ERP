"""Business logic for Financial Planning Report live 3-module aggregation and persistence."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, NotFoundException
from app.financial_planning.models import FinancialPlanningEntry
from app.financial_planning.schemas import (
    FinancialPlanningAttachmentUpdate,
    FinancialPlanningKpis,
    FinancialPlanningPaymentRecord,
    FinancialPlanningRecordOut,
    FinancialPlanningTermsUpdate,
)
from app.masters.payment_terms.models import PaymentTerm
from app.purchase.models import ImportPurchase, LocalPurchase
from app.sales.models import SaleOrder

# Confirmed stage sets across the 3 wired modules
IMPORT_CONFIRMED_STATUSES: frozenset[str] = frozenset({"confirmed", "received", "closed"})
LOCAL_CONFIRMED_STATUSES: frozenset[str] = frozenset({"confirmed", "received", "closed"})

# Sales Process: stage must have reached "Acc. Confirmed" (excludes pending, sales_confirmed, admin_approved, cancelled)
SALES_ACC_CONFIRMED_STATUSES: frozenset[str] = frozenset(
    {
        "acc_confirmed",
        "account_confirmed",
        "gatepass_created",
        "dispatched",
        "lr",
        "lr_mandatory",
        "completed",
        "delivered",
    }
)

DEFAULT_PAYMENT_TERMS: tuple[str, ...] = (
    "100% Advance",
    "CAD",
    "30 Days Credit",
    "45 Days Credit",
    "60 Days Credit",
    "90 Days Credit",
    "LC",
)


def normalize_sale_status(raw: str | None) -> str:
    """Normalize a SaleOrder.status value for stage comparison."""
    return (raw or "pending").strip().lower().replace(" ", "_").replace("-", "_").replace(".", "")


def format_sale_stage_label(raw: str | None) -> str:
    """Human-readable label for a confirmed Sales Process stage."""
    key = normalize_sale_status(raw)
    mapping = {
        "acc_confirmed": "Acc. Confirmed",
        "account_confirmed": "Acc. Confirmed",
        "gatepass_created": "Gatepass Created",
        "dispatched": "Dispatched",
        "lr": "LR",
        "lr_mandatory": "LR",
        "completed": "Completed",
        "delivered": "Delivered",
    }
    return mapping.get(key, (raw or "Acc. Confirmed").strip() or "Acc. Confirmed")


def format_ddmmyyyy(value: Any) -> str | None:
    """Normalize date/datetime/ISO strings into DD-MM-YYYY display format."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.strftime("%d-%m-%Y")
    if isinstance(value, date):
        return value.strftime("%d-%m-%Y")
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw[:10], fmt).strftime("%d-%m-%Y")
        except ValueError:
            continue
    return raw


def _safe_epoch(dt: datetime | None) -> float:
    if dt is None:
        return 0.0
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).timestamp()
    return dt.timestamp()


def _compute_import_supplier_totals(p: ImportPurchase) -> tuple[str, float]:
    """Return (currency, total_amount) for an ImportPurchase supplier row."""
    usd_header = float(p.invoice_total_usd or 0.0)
    usd_items = sum(float(i.item_total_usd or 0.0) for i in (p.items or []))
    usd_total = round(usd_header if usd_header > 0 else usd_items, 2)
    if usd_total > 0:
        return "USD", usd_total
    inr_total = round(float(p.invoice_total_inr or 0.0), 2)
    return "INR", inr_total


def _compute_import_taxes_total(p: ImportPurchase) -> float:
    """Return total customs/import taxes in INR for an ImportPurchase consignment."""
    duty_header = float(p.total_import_duty or 0.0)
    duty_items = sum(float(i.item_total_duty or 0.0) for i in (p.items or []))
    duty_base = duty_header if duty_header > 0 else duty_items
    stamp = float(p.stamp_duty or 0.0)
    return round(duty_base + stamp, 2)


def _compute_local_supplier_total(p: LocalPurchase) -> float:
    """Return total INR amount for a LocalPurchase supplier row."""
    inc_gst = float(p.invoice_value_inc_gst or 0.0)
    ex_gst = float(p.invoice_value_ex_gst or 0.0)
    items_sum = sum(float(i.item_total or 0.0) for i in (p.items or []))
    if inc_gst > 0:
        return round(inc_gst, 2)
    if ex_gst > 0:
        return round(ex_gst, 2)
    return round(items_sum, 2)


def _compute_sale_order_total(order: SaleOrder) -> tuple[str, float]:
    """Return (currency, total_amount) for an Acc. Confirmed SaleOrder row."""
    raw_curr = (order.currency or "INR").strip().upper()
    currency = "USD" if raw_curr in ("USD", "$") else "INR"
    inc_gst = float(order.amount_inc_gst or 0.0)
    tot = float(order.total_amount or 0.0)
    amount = round(inc_gst if inc_gst > 0 else tot, 2)
    return currency, amount


def _merge_with_overlay(
    *,
    entry_key: str,
    party_name: str,
    party_type: str,
    invoice_no: str,
    default_invoice_url: str | None,
    default_invoice_name: str | None,
    default_payment_terms: str | None,
    currency: str,
    total_amount: float,
    default_due_date: str | None,
    default_remarks: str | None,
    source_module: str,
    source_label: str,
    source_stage: str,
    source_record_id: str,
    overlay: FinancialPlanningEntry | None,
) -> FinancialPlanningRecordOut:
    paid = round(max(0.0, float(overlay.paid_amount or 0.0)), 2) if overlay else 0.0
    total = round(max(0.0, float(total_amount or 0.0)), 2)
    balance = round(max(0.0, total - paid), 2)
    status_label = "Cleared" if (total <= 0 or balance <= 0.009) else "Pending"

    inv_url = (
        overlay.invoice_attachment_url
        if overlay and overlay.invoice_attachment_url
        else default_invoice_url
    )
    inv_name = (
        overlay.invoice_attachment_name
        if overlay and overlay.invoice_attachment_url
        else default_invoice_name
    )

    terms = (
        (overlay.payment_terms_override or None)
        if overlay and overlay.payment_terms_override is not None
        else default_payment_terms
    )
    due = (
        (format_ddmmyyyy(overlay.due_date_override) if overlay.due_date_override else None)
        if overlay and overlay.due_date_override is not None
        else default_due_date
    )
    remarks = (
        (overlay.remarks or None)
        if overlay and overlay.remarks is not None
        else default_remarks
    )

    return FinancialPlanningRecordOut(
        id=entry_key,
        entry_key=entry_key,
        party_name=party_name,
        party_type=party_type,  # type: ignore[arg-type]
        invoice_no=invoice_no,
        invoice_attachment_url=inv_url,
        invoice_attachment_name=inv_name,
        allow_invoice_upload=True,
        payment_terms=terms,
        payment_attachment_url=overlay.payment_attachment_url if overlay else None,
        payment_attachment_name=overlay.payment_attachment_name if overlay else None,
        currency="USD" if currency == "USD" else "INR",
        total_amount=total,
        paid_amount=paid,
        balance_amount=balance,
        due_date=due,
        status=status_label,  # type: ignore[arg-type]
        remarks=remarks,
        source_module=source_module,  # type: ignore[arg-type]
        source_label=source_label,
        source_stage=source_stage,
        source_record_id=source_record_id,
        payments_history=list(overlay.payments_history or []) if overlay else [],
    )


class FinancialPlanningService:
    """Aggregates confirmed Import Purchase, Local Purchase, and Acc. Confirmed Sales Process entries."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_report(self) -> dict[str, Any]:
        # 1. Load persistent overlays
        overlay_rows = (
            await self.session.execute(
                select(FinancialPlanningEntry).where(FinancialPlanningEntry.deleted_at.is_(None))
            )
        ).scalars().all()
        overlays: dict[str, FinancialPlanningEntry] = {row.entry_key: row for row in overlay_rows}

        # 2. Load active Payment Terms master options
        pt_rows = (
            await self.session.execute(
                select(PaymentTerm.name)
                .where(
                    PaymentTerm.deleted_at.is_(None),
                    PaymentTerm.status == RecordStatus.ACTIVE,
                )
                .order_by(PaymentTerm.name.asc())
            )
        ).scalars().all()
        terms_options: list[str] = list(DEFAULT_PAYMENT_TERMS)
        seen_lower = {t.lower() for t in terms_options}
        for pt_name in pt_rows:
            clean_pt = (pt_name or "").strip()
            if clean_pt and clean_pt.lower() not in seen_lower:
                terms_options.append(clean_pt)
                seen_lower.add(clean_pt.lower())

        sortable_items: list[tuple[float, int, FinancialPlanningRecordOut]] = []

        # 3. Import Purchase (confirmed / received / closed)
        import_rows = (
            await self.session.execute(
                select(ImportPurchase).where(
                    ImportPurchase.deleted_at.is_(None),
                    func.lower(func.trim(ImportPurchase.status)).in_(IMPORT_CONFIRMED_STATUSES),
                )
            )
        ).scalars().all()

        for imp in import_rows:
            ts = _safe_epoch(imp.confirmed_at or imp.updated_at or imp.created_at)
            due_default = format_ddmmyyyy(
                imp.expected_arrival_date or imp.eta_port_date or imp.invoice_date or imp.ordered_date
            )
            curr, total_val = _compute_import_supplier_totals(imp)
            sup_key = f"import_purchase:{imp.id}:supplier"
            sup_record = _merge_with_overlay(
                entry_key=sup_key,
                party_name=(imp.supplier_name or "").strip() or "—",
                party_type="Supplier",
                invoice_no=(imp.consignment_no or "").strip() or "—",
                default_invoice_url=(
                    f"/api/v1/purchase/import-orders/{imp.id}/bill-file" if imp.bill_file_url else None
                ),
                default_invoice_name=imp.bill_file_name,
                default_payment_terms=None,
                currency=curr,
                total_amount=total_val,
                default_due_date=due_default,
                default_remarks=imp.remarks,
                source_module="import_purchase",
                source_label="Import Purchase",
                source_stage=(imp.status or "confirmed").strip().title(),
                source_record_id=str(imp.id),
                overlay=overlays.get(sup_key),
            )
            # Sub-order 2 keeps Supplier immediately above its paired Total Taxes (INR) row
            sortable_items.append((ts, 2, sup_record))

            tax_total = _compute_import_taxes_total(imp)
            if tax_total > 0:
                tax_key = f"import_purchase:{imp.id}:taxes"
                tax_record = _merge_with_overlay(
                    entry_key=tax_key,
                    party_name="Total Taxes (INR)",
                    party_type="Taxes",
                    invoice_no=(imp.consignment_no or "").strip() or "—",
                    default_invoice_url=None,
                    default_invoice_name=None,
                    default_payment_terms=None,
                    currency="INR",
                    total_amount=tax_total,
                    default_due_date=due_default,
                    default_remarks=None,
                    source_module="import_purchase",
                    source_label="Import Purchase",
                    source_stage=(imp.status or "confirmed").strip().title(),
                    source_record_id=str(imp.id),
                    overlay=overlays.get(tax_key),
                )
                sortable_items.append((ts, 1, tax_record))

        # 4. Local Purchase (confirmed)
        local_rows = (
            await self.session.execute(
                select(LocalPurchase).where(
                    LocalPurchase.deleted_at.is_(None),
                    func.lower(func.trim(LocalPurchase.status)).in_(LOCAL_CONFIRMED_STATUSES),
                )
            )
        ).scalars().all()

        for loc in local_rows:
            ts = _safe_epoch(loc.confirmed_at or loc.updated_at or loc.created_at)
            loc_key = f"local_purchase:{loc.id}:supplier"
            loc_record = _merge_with_overlay(
                entry_key=loc_key,
                party_name=(loc.supplier_name or "").strip() or "—",
                party_type="Supplier",
                invoice_no=(loc.invoice_no or "").strip() or "—",
                default_invoice_url=(
                    f"/api/v1/purchase/local-orders/{loc.id}/bill-file" if loc.bill_file_url else None
                ),
                default_invoice_name=loc.bill_file_name,
                default_payment_terms=None,
                currency="INR",
                total_amount=_compute_local_supplier_total(loc),
                default_due_date=format_ddmmyyyy(loc.invoice_date),
                default_remarks=loc.remarks,
                source_module="local_purchase",
                source_label="Local Purchase",
                source_stage=(loc.status or "confirmed").strip().title(),
                source_record_id=str(loc.id),
                overlay=overlays.get(loc_key),
            )
            sortable_items.append((ts, 2, loc_record))

        # 5. Sales Process (Acc. Confirmed and downstream active stages)
        sale_rows = (
            await self.session.execute(
                select(SaleOrder).where(SaleOrder.deleted_at.is_(None))
            )
        ).scalars().all()

        for so in sale_rows:
            norm_stage = normalize_sale_status(so.status)
            if norm_stage not in SALES_ACC_CONFIRMED_STATUSES:
                continue
            ts = _safe_epoch(so.updated_at or so.created_at)
            curr, total_val = _compute_sale_order_total(so)
            so_key = f"sales_process:{so.id}:client"
            default_inv_url = so.tally_bill_url or so.po_file_url
            default_inv_name = so.tally_bill_name if so.tally_bill_url else so.po_file_name
            so_record = _merge_with_overlay(
                entry_key=so_key,
                party_name=(so.company_name or so.buyer_name or "").strip() or "—",
                party_type="Customer",
                invoice_no=(so.invoice_no or "").strip() or (so.order_no or "").strip() or "—",
                default_invoice_url=default_inv_url,
                default_invoice_name=default_inv_name,
                default_payment_terms=(so.payment_terms or "").strip() or None,
                currency=curr,
                total_amount=total_val,
                default_due_date=format_ddmmyyyy(so.invoice_date or so.delivery_date or so.order_date),
                default_remarks=so.remarks,
                source_module="sales_process",
                source_label="Sales Process",
                source_stage=format_sale_stage_label(so.status),
                source_record_id=str(so.id),
                overlay=overlays.get(so_key),
            )
            sortable_items.append((ts, 2, so_record))

        # Sort newest first while preserving (Consignment Supplier -> Consignment Taxes) pairing
        sortable_items.sort(key=lambda pair: (pair[0], pair[1]), reverse=True)
        items = [pair[2] for pair in sortable_items]

        kpis = FinancialPlanningKpis()
        for item in items:
            if item.currency == "USD":
                kpis.usd_all = round(kpis.usd_all + item.total_amount, 2)
                kpis.usd_paid = round(kpis.usd_paid + item.paid_amount, 2)
                kpis.usd_balance = round(kpis.usd_balance + item.balance_amount, 2)
                kpis.usd_count += 1
            else:
                kpis.inr_all = round(kpis.inr_all + item.total_amount, 2)
                kpis.inr_paid = round(kpis.inr_paid + item.paid_amount, 2)
                kpis.inr_balance = round(kpis.inr_balance + item.balance_amount, 2)
                kpis.inr_count += 1

            if item.status == "Cleared":
                kpis.cleared_count += 1
            else:
                kpis.pending_count += 1

        return {
            "items": [i.model_dump(mode="json") for i in items],
            "kpis": kpis.model_dump(mode="json"),
            "payment_terms_options": terms_options,
        }

    @staticmethod
    def _parse_entry_key(entry_key: str) -> tuple[str, uuid.UUID, str]:
        parts = (entry_key or "").strip().split(":")
        if len(parts) != 3:
            raise BadRequestException("Invalid Financial Planning entry key format.")
        source_module, raw_id, role = parts[0], parts[1], parts[2]
        if source_module not in ("import_purchase", "local_purchase", "sales_process"):
            raise BadRequestException(f"Unsupported source module '{source_module}'.")
        if role not in ("supplier", "taxes", "client"):
            raise BadRequestException(f"Unsupported entry role '{role}'.")
        try:
            record_id = uuid.UUID(raw_id)
        except ValueError as exc:
            raise BadRequestException("Invalid source record UUID in entry key.") from exc
        return source_module, record_id, role

    async def _load_source_and_build(
        self,
        entry_key: str,
        overlay: FinancialPlanningEntry | None,
    ) -> FinancialPlanningRecordOut:
        source_module, record_id, role = self._parse_entry_key(entry_key)

        if source_module == "import_purchase":
            imp = (
                await self.session.execute(
                    select(ImportPurchase).where(
                        ImportPurchase.id == record_id,
                        ImportPurchase.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if not imp or (imp.status or "").strip().lower() not in IMPORT_CONFIRMED_STATUSES:
                raise NotFoundException("Confirmed Import Purchase record not found.")

            due_default = format_ddmmyyyy(
                imp.expected_arrival_date or imp.eta_port_date or imp.invoice_date or imp.ordered_date
            )
            if role == "taxes":
                tax_total = _compute_import_taxes_total(imp)
                return _merge_with_overlay(
                    entry_key=entry_key,
                    party_name="Total Taxes (INR)",
                    party_type="Taxes",
                    invoice_no=(imp.consignment_no or "").strip() or "—",
                    default_invoice_url=None,
                    default_invoice_name=None,
                    default_payment_terms=None,
                    currency="INR",
                    total_amount=tax_total,
                    default_due_date=due_default,
                    default_remarks=None,
                    source_module="import_purchase",
                    source_label="Import Purchase",
                    source_stage=(imp.status or "confirmed").strip().title(),
                    source_record_id=str(imp.id),
                    overlay=overlay,
                )

            curr, total_val = _compute_import_supplier_totals(imp)
            return _merge_with_overlay(
                entry_key=entry_key,
                party_name=(imp.supplier_name or "").strip() or "—",
                party_type="Supplier",
                invoice_no=(imp.consignment_no or "").strip() or "—",
                default_invoice_url=(
                    f"/api/v1/purchase/import-orders/{imp.id}/bill-file" if imp.bill_file_url else None
                ),
                default_invoice_name=imp.bill_file_name,
                default_payment_terms=None,
                currency=curr,
                total_amount=total_val,
                default_due_date=due_default,
                default_remarks=imp.remarks,
                source_module="import_purchase",
                source_label="Import Purchase",
                source_stage=(imp.status or "confirmed").strip().title(),
                source_record_id=str(imp.id),
                overlay=overlay,
            )

        if source_module == "local_purchase":
            loc = (
                await self.session.execute(
                    select(LocalPurchase).where(
                        LocalPurchase.id == record_id,
                        LocalPurchase.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if not loc or (loc.status or "").strip().lower() not in LOCAL_CONFIRMED_STATUSES:
                raise NotFoundException("Confirmed Local Purchase record not found.")

            return _merge_with_overlay(
                entry_key=entry_key,
                party_name=(loc.supplier_name or "").strip() or "—",
                party_type="Supplier",
                invoice_no=(loc.invoice_no or "").strip() or "—",
                default_invoice_url=(
                    f"/api/v1/purchase/local-orders/{loc.id}/bill-file" if loc.bill_file_url else None
                ),
                default_invoice_name=loc.bill_file_name,
                default_payment_terms=None,
                currency="INR",
                total_amount=_compute_local_supplier_total(loc),
                default_due_date=format_ddmmyyyy(loc.invoice_date),
                default_remarks=loc.remarks,
                source_module="local_purchase",
                source_label="Local Purchase",
                source_stage=(loc.status or "confirmed").strip().title(),
                source_record_id=str(loc.id),
                overlay=overlay,
            )

        # sales_process
        so = (
            await self.session.execute(
                select(SaleOrder).where(
                    SaleOrder.id == record_id,
                    SaleOrder.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if not so or normalize_sale_status(so.status) not in SALES_ACC_CONFIRMED_STATUSES:
            raise NotFoundException("Acc. Confirmed Sales Order record not found.")

        curr, total_val = _compute_sale_order_total(so)
        default_inv_url = so.tally_bill_url or so.po_file_url
        default_inv_name = so.tally_bill_name if so.tally_bill_url else so.po_file_name
        return _merge_with_overlay(
            entry_key=entry_key,
            party_name=(so.company_name or so.buyer_name or "").strip() or "—",
            party_type="Customer",
            invoice_no=(so.invoice_no or "").strip() or (so.order_no or "").strip() or "—",
            default_invoice_url=default_inv_url,
            default_invoice_name=default_inv_name,
            default_payment_terms=(so.payment_terms or "").strip() or None,
            currency=curr,
            total_amount=total_val,
            default_due_date=format_ddmmyyyy(so.invoice_date or so.delivery_date or so.order_date),
            default_remarks=so.remarks,
            source_module="sales_process",
            source_label="Sales Process",
            source_stage=format_sale_stage_label(so.status),
            source_record_id=str(so.id),
            overlay=overlay,
        )

    async def _get_or_create_overlay(self, entry_key: str) -> FinancialPlanningEntry:
        source_module, record_id, _role = self._parse_entry_key(entry_key)
        # Verify source exists and is in confirmed stage before creating overlay
        existing = (
            await self.session.execute(
                select(FinancialPlanningEntry).where(FinancialPlanningEntry.entry_key == entry_key)
            )
        ).scalar_one_or_none()
        await self._load_source_and_build(entry_key, existing)

        if existing is not None:
            if existing.deleted_at is not None:
                existing.deleted_at = None
            return existing

        created = FinancialPlanningEntry(
            entry_key=entry_key,
            source_module=source_module,
            source_record_id=record_id,
            paid_amount=0.0,
            payments_history=[],
        )
        self.session.add(created)
        await self.session.flush()
        return created

    async def update_terms(
        self,
        entry_key: str,
        payload: FinancialPlanningTermsUpdate,
        actor_name: str,
    ) -> dict[str, Any]:
        overlay = await self._get_or_create_overlay(entry_key)
        overlay.payment_terms_override = (payload.payment_terms or "").strip()
        overlay.due_date_override = format_ddmmyyyy(payload.due_date) if payload.due_date else ""
        if payload.remarks is not None:
            overlay.remarks = payload.remarks.strip()
        if payload.payment_attachment_url is not None:
            overlay.payment_attachment_url = payload.payment_attachment_url.strip() or None
            overlay.payment_attachment_name = (payload.payment_attachment_name or "").strip() or None
        overlay.updated_by_name = actor_name
        await self.session.flush()

        built = await self._load_source_and_build(entry_key, overlay)
        return built.model_dump(mode="json")

    async def record_payment(
        self,
        entry_key: str,
        payload: FinancialPlanningPaymentRecord,
        actor_name: str,
    ) -> dict[str, Any]:
        overlay = await self._get_or_create_overlay(entry_key)
        current_view = await self._load_source_and_build(entry_key, overlay)

        add_amount = round(float(payload.amount), 2)
        if add_amount <= 0:
            raise BadRequestException("Payment amount must be greater than 0.")

        if current_view.total_amount > 0 and add_amount > current_view.balance_amount + 0.01:
            raise BadRequestException(
                f"Payment amount ({add_amount:.2f}) exceeds remaining balance ({current_view.balance_amount:.2f})."
            )

        next_paid = round(float(overlay.paid_amount or 0.0) + add_amount, 2)
        if current_view.total_amount > 0 and next_paid >= current_view.total_amount - 0.009:
            next_paid = current_view.total_amount
        overlay.paid_amount = next_paid

        if payload.remarks and payload.remarks.strip():
            overlay.remarks = payload.remarks.strip()
        if payload.payment_attachment_url:
            overlay.payment_attachment_url = payload.payment_attachment_url.strip()
            overlay.payment_attachment_name = (payload.payment_attachment_name or "").strip() or "Payment_Receipt"

        history_entry = {
            "id": uuid.uuid4().hex,
            "amount": add_amount,
            "payment_mode": (payload.payment_mode or "").strip() or None,
            "payment_date": format_ddmmyyyy(payload.payment_date) or datetime.now(timezone.utc).strftime("%d-%m-%Y"),
            "reference_no": (payload.reference_no or "").strip() or None,
            "remarks": (payload.remarks or "").strip() or None,
            "recorded_by": actor_name,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
        overlay.payments_history = [*(overlay.payments_history or []), history_entry]
        overlay.updated_by_name = actor_name
        await self.session.flush()

        built = await self._load_source_and_build(entry_key, overlay)
        return built.model_dump(mode="json")

    async def update_attachment(
        self,
        entry_key: str,
        payload: FinancialPlanningAttachmentUpdate,
        actor_name: str,
    ) -> dict[str, Any]:
        overlay = await self._get_or_create_overlay(entry_key)
        clean_url = payload.file_url.strip()
        clean_name = (payload.file_name or "").strip() or None

        if payload.attachment_type == "payment":
            overlay.payment_attachment_url = clean_url
            overlay.payment_attachment_name = clean_name or "Payment_Attachment"
        else:
            overlay.invoice_attachment_url = clean_url
            overlay.invoice_attachment_name = clean_name or "Invoice_Attachment"

        overlay.updated_by_name = actor_name
        await self.session.flush()

        built = await self._load_source_and_build(entry_key, overlay)
        return built.model_dump(mode="json")
