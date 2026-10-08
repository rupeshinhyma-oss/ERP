"""The Company/CompanyContact migration adds exactly the new columns, idempotently, and seeds
the option lists the Add Company spec needs (Business Type, Business Category, Monthly Turnover,
Potential Business per month, Direct Import from China, Monthly Import Volume)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.companies.models import Company, CompanyContact
from app.database.base import Base
from app.masters.option_lists.models import OptionList


def _import_all_models() -> None:
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(root).with_suffix("").parts))


_import_all_models()

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"

NEW_COMPANY_COLUMNS = {
    "monthly_turnover", "potential_business_per_month", "direct_import_from_china",
    "monthly_import_volume", "products_needed_for_imports",
}
NEW_CONTACT_COLUMNS = {"birth_date", "anniversary_date"}

EXPECTED_GROUPS = {
    "company.business_type": {"B2B", "B2C"},
    "company.business_category": {"Manufacturer", "Trader"},
    "company.monthly_turnover": {"0-25 L", "25-50 L", "50-100 L", "100-200 L", "Above 200 Lakhs"},
    "company.potential_business_per_month": {"0-2 L", "2-5 L", "5-10 L", "10-20 L", "Above 20 Lakhs"},
    "company.direct_import_from_china": {"Yes", "No"},
    "company.monthly_import_volume": {"10-25 L", "25-50 L", "Above 50 L"},
}


def _run(sync_conn, filename: str) -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        module.upgrade()


@pytest.mark.asyncio
async def test_column_migration_adds_the_new_fields_and_is_idempotent():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Company.__table__, CompanyContact.__table__]))
        await conn.run_sync(_run, "n1a2b3c4d5eb_extend_company_profile.py")
        await conn.run_sync(_run, "n1a2b3c4d5eb_extend_company_profile.py")  # idempotent
        company_cols = await conn.run_sync(lambda c: {x["name"] for x in sa.inspect(c).get_columns("companies")})
        contact_cols = await conn.run_sync(lambda c: {x["name"] for x in sa.inspect(c).get_columns("company_contacts")})
    await engine.dispose()
    assert NEW_COMPANY_COLUMNS <= company_cols
    assert NEW_CONTACT_COLUMNS <= contact_cols


@pytest.mark.asyncio
async def test_seed_migration_adds_every_expected_option_and_is_idempotent():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[OptionList.__table__]))
        await conn.run_sync(_run, "o1a2b3c4d5ec_seed_company_option_lists.py")
        await conn.run_sync(_run, "o1a2b3c4d5ec_seed_company_option_lists.py")  # idempotent, no duplicates
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        rows = (await s.execute(sa.select(OptionList).where(OptionList.group_key.in_(EXPECTED_GROUPS)))).scalars().all()
    await engine.dispose()
    by_group: dict[str, set[str]] = {}
    for r in rows:
        by_group.setdefault(r.group_key, set()).add(r.value)
    assert by_group == EXPECTED_GROUPS
    keys = [(r.group_key, r.value) for r in rows]
    assert len(keys) == len(set(keys))  # no duplicates from running it twice
