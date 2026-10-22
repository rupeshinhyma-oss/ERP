import pytest
from app.planning.service import (
    mum_num_from_column_name,
    _mum_derived_kind_and_group,
    _is_pure_mum_column,
)
from app.database.engine import get_sessionmaker
from sqlalchemy import select
from app.planning.models import PlanningSheet, PlanningColumn, PlanningColumnSourceType


def test_label_parsing_with_hyphens_and_leading_zeros():
    # MP -06 / MP 6
    assert mum_num_from_column_name("MP -06", label="MP") == 6
    assert mum_num_from_column_name("MP-06", label="MP") == 6
    assert mum_num_from_column_name("MP 06", label="MP") == 6
    assert mum_num_from_column_name("MP 6", label="MP") == 6
    assert _is_pure_mum_column("MP -06", label="MP") is True
    assert _mum_derived_kind_and_group("NO. OF PKG MP6", label="MP") == ("pkg_count", 6)
    assert _mum_derived_kind_and_group("TOTAL WEIGHT MP6", label="MP") == ("total_weight", 6)
    assert _mum_derived_kind_and_group("TOTAL CBM MP6", label="MP") == ("total_cbm", 6)

    # GJ14 / GJ 16
    assert mum_num_from_column_name("GJ14", label="GJ") == 14
    assert mum_num_from_column_name("GJ 16", label="GJ") == 16
    assert _mum_derived_kind_and_group("NO. OF PKG GJ14", label="GJ") == ("pkg_count", 14)
    assert _mum_derived_kind_and_group("TOTAL WEIGHT GJ15", label="GJ") == ("total_weight", 15)
    assert _mum_derived_kind_and_group("TOTAL CBM GJ16", label="GJ") == ("total_cbm", 16)

    # Mum 48
    assert mum_num_from_column_name("Mum 48", label="Mum") == 48
    assert _mum_derived_kind_and_group("NO. OF PKG MUM48", label="Mum") == ("pkg_count", 48)


@pytest.mark.asyncio
async def test_all_database_sheets_have_no_duplicate_manual_spec_columns():
    sm = get_sessionmaker()
    async with sm() as session:
        sheets = (await session.execute(select(PlanningSheet))).scalars().all()
        for s in sheets:
            cols = (await session.execute(
                select(PlanningColumn).where(PlanningColumn.sheet_id == s.id)
            )).scalars().all()

            # Ensure no manual duplicate packaging/spec columns exist
            manual_spec_cols = [
                c.name for c in cols
                if c.source_type == PlanningColumnSourceType.MANUAL
                and c.name.strip().upper() in ["PKG QTY", "UNIT WEIGHT/PKG (KG)", "CBM/PKG (KG)", "SUPPLIER CITY"]
            ]
            assert not manual_spec_cols, f"Sheet '{s.name}' contains duplicate manual spec cols: {manual_spec_cols}"
