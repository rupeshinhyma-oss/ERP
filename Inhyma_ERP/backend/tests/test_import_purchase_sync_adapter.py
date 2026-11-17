"""Unit & lifecycle tests for Yinglima -> Inhyma ImportPurchase synchronization."""

from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.common.currency import get_usd_to_inr_rate
from app.integration.adapters.import_purchase import (
    ImportPurchaseSyncAdapter,
    resolve_inhyma_warehouse_name,
)
from app.integration.sync_engine import GenericSyncEngine
from app.purchase.models import ImportPurchase


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


def test_warehouse_branch_mapping() -> None:
    assert resolve_inhyma_warehouse_name({"branch_name": "Inhyma Mumbai", "buyer_name": "Inhyma"}) == "Mumbai Ordered"
    assert resolve_inhyma_warehouse_name({"branch_name": "GJ Branch", "buyer_name": "Inhyma Ahmedabad"}) == "Ahmedabad Ordered"
    assert resolve_inhyma_warehouse_name({"branch_name": "Indore Branch", "buyer_name": "Inhyma"}) == "Indore Ordered"
    assert resolve_inhyma_warehouse_name({"consignment_code": "GJ15", "buyer_name": "Inhyma"}) == "Ahmedabad Ordered"
    assert resolve_inhyma_warehouse_name({"consignment_code": "Mum 51", "buyer_name": "Inhyma"}) == "Mumbai Ordered"


@pytest.mark.asyncio
async def test_daily_fx_rate_returns_positive_inr() -> None:
    rate = await get_usd_to_inr_rate()
    assert rate > 50.0


def test_sync_engine_registers_import_purchase_adapter_and_policy() -> None:
    engine = GenericSyncEngine()
    assert "import_purchase" in engine._adapters
    policy = engine.get_policy("yinglima", "import_purchase")
    assert policy.direction == "SOURCE_TO_TARGET"
    assert policy.delete_strategy == "PROPAGATE_DELETE"
    assert policy.ownership_strategy == "SOURCE_AUTHORITATIVE"


@pytest.mark.asyncio
async def test_import_purchase_adapter_create_update_delete_lifecycle() -> None:
    adapter = ImportPurchaseSyncAdapter()
    sup = SimpleNamespace(id=uuid.uuid4(), company_name="Yinglima Packaging Machinery Co., Ltd.")
    wh = SimpleNamespace(name="Mumbai Ordered")

    added_records: list[ImportPurchase] = []
    session = MagicMock()
    session.add = MagicMock(side_effect=lambda obj: added_records.append(obj))
    session.flush = AsyncMock()

    # 1. Create: supplier lookup, warehouse lookup, product lookup (None)
    session.execute = AsyncMock(
        side_effect=[
            _ScalarResult(sup),
            _ScalarResult(wh),
            _ScalarResult(None),
            _ScalarResult(None),
        ]
    )

    payload = {
        "order_no": "SO-YLM/26-27/0999",
        "consignment_code": "Mum 99",
        "buyer_name": "Inhyma",
        "branch_name": "Inhyma Mumbai",
        "order_date": date.today().isoformat(),
        "etd_origin_date": "2026-11-20",
        "eta_port_date": "2026-12-10",
        "total_cbm": 12.5,
        "total_amount_usd": 5000.0,
        "conversion_rate": 85.0,
        "items": [
            {
                "product_name": "Bottle Filler 200ml",
                "product_code": "BF-200",
                "quantity": 10.0,
                "unit_price_usd": 500.0,
                "pkg_unit_cbm": 1.25,
                "pkg_qty": 1.0,
            }
        ],
    }

    local_id, ver = await adapter.apply_create(session, payload, "yinglima")
    assert ver == 1
    assert len(added_records) == 1
    rec = added_records[0]
    rec.id = local_id or uuid.uuid4()
    rec.version = 1
    assert rec.status == "pending"
    assert rec.stock_applied is False
    assert rec.warehouse == "Mumbai Ordered"
    assert rec.consignment_no == "Mum 99"
    assert rec.supplier_name == "Yinglima Packaging Machinery Co., Ltd."
    assert rec.invoice_total_usd == 5000.0
    assert rec.invoice_total_inr == 425000.0
    assert len(rec.items) == 1

    # 2. Revert / Cancel -> soft-deletes pending ImportPurchase
    session.execute = AsyncMock(return_value=_ScalarResult(rec))
    await adapter.apply_delete(session, rec.id, "PROPAGATE_DELETE")
    assert rec.status == "cancelled"
    assert rec.deleted_at is not None

    # 3. Re-Confirm after revert -> restores to pending and updates
    session.execute = AsyncMock(
        side_effect=[
            _ScalarResult(rec),
            _ScalarResult(wh),
            _ScalarResult(None),
            _ScalarResult(None),
        ]
    )
    await adapter.apply_update(session, rec.id, {**payload, "consignment_code": "Mum 100"})
    assert rec.deleted_at is None
    assert rec.status == "pending"
    assert rec.consignment_no == "Mum 100"

    # 4. Protection: if already confirmed in Inhyma, delete must NOT remove it
    rec.status = "confirmed"
    session.execute = AsyncMock(return_value=_ScalarResult(rec))
    await adapter.apply_delete(session, rec.id, "PROPAGATE_DELETE")
    assert rec.deleted_at is None
    assert rec.status == "confirmed"
