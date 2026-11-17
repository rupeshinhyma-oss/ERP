"""ORM model for Cargo Overview persistent state and overlays."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Optional

from sqlalchemy import Date, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import (
    Base,
    GUID,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
)


class CargoOverview(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    Persistent Cargo Overview record keyed by normalized ``consignment_key``.

    Stores Consignment Gallery document uploads, Cargo Status shipment checklist
    toggles (Yes/No), cargo remarks, shipment ETD/ETA/forwarder/clearing-agent
    metadata, and optional standalone/overlay Finance Planning & Product Summary
    records alongside live data pulled via ``app.cargo_overview.extractor``.
    """

    __tablename__ = "cargo_overviews"

    consignment_key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    source_module: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    source_record_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), nullable=True, index=True)

    display_title: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    invoice_or_order_no: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    batch_no: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    supplier_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    warehouse: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)

    ordered_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    etd_origin_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    eta_port_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expected_arrival_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    forwarder_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    clearing_agent_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    cargo_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    documents_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    checklist_json: Mapped[Optional[dict[str, bool]]] = mapped_column(JSON, nullable=True)
    finance_lines_json: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    products_json: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)

    updated_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), nullable=True)
    updated_by_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)

    def __repr__(self) -> str:
        return f"<CargoOverview consignment_key={self.consignment_key!r} warehouse={self.warehouse!r}>"
