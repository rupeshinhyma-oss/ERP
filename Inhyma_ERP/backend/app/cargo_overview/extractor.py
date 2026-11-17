"""Pluggable data-extraction layer for Cargo Overview.

This module intentionally decouples source-module extraction from the Cargo
Overview persistence, API, and UI layers. Once source module rules (such as
Import Purchase, Shipment Planning, Financial Planning, or Sales Process) are
configured, ``CargoDataExtractor.extract_all`` emits normalized
``ExtractedCargoRecord`` entries that ``CargoOverviewService`` merges with
persistent ``cargo_overviews`` records.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.cargo_overview.schemas import CargoFinanceLine, CargoProductLine


@dataclass
class ExtractedCargoRecord:
    """Normalized consignment payload emitted by an upstream ERP source module."""

    consignment_key: str
    display_title: str
    invoice_or_order_summary: str
    source_module: str | None = None
    source_record_id: str | None = None
    batch_no: str | None = None
    supplier_summary: str = "—"
    warehouse: str | None = None
    ordered_date: date | None = None
    etd_origin_date: date | None = None
    eta_port_date: date | None = None
    expected_arrival_date: date | None = None
    forwarder_name: str | None = None
    clearing_agent_name: str | None = None
    auto_linked_docs: dict[str, dict[str, Optional[str]]] = field(default_factory=dict)
    finance_rows: list[CargoFinanceLine] = field(default_factory=list)
    products: list[CargoProductLine] = field(default_factory=list)


class CargoDataExtractor:
    """Adapter responsible for pulling live consignment data from upstream modules."""

    async def extract_all(self, session: AsyncSession) -> list[ExtractedCargoRecord]:
        """Return live extracted consignment records (wire source modules here)."""
        _ = session
        return []
