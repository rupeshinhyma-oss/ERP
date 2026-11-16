"""
Service layer for the Financial Report & Payment Planner Module.
"""

from __future__ import annotations

import io
import json
import re
import time
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.common.currency import get_active_rates
from app.common.storage import sanitize_filename, save_uploaded_file
from app.core.exceptions import NotFoundException, ValidationException
from app.core.logging import get_logger
from app.finance.models import (
    ConsignmentOverviewMeta,
    FinancePayment,
    FinanceRecordMeta,
    VatReturnReceipt,
    VatReturnRecord,
)
from app.finance.schemas import (
    ConsignmentChecklistItem,
    ConsignmentChecklistUpdatePayload,
    ConsignmentDocumentSlot,
    ConsignmentFinanceLine,
    ConsignmentOverviewListResponse,
    ConsignmentOverviewRow,
    ConsignmentProductLine,
    FinanceMetaUpdate,
    FinancePaymentCreate,
    FinancePaymentResponse,
    FinanceReportResponse,
    LocalPurchaseFinanceRow,
    SaleOrderFinanceRow,
    SectionKpiSummary,
    VatReturnBreakdownItem,
    VatReturnKpiSummary,
    VatReturnListResponse,
    VatReturnManualCreatePayload,
    VatReturnReceiptCreate,
    VatReturnReceiptResponse,
    VatReturnRow,
    VatReturnStageFilterLiteral,
    VatReturnStatusLiteral,
    VatReturnUpdatePayload,
)
from app.masters.hsn.models import HsnCode
from app.masters.products.models import Product
from app.planning.models import PlanningColumn
from app.purchases.local.models import LocalPurchase
from app.purchases.local.service import LocalPurchaseService
from app.sales.models import SaleOrder

logger = get_logger(__name__)

# Statuses that are NOT yet confirmed or are cancelled (excluded from Financial Report).
# Once an entry is Confirmed (including after it is Inwarded / Dispatched / LR), it stays in the Financial Report.
EXCLUDED_STATUSES = ("pending", "draft", "cancelled", "canceled")
_TABLES_VERIFIED = True
_CONSIGNMENT_TABLE_VERIFIED = False
_CACHED_USD_TO_RMB: float = 7.20
_CACHED_RATE_TS: float = 0.0

CONSIGNMENT_DOC_SLOTS: list[tuple[str, str]] = [
    ("proforma_invoice", "Proforma Invoice (PI)"),
    ("sales_contract", "Sales Contract"),
    ("swift_tt_advance", "Swift T.T 1 - Advance"),
    ("swift_tt_balance", "Swift T.T 2 - Balance"),
    ("supplier_vat_fapiao", "Supplier Tax Invoice (Fapiao / Bill)"),
    ("draft_bl", "Draft Approved Bill of Lading"),
    ("final_bl", "Final Bill of Lading (BL)"),
    ("commercial_invoice", "Commercial Invoice (CI)"),
    ("packing_list", "Packing List (PL)"),
    ("certificate_of_origin", "Certificate of Origin (COO)"),
    ("insurance_policy", "Marine Insurance Policy"),
    ("shipping_bill_customs", "China Export Customs Declaration / Shipping Bill"),
    ("inspection_coc", "Inspection / Quality Certificate (COC / COA)"),
    ("msds_document", "MSDS / Technical Datasheet"),
    ("forwarder_freight_bill", "Forwarder / Agent Freight Invoice"),
    ("final_landing_cost_sheet", "Final Landing Cost Sheet"),
]

CONSIGNMENT_CHECKLIST_ITEMS: list[tuple[str, str]] = [
    ("supplier_bills_collected", "Supplier Invoices / Fapiao Collected"),
    ("listed_with_forwarder", "Listed with Forwarder / Booking Confirmed"),
    ("container_stuffed", "Container Stuffing & Loading Completed"),
    ("customs_declaration_cleared", "China Export Customs Declaration Cleared"),
    ("draft_bl_received", "Draft Approved BL Received"),
    ("insurance_mail_sent", "Insurance Mail Sent"),
    ("insurance_certificate_received", "Insurance Certificate Received"),
    ("final_bl_received", "Final BL Received"),
    ("coo_received", "Certificate of Origin (COO) Received"),
    ("telex_done", "Telex Release Done"),
    ("rest_all_docs_checked", "All Export Docs (CI/PL/COO/BL) Checked"),
    ("all_docs_shared_to_agent", "All Docs Shared to Buyer / Clearing Agent"),
]


def _to_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return round(float(val), 2)
    except (TypeError, ValueError):
        return default


class FinanceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _ensure_tables(self) -> None:
        global _TABLES_VERIFIED
        if _TABLES_VERIFIED:
            return
        try:
            await self.session.execute(
                text("""
                    CREATE TABLE IF NOT EXISTS finance_record_meta (
                        id UUID PRIMARY KEY,
                        source_type VARCHAR(32) NOT NULL,
                        source_id UUID NOT NULL,
                        payment_terms VARCHAR(120),
                        expected_dispatch_date DATE,
                        due_date DATE,
                        delivery_status VARCHAR(80),
                        attachment_url VARCHAR(500),
                        remarks TEXT,
                        tt_received_date DATE,
                        expected_stuffing_date VARCHAR(100),
                        bl_details VARCHAR(150),
                        bl_status VARCHAR(80),
                        bill_status VARCHAR(80),
                        agent_name VARCHAR(150),
                        agent_local_charge NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                        agent_freight_charge NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                        agent_inv_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                        agent_payment_date DATE,
                        updated_by_id UUID,
                        updated_by_name VARCHAR(150),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT uq_finance_record_meta_source UNIQUE (source_type, source_id)
                    )
                """)
            )
            await self.session.execute(
                text("""
                    CREATE TABLE IF NOT EXISTS finance_payments (
                        id UUID PRIMARY KEY,
                        source_type VARCHAR(32) NOT NULL,
                        source_id UUID NOT NULL,
                        payment_date DATE NOT NULL,
                        amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                        currency VARCHAR(16) NOT NULL DEFAULT 'RMB',
                        payment_mode VARCHAR(100),
                        bank_charges NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                        reference_no VARCHAR(150),
                        attachment_url VARCHAR(500),
                        remarks TEXT,
                        created_by_id UUID,
                        created_by_name VARCHAR(150),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        deleted_at TIMESTAMPTZ
                    )
                """)
            )
            await self.session.commit()
            _TABLES_VERIFIED = True
        except Exception as exc:
            await self.session.rollback()
            logger.warning("finance._ensure_tables warning: %s", exc)

    async def _get_usd_to_rmb_rate(self) -> float:
        global _CACHED_USD_TO_RMB, _CACHED_RATE_TS
        now = time.monotonic()
        if _CACHED_RATE_TS > 0 and (now - _CACHED_RATE_TS) < 60.0:
            return _CACHED_USD_TO_RMB
        try:
            rates = await get_active_rates()
            rate = float(rates.get("RMB") or rates.get("CNY") or 7.20)
            _CACHED_USD_TO_RMB = rate if rate > 0 else 7.20
            _CACHED_RATE_TS = now
            return _CACHED_USD_TO_RMB
        except Exception:
            return _CACHED_USD_TO_RMB

    async def get_report(
        self,
        *,
        stage: str = "all",
        search: str | None = None,
        party_name: str | None = None,
        consignment_code: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> FinanceReportResponse:
        usd_to_rmb = await self._get_usd_to_rmb_rate()

        # 1. Fetch all Confirmed/Inwarded Local Purchases (excluding Pending / Cancelled) in a single joined query
        lp_stmt = (
            select(LocalPurchase)
            .options(joinedload(LocalPurchase.items))
            .where(
                LocalPurchase.deleted_at.is_(None),
                func.lower(func.trim(LocalPurchase.status)).notin_(EXCLUDED_STATUSES),
            )
            .order_by(LocalPurchase.invoice_date.desc(), LocalPurchase.created_at.desc())
        )
        lp_res = await self.session.execute(lp_stmt)
        lp_models = list(lp_res.unique().scalars().all())

        # 2. Fetch all Confirmed/Dispatched/LR Sale Orders (excluding Pending / Cancelled) in a single joined query
        so_stmt = (
            select(SaleOrder)
            .options(joinedload(SaleOrder.items))
            .where(
                SaleOrder.deleted_at.is_(None),
                func.lower(func.trim(SaleOrder.status)).notin_(EXCLUDED_STATUSES),
            )
            .order_by(SaleOrder.order_date.desc(), SaleOrder.created_at.desc())
        )
        so_res = await self.session.execute(so_stmt)
        so_models = list(so_res.unique().scalars().all())

        # Collect source IDs to batch-load FinanceRecordMeta, FinancePayment, and PlanningColumn
        all_source_ids: list[uuid.UUID] = [m.id for m in lp_models] + [m.id for m in so_models]
        planning_col_ids: list[uuid.UUID] = [
            m.planning_column_id for m in so_models if m.planning_column_id is not None
        ]

        meta_map: dict[tuple[str, uuid.UUID], FinanceRecordMeta] = {}
        payments_map: dict[tuple[str, uuid.UUID], list[FinancePayment]] = {}
        planning_desc_map: dict[uuid.UUID, str] = {}

        if all_source_ids:
            meta_stmt = select(FinanceRecordMeta).where(
                FinanceRecordMeta.source_id.in_(all_source_ids)
            )
            meta_rows = (await self.session.execute(meta_stmt)).scalars().all()
            for meta in meta_rows:
                meta_map[(meta.source_type, meta.source_id)] = meta

            pay_stmt = (
                select(FinancePayment)
                .where(
                    FinancePayment.source_id.in_(all_source_ids),
                    FinancePayment.deleted_at.is_(None),
                )
                .order_by(FinancePayment.payment_date.desc(), FinancePayment.created_at.desc())
            )
            pay_rows = (await self.session.execute(pay_stmt)).scalars().all()
            for pay in pay_rows:
                payments_map.setdefault((pay.source_type, pay.source_id), []).append(pay)

        if planning_col_ids:
            pc_stmt = select(PlanningColumn.id, PlanningColumn.description).where(
                PlanningColumn.id.in_(planning_col_ids)
            )
            for col_id, col_desc in (await self.session.execute(pc_stmt)).all():
                if col_desc:
                    planning_desc_map[col_id] = str(col_desc).strip()

        # Build LocalPurchaseFinanceRow items + KPI totals (KPI computed before stage tab filter so tab badges stay accurate)
        lp_all_rows: list[LocalPurchaseFinanceRow] = []
        for lp in lp_models:
            meta = meta_map.get(("local_purchase", lp.id))
            pays = payments_map.get(("local_purchase", lp.id), [])

            active_items = [it for it in (lp.items or []) if getattr(it, "deleted_at", None) is None]
            item_names = [it.product_name for it in active_items if it.product_name]
            items_list: list[str] = []
            for it in active_items:
                if not it.product_name:
                    continue
                q_val = _to_float(it.quantity)
                q_str = f"{int(q_val)}" if q_val == int(q_val) else f"{q_val:g}"
                items_list.append(f"{it.product_name} — Qty: {q_str}" if q_val > 0 else it.product_name)
            items_summary = ", ".join(item_names[:3])
            if len(item_names) > 3:
                items_summary += f" (+{len(item_names) - 3} more)"

            inv_val = _to_float(lp.invoice_total_value)
            exp_val = _to_float(lp.total_expenses)
            landing_val = _to_float(lp.items_total_landing)
            # Supplier bill total is invoice_total_value (or items_total_landing if invoice_total_value is 0)
            total_amt = inv_val if inv_val > 0 else landing_val

            paid_amt = round(sum(_to_float(p.amount) for p in pays), 2)
            bank_chg = round(sum(_to_float(p.bank_charges) for p in pays), 2)
            balance_amt = max(0.0, round(total_amt - paid_amt, 2))
            row_stage = "cleared" if (total_amt > 0 and balance_amt <= 0.01) or (total_amt == 0 and paid_amt > 0) else "pending"

            last_pay_date = max((p.payment_date for p in pays), default=None)

            row = LocalPurchaseFinanceRow(
                source_id=lp.id,
                source_type="local_purchase",
                invoice_no=lp.invoice_no or "—",
                invoice_date=lp.invoice_date,
                consignment_code=lp.consignment_code,
                supplier_id=lp.supplier_id,
                supplier_name=lp.supplier_name or "—",
                organization_name=lp.organization_name,
                branch_name=lp.branch_name,
                source_status=lp.status or "Confirmed",
                currency=lp.currency or "RMB",
                items_summary=items_summary,
                items_list=items_list,
                items_count=len(active_items),
                total_quantity=_to_float(lp.total_quantity),
                invoice_total_value=inv_val,
                total_expenses=exp_val,
                total_amount=total_amt,
                paid_amount=paid_amt,
                balance_amount=balance_amt,
                total_bank_charges=bank_chg,
                usd_exchange_rate=usd_to_rmb,
                total_amount_usd=round(total_amt / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
                paid_amount_usd=round(paid_amt / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
                balance_amount_usd=round(balance_amt / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
                stage=row_stage,
                payment_terms=meta.payment_terms if meta else None,
                expected_dispatch_date=meta.expected_dispatch_date if meta else None,
                due_date=meta.due_date if meta else None,
                last_payment_date=last_pay_date,
                delivery_status=(meta.delivery_status if meta and meta.delivery_status else lp.status),
                attachment_url=(meta.attachment_url if meta and meta.attachment_url else lp.bill_file_url),
                remarks=(meta.remarks if meta and meta.remarks else lp.remarks),
                payments_count=len(pays),
                payments=[self._to_payment_schema(p) for p in pays],
            )
            if self._matches_common_filters(
                row_date=row.invoice_date,
                party=row.supplier_name,
                doc_no=row.invoice_no,
                consignment=row.consignment_code,
                items_summary=row.items_summary,
                remarks=row.remarks,
                search=search,
                party_name=party_name,
                consignment_code=consignment_code,
                date_from=date_from,
                date_to=date_to,
            ):
                lp_all_rows.append(row)

        # Build SaleOrderFinanceRow items
        so_all_rows: list[SaleOrderFinanceRow] = []
        for so in so_models:
            meta = meta_map.get(("sale_order", so.id))
            pays = payments_map.get(("sale_order", so.id), [])

            active_items = [it for it in (so.items or []) if getattr(it, "deleted_at", None) is None]
            item_names = [it.product_name for it in active_items if it.product_name]
            items_list: list[str] = []
            for it in active_items:
                if not it.product_name:
                    continue
                q_val = _to_float(it.quantity)
                q_str = f"{int(q_val)}" if q_val == int(q_val) else f"{q_val:g}"
                items_list.append(f"{it.product_name} — Qty: {q_str}" if q_val > 0 else it.product_name)
            items_summary = ", ".join(item_names[:3])
            if len(item_names) > 3:
                items_summary += f" (+{len(item_names) - 3} more)"

            total_amt = _to_float(so.total_amount)
            paid_amt = round(sum(_to_float(p.amount) for p in pays), 2)
            bank_chg = round(sum(_to_float(p.bank_charges) for p in pays), 2)
            balance_amt = max(0.0, round(total_amt - paid_amt, 2))
            row_stage = "cleared" if (total_amt > 0 and balance_amt <= 0.01) or (total_amt == 0 and paid_amt > 0) else "pending"

            last_pay_date = max((p.payment_date for p in pays), default=None)
            stuffing_from_planning = (
                planning_desc_map.get(so.planning_column_id) if so.planning_column_id else None
            )
            expected_stuffing = (
                meta.expected_stuffing_date
                if (meta and meta.expected_stuffing_date)
                else stuffing_from_planning
            )

            agent_local = _to_float(meta.agent_local_charge) if meta else 0.0
            agent_freight = _to_float(meta.agent_freight_charge) if meta else 0.0
            agent_inv = _to_float(meta.agent_inv_amount) if meta else 0.0
            if agent_inv <= 0 and (agent_local > 0 or agent_freight > 0):
                agent_inv = round(agent_local + agent_freight, 2)

            so_rate = _to_float(so.usd_exchange_rate, default=usd_to_rmb)
            if so_rate <= 0:
                so_rate = usd_to_rmb

            row = SaleOrderFinanceRow(
                source_id=so.id,
                source_type="sale_order",
                order_no=so.order_no or "—",
                order_date=so.order_date,
                consignment_code=so.consignment_code,
                buyer_id=so.buyer_id,
                buyer_name=so.buyer_name or "—",
                buyer_branch_name=so.buyer_branch_name,
                organization_name=so.organization_name,
                source_status=so.status or "confirmed",
                currency=so.currency or "USD",
                items_summary=items_summary,
                items_list=items_list,
                items_count=len(active_items),
                total_quantity=_to_float(so.total_quantity),
                expected_stuffing_date=expected_stuffing,
                etd_origin_date=so.etd_origin_date,
                eta_port_date=so.eta_port_date,
                container_no=so.container_no,
                ocean_freight_usd=_to_float(so.ocean_freight_usd),
                local_charges_coc_usd=_to_float(so.local_charges_coc_usd),
                total_amount=total_amt,
                paid_amount=paid_amt,
                balance_amount=balance_amt,
                total_bank_charges=bank_chg,
                usd_exchange_rate=so_rate,
                stage=row_stage,
                payment_terms=meta.payment_terms if meta else None,
                tt_received_date=meta.tt_received_date if meta else None,
                due_date=meta.due_date if meta else None,
                last_payment_date=last_pay_date,
                attachment_url=meta.attachment_url if meta else None,
                remarks=(meta.remarks if meta and meta.remarks else so.remarks),
                bl_details=(meta.bl_details if meta and meta.bl_details else so.bl_no),
                bl_status=meta.bl_status if meta else None,
                bill_status=meta.bill_status if meta else ("Paid" if (meta and meta.agent_payment_date) else "Pending"),
                agent_name=(meta.agent_name if meta and meta.agent_name else so.transporter_name),
                agent_local_charge=agent_local,
                agent_freight_charge=agent_freight,
                agent_inv_amount=agent_inv,
                agent_payment_date=meta.agent_payment_date if meta else None,
                payments_count=len(pays),
                payments=[self._to_payment_schema(p) for p in pays],
            )
            if self._matches_common_filters(
                row_date=row.order_date,
                party=row.buyer_name,
                doc_no=row.order_no,
                consignment=row.consignment_code,
                items_summary=row.items_summary,
                remarks=row.remarks,
                search=search,
                party_name=party_name,
                consignment_code=consignment_code,
                date_from=date_from,
                date_to=date_to,
            ):
                so_all_rows.append(row)

        # Compute KPI summaries across filtered rows (before stage filter so Pending/Cleared counts are always shown)
        lp_total_rmb = round(sum(r.total_amount for r in lp_all_rows), 2)
        lp_paid_rmb = round(sum(r.paid_amount for r in lp_all_rows), 2)
        lp_bal_rmb = round(sum(r.balance_amount for r in lp_all_rows), 2)
        lp_kpi = SectionKpiSummary(
            total_records=len(lp_all_rows),
            pending_records=sum(1 for r in lp_all_rows if r.stage == "pending"),
            cleared_records=sum(1 for r in lp_all_rows if r.stage == "cleared"),
            currency="RMB",
            total_amount=lp_total_rmb,
            paid_amount=lp_paid_rmb,
            balance_amount=lp_bal_rmb,
            secondary_currency="USD",
            total_amount_secondary=round(lp_total_rmb / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
            paid_amount_secondary=round(lp_paid_rmb / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
            balance_amount_secondary=round(lp_bal_rmb / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
        )

        so_total_usd = round(sum(r.total_amount for r in so_all_rows), 2)
        so_paid_usd = round(sum(r.paid_amount for r in so_all_rows), 2)
        so_bal_usd = round(sum(r.balance_amount for r in so_all_rows), 2)
        so_kpi = SectionKpiSummary(
            total_records=len(so_all_rows),
            pending_records=sum(1 for r in so_all_rows if r.stage == "pending"),
            cleared_records=sum(1 for r in so_all_rows if r.stage == "cleared"),
            currency="USD",
            total_amount=so_total_usd,
            paid_amount=so_paid_usd,
            balance_amount=so_bal_usd,
            secondary_currency="RMB",
            total_amount_secondary=round(so_total_usd * usd_to_rmb, 2),
            paid_amount_secondary=round(so_paid_usd * usd_to_rmb, 2),
            balance_amount_secondary=round(so_bal_usd * usd_to_rmb, 2),
        )

        agent_total_rmb = round(sum(r.agent_inv_amount for r in so_all_rows), 2)
        agent_paid_rmb = round(
            sum(
                r.agent_inv_amount
                for r in so_all_rows
                if (r.bill_status or "").strip().lower() == "paid"
            ),
            2,
        )
        agent_bal_rmb = max(0.0, round(agent_total_rmb - agent_paid_rmb, 2))
        agent_kpi = SectionKpiSummary(
            total_records=sum(1 for r in so_all_rows if r.agent_inv_amount > 0 or r.agent_name),
            pending_records=sum(
                1
                for r in so_all_rows
                if r.agent_inv_amount > 0 and (r.bill_status or "").strip().lower() != "paid"
            ),
            cleared_records=sum(
                1
                for r in so_all_rows
                if r.agent_inv_amount > 0 and (r.bill_status or "").strip().lower() == "paid"
            ),
            currency="RMB",
            total_amount=agent_total_rmb,
            paid_amount=agent_paid_rmb,
            balance_amount=agent_bal_rmb,
            secondary_currency="USD",
            total_amount_secondary=round(agent_total_rmb / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
            paid_amount_secondary=round(agent_paid_rmb / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
            balance_amount_secondary=round(agent_bal_rmb / usd_to_rmb, 2) if usd_to_rmb > 0 else 0.0,
        )

        # Apply stage filter if requested
        norm_stage = (stage or "all").strip().lower()
        if norm_stage in ("pending", "cleared"):
            lp_filtered = [r for r in lp_all_rows if r.stage == norm_stage]
            so_filtered = [r for r in so_all_rows if r.stage == norm_stage]
        else:
            lp_filtered = lp_all_rows
            so_filtered = so_all_rows

        return FinanceReportResponse(
            usd_to_rmb_rate=usd_to_rmb,
            local_purchase_kpi=lp_kpi,
            sale_order_kpi=so_kpi,
            agent_freight_kpi=agent_kpi,
            local_purchases=lp_filtered,
            sale_orders=so_filtered,
        )

    @staticmethod
    def _matches_common_filters(
        *,
        row_date: date | None,
        party: str | None,
        doc_no: str | None,
        consignment: str | None,
        items_summary: str | None,
        remarks: str | None,
        search: str | None,
        party_name: str | None,
        consignment_code: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> bool:
        if date_from and row_date and row_date < date_from:
            return False
        if date_to and row_date and row_date > date_to:
            return False
        if party_name and party_name.strip():
            if party_name.strip().lower() not in (party or "").lower():
                return False
        if consignment_code and consignment_code.strip():
            if consignment_code.strip().lower() not in (consignment or "").lower():
                return False
        if search and search.strip():
            q = search.strip().lower()
            haystack = " ".join(
                filter(None, [party, doc_no, consignment, items_summary, remarks])
            ).lower()
            if q not in haystack:
                return False
        return True

    @staticmethod
    def _to_payment_schema(p: FinancePayment) -> FinancePaymentResponse:
        return FinancePaymentResponse(
            id=p.id,
            source_type=p.source_type,
            source_id=p.source_id,
            payment_date=p.payment_date,
            amount=_to_float(p.amount),
            currency=p.currency or "RMB",
            payment_mode=p.payment_mode,
            bank_charges=_to_float(p.bank_charges),
            reference_no=p.reference_no,
            attachment_url=p.attachment_url,
            remarks=p.remarks,
            created_by_id=p.created_by_id,
            created_by_name=p.created_by_name,
            created_at=p.created_at,
        )

    async def _verify_source_exists(self, source_type: str, source_id: uuid.UUID) -> str:
        """Verify source record exists and return its default currency."""
        await self._ensure_tables()
        if source_type == "local_purchase":
            res = await self.session.execute(
                select(LocalPurchase).where(
                    LocalPurchase.id == source_id, LocalPurchase.deleted_at.is_(None)
                )
            )
            lp = res.scalar_one_or_none()
            if not lp:
                raise NotFoundException("Local Purchase record not found.")
            return lp.currency or "RMB"
        elif source_type == "sale_order":
            res = await self.session.execute(
                select(SaleOrder).where(
                    SaleOrder.id == source_id, SaleOrder.deleted_at.is_(None)
                )
            )
            so = res.scalar_one_or_none()
            if not so:
                raise NotFoundException("Sale Process order not found.")
            return so.currency or "USD"
        else:
            raise ValidationException(f"Unsupported source_type: {source_type}")

    async def add_payment(
        self,
        *,
        source_type: str,
        source_id: uuid.UUID,
        payload: FinancePaymentCreate,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> FinancePaymentResponse:
        if source_type not in ("local_purchase", "sale_order"):
            raise ValidationException(f"Unsupported source_type: {source_type}")
        default_currency = "RMB" if source_type == "local_purchase" else "USD"
        now_utc = datetime.now(timezone.utc)
        payment = FinancePayment(
            id=uuid.uuid4(),
            source_type=source_type,
            source_id=source_id,
            payment_date=payload.payment_date,
            amount=Decimal(str(round(payload.amount, 2))),
            currency=(payload.currency or default_currency).upper(),
            payment_mode=payload.payment_mode,
            bank_charges=Decimal(str(round(payload.bank_charges or 0.0, 2))),
            reference_no=payload.reference_no,
            attachment_url=payload.attachment_url,
            remarks=payload.remarks,
            created_by_id=user_id,
            created_by_name=user_name,
            created_at=now_utc,
            updated_at=now_utc,
        )
        self.session.add(payment)

        # If next_due_date or payment_terms was provided while adding payment, upsert meta
        if payload.next_due_date is not None or payload.payment_terms is not None:
            meta = await self._get_or_create_meta(source_type, source_id)
            if payload.next_due_date is not None:
                meta.due_date = payload.next_due_date
            if payload.payment_terms is not None:
                meta.payment_terms = payload.payment_terms
            meta.updated_by_id = user_id
            meta.updated_by_name = user_name

        await self.session.commit()
        return self._to_payment_schema(payment)

    async def list_payments(
        self, *, source_type: str, source_id: uuid.UUID
    ) -> list[FinancePaymentResponse]:
        stmt = (
            select(FinancePayment)
            .where(
                FinancePayment.source_type == source_type,
                FinancePayment.source_id == source_id,
                FinancePayment.deleted_at.is_(None),
            )
            .order_by(FinancePayment.payment_date.desc(), FinancePayment.created_at.desc())
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return [self._to_payment_schema(p) for p in rows]

    async def delete_payment(self, *, payment_id: uuid.UUID) -> None:
        stmt = select(FinancePayment).where(
            FinancePayment.id == payment_id, FinancePayment.deleted_at.is_(None)
        )
        payment = (await self.session.execute(stmt)).scalar_one_or_none()
        if not payment:
            raise NotFoundException("Payment record not found.")
        payment.deleted_at = datetime.now(timezone.utc)
        await self.session.commit()

    async def _get_or_create_meta(
        self, source_type: str, source_id: uuid.UUID
    ) -> FinanceRecordMeta:
        stmt = select(FinanceRecordMeta).where(
            FinanceRecordMeta.source_type == source_type,
            FinanceRecordMeta.source_id == source_id,
        )
        meta = (await self.session.execute(stmt)).scalar_one_or_none()
        if not meta:
            meta = FinanceRecordMeta(
                id=uuid.uuid4(),
                source_type=source_type,
                source_id=source_id,
                agent_local_charge=Decimal("0.00"),
                agent_freight_charge=Decimal("0.00"),
                agent_inv_amount=Decimal("0.00"),
            )
            self.session.add(meta)
        return meta

    async def update_meta(
        self,
        *,
        source_type: str,
        source_id: uuid.UUID,
        payload: FinanceMetaUpdate,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        if source_type not in ("local_purchase", "sale_order"):
            raise ValidationException(f"Unsupported source_type: {source_type}")
        meta = await self._get_or_create_meta(source_type, source_id)

        fields = payload.model_dump(exclude_unset=True)
        for key, value in fields.items():
            if key in ("agent_local_charge", "agent_freight_charge", "agent_inv_amount"):
                setattr(meta, key, Decimal(str(round(float(value or 0.0), 2))))
            else:
                setattr(meta, key, value)

        # Auto-compute agent_inv_amount when local/freight charge updated and inv_amount not explicitly set
        if (
            ("agent_local_charge" in fields or "agent_freight_charge" in fields)
            and "agent_inv_amount" not in fields
        ):
            meta.agent_inv_amount = (
                (meta.agent_local_charge or Decimal("0.00"))
                + (meta.agent_freight_charge or Decimal("0.00"))
            )

        meta.updated_by_id = user_id
        meta.updated_by_name = user_name
        await self.session.commit()
        return {
            "id": str(meta.id),
            "source_type": meta.source_type,
            "source_id": str(meta.source_id),
            "payment_terms": meta.payment_terms,
            "expected_dispatch_date": meta.expected_dispatch_date,
            "due_date": meta.due_date,
            "delivery_status": meta.delivery_status,
            "attachment_url": meta.attachment_url,
            "remarks": meta.remarks,
            "tt_received_date": meta.tt_received_date,
            "expected_stuffing_date": meta.expected_stuffing_date,
            "bl_details": meta.bl_details,
            "bl_status": meta.bl_status,
            "bill_status": meta.bill_status,
            "agent_name": meta.agent_name,
            "agent_local_charge": _to_float(meta.agent_local_charge),
            "agent_freight_charge": _to_float(meta.agent_freight_charge),
            "agent_inv_amount": _to_float(meta.agent_inv_amount),
            "agent_payment_date": meta.agent_payment_date,
        }

    async def export_excel(
        self,
        *,
        stage: str = "all",
        search: str | None = None,
        party_name: str | None = None,
        consignment_code: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> bytes:
        report = await self.get_report(
            stage=stage,
            search=search,
            party_name=party_name,
            consignment_code=consignment_code,
            date_from=date_from,
            date_to=date_to,
        )

        wb = Workbook()
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF", size=10)
        sub_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
        bold_font = Font(bold=True, size=10)
        green_font = Font(bold=True, color="15803D", size=10)
        red_font = Font(bold=True, color="B91C1C", size=10)
        thin_border = Border(
            left=Side(style="thin", color="CBD5E1"),
            right=Side(style="thin", color="CBD5E1"),
            top=Side(style="thin", color="CBD5E1"),
            bottom=Side(style="thin", color="CBD5E1"),
        )

        # ------------------------------------------------------------------
        # Sheet 1: Financial Summary
        # ------------------------------------------------------------------
        ws_sum: Any = wb.active or wb.create_sheet(title="Financial Summary")
        ws_sum.title = "Financial Summary"
        ws_sum.append(["YINGLIMA ERP — FINANCIAL PLANNER & PAYMENT REPORT"])
        ws_sum["A1"].font = Font(bold=True, size=13, color="0F172A")
        ws_sum.append([f"Generated Date: {date.today().isoformat()}", f"USD/RMB Rate: {report.usd_to_rmb_rate:.4f}"])
        ws_sum.append([])

        sum_headers = [
            "Section",
            "Primary Currency",
            "Total Records",
            "Pending Records",
            "Cleared Records",
            "Total Amount",
            "Paid / Received Amount",
            "Pending Balance",
            "Secondary Currency",
            "Balance (Secondary Eqv.)",
        ]
        ws_sum.append(sum_headers)
        for col_idx in range(1, len(sum_headers) + 1):
            c = ws_sum.cell(row=4, column=col_idx)
            c.fill = header_fill
            c.font = header_font
            c.alignment = Alignment(horizontal="center", vertical="center")

        kpi_rows = [
            ("Local Purchase (Supplier Payables)", report.local_purchase_kpi),
            ("Sales Process (Customer Export Receivables)", report.sale_order_kpi),
            ("Forwarder / Agent Freight Bills", report.agent_freight_kpi),
        ]
        for label, kpi in kpi_rows:
            ws_sum.append([
                label,
                kpi.currency,
                kpi.total_records,
                kpi.pending_records,
                kpi.cleared_records,
                kpi.total_amount,
                kpi.paid_amount,
                kpi.balance_amount,
                kpi.secondary_currency,
                kpi.balance_amount_secondary,
            ])

        self._auto_fit_columns(ws_sum, thin_border)

        # ------------------------------------------------------------------
        # Sheet 2: Local Purchase (Suppliers) — Matches Manager's Excel Tab 2
        # ------------------------------------------------------------------
        ws_lp = wb.create_sheet(title="Local Purchase (Suppliers)")
        lp_headers = [
            "Supplier / Party Name",
            "Invoice No.",
            "Invoice Date",
            "Consignment No.",
            "Items Summary",
            "Total Qty",
            "Payment Terms",
            "Expected Dispatch",
            "Total Amount (RMB ¥)",
            "Paid Amount (RMB ¥)",
            "Balance Amount (RMB ¥)",
            "Balance (USD $ Eqv)",
            "Due Date",
            "Last Payment Date",
            "Delivery Status",
            "Stage",
            "Remarks",
        ]
        ws_lp.append(lp_headers)
        for col_idx in range(1, len(lp_headers) + 1):
            c = ws_lp.cell(row=1, column=col_idx)
            c.fill = header_fill
            c.font = header_font

        for r in report.local_purchases:
            ws_lp.append([
                r.supplier_name,
                r.invoice_no,
                r.invoice_date.isoformat() if r.invoice_date else "",
                r.consignment_code or "",
                r.items_summary,
                r.total_quantity,
                r.payment_terms or "",
                r.expected_dispatch_date.isoformat() if r.expected_dispatch_date else "",
                r.total_amount,
                r.paid_amount,
                r.balance_amount,
                r.balance_amount_usd,
                r.due_date.isoformat() if r.due_date else "",
                r.last_payment_date.isoformat() if r.last_payment_date else "",
                r.delivery_status or "",
                "Cleared" if r.stage == "cleared" else "Pending",
                r.remarks or "",
            ])
            row_idx = ws_lp.max_row
            ws_lp.cell(row=row_idx, column=10).font = green_font
            ws_lp.cell(row=row_idx, column=11).font = red_font if r.balance_amount > 0 else green_font

        # Totals row for Local Purchase
        ws_lp.append([
            "TOTAL",
            "",
            "",
            "",
            "",
            round(sum(x.total_quantity for x in report.local_purchases), 2),
            "",
            "",
            round(sum(x.total_amount for x in report.local_purchases), 2),
            round(sum(x.paid_amount for x in report.local_purchases), 2),
            round(sum(x.balance_amount for x in report.local_purchases), 2),
            round(sum(x.balance_amount_usd for x in report.local_purchases), 2),
            "",
            "",
            "",
            "",
            "",
        ])
        for col_idx in range(1, len(lp_headers) + 1):
            c = ws_lp.cell(row=ws_lp.max_row, column=col_idx)
            c.fill = sub_fill
            c.font = bold_font

        self._auto_fit_columns(ws_lp, thin_border)

        # ------------------------------------------------------------------
        # Sheet 3: Sales & Agent Schedule — Matches Manager's Excel Tabs 3 & 4
        # ------------------------------------------------------------------
        ws_so = wb.create_sheet(title="Sales & Agent Schedule")
        so_headers = [
            "Customer / Buyer",
            "Exp No. (Order No.)",
            "Consignment Remarks",
            "Expected Stuffing Date",
            "Expected Vessel Date (ETD)",
            "ETA Destination Port",
            "TT Received Date",
            "Payment Terms",
            "Total Amount (USD $)",
            "Received Payment (USD $)",
            "Pending Balance (USD $)",
            "Estimated Due Date",
            "Stage",
            "BL Details",
            "BL Status",
            "Bill Status",
            "Agent / Forwarder",
            "Local Charge (RMB ¥)",
            "Freight (RMB ¥)",
            "Agent Inv Amount (RMB ¥)",
            "Agent Payment Date",
            "Remarks",
        ]
        ws_so.append(so_headers)
        for col_idx in range(1, len(so_headers) + 1):
            c = ws_so.cell(row=1, column=col_idx)
            c.fill = header_fill
            c.font = header_font

        for r in report.sale_orders:
            ws_so.append([
                r.buyer_name,
                r.order_no,
                r.consignment_code or "",
                r.expected_stuffing_date or "",
                r.etd_origin_date.isoformat() if r.etd_origin_date else "",
                r.eta_port_date.isoformat() if r.eta_port_date else "",
                r.tt_received_date.isoformat() if r.tt_received_date else "",
                r.payment_terms or "",
                r.total_amount,
                r.paid_amount,
                r.balance_amount,
                r.due_date.isoformat() if r.due_date else "",
                "Cleared" if r.stage == "cleared" else "Pending",
                r.bl_details or "",
                r.bl_status or "",
                r.bill_status or "",
                r.agent_name or "",
                r.agent_local_charge,
                r.agent_freight_charge,
                r.agent_inv_amount,
                r.agent_payment_date.isoformat() if r.agent_payment_date else "",
                r.remarks or "",
            ])
            row_idx = ws_so.max_row
            ws_so.cell(row=row_idx, column=10).font = green_font
            ws_so.cell(row=row_idx, column=11).font = red_font if r.balance_amount > 0 else green_font

        ws_so.append([
            "TOTAL",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            round(sum(x.total_amount for x in report.sale_orders), 2),
            round(sum(x.paid_amount for x in report.sale_orders), 2),
            round(sum(x.balance_amount for x in report.sale_orders), 2),
            "",
            "",
            "",
            "",
            "",
            "",
            round(sum(x.agent_local_charge for x in report.sale_orders), 2),
            round(sum(x.agent_freight_charge for x in report.sale_orders), 2),
            round(sum(x.agent_inv_amount for x in report.sale_orders), 2),
            "",
            "",
        ])
        for col_idx in range(1, len(so_headers) + 1):
            c = ws_so.cell(row=ws_so.max_row, column=col_idx)
            c.fill = sub_fill
            c.font = bold_font

        self._auto_fit_columns(ws_so, thin_border)

        # ------------------------------------------------------------------
        # Sheet 4: Payment Transactions Ledger
        # ------------------------------------------------------------------
        ws_tx = wb.create_sheet(title="Payment Transactions")
        tx_headers = [
            "Payment Date",
            "Section",
            "Party Name",
            "Invoice / Exp No.",
            "Consignment",
            "Payment Amount",
            "Currency",
            "Bank Charges",
            "Payment Mode / Bank A/C",
            "Reference / TT No.",
            "Recorded By",
            "Remarks",
        ]
        ws_tx.append(tx_headers)
        for col_idx in range(1, len(tx_headers) + 1):
            c = ws_tx.cell(row=1, column=col_idx)
            c.fill = header_fill
            c.font = header_font

        for r in report.local_purchases:
            for p in r.payments:
                ws_tx.append([
                    p.payment_date.isoformat() if p.payment_date else "",
                    "Local Purchase (Outward)",
                    r.supplier_name,
                    r.invoice_no,
                    r.consignment_code or "",
                    p.amount,
                    p.currency,
                    p.bank_charges,
                    p.payment_mode or "",
                    p.reference_no or "",
                    p.created_by_name or "",
                    p.remarks or "",
                ])
        for r in report.sale_orders:
            for p in r.payments:
                ws_tx.append([
                    p.payment_date.isoformat() if p.payment_date else "",
                    "Sales Process (Inward)",
                    r.buyer_name,
                    r.order_no,
                    r.consignment_code or "",
                    p.amount,
                    p.currency,
                    p.bank_charges,
                    p.payment_mode or "",
                    p.reference_no or "",
                    p.created_by_name or "",
                    p.remarks or "",
                ])

        self._auto_fit_columns(ws_tx, thin_border)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    @staticmethod
    def _auto_fit_columns(ws: Any, border: Border) -> None:
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                if cell.row > 1 or ws.title != "Financial Summary":
                    cell.border = border
                val_str = str(cell.value or "")
                if len(val_str) > max_len:
                    max_len = len(val_str)
            ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 42)

    # ==========================================================================
    # Consignment Overview (Unified Finance Planning + Gallery + Cargo Status)
    # ==========================================================================

    async def _ensure_consignment_table(self) -> None:
        global _CONSIGNMENT_TABLE_VERIFIED
        if _CONSIGNMENT_TABLE_VERIFIED:
            return
        try:
            await self.session.execute(
                text("""
                    CREATE TABLE IF NOT EXISTS consignment_overviews (
                        id UUID PRIMARY KEY,
                        consignment_key VARCHAR(120) NOT NULL UNIQUE,
                        documents_json TEXT DEFAULT '{}',
                        checklist_json TEXT DEFAULT '{}',
                        cargo_remarks TEXT,
                        etd_origin_date DATE,
                        eta_port_date DATE,
                        forwarder_name VARCHAR(150),
                        updated_by_id UUID,
                        updated_by_name VARCHAR(150),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
            )
            await self.session.commit()
            _CONSIGNMENT_TABLE_VERIFIED = True
        except Exception as exc:
            await self.session.rollback()
            logger.warning("finance._ensure_consignment_table warning: %s", exc)

    @staticmethod
    def _normalize_consignment_key(
        consignment_code: str | None, fallback_prefix: str, fallback_id: str
    ) -> str:
        if consignment_code and consignment_code.strip():
            cleaned = re.sub(r"\s+", " ", consignment_code.strip()).upper()
            return cleaned
        return f"{fallback_prefix}:{fallback_id.strip().upper()}"

    async def _get_or_create_consignment_meta(
        self, consignment_key: str
    ) -> ConsignmentOverviewMeta:
        await self._ensure_consignment_table()
        norm_key = consignment_key.strip().upper()
        stmt = select(ConsignmentOverviewMeta).where(
            func.upper(ConsignmentOverviewMeta.consignment_key) == norm_key
        )
        meta = (await self.session.execute(stmt)).scalar_one_or_none()
        if not meta:
            meta = ConsignmentOverviewMeta(
                id=uuid.uuid4(),
                consignment_key=norm_key,
                documents_json="{}",
                checklist_json="{}",
            )
            self.session.add(meta)
        return meta

    async def list_consignment_overviews(
        self,
        *,
        stage: str = "all",
        search: str | None = None,
        branch_name: str | None = None,
    ) -> ConsignmentOverviewListResponse:
        await self._ensure_consignment_table()

        # Reuse get_report(stage="all") to get all confirmed/inwarded/dispatched financial rows
        report = await self.get_report(stage="all")

        # Also load raw LocalPurchase and SaleOrder models with items for Product Summary
        lp_stmt = (
            select(LocalPurchase)
            .options(joinedload(LocalPurchase.items))
            .where(
                LocalPurchase.deleted_at.is_(None),
                func.lower(func.trim(LocalPurchase.status)).notin_(EXCLUDED_STATUSES),
            )
        )
        lp_models_by_id: dict[uuid.UUID, LocalPurchase] = {
            m.id: m
            for m in (await self.session.execute(lp_stmt)).unique().scalars().all()
        }

        so_stmt = (
            select(SaleOrder)
            .options(joinedload(SaleOrder.items))
            .where(
                SaleOrder.deleted_at.is_(None),
                func.lower(func.trim(SaleOrder.status)).notin_(EXCLUDED_STATUSES),
            )
        )
        so_models_by_id: dict[uuid.UUID, SaleOrder] = {
            m.id: m
            for m in (await self.session.execute(so_stmt)).unique().scalars().all()
        }

        # Load all ConsignmentOverviewMeta rows in one query
        meta_rows = (
            await self.session.execute(select(ConsignmentOverviewMeta))
        ).scalars().all()
        cons_meta_map: dict[str, ConsignmentOverviewMeta] = {
            m.consignment_key.strip().upper(): m for m in meta_rows
        }

        # Group LocalPurchaseFinanceRow and SaleOrderFinanceRow by normalized consignment_key
        groups: dict[str, dict[str, Any]] = {}

        for lp_row in report.local_purchases:
            key = self._normalize_consignment_key(
                lp_row.consignment_code, "LP", lp_row.invoice_no or str(lp_row.source_id)
            )
            grp = groups.setdefault(
                key,
                {
                    "display_code": (lp_row.consignment_code or "").strip() or lp_row.invoice_no,
                    "lps": [],
                    "sos": [],
                },
            )
            grp["lps"].append(lp_row)

        for so_row in report.sale_orders:
            key = self._normalize_consignment_key(
                so_row.consignment_code, "SO", so_row.order_no or str(so_row.source_id)
            )
            grp = groups.setdefault(
                key,
                {
                    "display_code": (so_row.consignment_code or "").strip() or so_row.order_no,
                    "lps": [],
                    "sos": [],
                },
            )
            grp["sos"].append(so_row)

        all_items: list[ConsignmentOverviewRow] = []

        for key, grp in groups.items():
            lps: list[LocalPurchaseFinanceRow] = grp["lps"]
            sos: list[SaleOrderFinanceRow] = grp["sos"]
            cons_meta = cons_meta_map.get(key)

            # Parse stored JSON dicts safely
            stored_docs: dict[str, dict[str, Any]] = {}
            stored_checks: dict[str, bool] = {}
            if cons_meta and cons_meta.documents_json:
                try:
                    parsed = json.loads(cons_meta.documents_json)
                    if isinstance(parsed, dict):
                        stored_docs = parsed
                except Exception:
                    stored_docs = {}
            if cons_meta and cons_meta.checklist_json:
                try:
                    parsed_c = json.loads(cons_meta.checklist_json)
                    if isinstance(parsed_c, dict):
                        stored_checks = {str(k): bool(v) for k, v in parsed_c.items()}
                except Exception:
                    stored_checks = {}

            # 1. Build Finance Planning lines (Supplier, Customer, Cargo Forwarder)
            finance_rows: list[ConsignmentFinanceLine] = []
            for lp in lps:
                finance_rows.append(
                    ConsignmentFinanceLine(
                        id=f"lp-{lp.source_id}",
                        role="Supplier",
                        party_name=lp.supplier_name,
                        doc_no=lp.invoice_no,
                        payment_terms=lp.payment_terms,
                        attachment_url=lp.attachment_url,
                        currency=lp.currency or "RMB",
                        total_amount=lp.total_amount,
                        paid_amount=lp.paid_amount,
                        balance_amount=lp.balance_amount,
                        due_date=lp.due_date,
                        stage=lp.stage,
                        source_type="local_purchase",
                        source_id=str(lp.source_id),
                    )
                )

            for so in sos:
                finance_rows.append(
                    ConsignmentFinanceLine(
                        id=f"so-{so.source_id}",
                        role="Customer",
                        party_name=so.buyer_name,
                        doc_no=so.order_no,
                        payment_terms=so.payment_terms,
                        attachment_url=so.attachment_url,
                        currency=so.currency or "USD",
                        total_amount=so.total_amount,
                        paid_amount=so.paid_amount,
                        balance_amount=so.balance_amount,
                        due_date=so.due_date,
                        stage=so.stage,
                        source_type="sale_order",
                        source_id=str(so.source_id),
                    )
                )
                if so.agent_inv_amount > 0 or (so.agent_name and so.agent_name.strip()):
                    agent_paid = (
                        so.agent_inv_amount
                        if (so.bill_status or "").strip().lower() == "paid"
                        else 0.0
                    )
                    agent_bal = max(0.0, round(so.agent_inv_amount - agent_paid, 2))
                    agent_stage = (
                        "cleared"
                        if (so.bill_status or "").strip().lower() == "paid"
                        or (so.agent_inv_amount == 0 and so.agent_payment_date is not None)
                        else "pending"
                    )
                    finance_rows.append(
                        ConsignmentFinanceLine(
                            id=f"agent-{so.source_id}",
                            role="Cargo Forwarder",
                            party_name=so.agent_name or "Cargo Forwarder",
                            doc_no=so.bl_details or so.order_no,
                            payment_terms=f"BL: {so.bl_status}" if so.bl_status else "Ocean Freight & Local Charges",
                            attachment_url=None,
                            currency="RMB",
                            total_amount=so.agent_inv_amount,
                            paid_amount=agent_paid,
                            balance_amount=agent_bal,
                            due_date=so.agent_payment_date,
                            stage=agent_stage,
                            source_type="sale_order",
                            source_id=str(so.source_id),
                        )
                    )

            # 2. Build Consignment Gallery document slots (with auto-linking from LocalPurchase / SaleOrder / Payments)
            first_lp_bill = next((x.attachment_url for x in lps if x.attachment_url), None)
            first_so_doc = next((x.attachment_url for x in sos if x.attachment_url), None)
            first_pay_slip = None
            for x in lps + sos:
                for p in x.payments:
                    if p.attachment_url:
                        first_pay_slip = p.attachment_url
                        break
                if first_pay_slip:
                    break

            documents: list[ConsignmentDocumentSlot] = []
            for slot_key, slot_label in CONSIGNMENT_DOC_SLOTS:
                entry = stored_docs.get(slot_key)
                if entry and entry.get("url"):
                    documents.append(
                        ConsignmentDocumentSlot(
                            slot_key=slot_key,
                            label=slot_label,
                            file_url=entry.get("url"),
                            filename=entry.get("filename"),
                            uploaded_at=entry.get("uploaded_at"),
                            uploaded_by=entry.get("uploaded_by"),
                            is_auto_linked=False,
                        )
                    )
                elif slot_key == "supplier_vat_fapiao" and first_lp_bill:
                    documents.append(
                        ConsignmentDocumentSlot(
                            slot_key=slot_key,
                            label=slot_label,
                            file_url=first_lp_bill,
                            filename=first_lp_bill.split("/")[-1],
                            uploaded_at=None,
                            uploaded_by="Local Purchase",
                            is_auto_linked=True,
                        )
                    )
                elif slot_key == "commercial_invoice" and first_so_doc:
                    documents.append(
                        ConsignmentDocumentSlot(
                            slot_key=slot_key,
                            label=slot_label,
                            file_url=first_so_doc,
                            filename=first_so_doc.split("/")[-1],
                            uploaded_at=None,
                            uploaded_by="Sales Process",
                            is_auto_linked=True,
                        )
                    )
                elif slot_key == "swift_tt_advance" and first_pay_slip:
                    documents.append(
                        ConsignmentDocumentSlot(
                            slot_key=slot_key,
                            label=slot_label,
                            file_url=first_pay_slip,
                            filename=first_pay_slip.split("/")[-1],
                            uploaded_at=None,
                            uploaded_by="Finance Payment",
                            is_auto_linked=True,
                        )
                    )
                else:
                    documents.append(
                        ConsignmentDocumentSlot(
                            slot_key=slot_key,
                            label=slot_label,
                            file_url=None,
                            filename=None,
                            uploaded_at=None,
                            uploaded_by=None,
                            is_auto_linked=False,
                        )
                    )

            # 3. Build Cargo Status checklist items
            checklist: list[ConsignmentChecklistItem] = []
            for c_key, c_label in CONSIGNMENT_CHECKLIST_ITEMS:
                # Auto-true for supplier_bills_collected if all LPs have attachment_url and not explicitly set to False
                default_val = False
                if c_key not in stored_checks and c_key == "supplier_bills_collected" and first_lp_bill:
                    default_val = True
                checklist.append(
                    ConsignmentChecklistItem(
                        key=c_key,
                        label=c_label,
                        value=stored_checks.get(c_key, default_val),
                    )
                )

            # 4. Build Product Summary lines (from LocalPurchase items and SaleOrder items)
            products: list[ConsignmentProductLine] = []
            sr_counter = 1
            seen_product_keys: set[tuple[str, str, float]] = set()

            for so in sos:
                so_model = so_models_by_id.get(so.source_id)
                if not so_model:
                    continue
                for it in so_model.items or []:
                    if getattr(it, "deleted_at", None) is not None:
                        continue
                    qty = _to_float(it.quantity)
                    dedup_key = ((it.product_name or "").strip().lower(), (it.product_code or "").strip().lower(), qty)
                    seen_product_keys.add(dedup_key)
                    products.append(
                        ConsignmentProductLine(
                            sr_no=sr_counter,
                            product_name=it.product_name or "—",
                            product_code=it.product_code,
                            hsn_code=it.hsn_code,
                            quantity=qty,
                            uom="PCS",
                            consignment_code=so.consignment_code or grp["display_code"],
                            supplier_name=it.supplier_name,
                            source_doc_no=so.order_no,
                        )
                    )
                    sr_counter += 1

            for lp in lps:
                lp_model = lp_models_by_id.get(lp.source_id)
                if not lp_model:
                    continue
                for it in lp_model.items or []:
                    if getattr(it, "deleted_at", None) is not None:
                        continue
                    qty = _to_float(it.quantity)
                    dedup_key = ((it.product_name or "").strip().lower(), (it.product_code or "").strip().lower(), qty)
                    if dedup_key in seen_product_keys and len(sos) > 0:
                        continue
                    seen_product_keys.add(dedup_key)
                    products.append(
                        ConsignmentProductLine(
                            sr_no=sr_counter,
                            product_name=it.product_name or "—",
                            product_code=it.product_code,
                            hsn_code=it.hsn_code,
                            quantity=qty,
                            uom="PCS",
                            consignment_code=lp.consignment_code or grp["display_code"],
                            supplier_name=lp.supplier_name,
                            source_doc_no=lp.invoice_no,
                        )
                    )
                    sr_counter += 1

            # Header metadata aggregation
            primary_so = sos[0] if sos else None
            primary_lp = lps[0] if lps else None

            supplier_names = list(dict.fromkeys(x.supplier_name for x in lps if x.supplier_name))
            supplier_summary = ", ".join(supplier_names[:3]) if supplier_names else (primary_so.buyer_name if primary_so else "—")
            if len(supplier_names) > 3:
                supplier_summary += f" (+{len(supplier_names) - 3} more)"

            doc_nos = [x.order_no for x in sos if x.order_no] + [x.invoice_no for x in lps if x.invoice_no]
            invoice_or_order_summary = ", ".join(doc_nos[:3])
            if len(doc_nos) > 3:
                invoice_or_order_summary += f" (+{len(doc_nos) - 3})"

            order_date = (
                (primary_so.order_date if primary_so and primary_so.order_date else None)
                or (primary_lp.invoice_date if primary_lp else None)
            )
            etd_date = (
                (cons_meta.etd_origin_date if cons_meta and cons_meta.etd_origin_date else None)
                or (primary_so.etd_origin_date if primary_so else None)
                or (primary_lp.expected_dispatch_date if primary_lp else None)
            )
            eta_date = (
                (cons_meta.eta_port_date if cons_meta and cons_meta.eta_port_date else None)
                or (primary_so.eta_port_date if primary_so else None)
            )
            forwarder = (
                (cons_meta.forwarder_name if cons_meta and cons_meta.forwarder_name else None)
                or (primary_so.agent_name if primary_so else None)
            )
            branch = (
                (primary_so.buyer_branch_name if primary_so and primary_so.buyer_branch_name else None)
                or (primary_lp.branch_name if primary_lp else None)
            )
            org_name = (
                (primary_so.organization_name if primary_so and primary_so.organization_name else None)
                or (primary_lp.organization_name if primary_lp else None)
            )

            overall_stage: Any = (
                "cleared"
                if finance_rows and all(r.stage == "cleared" for r in finance_rows)
                else "pending"
            )

            row_item = ConsignmentOverviewRow(
                consignment_key=key,
                display_title=grp["display_code"],
                consignment_code=grp["display_code"],
                invoice_or_order_summary=invoice_or_order_summary or grp["display_code"],
                order_date=order_date,
                supplier_summary=supplier_summary,
                buyer_name=primary_so.buyer_name if primary_so else None,
                branch_name=branch,
                organization_name=org_name,
                etd_origin_date=etd_date,
                eta_port_date=eta_date,
                stuffing_date=primary_so.expected_stuffing_date if primary_so else None,
                container_no=primary_so.container_no if primary_so else None,
                bl_no=primary_so.bl_details if primary_so else None,
                forwarder_name=forwarder,
                cargo_remarks=cons_meta.cargo_remarks if cons_meta else None,
                overall_stage=overall_stage,
                docs_uploaded_count=sum(1 for d in documents if d.file_url),
                docs_total_count=len(CONSIGNMENT_DOC_SLOTS),
                checklist_yes_count=sum(1 for c in checklist if c.value),
                checklist_total_count=len(CONSIGNMENT_CHECKLIST_ITEMS),
                total_supplier_rmb=round(sum(x.total_amount for x in lps), 2),
                paid_supplier_rmb=round(sum(x.paid_amount for x in lps), 2),
                balance_supplier_rmb=round(sum(x.balance_amount for x in lps), 2),
                total_customer_usd=round(sum(x.total_amount for x in sos), 2),
                received_customer_usd=round(sum(x.paid_amount for x in sos), 2),
                balance_customer_usd=round(sum(x.balance_amount for x in sos), 2),
                total_forwarder_rmb=round(sum(x.agent_inv_amount for x in sos), 2),
                finance_rows=finance_rows,
                documents=documents,
                checklist=checklist,
                products=products,
            )

            # Filter by branch_name or search if requested
            if branch_name and branch_name.strip():
                if branch_name.strip().lower() not in (row_item.branch_name or "").lower():
                    continue
            if search and search.strip():
                q = search.strip().lower()
                hay = " ".join(
                    filter(
                        None,
                        [
                            row_item.display_title,
                            row_item.invoice_or_order_summary,
                            row_item.supplier_summary,
                            row_item.buyer_name,
                            row_item.branch_name,
                            row_item.forwarder_name,
                            row_item.cargo_remarks,
                        ],
                    )
                ).lower()
                if q not in hay:
                    continue

            all_items.append(row_item)

        # Sort by most recent order_date desc
        all_items.sort(
            key=lambda x: (x.order_date or date(1970, 1, 1), x.display_title),
            reverse=True,
        )

        total_count = len(all_items)
        pending_count = sum(1 for x in all_items if x.overall_stage == "pending")
        cleared_count = sum(1 for x in all_items if x.overall_stage == "cleared")

        norm_stage = (stage or "all").strip().lower()
        if norm_stage in ("pending", "cleared"):
            filtered_items = [x for x in all_items if x.overall_stage == norm_stage]
        else:
            filtered_items = all_items

        return ConsignmentOverviewListResponse(
            total_consignments=total_count,
            pending_consignments=pending_count,
            cleared_consignments=cleared_count,
            items=filtered_items,
        )

    async def get_consignment_overview(
        self, consignment_key: str
    ) -> ConsignmentOverviewRow:
        norm_key = consignment_key.strip().upper()
        res = await self.list_consignment_overviews(stage="all")
        for item in res.items:
            if item.consignment_key.strip().upper() == norm_key:
                return item
        raise NotFoundException(f"Consignment '{consignment_key}' not found.")

    async def update_consignment_checklist(
        self,
        *,
        consignment_key: str,
        payload: ConsignmentChecklistUpdatePayload,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        meta = await self._get_or_create_consignment_meta(consignment_key)

        existing: dict[str, bool] = {}
        if meta.checklist_json:
            try:
                existing = json.loads(meta.checklist_json)
            except Exception:
                existing = {}

        if payload.checklist is not None:
            for k, v in payload.checklist.items():
                existing[k] = v
            meta.checklist_json = json.dumps(existing)

        fields = payload.model_dump(exclude_unset=True)
        if "cargo_remarks" in fields:
            meta.cargo_remarks = payload.cargo_remarks
        if "etd_origin_date" in fields:
            meta.etd_origin_date = payload.etd_origin_date
        if "eta_port_date" in fields:
            meta.eta_port_date = payload.eta_port_date
        if "forwarder_name" in fields:
            meta.forwarder_name = payload.forwarder_name

        meta.updated_by_id = user_id
        meta.updated_by_name = user_name
        await self.session.commit()
        return {
            "consignment_key": meta.consignment_key,
            "checklist": existing,
            "cargo_remarks": meta.cargo_remarks,
            "etd_origin_date": meta.etd_origin_date.isoformat() if meta.etd_origin_date else None,
            "eta_port_date": meta.eta_port_date.isoformat() if meta.eta_port_date else None,
            "forwarder_name": meta.forwarder_name,
        }

    async def upload_consignment_document(
        self,
        *,
        consignment_key: str,
        slot_key: str,
        file_bytes: bytes,
        filename: str,
        content_type: str | None = None,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> ConsignmentDocumentSlot:
        valid_slots = dict(CONSIGNMENT_DOC_SLOTS)
        if slot_key not in valid_slots:
            raise ValidationException(f"Unsupported document slot: {slot_key}")

        await LocalPurchaseService(self.session).ensure_supabase_purchase_bills_bucket()
        safe_name = sanitize_filename(filename or f"{slot_key}.pdf")
        safe_key = re.sub(r"[^A-Za-z0-9_-]", "_", consignment_key.strip())
        storage_filename = f"cons_{safe_key}_{slot_key}_{safe_name}"

        public_url, _ = await save_uploaded_file(
            content=file_bytes,
            original_filename=storage_filename,
            bucket="purchase-bills",
            local_subfolder="consignment_docs",
            content_type=content_type or "application/octet-stream",
        )
        if not public_url:
            raise ValidationException("Failed to upload document.")

        meta = await self._get_or_create_consignment_meta(consignment_key)
        existing_docs: dict[str, dict[str, Any]] = {}
        if meta.documents_json:
            try:
                existing_docs = json.loads(meta.documents_json)
            except Exception:
                existing_docs = {}

        now_iso = datetime.now(timezone.utc).isoformat()
        existing_docs[slot_key] = {
            "url": public_url,
            "filename": filename,
            "uploaded_at": now_iso,
            "uploaded_by": user_name or "Admin",
        }
        meta.documents_json = json.dumps(existing_docs)
        meta.updated_by_id = user_id
        meta.updated_by_name = user_name
        await self.session.commit()

        return ConsignmentDocumentSlot(
            slot_key=slot_key,
            label=valid_slots[slot_key],
            file_url=public_url,
            filename=filename,
            uploaded_at=now_iso,
            uploaded_by=user_name or "Admin",
            is_auto_linked=False,
        )

    async def delete_consignment_document(
        self,
        *,
        consignment_key: str,
        slot_key: str,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        valid_slots = dict(CONSIGNMENT_DOC_SLOTS)
        if slot_key not in valid_slots:
            raise ValidationException(f"Unsupported document slot: {slot_key}")

        meta = await self._get_or_create_consignment_meta(consignment_key)
        existing_docs: dict[str, dict[str, Any]] = {}
        if meta.documents_json:
            try:
                existing_docs = json.loads(meta.documents_json)
            except Exception:
                existing_docs = {}

        existing_docs.pop(slot_key, None)
        meta.documents_json = json.dumps(existing_docs)
        meta.updated_by_id = user_id
        meta.updated_by_name = user_name
        await self.session.commit()
        return {"deleted": True, "slot_key": slot_key, "consignment_key": consignment_key}

    # ==========================================================================
    # VAT Return (China Export Tax Rebate / 出口退税) Engine
    # ==========================================================================

    async def _ensure_vat_return_tables(self) -> None:
        global _CONSIGNMENT_TABLE_VERIFIED
        try:
            await self.session.execute(
                text("""
                    CREATE TABLE IF NOT EXISTS vat_return_records (
                        id UUID PRIMARY KEY,
                        source_type VARCHAR(32) NOT NULL DEFAULT 'sale_order',
                        source_id UUID NOT NULL,
                        exp_no VARCHAR(120) NOT NULL UNIQUE,
                        invoice_date DATE,
                        financial_year VARCHAR(32),
                        consignment_code VARCHAR(120),
                        buyer_name VARCHAR(200),
                        organization_name VARCHAR(150),
                        first_filing_date DATE,
                        receiving_date_text VARCHAR(150),
                        status_override VARCHAR(40),
                        total_rmb_incl_vat_override NUMERIC(15, 2),
                        total_vat_return_override NUMERIC(15, 2),
                        remarks TEXT,
                        items_override_json TEXT DEFAULT '[]',
                        updated_by_id UUID,
                        updated_by_name VARCHAR(150),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        deleted_at TIMESTAMPTZ
                    )
                """)
            )
            await self.session.execute(
                text("""
                    CREATE TABLE IF NOT EXISTS vat_return_receipts (
                        id UUID PRIMARY KEY,
                        vat_record_id UUID NOT NULL,
                        exp_no VARCHAR(120) NOT NULL,
                        receipt_date DATE NOT NULL,
                        amount_rmb NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                        reference_no VARCHAR(150),
                        remarks TEXT,
                        created_by_id UUID,
                        created_by_name VARCHAR(150),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        deleted_at TIMESTAMPTZ
                    )
                """)
            )
            await self.session.commit()
        except Exception as exc:
            logger.warning("Could not auto-create vat_return tables: %s", exc)
            await self.session.rollback()

    @staticmethod
    def _derive_financial_year(inv_date: date | None, exp_no: str) -> str:
        if inv_date:
            # April-March or calendar year grouping: look at year in EXP No first if present
            m = re.search(r"20(2[0-9])", exp_no or "")
            if m:
                yr = int("20" + m.group(1))
                return f"{yr}-{yr + 1}"
            yr = inv_date.year if inv_date.month >= 4 else inv_date.year - 1
            return f"{yr}-{yr + 1}"
        m = re.search(r"20(2[0-9])", exp_no or "")
        if m:
            yr = int("20" + m.group(1))
            return f"{yr}-{yr + 1}"
        return "2026-2027"

    @staticmethod
    def _normalize_exp_key(val: str) -> str:
        """
        Normalizes `EXP2025 - 01`, `YL-EXP2025-01`, `EXP 2025-01` to a canonical lookup key
        so Table 1 summary rows and Table 2 `YL-EXP...` product breakdown rows link automatically.
        """
        s = (val or "").strip().upper()
        s = re.sub(r"^YL[\s\-_]*", "", s)
        s = re.sub(r"\s+", "", s)
        return s

    @staticmethod
    def _compute_item_vat_return(
        total_rmb_incl_vat: float,
        purchase_vat_pct: float,
        refund_vat_pct: float,
    ) -> float:
        if total_rmb_incl_vat <= 0 or refund_vat_pct <= 0:
            return 0.0
        denom = 1.0 + (purchase_vat_pct / 100.0 if purchase_vat_pct >= 0 else 0.13)
        if denom <= 0:
            denom = 1.13
        return round((total_rmb_incl_vat / denom) * (refund_vat_pct / 100.0), 2)

    async def list_vat_returns(
        self,
        *,
        stage: VatReturnStageFilterLiteral = "all",
        financial_year: str | None = None,
        search: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> VatReturnListResponse:
        await self._ensure_vat_return_tables()
        usd_to_rmb = await self._get_usd_to_rmb_rate()

        # 1. Load all Confirmed/Dispatched/LR Sales Process orders + line items
        so_stmt = (
            select(SaleOrder)
            .options(joinedload(SaleOrder.items))
            .where(
                SaleOrder.deleted_at.is_(None),
                func.lower(SaleOrder.status).notin_(EXCLUDED_STATUSES),
            )
            .order_by(SaleOrder.order_date.desc(), SaleOrder.created_at.desc())
        )
        sale_orders = list((await self.session.execute(so_stmt)).unique().scalars().all())

        # 2. Load Product and HSN VAT % lookup maps
        prod_stmt = select(
            Product.id,
            Product.purchase_vat_percent,
            Product.refund_vat_percent,
            Product.hsn_id,
        ).where(Product.deleted_at.is_(None))
        prod_rows = (await self.session.execute(prod_stmt)).all()

        hsn_stmt = select(
            HsnCode.id,
            HsnCode.code,
            HsnCode.purchase_vat_percent,
            HsnCode.refund_vat_percent,
        ).where(HsnCode.deleted_at.is_(None))
        hsn_rows = (await self.session.execute(hsn_stmt)).all()
        hsn_by_id = {r.id: r for r in hsn_rows}
        hsn_by_code = {(r.code or "").strip().upper(): r for r in hsn_rows if r.code}

        prod_vat_map: dict[uuid.UUID, tuple[float, float]] = {}
        for pr in prod_rows:
            p_vat = _to_float(pr.purchase_vat_percent, 0.0)
            r_vat = _to_float(pr.refund_vat_percent, 0.0)
            if (p_vat <= 0 and r_vat <= 0) and pr.hsn_id and pr.hsn_id in hsn_by_id:
                h = hsn_by_id[pr.hsn_id]
                p_vat = _to_float(h.purchase_vat_percent, 13.0)
                r_vat = _to_float(h.refund_vat_percent, 13.0)
            if p_vat <= 0:
                p_vat = 13.0
            if r_vat <= 0 and _to_float(pr.refund_vat_percent, -1.0) != 0.0:
                r_vat = 13.0
            prod_vat_map[pr.id] = (p_vat, r_vat)

        # 3. Load Confirmed LocalPurchases to auto-link Supplier Contract No. & Contract Date
        lp_stmt = (
            select(LocalPurchase)
            .where(
                LocalPurchase.deleted_at.is_(None),
                func.lower(LocalPurchase.status).notin_(EXCLUDED_STATUSES),
            )
            .order_by(LocalPurchase.invoice_date.desc())
        )
        local_purchases = list((await self.session.execute(lp_stmt)).scalars().all())
        lp_by_cons_supplier: dict[tuple[str, str], LocalPurchase] = {}
        lp_by_supplier: dict[str, LocalPurchase] = {}
        for lp in local_purchases:
            c_key = (lp.consignment_code or "").strip().upper()
            s_key = (lp.supplier_name or "").strip().upper()
            if c_key and s_key and (c_key, s_key) not in lp_by_cons_supplier:
                lp_by_cons_supplier[(c_key, s_key)] = lp
            if s_key and s_key not in lp_by_supplier:
                lp_by_supplier[s_key] = lp

        # 4. Load stored VatReturnRecord overrides & manual/imported rows
        vr_stmt = (
            select(VatReturnRecord)
            .where(VatReturnRecord.deleted_at.is_(None))
            .order_by(VatReturnRecord.invoice_date.desc().nullslast(), VatReturnRecord.created_at.desc())
        )
        vr_records = list((await self.session.execute(vr_stmt)).scalars().all())
        vr_by_so_id: dict[uuid.UUID, VatReturnRecord] = {}
        vr_by_norm_exp: dict[str, VatReturnRecord] = {}
        for vr in vr_records:
            if vr.source_type == "sale_order":
                vr_by_so_id[vr.source_id] = vr
            norm_k = self._normalize_exp_key(vr.exp_no)
            if norm_k:
                vr_by_norm_exp[norm_k] = vr

        # 5. Load all active VatReturnReceipt records
        rec_stmt = (
            select(VatReturnReceipt)
            .where(VatReturnReceipt.deleted_at.is_(None))
            .order_by(VatReturnReceipt.receipt_date.asc(), VatReturnReceipt.created_at.asc())
        )
        all_receipts = list((await self.session.execute(rec_stmt)).scalars().all())
        receipts_by_record_id: dict[uuid.UUID, list[VatReturnReceiptResponse]] = {}
        receipts_by_norm_exp: dict[str, list[VatReturnReceiptResponse]] = {}
        for r in all_receipts:
            resp = VatReturnReceiptResponse(
                id=r.id,
                vat_record_id=r.vat_record_id,
                exp_no=r.exp_no,
                receipt_date=r.receipt_date,
                amount_rmb=_to_float(r.amount_rmb),
                reference_no=r.reference_no,
                remarks=r.remarks,
                created_by_id=r.created_by_id,
                created_by_name=r.created_by_name,
                created_at=r.created_at,
            )
            receipts_by_record_id.setdefault(r.vat_record_id, []).append(resp)
            nk = self._normalize_exp_key(r.exp_no)
            if nk:
                receipts_by_norm_exp.setdefault(nk, []).append(resp)

        rows: list[VatReturnRow] = []
        matched_vr_ids: set[uuid.UUID] = set()

        # 6. Build live rows from Confirmed SaleOrders
        for so in sale_orders:
            norm_so_exp = self._normalize_exp_key(so.order_no)
            vr = vr_by_so_id.get(so.id) or vr_by_norm_exp.get(norm_so_exp)
            if vr:
                matched_vr_ids.add(vr.id)

            exp_no = (vr.exp_no if vr and vr.exp_no else so.order_no).strip()
            inv_date = (vr.invoice_date if vr and vr.invoice_date else so.order_date)
            fy = (vr.financial_year if vr and vr.financial_year else self._derive_financial_year(inv_date, exp_no))
            first_filing = vr.first_filing_date if vr else None
            so_rate = _to_float(so.usd_exchange_rate, usd_to_rmb)
            if so_rate <= 0:
                so_rate = usd_to_rmb

            # Parse item overrides if stored
            override_items_by_key: dict[str, dict[str, Any]] = {}
            override_items_list: list[dict[str, Any]] = []
            if vr and vr.items_override_json:
                try:
                    parsed = json.loads(vr.items_override_json)
                    if isinstance(parsed, list):
                        override_items_list = parsed
                        for it in parsed:
                            if isinstance(it, dict) and it.get("item_key"):
                                override_items_by_key[str(it["item_key"])] = it
                except Exception:
                    pass

            breakdown_items: list[VatReturnBreakdownItem] = []
            if so.items:
                for idx, item in enumerate(so.items, start=1):
                    ikey = str(item.id)
                    ov = override_items_by_key.get(ikey, {})

                    # Default VAT % from Product or HSN (standard China VAT = 13%)
                    p_vat, r_vat = 13.0, 13.0
                    if item.product_id and item.product_id in prod_vat_map:
                        p_vat, r_vat = prod_vat_map[item.product_id]
                    elif item.hsn_code and item.hsn_code.strip().upper() in hsn_by_code:
                        h = hsn_by_code[item.hsn_code.strip().upper()]
                        p_vat = _to_float(h.purchase_vat_percent, 13.0) or 13.0
                        r_vat = _to_float(h.refund_vat_percent, 13.0) or 13.0

                    if "purchase_vat_percent" in ov and ov["purchase_vat_percent"] is not None:
                        p_vat = _to_float(ov["purchase_vat_percent"], p_vat)
                    if "refund_vat_percent" in ov and ov["refund_vat_percent"] is not None:
                        r_vat = _to_float(ov["refund_vat_percent"], r_vat)

                    qty = _to_float(ov.get("quantity"), _to_float(item.quantity, 0.0))
                    rmb_unit = _to_float(
                        ov.get("rmb_price_with_vat"),
                        _to_float(item.unit_price_rmb_with_vat, 0.0),
                    )
                    total_rmb = _to_float(
                        ov.get("total_rmb_incl_vat"),
                        _to_float(item.total_supplier_amount_rmb, round(qty * rmb_unit, 2)),
                    )
                    if total_rmb <= 0 and qty > 0 and rmb_unit > 0:
                        total_rmb = round(qty * rmb_unit, 2)

                    usd_unit = _to_float(
                        ov.get("usd_price"),
                        _to_float(item.cfr_price_usd or item.fob_price_usd or item.unit_rate, 0.0),
                    )

                    # Match LocalPurchase for Contract No. & Contract Date
                    c_key = (so.consignment_code or "").strip().upper()
                    s_key = (item.supplier_name or "").strip().upper()
                    matched_lp = lp_by_cons_supplier.get((c_key, s_key)) or lp_by_supplier.get(s_key)
                    default_contract_no = matched_lp.invoice_no if matched_lp else None
                    default_contract_date = (
                        matched_lp.invoice_date.isoformat()
                        if matched_lp and matched_lp.invoice_date
                        else (inv_date.isoformat() if inv_date else None)
                    )

                    vat_returned = (
                        _to_float(ov["vat_to_be_returned"])
                        if "vat_to_be_returned" in ov and ov["vat_to_be_returned"] is not None
                        else self._compute_item_vat_return(total_rmb, p_vat, r_vat)
                    )

                    breakdown_items.append(
                        VatReturnBreakdownItem(
                            item_key=ikey,
                            order_no=ov.get("order_no") or (f"YL-{exp_no}" if not exp_no.upper().startswith("YL-") else exp_no),
                            contract_date=ov.get("contract_date") or default_contract_date,
                            contract_no=ov.get("contract_no") or default_contract_no,
                            supplier_name=ov.get("supplier_name") or item.supplier_name or "—",
                            product_id=str(item.product_id) if item.product_id else None,
                            product_name=ov.get("product_name") or item.product_name,
                            product_code=item.product_code,
                            hsn_code=item.hsn_code,
                            quantity=qty,
                            rmb_price_with_vat=rmb_unit,
                            total_rmb_incl_vat=total_rmb,
                            usd_price=usd_unit,
                            remarks_usd=ov.get("remarks_usd"),
                            purchase_vat_percent=p_vat,
                            refund_vat_percent=r_vat,
                            vat_to_be_returned=vat_returned,
                            remarks=ov.get("remarks") if "remarks" in ov else item.remarks,
                            first_filing_date=ov.get("first_filing_date")
                            or (first_filing.isoformat() if first_filing else None),
                        )
                    )
            elif override_items_list:
                for idx, ov in enumerate(override_items_list, start=1):
                    qty = _to_float(ov.get("quantity"), 0.0)
                    rmb_unit = _to_float(ov.get("rmb_price_with_vat"), 0.0)
                    total_rmb = _to_float(ov.get("total_rmb_incl_vat"), round(qty * rmb_unit, 2))
                    p_vat = _to_float(ov.get("purchase_vat_percent"), 13.0)
                    r_vat = _to_float(ov.get("refund_vat_percent"), 13.0)
                    vat_ret = (
                        _to_float(ov["vat_to_be_returned"])
                        if ov.get("vat_to_be_returned") is not None
                        else self._compute_item_vat_return(total_rmb, p_vat, r_vat)
                    )
                    breakdown_items.append(
                        VatReturnBreakdownItem(
                            item_key=str(ov.get("item_key") or f"item-{idx}"),
                            order_no=str(ov.get("order_no") or f"YL-{exp_no}"),
                            contract_date=ov.get("contract_date"),
                            contract_no=ov.get("contract_no"),
                            supplier_name=str(ov.get("supplier_name") or "—"),
                            product_name=str(ov.get("product_name") or "—"),
                            quantity=qty,
                            rmb_price_with_vat=rmb_unit,
                            total_rmb_incl_vat=total_rmb,
                            usd_price=_to_float(ov.get("usd_price"), 0.0),
                            remarks_usd=ov.get("remarks_usd"),
                            purchase_vat_percent=p_vat,
                            refund_vat_percent=r_vat,
                            vat_to_be_returned=vat_ret,
                            remarks=ov.get("remarks"),
                            first_filing_date=ov.get("first_filing_date"),
                        )
                    )

            computed_rmb_incl = round(sum(i.total_rmb_incl_vat for i in breakdown_items), 2)
            computed_vat_return = round(sum(i.vat_to_be_returned for i in breakdown_items), 2)

            total_rmb_incl = (
                _to_float(vr.total_rmb_incl_vat_override)
                if vr and vr.total_rmb_incl_vat_override is not None
                else computed_rmb_incl
            )
            total_vat_return = (
                _to_float(vr.total_vat_return_override)
                if vr and vr.total_vat_return_override is not None
                else computed_vat_return
            )

            row_receipts: list[VatReturnReceiptResponse] = []
            if vr and vr.id in receipts_by_record_id:
                row_receipts = receipts_by_record_id[vr.id]
            elif norm_so_exp in receipts_by_norm_exp:
                row_receipts = receipts_by_norm_exp[norm_so_exp]

            row = self._build_vat_return_row(
                record_key=f"SO:{so.id}",
                vat_record_id=vr.id if vr else None,
                source_type="sale_order",
                source_id=so.id,
                exp_no=exp_no,
                invoice_date=inv_date,
                financial_year=fy,
                consignment_code=vr.consignment_code if vr and vr.consignment_code else so.consignment_code,
                buyer_name=vr.buyer_name if vr and vr.buyer_name else so.buyer_name,
                organization_name=so.organization_name,
                source_status=so.status,
                total_rmb_incl_vat=total_rmb_incl,
                total_vat_return_rmb=total_vat_return,
                usd_exchange_rate=so_rate,
                status_override=vr.status_override if vr else None,
                receiving_date_text=vr.receiving_date_text if vr else None,
                first_filing_date=first_filing,
                remarks=vr.remarks if vr and vr.remarks is not None else so.remarks,
                breakdown_items=breakdown_items,
                receipts=row_receipts,
            )
            rows.append(row)

        # 7. Append standalone / imported VatReturnRecords not tied to an active SaleOrder
        for vr in vr_records:
            if vr.id in matched_vr_ids:
                continue

            breakdown_items: list[VatReturnBreakdownItem] = []
            if vr.items_override_json:
                try:
                    parsed = json.loads(vr.items_override_json)
                    if isinstance(parsed, list):
                        for idx, ov in enumerate(parsed, start=1):
                            if not isinstance(ov, dict):
                                continue
                            qty = _to_float(ov.get("quantity"), 0.0)
                            rmb_unit = _to_float(ov.get("rmb_price_with_vat"), 0.0)
                            total_rmb = _to_float(ov.get("total_rmb_incl_vat"), round(qty * rmb_unit, 2))
                            p_vat = _to_float(ov.get("purchase_vat_percent"), 13.0)
                            r_vat = _to_float(ov.get("refund_vat_percent"), 13.0)
                            vat_ret = (
                                _to_float(ov["vat_to_be_returned"])
                                if ov.get("vat_to_be_returned") is not None
                                else self._compute_item_vat_return(total_rmb, p_vat, r_vat)
                            )
                            breakdown_items.append(
                                VatReturnBreakdownItem(
                                    item_key=str(ov.get("item_key") or f"imp-{idx}"),
                                    order_no=str(ov.get("order_no") or f"YL-{vr.exp_no}"),
                                    contract_date=ov.get("contract_date"),
                                    contract_no=ov.get("contract_no"),
                                    supplier_name=str(ov.get("supplier_name") or "—"),
                                    product_name=str(ov.get("product_name") or "—"),
                                    product_code=ov.get("product_code"),
                                    hsn_code=ov.get("hsn_code"),
                                    quantity=qty,
                                    rmb_price_with_vat=rmb_unit,
                                    total_rmb_incl_vat=total_rmb,
                                    usd_price=_to_float(ov.get("usd_price"), 0.0),
                                    remarks_usd=ov.get("remarks_usd"),
                                    purchase_vat_percent=p_vat,
                                    refund_vat_percent=r_vat,
                                    vat_to_be_returned=vat_ret,
                                    remarks=ov.get("remarks"),
                                    first_filing_date=ov.get("first_filing_date")
                                    or (vr.first_filing_date.isoformat() if vr.first_filing_date else None),
                                )
                            )
                except Exception:
                    pass

            computed_rmb_incl = round(sum(i.total_rmb_incl_vat for i in breakdown_items), 2)
            computed_vat_return = round(sum(i.vat_to_be_returned for i in breakdown_items), 2)

            total_rmb_incl = (
                _to_float(vr.total_rmb_incl_vat_override)
                if vr.total_rmb_incl_vat_override is not None
                else computed_rmb_incl
            )
            total_vat_return = (
                _to_float(vr.total_vat_return_override)
                if vr.total_vat_return_override is not None
                else computed_vat_return
            )

            fy = vr.financial_year or self._derive_financial_year(vr.invoice_date, vr.exp_no)
            row_receipts = receipts_by_record_id.get(vr.id, [])

            row = self._build_vat_return_row(
                record_key=f"VR:{vr.id}",
                vat_record_id=vr.id,
                source_type="manual",
                source_id=vr.source_id,
                exp_no=vr.exp_no,
                invoice_date=vr.invoice_date,
                financial_year=fy,
                consignment_code=vr.consignment_code,
                buyer_name=vr.buyer_name,
                organization_name=vr.organization_name or "Yinglima",
                source_status="imported",
                total_rmb_incl_vat=total_rmb_incl,
                total_vat_return_rmb=total_vat_return,
                usd_exchange_rate=usd_to_rmb,
                status_override=vr.status_override,
                receiving_date_text=vr.receiving_date_text,
                first_filing_date=vr.first_filing_date,
                remarks=vr.remarks,
                breakdown_items=breakdown_items,
                receipts=row_receipts,
            )
            rows.append(row)

        # Sort newest first by invoice_date, then exp_no descending
        rows.sort(
            key=lambda r: (
                r.invoice_date.isoformat() if r.invoice_date else "0000-00-00",
                r.exp_no,
            ),
            reverse=True,
        )

        # Collect available Financial Years across all records
        fy_set = {r.financial_year for r in rows if r.financial_year}
        fy_set.update(["2026-2027", "2025-2026", "2024-2025", "2023-2024"])
        available_fys = sorted(fy_set, reverse=True)

        # Apply Financial Year, Date Range, and Search filters BEFORE computing KPI summary
        # so KPI cards reflect the selected Financial Year / search context while keeping stage counts accurate
        filtered_for_kpi: list[VatReturnRow] = []
        q = (search or "").strip().lower()
        fy_filter = (financial_year or "").strip()

        for r in rows:
            if fy_filter and fy_filter.lower() != "all" and r.financial_year != fy_filter:
                continue
            if date_from and r.invoice_date and r.invoice_date < date_from:
                continue
            if date_to and r.invoice_date and r.invoice_date > date_to:
                continue
            if q:
                haystack = " ".join(
                    filter(
                        None,
                        [
                            r.exp_no,
                            r.consignment_code,
                            r.buyer_name,
                            r.status,
                            r.remarks,
                            r.receiving_date_display,
                            " ".join(f"{bi.supplier_name} {bi.product_name} {bi.contract_no or ''}" for bi in r.breakdown_items),
                        ],
                    )
                ).lower()
                if q not in haystack:
                    continue
            filtered_for_kpi.append(r)

        # Compute KPI Summary across `filtered_for_kpi`
        total_rmb_incl_sum = round(sum(r.total_rmb_incl_vat for r in filtered_for_kpi), 2)
        total_vat_sum = round(sum(r.total_vat_return_rmb for r in filtered_for_kpi), 2)
        received_vat_sum = round(sum(r.received_vat_rmb for r in filtered_for_kpi), 2)
        partial_vat_sum = round(
            sum(r.received_vat_rmb for r in filtered_for_kpi if r.stage_key == "partial"), 2
        )
        balance_vat_sum = round(sum(r.balance_vat_rmb for r in filtered_for_kpi), 2)

        kpi = VatReturnKpiSummary(
            total_records=len(filtered_for_kpi),
            pending_records=sum(1 for r in filtered_for_kpi if r.stage_key == "pending"),
            partial_records=sum(1 for r in filtered_for_kpi if r.stage_key == "partial"),
            received_records=sum(1 for r in filtered_for_kpi if r.stage_key == "received"),
            no_vat_records=sum(1 for r in filtered_for_kpi if r.stage_key == "no_vat"),
            total_rmb_incl_vat=total_rmb_incl_sum,
            total_vat_return_rmb=total_vat_sum,
            received_vat_rmb=received_vat_sum,
            partial_received_vat_rmb=partial_vat_sum,
            balance_vat_rmb=balance_vat_sum,
            usd_to_rmb_rate=usd_to_rmb,
            total_vat_return_usd=round(total_vat_sum / usd_to_rmb, 2) if usd_to_rmb else 0.0,
            received_vat_usd=round(received_vat_sum / usd_to_rmb, 2) if usd_to_rmb else 0.0,
            balance_vat_usd=round(balance_vat_sum / usd_to_rmb, 2) if usd_to_rmb else 0.0,
        )

        # Apply stage filter for the table list
        if stage and stage != "all":
            final_items = [r for r in filtered_for_kpi if r.stage_key == stage]
        else:
            final_items = filtered_for_kpi

        return VatReturnListResponse(
            kpi=kpi,
            available_financial_years=available_fys,
            items=final_items,
        )

    def _build_vat_return_row(
        self,
        *,
        record_key: str,
        vat_record_id: uuid.UUID | None,
        source_type: str,
        source_id: uuid.UUID,
        exp_no: str,
        invoice_date: date | None,
        financial_year: str,
        consignment_code: str | None,
        buyer_name: str | None,
        organization_name: str | None,
        source_status: str,
        total_rmb_incl_vat: float,
        total_vat_return_rmb: float,
        usd_exchange_rate: float,
        status_override: str | None,
        receiving_date_text: str | None,
        first_filing_date: date | None,
        remarks: str | None,
        breakdown_items: list[VatReturnBreakdownItem],
        receipts: list[VatReturnReceiptResponse],
    ) -> VatReturnRow:
        received_rmb = round(sum(r.amount_rmb for r in receipts), 2)
        ov_upper = (status_override or "").strip().upper()

        if ov_upper == "NO VAT" or (total_vat_return_rmb <= 0.01 and received_rmb <= 0.01 and ov_upper != "PENDING"):
            status_val: VatReturnStatusLiteral = "NO VAT"
            stage_key = "no_vat"
            balance_rmb = 0.0
        elif received_rmb >= total_vat_return_rmb - 0.5 and total_vat_return_rmb > 0:
            status_val = "RECEIVED"
            stage_key = "received"
            balance_rmb = max(0.0, round(total_vat_return_rmb - received_rmb, 2))
        elif 0 < received_rmb < total_vat_return_rmb - 0.5:
            status_val = "PARTIAL RECEIVED"
            stage_key = "partial"
            balance_rmb = round(total_vat_return_rmb - received_rmb, 2)
        else:
            if ov_upper == "RECEIVED" and received_rmb <= 0 and total_vat_return_rmb > 0:
                status_val = "RECEIVED"
                stage_key = "received"
                received_rmb = total_vat_return_rmb
                balance_rmb = 0.0
            elif ov_upper == "PARTIAL RECEIVED":
                status_val = "PARTIAL RECEIVED"
                stage_key = "partial"
                balance_rmb = max(0.0, round(total_vat_return_rmb - received_rmb, 2))
            else:
                status_val = "PENDING"
                stage_key = "pending"
                balance_rmb = max(0.0, round(total_vat_return_rmb - received_rmb, 2))

        if receiving_date_text:
            rec_date_display = receiving_date_text
        elif receipts:
            rec_date_display = ", ".join(
                sorted({r.receipt_date.isoformat() for r in receipts})
            )
        else:
            rec_date_display = None

        partial_display = received_rmb if stage_key == "partial" else (
            round(sum(r.amount_rmb for r in receipts[:-1]), 2) if len(receipts) > 1 else 0.0
        )
        rate = usd_exchange_rate if usd_exchange_rate > 0 else 7.20

        return VatReturnRow(
            record_key=record_key,
            vat_record_id=vat_record_id,
            source_type="sale_order" if source_type == "sale_order" else "manual",
            source_id=source_id,
            exp_no=exp_no,
            invoice_date=invoice_date,
            financial_year=financial_year,
            consignment_code=consignment_code,
            buyer_name=buyer_name,
            organization_name=organization_name,
            source_status=source_status,
            total_rmb_incl_vat=total_rmb_incl_vat,
            total_vat_return_rmb=total_vat_return_rmb,
            received_vat_rmb=received_rmb,
            balance_vat_rmb=balance_rmb,
            usd_exchange_rate=rate,
            total_vat_return_usd=round(total_vat_return_rmb / rate, 2),
            received_vat_usd=round(received_rmb / rate, 2),
            balance_vat_usd=round(balance_rmb / rate, 2),
            status=status_val,
            stage_key=stage_key,  # type: ignore[arg-type]
            receiving_date_display=rec_date_display,
            partial_amount_display=partial_display,
            first_filing_date=first_filing_date,
            remarks=remarks,
            items_count=len(breakdown_items),
            breakdown_items=breakdown_items,
            receipts_count=len(receipts),
            receipts=receipts,
        )

    async def _resolve_or_create_vat_record(
        self,
        record_key: str,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> VatReturnRecord:
        await self._ensure_vat_return_tables()
        key = (record_key or "").strip()

        if key.startswith("VR:"):
            vr_id = uuid.UUID(key.split(":", 1)[1])
            stmt = select(VatReturnRecord).where(
                VatReturnRecord.id == vr_id,
                VatReturnRecord.deleted_at.is_(None),
            )
            vr = (await self.session.execute(stmt)).scalar_one_or_none()
            if not vr:
                raise NotFoundException("VAT Return record not found.")
            return vr

        if key.startswith("SO:"):
            so_id = uuid.UUID(key.split(":", 1)[1])
            stmt = select(VatReturnRecord).where(
                VatReturnRecord.source_type == "sale_order",
                VatReturnRecord.source_id == so_id,
                VatReturnRecord.deleted_at.is_(None),
            )
            vr = (await self.session.execute(stmt)).scalar_one_or_none()
            if vr:
                return vr

            so_stmt = select(SaleOrder).where(SaleOrder.id == so_id)
            so = (await self.session.execute(so_stmt)).scalar_one_or_none()
            if not so:
                raise NotFoundException("Sale Order not found for VAT Return.")

            # Also check if a VatReturnRecord with matching exp_no already exists
            exp_stmt = select(VatReturnRecord).where(
                func.upper(VatReturnRecord.exp_no) == so.order_no.strip().upper(),
                VatReturnRecord.deleted_at.is_(None),
            )
            existing_exp = (await self.session.execute(exp_stmt)).scalar_one_or_none()
            if existing_exp:
                existing_exp.source_type = "sale_order"
                existing_exp.source_id = so.id
                return existing_exp

            vr = VatReturnRecord(
                id=uuid.uuid4(),
                source_type="sale_order",
                source_id=so.id,
                exp_no=so.order_no,
                invoice_date=so.order_date,
                financial_year=self._derive_financial_year(so.order_date, so.order_no),
                consignment_code=so.consignment_code,
                buyer_name=so.buyer_name,
                organization_name=so.organization_name,
                updated_by_id=user_id,
                updated_by_name=user_name,
            )
            self.session.add(vr)
            await self.session.flush()
            return vr

        # Fallback: look up by exp_no
        stmt = select(VatReturnRecord).where(
            func.upper(VatReturnRecord.exp_no) == key.upper(),
            VatReturnRecord.deleted_at.is_(None),
        )
        vr = (await self.session.execute(stmt)).scalar_one_or_none()
        if not vr:
            raise NotFoundException(f"VAT Return record '{record_key}' not found.")
        return vr

    async def update_vat_return(
        self,
        *,
        record_key: str,
        payload: VatReturnUpdatePayload,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        vr = await self._resolve_or_create_vat_record(
            record_key=record_key, user_id=user_id, user_name=user_name
        )
        fields = payload.model_dump(exclude_unset=True)

        if "exp_no" in fields and payload.exp_no:
            vr.exp_no = payload.exp_no.strip()
        if "invoice_date" in fields:
            vr.invoice_date = payload.invoice_date
        if "financial_year" in fields:
            vr.financial_year = payload.financial_year
        if "consignment_code" in fields:
            vr.consignment_code = payload.consignment_code
        if "buyer_name" in fields:
            vr.buyer_name = payload.buyer_name
        if "first_filing_date" in fields:
            vr.first_filing_date = payload.first_filing_date
        if "receiving_date_text" in fields:
            vr.receiving_date_text = payload.receiving_date_text
        if "status_override" in fields:
            vr.status_override = payload.status_override
        if "total_rmb_incl_vat_override" in fields:
            vr.total_rmb_incl_vat_override = (
                Decimal(str(payload.total_rmb_incl_vat_override))
                if payload.total_rmb_incl_vat_override is not None
                else None
            )
        if "total_vat_return_override" in fields:
            vr.total_vat_return_override = (
                Decimal(str(payload.total_vat_return_override))
                if payload.total_vat_return_override is not None
                else None
            )
        if "remarks" in fields:
            vr.remarks = payload.remarks

        if "breakdown_items" in fields and payload.breakdown_items is not None:
            recalculated_items: list[dict[str, Any]] = []
            for item in payload.breakdown_items:
                qty = _to_float(item.quantity, 0.0)
                rmb_unit = _to_float(item.rmb_price_with_vat, 0.0)
                tot_rmb = _to_float(item.total_rmb_incl_vat, round(qty * rmb_unit, 2))
                if tot_rmb <= 0 and qty > 0 and rmb_unit > 0:
                    tot_rmb = round(qty * rmb_unit, 2)
                p_vat = _to_float(item.purchase_vat_percent, 13.0)
                r_vat = _to_float(item.refund_vat_percent, 13.0)
                vat_ret = self._compute_item_vat_return(tot_rmb, p_vat, r_vat)
                d = item.model_dump(mode="json")
                d["total_rmb_incl_vat"] = tot_rmb
                d["vat_to_be_returned"] = vat_ret
                recalculated_items.append(d)
            vr.items_override_json = json.dumps(recalculated_items)

        vr.updated_by_id = user_id
        vr.updated_by_name = user_name
        await self.session.commit()
        return {"id": str(vr.id), "exp_no": vr.exp_no, "updated": True}

    async def create_manual_vat_return(
        self,
        *,
        payload: VatReturnManualCreatePayload,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        await self._ensure_vat_return_tables()
        exp_clean = payload.exp_no.strip()
        stmt = select(VatReturnRecord).where(
            func.upper(VatReturnRecord.exp_no) == exp_clean.upper(),
            VatReturnRecord.deleted_at.is_(None),
        )
        existing = (await self.session.execute(stmt)).scalar_one_or_none()
        if existing:
            raise ValidationException(f"EXP No. '{exp_clean}' already exists in VAT Return.")

        fy = payload.financial_year or self._derive_financial_year(payload.invoice_date, exp_clean)
        items_json = "[]"
        if payload.breakdown_items:
            items_json = json.dumps([i.model_dump(mode="json") for i in payload.breakdown_items])

        vr = VatReturnRecord(
            id=uuid.uuid4(),
            source_type="manual",
            source_id=uuid.uuid4(),
            exp_no=exp_clean,
            invoice_date=payload.invoice_date,
            financial_year=fy,
            consignment_code=payload.consignment_code,
            buyer_name=payload.buyer_name,
            organization_name="Yinglima",
            first_filing_date=payload.first_filing_date,
            receiving_date_text=payload.receiving_date_text,
            status_override=payload.status_override,
            total_rmb_incl_vat_override=(
                Decimal(str(payload.total_rmb_incl_vat_override))
                if payload.total_rmb_incl_vat_override is not None
                else None
            ),
            total_vat_return_override=(
                Decimal(str(payload.total_vat_return_override))
                if payload.total_vat_return_override is not None
                else None
            ),
            remarks=payload.remarks,
            items_override_json=items_json,
            updated_by_id=user_id,
            updated_by_name=user_name,
        )
        self.session.add(vr)
        await self.session.flush()

        if payload.received_amount_rmb and payload.received_amount_rmb > 0:
            rec = VatReturnReceipt(
                id=uuid.uuid4(),
                vat_record_id=vr.id,
                exp_no=vr.exp_no,
                receipt_date=payload.invoice_date or date.today(),
                amount_rmb=Decimal(str(payload.received_amount_rmb)),
                reference_no="Initial Receipt",
                remarks=payload.receiving_date_text,
                created_by_id=user_id,
                created_by_name=user_name,
            )
            self.session.add(rec)

        await self.session.commit()
        return {"id": str(vr.id), "record_key": f"VR:{vr.id}", "exp_no": vr.exp_no}

    async def add_vat_receipt(
        self,
        *,
        record_key: str,
        payload: VatReturnReceiptCreate,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> VatReturnReceiptResponse:
        vr = await self._resolve_or_create_vat_record(
            record_key=record_key, user_id=user_id, user_name=user_name
        )
        # Clear status_override if it was manually forced so receipt math governs status
        if vr.status_override in ("PENDING", "PARTIAL RECEIVED", "RECEIVED"):
            vr.status_override = None

        rec = VatReturnReceipt(
            id=uuid.uuid4(),
            vat_record_id=vr.id,
            exp_no=vr.exp_no,
            receipt_date=payload.receipt_date,
            amount_rmb=Decimal(str(round(payload.amount_rmb, 2))),
            reference_no=payload.reference_no,
            remarks=payload.remarks,
            created_by_id=user_id,
            created_by_name=user_name,
        )
        self.session.add(rec)
        await self.session.commit()
        await self.session.refresh(rec)

        return VatReturnReceiptResponse(
            id=rec.id,
            vat_record_id=rec.vat_record_id,
            exp_no=rec.exp_no,
            receipt_date=rec.receipt_date,
            amount_rmb=_to_float(rec.amount_rmb),
            reference_no=rec.reference_no,
            remarks=rec.remarks,
            created_by_id=rec.created_by_id,
            created_by_name=rec.created_by_name,
            created_at=rec.created_at,
        )

    async def delete_vat_receipt(self, *, receipt_id: uuid.UUID) -> dict[str, Any]:
        await self._ensure_vat_return_tables()
        stmt = select(VatReturnReceipt).where(
            VatReturnReceipt.id == receipt_id,
            VatReturnReceipt.deleted_at.is_(None),
        )
        rec = (await self.session.execute(stmt)).scalar_one_or_none()
        if not rec:
            raise NotFoundException("VAT receipt not found.")
        rec.deleted_at = datetime.now(timezone.utc)
        await self.session.commit()
        return {"deleted": True, "id": str(receipt_id)}

    @staticmethod
    def _parse_flexible_date(val: Any) -> date | None:
        if val is None:
            return None
        if isinstance(val, datetime):
            return val.date()
        if isinstance(val, date):
            return val
        s = str(val).strip()
        if not s or s in ("—", "-", "None", "null"):
            return None
        # Handle multi-date strings like "2024.03.22/2024.06.27" -> take first date
        first_part = re.split(r"[/,;]", s)[0].strip()
        for fmt in ("%Y-%m-%d", "%Y.%m.%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y"):
            try:
                return datetime.strptime(first_part, fmt).date()
            except ValueError:
                continue
        return None

    async def import_vat_returns_file(
        self,
        *,
        file_bytes: bytes,
        filename: str,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        """
        Imports VAT Return records from either:
        1. The user's multi-section Excel workbook (`RETURNED VAT LIST Yinglima 2023.xlsx`, containing
           both Table 1 Summary rows `EXP2025 - 01` and Table 2 Product Breakdown rows `YL-EXP2025-01`), OR
        2. A standard CSV / Excel file downloaded from Sample File / Export.
        Upserts by normalized `EXP No.` (updates existing or creates new, zero duplicate rows).
        """
        await self._ensure_vat_return_tables()
        fname = (filename or "").lower()

        rows_matrix: list[list[Any]] = []
        if fname.endswith(".csv"):
            import csv

            text_content = file_bytes.decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text_content))
            rows_matrix = [list(r) for r in reader]
        else:
            from openpyxl import load_workbook

            wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                for r in ws.iter_rows(values_only=True):
                    rows_matrix.append(list(r))

        summary_entries: dict[str, dict[str, Any]] = {}
        breakdown_by_norm_exp: dict[str, list[dict[str, Any]]] = {}
        current_fy = "2025-2026"

        for raw_row in rows_matrix:
            if not raw_row:
                continue
            # Detect FY header markers like "2023 - 2024" or "2025 - 2026"
            first_cells_str = " ".join(str(c or "").strip() for c in raw_row[:4])
            fy_match = re.search(r"(202[0-9])\s*[-–]\s*(202[0-9])", first_cells_str)
            if fy_match and not re.search(r"EXP", first_cells_str, re.IGNORECASE):
                current_fy = f"{fy_match.group(1)}-{fy_match.group(2)}"

            # Scan row for Table 1 Summary entry (col 1 or col 0 starts with EXP...)
            # In user's Excel: Col B (idx 1) = EXP NO., Col C (idx 2) = Invoice Date, Col D (idx 3) = TOTAL VAT RETURN AMOUNT,
            # Col E (idx 4) = VAT Amount Received, Col F (idx 5) = Balance, Col G (idx 6) = STATUS,
            # Col H (idx 7) = VAT RECEIVING DATE, Col I (idx 8) = Partial Amount, Col J (idx 9) = REMARKS, Col K (idx 10) = 1st Filing Date
            for offset in (0, 1):
                if len(raw_row) <= offset + 2:
                    continue
                cell_val = str(raw_row[offset] or "").strip()
                if re.match(r"^EXP\s*20[0-9]{2}", cell_val, re.IGNORECASE):
                    norm_k = self._normalize_exp_key(cell_val)
                    inv_dt = self._parse_flexible_date(raw_row[offset + 1] if len(raw_row) > offset + 1 else None)
                    tot_vat = _to_float(raw_row[offset + 2] if len(raw_row) > offset + 2 else None, 0.0)
                    rec_vat = _to_float(raw_row[offset + 3] if len(raw_row) > offset + 3 else None, 0.0)
                    status_str = str(raw_row[offset + 5] or "").strip().upper() if len(raw_row) > offset + 5 else ""
                    rec_date_raw = raw_row[offset + 6] if len(raw_row) > offset + 6 else None
                    rec_date_text = (
                        rec_date_raw.strftime("%Y-%m-%d")
                        if isinstance(rec_date_raw, (date, datetime))
                        else (str(rec_date_raw).strip() if rec_date_raw is not None else None)
                    )
                    rem_str = str(raw_row[offset + 8] or "").strip() if len(raw_row) > offset + 8 and raw_row[offset + 8] is not None else None
                    filing_dt = self._parse_flexible_date(raw_row[offset + 9] if len(raw_row) > offset + 9 else None)

                    summary_entries[norm_k] = {
                        "exp_no": cell_val,
                        "invoice_date": inv_dt,
                        "financial_year": self._derive_financial_year(inv_dt, cell_val) or current_fy,
                        "total_vat_return": tot_vat,
                        "received_vat": rec_vat,
                        "status_override": status_str if status_str in ("RECEIVED", "PARTIAL RECEIVED", "PENDING", "NO VAT") else None,
                        "receiving_date_text": rec_date_text if rec_date_text and rec_date_text != "None" else None,
                        "remarks": rem_str if rem_str and rem_str != "None" else None,
                        "first_filing_date": filing_dt,
                    }
                    break

            # Scan row for Table 2 Breakdown entry (`YL-EXP...` either in col 0/1 or in col 13 right-side table)
            for b_offset in (0, 1, 13):
                if len(raw_row) <= b_offset + 5:
                    continue
                b_cell = str(raw_row[b_offset] or "").strip()
                if re.match(r"^(YL[\s\-_]*)?EXP\s*20[0-9]{2}", b_cell, re.IGNORECASE):
                    # Verify this is a breakdown row (has supplier/product in +3/+4)
                    supp_val = str(raw_row[b_offset + 3] or "").strip() if len(raw_row) > b_offset + 3 else ""
                    prod_val = str(raw_row[b_offset + 4] or "").strip() if len(raw_row) > b_offset + 4 else ""
                    qty_val = _to_float(raw_row[b_offset + 5] if len(raw_row) > b_offset + 5 else None, -1.0)
                    if (supp_val or prod_val) and qty_val >= 0 and supp_val.upper() != "SUPPLIER":
                        norm_k = self._normalize_exp_key(b_cell)
                        c_dt = self._parse_flexible_date(raw_row[b_offset + 1] if len(raw_row) > b_offset + 1 else None)
                        c_no = str(raw_row[b_offset + 2] or "").strip() if len(raw_row) > b_offset + 2 and raw_row[b_offset + 2] is not None else None
                        rmb_unit = _to_float(raw_row[b_offset + 6] if len(raw_row) > b_offset + 6 else None, 0.0)
                        tot_rmb = _to_float(raw_row[b_offset + 7] if len(raw_row) > b_offset + 7 else None, round(qty_val * rmb_unit, 2))
                        usd_p = _to_float(raw_row[b_offset + 8] if len(raw_row) > b_offset + 8 else None, 0.0)
                        rem_usd = str(raw_row[b_offset + 9] or "").strip() if len(raw_row) > b_offset + 9 and raw_row[b_offset + 9] is not None else None
                        vat_ret = _to_float(raw_row[b_offset + 10] if len(raw_row) > b_offset + 10 else None, 0.0)
                        b_rem = str(raw_row[b_offset + 11] or "").strip() if len(raw_row) > b_offset + 11 and raw_row[b_offset + 11] is not None else None
                        b_filing = self._parse_flexible_date(raw_row[b_offset + 12] if len(raw_row) > b_offset + 12 else None)

                        # Infer refund_vat_percent from vat_ret / (tot_rmb / 1.13)
                        inferred_refund_pct = 13.0
                        if tot_rmb > 0:
                            if vat_ret <= 0.01:
                                inferred_refund_pct = 0.0
                            else:
                                ratio = (vat_ret / (tot_rmb / 1.13)) * 100.0
                                if abs(ratio - 13.0) < 1.0:
                                    inferred_refund_pct = 13.0
                                elif abs(ratio - 9.0) < 1.0:
                                    inferred_refund_pct = 9.0
                                else:
                                    inferred_refund_pct = round(ratio, 2)

                        breakdown_by_norm_exp.setdefault(norm_k, []).append(
                            {
                                "item_key": f"imp-{len(breakdown_by_norm_exp.get(norm_k, [])) + 1}",
                                "order_no": b_cell,
                                "contract_date": c_dt.isoformat() if c_dt else None,
                                "contract_no": c_no if c_no and c_no != "None" else None,
                                "supplier_name": supp_val or "—",
                                "product_name": prod_val or "—",
                                "quantity": qty_val,
                                "rmb_price_with_vat": rmb_unit,
                                "total_rmb_incl_vat": tot_rmb,
                                "usd_price": usd_p,
                                "remarks_usd": rem_usd if rem_usd and rem_usd != "None" else None,
                                "purchase_vat_percent": 13.0,
                                "refund_vat_percent": inferred_refund_pct,
                                "vat_to_be_returned": vat_ret,
                                "remarks": b_rem if b_rem and b_rem != "None" else None,
                                "first_filing_date": b_filing.isoformat() if b_filing else None,
                            }
                        )

        all_norm_keys = set(summary_entries.keys()) | set(breakdown_by_norm_exp.keys())
        if not all_norm_keys:
            raise ValidationException(
                "No valid EXP rows found in the uploaded file. Please ensure the sheet has 'EXP NO.' (e.g. EXP2025 - 01) or 'ORDER NO.' (e.g. YL-EXP2025-01) rows."
            )

        # Load existing VatReturnRecords and SaleOrders to upsert cleanly
        existing_vrs = list(
            (await self.session.execute(select(VatReturnRecord).where(VatReturnRecord.deleted_at.is_(None)))).scalars().all()
        )
        vr_by_norm = {self._normalize_exp_key(v.exp_no): v for v in existing_vrs}

        existing_sos = list(
            (await self.session.execute(select(SaleOrder).where(SaleOrder.deleted_at.is_(None)))).scalars().all()
        )
        so_by_norm = {self._normalize_exp_key(s.order_no): s for s in existing_sos}

        created_count = 0
        updated_count = 0

        for norm_k in sorted(all_norm_keys):
            s_info = summary_entries.get(norm_k, {})
            b_items = breakdown_by_norm_exp.get(norm_k, [])

            vr = vr_by_norm.get(norm_k)
            matched_so = so_by_norm.get(norm_k)

            exp_display = s_info.get("exp_no") or (
                re.sub(r"^YL[\s\-_]*", "", b_items[0]["order_no"], flags=re.IGNORECASE)
                if b_items
                else norm_k
            )
            inv_dt = s_info.get("invoice_date")
            if not inv_dt and b_items and b_items[0].get("contract_date"):
                inv_dt = self._parse_flexible_date(b_items[0]["contract_date"])

            filing_dt = s_info.get("first_filing_date")
            if not filing_dt and b_items and b_items[0].get("first_filing_date"):
                filing_dt = self._parse_flexible_date(b_items[0]["first_filing_date"])

            tot_rmb_incl = round(sum(_to_float(i.get("total_rmb_incl_vat"), 0.0) for i in b_items), 2) if b_items else None
            tot_vat_ret = (
                s_info["total_vat_return"]
                if "total_vat_return" in s_info and s_info["total_vat_return"] is not None
                else (round(sum(_to_float(i.get("vat_to_be_returned"), 0.0) for i in b_items), 2) if b_items else 0.0)
            )

            if vr:
                updated_count += 1
                if inv_dt:
                    vr.invoice_date = inv_dt
                if s_info.get("financial_year"):
                    vr.financial_year = s_info["financial_year"]
                if filing_dt:
                    vr.first_filing_date = filing_dt
                if s_info.get("receiving_date_text"):
                    vr.receiving_date_text = s_info["receiving_date_text"]
                if s_info.get("status_override"):
                    vr.status_override = s_info["status_override"]
                if s_info.get("remarks"):
                    vr.remarks = s_info["remarks"]
                if tot_rmb_incl is not None:
                    vr.total_rmb_incl_vat_override = Decimal(str(tot_rmb_incl))
                if tot_vat_ret is not None:
                    vr.total_vat_return_override = Decimal(str(tot_vat_ret))
                if b_items:
                    vr.items_override_json = json.dumps(b_items)
                vr.updated_by_id = user_id
                vr.updated_by_name = user_name
            else:
                created_count += 1
                vr = VatReturnRecord(
                    id=uuid.uuid4(),
                    source_type="sale_order" if matched_so else "manual",
                    source_id=matched_so.id if matched_so else uuid.uuid4(),
                    exp_no=exp_display,
                    invoice_date=inv_dt or (matched_so.order_date if matched_so else None),
                    financial_year=s_info.get("financial_year") or self._derive_financial_year(inv_dt, exp_display),
                    consignment_code=matched_so.consignment_code if matched_so else None,
                    buyer_name=matched_so.buyer_name if matched_so else None,
                    organization_name=matched_so.organization_name if matched_so else "Yinglima",
                    first_filing_date=filing_dt,
                    receiving_date_text=s_info.get("receiving_date_text"),
                    status_override=s_info.get("status_override"),
                    total_rmb_incl_vat_override=Decimal(str(tot_rmb_incl)) if tot_rmb_incl is not None else None,
                    total_vat_return_override=Decimal(str(tot_vat_ret)) if tot_vat_ret is not None else None,
                    remarks=s_info.get("remarks"),
                    items_override_json=json.dumps(b_items) if b_items else "[]",
                    updated_by_id=user_id,
                    updated_by_name=user_name,
                )
                self.session.add(vr)
                await self.session.flush()

            # Sync initial receipt if `received_vat > 0` and no receipts exist yet for this record
            rec_vat_amt = _to_float(s_info.get("received_vat"), 0.0)
            if rec_vat_amt > 0:
                existing_rec_cnt = (
                    await self.session.execute(
                        select(func.count(VatReturnReceipt.id)).where(
                            VatReturnReceipt.vat_record_id == vr.id,
                            VatReturnReceipt.deleted_at.is_(None),
                        )
                    )
                ).scalar_one()
                if existing_rec_cnt == 0:
                    rec_dt = self._parse_flexible_date(s_info.get("receiving_date_text")) or inv_dt or date.today()
                    self.session.add(
                        VatReturnReceipt(
                            id=uuid.uuid4(),
                            vat_record_id=vr.id,
                            exp_no=vr.exp_no,
                            receipt_date=rec_dt,
                            amount_rmb=Decimal(str(rec_vat_amt)),
                            reference_no="Imported Receipt",
                            remarks=s_info.get("receiving_date_text"),
                            created_by_id=user_id,
                            created_by_name=user_name,
                        )
                    )

        await self.session.commit()
        return {
            "created": created_count,
            "updated": updated_count,
            "total_processed": created_count + updated_count,
        }

    def generate_vat_returns_sample_csv(self) -> bytes:
        import csv

        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(
            [
                "EXP NO.",
                "Invoice Date",
                "TOTAL VAT RETURN AMOUNT",
                "VAT Amount Received",
                "Balance VAT Amount to be Received",
                "STATUS",
                "VAT RECEIVING DATE",
                "Partial Amount Received",
                "REMARKS",
                "1st Filing Date",
            ]
        )
        writer.writerow(
            [
                "EXP2026 - 01",
                "2026-04-15",
                "26890.09",
                "26890.09",
                "0.00",
                "RECEIVED",
                "2026-05-20",
                "",
                "Sample full VAT rebate received",
                "2026-05-06",
            ]
        )
        writer.writerow(
            [
                "EXP2026 - 02",
                "2026-04-22",
                "25150.56",
                "9638.94",
                "15511.62",
                "PARTIAL RECEIVED",
                "2026-06-10",
                "9638.94",
                "Balance under Tax Bureau review",
                "2026-05-12",
            ]
        )
        return out.getvalue().encode("utf-8-sig")

    async def export_vat_returns_excel(
        self,
        *,
        stage: VatReturnStageFilterLiteral = "all",
        financial_year: str | None = None,
        search: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> bytes:
        data = await self.list_vat_returns(
            stage=stage,
            financial_year=financial_year,
            search=search,
            date_from=date_from,
            date_to=date_to,
        )

        wb = Workbook()
        ws1: Any = wb.active or wb.create_sheet(title="VAT Return Summary")
        ws1.title = "VAT Return Summary"

        header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        thin_side = Side(border_style="thin", color="CBD5E1")
        cell_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

        headers1 = [
            "EXP NO.",
            "Financial Year",
            "Consignment",
            "Invoice Date",
            "Total RMB Incl. VAT (¥)",
            "TOTAL VAT RETURN AMOUNT (¥)",
            "VAT Amount Received (¥)",
            "Balance VAT to be Received (¥)",
            "STATUS",
            "VAT RECEIVING DATE",
            "Partial Amount Received (¥)",
            "REMARKS",
            "1st Filing Date",
        ]
        ws1.append(headers1)
        for col_idx in range(1, len(headers1) + 1):
            cell = ws1.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for r in data.items:
            ws1.append(
                [
                    r.exp_no,
                    r.financial_year,
                    r.consignment_code or "—",
                    r.invoice_date.isoformat() if r.invoice_date else "—",
                    r.total_rmb_incl_vat,
                    r.total_vat_return_rmb,
                    r.received_vat_rmb,
                    r.balance_vat_rmb,
                    r.status,
                    r.receiving_date_display or "—",
                    r.partial_amount_display or 0.0,
                    r.remarks or "",
                    r.first_filing_date.isoformat() if r.first_filing_date else "—",
                ]
            )

        # Totals Row on Sheet 1
        ws1.append(
            [
                "TOTAL",
                "",
                "",
                "",
                data.kpi.total_rmb_incl_vat,
                data.kpi.total_vat_return_rmb,
                data.kpi.received_vat_rmb,
                data.kpi.balance_vat_rmb,
                "",
                "",
                data.kpi.partial_received_vat_rmb,
                "",
                "",
            ]
        )
        tot_row_idx = ws1.max_row
        for c_i in range(1, len(headers1) + 1):
            c = ws1.cell(row=tot_row_idx, column=c_i)
            c.font = Font(name="Calibri", size=11, bold=True)
            c.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

        # Sheet 2: Product & Supplier Breakdown (Table 2)
        ws2: Any = wb.create_sheet(title="Product VAT Breakdown")
        headers2 = [
            "ORDER NO.",
            "Contract Date",
            "Contract No.",
            "SUPPLIER",
            "PRODUCT",
            "QUANTITY",
            "RMB PRICE WITH VAT (¥)",
            "Total RMB INCLUSIVE VAT (¥)",
            "USD PRICE ($)",
            "Purchase VAT %",
            "Refund VAT %",
            "VAT TO BE RETURNED (¥)",
            "REMARKS",
            "1st Filing Date",
        ]
        ws2.append(headers2)
        for col_idx in range(1, len(headers2) + 1):
            cell = ws2.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for r in data.items:
            for bi in r.breakdown_items:
                ws2.append(
                    [
                        bi.order_no,
                        bi.contract_date or (r.invoice_date.isoformat() if r.invoice_date else "—"),
                        bi.contract_no or "—",
                        bi.supplier_name,
                        bi.product_name,
                        bi.quantity,
                        bi.rmb_price_with_vat,
                        bi.total_rmb_incl_vat,
                        bi.usd_price,
                        bi.purchase_vat_percent,
                        bi.refund_vat_percent,
                        bi.vat_to_be_returned,
                        bi.remarks or "",
                        bi.first_filing_date or (r.first_filing_date.isoformat() if r.first_filing_date else "—"),
                    ]
                )

        self._auto_fit_columns(ws1, cell_border)
        self._auto_fit_columns(ws2, cell_border)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()


