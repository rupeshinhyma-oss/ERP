"""
Unit tests for Supplier Contact Person Auto-Promotion, Make Primary, and Two-Way Sync.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock
import pytest

from app.core.exceptions import ConflictException
from app.suppliers.models import Supplier, SupplierContact
from app.suppliers.schemas import SupplierContactCreate, SupplierContactUpdate
from app.suppliers.service import SupplierService


def test_supplier_contact_schemas_support_is_primary():
    create_payload = SupplierContactCreate(
        person_name="Om Patil",
        calling_number="+86 13800138000",
        is_primary=True,
    )
    assert create_payload.is_primary is True

    update_payload = SupplierContactUpdate(
        person_name="Om Patil Updated",
        is_primary=True,
    )
    assert update_payload.is_primary is True


@pytest.mark.asyncio
async def test_add_contact_auto_promotes_first_contact_and_syncs_to_supplier():
    repo = MagicMock()
    contact_repo = MagicMock()
    country_repo = MagicMock()
    cache_manager = MagicMock()
    cache_manager.invalidate_dropdown = AsyncMock()
    cache_manager.invalidate_pattern = AsyncMock()

    service = SupplierService(
        repository=repo,
        contact_repository=contact_repo,
        country_repository=country_repo,
        state_repository=MagicMock(),
        city_repository=MagicMock(),
        category_repository=MagicMock(),
        sub_category_repository=MagicMock(),
        product_repository=MagicMock(),
        cache_manager=cache_manager,
    )

    supplier_id = uuid.uuid4()
    mock_supplier = Supplier(
        id=supplier_id,
        company_name="Test Supplier Co",
        contact_full_name=None,
        contact_calling_number=None,
    )
    mock_supplier.emails = []

    repo.get_with_relations = AsyncMock(return_value=mock_supplier)
    repo.get_by_id = AsyncMock(return_value=mock_supplier)
    repo.update = AsyncMock()
    repo.replace_emails = AsyncMock()
    repo.session = MagicMock()
    repo.session.refresh = AsyncMock()

    # No existing primary contact
    contact_repo.get_primary_contact = AsyncMock(return_value=None)

    created_contact = SupplierContact(
        id=uuid.uuid4(),
        supplier_id=supplier_id,
        person_name="Om Patil",
        is_primary=True,
    )
    contact_repo.create = AsyncMock(return_value=created_contact)

    result = await service.add_contact(
        supplier_id,
        salutation="Mr.",
        person_name="Om Patil",
        designation="Sales Manager",
        calling_number="+86 13800138000",
        whatsapp_number="+86 13800138000",
        wechat_number="om_wechat",
        email="om.inhyma@gmail.com",
    )

    assert result.is_primary is True
    # Verify contact_repo.create was called with is_primary=True
    contact_repo.create.assert_awaited_once()
    assert contact_repo.create.await_args.kwargs["is_primary"] is True

    # Verify supplier profile row was updated with contact details
    repo.update.assert_awaited_once_with(
        mock_supplier,
        contact_salutation="Mr.",
        contact_full_name="Om Patil",
        contact_designation="Sales Manager",
        contact_calling_number="+86 13800138000",
        contact_whatsapp_number="+86 13800138000",
        contact_wechat_number="om_wechat",
    )
    repo.replace_emails.assert_awaited_once_with(supplier_id, ["om.inhyma@gmail.com"])


@pytest.mark.asyncio
async def test_set_primary_contact_promotes_and_syncs():
    repo = MagicMock()
    contact_repo = MagicMock()
    cache_manager = MagicMock()
    cache_manager.invalidate_dropdown = AsyncMock()
    cache_manager.invalidate_pattern = AsyncMock()

    service = SupplierService(
        repository=repo,
        contact_repository=contact_repo,
        country_repository=MagicMock(),
        state_repository=MagicMock(),
        city_repository=MagicMock(),
        category_repository=MagicMock(),
        sub_category_repository=MagicMock(),
        product_repository=MagicMock(),
        cache_manager=cache_manager,
    )

    supplier_id = uuid.uuid4()
    mock_supplier = Supplier(
        id=supplier_id,
        company_name="Test Supplier Co",
        contact_full_name="Old Name",
    )
    mock_supplier.emails = []

    repo.get_with_relations = AsyncMock(return_value=mock_supplier)
    repo.get_by_id = AsyncMock(return_value=mock_supplier)
    repo.update = AsyncMock()
    repo.replace_emails = AsyncMock()
    repo.session = MagicMock()
    repo.session.refresh = AsyncMock()

    contact1_id = uuid.uuid4()
    contact2_id = uuid.uuid4()
    contact1 = SupplierContact(id=contact1_id, supplier_id=supplier_id, person_name="Old Primary", is_primary=True)
    contact2 = SupplierContact(
        id=contact2_id,
        supplier_id=supplier_id,
        person_name="New Primary",
        salutation="Mrs.",
        designation="Director",
        calling_number="+86 13900139000",
        whatsapp_number="+86 13900139000",
        wechat_number="new_wechat",
        email="new@supplier.com",
        is_primary=False,
    )

    contact_repo.get_by_id = AsyncMock(return_value=contact2)
    contact_repo.get_primary_contact = AsyncMock(return_value=contact1)
    contact_repo.update = AsyncMock()

    promoted = await service.set_primary_contact(supplier_id, contact2_id)
    assert promoted.id == contact2_id

    # Verify old primary was demoted
    contact_repo.update.assert_any_await(contact1, is_primary=False)
    # Verify new primary was promoted
    contact_repo.update.assert_any_await(contact2, is_primary=True)

    # Verify supplier profile was updated
    repo.update.assert_awaited_with(
        mock_supplier,
        contact_salutation="Mrs.",
        contact_full_name="New Primary",
        contact_designation="Director",
        contact_calling_number="+86 13900139000",
        contact_whatsapp_number="+86 13900139000",
        contact_wechat_number="new_wechat",
    )


@pytest.mark.asyncio
async def test_delete_primary_contact_is_rejected():
    repo = MagicMock()
    contact_repo = MagicMock()

    service = SupplierService(
        repository=repo,
        contact_repository=contact_repo,
        country_repository=MagicMock(),
        state_repository=MagicMock(),
        city_repository=MagicMock(),
        category_repository=MagicMock(),
        sub_category_repository=MagicMock(),
        product_repository=MagicMock(),
        cache_manager=MagicMock(),
    )

    supplier_id = uuid.uuid4()
    contact_id = uuid.uuid4()
    primary_contact = SupplierContact(id=contact_id, supplier_id=supplier_id, is_primary=True)

    contact_repo.get_by_id = AsyncMock(return_value=primary_contact)

    with pytest.raises(ConflictException):
        await service.delete_contact(supplier_id, contact_id)
