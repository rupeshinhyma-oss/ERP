"""Business logic for the Cargo Overview module."""

from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cargo_overview.constants import (
    CARGO_CHECKLIST_ITEMS,
    CARGO_DOC_SLOTS,
    CARGO_LOCAL_SUBFOLDER,
    CARGO_STORAGE_BUCKET,
)
from app.cargo_overview.extractor import CargoDataExtractor, ExtractedCargoRecord
from app.cargo_overview.models import CargoOverview
from app.cargo_overview.schemas import (
    CargoChecklistItem,
    CargoChecklistUpdatePayload,
    CargoDocumentSlot,
    CargoFinanceLine,
    CargoOverviewCreatePayload,
    CargoOverviewListResponse,
    CargoOverviewRow,
    CargoProductLine,
)
from app.common.storage import delete_stored_file, sanitize_filename, save_uploaded_file
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, NotFoundException
from app.masters.warehouses.models import Warehouse


def normalize_consignment_key(raw_key: str) -> str:
    """Normalize a consignment key for case-insensitive, whitespace-collapsed matching."""
    return re.sub(r"\s+", " ", raw_key.strip()).upper()


def _parse_date_safe(val: Any) -> date | None:
    if val is None or val == "":
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    try:
        return date.fromisoformat(str(val).strip()[:10])
    except ValueError:
        return None


def _build_documents(
    stored_docs: dict[str, Any],
    auto_linked_docs: dict[str, dict[str, Any]] | None = None,
) -> list[CargoDocumentSlot]:
    auto_map = auto_linked_docs or {}
    slots: list[CargoDocumentSlot] = []
    for slot_key, slot_label in CARGO_DOC_SLOTS:
        manual = stored_docs.get(slot_key)
        if isinstance(manual, dict) and manual.get("url"):
            slots.append(
                CargoDocumentSlot(
                    slot_key=slot_key,
                    label=slot_label,
                    file_url=manual.get("url"),
                    filename=manual.get("filename"),
                    uploaded_at=manual.get("uploaded_at"),
                    uploaded_by=manual.get("uploaded_by"),
                    is_auto_linked=False,
                )
            )
            continue

        auto = auto_map.get(slot_key)
        if isinstance(auto, dict) and auto.get("url"):
            url = str(auto["url"])
            slots.append(
                CargoDocumentSlot(
                    slot_key=slot_key,
                    label=slot_label,
                    file_url=url,
                    filename=auto.get("filename") or url.split("/")[-1],
                    uploaded_at=auto.get("uploaded_at"),
                    uploaded_by=auto.get("source") or "System",
                    is_auto_linked=True,
                )
            )
            continue

        slots.append(
            CargoDocumentSlot(
                slot_key=slot_key,
                label=slot_label,
                file_url=None,
                filename=None,
                uploaded_at=None,
                uploaded_by=None,
                is_auto_linked=False,
            )
        )
    return slots


def _build_checklist(stored_checks: dict[str, Any]) -> list[CargoChecklistItem]:
    items: list[CargoChecklistItem] = []
    for key, label in CARGO_CHECKLIST_ITEMS:
        items.append(
            CargoChecklistItem(
                key=key,
                label=label,
                value=bool(stored_checks.get(key, False)),
            )
        )
    return items


def _parse_finance_lines(raw_list: list[dict[str, Any]] | None) -> list[CargoFinanceLine]:
    if not raw_list:
        return []
    lines: list[CargoFinanceLine] = []
    for idx, entry in enumerate(raw_list):
        if not isinstance(entry, dict):
            continue
        curr_raw = str(entry.get("currency") or "INR").strip().upper()
        currency = "USD" if curr_raw in ("USD", "$") else "INR"
        total = round(max(0.0, float(entry.get("total_amount") or 0.0)), 2)
        paid = round(max(0.0, float(entry.get("paid_amount") or 0.0)), 2)
        bal_val = entry.get("balance_amount")
        balance = (
            round(max(0.0, float(bal_val)), 2)
            if bal_val is not None
            else round(max(0.0, total - paid), 2)
        )
        raw_stage = str(entry.get("stage") or "").strip().lower()
        stage = "cleared" if (raw_stage == "cleared" or (total > 0 and balance <= 0.009)) else "pending"
        lines.append(
            CargoFinanceLine(
                id=str(entry.get("id") or f"fin-{idx + 1}"),
                role=entry.get("role") or "Supplier",
                party_name=str(entry.get("party_name") or "—"),
                doc_no=str(entry.get("doc_no") or "—"),
                payment_terms=entry.get("payment_terms"),
                attachment_url=entry.get("attachment_url"),
                attachment_name=entry.get("attachment_name"),
                currency=currency,  # type: ignore[arg-type]
                total_amount=total,
                paid_amount=paid,
                balance_amount=balance,
                due_date=_parse_date_safe(entry.get("due_date")),
                stage=stage,  # type: ignore[arg-type]
                source_module=entry.get("source_module"),
                source_record_id=entry.get("source_record_id"),
            )
        )
    return lines


def _parse_product_lines(raw_list: list[dict[str, Any]] | None) -> list[CargoProductLine]:
    if not raw_list:
        return []
    lines: list[CargoProductLine] = []
    for idx, entry in enumerate(raw_list, start=1):
        if not isinstance(entry, dict):
            continue
        lines.append(
            CargoProductLine(
                sr_no=int(entry.get("sr_no") or idx),
                product_name=str(entry.get("product_name") or "—"),
                product_code=entry.get("product_code"),
                hsn_code=entry.get("hsn_code"),
                quantity=float(entry.get("quantity") or 0.0),
                uom=str(entry.get("uom") or "PCS"),
                batch_no=entry.get("batch_no"),
                supplier_name=entry.get("supplier_name"),
                source_doc_no=entry.get("source_doc_no"),
            )
        )
    return lines


class CargoOverviewService:
    """Service managing Cargo Overview queries, overlays, gallery documents, and checklists."""

    def __init__(
        self,
        session: AsyncSession,
        extractor: CargoDataExtractor | None = None,
    ) -> None:
        self.session = session
        self.extractor = extractor or CargoDataExtractor()

    async def _get_by_key(self, consignment_key: str) -> CargoOverview | None:
        norm_key = normalize_consignment_key(consignment_key)
        stmt = select(CargoOverview).where(
            CargoOverview.deleted_at.is_(None),
            func.upper(func.trim(CargoOverview.consignment_key)) == norm_key,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _get_or_create_by_key(self, consignment_key: str) -> CargoOverview:
        norm_key = normalize_consignment_key(consignment_key)
        existing = await self._get_by_key(norm_key)
        if existing is not None:
            return existing
        record = CargoOverview(
            id=uuid.uuid4(),
            consignment_key=norm_key,
            display_title=consignment_key.strip(),
            invoice_or_order_no=consignment_key.strip(),
            documents_json={},
            checklist_json={},
            finance_lines_json=[],
            products_json=[],
        )
        self.session.add(record)
        await self.session.flush()
        return record

    def _assemble_row(
        self,
        *,
        norm_key: str,
        extracted: ExtractedCargoRecord | None,
        overlay: CargoOverview | None,
    ) -> CargoOverviewRow:
        stored_docs = dict(overlay.documents_json or {}) if overlay and isinstance(overlay.documents_json, dict) else {}
        stored_checks = dict(overlay.checklist_json or {}) if overlay and isinstance(overlay.checklist_json, dict) else {}

        documents = _build_documents(
            stored_docs,
            extracted.auto_linked_docs if extracted else None,
        )
        checklist = _build_checklist(stored_checks)

        finance_rows: list[CargoFinanceLine] = []
        if extracted and extracted.finance_rows:
            finance_rows = list(extracted.finance_rows)
        elif overlay and overlay.finance_lines_json:
            finance_rows = _parse_finance_lines(overlay.finance_lines_json)

        products: list[CargoProductLine] = []
        if extracted and extracted.products:
            products = list(extracted.products)
        elif overlay and overlay.products_json:
            products = _parse_product_lines(overlay.products_json)

        display_title = (
            (overlay.display_title if overlay and overlay.display_title else None)
            or (extracted.display_title if extracted else None)
            or norm_key
        )
        invoice_summary = (
            (overlay.invoice_or_order_no if overlay and overlay.invoice_or_order_no else None)
            or (extracted.invoice_or_order_summary if extracted else None)
            or display_title
        )
        batch_no = (
            (overlay.batch_no if overlay and overlay.batch_no else None)
            or (extracted.batch_no if extracted else None)
        )
        supplier_summary = (
            (overlay.supplier_name if overlay and overlay.supplier_name else None)
            or (extracted.supplier_summary if extracted else None)
            or "—"
        )
        warehouse = (
            (overlay.warehouse if overlay and overlay.warehouse else None)
            or (extracted.warehouse if extracted else None)
        )
        ordered_date = (
            (overlay.ordered_date if overlay and overlay.ordered_date else None)
            or (extracted.ordered_date if extracted else None)
        )
        etd_date = (
            (overlay.etd_origin_date if overlay and overlay.etd_origin_date else None)
            or (extracted.etd_origin_date if extracted else None)
        )
        eta_date = (
            (overlay.eta_port_date if overlay and overlay.eta_port_date else None)
            or (extracted.eta_port_date if extracted else None)
        )
        arrival_date = (
            (overlay.expected_arrival_date if overlay and overlay.expected_arrival_date else None)
            or (extracted.expected_arrival_date if extracted else None)
        )
        forwarder_name = (
            (overlay.forwarder_name if overlay and overlay.forwarder_name else None)
            or (extracted.forwarder_name if extracted else None)
        )
        clearing_agent_name = (
            (overlay.clearing_agent_name if overlay and overlay.clearing_agent_name else None)
            or (extracted.clearing_agent_name if extracted else None)
        )

        pi_slot = next((d for d in documents if d.slot_key == "proforma_invoice"), None)
        overall_stage: Any = (
            "cleared"
            if finance_rows and all(f.stage == "cleared" for f in finance_rows)
            else "pending"
        )

        return CargoOverviewRow(
            consignment_key=norm_key,
            display_title=display_title,
            invoice_or_order_summary=invoice_summary,
            batch_no=batch_no,
            supplier_summary=supplier_summary,
            warehouse=warehouse,
            ordered_date=ordered_date,
            etd_origin_date=etd_date,
            eta_port_date=eta_date,
            expected_arrival_date=arrival_date,
            forwarder_name=forwarder_name,
            clearing_agent_name=clearing_agent_name,
            cargo_remarks=overlay.cargo_remarks if overlay else None,
            source_module=(overlay.source_module if overlay else None) or (extracted.source_module if extracted else None),
            source_record_id=(
                str(overlay.source_record_id)
                if overlay and overlay.source_record_id
                else (extracted.source_record_id if extracted else None)
            ),
            pi_file_url=pi_slot.file_url if pi_slot else None,
            overall_stage=overall_stage,
            docs_uploaded_count=sum(1 for d in documents if d.file_url),
            docs_total_count=len(CARGO_DOC_SLOTS),
            checklist_yes_count=sum(1 for c in checklist if c.value),
            checklist_total_count=len(CARGO_CHECKLIST_ITEMS),
            finance_rows=finance_rows,
            documents=documents,
            checklist=checklist,
            products=products,
        )

    async def list_overviews(
        self,
        *,
        stage: str = "all",
        warehouse: str | None = None,
        search: str | None = None,
    ) -> CargoOverviewListResponse:
        overlay_rows = (
            await self.session.execute(
                select(CargoOverview).where(CargoOverview.deleted_at.is_(None))
            )
        ).scalars().all()
        overlay_map: dict[str, CargoOverview] = {
            normalize_consignment_key(r.consignment_key): r for r in overlay_rows
        }

        extracted_rows = await self.extractor.extract_all(self.session)
        extracted_map: dict[str, ExtractedCargoRecord] = {
            normalize_consignment_key(r.consignment_key): r for r in extracted_rows
        }

        # Active warehouses from Warehouse master + any warehouse referenced on records
        wh_rows = (
            await self.session.execute(
                select(Warehouse.name)
                .where(
                    Warehouse.deleted_at.is_(None),
                    Warehouse.status == RecordStatus.ACTIVE,
                )
                .order_by(Warehouse.name.asc())
            )
        ).scalars().all()
        warehouse_set: list[str] = []
        seen_wh: set[str] = set()
        for name in wh_rows:
            clean = (name or "").strip()
            if clean and clean.lower() not in seen_wh:
                warehouse_set.append(clean)
                seen_wh.add(clean.lower())

        all_keys = list(dict.fromkeys([*extracted_map.keys(), *overlay_map.keys()]))
        all_items: list[CargoOverviewRow] = []

        for key in all_keys:
            row = self._assemble_row(
                norm_key=key,
                extracted=extracted_map.get(key),
                overlay=overlay_map.get(key),
            )
            if row.warehouse and row.warehouse.strip().lower() not in seen_wh:
                warehouse_set.append(row.warehouse.strip())
                seen_wh.add(row.warehouse.strip().lower())

            if warehouse and warehouse.strip() and warehouse.strip().lower() != "all":
                if (row.warehouse or "").strip().lower() != warehouse.strip().lower():
                    continue

            if search and search.strip():
                q = search.strip().lower()
                hay = " ".join(
                    filter(
                        None,
                        [
                            row.consignment_key,
                            row.display_title,
                            row.invoice_or_order_summary,
                            row.batch_no,
                            row.supplier_summary,
                            row.warehouse,
                            row.forwarder_name,
                            row.clearing_agent_name,
                            row.cargo_remarks,
                        ],
                    )
                ).lower()
                if q not in hay:
                    continue

            all_items.append(row)

        all_items.sort(
            key=lambda x: (x.ordered_date or date(1970, 1, 1), x.display_title),
            reverse=True,
        )

        total_count = len(all_items)
        pending_count = sum(1 for x in all_items if x.overall_stage == "pending")
        cleared_count = sum(1 for x in all_items if x.overall_stage == "cleared")

        norm_stage = (stage or "all").strip().lower()
        if norm_stage in ("pending", "cleared"):
            filtered = [x for x in all_items if x.overall_stage == norm_stage]
        else:
            filtered = all_items

        return CargoOverviewListResponse(
            total_consignments=total_count,
            pending_consignments=pending_count,
            cleared_consignments=cleared_count,
            warehouses=warehouse_set,
            items=filtered,
        )

    async def get_overview(self, consignment_key: str) -> CargoOverviewRow:
        norm_key = normalize_consignment_key(consignment_key)
        res = await self.list_overviews(stage="all")
        for item in res.items:
            if normalize_consignment_key(item.consignment_key) == norm_key:
                return item
        raise NotFoundException(f"Cargo overview for consignment '{consignment_key}' not found.")

    async def upsert_overview(
        self,
        payload: CargoOverviewCreatePayload,
        *,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> CargoOverviewRow:
        norm_key = normalize_consignment_key(payload.consignment_key)
        record = await self._get_or_create_by_key(norm_key)

        record.display_title = (payload.display_title or payload.consignment_key).strip()
        record.invoice_or_order_no = (payload.invoice_or_order_no or record.display_title).strip()
        record.batch_no = payload.batch_no
        record.supplier_name = payload.supplier_name
        record.warehouse = payload.warehouse
        record.ordered_date = payload.ordered_date
        record.etd_origin_date = payload.etd_origin_date
        record.eta_port_date = payload.eta_port_date
        record.expected_arrival_date = payload.expected_arrival_date
        record.forwarder_name = payload.forwarder_name
        record.clearing_agent_name = payload.clearing_agent_name
        record.cargo_remarks = payload.cargo_remarks
        if payload.finance_lines is not None:
            record.finance_lines_json = [f.model_dump(mode="json") for f in payload.finance_lines]
        if payload.products is not None:
            record.products_json = [p.model_dump(mode="json") for p in payload.products]
        record.updated_by_id = user_id
        record.updated_by_name = user_name

        await self.session.flush()
        return await self.get_overview(norm_key)

    async def update_cargo_status(
        self,
        *,
        consignment_key: str,
        payload: CargoChecklistUpdatePayload,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        record = await self._get_or_create_by_key(consignment_key)

        existing: dict[str, bool] = dict(record.checklist_json or {}) if isinstance(record.checklist_json, dict) else {}
        valid_keys = {k for k, _ in CARGO_CHECKLIST_ITEMS}
        if payload.checklist is not None:
            for k, v in payload.checklist.items():
                if k not in valid_keys:
                    raise BadRequestException(f"Unsupported checklist item key: {k}")
                existing[k] = bool(v)
            record.checklist_json = existing

        fields = payload.model_dump(exclude_unset=True)
        for field_name in (
            "cargo_remarks",
            "etd_origin_date",
            "eta_port_date",
            "expected_arrival_date",
            "forwarder_name",
            "clearing_agent_name",
            "batch_no",
        ):
            if field_name in fields:
                setattr(record, field_name, getattr(payload, field_name))

        record.updated_by_id = user_id
        record.updated_by_name = user_name
        await self.session.flush()

        return {
            "consignment_key": record.consignment_key,
            "checklist": existing,
            "cargo_remarks": record.cargo_remarks,
            "etd_origin_date": record.etd_origin_date.isoformat() if record.etd_origin_date else None,
            "eta_port_date": record.eta_port_date.isoformat() if record.eta_port_date else None,
            "expected_arrival_date": (
                record.expected_arrival_date.isoformat() if record.expected_arrival_date else None
            ),
            "forwarder_name": record.forwarder_name,
            "clearing_agent_name": record.clearing_agent_name,
            "batch_no": record.batch_no,
        }

    async def upload_document(
        self,
        *,
        consignment_key: str,
        slot_key: str,
        file_bytes: bytes,
        filename: str,
        content_type: str | None = None,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> CargoDocumentSlot:
        valid_slots = dict(CARGO_DOC_SLOTS)
        if slot_key not in valid_slots:
            raise BadRequestException(f"Unsupported document slot: {slot_key}")

        safe_name = sanitize_filename(filename or f"{slot_key}.pdf")
        safe_key = re.sub(r"[^A-Za-z0-9_-]", "_", consignment_key.strip())
        storage_filename = f"cargo_{safe_key}_{slot_key}_{safe_name}"

        public_url, _ = await save_uploaded_file(
            content=file_bytes,
            original_filename=storage_filename,
            bucket=CARGO_STORAGE_BUCKET,
            local_subfolder=CARGO_LOCAL_SUBFOLDER,
            content_type=content_type or "application/octet-stream",
        )

        record = await self._get_or_create_by_key(consignment_key)
        existing_docs = dict(record.documents_json or {}) if isinstance(record.documents_json, dict) else {}

        old_entry = existing_docs.get(slot_key)
        if isinstance(old_entry, dict) and old_entry.get("url"):
            await delete_stored_file(
                str(old_entry["url"]),
                allowed_buckets={CARGO_STORAGE_BUCKET},
                allowed_local_subfolders={CARGO_LOCAL_SUBFOLDER},
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        existing_docs[slot_key] = {
            "url": public_url,
            "filename": filename or safe_name,
            "uploaded_at": now_iso,
            "uploaded_by": user_name or "Admin",
        }
        record.documents_json = existing_docs
        record.updated_by_id = user_id
        record.updated_by_name = user_name
        await self.session.flush()

        return CargoDocumentSlot(
            slot_key=slot_key,
            label=valid_slots[slot_key],
            file_url=public_url,
            filename=filename or safe_name,
            uploaded_at=now_iso,
            uploaded_by=user_name or "Admin",
            is_auto_linked=False,
        )

    async def delete_document(
        self,
        *,
        consignment_key: str,
        slot_key: str,
        user_id: uuid.UUID | None = None,
        user_name: str | None = None,
    ) -> dict[str, Any]:
        valid_slots = dict(CARGO_DOC_SLOTS)
        if slot_key not in valid_slots:
            raise BadRequestException(f"Unsupported document slot: {slot_key}")

        record = await self._get_or_create_by_key(consignment_key)
        existing_docs = dict(record.documents_json or {}) if isinstance(record.documents_json, dict) else {}
        removed = existing_docs.pop(slot_key, None)
        if isinstance(removed, dict) and removed.get("url"):
            await delete_stored_file(
                str(removed["url"]),
                allowed_buckets={CARGO_STORAGE_BUCKET},
                allowed_local_subfolders={CARGO_LOCAL_SUBFOLDER},
            )

        record.documents_json = existing_docs
        record.updated_by_id = user_id
        record.updated_by_name = user_name
        await self.session.flush()
        return {"deleted": True, "slot_key": slot_key, "consignment_key": record.consignment_key}

    async def export_csv(
        self,
        *,
        stage: str = "all",
        warehouse: str | None = None,
        search: str | None = None,
    ) -> bytes:
        data = await self.list_overviews(stage=stage, warehouse=warehouse, search=search)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Consignment Key",
            "Invoice / Cons. No.",
            "Supplier Name",
            "Batch No.",
            "Warehouse",
            "Ordered Date",
            "ETD Origin",
            "ETA Port",
            "Expected Arrival",
            "Forwarder Name",
            "Clearing Agent",
            "Gallery Docs",
            "Checklist Progress",
            "Finance Status",
            "Cargo Remark",
        ])
        for row in data.items:
            writer.writerow([
                row.consignment_key,
                row.invoice_or_order_summary,
                row.supplier_summary,
                row.batch_no or "",
                row.warehouse or "",
                row.ordered_date.isoformat() if row.ordered_date else "",
                row.etd_origin_date.isoformat() if row.etd_origin_date else "",
                row.eta_port_date.isoformat() if row.eta_port_date else "",
                row.expected_arrival_date.isoformat() if row.expected_arrival_date else "",
                row.forwarder_name or "",
                row.clearing_agent_name or "",
                f"{row.docs_uploaded_count}/{row.docs_total_count}",
                f"{row.checklist_yes_count}/{row.checklist_total_count}",
                row.overall_stage.title(),
                row.cargo_remarks or "",
            ])
        return buf.getvalue().encode("utf-8-sig")
