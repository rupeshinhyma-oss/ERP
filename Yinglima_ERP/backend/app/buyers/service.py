"""
Buyer Service.

Business logic for buyer (client) CRUD, encoding every rule from the "Add
Buyer (Client) Data Form" specification document's Notes section:

- Duplicate detection: Company Name + Calling Number + WhatsApp Number
  match is rejected as a duplicate (matching on either phone field counts,
  given the company name also matches).
- Current Status may only move NEW -> EXISTING, never back.
- Delete is only permitted when Current Status is New/unset AND Potential
  is No/unset; otherwise the record can only be deactivated (is_active=False).
- The main form's contact fields are mirrored into a primary BuyerContact
  row automatically, so "Main Form contact details should appear in the
  Contact list also."

Mirrors :mod:`app.suppliers.service` structurally; differs where the two
documents' rules genuinely differ (duplicate criteria, no State/City FK
for buyers -- just Country + a free-text City field).
"""

from __future__ import annotations

import uuid
from typing import Any

from app.buyers.models import Buyer, BuyerContact, BuyerCurrentStatus
from app.buyers.repository import BuyerContactRepository, BuyerRepository
from app.cache.manager import CacheManager
from app.common.list_query import ListQueryParams
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.countries.repository import CountryRepository
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository
from app.masters.states.repository import StateRepository
from app.planning.ws_manager import notify_source_record_changed, refresh_planning_cells_for_record

DROPDOWN_CACHE_NAME = "buyers"


class BuyerService:
    """Orchestrates buyer (client) profile management on top of :class:`BuyerRepository`."""

    not_found_message = "Buyer not found."

    def __init__(
        self,
        repository: BuyerRepository,
        contact_repository: BuyerContactRepository,
        country_repository: CountryRepository,
        category_repository: ProductCategoryRepository,
        sub_category_repository: ProductSubCategoryRepository,
        cache_manager: CacheManager,
        state_repository: StateRepository | None = None,
    ) -> None:
        self.repository = repository
        self.contact_repository = contact_repository
        self.country_repository = country_repository
        self.category_repository = category_repository
        self.sub_category_repository = sub_category_repository
        self.cache_manager = cache_manager
        self.state_repository = state_repository or StateRepository(repository.session)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def get_by_id_or_raise(self, buyer_id: uuid.UUID) -> Buyer:
        buyer = await self.repository.get_with_relations(buyer_id)
        if buyer is None:
            raise NotFoundException(self.not_found_message)
        return buyer

    async def list_paginated(
        self,
        query: ListQueryParams,
        *,
        category_id: uuid.UUID | None = None,
        sub_category_id: uuid.UUID | None = None,
    ) -> tuple[list[Buyer], int]:
        """
        Return a page of buyers matching search/sort/filter, plus the
        document's Top Filter Fields for Product Category and Product Sub
        Category -- both many-to-many, so handled outside the generic
        single-value filter framework, mirroring
        ``SupplierService.list_paginated``.
        """
        if category_id is None and sub_category_id is None:
            items, total = await self.repository.paginated_list(query)
            await self.attach_creator_names(items)
            return items, total

        base_stmt = self.repository._base_select()
        base_stmt = self.repository._apply_search(base_stmt, query.search.normalized)
        base_stmt = self.repository._apply_dynamic_filters(base_stmt, query.filters)
        if category_id is not None:
            base_stmt = self.repository.apply_category_filter(base_stmt, category_id)
        if sub_category_id is not None:
            base_stmt = self.repository.apply_sub_category_filter(base_stmt, sub_category_id)

        from sqlalchemy import func, select

        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = (await self.repository.session.execute(count_stmt)).scalar_one()

        list_stmt = self.repository._apply_sort(base_stmt, query.sort)
        list_stmt = list_stmt.offset(query.page.offset).limit(query.page.limit)
        result = await self.repository.session.execute(list_stmt)
        items = list(result.scalars().unique().all())
        await self.attach_creator_names(items)
        return items, total

    async def attach_creator_names(self, buyers: list[Buyer]) -> None:
        """Set a display-only ``created_by_name`` on each buyer (one query for the whole page)."""
        from sqlalchemy import select
        from app.users.models import User

        ids = {b.created_by_id for b in buyers if b.created_by_id}
        names: dict[uuid.UUID, str] = {}
        if ids:
            rows = await self.repository.session.execute(
                select(User.id, User.display_name, User.first_name, User.last_name, User.username).where(User.id.in_(ids))
            )
            for uid, display_name, first, last, username in rows.all():
                full = " ".join(p for p in (first, last) if p)
                names[uid] = display_name or full or username or ""
        for b in buyers:
            setattr(b, "created_by_name", names.get(b.created_by_id) if b.created_by_id else None)

    async def get_category_ids(self, buyer_id: uuid.UUID) -> list[uuid.UUID]:
        return await self.repository.list_all_category_ids(buyer_id)

    async def get_sub_category_ids(self, buyer_id: uuid.UUID) -> list[uuid.UUID]:
        return await self.repository.list_all_sub_category_ids(buyer_id)

    async def list_contacts(self, buyer_id: uuid.UUID) -> list[BuyerContact]:
        return await self.contact_repository.list_for_buyer(buyer_id)

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------

    async def _validate_country(self, country_id: uuid.UUID) -> None:
        if await self.country_repository.get_by_id(country_id) is None:
            raise BadRequestException("The specified country does not exist.")

    async def _validate_state(self, state_id: uuid.UUID, country_id: uuid.UUID | None = None) -> None:
        state = await self.state_repository.get_by_id(state_id)
        if state is None:
            raise BadRequestException("The specified state does not exist.")
        if country_id is not None and state.country_id != country_id:
            raise BadRequestException("The specified state does not belong to the selected country.")

    async def _validate_categories(self, category_ids: list[uuid.UUID]) -> None:
        """
        Validate every category ID exists in ONE query, not one query per ID.

        Phase 3 N+1 fix: this used to call ``get_by_id`` in a loop --
        for a buyer with, say, 5 categories selected, that was 5
        sequential round trips on every single create/update, purely for
        validation. ``BaseRepository.get_by_ids`` (already used
        elsewhere for exactly this reason -- see Shipment Planning's
        linked-record resolution) fetches every row in a single
        ``WHERE id IN (...)`` query instead.
        """
        if not category_ids:
            return
        found = await self.category_repository.get_by_ids(category_ids)
        missing = [str(cid) for cid in category_ids if cid not in found]
        if missing:
            raise BadRequestException(f"Product category {missing[0]} does not exist.")

    async def _validate_sub_categories(self, sub_category_ids: list[uuid.UUID]) -> None:
        """Validate every sub-category ID exists in ONE query -- see ``_validate_categories``'s docstring."""
        if not sub_category_ids:
            return
        found = await self.sub_category_repository.get_by_ids(sub_category_ids)
        missing = [str(sid) for sid in sub_category_ids if sid not in found]
        if missing:
            raise BadRequestException(f"Product sub-category {missing[0]} does not exist.")

    def _validate_potential_reason(self, potential: Any, potential_reason: str | None) -> None:
        """Document: "If Potential is No, then reason" -- reason is only meaningful when Potential is No."""
        if potential_reason and potential is not None and getattr(potential, "value", potential) != "no":
            raise BadRequestException("Potential Reason can only be set when Potential is 'No'.")

    def _validate_status_transition(self, existing_status: BuyerCurrentStatus | None, new_status: Any) -> None:
        """Document Notes: "once changed to Existing, then it cannot change back to new, means 1 way only"."""
        if new_status is None:
            return
        if existing_status == BuyerCurrentStatus.EXISTING and new_status == BuyerCurrentStatus.NEW:
            raise ConflictException("Current Status cannot be changed from 'Existing' back to 'New'.")

    def _can_delete(self, buyer: Buyer) -> bool:
        """
        Document Notes: "If Current Status is 'New or Select' and
        Potential is 'No or Select', then only to allow Delete. If Current
        Status is 'Existing' or Potential is 'Yes' (any one), cannot
        DELETE that data. However, can make it 'Inactive'".
        """
        status_blocks_delete = buyer.current_status == BuyerCurrentStatus.EXISTING
        potential_blocks_delete = buyer.potential is not None and buyer.potential.value == "yes"
        return not (status_blocks_delete or potential_blocks_delete)

    async def _invalidate_cache(self) -> None:
        await self.cache_manager.invalidate_dropdown(DROPDOWN_CACHE_NAME)

    # ------------------------------------------------------------------
    # Create / Update
    # ------------------------------------------------------------------

    async def create(self, **field_values: Any) -> Buyer:
        """
        Create a new buyer profile.

        Validates country existence and category/sub-category existence;
        enforces the Company-Name+Calling-Number+WhatsApp duplicate rule
        and the potential-reason rule; mirrors the main form's contact
        into a primary BuyerContact row; and persists emails/category/
        sub-category links.
        """
        company_name = field_values["company_name"]
        country_id = field_values["country_id"]
        category_ids = field_values.pop("category_ids", []) or []
        sub_category_ids = field_values.pop("sub_category_ids", []) or []
        emails = field_values.pop("emails", []) or []

        await self._validate_country(country_id)
        if field_values.get("state_id") is not None:
            await self._validate_state(field_values["state_id"], country_id)
        await self._validate_categories(category_ids)
        await self._validate_sub_categories(sub_category_ids)
        self._validate_potential_reason(field_values.get("potential"), field_values.get("potential_reason"))

        existing_name = await self.repository.get_any_by_company_name(company_name)
        if existing_name is not None:
            if existing_name.deleted_at is not None:
                raise ConflictException(
                    f"Buyer '{company_name}' already exists in the Trash.",
                    details={
                        "in_trash": True,
                        "trash_id": str(existing_name.id),
                        "entity_type": "Buyer",
                        "name": existing_name.company_name,
                    },
                )
            raise ConflictException(
                f"Buyer '{company_name}' already exists in Buyer Master.",
                details={"existing": {"id": str(existing_name.id), "name": existing_name.company_name}},
            )

        dup_match = await self.repository.find_duplicate(
            company_name=company_name,
            calling_number=field_values.get("contact_calling_number"),
            whatsapp_number=field_values.get("contact_whatsapp_number"),
        )
        if dup_match is not None:
            duplicate, reason = dup_match
            if hasattr(duplicate, "deleted_at") and duplicate.deleted_at is not None:
                raise ConflictException(
                    f"{reason} (currently in Trash).",
                    details={
                        "in_trash": True,
                        "trash_id": str(duplicate.id),
                        "entity_type": "Buyer",
                        "name": duplicate.company_name,
                    },
                )
            raise ConflictException(f"{reason}.")

        buyer = await self.repository.create(**field_values)

        await self.repository.replace_category_links(buyer.id, category_ids)
        await self.repository.replace_sub_category_links(buyer.id, sub_category_ids)
        await self.repository.replace_emails(buyer.id, emails)

        # Mirror the main form's contact into the contacts list, per the
        # document's Note. Only created if a contact name was provided.
        if field_values.get("contact_full_name"):
            await self.contact_repository.create(
                buyer_id=buyer.id,
                salutation=field_values.get("contact_salutation"),
                person_name=field_values["contact_full_name"],
                designation=field_values.get("contact_designation"),
                country_id=country_id,
                calling_number=field_values.get("contact_calling_number"),
                whatsapp_number=field_values.get("contact_whatsapp_number"),
                email=emails[0] if emails else None,
                is_primary=True,
            )

        await self._invalidate_cache()
        return await self.get_by_id_or_raise(buyer.id)

    async def update(self, buyer_id: uuid.UUID, **field_values: Any) -> Buyer:
        """
        Update an existing buyer profile.

        Validates country existence, category/sub-category existence, the
        duplicate rule (if company name or phone numbers are being
        changed), the one-way status transition, and the potential-reason
        rule. Eagerly invalidates the cached buyer list.
        """
        buyer = await self.get_by_id_or_raise(buyer_id)

        category_ids = field_values.pop("category_ids", None)
        sub_category_ids = field_values.pop("sub_category_ids", None)
        emails = field_values.pop("emails", None)

        if "country_id" in field_values and field_values["country_id"] is not None:
            await self._validate_country(field_values["country_id"])
        if "state_id" in field_values and field_values["state_id"] is not None:
            target_country = field_values.get("country_id", buyer.country_id)
            await self._validate_state(field_values["state_id"], target_country)
        if category_ids is not None:
            await self._validate_categories(category_ids)
        if sub_category_ids is not None:
            await self._validate_sub_categories(sub_category_ids)

        new_company_name = field_values.get("company_name", buyer.company_name)
        new_calling = field_values.get("contact_calling_number", buyer.contact_calling_number)
        new_whatsapp = field_values.get("contact_whatsapp_number", buyer.contact_whatsapp_number)

        phone_changed = (
            "contact_calling_number" in field_values and field_values["contact_calling_number"] != buyer.contact_calling_number
        ) or (
            "contact_whatsapp_number" in field_values and field_values["contact_whatsapp_number"] != buyer.contact_whatsapp_number
        )
        name_changed = "company_name" in field_values and field_values["company_name"] != buyer.company_name

        if name_changed:
            existing_name = await self.repository.get_any_by_company_name(new_company_name, exclude_id=buyer_id)
            if existing_name is not None:
                if existing_name.deleted_at is not None:
                    raise ConflictException(
                        f"Buyer '{new_company_name}' already exists in the Trash.",
                        details={
                            "in_trash": True,
                            "trash_id": str(existing_name.id),
                            "entity_type": "Buyer",
                            "name": existing_name.company_name,
                        },
                    )
                raise ConflictException(
                    f"Buyer '{new_company_name}' already exists in Buyer Master.",
                    details={"existing": {"id": str(existing_name.id), "name": existing_name.company_name}},
                )

        if phone_changed or name_changed:
            dup_match = await self.repository.find_duplicate(
                company_name=new_company_name,
                calling_number=new_calling,
                whatsapp_number=new_whatsapp,
                exclude_id=buyer_id,
            )
            if dup_match is not None:
                duplicate, reason = dup_match
                if hasattr(duplicate, "deleted_at") and duplicate.deleted_at is not None:
                    raise ConflictException(
                        f"{reason} (currently in Trash).",
                        details={
                            "in_trash": True,
                            "trash_id": str(duplicate.id),
                            "entity_type": "Buyer",
                            "name": duplicate.company_name,
                        },
                    )
                raise ConflictException(f"{reason}.")

        potential = field_values.get("potential", buyer.potential)
        potential_reason = field_values.get("potential_reason", buyer.potential_reason)
        self._validate_potential_reason(potential, potential_reason)

        if "current_status" in field_values:
            self._validate_status_transition(buyer.current_status, field_values["current_status"])

        # Note: `changes` includes `version` (as a plain key, alongside
        # any other field) whenever the client sends it, since it's a
        # normal non-None value at this point -- there is no special
        # extraction here. BaseRepository.update() is what recognizes a
        # `version` kwarg and treats it as `expected_version` for the
        # OCC check (see its docstring), the exact same mechanism
        # app.users.service.UserService.update_user already relies on.
        # A version-only payload (no other field actually changed) still
        # correctly reaches repository.update() and is still checked,
        # since `version` alone makes `changes` non-empty.
        changes = dict(field_values)
        if changes:
            await self.repository.update(buyer, **changes)

        if category_ids is not None:
            await self.repository.replace_category_links(buyer_id, category_ids)
        if sub_category_ids is not None:
            await self.repository.replace_sub_category_links(buyer_id, sub_category_ids)
        if emails is not None:
            await self.repository.replace_emails(buyer_id, emails)

        # Keep the mirrored primary contact in sync if main-form contact
        # fields were edited.
        primary_contact_fields = {
            "contact_salutation",
            "contact_full_name",
            "contact_designation",
            "contact_calling_number",
            "contact_whatsapp_number",
        }
        if primary_contact_fields.intersection(field_values.keys()):
            primary = await self.contact_repository.get_primary_contact(buyer_id)
            new_name = field_values.get("contact_full_name")
            if new_name:
                if primary is not None:
                    contact_updates: dict[str, Any] = {"person_name": new_name}
                    if "contact_salutation" in field_values:
                        contact_updates["salutation"] = field_values["contact_salutation"]
                    if "contact_designation" in field_values:
                        contact_updates["designation"] = field_values["contact_designation"]
                    if "contact_calling_number" in field_values:
                        contact_updates["calling_number"] = field_values["contact_calling_number"]
                    if "contact_whatsapp_number" in field_values:
                        contact_updates["whatsapp_number"] = field_values["contact_whatsapp_number"]
                    await self.contact_repository.update(primary, **contact_updates)
                else:
                    await self.contact_repository.create(
                        buyer_id=buyer_id,
                        salutation=field_values.get("contact_salutation"),
                        person_name=new_name,
                        designation=field_values.get("contact_designation"),
                        country_id=field_values.get("country_id", buyer.country_id),
                        calling_number=field_values.get("contact_calling_number"),
                        whatsapp_number=field_values.get("contact_whatsapp_number"),
                        email=None,
                        is_primary=True,
                    )
            elif "contact_full_name" in field_values and not new_name:
                # User explicitly cleared the primary contact name from the main form
                if primary is not None:
                    await self.contact_repository.delete(primary)
            elif primary is not None:
                contact_updates = {}
                if "contact_salutation" in field_values:
                    contact_updates["salutation"] = field_values["contact_salutation"]
                if "contact_designation" in field_values:
                    contact_updates["designation"] = field_values["contact_designation"]
                if "contact_calling_number" in field_values:
                    contact_updates["calling_number"] = field_values["contact_calling_number"]
                if "contact_whatsapp_number" in field_values:
                    contact_updates["whatsapp_number"] = field_values["contact_whatsapp_number"]
                if contact_updates:
                    await self.contact_repository.update(primary, **contact_updates)

        await self._invalidate_cache()
        # Same store-on-write hook as Products/Suppliers -- Buyers is a
        # registered Shipment Planning source module too (see
        # app.planning.source_registry's buyer module).
        await notify_source_record_changed("buyer", buyer_id)
        await refresh_planning_cells_for_record(self.repository.session, "buyer", buyer_id)
        return await self.get_by_id_or_raise(buyer_id)

    async def update_current_status(self, buyer_id: uuid.UUID, current_status: Any) -> Buyer:
        """List-view inline "editable dropdown" for Current Status."""
        buyer = await self.get_by_id_or_raise(buyer_id)
        if current_status is not None:
            self._validate_status_transition(buyer.current_status, current_status)
        await self.repository.update(buyer, current_status=current_status)
        await self._invalidate_cache()
        await notify_source_record_changed("buyer", buyer_id)
        await refresh_planning_cells_for_record(self.repository.session, "buyer", buyer_id)
        return buyer

    async def update_grade(self, buyer_id: uuid.UUID, buyer_grade: Any) -> Buyer:
        """List-view inline "editable dropdown" for Client Grade."""
        buyer = await self.get_by_id_or_raise(buyer_id)
        await self.repository.update(buyer, buyer_grade=buyer_grade)
        await self._invalidate_cache()
        # Bypasses update() above, but buyer_grade is itself a registered
        # Planning source field -- needs the same refresh hook.
        await notify_source_record_changed("buyer", buyer_id)
        await refresh_planning_cells_for_record(self.repository.session, "buyer", buyer_id)
        return buyer

    async def update_potential(self, buyer_id: uuid.UUID, potential: Any) -> Buyer:
        """List-view inline "editable dropdown" for Potential."""
        buyer = await self.get_by_id_or_raise(buyer_id)
        self._validate_potential_reason(potential, buyer.potential_reason)
        await self.repository.update(buyer, potential=potential)
        await self._invalidate_cache()
        return buyer

    async def deactivate(self, buyer_id: uuid.UUID) -> Buyer:
        """Set a buyer's is_active flag to False (always permitted, per the document's Notes)."""
        buyer = await self.get_by_id_or_raise(buyer_id)
        await self.repository.update(buyer, is_active=False)
        await self._invalidate_cache()
        return buyer

    async def activate(self, buyer_id: uuid.UUID) -> Buyer:
        """Set a buyer's is_active flag back to True."""
        buyer = await self.get_by_id_or_raise(buyer_id)
        await self.repository.update(buyer, is_active=True)
        await self._invalidate_cache()
        return buyer

    async def delete(self, buyer_id: uuid.UUID) -> None:
        """
        Soft-delete a buyer, enforcing the document's delete-eligibility rule.

        Only permitted when Current Status is New/unset AND Potential is
        No/unset. Otherwise raises; the caller should deactivate instead.
        """
        buyer = await self.get_by_id_or_raise(buyer_id)
        if not self._can_delete(buyer):
            raise ConflictException(
                "This buyer cannot be deleted because its Current Status is 'Existing' or "
                "Potential is 'Yes'. Set it to Inactive instead."
            )
        await self.repository.delete(buyer)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Contacts
    # ------------------------------------------------------------------

    async def _sync_buyer_primary_fields(
        self,
        buyer: Buyer,
        *,
        salutation: str | None,
        full_name: str | None,
        designation: str | None,
        calling_number: str | None,
        whatsapp_number: str | None,
        email: str | None,
    ) -> None:
        """Sync primary contact fields into the buyer profile row and its email roster."""
        await self.repository.update(
            buyer,
            contact_salutation=salutation,
            contact_full_name=full_name,
            contact_designation=designation,
            contact_calling_number=calling_number,
            contact_whatsapp_number=whatsapp_number,
        )
        if email and email.strip():
            clean_email = email.strip()
            existing_emails = [e.email for e in buyer.emails] if buyer.emails else []
            if clean_email not in existing_emails:
                await self.repository.replace_emails(buyer.id, [clean_email] + existing_emails)
            else:
                reordered = [clean_email] + [e for e in existing_emails if e != clean_email]
                await self.repository.replace_emails(buyer.id, reordered)
            await self.repository.session.refresh(buyer, ["emails"])

    async def add_contact(self, buyer_id: uuid.UUID, **field_values: Any) -> BuyerContact:
        """Add a contact person to a buyer (document: "Add Contacts of Buyer (Client)")."""
        buyer = await self.get_by_id_or_raise(buyer_id)
        if field_values.get("country_id"):
            await self._validate_country(field_values["country_id"])

        explicit_is_primary = field_values.pop("is_primary", None)
        existing_primary = await self.contact_repository.get_primary_contact(buyer_id)

        # Auto-promote to primary if explicitly requested OR if buyer currently has no primary contact
        should_be_primary = False
        if explicit_is_primary is True:
            should_be_primary = True
        elif explicit_is_primary is None and (
            existing_primary is None or not (buyer.contact_full_name and buyer.contact_full_name.strip())
        ):
            should_be_primary = True

        if should_be_primary:
            if existing_primary is not None:
                await self.contact_repository.update(existing_primary, is_primary=False)

            await self._sync_buyer_primary_fields(
                buyer,
                salutation=field_values.get("salutation"),
                full_name=field_values.get("person_name"),
                designation=field_values.get("designation"),
                calling_number=field_values.get("calling_number"),
                whatsapp_number=field_values.get("whatsapp_number"),
                email=field_values.get("email"),
            )

        contact = await self.contact_repository.create(
            buyer_id=buyer_id,
            is_primary=should_be_primary,
            **field_values,
        )
        await self._invalidate_cache()
        await notify_source_record_changed("buyer", buyer_id)
        await refresh_planning_cells_for_record(self.repository.session, "buyer", buyer_id)
        return contact

    async def get_contact_or_raise(self, buyer_id: uuid.UUID, contact_id: uuid.UUID) -> BuyerContact:
        contact = await self.contact_repository.get_by_id(contact_id)
        if contact is None or contact.buyer_id != buyer_id:
            raise NotFoundException("Buyer contact not found.")
        return contact

    async def update_contact(self, buyer_id: uuid.UUID, contact_id: uuid.UUID, **field_values: Any) -> BuyerContact:
        buyer = await self.get_by_id_or_raise(buyer_id)
        contact = await self.get_contact_or_raise(buyer_id, contact_id)
        if field_values.get("country_id"):
            await self._validate_country(field_values["country_id"])

        explicit_is_primary = field_values.get("is_primary")
        if explicit_is_primary is True and not contact.is_primary:
            existing_primary = await self.contact_repository.get_primary_contact(buyer_id)
            if existing_primary and existing_primary.id != contact.id:
                await self.contact_repository.update(existing_primary, is_primary=False)

        changes = {k: v for k, v in field_values.items() if v is not None}
        if changes:
            await self.contact_repository.update(contact, **changes)

        # If this contact is primary (or just became primary), sync to buyer profile row
        if contact.is_primary or explicit_is_primary is True:
            await self._sync_buyer_primary_fields(
                buyer,
                salutation=contact.salutation,
                full_name=contact.person_name,
                designation=contact.designation,
                calling_number=contact.calling_number,
                whatsapp_number=contact.whatsapp_number,
                email=contact.email,
            )

        await self._invalidate_cache()
        await notify_source_record_changed("buyer", buyer_id)
        await refresh_planning_cells_for_record(self.repository.session, "buyer", buyer_id)
        return contact

    async def set_primary_contact(self, buyer_id: uuid.UUID, contact_id: uuid.UUID) -> BuyerContact:
        """Promote a contact person to be the buyer's Primary Contact and sync to the buyer profile row."""
        buyer = await self.get_by_id_or_raise(buyer_id)
        contact = await self.get_contact_or_raise(buyer_id, contact_id)

        existing_primary = await self.contact_repository.get_primary_contact(buyer_id)
        if existing_primary and existing_primary.id != contact.id:
            await self.contact_repository.update(existing_primary, is_primary=False)

        await self.contact_repository.update(contact, is_primary=True)
        await self._sync_buyer_primary_fields(
            buyer,
            salutation=contact.salutation,
            full_name=contact.person_name,
            designation=contact.designation,
            calling_number=contact.calling_number,
            whatsapp_number=contact.whatsapp_number,
            email=contact.email,
        )
        await self._invalidate_cache()
        await notify_source_record_changed("buyer", buyer_id)
        await refresh_planning_cells_for_record(self.repository.session, "buyer", buyer_id)
        return contact

    async def delete_contact(self, buyer_id: uuid.UUID, contact_id: uuid.UUID) -> None:
        """Remove a contact person from a buyer. Refuses to delete the auto-mirrored primary contact."""
        contact = await self.get_contact_or_raise(buyer_id, contact_id)
        if contact.is_primary:
            raise BadRequestException(
                "This is the buyer's primary contact (mirrored from the main form) and cannot be deleted "
                "directly -- promote another contact first or edit the buyer profile."
            )
        await self.contact_repository.delete(contact)
        await self._invalidate_cache()

    # ------------------------------------------------------------------
    # Import / Export
    # ------------------------------------------------------------------

    async def export_file(self, file_format: str) -> bytes:
        """Export buyers to CSV or XLSX with clean human-readable business headers matching UI table sequence."""
        from app.buyers.constants import EXPORT_HEADERS
        from app.masters.import_export import build_csv_export, build_excel_export

        buyers = await self.repository.list_all()

        countries = {c.id: c.name for c in await self.country_repository.list_all()}
        states = {s.id: s.name for s in await self.state_repository.list_all()}
        categories = {c.id: c.name for c in await self.category_repository.list_all()}
        sub_categories = {sc.id: sc.name for sc in await self.sub_category_repository.list_all()}

        rows = []
        for b in buyers:
            emails = [e.email for e in b.emails]
            cat_names = [categories.get(link.category_id, "") for link in b.category_links if link.category_id in categories]
            sub_cat_names = [sub_categories.get(link.sub_category_id, "") for link in b.sub_category_links if link.sub_category_id in sub_categories]

            buyer_type_str = b.buyer_type.value.upper() if hasattr(b.buyer_type, "value") else (b.buyer_type or "").upper()
            curr_status_str = b.current_status.value.upper() if hasattr(b.current_status, "value") else str(b.current_status or "").upper()
            potential_str = b.potential.value.upper() if hasattr(b.potential, "value") else str(b.potential or "").upper()
            grade_str = f"Grade {b.buyer_grade.value.upper()}" if hasattr(b.buyer_grade, "value") else (f"Grade {b.buyer_grade}" if b.buyer_grade else "")

            sec_c = next((c for c in getattr(b, "contacts", []) if not c.is_primary), None)

            rows.append(
                {
                    "Company Name": b.company_name,
                    "Buyer Type": buyer_type_str,
                    "Product Categories": ", ".join(filter(None, cat_names)),
                    "Product Sub Categories": ", ".join(filter(None, sub_cat_names)),
                    "Country": countries.get(b.country_id, ""),
                    "State / Province": states.get(b.state_id, "") if b.state_id else "",
                    "City": b.city or "",
                    "Address": b.address or "",
                    "Contact Salutation": b.contact_salutation or "",
                    "Contact Person Name": b.contact_full_name or "",
                    "Designation": b.contact_designation or "",
                    "Calling Number": b.contact_calling_number or "",
                    "WhatsApp Number": b.contact_whatsapp_number or "",
                    "Contact Person 2": sec_c.person_name if sec_c and sec_c.person_name else "",
                    "Designation 2": sec_c.designation if sec_c and sec_c.designation else "",
                    "Calling Number 2": sec_c.calling_number if sec_c and sec_c.calling_number else "",
                    "WhatsApp Number 2": sec_c.whatsapp_number if sec_c and sec_c.whatsapp_number else "",
                    "Emails": ", ".join(emails),
                    "Tax ID / GST Number": b.tax_id_number or "",
                    "Website": b.website or "",
                    "Current Status": curr_status_str,
                    "Buyer Grade": grade_str,
                    "Potential": potential_str,
                    "Potential Reason": b.potential_reason or "",
                    "Product Range": b.product_range or "",
                    "Currently Buying From": b.currently_buying_from or "",
                    "Overall Remarks": b.overall_remarks or "",
                    "Status": "active" if b.is_active else "inactive",
                }
            )
        if file_format == "csv":
            return build_csv_export(EXPORT_HEADERS, rows)
        return build_excel_export(EXPORT_HEADERS, rows, sheet_title="Buyers")

    async def import_file(
        self, filename: str, raw_bytes: bytes, *, update_existing: bool = False, created_by_id: uuid.UUID | None = None
    ) -> Any:
        """Validate and import buyers from an uploaded CSV/XLSX file with 3-way duplicate detection and update mode."""
        from app.buyers.validators import validate_buyer_row
        from app.masters.import_export import model_to_dict, parse_rows_from_file, run_import

        from app.masters.buyer_types.models import BuyerType
        from sqlalchemy import select

        rows = parse_rows_from_file(filename, raw_bytes)

        all_countries = await self.country_repository.list_all()
        all_states = await self.state_repository.list_all()
        all_cats = await self.category_repository.list_all()
        all_sub_cats = await self.sub_category_repository.list_all()

        bt_result = await self.repository.session.execute(select(BuyerType))
        all_buyer_types = list(bt_result.scalars().all())
        valid_buyer_type_map = {bt.name.strip().lower(): bt.name for bt in all_buyer_types}
        for builtin in ("manufacturer", "trader", "dealer / trader", "dealer", "agent", "importer"):
            valid_buyer_type_map.setdefault(builtin, "Dealer / Trader" if "trader" in builtin and "dealer" in builtin else builtin.title())

        country_name_map = {str(c.id): c.name for c in all_countries}
        state_name_map = {str(s.id): s.name for s in all_states}

        existing_buyers = await self.repository.list_all()
        existing_name_map = {b.company_name.strip().lower(): b for b in existing_buyers}
        existing_calling_map: dict[str, Buyer] = {}
        existing_whatsapp_map: dict[str, Buyer] = {}
        import re
        for b in existing_buyers:
            if b.contact_calling_number:
                digits = re.sub(r"\D", "", b.contact_calling_number)
                if len(digits) >= 6:
                    existing_calling_map[digits] = b
            if b.contact_whatsapp_number:
                digits = re.sub(r"\D", "", b.contact_whatsapp_number)
                if len(digits) >= 6:
                    existing_whatsapp_map[digits] = b

        def _serialize_buyer_for_compare(b: Buyer) -> dict[str, Any]:
            return {
                "Company Name": b.company_name,
                "Country": country_name_map.get(str(b.country_id), "—"),
                "State / Province": state_name_map.get(str(b.state_id), "—") if b.state_id else "—",
                "Calling Number": getattr(b, "contact_calling_number", "—") or "—",
                "WhatsApp Number": getattr(b, "contact_whatsapp_number", "—") or "—",
                "Status": "Active" if b.is_active else "Inactive",
            }

        seen_in_batch = set()

        async def _create(field_values: dict[str, Any]) -> Buyer | tuple[str, Buyer]:
            company_name = field_values["company_name"].strip()
            calling_num = field_values.get("contact_calling_number")
            wa_num = field_values.get("contact_whatsapp_number")
            country_raw = field_values.pop("country_raw", "").strip()
            state_raw = field_values.pop("state_raw", None)
            if state_raw:
                state_raw = str(state_raw).strip()
            contact_person_2 = field_values.pop("contact_person_2", None)
            designation_2 = field_values.pop("designation_2", None)
            calling_number_2 = field_values.pop("calling_number_2", None)
            whatsapp_number_2 = field_values.pop("whatsapp_number_2", None)
            cat_names_raw = field_values.pop("category_names_raw", None)
            sub_cat_names_raw = field_values.pop("sub_category_names_raw", None)
            emails = field_values.pop("emails", None)

            # In-batch duplicate check
            batch_key = company_name.lower()
            if batch_key in seen_in_batch:
                raise ConflictException(f"Buyer '{company_name}' appears multiple times in the import file (duplicate).")

            # ----------------------------------------------------------
            # UPDATE EXISTING MODE: If buyer exists by company name, safely update
            # ----------------------------------------------------------
            if update_existing and batch_key in existing_name_map:
                target_buyer = existing_name_map[batch_key]
                update_kwargs: dict[str, Any] = {}
                has_changes = False

                # Strict Buyer Type validation if provided
                buyer_type_raw = field_values.get("buyer_type")
                if buyer_type_raw and str(buyer_type_raw).strip():
                    bt_clean = str(buyer_type_raw).strip().lower()
                    matched_bt = valid_buyer_type_map.get(bt_clean)
                    if not matched_bt:
                        valid_list_str = ", ".join(sorted(set(valid_buyer_type_map.values())))
                        raise BadRequestException(
                            f"Buyer Type '{buyer_type_raw}' does not exist in Buyer Type Master. Must be one of: {valid_list_str}."
                        )
                    if (target_buyer.buyer_type or "").strip().lower() != matched_bt.strip().lower():
                        update_kwargs["buyer_type"] = matched_bt
                        has_changes = True

                # Strict Country validation if provided
                target_country_id = target_buyer.country_id
                if country_raw and country_raw.strip():
                    matched_country = next(
                        (c for c in all_countries if c.code.upper() == country_raw.upper() or c.name.lower() == country_raw.lower()),
                        None,
                    )
                    if matched_country is None:
                        raise BadRequestException(f"Country '{country_raw}' does not exist in Country Master.")
                    if target_buyer.country_id != matched_country.id:
                        update_kwargs["country_id"] = matched_country.id
                        has_changes = True
                    target_country_id = matched_country.id

                # State validation if provided
                if state_raw:
                    s_match = next(
                        (s for s in all_states if s.country_id == target_country_id and (s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower()))),
                        None,
                    )
                    if s_match is None:
                        s_match = next((s for s in all_states if s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower())), None)
                    if s_match is None:
                        raise BadRequestException(f"State '{state_raw}' does not exist in State Master.")
                    if target_buyer.state_id != s_match.id:
                        update_kwargs["state_id"] = s_match.id
                        has_changes = True

                # Category validation if provided
                category_ids: list[Any] | None = None
                category_changed = False
                if cat_names_raw and str(cat_names_raw).strip():
                    category_ids = []
                    for cn in cat_names_raw.split(","):
                        cn_clean = cn.strip().lower()
                        if not cn_clean:
                            continue
                        matched_cat = next((c for c in all_cats if c.name.lower() == cn_clean), None)
                        if not matched_cat:
                            raise BadRequestException(f"Product Category '{cn.strip()}' does not exist in Category Master.")
                        category_ids.append(matched_cat.id)
                    curr_cat_ids = {link.category_id for link in getattr(target_buyer, "category_links", [])}
                    if set(category_ids) != curr_cat_ids:
                        category_changed = True
                        has_changes = True

                # Sub-Category validation if provided
                sub_category_ids: list[Any] | None = None
                sub_category_changed = False
                if sub_cat_names_raw and str(sub_cat_names_raw).strip():
                    sub_category_ids = []
                    for scn in sub_cat_names_raw.split(","):
                        scn_clean = scn.strip().lower()
                        if not scn_clean:
                            continue
                        matched_sc = next((sc for sc in all_sub_cats if sc.name.lower() == scn_clean), None)
                        if not matched_sc:
                            raise BadRequestException(f"Product Sub Category '{scn.strip()}' does not exist in Sub Category Master.")
                        sub_category_ids.append(matched_sc.id)
                    curr_sc_ids = {link.sub_category_id for link in getattr(target_buyer, "sub_category_links", [])}
                    if set(sub_category_ids) != curr_sc_ids:
                        sub_category_changed = True
                        has_changes = True

                # Calling number: only check collision if user is CHANGING it to a new number
                clean_call = re.sub(r"\D", "", calling_num) if calling_num else ""
                clean_cur_call = re.sub(r"\D", "", target_buyer.contact_calling_number or "")
                if clean_call and len(clean_call) >= 6:
                    if clean_call != clean_cur_call:
                        if clean_call in existing_calling_map and existing_calling_map[clean_call].id != target_buyer.id:
                            dup = existing_calling_map[clean_call]
                            raise ConflictException(
                                f"Calling number '{calling_num}' already exists in Buyer Master (used by '{dup.company_name}').",
                                details={"existing": _serialize_buyer_for_compare(dup)},
                            )
                        if clean_call in existing_whatsapp_map and existing_whatsapp_map[clean_call].id != target_buyer.id:
                            dup = existing_whatsapp_map[clean_call]
                            raise ConflictException(
                                f"Calling number '{calling_num}' already exists as WhatsApp number in Buyer Master (used by '{dup.company_name}').",
                                details={"existing": _serialize_buyer_for_compare(dup)},
                            )
                        update_kwargs["contact_calling_number"] = calling_num
                        has_changes = True
                    elif str(getattr(target_buyer, "contact_calling_number", "") or "").strip() != str(calling_num).strip():
                        update_kwargs["contact_calling_number"] = calling_num
                        has_changes = True

                # WhatsApp number: only check collision if user is CHANGING it to a new number
                clean_wa = re.sub(r"\D", "", wa_num) if wa_num else ""
                clean_cur_wa = re.sub(r"\D", "", target_buyer.contact_whatsapp_number or "")
                if clean_wa and len(clean_wa) >= 6:
                    if clean_wa != clean_cur_wa:
                        if clean_wa in existing_whatsapp_map and existing_whatsapp_map[clean_wa].id != target_buyer.id:
                            dup = existing_whatsapp_map[clean_wa]
                            raise ConflictException(
                                f"WhatsApp number '{wa_num}' already exists in Buyer Master (used by '{dup.company_name}').",
                                details={"existing": _serialize_buyer_for_compare(dup)},
                            )
                        if clean_wa in existing_calling_map and existing_calling_map[clean_wa].id != target_buyer.id:
                            dup = existing_calling_map[clean_wa]
                            raise ConflictException(
                                f"WhatsApp number '{wa_num}' already exists as Calling number in Buyer Master (used by '{dup.company_name}').",
                                details={"existing": _serialize_buyer_for_compare(dup)},
                            )
                        update_kwargs["contact_whatsapp_number"] = wa_num
                        has_changes = True
                    elif str(getattr(target_buyer, "contact_whatsapp_number", "") or "").strip() != str(wa_num).strip():
                        update_kwargs["contact_whatsapp_number"] = wa_num
                        has_changes = True

                # Other direct fields: ONLY update if non-null and not empty/blank string
                skip_fields = {
                    "company_name", "buyer_type", "country_id", "state_id", "state_raw", "contact_calling_number", "contact_whatsapp_number",
                    "category_ids", "sub_category_ids", "contact_full_name", "contact_designation", "contact_salutation",
                    "contact_person_2", "designation_2", "calling_number_2", "whatsapp_number_2",
                    "emails",
                }
                for k, v in field_values.items():
                    if k not in skip_fields and v is not None:
                        cur_v = getattr(target_buyer, k, None)
                        cur_s = str(cur_v.value if hasattr(cur_v, "value") else (cur_v if cur_v is not None else "")).strip().lower()
                        new_s = str(v.value if hasattr(v, "value") else (v if v is not None else "")).strip().lower()
                        if new_s != "" and cur_s != new_s:
                            update_kwargs[k] = v
                            has_changes = True

                # Validate potential_reason if potential is updated
                if "potential" in update_kwargs:
                    pot_val = update_kwargs["potential"]
                    pot_reason = update_kwargs.get("potential_reason", target_buyer.potential_reason)
                    self._validate_potential_reason(pot_val, pot_reason)

                # Emails check
                emails_changed = False
                if emails is not None and len(emails) > 0:
                    curr_emails = [e.email.strip().lower() for e in getattr(target_buyer, "emails", []) if getattr(e, "email", None)]
                    new_emails = [e.strip().lower() for e in emails if e.strip()]
                    if sorted(curr_emails) != sorted(new_emails):
                        emails_changed = True
                        has_changes = True

                # Update primary contact if contact name was supplied in this row
                contact_name = field_values.get("contact_full_name")
                if contact_name and str(contact_name).strip():
                    clean_cname = str(contact_name).strip()
                    if (target_buyer.contact_full_name or "").strip() != clean_cname:
                        update_kwargs["contact_full_name"] = clean_cname
                        has_changes = True
                    if field_values.get("contact_salutation") and (target_buyer.contact_salutation or "").strip() != str(field_values["contact_salutation"]).strip():
                        update_kwargs["contact_salutation"] = str(field_values["contact_salutation"]).strip()
                        has_changes = True
                    if field_values.get("contact_designation") and (target_buyer.contact_designation or "").strip() != str(field_values["contact_designation"]).strip():
                        update_kwargs["contact_designation"] = str(field_values["contact_designation"]).strip()
                        has_changes = True

                    primary_contact = next((c for c in getattr(target_buyer, "contacts", []) if c.is_primary and getattr(c, "deleted_at", None) is None), None)
                    if primary_contact is None:
                        primary_contact = await self.contact_repository.get_primary_contact(target_buyer.id)

                    if primary_contact:
                        c_updates: dict[str, Any] = {}
                        if (primary_contact.person_name or "").strip() != clean_cname:
                            c_updates["person_name"] = clean_cname
                        if field_values.get("contact_salutation") and (primary_contact.salutation or "").strip() != str(field_values["contact_salutation"]).strip():
                            c_updates["salutation"] = str(field_values["contact_salutation"]).strip()
                        if field_values.get("contact_designation") and (primary_contact.designation or "").strip() != str(field_values["contact_designation"]).strip():
                            c_updates["designation"] = str(field_values["contact_designation"]).strip()
                        if calling_num and (primary_contact.calling_number or "").strip() != str(calling_num).strip():
                            c_updates["calling_number"] = calling_num
                        if wa_num and (primary_contact.whatsapp_number or "").strip() != str(wa_num).strip():
                            c_updates["whatsapp_number"] = wa_num
                        if c_updates:
                            has_changes = True
                            await self.contact_repository.update(primary_contact, **c_updates)
                    else:
                        has_changes = True
                        await self.contact_repository.create(
                            buyer_id=target_buyer.id,
                            salutation=field_values.get("contact_salutation"),
                            person_name=clean_cname,
                            designation=field_values.get("contact_designation"),
                            country_id=update_kwargs.get("country_id", target_buyer.country_id),
                            calling_number=calling_num or target_buyer.contact_calling_number,
                            whatsapp_number=wa_num or target_buyer.contact_whatsapp_number,
                            email=None,
                            is_primary=True,
                        )

                # Update / create secondary contact if contact_person_2 was supplied in this row
                if contact_person_2 and str(contact_person_2).strip():
                    c2_name = str(contact_person_2).strip()
                    sec_c = next(
                        (c for c in getattr(target_buyer, "contacts", []) if not c.is_primary and (c.person_name or "").strip().lower() == c2_name.lower()),
                        None,
                    )
                    if sec_c is None:
                        non_primaries = [c for c in getattr(target_buyer, "contacts", []) if not c.is_primary]
                        if len(non_primaries) == 1:
                            sec_c = non_primaries[0]

                    if sec_c:
                        c2_up: dict[str, Any] = {}
                        if (sec_c.person_name or "").strip() != c2_name:
                            c2_up["person_name"] = c2_name
                        if designation_2 and (sec_c.designation or "").strip() != str(designation_2).strip():
                            c2_up["designation"] = str(designation_2).strip()
                        if calling_number_2 and (sec_c.calling_number or "").strip() != str(calling_number_2).strip():
                            c2_up["calling_number"] = str(calling_number_2).strip()
                        if whatsapp_number_2 and (sec_c.whatsapp_number or "").strip() != str(whatsapp_number_2).strip():
                            c2_up["whatsapp_number"] = str(whatsapp_number_2).strip()
                        if c2_up:
                            has_changes = True
                            await self.contact_repository.update(sec_c, **c2_up)
                    else:
                        has_changes = True
                        await self.contact_repository.create(
                            buyer_id=target_buyer.id,
                            salutation=None,
                            person_name=c2_name,
                            designation=str(designation_2).strip() if designation_2 else None,
                            country_id=update_kwargs.get("country_id", target_buyer.country_id),
                            calling_number=calling_number_2,
                            whatsapp_number=whatsapp_number_2,
                            email=None,
                            is_primary=False,
                        )

                # Persist updates to target buyer (never blanking out any existing field)
                if update_kwargs:
                    await self.repository.update(target_buyer, **update_kwargs)
                if category_ids is not None and category_changed:
                    await self.repository.replace_category_links(target_buyer.id, category_ids)
                if sub_category_ids is not None and sub_category_changed:
                    await self.repository.replace_sub_category_links(target_buyer.id, sub_category_ids)
                if emails is not None and emails_changed:
                    await self.repository.replace_emails(target_buyer.id, emails)

                seen_in_batch.add(batch_key)
                if clean_call and len(clean_call) >= 6:
                    existing_calling_map[clean_call] = target_buyer
                if clean_wa and len(clean_wa) >= 6:
                    existing_whatsapp_map[clean_wa] = target_buyer

                if not has_changes:
                    return ("unchanged", target_buyer)
                return ("updated", target_buyer)

            # ----------------------------------------------------------
            # INSERT MODE (or new record in Update mode):
            # ----------------------------------------------------------
            # 1. Company Name Duplicate Check
            if batch_key in existing_name_map:
                dup = existing_name_map[batch_key]
                raise ConflictException(
                    f"Buyer '{company_name}' already exists in Buyer Master (duplicate company name).",
                    details={"existing": _serialize_buyer_for_compare(dup)},
                )

            # 2. Calling Number Duplicate Check
            clean_call = re.sub(r"\D", "", calling_num) if calling_num else ""
            if clean_call and len(clean_call) >= 6:
                if clean_call in existing_calling_map:
                    dup = existing_calling_map[clean_call]
                    raise ConflictException(
                        f"Calling number '{calling_num}' already exists in Buyer Master (used by '{dup.company_name}').",
                        details={"existing": _serialize_buyer_for_compare(dup)},
                    )
                if clean_call in existing_whatsapp_map:
                    dup = existing_whatsapp_map[clean_call]
                    raise ConflictException(
                        f"Calling number '{calling_num}' already exists as WhatsApp number in Buyer Master (used by '{dup.company_name}').",
                        details={"existing": _serialize_buyer_for_compare(dup)},
                    )

            # 3. WhatsApp Number Duplicate Check
            clean_wa = re.sub(r"\D", "", wa_num) if wa_num else ""
            if clean_wa and len(clean_wa) >= 6:
                if clean_wa in existing_whatsapp_map:
                    dup = existing_whatsapp_map[clean_wa]
                    raise ConflictException(
                        f"WhatsApp number '{wa_num}' already exists in Buyer Master (used by '{dup.company_name}').",
                        details={"existing": _serialize_buyer_for_compare(dup)},
                    )
                if clean_wa in existing_calling_map:
                    dup = existing_calling_map[clean_wa]
                    raise ConflictException(
                        f"WhatsApp number '{wa_num}' already exists as Calling number in Buyer Master (used by '{dup.company_name}').",
                        details={"existing": _serialize_buyer_for_compare(dup)},
                    )

            # Strict Buyer Type validation
            buyer_type_raw = field_values.get("buyer_type")
            if buyer_type_raw:
                bt_clean = buyer_type_raw.strip().lower()
                matched_bt = valid_buyer_type_map.get(bt_clean)
                if not matched_bt:
                    valid_list_str = ", ".join(sorted(set(valid_buyer_type_map.values())))
                    raise BadRequestException(
                        f"Buyer Type '{buyer_type_raw}' does not exist in Buyer Type Master. Must be one of: {valid_list_str}."
                    )
                field_values["buyer_type"] = matched_bt

            # Strict Country validation
            country = next(
                (c for c in all_countries if c.code.upper() == country_raw.upper() or c.name.lower() == country_raw.lower()),
                None
            )
            if country is None:
                raise BadRequestException(f"Country '{country_raw}' does not exist in Country Master.")
            field_values["country_id"] = country.id

            # State validation if provided
            if state_raw:
                s_match = next(
                    (s for s in all_states if s.country_id == country.id and (s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower()))),
                    None,
                )
                if s_match is None:
                    s_match = next((s for s in all_states if s.name.lower() == state_raw.lower() or (s.code and s.code.lower() == state_raw.lower())), None)
                if s_match is None:
                    raise BadRequestException(f"State '{state_raw}' does not exist in State Master.")
                field_values["state_id"] = s_match.id

            # Strict Category validation
            category_ids = []
            if cat_names_raw:
                for cn in cat_names_raw.split(","):
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
                for scn in sub_cat_names_raw.split(","):
                    scn_clean = scn.strip().lower()
                    if not scn_clean:
                        continue
                    matched_sc = next((sc for sc in all_sub_cats if sc.name.lower() == scn_clean), None)
                    if not matched_sc:
                        raise BadRequestException(f"Product Sub Category '{scn.strip()}' does not exist in Sub Category Master.")
                    sub_category_ids.append(matched_sc.id)
            field_values["sub_category_ids"] = sub_category_ids
            field_values["emails"] = emails or []

            if created_by_id is not None:
                field_values["created_by_id"] = created_by_id
            buyer = await self.create(**field_values)

            # Secondary contact if provided in import
            if contact_person_2 and str(contact_person_2).strip():
                await self.contact_repository.create(
                    buyer_id=buyer.id,
                    salutation=None,
                    person_name=str(contact_person_2).strip(),
                    designation=str(designation_2).strip() if designation_2 else None,
                    country_id=buyer.country_id,
                    calling_number=calling_number_2,
                    whatsapp_number=whatsapp_number_2,
                    email=None,
                    is_primary=False,
                )

            seen_in_batch.add(batch_key)
            existing_name_map[batch_key] = buyer
            if clean_call and len(clean_call) >= 6:
                existing_calling_map[clean_call] = buyer
            if clean_wa and len(clean_wa) >= 6:
                existing_whatsapp_map[clean_wa] = buyer
            return buyer

        summary = await run_import(rows, row_validator=validate_buyer_row, row_creator=_create)
        await self._invalidate_cache()
        return summary