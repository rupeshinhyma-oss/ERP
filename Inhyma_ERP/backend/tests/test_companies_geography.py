"""
Companies: State -> District -> City hierarchy, clearable fields, status lock and primary contacts.

The service rules are exercised through the real HTTP routes (create / patch / contacts) on an in-memory SQLite
database holding only the tables this module uses.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.audit.dependencies import get_audit_service
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.cache.dependency import get_cache_manager
from app.companies.models import Company, CompanyContact, CompanyEmail
from app.companies.repository import CompanyRepository
from app.database.base import Base
from app.database.session import get_db_session
from app.events.dependencies import get_event_dispatcher
from app.main import create_application
from app.masters.cities.models import City
from app.masters.countries.models import Country
from app.masters.districts.models import District
from app.masters.states.models import State

pytestmark = pytest.mark.asyncio

IDS = {name: uuid.uuid4() for name in (
    "india", "gujarat", "maharashtra", "ahmedabad", "surat", "pune",
    "ahm_city", "sanand", "surat_city", "pune_city", "loose_city",
)}


class _NoCache:
    async def invalidate_dropdown(self, *_a, **_k):  # noqa: D401
        return None

    def __getattr__(self, _name):
        async def _noop(*_a, **_k):
            return None

        return _noop


class _NoAudit:
    async def record(self, **_k):
        return None


class _NoEvents:
    async def publish_lifecycle_event(self, *_a, **_k):
        return None


@pytest.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [m.__table__ for m in (Country, State, District, City, Company, CompanyEmail, CompanyContact)]
    from app.companies.models import CompanyCategoryLink, CompanyProductLink, CompanySubCategoryLink

    tables += [m.__table__ for m in (CompanyCategoryLink, CompanySubCategoryLink, CompanyProductLink)]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        session.add(Country(id=IDS["india"], name="India", code="IN"))
        await session.flush()
        for key, name in (("gujarat", "Gujarat"), ("maharashtra", "Maharashtra")):
            session.add(State(id=IDS[key], country_id=IDS["india"], name=name))
        await session.flush()
        for key, name, st in (("ahmedabad", "Ahmedabad", "gujarat"), ("surat", "Surat", "gujarat"), ("pune", "Pune", "maharashtra")):
            session.add(District(id=IDS[key], country_id=IDS["india"], state_id=IDS[st], name=name))
        await session.flush()
        for key, name, st, di in (
            ("ahm_city", "Ahmedabad City", "gujarat", "ahmedabad"),
            ("sanand", "Sanand", "gujarat", "ahmedabad"),
            ("surat_city", "Surat City", "gujarat", "surat"),
            ("pune_city", "Pune City", "maharashtra", "pune"),
            ("loose_city", "Unassigned Town", "gujarat", None),
        ):
            session.add(City(id=IDS[key], country_id=IDS["india"], state_id=IDS[st],
                             district_id=IDS[di] if di else None, name=name))
        await session.commit()
        yield session
    await engine.dispose()


@pytest.fixture
async def client(test_db: AsyncSession):
    app = create_application()

    async def _db():
        yield test_db

    user = CurrentUser(id=uuid.uuid4(), username="admin", permissions={"*"})
    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_audit_service] = lambda: _NoAudit()
    app.dependency_overrides[get_event_dispatcher] = lambda: _NoEvents()
    app.dependency_overrides[get_cache_manager] = lambda: _NoCache()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
        yield ac


def _body(**over):
    base = {"company_name": "Acme Packaging", "state_id": str(IDS["gujarat"]),
            "district_id": str(IDS["ahmedabad"]), "city_id": str(IDS["ahm_city"])}
    base.update(over)
    return {k: v for k, v in base.items() if v is not Ellipsis}


async def _create(client, **over):
    r = await client.post("/api/v1/companies", json=_body(**over))
    assert r.status_code == 201, r.text
    return r.json()["data"]


# ------------------------------------------------------------------ hierarchy on create
async def test_create_saves_consistent_state_district_city(client):
    c = await _create(client)
    assert c["state_id"] == str(IDS["gujarat"]) and c["district_id"] == str(IDS["ahmedabad"])
    assert c["district"] == "Ahmedabad" and c["city_id"] == str(IDS["ahm_city"])
    assert c["country_id"] == str(IDS["india"])  # derived from the state


async def test_create_refuses_inconsistent_hierarchy(client):
    bad_district = await client.post("/api/v1/companies", json=_body(company_name="A", district_id=str(IDS["pune"])))
    assert bad_district.status_code == 400 and "district" in bad_district.text.lower()
    bad_city_state = await client.post("/api/v1/companies", json=_body(company_name="B", city_id=str(IDS["pune_city"])))
    assert bad_city_state.status_code == 400
    bad_city_district = await client.post("/api/v1/companies", json=_body(company_name="C", city_id=str(IDS["surat_city"])))
    assert bad_city_district.status_code == 400 and "district" in bad_city_district.text.lower()


async def test_city_fills_in_its_district_and_state(client):
    c = await _create(client, company_name="D", state_id=..., district_id=..., city_id=str(IDS["sanand"]))
    assert c["district_id"] == str(IDS["ahmedabad"]) and c["state_id"] == str(IDS["gujarat"])


async def test_unassigned_city_is_allowed_without_a_district(client):
    c = await _create(client, company_name="E", district_id=..., city_id=str(IDS["loose_city"]))
    assert c["city_id"] == str(IDS["loose_city"]) and c["district_id"] is None


async def test_legacy_text_district_resolves_to_master_or_stays_text(client):
    known = await _create(client, company_name="F", district_id=..., city_id=..., district="  surat ")
    assert known["district_id"] == str(IDS["surat"]) and known["district"] == "Surat"
    unknown = await _create(client, company_name="G", district_id=..., city_id=..., district="Some New District")
    assert unknown["district_id"] is None and unknown["district"] == "Some New District"


async def test_form1_style_payload_with_unknown_keys_still_creates(client):
    r = await client.post("/api/v1/companies", json={
        "company_name": "H", "state_id": str(IDS["gujarat"]), "state": "Gujarat", "city": "Typed City", "district": "Surat"})
    assert r.status_code == 201
    assert r.json()["data"]["district_id"] == str(IDS["surat"])


# ------------------------------------------------------------------ hierarchy on update
async def test_changing_state_clears_stale_district_and_city(client):
    c = await _create(client)
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"state_id": str(IDS["maharashtra"])})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["state_id"] == str(IDS["maharashtra"]) and d["district_id"] is None and d["city_id"] is None
    assert not d["district"]


async def test_changing_state_with_new_valid_children(client):
    c = await _create(client)
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={
        "state_id": str(IDS["maharashtra"]), "district_id": str(IDS["pune"]), "city_id": str(IDS["pune_city"])})
    d = r.json()["data"]
    assert r.status_code == 200 and d["district"] == "Pune" and d["city_id"] == str(IDS["pune_city"])


async def test_changing_district_clears_city_and_rejects_foreign_city(client):
    c = await _create(client)
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"district_id": str(IDS["surat"])})
    assert r.status_code == 200 and r.json()["data"]["city_id"] is None
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"city_id": str(IDS["ahm_city"])})
    assert r.status_code == 400  # Ahmedabad City is not in Surat district


async def test_unrelated_edit_keeps_geography(client):
    c = await _create(client)
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"pincode": "380001"})
    d = r.json()["data"]
    assert d["pincode"] == "380001" and d["district_id"] == str(IDS["ahmedabad"]) and d["city_id"] == str(IDS["ahm_city"])


# ------------------------------------------------------------------ clearing fields
async def test_cleared_fields_are_really_cleared(client):
    c = await _create(client, company_name="Clear Me", contact_designation="Owner", area="MIDC")
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"city_id": None, "contact_designation": None, "area": None})
    d = r.json()["data"]
    assert r.status_code == 200 and d["city_id"] is None and d["contact_designation"] is None and d["area"] is None


async def test_company_name_cannot_be_blanked(client):
    c = await _create(client, company_name="Keep Name")
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"company_name": None, "pincode": "1"})
    assert r.status_code == 200 and r.json()["data"]["company_name"] == "Keep Name"


# ------------------------------------------------------------------ status lock / potential
async def test_existing_status_cannot_go_back_or_blank(client):
    c = await _create(client, company_name="Locked", current_status="existing")
    for value in ("new", None):
        r = await client.patch(f"/api/v1/companies/{c['id']}", json={"current_status": value})
        assert r.status_code == 409, (value, r.text)
    ok = await client.patch(f"/api/v1/companies/{c['id']}", json={"area": "x"})
    assert ok.status_code == 200 and ok.json()["data"]["current_status"] == "existing"


async def test_potential_rules_on_edit(client):
    c = await _create(client, company_name="Pot", potential="yes", potential_business_per_month="2-5 L")
    no_reason = await client.patch(f"/api/v1/companies/{c['id']}", json={"potential": "no"})
    assert no_reason.status_code == 400
    ok = await client.patch(f"/api/v1/companies/{c['id']}", json={"potential": "no", "potential_reason": "Too small"})
    d = ok.json()["data"]
    assert ok.status_code == 200 and d["potential_reason"] == "Too small" and d["potential_business_per_month"] is None


async def test_delete_rules(client):
    existing = await _create(client, company_name="Del1", current_status="existing")
    assert (await client.delete(f"/api/v1/companies/{existing['id']}")).status_code == 409
    fresh = await _create(client, company_name="Del2", current_status="new", potential="no", potential_reason="x")
    assert (await client.delete(f"/api/v1/companies/{fresh['id']}")).status_code == 200


# ------------------------------------------------------------------ contacts / primary
async def test_add_contact_defaults_to_not_primary_and_can_become_primary(client):
    c = await _create(client, company_name="Contacts Co", contact_full_name="Main Person",
                      contact_calling_number="9825011111")
    cid = c["id"]
    first = (await client.get(f"/api/v1/companies/{cid}/contacts")).json()["data"]
    assert len(first) == 1 and first[0]["is_primary"] is True  # mirrored First Data Form contact

    add = await client.post(f"/api/v1/companies/{cid}/contacts", json={"person_name": "Second", "calling_number": "9825022222"})
    assert add.status_code == 201 and add.json()["data"]["is_primary"] is False

    promote = await client.post(f"/api/v1/companies/{cid}/contacts",
                                json={"person_name": "Boss", "designation": "MD", "calling_number": "9825033333", "is_primary": True})
    assert promote.status_code == 201 and promote.json()["data"]["is_primary"] is True
    rows = (await client.get(f"/api/v1/companies/{cid}/contacts")).json()["data"]
    assert [r["person_name"] for r in rows if r["is_primary"]] == ["Boss"]
    company = (await client.get(f"/api/v1/companies/{cid}")).json()["data"]
    assert company["contact_full_name"] == "Boss" and company["contact_designation"] == "MD"


async def test_primary_contact_rules(client):
    c = await _create(client, company_name="Primary Co", contact_full_name="Owner", contact_calling_number="9825044444")
    cid = c["id"]
    primary = (await client.get(f"/api/v1/companies/{cid}/contacts")).json()["data"][0]
    # cannot un-mark the only primary, cannot delete it
    assert (await client.patch(f"/api/v1/companies/{cid}/contacts/{primary['id']}", json={"is_primary": False})).status_code == 409
    assert (await client.delete(f"/api/v1/companies/{cid}/contacts/{primary['id']}")).status_code == 409
    # an optional field on a contact can be cleared
    other = (await client.post(f"/api/v1/companies/{cid}/contacts", json={"person_name": "Acct", "email": "a@b.com"})).json()["data"]
    cleared = await client.patch(f"/api/v1/companies/{cid}/contacts/{other['id']}", json={"email": None})
    assert cleared.status_code == 200 and cleared.json()["data"]["email"] is None


# ------------------------------------------------------------------ list filter by district_id
async def test_list_filter_by_district_id(test_db: AsyncSession, client):
    a = await _create(client, company_name="In Ahmedabad")
    await _create(client, company_name="In Surat", district_id=str(IDS["surat"]), city_id=str(IDS["surat_city"]))
    repo = CompanyRepository(test_db)
    filters = SimpleNamespace(exact={"district_id": str(IDS["ahmedabad"])}, ranges={})
    stmt = repo._apply_dynamic_filters(repo._base_select(), filters)
    rows = (await test_db.execute(stmt)).scalars().unique().all()
    assert [r.company_name for r in rows] == ["In Ahmedabad"] and str(rows[0].id) == a["id"]


async def test_list_filter_by_district_id_legacy_name_fallback(test_db: AsyncSession, client):
    # Company with legacy district name text but district_id is None
    leg = Company(
        id=uuid.uuid4(),
        company_name="Legacy Valsad",
        district="Valsad",
        district_id=None,
    )
    test_db.add(leg)
    # Also add Valsad district in master
    valsad_id = uuid.uuid4()
    test_db.add(District(id=valsad_id, country_id=IDS["india"], state_id=IDS["gujarat"], name="Valsad", code="VAL"))
    await test_db.flush()

    repo = CompanyRepository(test_db)
    filters = SimpleNamespace(exact={"district_id": str(valsad_id)}, ranges={})
    stmt = repo._apply_dynamic_filters(repo._base_select(), filters)
    rows = (await test_db.execute(stmt)).scalars().unique().all()
    assert any(r.company_name == "Legacy Valsad" for r in rows)


async def test_list_filter_by_uuid_and_blank(test_db: AsyncSession, client):
    repo = CompanyRepository(test_db)
    # blank district_id
    filters_blank = SimpleNamespace(exact={"district_id": "blank"}, ranges={})
    stmt_blank = repo._apply_dynamic_filters(repo._base_select(), filters_blank)
    res_blank = await test_db.execute(stmt_blank)
    assert res_blank is not None

    # state_id UUID filter
    filters_state = SimpleNamespace(exact={"state_id": str(IDS["gujarat"])}, ranges={})
    stmt_state = repo._apply_dynamic_filters(repo._base_select(), filters_state)
    res_state = await test_db.execute(stmt_state)
    assert res_state is not None


# =====================================================================================================================
# Doc conformance ("Add Company (client profile) Inhyma"): list filters, GST / number duplicates, contacts, delete rules
# =====================================================================================================================
async def _list(client, **params):
    r = await client.get("/api/v1/companies", params=params)
    assert r.status_code == 200, r.text
    return {c["company_name"] for c in r.json()["data"]}


async def test_every_list_filter_works_with_the_parameters_the_ui_sends(client):
    base = dict(state_id=None, district_id=..., city_id=...)
    await _create(client, company_name="B2B-Trad-Yes", company_type="B2B", company_category="Traditional", company_grade="A",
                  potential="yes", potential_business_per_month="2-5 L", monthly_turnover="25-50 L", business_category="Manufacturer",
                  direct_import_from_china="Yes", monthly_import_volume="25-50 L", current_status="new")
    await _create(client, company_name="B2C-Corp-No", company_type="B2C", company_category="Corporate", company_grade="B",
                  potential="no", potential_reason="small", sector="Dairy", business_category="Trader", current_status="existing")
    await _create(client, company_name="Blank-All")  # nothing optional filled in

    assert await _list(client, company_type="B2B") == {"B2B-Trad-Yes"}
    assert await _list(client, company_type="B2C") == {"B2C-Corp-No"}
    assert await _list(client, company_type="blank") == {"Blank-All"}
    assert await _list(client, current_status="existing") == {"B2C-Corp-No"}
    assert await _list(client, current_status="new") == {"B2B-Trad-Yes"}
    assert await _list(client, current_status="blank") == {"Blank-All"}
    assert await _list(client, company_category="Traditional") == {"B2B-Trad-Yes"}
    assert await _list(client, company_category="Corporate") == {"B2C-Corp-No"}
    assert await _list(client, company_category="blank") == {"Blank-All"}
    assert await _list(client, company_grade="A") == {"B2B-Trad-Yes"}
    assert await _list(client, company_grade="blank") == {"Blank-All"}
    assert await _list(client, potential="yes") == {"B2B-Trad-Yes"}
    assert await _list(client, potential="no") == {"B2C-Corp-No"}
    assert await _list(client, potential="blank") == {"Blank-All"}
    assert await _list(client, potential_business_per_month="2-5 L") == {"B2B-Trad-Yes"}
    assert await _list(client, monthly_turnover="25-50 L") == {"B2B-Trad-Yes"}
    assert await _list(client, sector="Dairy") == {"B2C-Corp-No"}
    assert await _list(client, business_category="Trader") == {"B2C-Corp-No"}
    assert await _list(client, business_category="blank") == {"Blank-All"}
    assert await _list(client, direct_import_from_china="Yes") == {"B2B-Trad-Yes"}
    assert await _list(client, monthly_import_volume="25-50 L") == {"B2B-Trad-Yes"}
    assert await _list(client, state_id=str(IDS["gujarat"]), district_id=str(IDS["ahmedabad"]), city_id=str(IDS["ahm_city"])) == {
        "B2B-Trad-Yes", "B2C-Corp-No", "Blank-All"}
    assert await _list(client, created_after="2000-01-01T00:00:00Z", created_before="2000-01-02T00:00:00Z") == set()


async def test_gst_duplicate_is_refused_regardless_of_letter_case(client):
    await _create(client, company_name="Gst One", tax_id_number="24abcde1234f1z5")
    dup = await client.post("/api/v1/companies", json=_body(company_name="Gst Two", tax_id_number="24ABCDE1234F1Z5"))
    assert dup.status_code == 409 and "already exists" in dup.text.lower()
    dup2 = await client.post("/api/v1/companies", json=_body(company_name="Gst Three", tax_id_number="24abcde1234f1z5"))
    assert dup2.status_code == 409
    other = await _create(client, company_name="Gst Four", tax_id_number="27ZZZZZ9999Z1Z1")
    clash = await client.patch(f"/api/v1/companies/{other['id']}", json={"tax_id_number": "24ABCDE1234F1Z5"})
    assert clash.status_code == 409


async def test_direct_contact_number_duplicate_blocks_save_everywhere(client):
    a = await _create(client, company_name="Phone A", contact_full_name="A", contact_calling_number="9825012345")
    dup = await client.post("/api/v1/companies", json=_body(company_name="Phone B", contact_calling_number="9825012345"))
    assert dup.status_code == 409 and "already exists" in dup.text.lower()
    # also against another company's extra contacts, and when adding a contact
    await client.post(f"/api/v1/companies/{a['id']}/contacts", json={"person_name": "Extra", "calling_number": "9825067890"})
    dup2 = await client.post("/api/v1/companies", json=_body(company_name="Phone C", contact_calling_number="9825067890"))
    assert dup2.status_code == 409
    b = await _create(client, company_name="Phone D", contact_calling_number="9825000001")
    dup3 = await client.post(f"/api/v1/companies/{b['id']}/contacts", json={"person_name": "X", "calling_number": "9825012345"})
    assert dup3.status_code == 409


async def test_first_form_contact_appears_in_contact_list_as_primary_with_direct_number(client):
    c = await _create(client, company_name="Form Contact", contact_salutation="Mr", contact_full_name="Rajesh Patel",
                      contact_designation="Director", contact_calling_number="9825055555", contact_whatsapp_number="9825066666")
    rows = (await client.get(f"/api/v1/companies/{c['id']}/contacts")).json()["data"]
    assert len(rows) == 1
    r = rows[0]
    assert r["person_name"] == "Rajesh Patel" and r["designation"] == "Director"
    assert r["calling_number"] == "9825055555" and r["is_primary"] is True


async def test_add_contact_defaults_whatsapp_same_as_calling_primary_no_and_age_computed(client):
    c = await _create(client, company_name="Contact Defaults")
    r = await client.post(f"/api/v1/companies/{c['id']}/contacts",
                          json={"person_name": "New Person", "calling_number": "9825033333", "birth_date": "10-04-1990"})
    d = r.json()["data"]
    assert r.status_code == 201
    assert d["whatsapp_number"] == "9825033333"       # by default same as calling
    assert d["is_primary"] is False                   # Add form: primary No by default
    assert d.get("age") and int(d["age"]) >= 35       # computed automatically


async def test_company_age_is_computed_from_gst_registration_date(client):
    c = await _create(client, company_name="Age Co", gst_registration_date="2019-04-10")
    assert c["age_of_company"] and float(str(c["age_of_company"]).split()[0]) >= 7


async def test_name_keyword_suggestion_matches_any_part_of_the_word(client):
    await _create(client, company_name="Acme Packaging Works")
    for q in ("acme", "pack", "ckag", "works"):
        r = await client.get("/api/v1/companies/lookup", params={"q": q, "limit": 30})
        names = [x["company_name"] for x in r.json()["data"]]
        assert "Acme Packaging Works" in names, q


async def test_delete_and_inactive_rules(client):
    existing = await _create(client, company_name="Del Existing", current_status="existing")
    assert (await client.delete(f"/api/v1/companies/{existing['id']}")).status_code == 409
    assert (await client.post(f"/api/v1/companies/{existing['id']}/deactivate")).status_code == 200   # can go Inactive
    new_potential = await _create(client, company_name="Del NewPotential", current_status="new", potential="yes")
    assert (await client.delete(f"/api/v1/companies/{new_potential['id']}")).status_code == 409
    new_not = await _create(client, company_name="Del NewNot", current_status="new", potential="no", potential_reason="x")
    assert (await client.delete(f"/api/v1/companies/{new_not['id']}")).status_code == 200
    blank = await _create(client, company_name="Del Blank")
    assert (await client.delete(f"/api/v1/companies/{blank['id']}")).status_code == 200


async def test_company_age_updates_and_is_never_taken_from_the_client(client):
    # a client-sent age is ignored when a registration date exists
    c = await _create(client, company_name="Age Rules", gst_registration_date="2015-01-01", age_of_company="99")
    assert c["age_of_company"] != "99" and int(c["age_of_company"]) >= 11
    # changing the date recomputes; clearing the date clears the age
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"gst_registration_date": "2024-01-01"})
    assert r.json()["data"]["age_of_company"] in ("2", "1", "3")
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"gst_registration_date": None})
    assert r.json()["data"]["age_of_company"] is None
    # a future / unreadable date never produces an age
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"gst_registration_date": "2999-01-01"})
    assert r.json()["data"]["age_of_company"] is None


async def test_company_age_helper_edge_cases():
    from datetime import date
    from app.companies.age import compute_company_age

    today = date(2026, 10, 16)
    assert compute_company_age("2019-04-10", today) == "7"
    assert compute_company_age("2019-10-16", today) == "7"      # birthday today counts
    assert compute_company_age("2019-10-17", today) == "6"      # not yet
    assert compute_company_age("10-04-2019", today) == "7"      # DD-MM-YYYY
    assert compute_company_age("2026-06-01", today) == "0"      # under a year
    assert compute_company_age("2027-01-01", today) is None     # future
    assert compute_company_age("not a date", today) is None and compute_company_age(None, today) is None
    assert compute_company_age("29-02-2020", date(2021, 2, 28)) == "0"


async def test_sector_is_cleared_when_company_becomes_b2b(client):
    c = await _create(client, company_name="Sector Co", company_type="B2C", sector="Dairy")
    assert c["sector"] == "Dairy"
    r = await client.patch(f"/api/v1/companies/{c['id']}", json={"company_type": "B2B"})
    assert r.status_code == 200 and r.json()["data"]["sector"] is None


async def test_contact_whatsapp_defaults_to_calling_but_explicit_value_wins(client):
    c = await _create(client, company_name="WA Default")
    same = (await client.post(f"/api/v1/companies/{c['id']}/contacts", json={"person_name": "A", "calling_number": "9825022221"})).json()["data"]
    assert same["whatsapp_number"] == "9825022221"
    diff = (await client.post(f"/api/v1/companies/{c['id']}/contacts",
                              json={"person_name": "B", "calling_number": "9825022222", "whatsapp_number": "9825022223"})).json()["data"]
    assert diff["whatsapp_number"] == "9825022223"
    none = (await client.post(f"/api/v1/companies/{c['id']}/contacts", json={"person_name": "C"})).json()["data"]
    assert none["whatsapp_number"] is None



async def test_contact_age_is_computed_on_the_server_for_both_date_formats(client):
    c = await _create(client, company_name="Contact Age")
    for i, birth in enumerate(("10-04-1990", "1990-04-10"), start=1):   # DD-MM-YYYY and the calendar input's YYYY-MM-DD
        d = (await client.post(f"/api/v1/companies/{c['id']}/contacts",
                               json={"person_name": f"P{i}", "calling_number": f"98250000{i}0", "birth_date": birth})).json()["data"]
        assert d.get("age") is not None and int(d["age"]) >= 35, (birth, d.get("age"))
    rows = (await client.get(f"/api/v1/companies/{c['id']}/contacts")).json()["data"]
    assert all(r.get("age") is not None for r in rows if r.get("birth_date"))