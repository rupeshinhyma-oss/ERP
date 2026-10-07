"""
Unit & Regression Tests for Companies Module.

Tests cover:
- CompanyCurrentStatus Enum values (including NEW, EXISTING, ACTIVE, INACTIVE)
- CompanyListItemRead schema validation and serialization
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
import pytest

from app.companies.models import (
    CompanyCurrentStatus,
    CompanyGrade,
    CompanyPotential,
)
from app.companies.schemas import CompanyListItemRead


def test_company_current_status_values():
    """Verify CompanyCurrentStatus supports both existing and legacy/active values."""
    assert CompanyCurrentStatus.NEW == "new"
    assert CompanyCurrentStatus.EXISTING == "existing"
    assert CompanyCurrentStatus.ACTIVE == "active"
    assert CompanyCurrentStatus.INACTIVE == "inactive"


def test_company_list_item_read_with_active_status():
    """Verify CompanyListItemRead serializes with active or existing status."""
    now = datetime.now(timezone.utc)
    item = CompanyListItemRead(
        id=uuid.uuid4(),
        company_name="Test Automation Corp",
        current_status=CompanyCurrentStatus.ACTIVE,
        company_grade=CompanyGrade.A,
        potential=CompanyPotential.YES,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    dumped = item.model_dump(mode="json")
    assert dumped["company_name"] == "Test Automation Corp"
    assert dumped["current_status"] == "active"
    assert dumped["is_active"] is True


def test_company_schemas_with_new_fields():
    """Verify CompanyCreate and CompanyRead handle all extended fields."""
    from app.companies.schemas import CompanyCreate, CompanyRead

    now = datetime.now(timezone.utc)
    create_payload = CompanyCreate(
        company_name="Inhyma Solutions",
        pincode="382445",
        company_category="Machine Manufacturer",
        product_manufacture_or_supply="Industrial Conveyors",
        machines_buying_from="ABC Corp",
        spares_buying_from="XYZ Spares",
        products_interested="Bearings, Motors",
        gst_registration_date="2020-01-15",
        age_of_company="6 Years",
        social_media=[{"platform": "LinkedIn", "url": "https://linkedin.com/company/inhyma"}],
    )
    dumped = create_payload.model_dump()
    assert dumped["pincode"] == "382445"
    assert dumped["company_category"] == "Machine Manufacturer"
    assert dumped["product_manufacture_or_supply"] == "Industrial Conveyors"
    assert dumped["machines_buying_from"] == "ABC Corp"
    assert dumped["spares_buying_from"] == "XYZ Spares"
    assert dumped["products_interested"] == "Bearings, Motors"
    assert dumped["gst_registration_date"] == "2020-01-15"
    assert dumped["age_of_company"] == "6 Years"
    assert dumped["social_media"] == [{"platform": "LinkedIn", "url": "https://linkedin.com/company/inhyma"}]

    cid = uuid.uuid4()
    read_payload = CompanyRead(
        id=cid,
        company_name="Inhyma Solutions",
        company_type="manufacturer",
        brand_description=None,
        country_id=None,
        state_id=None,
        city_id=None,
        area=None,
        district=None,
        sales_person_id=None,
        contact_salutation="Mr",
        contact_full_name="Rupesh Malla",
        contact_designation="Director",
        contact_calling_number=None,
        contact_whatsapp_number=None,
        contact_wechat_number=None,
        contact_indiamart_number=None,
        tax_id_number="24AAAAA0000A1Z5",
        address="GIDC Vatva",
        town=None,
        pincode="382445",
        primary_website="https://inhymasolutions.com",
        secondary_website=None,
        company_category="Machine Manufacturer",
        product_manufacture_or_supply="Industrial Conveyors",
        machines_buying_from="ABC Corp",
        spares_buying_from="XYZ Spares",
        products_interested="Bearings, Motors",
        gst_registration_date="2020-01-15",
        age_of_company="6 Years",
        social_media=[{"platform": "LinkedIn", "url": "https://linkedin.com/company/inhyma"}],
        company_grade=CompanyGrade.A,
        current_status=CompanyCurrentStatus.ACTIVE,
        potential=CompanyPotential.YES,
        potential_reason=None,
        secondary_products_description=None,
        visited_factory_office=False,
        visit_remarks=None,
        visit_media=None,
        overall_remarks="Key strengths in automation",
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    assert read_payload.pincode == "382445"
    assert read_payload.social_media[0]["platform"] == "LinkedIn"


@pytest.mark.asyncio
async def test_lookup_companies_direct():
    """Verify lookup_companies executes query with term filter and formats response correctly."""
    from unittest.mock import AsyncMock, MagicMock
    from app.companies.routes import lookup_companies

    # Setup mock row
    test_id = uuid.uuid4()
    mock_row = MagicMock()
    mock_row.id = test_id
    mock_row.company_name = "Apex Valves & Automation India Pvt Ltd"
    mock_row.company_type = "B2B"
    mock_row.tax_id_number = "24AABCA1234F1Z1"
    mock_row.area = "GIDC Phase 2"
    mock_row.district = "Ahmedabad"
    mock_row.city_id = uuid.uuid4()
    mock_row.state_id = uuid.uuid4()
    mock_row.contact_salutation = "Mr"
    mock_row.contact_full_name = "Rajesh Sharma"
    mock_row.contact_designation = "Purchase Manager"
    mock_row.contact_calling_number = "9876543210"
    mock_row.contact_whatsapp_number = "9876543210"
    mock_row.contact_indiamart_number = "9876543210"
    mock_row.primary_website = "https://apexvalves.com"
    mock_row.sales_person_id = uuid.uuid4()

    mock_result = MagicMock()
    mock_result.all.return_value = [mock_row]

    mock_db = AsyncMock()
    mock_db.execute.return_value = mock_result

    # Mock request
    mock_request = MagicMock()
    mock_request.state.request_id = "req-test-lookup-123"

    # Mock user
    mock_user = MagicMock()

    # Call lookup_companies
    response = await lookup_companies(
        request=mock_request,
        q="Apex",
        limit=20,
        db=mock_db,
        _current_user=mock_user,
    )

    assert response["success"] is True
    assert response["meta"]["request_id"] == "req-test-lookup-123"
    data = response["data"]
    assert len(data) == 1
    assert data[0]["id"] == str(test_id)
    assert data[0]["company_name"] == "Apex Valves & Automation India Pvt Ltd"
    assert data[0]["tax_id_number"] == "24AABCA1234F1Z1"
    assert data[0]["district"] == "Ahmedabad"
    assert data[0]["primary_website"] == "https://apexvalves.com"
    mock_db.execute.assert_called_once()


@pytest.mark.asyncio
async def test_lookup_companies_empty_query():
    """Verify lookup_companies functions with empty search query and null fields."""
    from unittest.mock import AsyncMock, MagicMock
    from app.companies.routes import lookup_companies

    test_id = uuid.uuid4()
    mock_row = MagicMock()
    mock_row.id = test_id
    mock_row.company_name = "Zenith Engineering & Automation Pvt Ltd"
    mock_row.company_type = None
    mock_row.tax_id_number = None
    mock_row.area = None
    mock_row.district = None
    mock_row.city_id = None
    mock_row.state_id = None
    mock_row.contact_salutation = None
    mock_row.contact_full_name = None
    mock_row.contact_designation = None
    mock_row.contact_calling_number = None
    mock_row.contact_whatsapp_number = None
    mock_row.contact_indiamart_number = None
    mock_row.primary_website = None
    mock_row.sales_person_id = None

    mock_result = MagicMock()
    mock_result.all.return_value = [mock_row]

    mock_db = AsyncMock()
    mock_db.execute.return_value = mock_result

    mock_request = MagicMock()
    mock_request.state.request_id = "req-test-empty-456"

    response = await lookup_companies(
        request=mock_request,
        q="",
        limit=50,
        db=mock_db,
        _current_user=MagicMock(),
    )

    assert response["success"] is True
    data = response["data"]
    assert len(data) == 1
    assert data[0]["company_name"] == "Zenith Engineering & Automation Pvt Ltd"
    assert data[0]["city_id"] is None
    assert data[0]["state_id"] is None
    assert data[0]["tax_id_number"] is None



def test_company_create_accepts_the_new_spec_fields():
    """Monthly Turnover, Potential Business per month, and the Direct Import from China cluster."""
    from app.companies.schemas import CompanyCreate

    payload = CompanyCreate(
        company_name="Acme Packaging",
        company_type="B2B",
        monthly_turnover="25-50 L",
        potential="yes",
        potential_business_per_month="5-10 L",
        direct_import_from_china="yes",
        monthly_import_volume="25-50 L",
        products_needed_for_imports="Flow wrap film, sealing rollers",
    )
    dumped = payload.model_dump()
    assert dumped["monthly_turnover"] == "25-50 L"
    assert dumped["potential_business_per_month"] == "5-10 L"
    assert dumped["direct_import_from_china"] == "Yes"  # normalised to title case
    assert dumped["monthly_import_volume"] == "25-50 L"
    assert dumped["products_needed_for_imports"] == "Flow wrap film, sealing rollers"


def test_direct_import_requires_b2b_business_type():
    from app.companies.schemas import CompanyCreate

    with pytest.raises(Exception, match="only applicable when Business Type is B2B"):
        CompanyCreate(company_name="X", company_type="B2C", direct_import_from_china="Yes")
    with pytest.raises(Exception, match="only applicable when Business Type is B2B"):
        CompanyCreate(company_name="X", direct_import_from_china="Yes")  # business type blank
    # B2B with no import flag at all is fine
    CompanyCreate(company_name="X", company_type="B2B")


def test_import_volume_and_products_require_direct_import_yes():
    from app.companies.schemas import CompanyCreate

    with pytest.raises(Exception, match="require Direct Import from China = Yes"):
        CompanyCreate(company_name="X", company_type="B2B", direct_import_from_china="No", monthly_import_volume="10-25 L")
    with pytest.raises(Exception, match="require Direct Import from China = Yes"):
        CompanyCreate(company_name="X", company_type="B2B", products_needed_for_imports="Rollers")
    # fine when Direct Import is Yes
    CompanyCreate(company_name="X", company_type="B2B", direct_import_from_china="Yes", monthly_import_volume="10-25 L")


def test_potential_no_requires_a_reason_and_yes_allows_a_monthly_band():
    from app.companies.schemas import CompanyCreate

    with pytest.raises(Exception, match="reason is required when Potential is 'No'"):
        CompanyCreate(company_name="X", potential="no")
    CompanyCreate(company_name="X", potential="no", potential_reason="Budget constraints this year")
    with pytest.raises(Exception, match="Potential Business per month requires Potential = Yes"):
        CompanyCreate(company_name="X", potential="no", potential_reason="Not interested", potential_business_per_month="0-2 L")
    CompanyCreate(company_name="X", potential="yes", potential_business_per_month="0-2 L")


def test_company_contact_accepts_birth_and_anniversary_dates():
    from app.companies.schemas import CompanyContactCreate, CompanyContactUpdate

    created = CompanyContactCreate(person_name="Rajiv Kadam", birth_date="15-08-1990", anniversary_date="02-12-2015")
    assert created.birth_date == "15-08-1990"
    assert created.anniversary_date == "02-12-2015"
    updated = CompanyContactUpdate(birth_date="01-01-1985")
    assert updated.birth_date == "01-01-1985"
    assert updated.anniversary_date is None


def test_company_schemas_accept_business_category():
    from app.companies.schemas import CompanyCreate, CompanyUpdate, CompanyListItemRead, CompanyRead

    c = CompanyCreate(company_name="Manufacturer Co", business_category="Manufacturer")
    assert c.business_category == "Manufacturer"

    u = CompanyUpdate(business_category="Trader")
    assert u.business_category == "Trader"


@pytest.mark.asyncio
async def test_company_service_duplicate_checks():
    from unittest.mock import AsyncMock, MagicMock
    from app.companies.service import CompanyService
    from app.core.exceptions import ConflictException

    repo = MagicMock()
    repo.name_city_exists = AsyncMock(return_value=False)
    repo.tax_id_exists = AsyncMock(return_value=True)
    repo.calling_number_exists = AsyncMock(return_value=True)

    service = CompanyService(
        repository=repo,
        contact_repository=MagicMock(),
        country_repository=MagicMock(),
        state_repository=MagicMock(),
        city_repository=MagicMock(),
        category_repository=MagicMock(),
        sub_category_repository=MagicMock(),
        cache_manager=MagicMock(),
    )
    service._validate_geography = AsyncMock()
    service._validate_categories = AsyncMock()
    service._validate_sub_categories = AsyncMock()
    service._validate_products = AsyncMock()

    with pytest.raises(ConflictException, match="already exists"):
        await service.create(company_name="Test Company", tax_id_number="27AABCU9603R1ZM")

    repo.tax_id_exists = AsyncMock(return_value=False)
    with pytest.raises(ConflictException, match="already exists"):
        await service.create(company_name="Test Company", contact_calling_number="9876543210")