"""
Supplier Service.

Business logic for supplier CRUD, encoding every rule from the "Supplier
Profile" specification document's Notes section:

- Duplicate detection: Tax ID / GST Number (`tax_id_number`) match is rejected as a duplicate.
- Current Status may only move NEW -> EXISTING, never back.
- Delete is only permitted when Current Status is New/unset AND Potential
  is No/unset; otherwise the record can only be deactivated (is_active=False).
- The First Data Form's contact fields are mirrored into a primary
  SupplierContact row automatically, so "First Form contact details should
  appear in the Contact list also."
- Visit Remarks only makes sense when Visited Factory/Office is True.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.cities.repository import CityRepository
from app.masters.countries.repository import CountryRepository
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository
from app.masters.products.repository import ProductRepository
from app.masters.states.repository import StateRepository
from app.planning.ws_manager import notify_source_record_changed, refresh_planning_cells_for_record
from app.suppliers.constants import EXPORT_HEADERS
from app.suppliers.models import Supplier, SupplierContact, SupplierCurrentStatus
from app.suppliers.repository import SupplierContactRepository, SupplierRepository
from app.suppliers.validators import validate_supplier_row
from app.masters.import_export import (
    ImportSummary,
    build_csv_export,
    build_excel_export,
    model_to_dict,
    parse_rows_from_file,
    run_import,
)

DROPDOWN_CACHE_NAME = "suppliers"


class SupplierService:
    """Orchestrates supplier profile management on top of :class:`SupplierRepository`."""

    not_found_message = "Supplier not found."

    def __init__(
        self,
        repository: SupplierRepository,
        contact_repository: SupplierContactRepository,
        country_repository: CountryRepository,
        state_repository: StateRepository,
        city_repository: CityRepository,
        category_repository: ProductCategoryRepository,
        sub_category_repository: ProductSubCategoryRepository,
        cache_manager: CacheManager,
        product_repository: ProductRepository | None = None,
    ) -> None:
        """Bind this service to its repository, every referenced master's repository, and the cache manager."""
        self.repository = repository
        self.contact_repository = contact_repository
        self.country_repository = country_repository
        self.state_repository = state_repository
        self.city_repository = city_repository
        self.category_repository = category_repository
        self.sub_category_repository = sub_category_repository
        self.cache_manager = cache_manager
        self.product_repository = product_repository

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def get_by_id_or_raise(self, supplier_id: uuid.UUID) -> Supplier:
        """Fetch a supplier by ID or raise :class:`NotFoundException`."""
        supplier = await self.repository.get_with_relations(supplier_id)
        if supplier is None:
            raise NotFoundException(self.not_found_message)
        return supplier

    async def list_paginated(
        self,
        query: ListQueryParams,
        *,
        category_id: uuid.UUID | None = None,
        sub_category_id: uuid.UUID | None = None,
        product_id: uuid.UUID | None = None,
    ) -> tuple[list[Supplier], int]:
        """
        Return a page of suppliers matching search/sort/filter, plus the
        document's Top Filter Fields for Product Category and Key Strength
        Product Sub Category, plus a Product filter ("which suppliers
        supply this exact SKU") -- all three are many-to-many, so handled
        outside the generic single-value filter framework.
        """
        if category_id is None and sub_category_id is None and product_id is None:
            return await self.repository.paginated_list(query)

        # Category/sub-category/product filters require a custom
        # EXISTS-based WHERE clause the generic BaseRepository.paginated_list
        # doesn't support, so we replicate its search/sort/paginate steps
        # here with the additional predicate(s) applied.
        base_stmt = self.repository._base_select()
        base_stmt = self.repository._apply_search(base_stmt, query.search.normalized)
        base_stmt = self.repository._apply_dynamic_filters(base_stmt, query.filters)
        if category_id is not None:
            base_stmt = self.repository.apply_category_filter(base_stmt, category_id)
        if sub_category_id is not None:
            base_stmt = self.repository.apply_sub_category_filter(base_stmt, sub_category_id)
        if product_id is not None:
            base_stmt = self.repository.apply_product_filter(base_stmt, product_id)

        from sqlalchemy import func, select

        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int((await self.repository.session.execute(count_stmt)).scalar_one())

        list_stmt = self.repository._apply_sort(base_stmt, query.sort)
        list_stmt = list_stmt.offset(query.page.offset).limit(query.page.limit)
        result = await self.repository.session.execute(list_stmt)
        items = list(result.scalars().unique().all())
        return items, total

    async def get_category_ids(self, supplier_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every product-category ID linked to a supplier."""
        return await self.repository.list_all_category_ids(supplier_id)

    async def get_sub_category_ids(self, supplier_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every product-sub-category ID linked to a supplier."""
        return await self.repository.list_all_sub_category_ids(supplier_id)

    async def get_product_ids(self, supplier_id: uuid.UUID) -> list[uuid.UUID]:
        """Return every Product ID linked to a supplier (the specific SKUs this supplier supplies)."""
        return await self.repository.list_all_product_ids(supplier_id)

    async def list_contacts(self, supplier_id: uuid.UUID) -> list[SupplierContact]:
        """Return every contact person for a supplier."""
        return await self.contact_repository.list_for_supplier(supplier_id)

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------

    async def _validate_geography(self, country_id: uuid.UUID, state_id: uuid.UUID, city_id: uuid.UUID) -> None:
        """Ensure country/state/city exist and are mutually consistent."""
        if await self.country_repository.get_by_id(country_id) is None:
            raise BadRequestException("The specified country does not exist.")
        state = await self.state_repository.get_by_id(state_id)
        if state is None:
            raise BadRequestException("The specified state/province does not exist.")
        if state.country_id != country_id:
            raise BadRequestException("The specified state does not belong to the specified country.")
        city = await self.city_repository.get_by_id(city_id)
        if city is None:
            raise BadRequestException("The specified city does not exist.")
        if city.state_id != state_id:
            raise BadRequestException("The specified city does not belong to the specified state.")

    async def _validate_categories(self, category_ids: list[uuid.UUID]) -> None:
        """
        Ensure every given product category exists, in ONE query.

        Phase 3 N+1 fix: this used to call ``get_by_id`` in a loop, one
        round trip per category ID, on every single create/update. See
        ``app.buyers.service.BuyerService._validate_categories`` for the
        identical fix applied there.
        """
        if not category_ids:
            return
        found = await self.category_repository.get_by_ids(category_ids)
        missing = [str(cid) for cid in category_ids if cid not in found]
        if missing:
            raise BadRequestException(f"Product category {missing[0]} does not exist.")

    async def _validate_sub_categories(self, sub_category_ids: list[uuid.UUID]) -> None:
        """Ensure every given product sub-category exists, in ONE query -- see ``_validate_categories``."""
        if not sub_category_ids:
            return
        found = await self.sub_category_repository.get_by_ids(sub_category_ids)
        missing = [str(sid) for sid in sub_category_ids if sid not in found]
        if missing:
            raise BadRequestException(f"Product sub-category {missing[0]} does not exist.")

    async def _validate_products(self, product_ids: list[uuid.UUID]) -> None:
        """Ensure every given product exists (Products is the central item master; see its module docstring), in ONE query."""
        if not product_ids:
            return
        if self.product_repository is None:
            raise BadRequestException("Product linking is not available in this context.")
        found = await self.product_repository.get_by_ids(product_ids)
        missing = [str(pid) for pid in product_ids if pid not in found]
        if missing:
            raise BadRequestException(f"Product {missing[0]} does not exist.")

    def _validate_visit_remarks(self, visited: bool, visit_remarks: str | None) -> None:
        """
        Document: "Visit Remarks (if in above yes, then only this field opens)".

        Interpreted as: remarks are only meaningful/storable when
        visited_factory_office is True. Rather than silently dropping
        data the user may have typed before toggling the switch back to
        No, we reject the combination explicitly so the user corrects it.
        """
        if visit_remarks and not visited:
            raise BadRequestException(
                "Visit Remarks can only be set when 'Visited Factory/Office' is Yes."
            )

    def _validate_status_transition(self, existing_status: SupplierCurrentStatus | None, new_status: Any) -> None:
        """
        Document Notes: "once changed from 'New' to 'Existing', then cannot
        edit back to 'New' (only 1 way can change -- new to existing)".
        """
        if new_status is None:
            return
        if existing_status == SupplierCurrentStatus.EXISTING and new_status == SupplierCurrentStatus.NEW:
            raise ConflictException(
                "Current Status cannot be changed from 'Existing' back to 'New'."
            )

    def _can_delete(self, supplier: Supplier) -> bool:
        """
        Document Notes: "If Current Status is 'New or Select' and Potential
        is 'No or Select', then only to allow Delete. If Current Status is
        'Existing' or Potential is 'Yes' (any one), cannot DELETE that data.
        However, can make it 'Inactive'".
        """
        status_blocks_delete = supplier.current_status == SupplierCurrentStatus.EXISTING
        potential_blocks_delete = supplier.potential is not None and supplier.potential.value == "yes"
        return not (status_blocks_delete or potential_blocks_delete)

    async def _invalidate_cache(self) -> None:
        """Invalidate the suppliers dropdown cache after any mutation."""
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    # ------------------------------------------------------------------
    # Create / Update
    # ------------------------------------------------------------------

    async def _ensure_tax_id_unique(self, tax_id: str | None, *, exclude_id: uuid.UUID | None = None) -> None:
        """Spec: a duplicate GST number must be refused with an 'already exists' message."""
        if tax_id and await self.repository.tax_id_exists(tax_id, exclude_id=exclude_id):
            raise ConflictException(f"A supplier with GST number {tax_id.strip().upper()!r} already exists.")

    async def create(self, **field_values: Any) -> Supplier:
        """
        Create a new supplier profile.

        Validates geography consistency, category/sub-category existence,
        the GST (`tax_id_number`) duplicate rule, and the visit-remarks rule;
        mirrors the First-Data-Form contact into a primary SupplierContact
        row; and persists emails/category/sub-category links.
        """
        country_id = field_values["country_id"]
        state_id = field_values["state_id"]
        city_id = field_values["city_id"]
        category_ids = field_values.pop("category_ids", []) or []
        sub_category_ids = field_values.pop("sub_category_ids", []) or []
        product_ids = field_values.pop("product_ids", []) or []
        emails = field_values.pop("emails", []) or []

        await self._validate_geography(country_id, state_id, city_id)
        await self._validate_categories(category_ids)
        await self._validate_sub_categories(sub_category_ids)
        await self._validate_products(product_ids)
        self._validate_visit_remarks(
            field_values.get("visited_factory_office", False), field_values.get("visit_remarks")
        )

        await self._ensure_tax_id_unique(field_values.get("tax_id_number"))

        supplier = await self.repository.create(**field_values)

        await self.repository.replace_category_links(supplier.id, category_ids)
        await self.repository.replace_sub_category_links(supplier.id, sub_category_ids)
        await self.repository.replace_product_links(supplier.id, product_ids)
        await self.repository.replace_emails(supplier.id, emails)

        # Mirror the First Data Form's contact into the contacts list, per
        # the document's Note. Only created if a contact name was actually
        # provided on the first form.
        if field_values.get("contact_full_name"):
            await self.contact_repository.create(
                supplier_id=supplier.id,
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
        return await self.get_by_id_or_raise(supplier.id)

    async def update(self, supplier_id: uuid.UUID, **field_values: Any) -> Supplier:
        """Update an existing supplier profile, enforcing every document business rule."""
        supplier = await self.get_by_id_or_raise(supplier_id)

        category_ids = field_values.pop("category_ids", None)
        sub_category_ids = field_values.pop("sub_category_ids", None)
        product_ids = field_values.pop("product_ids", None)
        emails = field_values.pop("emails", None)

        country_id = field_values.get("country_id") or supplier.country_id
        state_id = field_values.get("state_id") or supplier.state_id
        city_id = field_values.get("city_id") or supplier.city_id
        if any(k in field_values for k in ("country_id", "state_id", "city_id")):
            await self._validate_geography(country_id, state_id, city_id)

        if category_ids is not None:
            await self._validate_categories(category_ids)
        if sub_category_ids is not None:
            await self._validate_sub_categories(sub_category_ids)
        if product_ids is not None:
            await self._validate_products(product_ids)

        if field_values.get("tax_id_number") is not None:
            await self._ensure_tax_id_unique(field_values["tax_id_number"], exclude_id=supplier_id)

        visited = field_values.get("visited_factory_office")
        visited = supplier.visited_factory_office if visited is None else visited
        visit_remarks = field_values.get("visit_remarks")
        visit_remarks = supplier.visit_remarks if visit_remarks is None else visit_remarks
        self._validate_visit_remarks(visited, visit_remarks)

        if "current_status" in field_values:
            self._validate_status_transition(supplier.current_status, field_values["current_status"])

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.repository.update(supplier, **changes)

        if category_ids is not None:
            await self.repository.replace_category_links(supplier_id, category_ids)
        if sub_category_ids is not None:
            await self.repository.replace_sub_category_links(supplier_id, sub_category_ids)
        if product_ids is not None:
            await self.repository.replace_product_links(supplier_id, product_ids)
        if emails is not None:
            await self.repository.replace_emails(supplier_id, emails)

        # Keep the mirrored primary contact in sync if First-Data-Form
        # contact fields were edited.
        primary_contact_fields = {
            "contact_salutation",
            "contact_full_name",
            "contact_designation",
            "contact_calling_number",
            "contact_whatsapp_number",
            "contact_wechat_number",
        }
        if primary_contact_fields.intersection(field_values.keys()):
            primary = await self.contact_repository.get_primary_contact(supplier_id)
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
                    supplier_id=supplier_id,
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
        # Same store-on-write hook as Products.update -- Suppliers is a
        # registered Shipment Planning source module too (see
        # app.planning.source_registry's supplier module), so any
        # LINKED_LOOKUP/AGGREGATE cell pulling from this supplier needs
        # its stored value refreshed after an edit.
        await notify_source_record_changed("supplier", supplier_id)
        await refresh_planning_cells_for_record(self.repository.session, "supplier", supplier_id)
        return await self.get_by_id_or_raise(supplier_id)

    async def update_grade(self, supplier_id: uuid.UUID, supplier_grade: Any) -> Supplier:
        """List-view inline "editable dropdown" for Supplier's Grade."""
        supplier = await self.get_by_id_or_raise(supplier_id)
        await self.repository.update(supplier, supplier_grade=supplier_grade)
        await self._invalidate_cache()
        # Bypasses update() above, but supplier_grade is itself a
        # registered Planning source field (see source_registry's
        # supplier module) -- needs the same refresh hook.
        await notify_source_record_changed("supplier", supplier_id)
        await refresh_planning_cells_for_record(self.repository.session, "supplier", supplier_id)
        return supplier

    async def update_potential(self, supplier_id: uuid.UUID, potential: Any) -> Supplier:
        """List-view inline "editable dropdown" for Potential."""
        supplier = await self.get_by_id_or_raise(supplier_id)
        await self.repository.update(supplier, potential=potential)
        await self._invalidate_cache()
        return supplier

    async def deactivate(self, supplier_id: uuid.UUID) -> Supplier:
        """Set a supplier's is_active flag to False (always permitted, per the document's Notes)."""
        supplier = await self.get_by_id_or_raise(supplier_id)
        await self.repository.update(supplier, is_active=False)
        await self._invalidate_cache()
        return supplier

    async def activate(self, supplier_id: uuid.UUID) -> Supplier:
        """Set a supplier's is_active flag back to True."""
        supplier = await self.get_by_id_or_raise(supplier_id)
        await self.repository.update(supplier, is_active=True)
        await self._invalidate_cache()
        return supplier

    async def delete(self, supplier_id: uuid.UUID) -> None:
        """
        Soft-delete a supplier, enforcing the document's delete-eligibility rule.

        Only permitted when Current Status is New/unset AND Potential is
        No/unset. Otherwise raises; the caller should deactivate instead.
        """
        supplier = await self.get_by_id_or_raise(supplier_id)
        if not self._can_delete(supplier):
            raise ConflictException(
                "This supplier cannot be deleted because its Current Status is 'Existing' or "
                "Potential is 'Yes'. Set it to Inactive instead."
            )
        await self.repository.delete(supplier)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Contacts
    # ------------------------------------------------------------------

    async def add_contact(self, supplier_id: uuid.UUID, **field_values: Any) -> SupplierContact:
        """Add a contact person to a supplier (document: "Add Contacts Form")."""
        await self.get_by_id_or_raise(supplier_id)
        if field_values.get("country_id"):
            if await self.country_repository.get_by_id(field_values["country_id"]) is None:
                raise BadRequestException("The specified country does not exist.")
        contact = await self.contact_repository.create(supplier_id=supplier_id, is_primary=False, **field_values)
        return contact

    async def get_contact_or_raise(self, supplier_id: uuid.UUID, contact_id: uuid.UUID) -> SupplierContact:
        """Fetch a single contact by ID, scoped to its supplier, or raise :class:`NotFoundException`."""
        contact = await self.contact_repository.get_by_id(contact_id)
        if contact is None or contact.supplier_id != supplier_id:
            raise NotFoundException("Supplier contact not found.")
        return contact

    async def update_contact(self, supplier_id: uuid.UUID, contact_id: uuid.UUID, **field_values: Any) -> SupplierContact:
        """Update an existing contact person."""
        contact = await self.get_contact_or_raise(supplier_id, contact_id)
        if field_values.get("country_id"):
            if await self.country_repository.get_by_id(field_values["country_id"]) is None:
                raise BadRequestException("The specified country does not exist.")
        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.contact_repository.update(contact, **changes)
        return contact

    async def delete_contact(self, supplier_id: uuid.UUID, contact_id: uuid.UUID) -> None:
        """
        Remove a contact person from a supplier.

        Refuses to delete the auto-mirrored primary contact directly --
        that one is edited through the supplier's own First-Data-Form
        contact fields (via ``update()``), not deleted independently,
        since deleting it would desynchronize the supplier record itself.
        """
        contact = await self.get_contact_or_raise(supplier_id, contact_id)
        if contact.is_primary:
            raise ConflictException(
                "The primary contact (mirrored from the supplier's main profile) cannot be "
                "deleted directly. Edit the supplier's contact fields instead."
            )
        await self.contact_repository.delete(contact)

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def import_file(
        self, filename: str, raw_bytes: bytes, *, update_existing: bool = False
    ) -> ImportSummary:
        """
        Validate and import suppliers from an uploaded CSV/XLSX file.

        Uses Tax ID / GST Number (`tax_id_number`) as the duplicate criterion
        in Add New mode, and supports safe non-destructive updates (Zero Data Loss)
        when ``update_existing=True``.
        """
        import re

        rows = parse_rows_from_file(filename, raw_bytes)

        # Pre-fetch existing suppliers for GST duplicate detection and update matching
        existing_suppliers = await self.repository.list_all()
        existing_name_map: dict[str, Supplier] = {}
        existing_gst_map: dict[str, Supplier] = {}
        for s in existing_suppliers:
            if s.company_name and s.company_name.strip():
                existing_name_map[s.company_name.strip().lower()] = s
            if s.tax_id_number and s.tax_id_number.strip():
                existing_gst_map[s.tax_id_number.strip().upper()] = s

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

        def _serialize_supplier_for_compare(s: Supplier) -> dict[str, Any]:
            emails_str = ", ".join(e.email for e in getattr(s, "emails", []) if getattr(e, "email", None))
            return {
                "Company Name": s.company_name,
                "Tax ID / GST Number": s.tax_id_number or "—",
                "Country": country_name_map.get(str(s.country_id), "—"),
                "State / Province": state_name_map.get(str(s.state_id), "—"),
                "City": city_name_map.get(str(s.city_id), "—"),
                "Supplier Type": str(s.supplier_type) if s.supplier_type else "—",
                "Supplier Grade": f"Grade {s.supplier_grade.value.upper()}" if s.supplier_grade else "—",
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

        seen_batch_gsts: set[str] = set()

        def _register_supplier_in_maps(sup: Supplier) -> None:
            if sup.company_name and sup.company_name.strip():
                existing_name_map[sup.company_name.strip().lower()] = sup
            if sup.tax_id_number and sup.tax_id_number.strip():
                existing_gst_map[sup.tax_id_number.strip().upper()] = sup
                seen_batch_gsts.add(sup.tax_id_number.strip().upper())

        async def _create(field_values: dict[str, Any]) -> Supplier | tuple[str, Supplier]:
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

            # In-batch duplicate GST protection in Add New mode
            if not update_existing and tax_id_clean and tax_id_clean in seen_batch_gsts:
                dup = existing_gst_map.get(tax_id_clean)
                raise ConflictException(
                    f"GST / Tax ID '{tax_id_clean}' appears multiple times in the import file (duplicate GST number).",
                    details={"existing": _serialize_supplier_for_compare(dup)} if dup else None,
                )

            # ----------------------------------------------------------
            # UPDATE EXISTING MODE: Match by Tax ID / GST Number (or Company Name)
            # ----------------------------------------------------------
            target_supplier: Supplier | None = None
            if update_existing:
                if tax_id_clean and tax_id_clean in existing_gst_map:
                    target_supplier = existing_gst_map[tax_id_clean]
                elif name_key and name_key in existing_name_map:
                    target_supplier = existing_name_map[name_key]

            if update_existing and target_supplier is not None:
                update_kwargs: dict[str, Any] = {}
                has_changes = False

                if company_name and company_name.lower() != (target_supplier.company_name or "").strip().lower():
                    update_kwargs["company_name"] = company_name
                    has_changes = True
                elif company_name and company_name != (target_supplier.company_name or "").strip():
                    update_kwargs["company_name"] = company_name
                    has_changes = True

                # Prevent changing GST to a GST already owned by a DIFFERENT supplier
                cur_gst = (target_supplier.tax_id_number or "").strip().upper()
                if tax_id_clean:
                    if tax_id_clean != cur_gst:
                        other_by_gst = existing_gst_map.get(tax_id_clean)
                        if other_by_gst is not None and other_by_gst.id != target_supplier.id:
                            raise ConflictException(
                                f"GST / Tax ID '{tax_id_clean}' already belongs to another supplier ('{other_by_gst.company_name}').",
                                details={"existing": _serialize_supplier_for_compare(other_by_gst)},
                            )
                        update_kwargs["tax_id_number"] = tax_id_clean
                        has_changes = True

                # Geography updates (only when provided in the uploaded row)
                target_country_id = target_supplier.country_id
                if country_raw:
                    matched_country = next(
                        (c for c in all_countries if c.code.upper() == country_raw.upper() or c.name.lower() == country_raw.lower()),
                        None,
                    )
                    if matched_country is None:
                        raise BadRequestException(f"Country '{country_raw}' does not exist in Country Master.")
                    if target_supplier.country_id != matched_country.id:
                        update_kwargs["country_id"] = matched_country.id
                        has_changes = True
                    target_country_id = matched_country.id

                target_state_id = target_supplier.state_id
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
                    if target_supplier.state_id != matched_state.id:
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
                    if target_supplier.city_id != matched_city.id:
                        update_kwargs["city_id"] = matched_city.id
                        has_changes = True

                if calling_num:
                    if re.sub(r"\D", "", target_supplier.contact_calling_number or "") != re.sub(r"\D", "", str(calling_num)):
                        update_kwargs["contact_calling_number"] = calling_num
                        has_changes = True

                if wa_num:
                    if re.sub(r"\D", "", target_supplier.contact_whatsapp_number or "") != re.sub(r"\D", "", str(wa_num)):
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
                    curr_cat_ids = {link.category_id for link in getattr(target_supplier, "category_links", [])}
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
                    curr_sc_ids = {link.sub_category_id for link in getattr(target_supplier, "sub_category_links", [])}
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
                    curr_prod_ids = {link.product_id for link in getattr(target_supplier, "product_links", [])}
                    if set(product_ids) != curr_prod_ids:
                        product_changed = True
                        has_changes = True

                # Status transition check (Existing cannot move back to New)
                if field_values.get("current_status") is not None:
                    self._validate_status_transition(target_supplier.current_status, field_values["current_status"])

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
                    cur_v = getattr(target_supplier, k, None)
                    cur_s = str(cur_v.value if hasattr(cur_v, "value") else (cur_v if cur_v is not None else "")).strip()
                    new_s = str(v.value if hasattr(v, "value") else (v if v is not None else "")).strip()
                    if new_s != "" and cur_s.lower() != new_s.lower():
                        update_kwargs[k] = v
                        has_changes = True

                if visited_provided:
                    new_vis = bool(field_values.get("visited_factory_office", False))
                    if bool(target_supplier.visited_factory_office) != new_vis:
                        update_kwargs["visited_factory_office"] = new_vis
                        has_changes = True

                if status_provided:
                    new_act = bool(field_values.get("is_active", True))
                    if bool(target_supplier.is_active) != new_act:
                        update_kwargs["is_active"] = new_act
                        has_changes = True

                eff_visited = update_kwargs.get("visited_factory_office", target_supplier.visited_factory_office)
                eff_visit_remarks = update_kwargs.get("visit_remarks", target_supplier.visit_remarks)
                if "visit_remarks" in update_kwargs:
                    self._validate_visit_remarks(bool(eff_visited), eff_visit_remarks)

                # Emails check
                emails_changed = False
                if emails_list:
                    curr_emails = [e.email.strip().lower() for e in getattr(target_supplier, "emails", []) if getattr(e, "email", None)]
                    new_emails = [e.strip().lower() for e in emails_list if e.strip()]
                    if sorted(curr_emails) != sorted(new_emails):
                        emails_changed = True
                        has_changes = True

                # Sync primary contact ONLY if contact fields or emails actually changed
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
                        (c for c in getattr(target_supplier, "contacts", []) if c.is_primary and getattr(c, "deleted_at", None) is None),
                        None,
                    )
                    if primary_contact is None:
                        primary_contact = await self.contact_repository.get_primary_contact(target_supplier.id)
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
                            supplier_id=target_supplier.id,
                            salutation=field_values.get("contact_salutation") or target_supplier.contact_salutation,
                            person_name=str(contact_name).strip(),
                            designation=field_values.get("contact_designation") or target_supplier.contact_designation,
                            handling_territory=None,
                            country_id=update_kwargs.get("country_id", target_supplier.country_id),
                            calling_number=calling_num or target_supplier.contact_calling_number,
                            whatsapp_number=wa_num or target_supplier.contact_whatsapp_number,
                            wechat_number=field_values.get("contact_wechat_number") or target_supplier.contact_wechat_number,
                            email=emails_list[0] if emails_list else None,
                            is_primary=True,
                        )

                if update_kwargs:
                    await self.repository.update(target_supplier, **update_kwargs)
                if category_ids is not None and category_changed:
                    await self.repository.replace_category_links(target_supplier.id, category_ids)
                if sub_category_ids is not None and sub_category_changed:
                    await self.repository.replace_sub_category_links(target_supplier.id, sub_category_ids)
                if product_ids is not None and product_changed:
                    await self.repository.replace_product_links(target_supplier.id, product_ids)
                if emails_list and emails_changed:
                    await self.repository.replace_emails(target_supplier.id, emails_list)

                _register_supplier_in_maps(target_supplier)
                if not has_changes:
                    return ("unchanged", target_supplier)
                return ("updated", target_supplier)

            # ----------------------------------------------------------
            # CREATE MODE (or new record in Update mode)
            # ----------------------------------------------------------
            if not company_name:
                raise BadRequestException("'Company Name' is required when creating a new supplier.")
            if not tax_id_clean:
                raise BadRequestException("'Tax ID / GST Number' is required when creating a new supplier.")
            if not country_raw:
                raise BadRequestException("'Country' is required when creating a new supplier.")
            if not state_raw:
                raise BadRequestException("'State / Province' is required when creating a new supplier.")
            if not city_raw:
                raise BadRequestException("'City' is required when creating a new supplier.")

            # Duplicate check on Tax ID / GST Number ONLY (per requirement)
            if tax_id_clean in existing_gst_map:
                dup_supplier = existing_gst_map[tax_id_clean]
                raise ConflictException(
                    f"A supplier with GST number '{tax_id_clean}' already exists (used by '{dup_supplier.company_name}').",
                    details={"existing": _serialize_supplier_for_compare(dup_supplier)},
                )

            # 1. Strict Country validation (by code or name)
            country = next(
                (c for c in all_countries if c.code.upper() == country_raw.upper() or c.name.lower() == country_raw.lower()),
                None,
            )
            if country is None:
                raise BadRequestException(f"Country '{country_raw}' does not exist in Country Master.")

            # 2. Strict State validation
            state = next(
                (s for s in all_states if s.country_id == country.id and (s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower()))),
                None,
            )
            if state is None:
                state = next((s for s in all_states if s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower())), None)
            if state is None:
                raise BadRequestException(f"State '{state_raw}' does not exist in State Master for Country '{country.name}'.")

            # 3. Strict City validation
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

            # Strict Category validation
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

            # Strict Sub-Category validation
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

            supplier = await self.create(**field_values)
            _register_supplier_in_maps(supplier)
            return supplier

        summary = await run_import(
            rows,
            row_validator=lambda r, idx: validate_supplier_row(r, idx, allow_partial=update_existing),
            row_creator=_create,
            dedupe_keys=None if update_existing else ("tax_id_number",),
        )
        await self._invalidate_cache()
        return summary

    async def export_file(self, file_format: str) -> bytes:
        """Export suppliers to CSV or XLSX with clean human-readable business headers."""
        import re

        suppliers = await self.repository.list_all()

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

        def _fmt_phone_for_excel(val: str | None) -> str:
            if not val:
                return ""
            v = val.strip()
            m = re.match(r"^\+(\d{1,3}?)(\d{10})$", v)
            if m:
                return f"+{m.group(1)} {m.group(2)}"
            return v

        rows = []
        for s in suppliers:
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
                    "Supplier Type": str(s.supplier_type) if s.supplier_type else "",
                    "Current Status": s.current_status.value.capitalize() if s.current_status else "",
                    "Supplier Grade": f"Grade {s.supplier_grade.value.upper()}" if s.supplier_grade else "",
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
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Suppliers")
