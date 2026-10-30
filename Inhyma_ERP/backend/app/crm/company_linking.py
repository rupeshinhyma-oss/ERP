"""
CRM Lead Company Matching and Linking Service.

Implements business logic to link every CRM lead to a record in the ERP Companies master:
- Validates explicitly selected company IDs.
- Matches normalized company names against existing company records.
- Matches unique identifiers (tax_id / GSTIN) when valid.
- Disambiguates when multiple plausible matches exist.
- Creates new company records via the existing CompanyService when unmatched.
- Handles concurrent creation conflicts safely.
- Provides legacy lead backfill utilities.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.companies.models import Company
from app.companies.repository import CompanyContactRepository, CompanyRepository
from app.companies.service import CompanyService
from app.core.exceptions import BadRequestException, ConflictException
from app.masters.cities.repository import CityRepository
from app.masters.countries.repository import CountryRepository
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository
from app.masters.products.repository import ProductRepository
from app.masters.states.repository import StateRepository


class AmbiguousCompanyMatchException(ConflictException):
    """Raised when multiple plausible company matches are found, requiring user disambiguation."""

    status_code = 409
    error_code = "AMBIGUOUS_COMPANY_MATCH"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, details=details)


def normalize_company_name(name: str | None) -> str:
    """Normalize whitespace and strip unnecessary formatting for company name matching."""
    if not name:
        return ""
    # Collapse multiple whitespace characters into single space
    cleaned = re.sub(r"\s+", " ", name).strip()
    return cleaned


def _build_company_service(session: AsyncSession) -> CompanyService:
    """Helper to instantiate CompanyService wired with the current session and cache manager."""
    return CompanyService(
        repository=CompanyRepository(session),
        contact_repository=CompanyContactRepository(session),
        country_repository=CountryRepository(session),
        state_repository=StateRepository(session),
        city_repository=CityRepository(session),
        category_repository=ProductCategoryRepository(session),
        sub_category_repository=ProductSubCategoryRepository(session),
        cache_manager=get_cache_manager(),
        product_repository=ProductRepository(session),
    )


async def resolve_or_create_company(
    session: AsyncSession,
    *,
    company_id: uuid.UUID | None = None,
    company_name: str | None = None,
    tax_id: str | None = None,
    contact_name: str | None = None,
    contact_phone: str | None = None,
    actor_id: uuid.UUID | None = None,
    auto_create: bool = True,
) -> tuple[uuid.UUID, str, bool]:
    """
    Resolve an existing company or create a new one for CRM lead linking.

    Returns:
        tuple[uuid.UUID, str, bool]: (company_id, resolved_company_name, was_created)

    Raises:
        BadRequestException: If explicitly provided company_id is invalid or missing required name.
        AmbiguousCompanyMatchException: If multiple plausible company matches exist.
        ConflictException: If business rule validation fails.
    """
    company_repo = CompanyRepository(session)

    # 1. Explicitly selected company ID from UI
    if company_id is not None:
        stmt = select(Company).where(
            Company.id == company_id, Company.deleted_at.is_(None), Company.is_active.is_(True)
        )
        company = (await session.execute(stmt)).scalar_one_or_none()
        if not company:
            raise BadRequestException(f"Selected company (ID: {company_id}) was not found, is inactive, or has been deleted.")
        return company.id, company.company_name, False

    # 2. Match by Tax ID / GSTIN if supplied
    clean_tax = tax_id.strip().upper() if tax_id and tax_id.strip() else None
    if clean_tax:
        tax_stmt = select(Company).where(
            Company.deleted_at.is_(None),
            Company.is_active.is_(True),
            func.upper(Company.tax_id_number) == clean_tax,
        )
        tax_matches = (await session.execute(tax_stmt)).scalars().all()
        if len(tax_matches) == 1:
            return tax_matches[0].id, tax_matches[0].company_name, False
        elif len(tax_matches) > 1:
            candidates = [
                {
                    "id": str(c.id),
                    "company_name": c.company_name,
                    "tax_id_number": c.tax_id_number,
                    "contact_full_name": c.contact_full_name,
                }
                for c in tax_matches
            ]
            raise AmbiguousCompanyMatchException(
                f"Multiple companies share Tax ID/GSTIN '{clean_tax}'. Please select the specific company.",
                details={"code": "AMBIGUOUS_COMPANY_MATCH", "tax_id": clean_tax, "candidates": candidates},
            )

    # 3. Match by normalized company name
    clean_name = normalize_company_name(company_name)
    if not clean_name:
        clean_name = normalize_company_name(contact_name)

    if not clean_name:
        raise BadRequestException("Company name or contact name is required to associate a company.")

    # 3a. Exact normalized name match (case-insensitive, trimmed)
    exact_stmt = select(Company).where(
        Company.deleted_at.is_(None),
        Company.is_active.is_(True),
        func.lower(func.trim(Company.company_name)) == clean_name.lower(),
    )
    exact_matches = (await session.execute(exact_stmt)).scalars().all()

    if len(exact_matches) == 1:
        return exact_matches[0].id, exact_matches[0].company_name, False
    elif len(exact_matches) > 1:
        candidates = [
            {
                "id": str(c.id),
                "company_name": c.company_name,
                "tax_id_number": c.tax_id_number,
                "contact_full_name": c.contact_full_name,
            }
            for c in exact_matches
        ]
        raise AmbiguousCompanyMatchException(
            f"Multiple companies match '{clean_name}'. Please select the specific company from the list.",
            details={"code": "AMBIGUOUS_COMPANY_MATCH", "company_name": clean_name, "candidates": candidates},
        )

    # 3b. Plausible partial matches (if name length >= 3)
    if len(clean_name) >= 3:
        plausible_stmt = select(Company).where(
            Company.deleted_at.is_(None),
            Company.is_active.is_(True),
            Company.company_name.ilike(f"%{clean_name}%"),
        )
        plausible_matches = (await session.execute(plausible_stmt)).scalars().all()
        if len(plausible_matches) > 1:
            candidates = [
                {
                    "id": str(c.id),
                    "company_name": c.company_name,
                    "tax_id_number": c.tax_id_number,
                    "contact_full_name": c.contact_full_name,
                }
                for c in plausible_matches
            ]
            raise AmbiguousCompanyMatchException(
                f"Multiple companies match '{clean_name}'. Please select the specific company from the list.",
                details={"code": "AMBIGUOUS_COMPANY_MATCH", "company_name": clean_name, "candidates": candidates},
            )
        elif len(plausible_matches) == 1:
            return plausible_matches[0].id, plausible_matches[0].company_name, False

    # 4. If auto_create is disabled (e.g. dry-run inspection / backfill safety)
    if not auto_create:
        return None, clean_name, False  # type: ignore[return-value]

    # 5. Create new company record via CompanyService
    company_service = _build_company_service(session)

    # Check contact calling number uniqueness before attempting create
    clean_calling_number: str | None = None
    if contact_phone:
        candidate_phone = contact_phone.strip()
        phone_already_used = await company_repo.calling_number_exists(candidate_phone)
        if not phone_already_used:
            clean_calling_number = candidate_phone

    try:
        new_comp = await company_service.create(
            company_name=clean_name,
            contact_full_name=contact_name.strip() if contact_name else None,
            contact_calling_number=clean_calling_number,
            sales_person_id=actor_id,
            tax_id_number=clean_tax,
        )
        return new_comp.id, new_comp.company_name, True
    except ConflictException as ce:
        # Safe conflict handling: in case of concurrent creation, re-query existing company
        existing = await company_repo.get_by_name_city(clean_name, None)
        if existing:
            return existing.id, existing.company_name, False
        raise ce


async def backfill_legacy_lead_companies(session: AsyncSession) -> dict[str, Any]:
    """
    Backfill company_id for legacy CRM leads without company links.

    Safe Rules:
    - Backfills only when a single reliable company match exists.
    - Leaves ambiguous and unmatched legacy rows unmodified.
    - Does NOT automatically create companies for historical free-text values.
    """
    from app.crm.models import CrmLead

    stmt = (
        select(CrmLead)
        .where(CrmLead.company_id.is_(None), CrmLead.deleted_at.is_(None))
        .order_by(CrmLead.created_at.asc())
    )
    unlinked_leads = (await session.execute(stmt)).scalars().all()

    total_examined = len(unlinked_leads)
    safely_linked = 0
    ambiguous = 0
    unmatched = 0

    ambiguous_details = []
    unmatched_details = []

    for lead in unlinked_leads:
        comp_name = normalize_company_name(lead.company_name)
        if not comp_name:
            unmatched += 1
            unmatched_details.append({
                "lead_id": str(lead.id),
                "lead_code": lead.lead_code,
                "reason": "Missing company_name",
            })
            continue

        try:
            matched_id, matched_name, _ = await resolve_or_create_company(
                session,
                company_name=comp_name,
                contact_name=lead.name,
                auto_create=False,
            )
            if matched_id:
                lead.company_id = matched_id
                lead.company_name = matched_name
                safely_linked += 1
            else:
                unmatched += 1
                unmatched_details.append({
                    "lead_id": str(lead.id),
                    "lead_code": lead.lead_code,
                    "company_name": comp_name,
                    "reason": "No reliable matching company found in master",
                })
        except AmbiguousCompanyMatchException as acme:
            ambiguous += 1
            ambiguous_details.append({
                "lead_id": str(lead.id),
                "lead_code": lead.lead_code,
                "company_name": comp_name,
                "candidates_count": len(acme.details.get("candidates", [])) if acme.details else 0,
            })
        except Exception as exc:
            unmatched += 1
            unmatched_details.append({
                "lead_id": str(lead.id),
                "lead_code": lead.lead_code,
                "company_name": comp_name,
                "reason": str(exc),
            })

    if safely_linked > 0:
        await session.commit()

    return {
        "total_examined": total_examined,
        "safely_linked": safely_linked,
        "ambiguous": ambiguous,
        "unmatched": unmatched,
        "ambiguous_details": ambiguous_details,
        "unmatched_details": unmatched_details,
    }
