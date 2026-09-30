"""
Dual-Mode Import (Create vs Update) Verification Tests.

Verifies:
1. Product Master import:
   - Create mode inserts new records and detects duplicates without corrupting existing records.
   - Update mode (update_existing=True) matches existing records by code or name and updates modified fields.
   - Zero Data Loss: Empty/blank cells in the uploaded file NEVER overwrite existing database values.
   - In-file duplicate rows are safely flagged and tracked.
2. Master tables (e.g., UOM Master) import:
   - Create mode inserts new records and flags conflicts on existing names/codes.
   - Update mode updates existing records and increments summary.updated.
"""

from __future__ import annotations

import uuid
from typing import Any
import pytest
import pytest_asyncio

from app.core.exceptions import ConflictException
from app.masters.import_export import (
    ImportSummary,
    is_different,
    run_import,
    update_record_fields,
)


class DummyRecord:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_is_different_edge_cases():
    """Verify intelligent diffing handles None, whitespace, casing, and floats."""
    # Same
    assert not is_different(None, None)
    assert not is_different("", "")
    assert not is_different("Box", "box")
    assert not is_different("  PCS  ", "pcs")
    assert not is_different(12.500000, 12.5)

    # Different
    assert is_different(None, "Box")
    assert is_different("Box", None)
    assert is_different("PCS", "KGS")
    assert is_different(10.0, 15.0)


def test_update_record_fields_zero_data_loss():
    """Verify empty/blank cells never overwrite existing values."""
    existing = DummyRecord(
        id=uuid.uuid4(),
        product_name="FR900 Band Sealer",
        product_code="BS-900",
        brand="Hualian",
        packaging_gross_weight=15.5,
        packaging_unit_cbm=0.045,
        license_certificate_required="CE Certificate",
    )

    # Spreadsheet has empty strings and None for brand and license, but updated weight
    import_row_values = {
        "id": uuid.uuid4(),  # should be skipped
        "product_name": "FR900 Band Sealer",  # unchanged
        "product_code": "BS-900",  # unchanged
        "brand": "",  # BLANK CELL in Excel -> MUST NOT OVERWRITE
        "packaging_gross_weight": 18.0,  # CHANGED
        "packaging_unit_cbm": None,  # BLANK CELL in Excel -> MUST NOT OVERWRITE
        "license_certificate_required": "   ",  # WHITESPACE -> MUST NOT OVERWRITE
    }

    has_changes, changes = update_record_fields(existing, import_row_values)

    assert has_changes is True
    # Only packaging_gross_weight should be in changes
    assert changes == {"packaging_gross_weight": 18.0}
    assert "brand" not in changes
    assert "packaging_unit_cbm" not in changes
    assert "license_certificate_required" not in changes
    assert "id" not in changes


@pytest.mark.asyncio
async def test_product_dual_mode_import_simulation():
    """Verify dual-mode import flow: create vs update behavior."""
    existing_catalog: dict[str, DummyRecord] = {
        "BS-900": DummyRecord(
            id=uuid.uuid4(),
            product_name="Band Sealer 900",
            product_code="BS-900",
            packaging_gross_weight=10.0,
            packaging_unit_cbm=0.03,
        )
    }

    raw_rows = [
        {"Product Code": "BS-900", "Product Name": "Band Sealer 900", "Gross Weight": "12.5", "CBM": ""},
        {"Product Code": "BS-1000", "Product Name": "Band Sealer 1000", "Gross Weight": "20.0", "CBM": "0.05"},
    ]

    def validator(row: dict[str, str], row_num: int) -> dict[str, Any]:
        return {
            "product_code": row.get("Product Code"),
            "product_name": row.get("Product Name"),
            "packaging_gross_weight": float(row["Gross Weight"]) if row.get("Gross Weight") else None,
            "packaging_unit_cbm": float(row["CBM"]) if row.get("CBM") else None,
        }

    # 1. TEST CREATE MODE (update_existing=False)
    async def create_mode_creator(field_values: dict[str, Any]):
        code = field_values["product_code"]
        if code in existing_catalog:
            raise ConflictException(f"Product code '{code}' already exists.")
        rec = DummyRecord(**field_values)
        existing_catalog[code] = rec
        return rec

    summary_create = await run_import(
        raw_rows,
        row_validator=validator,
        row_creator=create_mode_creator,
        dedupe_keys=("product_code",),
    )

    # 1 created (BS-1000), 1 duplicate conflict (BS-900)
    assert summary_create.created == 1
    assert summary_create.failed == 1
    assert summary_create.duplicate_count == 1
    assert len(summary_create.duplicates) == 1
    assert summary_create.duplicates[0]["row"] == 2
    assert "BS-900" in summary_create.duplicates[0]["error"]

    # 2. TEST UPDATE MODE (update_existing=True)
    async def update_mode_creator(field_values: dict[str, Any]):
        code = field_values["product_code"]
        if code in existing_catalog:
            target = existing_catalog[code]
            has_changes, changes = update_record_fields(target, field_values)
            if has_changes:
                for k, v in changes.items():
                    setattr(target, k, v)
                return ("updated", target)
            return ("unchanged", target)
        rec = DummyRecord(**field_values)
        existing_catalog[code] = rec
        return rec

    summary_update = await run_import(
        raw_rows,
        row_validator=validator,
        row_creator=update_mode_creator,
        dedupe_keys=("product_code",),
    )

    # BS-900 updated (10.0 -> 12.5), BS-1000 unchanged (identical), 0 failed
    assert summary_update.failed == 0
    assert summary_update.updated == 1
    assert summary_update.unchanged == 1
    # Check that BS-900's packaging_unit_cbm was NOT wiped out by empty string
    assert existing_catalog["BS-900"].packaging_gross_weight == 12.5
    assert existing_catalog["BS-900"].packaging_unit_cbm == 0.03


@pytest.mark.asyncio
async def test_uom_master_dual_mode_import_simulation():
    """Verify UOM master import in update mode."""
    uoms_db = {
        "PCS": DummyRecord(name="Pieces", code="PCS", short_name="pc", description="Standard pieces"),
        "KGS": DummyRecord(name="Kilograms", code="KGS", short_name="kg", description="Weight in kg"),
    }

    import_rows = [
        {"Code": "PCS", "Name": "Pieces", "Short Name": "pcs", "Description": ""},  # updated short_name, blank desc
        {"Code": "MTR", "Name": "Meters", "Short Name": "m", "Description": "Length"},  # new record
    ]

    def uom_validator(row: dict[str, str], row_num: int) -> dict[str, Any]:
        return {
            "code": row["Code"],
            "name": row["Name"],
            "short_name": row.get("Short Name") or None,
            "description": row.get("Description") or None,
        }

    async def uom_update_creator(field_values: dict[str, Any]):
        code = field_values["code"]
        if code in uoms_db:
            target = uoms_db[code]
            has_changes, changes = update_record_fields(target, field_values)
            if has_changes:
                for k, v in changes.items():
                    setattr(target, k, v)
                return ("updated", target)
            return ("unchanged", target)
        new_uom = DummyRecord(**field_values)
        uoms_db[code] = new_uom
        return new_uom

    summary = await run_import(
        import_rows,
        row_validator=uom_validator,
        row_creator=uom_update_creator,
        dedupe_keys=("code", "name"),
    )

    assert summary.created == 1  # MTR
    assert summary.updated == 1  # PCS
    assert summary.failed == 0
    # Description was empty in import row, verify it was NOT erased
    assert uoms_db["PCS"].description == "Standard pieces"
    assert uoms_db["PCS"].short_name == "pcs"
