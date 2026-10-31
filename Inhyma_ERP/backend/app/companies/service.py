"""
Company Service.

Business logic for company CRUD, mirroring supplier functionality
for the dedicated Companies module.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.cities.repository import CityRepository
from app.masters.countries.repository import CountryRepository
from app.companies.age import compute_company_age
from app.masters.districts.repository import DistrictRepository
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository
from app.masters.products.repository import ProductRepository
from app.masters.states.repository import StateRepository
from app.companies.constants import EXPORT_HEADERS
from app.companies.models import Company, CompanyContact, CompanyCurrentStatus
from app.companies.repository import CompanyContactRepository, CompanyRepository
from app.companies.validators import validate_company_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)

DROPDOWN_CACHE_NAME = "companies"


class CompanyService:
    """Orchestrates company profile management on top of :class:`CompanyRepository`."""

    not_found_message = "Company not found."

    def __init__(
        self,
        repository: CompanyRepository,
        contact_repository: CompanyContactRepository,
        country_repository: CountryRepository,
        state_repository: StateRepository,
        city_repository: CityRepository,
        category_repository: ProductCategoryRepository,
        sub_category_repository: ProductSubCategoryRepository,
        cache_manager: CacheManager,
        product_repository: ProductRepository | None = None,
        district_repository: DistrictRepository | None = None,
    ) -> None:
        """Bind this service to its repository, every referenced master's repository, and cache manager."""
        self.repository = repository
        self.contact_repository = contact_repository
        self.country_repository = country_repository
        self.state_repository = state_repository
        self.city_repository = city_repository
        self.category_repository = category_repository
        self.sub_category_repository = sub_category_repository
        self.cache_manager = cache_manager
        self.product_repository = product_repository
        self.district_repository = district_repository

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def get_by_id_or_raise(self, company_id: uuid.UUID) -> Company:
        """Fetch a company by ID or raise :class:`NotFoundException`."""
        company = await self.repository.get_with_relations(company_id)
        if company is None:
            raise NotFoundException(self.not_found_message)
        return company

    async def list_paginated(
        self,
        query: ListQueryParams,
        *,
        category_id: uuid.UUID | None = None,
        sub_category_id: uuid.UUID | None = None,
        product_id: uuid.UUID | None = None,
        category_blank: bool = False,
        sub_category_blank: bool = False,
        product_blank: bool = False,
    ) -> tuple[list[Company], int]:
        """Return a page of companies matching search/sort/filter and category/sub-cat/product predicates."""
        if (
            category_id is None
            and sub_category_id is None
            and product_id is None
            and not category_blank
            and not sub_category_blank
            and not product_blank
        ):
            return await self.repository.paginated_list(query)

        base_stmt = self.repository._base_select()
        base_stmt = self.repository._apply_search(base_stmt, query.search.normalized)
        base_stmt = self.repository._apply_dynamic_filters(base_stmt, query.filters)
        if category_blank:
            base_stmt = self.repository.apply_category_blank_filter(base_stmt)
        elif category_id is not None:
            base_stmt = self.repository.apply_category_filter(base_stmt, category_id)

        if sub_category_blank:
            base_stmt = self.repository.apply_sub_category_blank_filter(base_stmt)
        elif sub_category_id is not None:
            base_stmt = self.repository.apply_sub_category_filter(base_stmt, sub_category_id)

        if product_blank:
            base_stmt = self.repository.apply_product_blank_filter(base_stmt)
        elif product_id is not None:
            base_stmt = self.repository.apply_product_filter(base_stmt, product_id)

        from sqlalchemy import func, select

        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int((await self.repository.session.execute(count_stmt)).scalar_one())

        list_stmt = self.repository._apply_sort(base_stmt, query.sort)
        list_stmt = list_stmt.offset(query.page.offset).limit(query.page.limit)
        result = await self.repository.session.execute(list_stmt)
        items = list(result.scalars().unique().all())
        return items, total

    async def get_category_ids(self, company_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every product-category ID linked to a company."""
        return await self.repository.list_all_category_ids(company_id)

    async def get_sub_category_ids(self, company_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every product-sub-category ID linked to a company."""
        return await self.repository.list_all_sub_category_ids(company_id)

    async def get_product_ids(self, company_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every Product ID linked to a company."""
        return await self.repository.list_all_product_ids(company_id)

    async def list_contacts(self, company_id: uuid.UUID) -> list[CompanyContact]:
        """Return every contact person for a company."""
        return await self.contact_repository.list_for_company(company_id)

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------

    async def _validate_geography(
        self, country_id: uuid.UUID | None, state_id: uuid.UUID | None, city_id: uuid.UUID | None
    ) -> None:
        """Ensure country/state/city exist and are mutually consistent when provided."""
        if country_id is not None and await self.country_repository.get_by_id(country_id) is None:
            raise BadRequestException("The specified country does not exist.")
        if state_id is not None:
            state = await self.state_repository.get_by_id(state_id)
            if state is None:
                raise BadRequestException("The specified state/province does not exist.")
            if country_id is not None and state.country_id != country_id:
                raise BadRequestException("The specified state does not belong to the specified country.")
        if city_id is not None:
            city = await self.city_repository.get_by_id(city_id)
            if city is None:
                raise BadRequestException("The specified city does not exist.")
            if state_id is not None and city.state_id != state_id:
                raise BadRequestException("The specified city does not belong to the specified state.")

    async def _normalize_geography(
        self,
        *,
        country_id: uuid.UUID | None,
        state_id: uuid.UUID | None,
        district_id: uuid.UUID | None,
        district_text: str | None,
        city_id: uuid.UUID | None,
    ) -> dict[str, Any]:
        """
        Validate the State -> District -> City hierarchy and return the normalised geography columns.

        * a district must belong to the state; a city must belong to the state (and to the district when the
          city is assigned to one) -- an inconsistent combination is refused instead of being saved;
        * the state / country are derived from the district / city / state when they are not supplied;
        * a city that belongs to a district fills in the district;
        * a legacy free-text ``district`` is resolved to the district master by name (within the state); a name
          that is not in the master is kept as text so older callers keep working.
        """
        district = None
        if district_id is not None and self.district_repository is not None:
            district = await self.district_repository.get_by_id(district_id)
            if district is None:
                raise BadRequestException("The specified district does not exist.")
        city = None
        if city_id is not None:
            city = await self.city_repository.get_by_id(city_id)
            if city is None:
                raise BadRequestException("The specified city does not exist.")

        if state_id is None:
            if district is not None:
                state_id = district.state_id
            elif city is not None:
                state_id = city.state_id

        if state_id is not None:
            state = await self.state_repository.get_by_id(state_id)
            if state is None:
                raise BadRequestException("The specified state/province does not exist.")
            if country_id is None:
                country_id = state.country_id
            elif state.country_id != country_id:
                raise BadRequestException("The specified state does not belong to the specified country.")
        elif country_id is not None and await self.country_repository.get_by_id(country_id) is None:
            raise BadRequestException("The specified country does not exist.")

        if district is not None and state_id is not None and district.state_id != state_id:
            raise BadRequestException("The specified district does not belong to the specified state.")
        if city is not None and state_id is not None and city.state_id != state_id:
            raise BadRequestException("The specified city does not belong to the specified state.")
        if city is not None and city.district_id is not None and self.district_repository is not None:
            if district is None:
                district = await self.district_repository.get_by_id(city.district_id)
            elif city.district_id != district.id:
                raise BadRequestException("The specified city does not belong to the specified district.")

        text = (district_text or "").strip() or None
        if district is None and text and state_id is not None and self.district_repository is not None:
            for candidate in await self.district_repository.list_by_state(state_id):
                if candidate.name.strip().lower() == text.lower():
                    district = candidate
                    break

        return {
            "country_id": country_id,
            "state_id": state_id,
            "district_id": district.id if district is not None else None,
            "district": district.name if district is not None else text,
            "city_id": city_id,
        }

    async def _validate_categories(self, category_ids: list[uuid.UUID]) -> None:
        """Ensure every given product category exists."""
        if not category_ids:
            return
        found = await self.category_repository.get_by_ids(category_ids)
        missing = [str(cid) for cid in category_ids if cid not in found]
        if missing:
            raise BadRequestException(f"Product category {missing[0]} does not exist.")

    async def _validate_sub_categories(self, sub_category_ids: list[uuid.UUID]) -> None:
        """Ensure every given product sub-category exists."""
        if not sub_category_ids:
            return
        found = await self.sub_category_repository.get_by_ids(sub_category_ids)
        missing = [str(sid) for sid in sub_category_ids if sid not in found]
        if missing:
            raise BadRequestException(f"Product sub-category {missing[0]} does not exist.")

    async def _validate_products(self, product_ids: list[uuid.UUID]) -> None:
        """Ensure every given product exists."""
        if not product_ids:
            return
        if self.product_repository is None:
            raise BadRequestException("Product linking is not available in this context.")
        found = await self.product_repository.get_by_ids(product_ids)
        missing = [str(pid) for pid in product_ids if pid not in found]
        if missing:
            raise BadRequestException(f"Product {missing[0]} does not exist.")

    def _validate_visit_remarks(self, visited: bool, visit_remarks: str | None) -> None:
        """Remarks are only meaningful when visited_factory_office is True."""
        if visit_remarks and not visited:
            raise BadRequestException(
                "Visit Remarks can only be set when 'Visited Factory/Office' is Yes."
            )

    def _validate_status_transition(self, existing_status: Any, new_status: Any) -> None:
        """Status may not move from Existing back to New (one-way status lock per spec)."""
        if not existing_status:
            return
        ex_str = (existing_status.value if hasattr(existing_status, "value") else str(existing_status)).strip().lower()
        new_str = (
            "" if new_status is None else (new_status.value if hasattr(new_status, "value") else str(new_status))
        ).strip().lower()
        if ex_str == "existing" and new_str in ("new", "", "none"):
            raise ConflictException(
                "Current Status cannot be changed from 'Existing' back to 'New'. Once a company transitions to Existing, status is locked from returning to New."
            )

    def _can_delete(self, company: Company) -> bool:
        """
        Spec: If Current Status is 'Existing', cannot DELETE that data but can do 'Inactive'.
        Deletion only permitted if Current Status is 'New or Blank' and Select Type is 'Not Potential' (no/blank).
        """
        status_str = (company.current_status.value if hasattr(company.current_status, "value") else str(company.current_status or "")).strip().lower()
        if status_str == "existing":
            return False
        if status_str not in ("", "none", "new"):
            return False
        pot_str = (company.potential.value if hasattr(company.potential, "value") else str(company.potential or "")).strip().lower()
        if pot_str in ("yes",):
            return False
        return True

    async def _ensure_tax_id_unique(self, tax_id: str | None, *, exclude_id: uuid.UUID | None = None) -> None:
        """Spec: a duplicate GST number must be refused with an 'already exists' message."""
        if not tax_id or not tax_id.strip():
            return
        clean_gst = tax_id.strip().upper()
        import inspect
        if hasattr(self.repository, "get_company_by_tax_id"):
            res = self.repository.get_company_by_tax_id(clean_gst, exclude_id=exclude_id)
            if inspect.isawaitable(res):
                existing_comp = await res
                if existing_comp:
                    raise ConflictException(
                        f"A company with GST number {clean_gst!r} already exists (in company {existing_comp.company_name!r}).",
                        details={"existing": model_to_dict(existing_comp)},
                    )
        if hasattr(self.repository, "tax_id_exists"):
            res = self.repository.tax_id_exists(clean_gst, exclude_id=exclude_id)
            exists = await res if inspect.isawaitable(res) else res
            if exists:
                raise ConflictException(f"A company with GST number {clean_gst!r} already exists.")

    async def _ensure_calling_number_unique(
        self,
        calling_number: str | None,
        *,
        exclude_id: uuid.UUID | None = None,
        exclude_contact_id: uuid.UUID | None = None,
    ) -> None:
        """Spec: Contact Number (Direct) must show 'already exists' and not allow to save."""
        if not calling_number:
            return
        import inspect
        if hasattr(self.repository, "get_company_by_calling_number"):
            res = self.repository.get_company_by_calling_number(
                calling_number, exclude_id=exclude_id, exclude_contact_id=exclude_contact_id
            )
            if inspect.isawaitable(res):
                existing_comp = await res
                if existing_comp:
                    raise ConflictException(
                        f"A company or contact with Contact Number (Direct) {calling_number.strip()!r} already exists "
                        f"(in company {existing_comp.company_name!r}). Duplicate contact numbers are not allowed."
                    )
        if hasattr(self.repository, "calling_number_exists"):
            res = self.repository.calling_number_exists(
                calling_number, exclude_id=exclude_id, exclude_contact_id=exclude_contact_id
            )
            exists = await res if inspect.isawaitable(res) else res
            if exists:
                raise ConflictException(
                    f"A company or contact with Contact Number (Direct) {calling_number.strip()!r} already exists. "
                    "Duplicate contact numbers are not allowed."
                )

    async def auto_transition_to_existing(self, company_name: str | None) -> None:
        """Spec: When an invoice or confirmed sales order is generated for a client, automatically flip current_status from new to existing."""
        if not company_name:
            return
        updated = await self.repository.transition_to_existing_by_name(company_name)
        if updated:
            await self._invalidate_cache()

    async def _invalidate_cache(self) -> None:
        """Invalidate the companies dropdown cache after mutation."""
        if hasattr(self.cache_manager, "invalidate_dropdown"):
            import inspect
            res = self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)
            if inspect.isawaitable(res):
                await res

    # ------------------------------------------------------------------
    # Create / Update
    # ------------------------------------------------------------------

    async def create(self, **field_values: Any) -> Company:
        """Create a new company profile."""
        company_name = field_values["company_name"]
        category_ids = field_values.pop("category_ids", []) or []
        sub_category_ids = field_values.pop("sub_category_ids", []) or []
        product_ids = field_values.pop("product_ids", []) or []
        emails = field_values.pop("emails", []) or []

        geo = await self._normalize_geography(
            country_id=field_values.get("country_id"),
            state_id=field_values.get("state_id"),
            district_id=field_values.get("district_id"),
            district_text=field_values.get("district"),
            city_id=field_values.get("city_id"),
        )
        field_values.update(geo)
        country_id = geo["country_id"]
        city_id = geo["city_id"]

        # Age of Company is derived from the GST registration date (never trusted from the client).
        computed_age = compute_company_age(field_values.get("gst_registration_date"))
        if computed_age is not None:
            field_values["age_of_company"] = computed_age

        await self._validate_categories(category_ids)
        await self._validate_sub_categories(sub_category_ids)
        await self._validate_products(product_ids)
        self._validate_visit_remarks(
            field_values.get("visited_factory_office", False), field_values.get("visit_remarks")
        )

        # Duplicate checks
        if field_values.get("tax_id_number"):
            await self._ensure_tax_id_unique(field_values["tax_id_number"])
        if field_values.get("contact_calling_number"):
            await self._ensure_calling_number_unique(field_values["contact_calling_number"])

        if await self.repository.name_city_exists(company_name, city_id):
            existing = await self.repository.get_by_name_city(company_name, city_id)
            city_hint = " in this city" if city_id else ""
            raise ConflictException(
                f"A company named {company_name!r} already exists{city_hint}.",
                details={"existing": model_to_dict(existing) if existing else None},
            )

        company = await self.repository.create(**field_values)

        await self.repository.replace_category_links(company.id, category_ids)
        await self.repository.replace_sub_category_links(company.id, sub_category_ids)
        await self.repository.replace_product_links(company.id, product_ids)
        await self.repository.replace_emails(company.id, emails)

        # Mirror the First Data Form's contact into the contacts list
        if field_values.get("contact_full_name"):
            await self.contact_repository.create(
                company_id=company.id,
                salutation=field_values.get("contact_salutation"),
                person_name=field_values["contact_full_name"],
                designation=field_values.get("contact_designation"),
                handling_territory=None,
                country_id=country_id,
                calling_number=field_values.get("contact_calling_number"),
                whatsapp_number=field_values.get("contact_whatsapp_number"),
                wechat_number=field_values.get("contact_wechat_number"),
                email=emails[0] if emails else None,
                is_primary=True,
            )

        await self._invalidate_cache()
        return await self.get_by_id_or_raise(company.id)

    async def update(self, company_id: uuid.UUID, **field_values: Any) -> Company:
        """Update an existing company profile."""
        company = await self.get_by_id_or_raise(company_id)

        category_ids = field_values.pop("category_ids", None)
        sub_category_ids = field_values.pop("sub_category_ids", None)
        product_ids = field_values.pop("product_ids", None)
        emails = field_values.pop("emails", None)

        country_id = field_values.get("country_id") or company.country_id
        if any(k in field_values for k in ("country_id", "state_id", "district_id", "district", "city_id")):
            # Effective values: what the client sent, else what is stored -- except that changing a parent level
            # (state -> district -> city) clears the stale children instead of failing on them.
            state_changed = "state_id" in field_values and field_values["state_id"] != company.state_id
            district_changed = state_changed or (
                "district_id" in field_values and field_values["district_id"] != company.district_id
            ) or (
                "district" in field_values
                and "district_id" not in field_values
                and (field_values["district"] or None) != (company.district or None)
            )
            eff_state = field_values["state_id"] if "state_id" in field_values else company.state_id
            if "district_id" in field_values:
                eff_district_id = field_values["district_id"]
                eff_district_text = None if eff_district_id is not None else field_values.get("district")
            elif "district" in field_values:
                eff_district_id, eff_district_text = None, field_values["district"]
            elif state_changed:
                eff_district_id, eff_district_text = None, None
            else:
                eff_district_id, eff_district_text = company.district_id, company.district
            if "city_id" in field_values:
                eff_city = field_values["city_id"]
            elif district_changed:
                eff_city = None
            else:
                eff_city = company.city_id
            geo = await self._normalize_geography(
                country_id=field_values.get("country_id") if "country_id" in field_values else (
                    None if state_changed else company.country_id
                ),
                state_id=eff_state,
                district_id=eff_district_id,
                district_text=eff_district_text,
                city_id=eff_city,
            )
            field_values.update(geo)
            country_id = geo["country_id"]

        if category_ids is not None:
            await self._validate_categories(category_ids)
        if sub_category_ids is not None:
            await self._validate_sub_categories(sub_category_ids)
        if product_ids is not None:
            await self._validate_products(product_ids)

        if field_values.get("tax_id_number") is not None:
            await self._ensure_tax_id_unique(field_values["tax_id_number"], exclude_id=company_id)
        if field_values.get("contact_calling_number") is not None:
            await self._ensure_calling_number_unique(field_values["contact_calling_number"], exclude_id=company_id)

        new_company_name = field_values.get("company_name") or company.company_name
        new_city_id = field_values["city_id"] if "city_id" in field_values else company.city_id
        if field_values.get("company_name") is not None or "city_id" in field_values:
            if await self.repository.name_city_exists(new_company_name, new_city_id, exclude_id=company_id):
                existing = await self.repository.get_by_name_city(
                    new_company_name, new_city_id, exclude_id=company_id
                )
                raise ConflictException(
                    f"A company named {new_company_name!r} already exists in this city "
                    "(duplicate check: Company Name + City).",
                    details={"existing": model_to_dict(existing) if existing else None},
                )

        visited = field_values.get("visited_factory_office")
        visited = company.visited_factory_office if visited is None else visited
        visit_remarks = field_values.get("visit_remarks")
        visit_remarks = company.visit_remarks if visit_remarks is None else visit_remarks
        self._validate_visit_remarks(visited, visit_remarks)

        if "current_status" in field_values:
            self._validate_status_transition(company.current_status, field_values["current_status"])

        if "gst_registration_date" in field_values:
            computed_age = compute_company_age(field_values["gst_registration_date"])
            if computed_age is not None:
                field_values["age_of_company"] = computed_age
            elif not (field_values["gst_registration_date"] or "").strip():
                field_values["age_of_company"] = None  # date cleared -> age cleared
            else:
                field_values.pop("age_of_company", None)  # unreadable / future date: do not keep a client-made age

        # Conditional-field consistency (Potential / Business Type / Direct Import) on the merged values.
        def _eff(name: str) -> Any:
            return field_values[name] if name in field_values else getattr(company, name)

        def _val(x: Any) -> str:
            return (x.value if hasattr(x, "value") else str(x or "")).strip().lower()

        if _val(_eff("potential")) == "no" and not (_eff("potential_reason") or "").strip():
            raise BadRequestException("A reason is required when Potential is 'No'.")
        if _val(_eff("potential")) != "yes" and "potential_business_per_month" not in field_values:
            if company.potential_business_per_month:
                field_values["potential_business_per_month"] = None
        if _val(_eff("potential")) != "no" and "potential_reason" not in field_values and company.potential_reason:
            if "potential" in field_values:
                field_values["potential_reason"] = None
        if (_eff("company_type") or "").strip().upper() == "B2B" and company.sector and "sector" not in field_values:
            field_values["sector"] = None  # Sector belongs to B2C companies only
        if (_eff("company_type") or "").strip().upper() != "B2B":
            for dep in ("direct_import_from_china", "monthly_import_volume", "products_needed_for_imports"):
                if getattr(company, dep) and dep not in field_values:
                    field_values[dep] = None
        elif (_eff("direct_import_from_china") or "").strip().lower() != "yes":
            for dep in ("monthly_import_volume", "products_needed_for_imports"):
                if getattr(company, dep) and dep not in field_values:
                    field_values[dep] = None

        # Only what the client sent is applied, and an explicit null CLEARS the field (a blank form field used to be
        # silently ignored, so a cleared city / email / remark came back after save). Columns that can never be
        # blank are protected.
        not_nullable = {"company_name", "visited_factory_office", "is_active"}
        changes = {k: v for k, v in field_values.items() if v is not None or k not in not_nullable}
        if changes:
            await self.repository.update(company, **changes)

        if category_ids is not None:
            await self.repository.replace_category_links(company_id, category_ids)
        if sub_category_ids is not None:
            await self.repository.replace_sub_category_links(company_id, sub_category_ids)
        if product_ids is not None:
            await self.repository.replace_product_links(company_id, product_ids)
        if emails is not None:
            await self.repository.replace_emails(company_id, emails)

        # Keep mirrored primary contact in sync
        primary_contact_fields = {
            "contact_salutation",
            "contact_full_name",
            "contact_designation",
            "contact_calling_number",
            "contact_whatsapp_number",
            "contact_wechat_number",
        }
        if primary_contact_fields.intersection(field_values.keys()):
            primary = await self.contact_repository.get_primary_contact(company_id)
            if primary is not None:
                await self.contact_repository.update(
                    primary,
                    salutation=field_values.get("contact_salutation", primary.salutation),
                    person_name=field_values.get("contact_full_name", primary.person_name) or primary.person_name,
                    designation=field_values.get("contact_designation", primary.designation),
                    calling_number=field_values.get("contact_calling_number", primary.calling_number),
                    whatsapp_number=field_values.get("contact_whatsapp_number", primary.whatsapp_number),
                    wechat_number=field_values.get("contact_wechat_number", primary.wechat_number),
                )
            elif field_values.get("contact_full_name"):
                await self.contact_repository.create(
                    company_id=company_id,
                    salutation=field_values.get("contact_salutation"),
                    person_name=field_values["contact_full_name"],
                    designation=field_values.get("contact_designation"),
                    handling_territory=None,
                    country_id=country_id,
                    calling_number=field_values.get("contact_calling_number"),
                    whatsapp_number=field_values.get("contact_whatsapp_number"),
                    wechat_number=field_values.get("contact_wechat_number"),
                    email=None,
                    is_primary=True,
                )

        await self._invalidate_cache()
        return await self.get_by_id_or_raise(company_id)

    async def update_grade(self, company_id: uuid.UUID, company_grade: Any) -> Company:
        """List-view inline editable dropdown for Grade."""
        company = await self.get_by_id_or_raise(company_id)
        await self.repository.update(company, company_grade=company_grade)
        await self._invalidate_cache()
        return company

    async def update_potential(self, company_id: uuid.UUID, potential: Any) -> Company:
        """List-view inline editable dropdown for Potential."""
        company = await self.get_by_id_or_raise(company_id)
        extra: dict[str, Any] = {}
        if (potential.value if hasattr(potential, "value") else str(potential or "")).strip().lower() != "yes":
            extra["potential_business_per_month"] = None
        await self.repository.update(company, potential=potential, **extra)
        await self._invalidate_cache()
        return company

    async def deactivate(self, company_id: uuid.UUID) -> Company:
        """Set a company's is_active flag to False."""
        company = await self.get_by_id_or_raise(company_id)
        await self.repository.update(company, is_active=False)
        await self._invalidate_cache()
        return company

    async def activate(self, company_id: uuid.UUID) -> Company:
        """Set a company's is_active flag back to True."""
        company = await self.get_by_id_or_raise(company_id)
        await self.repository.update(company, is_active=True)
        await self._invalidate_cache()
        return company

    async def delete(self, company_id: uuid.UUID) -> None:
        """Soft-delete a company, enforcing eligibility rules."""
        company = await self.get_by_id_or_raise(company_id)
        if not self._can_delete(company):
            status_str = (company.current_status.value if hasattr(company.current_status, "value") else str(company.current_status or "")).strip().lower()
            if status_str == "existing":
                raise ConflictException(
                    "This company cannot be deleted because its Current Status is 'Existing'. "
                    "Companies with 'Existing' status cannot be deleted; you may toggle it to Inactive instead."
                )
            raise ConflictException(
                "This company cannot be deleted. Deletion is only permitted if Current Status is 'New' or blank, "
                "and Potential is 'No' (Not Potential). Set it to Inactive instead."
            )
        await self.repository.delete(company)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Contacts
    # ------------------------------------------------------------------

    async def add_contact(self, company_id: uuid.UUID, **field_values: Any) -> CompanyContact:
        """Add a contact person to a company."""
        await self.get_by_id_or_raise(company_id)
        if field_values.get("country_id"):
            if await self.country_repository.get_by_id(field_values["country_id"]) is None:
                raise BadRequestException("The specified country does not exist.")
        if field_values.get("calling_number"):
            await self._ensure_calling_number_unique(field_values["calling_number"])
        # Spec: Whatsapp Number is "by default - same as calling" when it is left blank.
        if not (field_values.get("whatsapp_number") or "").strip() and (field_values.get("calling_number") or "").strip():
            field_values["whatsapp_number"] = field_values["calling_number"]
        make_primary = bool(field_values.pop("is_primary", False))
        contact = await self.contact_repository.create(company_id=company_id, is_primary=False, **field_values)
        if make_primary:
            await self._set_primary_contact(company_id, contact)
        return contact

    async def _set_primary_contact(self, company_id: uuid.UUID, contact: CompanyContact) -> None:
        """Make ``contact`` the company's single primary contact and mirror it into the company profile fields."""
        for other in await self.contact_repository.list_for_company(company_id):
            if other.id != contact.id and other.is_primary:
                await self.contact_repository.update(other, is_primary=False)
        await self.contact_repository.update(contact, is_primary=True)
        company = await self.get_by_id_or_raise(company_id)
        await self.repository.update(
            company,
            contact_salutation=contact.salutation,
            contact_full_name=contact.person_name,
            contact_designation=contact.designation,
            contact_calling_number=contact.calling_number,
            contact_whatsapp_number=contact.whatsapp_number,
            contact_wechat_number=contact.wechat_number,
        )
        await self._invalidate_cache()

    async def get_contact_or_raise(self, company_id: uuid.UUID, contact_id: uuid.UUID) -> CompanyContact:
        """Fetch a single contact by ID, scoped to company, or raise :class:`NotFoundException`."""
        contact = await self.contact_repository.get_by_id(contact_id)
        if contact is None or contact.company_id != company_id:
            raise NotFoundException("Company contact not found.")
        return contact

    async def update_contact(self, company_id: uuid.UUID, contact_id: uuid.UUID, **field_values: Any) -> CompanyContact:
        """Update an existing contact person."""
        contact = await self.get_contact_or_raise(company_id, contact_id)
        if field_values.get("country_id"):
            if await self.country_repository.get_by_id(field_values["country_id"]) is None:
                raise BadRequestException("The specified country does not exist.")
        if field_values.get("calling_number"):
            await self._ensure_calling_number_unique(
                field_values["calling_number"],
                exclude_contact_id=contact_id,
            )
        is_primary = field_values.pop("is_primary", None)
        if is_primary is False and contact.is_primary:
            raise ConflictException(
                "A company must keep one primary contact. Mark another contact as primary instead."
            )
        # Explicit nulls clear a field (e.g. removing an email); the person's name can never be blank.
        changes = {k: v for k, v in field_values.items() if v is not None or k != "person_name"}
        if changes:
            await self.contact_repository.update(contact, **changes)
        if is_primary:
            await self._set_primary_contact(company_id, contact)
        elif contact.is_primary and changes:
            company = await self.get_by_id_or_raise(company_id)
            await self.repository.update(
                company,
                contact_salutation=contact.salutation,
                contact_full_name=contact.person_name,
                contact_designation=contact.designation,
                contact_calling_number=contact.calling_number,
                contact_whatsapp_number=contact.whatsapp_number,
                contact_wechat_number=contact.wechat_number,
            )
            await self._invalidate_cache()
        return contact

    async def delete_contact(self, company_id: uuid.UUID, contact_id: uuid.UUID) -> None:
        """Remove a contact person from a company."""
        contact = await self.get_contact_or_raise(company_id, contact_id)
        if contact.is_primary:
            raise ConflictException(
                "The primary contact (mirrored from the company's main profile) cannot be "
                "deleted directly. Edit the company's contact fields instead."
            )
        await self.contact_repository.delete(contact)

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(
        self, filename: str, raw_bytes: bytes, *, update_existing: bool = False
    ) -> ImportSummary:
        """Validate and import companies from an uploaded CSV/XLSX file with duplicate GST/Name/Phone detection and safe update mode."""
        import re

        rows = parse_rows_from_file(filename, raw_bytes)

        existing_companies = await self.repository.list_all()
        existing_name_map: dict[str, Company] = {}
        existing_gst_map: dict[str, Company] = {}
        existing_calling_map: dict[str, Company] = {}
        existing_whatsapp_map: dict[str, Company] = {}

        def _phone_keys(num: str | None) -> list[str]:
            if not num:
                return []
            digits = re.sub(r"\D", "", str(num))
            if len(digits) < 7:
                return []
            keys = [digits]
            if len(digits) > 10:
                keys.append(digits[-10:])
            return keys

        for comp in existing_companies:
            if comp.company_name and comp.company_name.strip():
                existing_name_map[comp.company_name.strip().lower()] = comp
            if comp.tax_id_number and comp.tax_id_number.strip():
                existing_gst_map[comp.tax_id_number.strip().upper()] = comp
            for pk in _phone_keys(comp.contact_calling_number):
                existing_calling_map[pk] = comp
            for pk in _phone_keys(comp.contact_whatsapp_number):
                existing_whatsapp_map[pk] = comp
            for c_row in getattr(comp, "contacts", []) or []:
                if getattr(c_row, "deleted_at", None) is not None:
                    continue
                for pk in _phone_keys(getattr(c_row, "calling_number", None)):
                    existing_calling_map.setdefault(pk, comp)
                for pk in _phone_keys(getattr(c_row, "whatsapp_number", None)):
                    existing_whatsapp_map.setdefault(pk, comp)

        all_countries = await self.country_repository.list_all()
        all_states = await self.state_repository.list_all()
        all_cities = await self.city_repository.list_all()
        all_cats = await self.category_repository.list_all()
        all_sub_cats = await self.sub_category_repository.list_all()
        all_prods = []
        if self.product_repository is not None:
            try:
                all_prods = await self.product_repository.list_all()
            except Exception:
                all_prods = []

        country_name_map = {str(c.id): c.name for c in all_countries}
        state_name_map = {str(s.id): s.name for s in all_states}
        city_name_map = {str(ct.id): ct.name for ct in all_cities}

        def _serialize_company_for_compare(s: Company) -> dict[str, Any]:
            emails_str = ", ".join(e.email for e in getattr(s, "emails", []) if getattr(e, "email", None))
            return {
                "Company Name": s.company_name,
                "Tax ID / GST Number": s.tax_id_number or "—",
                "Country": country_name_map.get(str(s.country_id), "—"),
                "State / Province": state_name_map.get(str(s.state_id), "—"),
                "City": city_name_map.get(str(s.city_id), "—"),
                "Company Type": str(s.company_type) if s.company_type else "—",
                "Company Grade": f"Grade {s.company_grade.value.upper()}" if s.company_grade else "—",
                "Current Status": (s.current_status.value if hasattr(s.current_status, "value") else str(s.current_status or "—")).capitalize(),
                "Contact Person": s.contact_full_name or "—",
                "Designation": s.contact_designation or "—",
                "Calling Number": s.contact_calling_number or "—",
                "WhatsApp Number": s.contact_whatsapp_number or "—",
                "WeChat Number": s.contact_wechat_number or "—",
                "Emails": emails_str or "—",
                "Primary Website": s.primary_website or "—",
                "Status": "active" if s.is_active else "inactive",
            }

        seen_batch_names: set[str] = set()
        seen_batch_gsts: set[str] = set()

        def _register_company_in_maps(comp: Company) -> None:
            if comp.company_name and comp.company_name.strip():
                existing_name_map[comp.company_name.strip().lower()] = comp
                seen_batch_names.add(comp.company_name.strip().lower())
            if comp.tax_id_number and comp.tax_id_number.strip():
                existing_gst_map[comp.tax_id_number.strip().upper()] = comp
                seen_batch_gsts.add(comp.tax_id_number.strip().upper())
            for pk in _phone_keys(comp.contact_calling_number):
                existing_calling_map[pk] = comp
            for pk in _phone_keys(comp.contact_whatsapp_number):
                existing_whatsapp_map[pk] = comp

        async def _create(field_values: dict[str, Any]) -> Company | tuple[str, Company]:
            company_name = (field_values.get("company_name") or "").strip()
            name_key = company_name.lower()
            tax_id_raw = field_values.get("tax_id_number")
            tax_id_clean = str(tax_id_raw).strip().upper() if tax_id_raw and str(tax_id_raw).strip() else ""
            if tax_id_clean:
                field_values["tax_id_number"] = tax_id_clean
            else:
                field_values["tax_id_number"] = None

            calling_num = field_values.get("contact_calling_number")
            wa_num = field_values.get("contact_whatsapp_number")

            country_raw = (field_values.pop("country_code", None) or "").strip()
            state_raw = (field_values.pop("state_name", None) or "").strip()
            city_raw = (field_values.pop("city_name", None) or "").strip()
            email_single = field_values.pop("email", None)
            emails_list = field_values.pop("emails", None)
            if not emails_list and email_single:
                emails_list = [email_single]
            cat_names_raw = field_values.pop("category_names_raw", None)
            sub_cat_names_raw = field_values.pop("sub_category_names_raw", None)
            prod_names_raw = field_values.pop("product_names_raw", None)
            visited_provided = bool(field_values.pop("_visited_provided", False))
            status_provided = bool(field_values.pop("_status_provided", False))

            # In-batch duplicate protection (strict in Add New mode; in Update mode, allow matching existing records)
            if not update_existing:
                if name_key and name_key in seen_batch_names:
                    dup = existing_name_map.get(name_key)
                    raise ConflictException(
                        f"Company '{company_name}' appears multiple times in the import file (duplicate company name).",
                        details={"existing": _serialize_company_for_compare(dup)} if dup else None,
                    )
                if tax_id_clean and tax_id_clean in seen_batch_gsts:
                    dup = existing_gst_map.get(tax_id_clean)
                    raise ConflictException(
                        f"GST / Tax ID '{tax_id_clean}' appears multiple times in the import file (duplicate GST number).",
                        details={"existing": _serialize_company_for_compare(dup)} if dup else None,
                    )

            # ----------------------------------------------------------
            # UPDATE EXISTING MODE: Match by Company Name or Tax ID / GST Number
            # ----------------------------------------------------------
            target_company: Company | None = None
            if update_existing:
                if name_key and name_key in existing_name_map:
                    target_company = existing_name_map[name_key]
                elif tax_id_clean and tax_id_clean in existing_gst_map:
                    target_company = existing_gst_map[tax_id_clean]

            if update_existing and target_company is not None:
                update_kwargs: dict[str, Any] = {}
                has_changes = False

                # If matched by GST and a new Company Name is provided, ensure the new name doesn't belong to another company
                if company_name and company_name.lower() != (target_company.company_name or "").strip().lower():
                    other_by_name = existing_name_map.get(company_name.lower())
                    if other_by_name is not None and other_by_name.id != target_company.id:
                        raise ConflictException(
                            f"Company '{company_name}' already exists as a separate record.",
                            details={"existing": _serialize_company_for_compare(other_by_name)},
                        )
                    update_kwargs["company_name"] = company_name
                    has_changes = True

                # Prevent changing GST to a GST already owned by a DIFFERENT company
                cur_gst = (target_company.tax_id_number or "").strip().upper()
                if tax_id_clean:
                    if tax_id_clean != cur_gst:
                        other_by_gst = existing_gst_map.get(tax_id_clean)
                        if other_by_gst is not None and other_by_gst.id != target_company.id:
                            raise ConflictException(
                                f"GST / Tax ID '{tax_id_clean}' already belongs to another company ('{other_by_gst.company_name}').",
                                details={"existing": _serialize_company_for_compare(other_by_gst)},
                            )
                        update_kwargs["tax_id_number"] = tax_id_clean
                        has_changes = True

                # Geography updates (only when provided in the uploaded row)
                target_country_id = target_company.country_id
                if country_raw:
                    matched_country = next(
                        (c for c in all_countries if c.code.upper() == country_raw.upper() or c.name.lower() == country_raw.lower()),
                        None,
                    )
                    if matched_country is None:
                        raise BadRequestException(f"Country '{country_raw}' does not exist in Country Master.")
                    if target_company.country_id != matched_country.id:
                        update_kwargs["country_id"] = matched_country.id
                        has_changes = True
                    target_country_id = matched_country.id

                target_state_id = target_company.state_id
                if state_raw:
                    matched_state = next(
                        (s for s in all_states if s.country_id == target_country_id and (s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower()))),
                        None,
                    )
                    if matched_state is None:
                        matched_state = next(
                            (s for s in all_states if s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower())),
                            None,
                        )
                    if matched_state is None:
                        raise BadRequestException(f"State '{state_raw}' does not exist in State Master.")
                    if target_company.state_id != matched_state.id:
                        update_kwargs["state_id"] = matched_state.id
                        has_changes = True
                    target_state_id = matched_state.id

                if city_raw:
                    matched_city = next(
                        (c for c in all_cities if c.state_id == target_state_id and c.name.lower() == city_raw.lower()),
                        None,
                    )
                    if matched_city is None:
                        matched_city = next((c for c in all_cities if c.name.lower() == city_raw.lower()), None)
                    if matched_city is None:
                        raise BadRequestException(f"City '{city_raw}' does not exist in City Master.")
                    if target_company.city_id != matched_city.id:
                        update_kwargs["city_id"] = matched_city.id
                        has_changes = True

                # Calling number collision check (only if changing to a number used by another company)
                call_keys = _phone_keys(calling_num)
                cur_call_keys = set(_phone_keys(target_company.contact_calling_number))
                if call_keys:
                    if not (set(call_keys) & cur_call_keys):
                        for ck in call_keys:
                            dup = existing_calling_map.get(ck) or existing_whatsapp_map.get(ck)
                            if dup is not None and dup.id != target_company.id:
                                raise ConflictException(
                                    f"Calling number '{calling_num}' already exists (used by '{dup.company_name}').",
                                    details={"existing": _serialize_company_for_compare(dup)},
                                )
                        update_kwargs["contact_calling_number"] = calling_num
                        has_changes = True
                    elif re.sub(r"\D", "", target_company.contact_calling_number or "") != re.sub(r"\D", "", str(calling_num)):
                        update_kwargs["contact_calling_number"] = calling_num
                        has_changes = True

                # WhatsApp number collision check
                wa_keys = _phone_keys(wa_num)
                cur_wa_keys = set(_phone_keys(target_company.contact_whatsapp_number))
                if wa_keys:
                    if not (set(wa_keys) & cur_wa_keys):
                        for wk in wa_keys:
                            dup = existing_whatsapp_map.get(wk) or existing_calling_map.get(wk)
                            if dup is not None and dup.id != target_company.id:
                                raise ConflictException(
                                    f"WhatsApp number '{wa_num}' already exists (used by '{dup.company_name}').",
                                    details={"existing": _serialize_company_for_compare(dup)},
                                )
                        update_kwargs["contact_whatsapp_number"] = wa_num
                        has_changes = True
                    elif re.sub(r"\D", "", target_company.contact_whatsapp_number or "") != re.sub(r"\D", "", str(wa_num)):
                        update_kwargs["contact_whatsapp_number"] = wa_num
                        has_changes = True

                # Categories
                category_ids: list[uuid.UUID] | None = None
                category_changed = False
                if cat_names_raw and str(cat_names_raw).strip():
                    category_ids = []
                    for cn in str(cat_names_raw).split(","):
                        cn_clean = cn.strip().lower()
                        if not cn_clean:
                            continue
                        matched_cat = next((c for c in all_cats if c.name.lower() == cn_clean), None)
                        if not matched_cat:
                            raise BadRequestException(f"Product Category '{cn.strip()}' does not exist in Category Master.")
                        category_ids.append(matched_cat.id)
                    curr_cat_ids = {link.category_id for link in getattr(target_company, "category_links", [])}
                    if set(category_ids) != curr_cat_ids:
                        category_changed = True
                        has_changes = True

                # Sub-Categories
                sub_category_ids: list[uuid.UUID] | None = None
                sub_category_changed = False
                if sub_cat_names_raw and str(sub_cat_names_raw).strip():
                    sub_category_ids = []
                    for scn in str(sub_cat_names_raw).split(","):
                        scn_clean = scn.strip().lower()
                        if not scn_clean:
                            continue
                        matched_sc = next((sc for sc in all_sub_cats if sc.name.lower() == scn_clean), None)
                        if not matched_sc:
                            raise BadRequestException(f"Product Sub Category '{scn.strip()}' does not exist in Sub Category Master.")
                        sub_category_ids.append(matched_sc.id)
                    curr_sc_ids = {link.sub_category_id for link in getattr(target_company, "sub_category_links", [])}
                    if set(sub_category_ids) != curr_sc_ids:
                        sub_category_changed = True
                        has_changes = True

                # Products Supplied
                product_ids: list[uuid.UUID] | None = None
                product_changed = False
                if prod_names_raw and str(prod_names_raw).strip() and all_prods:
                    product_ids = []
                    for pn in str(prod_names_raw).split(","):
                        pn_clean = pn.strip().lower()
                        if not pn_clean:
                            continue
                        matched_prod = next(
                            (
                                p for p in all_prods
                                if (p.product_name and p.product_name.lower() == pn_clean)
                                or (p.product_name_tally and p.product_name_tally.lower() == pn_clean)
                                or (p.product_code and p.product_code.lower() == pn_clean)
                            ),
                            None,
                        )
                        if matched_prod:
                            product_ids.append(matched_prod.id)
                    curr_prod_ids = {link.product_id for link in getattr(target_company, "product_links", [])}
                    if set(product_ids) != curr_prod_ids:
                        product_changed = True
                        has_changes = True

                # Status transition check (Existing cannot move back to New)
                if field_values.get("current_status") is not None:
                    self._validate_status_transition(target_company.current_status, field_values["current_status"])

                # Other non-blank fields (Zero Data Loss: blank cells never overwrite existing data)
                skip_fields = {
                    "company_name",
                    "tax_id_number",
                    "country_id",
                    "state_id",
                    "city_id",
                    "contact_calling_number",
                    "contact_whatsapp_number",
                    "visited_factory_office",
                    "is_active",
                }
                for k, v in field_values.items():
                    if k in skip_fields or v is None:
                        continue
                    cur_v = getattr(target_company, k, None)
                    cur_s = str(cur_v.value if hasattr(cur_v, "value") else (cur_v if cur_v is not None else "")).strip()
                    new_s = str(v.value if hasattr(v, "value") else (v if v is not None else "")).strip()
                    if new_s != "" and cur_s.lower() != new_s.lower():
                        update_kwargs[k] = v
                        has_changes = True

                if visited_provided:
                    new_vis = bool(field_values.get("visited_factory_office", False))
                    if bool(target_company.visited_factory_office) != new_vis:
                        update_kwargs["visited_factory_office"] = new_vis
                        has_changes = True

                if status_provided:
                    new_act = bool(field_values.get("is_active", True))
                    if bool(target_company.is_active) != new_act:
                        update_kwargs["is_active"] = new_act
                        has_changes = True

                eff_visited = update_kwargs.get("visited_factory_office", target_company.visited_factory_office)
                eff_visit_remarks = update_kwargs.get("visit_remarks", target_company.visit_remarks)
                if "visit_remarks" in update_kwargs:
                    self._validate_visit_remarks(bool(eff_visited), eff_visit_remarks)

                if update_kwargs.get("gst_registration_date"):
                    computed_age = compute_company_age(update_kwargs["gst_registration_date"])
                    if computed_age is not None:
                        update_kwargs["age_of_company"] = computed_age

                # Emails check
                emails_changed = False
                if emails_list:
                    curr_emails = [e.email.strip().lower() for e in getattr(target_company, "emails", []) if getattr(e, "email", None)]
                    new_emails = [e.strip().lower() for e in emails_list if e.strip()]
                    if sorted(curr_emails) != sorted(new_emails):
                        emails_changed = True
                        has_changes = True

                # Sync primary contact ONLY if contact fields or emails actually changed on this company
                contact_fields_changed = bool(
                    {
                        "contact_full_name",
                        "contact_salutation",
                        "contact_designation",
                        "contact_calling_number",
                        "contact_whatsapp_number",
                        "contact_wechat_number",
                    }
                    & set(update_kwargs.keys())
                ) or emails_changed
                contact_name = update_kwargs.get("contact_full_name") or field_values.get("contact_full_name")
                if contact_fields_changed and (contact_name or "contact_calling_number" in update_kwargs or "contact_whatsapp_number" in update_kwargs or "contact_designation" in update_kwargs):
                    primary_contact = next(
                        (c for c in getattr(target_company, "contacts", []) if c.is_primary and getattr(c, "deleted_at", None) is None),
                        None,
                    )
                    if primary_contact is None:
                        primary_contact = await self.contact_repository.get_primary_contact(target_company.id)
                    if primary_contact is not None:
                        c_updates: dict[str, Any] = {}
                        if contact_name and (primary_contact.person_name or "").strip() != str(contact_name).strip():
                            c_updates["person_name"] = str(contact_name).strip()
                        if field_values.get("contact_salutation") and (primary_contact.salutation or "").strip() != str(field_values["contact_salutation"]).strip():
                            c_updates["salutation"] = str(field_values["contact_salutation"]).strip()
                        if field_values.get("contact_designation") and (primary_contact.designation or "").strip() != str(field_values["contact_designation"]).strip():
                            c_updates["designation"] = str(field_values["contact_designation"]).strip()
                        if calling_num and (primary_contact.calling_number or "").strip() != str(calling_num).strip():
                            c_updates["calling_number"] = calling_num
                        if wa_num and (primary_contact.whatsapp_number or "").strip() != str(wa_num).strip():
                            c_updates["whatsapp_number"] = wa_num
                        if field_values.get("contact_wechat_number") and (primary_contact.wechat_number or "").strip() != str(field_values["contact_wechat_number"]).strip():
                            c_updates["wechat_number"] = str(field_values["contact_wechat_number"]).strip()
                        if emails_list and (primary_contact.email or "").strip().lower() != emails_list[0].strip().lower():
                            c_updates["email"] = emails_list[0].strip()
                        if c_updates:
                            has_changes = True
                            await self.contact_repository.update(primary_contact, **c_updates)
                    elif contact_name:
                        has_changes = True
                        await self.contact_repository.create(
                            company_id=target_company.id,
                            salutation=field_values.get("contact_salutation") or target_company.contact_salutation,
                            person_name=str(contact_name).strip(),
                            designation=field_values.get("contact_designation") or target_company.contact_designation,
                            handling_territory=None,
                            country_id=update_kwargs.get("country_id", target_company.country_id),
                            calling_number=calling_num or target_company.contact_calling_number,
                            whatsapp_number=wa_num or target_company.contact_whatsapp_number,
                            wechat_number=field_values.get("contact_wechat_number") or target_company.contact_wechat_number,
                            email=emails_list[0] if emails_list else None,
                            is_primary=True,
                        )

                if update_kwargs:
                    await self.repository.update(target_company, **update_kwargs)
                if category_ids is not None and category_changed:
                    await self.repository.replace_category_links(target_company.id, category_ids)
                if sub_category_ids is not None and sub_category_changed:
                    await self.repository.replace_sub_category_links(target_company.id, sub_category_ids)
                if product_ids is not None and product_changed:
                    await self.repository.replace_product_links(target_company.id, product_ids)
                if emails_list and emails_changed:
                    await self.repository.replace_emails(target_company.id, emails_list)

                _register_company_in_maps(target_company)
                if not has_changes:
                    return ("unchanged", target_company)
                return ("updated", target_company)

            # ----------------------------------------------------------
            # CREATE MODE (or new record in Update mode)
            # ----------------------------------------------------------
            if not company_name:
                raise BadRequestException("'Company Name' is required when creating a new company.")
            if not country_raw:
                raise BadRequestException("'Country' is required when creating a new company.")
            if not state_raw:
                raise BadRequestException("'State / Province' is required when creating a new company.")
            if not city_raw:
                raise BadRequestException("'City' is required when creating a new company.")

            # 1. Duplicate Company Name check
            if name_key in existing_name_map:
                dup_company = existing_name_map[name_key]
                raise ConflictException(
                    f"Company '{company_name}' already exists (duplicate company name).",
                    details={"existing": _serialize_company_for_compare(dup_company)},
                )

            # 2. Duplicate Tax ID / GST Number check
            if tax_id_clean and tax_id_clean in existing_gst_map:
                dup_company = existing_gst_map[tax_id_clean]
                raise ConflictException(
                    f"GST / Tax ID '{tax_id_clean}' already exists (used by '{dup_company.company_name}').",
                    details={"existing": _serialize_company_for_compare(dup_company)},
                )

            # 3. Duplicate Calling Number check
            for ck in _phone_keys(calling_num):
                dup_company = existing_calling_map.get(ck) or existing_whatsapp_map.get(ck)
                if dup_company is not None:
                    raise ConflictException(
                        f"Calling number '{calling_num}' already exists (used by '{dup_company.company_name}').",
                        details={"existing": _serialize_company_for_compare(dup_company)},
                    )

            # 4. Duplicate WhatsApp Number check
            for wk in _phone_keys(wa_num):
                dup_company = existing_whatsapp_map.get(wk) or existing_calling_map.get(wk)
                if dup_company is not None:
                    raise ConflictException(
                        f"WhatsApp number '{wa_num}' already exists (used by '{dup_company.company_name}').",
                        details={"existing": _serialize_company_for_compare(dup_company)},
                    )

            country = next(
                (c for c in all_countries if c.code.upper() == country_raw.upper() or c.name.lower() == country_raw.lower()),
                None,
            )
            if country is None:
                raise BadRequestException(f"Country '{country_raw}' does not exist in Country Master.")

            state = next(
                (s for s in all_states if s.country_id == country.id and (s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower()))),
                None,
            )
            if state is None:
                state = next((s for s in all_states if s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower())), None)
            if state is None:
                raise BadRequestException(f"State '{state_raw}' does not exist in State Master for Country '{country.name}'.")

            city = next(
                (c for c in all_cities if c.state_id == state.id and c.name.lower() == city_raw.lower()),
                None,
            )
            if city is None:
                city = next((c for c in all_cities if c.name.lower() == city_raw.lower()), None)
            if city is None:
                raise BadRequestException(f"City '{city_raw}' does not exist in City Master for State '{state.name}'.")

            field_values["country_id"] = country.id
            field_values["state_id"] = state.id
            field_values["city_id"] = city.id

            category_ids = []
            if cat_names_raw:
                for cn in str(cat_names_raw).split(","):
                    cn_clean = cn.strip().lower()
                    if not cn_clean:
                        continue
                    matched_cat = next((c for c in all_cats if c.name.lower() == cn_clean), None)
                    if not matched_cat:
                        raise BadRequestException(f"Product Category '{cn.strip()}' does not exist in Category Master.")
                    category_ids.append(matched_cat.id)
            field_values["category_ids"] = category_ids

            sub_category_ids = []
            if sub_cat_names_raw:
                for scn in str(sub_cat_names_raw).split(","):
                    scn_clean = scn.strip().lower()
                    if not scn_clean:
                        continue
                    matched_sc = next((sc for sc in all_sub_cats if sc.name.lower() == scn_clean), None)
                    if not matched_sc:
                        raise BadRequestException(f"Product Sub Category '{scn.strip()}' does not exist in Sub Category Master.")
                    sub_category_ids.append(matched_sc.id)
            field_values["sub_category_ids"] = sub_category_ids

            if prod_names_raw and all_prods:
                product_ids = []
                for pn in str(prod_names_raw).split(","):
                    pn_clean = pn.strip().lower()
                    if not pn_clean:
                        continue
                    matched_prod = next(
                        (
                            p for p in all_prods
                            if (p.product_name and p.product_name.lower() == pn_clean)
                            or (p.product_name_tally and p.product_name_tally.lower() == pn_clean)
                            or (p.product_code and p.product_code.lower() == pn_clean)
                        ),
                        None,
                    )
                    if matched_prod:
                        product_ids.append(matched_prod.id)
                field_values["product_ids"] = product_ids

            if emails_list:
                field_values["emails"] = emails_list

            self._validate_visit_remarks(
                field_values.get("visited_factory_office", False), field_values.get("visit_remarks")
            )

            company = await self.create(**field_values)
            _register_company_in_maps(company)
            return company

        summary = await run_import(
            rows,
            row_validator=lambda r, idx: validate_company_row(r, idx, allow_partial=update_existing),
            row_creator=_create,
            dedupe_keys=None if update_existing else ("company_name",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export companies to CSV or XLSX with clean human-readable business headers."""
        companies = await self.repository.list_all()

        countries = {c.id: c.name for c in await self.country_repository.list_all()}
        states = {s.id: s.name for s in await self.state_repository.list_all()}
        cities = {c.id: c.name for c in await self.city_repository.list_all()}
        categories = {c.id: c.name for c in await self.category_repository.list_all()}
        sub_categories = {sc.id: sc.name for sc in await self.sub_category_repository.list_all()}

        products = {}
        if self.product_repository:
            try:
                all_prods = await self.product_repository.list_all()
                products = {p.id: (p.product_name_tally or p.product_name or p.product_code) for p in all_prods}
            except Exception:
                pass

        import re

        def _fmt_phone_for_excel(val: str | None) -> str:
            if not val:
                return ""
            v = val.strip()
            # Insert a space after +CC (e.g. +919876543210 -> +91 9876543210) so Excel keeps it as text instead of 9.19E+11
            m = re.match(r"^\+(\d{1,3}?)(\d{10})$", v)
            if m:
                return f"+{m.group(1)} {m.group(2)}"
            return v

        rows = []
        seen_export_names: set[str] = set()
        for s in companies:
            norm_cname = (s.company_name or "").strip().lower()
            if norm_cname:
                if norm_cname in seen_export_names:
                    continue
                seen_export_names.add(norm_cname)
            emails = [e.email for e in s.emails]
            cat_names = [categories.get(link.category_id, "") for link in s.category_links if link.category_id in categories]
            sub_cat_names = [sub_categories.get(link.sub_category_id, "") for link in s.sub_category_links if link.sub_category_id in sub_categories]
            prod_names = [products.get(link.product_id, "") for link in s.product_links if link.product_id in products]

            rows.append(
                {
                    "Company Name": s.company_name,
                    "Product Categories": ", ".join(filter(None, cat_names)),
                    "Key Strength Sub-Categories": ", ".join(filter(None, sub_cat_names)),
                    "Products Supplied": ", ".join(filter(None, prod_names)),
                    "Secondary Products": s.secondary_products_description or "",
                    "Country": countries.get(s.country_id, ""),
                    "State / Province": states.get(s.state_id, ""),
                    "City": cities.get(s.city_id, ""),
                    "Brand Description": s.brand_description or "",
                    "Company Type": str(s.company_type) if s.company_type else "",
                    "Current Status": s.current_status.value.capitalize() if s.current_status else "",
                    "Company Grade": f"Grade {s.company_grade.value.upper()}" if s.company_grade else "",
                    "Potential": s.potential.value.capitalize() if s.potential else "",
                    "Potential Reason": s.potential_reason or "",
                    "Contact Person": s.contact_full_name or "",
                    "Designation": s.contact_designation or "",
                    "Calling Number": _fmt_phone_for_excel(s.contact_calling_number),
                    "WhatsApp Number": _fmt_phone_for_excel(s.contact_whatsapp_number),
                    "WeChat Number": _fmt_phone_for_excel(s.contact_wechat_number),
                    "Emails": ", ".join(emails),
                    "Tax ID / GST Number": s.tax_id_number or "",
                    "Address": s.address or "",
                    "Town": s.town or "",
                    "Primary Website": s.primary_website or "",
                    "Secondary Website": s.secondary_website or "",
                    "Visited Factory/Office": "Yes" if s.visited_factory_office else "No",
                    "Visit Remarks": s.visit_remarks or "",
                    "Overall Remarks": s.overall_remarks or "",
                    "Status": "active" if s.is_active else "inactive",
                }
            )
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Companies")