"""
Unit and integration tests for Supplier Import with dual contact persons and flexible phone formats.
"""

import io
import pytest
from app.core.exceptions import BadRequestException
from app.suppliers.validators import validate_email_format, validate_phone_number, validate_supplier_row


def test_validate_phone_number_single_and_multiple():
    # Single standard numbers
    assert validate_phone_number("+86 13800138000", field_label="Calling") == "+86 13800138000"
    assert validate_phone_number("+91 9876543210", field_label="Calling") == "+91 9876543210"

    # Multiple numbers separated by comma or slash
    multi_comma = "+91 9876543210, +91 9876543211"
    assert validate_phone_number(multi_comma, field_label="Calling") == multi_comma

    multi_slash = "9876543210 / 9876543211"
    assert validate_phone_number(multi_slash, field_label="Calling") == multi_slash

    # Blank / None degrades gracefully
    assert validate_phone_number(None, field_label="Calling") is None
    assert validate_phone_number("", field_label="Calling") is None

    # Invalid: under 7 digits
    with pytest.raises(BadRequestException):
        validate_phone_number("12345", field_label="Calling")


def test_validate_email_format_multiple():
    assert validate_email_format("sales@yinglima.com") == "sales@yinglima.com"
    assert validate_email_format("sales@yinglima.com, info@yinglima.com") == "sales@yinglima.com, info@yinglima.com"

    with pytest.raises(BadRequestException):
        validate_email_format("invalid-email")


def test_validate_supplier_row_single_contact():
    raw_row = {
        "Company Name": "Alpha Machinery Co.",
        "Country": "China",
        "State / Province": "Zhejiang",
        "City": "Wenzhou",
        "Contact Person": "Zhang Wei",
        "Designation": "Sales Director",
        "Calling Number": "+86 13800138000",
        "WhatsApp Number": "+86 13800138000",
        "WeChat Number": "+86 13800138000",
    }
    validated = validate_supplier_row(raw_row, 2)
    assert validated["company_name"] == "Alpha Machinery Co."
    assert validated["contact_full_name"] == "Zhang Wei"
    assert validated["contact_designation"] == "Sales Director"
    assert validated["contact_calling_number"] == "+86 13800138000"
    assert validated["contact_2"] is None


def test_validate_supplier_row_dual_contacts():
    raw_row = {
        "Company Name": "Beta Packaging Co.",
        "Country": "China",
        "State / Province": "Zhejiang",
        "City": "Wenzhou",
        # Primary Contact
        "Contact Person": "Chen Wei",
        "Designation": "Export Manager",
        "Calling Number": "+86 13800138000, +86 13800138001",
        "WhatsApp Number": "+86 13800138000",
        "WeChat Number": "+86 13800138000",
        # Secondary Contact
        "Contact Person 2": "Li Na",
        "Designation 2": "Support Head",
        "Calling Number 2": "+86 13900139000",
        "WhatsApp Number 2": "+86 13900139000",
        "WeChat Number 2": "+86 13900139000",
        "Email 2": "support@betapack.com",
    }
    validated = validate_supplier_row(raw_row, 2)
    assert validated["company_name"] == "Beta Packaging Co."
    assert validated["contact_full_name"] == "Chen Wei"
    assert validated["contact_calling_number"] == "+86 13800138000, +86 13800138001"

    # Contact 2 verified
    c2 = validated["contact_2"]
    assert c2 is not None
    assert c2["person_name"] == "Li Na"
    assert c2["designation"] == "Support Head"
    assert c2["calling_number"] == "+86 13900139000"
    assert c2["whatsapp_number"] == "+86 13900139000"
    assert c2["wechat_number"] == "+86 13900139000"
    assert c2["email"] == "support@betapack.com"


@pytest.mark.asyncio
async def test_supplier_service_import_dual_contacts():
    from app.database.engine import get_sessionmaker
    from app.suppliers.dependencies import get_supplier_service
    from app.cache.dependency import get_cache_manager

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        service = get_supplier_service(db=session, cache_manager=get_cache_manager())

        # Check existing country/state/city for valid test row
        countries = await service.country_repository.list_all()
        if not countries:
            pytest.skip("No countries found in test database")

        country = countries[0]
        states = await service.state_repository.list_all()
        state = next((s for s in states if s.country_id == country.id), None)
        if not state:
            pytest.skip("No state found for country")

        cities = await service.city_repository.list_all()
        city = next((c for c in cities if c.state_id == state.id), None)
        if not city:
            pytest.skip("No city found for state")

        import uuid
        test_company = f"Test Dual Contact Machinery {uuid.uuid4().hex[:8]}"

        csv_content = f"""Company Name,Country,State / Province,City,Contact Person,Designation,Calling Number,WhatsApp Number,Contact Person 2,Designation 2,Calling Number 2,WhatsApp Number 2
"{test_company}","{country.name}","{state.name}","{city.name}","Zhang Wei","Director","+86 13800138000","+86 13800138000","Li Na","Manager","+86 13900139000","+86 13900139000"
"""
        # 1. First import (Insert)
        summary = await service.import_file("test.csv", csv_content.encode("utf-8"), update_existing=False)
        assert summary.created == 1
        assert summary.failed == 0

        # Verify supplier and contacts
        supplier = next((s for s in await service.repository.list_all() if s.company_name.lower() == test_company.lower()), None)
        assert supplier is not None
        assert supplier.contact_full_name == "Zhang Wei"

        # Check contacts
        contacts = supplier.contacts
        assert len(contacts) == 2
        prim = next((c for c in contacts if c.is_primary), None)
        sec = next((c for c in contacts if not c.is_primary), None)
        assert prim is not None
        assert prim.person_name == "Zhang Wei"
        assert prim.calling_number == "+86 13800138000"

        assert sec is not None
        assert sec.person_name == "Li Na"
        assert sec.designation == "Manager"
        assert sec.calling_number == "+86 13900139000"

        # 2. Update existing import
        update_csv = f"""Company Name,Country,State / Province,City,Contact Person,Designation,Calling Number,WhatsApp Number,Contact Person 2,Designation 2,Calling Number 2,WhatsApp Number 2
"{test_company}","{country.name}","{state.name}","{city.name}","Zhang Wei Updated","Director","+86 13800138000","+86 13800138000","Li Na Updated","Senior Manager","+86 13900139999","+86 13900139999"
"""
        update_summary = await service.import_file("test_up.csv", update_csv.encode("utf-8"), update_existing=True)
        assert update_summary.updated == 1
        assert update_summary.failed == 0

        # Re-fetch supplier and verify updated contacts
        refetched = await service.get_by_id_or_raise(supplier.id)
        assert refetched.contact_full_name == "Zhang Wei Updated"
        ref_contacts = refetched.contacts
        assert len(ref_contacts) == 2
        ref_prim = next((c for c in ref_contacts if c.is_primary), None)
        ref_sec = next((c for c in ref_contacts if not c.is_primary), None)
        assert ref_prim.person_name == "Zhang Wei Updated"
        assert ref_sec.person_name == "Li Na Updated"
        assert ref_sec.designation == "Senior Manager"
        assert ref_sec.calling_number == "+86 13900139999"

        # Clean up permanently
        await session.delete(refetched)
        await session.commit()

