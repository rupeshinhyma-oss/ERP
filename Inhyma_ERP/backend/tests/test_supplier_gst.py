"""Supplier spec rules: GST is mandatory, stored upper-case, and a duplicate GST is refused."""

from __future__ import annotations

import importlib
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ConflictException
from app.database.base import Base
from app.suppliers.models import Supplier
from app.suppliers.repository import SupplierRepository
from app.suppliers.schemas import SupplierCreate, SupplierUpdate
from app.suppliers.service import SupplierService


def _import_all_models() -> None:
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(root).with_suffix("").parts))


_import_all_models()


def _create_kwargs(**over):
    base = {
        "company_name": "Yinglima Import & Export",
        "country_id": uuid.uuid4(),
        "state_id": uuid.uuid4(),
        "city_id": uuid.uuid4(),
        "tax_id_number": "27abcde1234f1z5",
        "contact_calling_number": "9876543210",
    }
    base.update(over)
    return base


# ------------------------------------------------------------------ schema
def test_create_requires_a_gst_number():
    kwargs = _create_kwargs()
    del kwargs["tax_id_number"]
    with pytest.raises(ValidationError):
        SupplierCreate(**kwargs)


def test_create_rejects_blank_gst_and_normalises_case_and_spaces():
    with pytest.raises(ValidationError):
        SupplierCreate(**_create_kwargs(tax_id_number="   "))
    assert SupplierCreate(**_create_kwargs(tax_id_number="  27abcde1234f1z5 ")).tax_id_number == "27ABCDE1234F1Z5"


def test_update_may_omit_gst_but_not_blank_it():
    assert SupplierUpdate().tax_id_number is None                      # editing other fields is not blocked
    assert SupplierUpdate(tax_id_number="29aaaaa0000a1z5").tax_id_number == "29AAAAA0000A1Z5"
    with pytest.raises(ValidationError):
        SupplierUpdate(tax_id_number="  ")


# ------------------------------------------------------------------ repository + service
@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Supplier.__table__]))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _add(session, name: str, gst: str | None, deleted: bool = False) -> Supplier:
    sup = Supplier(company_name=name, country_id=uuid.uuid4(), state_id=uuid.uuid4(), city_id=uuid.uuid4(), tax_id_number=gst)
    if deleted:
        sup.deleted_at = datetime.now(timezone.utc)
    session.add(sup)
    await session.flush()
    return sup


@pytest.mark.asyncio
async def test_tax_id_exists_is_case_insensitive_and_ignores_deleted_and_self(session):
    keep = await _add(session, "Alpha", "27ABCDE1234F1Z5")
    await _add(session, "Gone", "99ZZZZZ9999Z9Z9", deleted=True)
    repo = SupplierRepository(session)

    assert await repo.tax_id_exists("27abcde1234f1z5") is True               # case-insensitive
    assert await repo.tax_id_exists(" 27ABCDE1234F1Z5 ") is True              # trimmed
    assert await repo.tax_id_exists("27ABCDE1234F1Z5", exclude_id=keep.id) is False   # editing itself is fine
    assert await repo.tax_id_exists("99ZZZZZ9999Z9Z9") is False               # soft-deleted suppliers do not count
    assert await repo.tax_id_exists("11NEWNEW0000N1Z1") is False


@pytest.mark.asyncio
async def test_service_refuses_a_duplicate_gst_with_an_already_exists_message(session):
    other = await _add(session, "Alpha", "27ABCDE1234F1Z5")
    mine = await _add(session, "Beta", "29AAAAA0000A1Z5")
    service = SupplierService.__new__(SupplierService)
    service.repository = SupplierRepository(session)

    with pytest.raises(ConflictException, match="already exists"):
        await service._ensure_tax_id_unique("27abcde1234f1z5")                      # create with someone else's GST
    with pytest.raises(ConflictException, match="already exists"):
        await service._ensure_tax_id_unique(other.tax_id_number, exclude_id=mine.id)  # update to someone else's GST
    await service._ensure_tax_id_unique(mine.tax_id_number, exclude_id=mine.id)       # keeping your own is fine
    await service._ensure_tax_id_unique(None)                                          # nothing to check


# ------------------------------------------------------------------ calling number (spec)
def test_create_requires_a_calling_number():
    base = _create_kwargs()
    del base["contact_calling_number"]
    with pytest.raises(ValidationError):
        SupplierCreate(**base)


def test_create_rejects_a_blank_calling_number_and_validates_its_format():
    with pytest.raises(ValidationError):
        SupplierCreate(**_create_kwargs(contact_calling_number="   "))
    with pytest.raises(ValidationError):
        SupplierCreate(**_create_kwargs(contact_calling_number="not-a-phone"))
    ok = SupplierCreate(**_create_kwargs(contact_calling_number="9876543210"))
    assert ok.contact_calling_number


def test_update_may_omit_the_calling_number_but_not_blank_it():
    assert SupplierUpdate().contact_calling_number is None
    assert SupplierUpdate(contact_calling_number="9876543210").contact_calling_number
    with pytest.raises(ValidationError):
        SupplierUpdate(contact_calling_number="  ")
