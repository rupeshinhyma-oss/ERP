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

from dataclasses import dataclass
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


# Standard 15-character Indian GSTIN format:
# 2-digit state code + 10-char PAN ([A-Z]{5}[0-9]{4}[A-Z]) + entity code ([1-9A-Z]) + 'Z' + checksum ([0-9A-Z])
GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
GSTIN_CUSTOM_FIELD_KEYS = ("gstin", "gst_number", "tax_id", "tax_id_number")


@dataclass(frozen=True)
class BatchCompanyMatchResult:
    """Outcome of batched company resolution for a single (company_name, gstin) input."""

    status: str  # "EXISTING", "UNMATCHED", "AMBIGUOUS", "CONFLICT"
    company_id: uuid.UUID | None = None
    company_name: str | None = None
    message: str | None = None


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


def normalize_gstin(raw: Any) -> str | None:
    """Strip whitespace and uppercase a GSTIN/tax_id value. Returns None for empty inputs."""
    if raw is None:
        return None
    cleaned = re.sub(r"\s+", "", str(raw)).upper()
    return cleaned if cleaned else None


def validate_gstin(raw: Any) -> tuple[str | None, str | None]:
    """
    Normalize and validate an Indian GSTIN.
    Returns:
      - (None, None) when input is blank/absent.
      - (normalized_gstin, None) when valid.
      - (None, error_message) when malformed.
    """
    cleaned = normalize_gstin(raw)
    if not cleaned:
        return None, None
    if not GSTIN_PATTERN.fullmatch(cleaned):
        return (
            None,
            f"Invalid GSTIN format '{str(raw).strip()}'. Expected 15-character Indian GSTIN (e.g., 29ABCDE1234F1Z5).",
        )
    return cleaned, None


def extract_gstin(
    top_level: Any = None,
    custom_fields: dict[str, Any] | None = None,
) -> str | None:
    """
    Extract raw GSTIN value from explicit payload field or custom_fields keys.
    Returns the raw non-empty string (not yet validated) or None when absent/blank.
    """
    if top_level is not None:
        s = str(top_level).strip()
        if s:
            return s
    if isinstance(custom_fields, dict):
        for key in GSTIN_CUSTOM_FIELD_KEYS:
            val = custom_fields.get(key)
            if val is not None:
                s = str(val).strip()
                if s:
                    return s
    return None


def _company_candidate_dict(c: Company) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "company_name": c.company_name,
        "tax_id_number": c.tax_id_number,
        "contact_full_name": c.contact_full_name,
    }


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
    skip_partial_match: bool = False,
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

    # 2. Match by Tax ID / GSTIN if supplied (validate format strictly before matching)
    clean_tax, tax_err = validate_gstin(tax_id)
    if tax_err:
        raise BadRequestException(tax_err)
    if clean_tax:
        tax_stmt = select(Company).where(
            Company.deleted_at.is_(None),
            Company.is_active.is_(True),
            func.upper(func.trim(Company.tax_id_number)) == clean_tax,
        )
        tax_matches = (await session.execute(tax_stmt)).scalars().all()
        if len(tax_matches) == 1:
            return tax_matches[0].id, tax_matches[0].company_name, False
        elif len(tax_matches) > 1:
            candidates = [_company_candidate_dict(c) for c in tax_matches]
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
        matched_comp = exact_matches[0]
        existing_tax = normalize_gstin(matched_comp.tax_id_number)
        if clean_tax and existing_tax and existing_tax != clean_tax:
            raise AmbiguousCompanyMatchException(
                f"Company '{matched_comp.company_name}' is already registered with a different GSTIN "
                f"('{existing_tax}') than supplied ('{clean_tax}'). Please verify the GSTIN or select the intended company.",
                details={
                    "code": "GSTIN_COMPANY_CONFLICT",
                    "company_name": clean_name,
                    "tax_id": clean_tax,
                    "candidates": [_company_candidate_dict(matched_comp)],
                },
            )
        return matched_comp.id, matched_comp.company_name, False
    elif len(exact_matches) > 1:
        candidates = [_company_candidate_dict(c) for c in exact_matches]
        raise AmbiguousCompanyMatchException(
            f"Multiple companies match '{clean_name}'. Please select the specific company from the list.",
            details={"code": "AMBIGUOUS_COMPANY_MATCH", "company_name": clean_name, "candidates": candidates},
        )

    # 3b. Plausible partial matches (if name length >= 3 and not already batch-validated as NEW)
    if not skip_partial_match and len(clean_name) >= 3:
        plausible_stmt = select(Company).where(
            Company.deleted_at.is_(None),
            Company.is_active.is_(True),
            Company.company_name.ilike(f"%{clean_name}%"),
        )
        plausible_matches = (await session.execute(plausible_stmt)).scalars().all()
        if len(plausible_matches) > 1:
            candidates = [_company_candidate_dict(c) for c in plausible_matches]
            raise AmbiguousCompanyMatchException(
                f"Multiple companies match '{clean_name}'. Please select the specific company from the list.",
                details={"code": "AMBIGUOUS_COMPANY_MATCH", "company_name": clean_name, "candidates": candidates},
            )
        elif len(plausible_matches) == 1:
            matched_comp = plausible_matches[0]
            existing_tax = normalize_gstin(matched_comp.tax_id_number)
            if clean_tax and existing_tax and existing_tax != clean_tax:
                raise AmbiguousCompanyMatchException(
                    f"Company '{matched_comp.company_name}' is already registered with a different GSTIN "
                    f"('{existing_tax}') than supplied ('{clean_tax}'). Please verify the GSTIN or select the intended company.",
                    details={
                        "code": "GSTIN_COMPANY_CONFLICT",
                        "company_name": clean_name,
                        "tax_id": clean_tax,
                        "candidates": [_company_candidate_dict(matched_comp)],
                    },
                )
            return matched_comp.id, matched_comp.company_name, False

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
        if clean_tax:
            existing_tax_comp = await company_repo.get_company_by_tax_id(clean_tax)
            if existing_tax_comp:
                return existing_tax_comp.id, existing_tax_comp.company_name, False
        existing = await company_repo.get_by_name_city(clean_name, None)
        if existing:
            return existing.id, existing.company_name, False
        raise ce


async def batch_resolve_companies(
    session: AsyncSession,
    items: list[tuple[str | None, str | None]],
    *,
    chunk_size: int = 100,
    partial_chunk_size: int = 50,
) -> dict[tuple[str, str], BatchCompanyMatchResult]:
    """
    Bounded batched company matcher for CSV imports (eliminates N+1 per-row DB queries
    without loading the full companies table into memory).

    Args:
        items: list of (raw_company_name, validated_uppercase_gstin_or_none)
        chunk_size: max distinct keys per IN (...) batch query
        partial_chunk_size: max distinct unmatched names per ILIKE OR batch query

    Returns:
        dict keyed by (normalize_company_name(name).lower(), normalize_gstin(gstin) or "")
        mapping to BatchCompanyMatchResult with exact same precedence as resolve_or_create_company:
        1. Exact GSTIN match
        2. Exact normalized company name match (with GSTIN conflict guard)
        3. Plausible partial name match for names with len >= 3 (with GSTIN conflict guard)
        4. UNMATCHED
    """
    results: dict[tuple[str, str], BatchCompanyMatchResult] = {}
    if not items:
        return results

    # Deduplicate (name_lower, gstin_upper) pairs while retaining original normalized display name
    unique_keys: dict[tuple[str, str], str] = {}
    for raw_name, raw_tax in items:
        clean_name = normalize_company_name(raw_name)
        clean_tax = normalize_gstin(raw_tax) or ""
        if not clean_name and not clean_tax:
            continue
        key = (clean_name.lower(), clean_tax)
        if key not in unique_keys:
            unique_keys[key] = clean_name

    if not unique_keys:
        return results

    # Step 1: Batched GSTIN lookup (chunked IN)
    unique_taxes = sorted({k[1] for k in unique_keys if k[1]})
    by_tax: dict[str, list[Company]] = {}
    for i in range(0, len(unique_taxes), chunk_size):
        chunk = unique_taxes[i : i + chunk_size]
        stmt = select(Company).where(
            Company.deleted_at.is_(None),
            Company.is_active.is_(True),
            func.upper(func.trim(Company.tax_id_number)).in_(chunk),
        )
        for comp in (await session.execute(stmt)).scalars().all():
            t_key = normalize_gstin(comp.tax_id_number)
            if t_key:
                by_tax.setdefault(t_key, []).append(comp)

    # Resolve any keys matched by GSTIN immediately
    remaining_for_name: dict[tuple[str, str], str] = {}
    for key, disp_name in unique_keys.items():
        name_lower, tax_upper = key
        if tax_upper and tax_upper in by_tax:
            matches = by_tax[tax_upper]
            if len(matches) == 1:
                results[key] = BatchCompanyMatchResult(
                    status="EXISTING",
                    company_id=matches[0].id,
                    company_name=matches[0].company_name,
                    message=f"Existing company '{matches[0].company_name}' matched by GSTIN '{tax_upper}' (will be reused)",
                )
            else:
                results[key] = BatchCompanyMatchResult(
                    status="AMBIGUOUS",
                    message=f"Ambiguous company match: multiple existing companies share GSTIN '{tax_upper}'.",
                )
        elif name_lower:
            remaining_for_name[key] = disp_name
        else:
            results[key] = BatchCompanyMatchResult(status="UNMATCHED")

    if not remaining_for_name:
        return results

    # Step 2: Batched exact normalized name lookup (chunked IN)
    unique_names = sorted({k[0] for k in remaining_for_name})
    by_exact_name: dict[str, list[Company]] = {}
    for i in range(0, len(unique_names), chunk_size):
        chunk = unique_names[i : i + chunk_size]
        stmt = select(Company).where(
            Company.deleted_at.is_(None),
            Company.is_active.is_(True),
            func.lower(func.trim(Company.company_name)).in_(chunk),
        )
        for comp in (await session.execute(stmt)).scalars().all():
            n_key = normalize_company_name(comp.company_name).lower()
            if n_key:
                by_exact_name.setdefault(n_key, []).append(comp)

    remaining_for_partial: dict[tuple[str, str], str] = {}
    for key, disp_name in remaining_for_name.items():
        name_lower, tax_upper = key
        exact_matches = by_exact_name.get(name_lower, [])
        if len(exact_matches) == 1:
            comp = exact_matches[0]
            existing_tax = normalize_gstin(comp.tax_id_number)
            if tax_upper and existing_tax and existing_tax != tax_upper:
                results[key] = BatchCompanyMatchResult(
                    status="CONFLICT",
                    message=(
                        f"GSTIN conflict: existing company '{comp.company_name}' has GSTIN '{existing_tax}', "
                        f"which conflicts with supplied GSTIN '{tax_upper}'."
                    ),
                )
            else:
                results[key] = BatchCompanyMatchResult(
                    status="EXISTING",
                    company_id=comp.id,
                    company_name=comp.company_name,
                    message=f"Existing company '{comp.company_name}' matched (will be reused)",
                )
        elif len(exact_matches) > 1:
            results[key] = BatchCompanyMatchResult(
                status="AMBIGUOUS",
                message=f"Ambiguous company match: multiple existing companies match '{disp_name}'.",
            )
        elif len(disp_name) >= 3:
            remaining_for_partial[key] = disp_name
        else:
            results[key] = BatchCompanyMatchResult(status="UNMATCHED")

    if not remaining_for_partial:
        return results

    # Step 3: Batched plausible partial name lookup (chunked OR ILIKE, only for remaining len >= 3 names)
    unique_partial_names = sorted({k[0] for k in remaining_for_partial})
    partial_candidates_by_id: dict[uuid.UUID, Company] = {}
    for i in range(0, len(unique_partial_names), partial_chunk_size):
        chunk = unique_partial_names[i : i + partial_chunk_size]
        stmt = select(Company).where(
            Company.deleted_at.is_(None),
            Company.is_active.is_(True),
            or_(*(Company.company_name.ilike(f"%{n}%") for n in chunk)),
        )
        for comp in (await session.execute(stmt)).scalars().all():
            partial_candidates_by_id[comp.id] = comp

    candidate_tuples = [
        (comp, (comp.company_name or "").lower())
        for comp in partial_candidates_by_id.values()
    ]

    for key, disp_name in remaining_for_partial.items():
        name_lower, tax_upper = key
        matches = [comp for comp, comp_lower in candidate_tuples if name_lower in comp_lower]
        if len(matches) == 1:
            comp = matches[0]
            existing_tax = normalize_gstin(comp.tax_id_number)
            if tax_upper and existing_tax and existing_tax != tax_upper:
                results[key] = BatchCompanyMatchResult(
                    status="CONFLICT",
                    message=(
                        f"GSTIN conflict: existing company '{comp.company_name}' has GSTIN '{existing_tax}', "
                        f"which conflicts with supplied GSTIN '{tax_upper}'."
                    ),
                )
            else:
                results[key] = BatchCompanyMatchResult(
                    status="EXISTING",
                    company_id=comp.id,
                    company_name=comp.company_name,
                    message=f"Existing company '{comp.company_name}' matched (will be reused)",
                )
        elif len(matches) > 1:
            results[key] = BatchCompanyMatchResult(
                status="AMBIGUOUS",
                message=f"Ambiguous company match: multiple existing companies match '{disp_name}'.",
            )
        else:
            results[key] = BatchCompanyMatchResult(status="UNMATCHED")

    return results


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
