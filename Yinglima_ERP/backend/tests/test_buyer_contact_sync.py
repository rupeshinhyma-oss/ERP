"""
Tests for Buyer Contact Person Auto-Promotion, Make Primary, and Two-Way Sync.
"""

from __future__ import annotations

import uuid
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.buyers.models import Buyer
from app.buyers.repository import BuyerContactRepository, BuyerRepository
from app.buyers.service import BuyerService
from app.cache.in_memory import InMemoryCacheBackend
from app.cache.manager import CacheManager
from app.database.engine import dispose_engine, get_sessionmaker
from app.masters.countries.models import Country
from app.masters.countries.repository import CountryRepository
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository
from app.masters.states.repository import StateRepository

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()
    await dispose_engine()


@pytest_asyncio.fixture
async def existing_country(db_session):
    stmt = select(Country)
    result = await db_session.execute(stmt)
    country = result.scalars().first()
    if country is None:
        country = Country(name="Uganda", code="UG")
        db_session.add(country)
        await db_session.flush()
    return country


def _make_service(session: AsyncSession) -> BuyerService:
    cache = CacheManager(InMemoryCacheBackend())
    return BuyerService(
        BuyerRepository(session),
        BuyerContactRepository(session),
        CountryRepository(session),
        ProductCategoryRepository(session),
        ProductSubCategoryRepository(session),
        cache,
        StateRepository(session),
    )


class TestBuyerContactSync:
    async def test_first_contact_auto_promotes_and_syncs_to_buyer(self, db_session, existing_country):
        service = _make_service(db_session)
        company_name = f"AutoPromote Co {uuid.uuid4().hex[:6]}"
        buyer = await service.create(
            company_name=company_name,
            country_id=existing_country.id,
        )
        assert buyer.contact_full_name is None
        assert buyer.contact_calling_number is None

        # Add first contact in Tab 2
        contact1 = await service.add_contact(
            buyer.id,
            salutation="Mr.",
            person_name="John Doe",
            designation="Procurement Head",
            calling_number="+256 701234567",
            whatsapp_number="+256 701234567",
            email="john@doe.com",
            country_id=existing_country.id,
        )
        assert contact1.is_primary is True

        # Refresh buyer from DB to verify sync to main profile row
        refreshed_buyer = await service.get_by_id_or_raise(buyer.id)
        assert refreshed_buyer.contact_salutation == "Mr."
        assert refreshed_buyer.contact_full_name == "John Doe"
        assert refreshed_buyer.contact_designation == "Procurement Head"
        assert refreshed_buyer.contact_calling_number == "+256 701234567"
        assert refreshed_buyer.contact_whatsapp_number == "+256 701234567"
        assert any(e.email == "john@doe.com" for e in refreshed_buyer.emails)

    async def test_second_contact_is_secondary_and_make_primary_works(self, db_session, existing_country):
        service = _make_service(db_session)
        company_name = f"MakePrimary Co {uuid.uuid4().hex[:6]}"
        buyer = await service.create(
            company_name=company_name,
            country_id=existing_country.id,
        )

        contact1 = await service.add_contact(
            buyer.id,
            person_name="First Contact",
            calling_number="+256 701111111",
            country_id=existing_country.id,
        )
        assert contact1.is_primary is True

        # Add second contact
        contact2 = await service.add_contact(
            buyer.id,
            person_name="Second Contact",
            calling_number="+256 702222222",
            country_id=existing_country.id,
        )
        assert contact2.is_primary is False

        # Profile is still First Contact
        refreshed = await service.get_by_id_or_raise(buyer.id)
        assert refreshed.contact_full_name == "First Contact"
        assert refreshed.contact_calling_number == "+256 701111111"

        # Promote second contact via set_primary_contact
        promoted = await service.set_primary_contact(buyer.id, contact2.id)
        assert promoted.is_primary is True

        # First contact is demoted
        c1_reloaded = await service.get_contact_or_raise(buyer.id, contact1.id)
        assert c1_reloaded.is_primary is False

        # Profile is now Second Contact
        refreshed_after = await service.get_by_id_or_raise(buyer.id)
        assert refreshed_after.contact_full_name == "Second Contact"
        assert refreshed_after.contact_calling_number == "+256 702222222"

    async def test_update_primary_contact_syncs_to_buyer(self, db_session, existing_country):
        service = _make_service(db_session)
        company_name = f"UpdateSync Co {uuid.uuid4().hex[:6]}"
        buyer = await service.create(
            company_name=company_name,
            country_id=existing_country.id,
            contact_full_name="Initial Name",
            contact_calling_number="+256 709999999",
        )
        primary = await service.contact_repository.get_primary_contact(buyer.id)
        assert primary is not None
        assert primary.person_name == "Initial Name"

        # Update contact person via update_contact
        await service.update_contact(
            buyer.id,
            primary.id,
            person_name="Updated Primary Name",
            calling_number="+256 708888888",
        )

        # Buyer profile must sync
        refreshed = await service.get_by_id_or_raise(buyer.id)
        assert refreshed.contact_full_name == "Updated Primary Name"
        assert refreshed.contact_calling_number == "+256 708888888"

    async def test_clear_primary_contact_clears_buyer_profile_and_deletes_primary(self, db_session, existing_country):
        service = _make_service(db_session)
        company_name = f"ClearSync Co {uuid.uuid4().hex[:6]}"
        buyer = await service.create(
            company_name=company_name,
            country_id=existing_country.id,
            contact_full_name="To Be Cleared",
            contact_calling_number="+256 703333333",
            contact_designation="Manager",
        )
        primary = await service.contact_repository.get_primary_contact(buyer.id)
        assert primary is not None
        assert primary.person_name == "To Be Cleared"

        # Update buyer by clearing contact info
        await service.update(
            buyer.id,
            contact_full_name=None,
            contact_calling_number=None,
            contact_designation=None,
        )

        refreshed = await service.get_by_id_or_raise(buyer.id)
        assert refreshed.contact_full_name is None
        assert refreshed.contact_calling_number is None
        assert refreshed.contact_designation is None

        # Mirrored primary contact should be deleted
        primary_after = await service.contact_repository.get_primary_contact(buyer.id)
        assert primary_after is None

