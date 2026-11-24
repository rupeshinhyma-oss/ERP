"""
CRM CSV Lead Import and Duplicate Detection Service.

Implements Phase 4 business logic:
- Robust CSV parsing with encoding resilience (UTF-8, UTF-8-sig, Latin-1 fallback).
- Header case-insensitivity and whitespace trimming.
- Conservative phone number normalization (Indian E.164 and valid international).
- Pipeline and initial landing stage validation.
- Intra-file duplicate tracking and conflicting data detection.
- CRM duplicate detection against existing crm_leads.
- Scoped privacy masking (protecting sensitive lead info for out-of-scope callers).
- Non-duplicate lead creation (assigned_to unset, pipeline & initial stage applied).
- Duplicate preservation (retains owner, pipeline, stage, original campaign; records campaign history and activity touchpoint).
- Batch metrics recording (CrmImportBatch).
- Formula injection protection on CSV output.
"""

from __future__ import annotations

import csv
import io
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.core.logging import get_logger
from app.crm.assignment_service import CrmAssignmentEngineService
from app.crm.company_linking import (
    AmbiguousCompanyMatchException,
    batch_resolve_companies,
    normalize_company_name,
    normalize_gstin,
    resolve_or_create_company,
    validate_gstin,
)
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmSalespersonConfig,
)
from app.crm.schemas import (
    CrmImportBatchRead,
    CrmImportConfirmResponse,
    CrmImportPreviewResponse,
    CrmImportRowPreview,
    validate_crm_email,
)
from app.org_structure.models import DepartmentLeadershipAssignment, OrgRecordStatus
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus

logger = get_logger(__name__)

# Configurable limits per repository conventions
MAX_CSV_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_CSV_ROW_COUNT = 5000


# Pure signed numeric / international phone pattern preserved without formula prefixing
_SAFE_SIGNED_NUMBER_OR_PHONE_RE = re.compile(r"^[+-]\d[\d\s\-\(\)\.,]*$")


def sanitize_formula_text(val: str | None) -> str | None:
    """
    Neutralize spreadsheet/CSV formula injection on user-entered text fields safely:
    - Trims outer whitespace/control characters (spaces, tabs, CR/LF).
    - Never double-prefixes values already neutralized with leading single-quote before a trigger.
    - Neutralizes values starting with '=', '@', or non-numeric '+'/'-' formulas (e.g. +CMD|, -2+3+cmd|).
    - Preserves legitimate international phone numbers (+91...) and pure signed numbers (-150.25).
    """
    if val is None:
        return None
    cleaned = str(val).strip()
    if not cleaned:
        return ""
    if len(cleaned) >= 2 and cleaned[0] == "'" and cleaned[1] in ("=", "+", "-", "@"):
        return cleaned
    first = cleaned[0]
    if first in ("=", "@"):
        return f"'{cleaned}"
    if first in ("+", "-"):
        if _SAFE_SIGNED_NUMBER_OR_PHONE_RE.fullmatch(cleaned):
            return cleaned
        return f"'{cleaned}"
    return cleaned


def sanitize_csv_cell(val: Any) -> str:
    """Protect exported CSV text from formula injection attacks without double-prefixing."""
    if val is None:
        return ""
    return sanitize_formula_text(str(val)) or ""


def _get_failure_outcome(reason: str) -> str:
    """Categorize row-level failure outcome concisely."""
    r_lower = reason.lower()
    if "phone" in r_lower or "digit" in r_lower:
        return "Invalid Phone"
    if "email" in r_lower:
        return "Invalid Email"
    if "gstin" in r_lower or "gst" in r_lower:
        return "Invalid GSTIN"
    if "name" in r_lower:
        return "Invalid Name"
    if "campaign" in r_lower:
        return "Invalid Campaign"
    if "company" in r_lower or "ambiguous" in r_lower:
        return "Company Match Conflict"
    if "malformed" in r_lower or "fewer columns" in r_lower or "columns" in r_lower:
        return "Malformed Row"
    return "Invalid Field"


def _get_remediation_guidance(reason: str) -> str:
    """Provide clear, actionable correction instructions for row-level failures."""
    r_lower = reason.lower()
    if "name cannot be blank" in r_lower:
        return "Provide a contact or prospect name in the Name column."
    if "phone number cannot be blank" in r_lower:
        return "Provide a 10-digit Indian mobile number or valid E.164 phone number."
    if "campaign cannot be blank" in r_lower:
        return "Specify the origin marketing campaign or source tag."
    if "email" in r_lower:
        return "Provide a valid email address (e.g., name@company.com) or leave the Email column blank."
    if "gstin" in r_lower or "gst" in r_lower:
        return "Provide a valid 15-character Indian GSTIN matching the intended company or leave GSTIN blank."
    if "phone" in r_lower or "digit" in r_lower:
        return "Check phone number formatting. Use 10 digits or E.164 international format."
    if "malformed" in r_lower:
        return "Ensure all 3 required columns (Name, Number, Campaign) are present."
    return "Verify the row fields meet import requirements and retry."


def normalize_phone_number(raw_phone: str | None) -> tuple[str | None, str | None]:
    """
    Conservative, consistent phone normalization.
    Returns: (normalized_phone, error_reason)
    - If phone is valid Indian mobile or international E.164: (normalized_phone, None)
    - If empty, malformed, or ambiguous: (None, error_reason)
    """
    if not raw_phone:
        return None, "Phone number cannot be blank."
    s = raw_phone.strip()
    if not s:
        return None, "Phone number cannot be blank."

    # Strip standard punctuation: spaces, hyphens, dots, parentheses
    cleaned = re.sub(r"[\s\-\(\)\.]", "", s)
    if not cleaned:
        return None, "Phone number cannot be blank."

    # Check for invalid characters (only digits and optional leading +)
    if not re.match(r"^\+?\d+$", cleaned):
        return None, "Phone number contains invalid characters (only digits, spaces, and '+' allowed)."

    # Handle leading +
    if cleaned.startswith("+"):
        digits = cleaned[1:]
        if len(digits) < 10 or len(digits) > 15:
            return None, f"Invalid phone number length ({len(digits)} digits). International numbers must have 10-15 digits."
        if digits.startswith("91"):
            if len(digits) == 12 and digits[2] in "6789":
                return f"+{digits}", None
            elif len(digits) == 12:
                return None, "Invalid Indian mobile number: 10-digit number after +91 must start with 6, 7, 8, or 9."
        # General E.164
        return f"+{digits}", None

    # Without leading +
    digits = cleaned
    if len(digits) == 10:
        if digits[0] in "6789":
            return f"+91{digits}", None
        return None, "Ambiguous 10-digit number: Indian mobile numbers must start with 6, 7, 8, or 9."
    elif len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        return f"+91{digits[1:]}", None
    elif len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        return f"+{digits}", None
    elif 10 <= len(digits) <= 15:
        return None, f"Ambiguous phone number format '{raw_phone}'. Please include country code with '+' for international numbers."
    else:
        return None, f"Invalid phone number length ({len(digits)} digits). Must be a valid 10-digit mobile number."


def _sanitize_formula_prefix(val: str) -> str:
    """Prepend single quote if string starts with formula triggers to prevent CSV/spreadsheet injection."""
    return sanitize_formula_text(val) or ""


class CrmImportService:
    """Service layer for CRM CSV Lead Import and Duplicate Detection."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _is_lead_in_actor_scope(
        lead: CrmLead,
        allowed_scope: set[uuid.UUID] | None,
        *,
        is_salesperson: bool,
        unassigned_owners_map: dict[uuid.UUID, tuple[bool, uuid.UUID | None]] | None = None,
    ) -> bool:
        """
        Evaluate whether an existing CRM lead is within the caller's authorized visibility scope.
        Mirrors CrmLeadService's strict fail-closed ownership policy:
        - Admin (`allowed_scope is None`): full visibility.
        - Assigned lead (`assigned_to is not None`): current assignee must be inside `allowed_scope`
          (former creator/department loses visibility after reassignment).
        - Unassigned lead (`assigned_to is None`):
          * If assignment history exists: NEVER consult `created_by`.
            - Salesperson: ALWAYS False (former salespersons do not regain access).
            - Manager: True iff latest history unambiguously identifies an owner in `allowed_scope`
              (ambiguous or incomplete history fails closed).
          * If never assigned (no history):
            - `created_by is None`: ALWAYS False (Admin/SuperAdmin only; BLK-03).
            - Otherwise: `created_by in allowed_scope`.
        """
        if allowed_scope is None:
            return True
        if lead.assigned_to is not None:
            return lead.assigned_to in allowed_scope
        if unassigned_owners_map is not None and lead.id in unassigned_owners_map:
            has_history, unambiguous_owner_id = unassigned_owners_map[lead.id]
            if has_history:
                if is_salesperson:
                    return False
                return unambiguous_owner_id is not None and unambiguous_owner_id in allowed_scope
        if lead.created_by is None:
            return False
        return lead.created_by in allowed_scope

    async def get_actor_scope(self, actor: CurrentUser) -> set[uuid.UUID] | None:
        """
        Evaluate actor permissions and organizational placement for import operations.
        Returns:
            - None: Actor has company-wide admin authority (Admin, super_admin, wildcard '*').
            - set[uuid.UUID]: Department manager scoped to their team/department members,
                              or individual salesperson scoped to {actor.id}.
        """
        # 1. Company-wide admin check
        if (
            actor.is_super_admin
            or actor.username == "admin"
            or "*" in actor.permissions
            or "super_admin" in actor.permissions
        ):
            return None

        # Check if actor has super_admin/admin role in DB
        admin_role_stmt = (
            select(Role.id)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(
                UserRole.user_id == actor.id,
                UserRole.status == RoleAssignmentStatus.ACTIVE,
                Role.name.in_(["super_admin", "admin"]),
                Role.deleted_at.is_(None),
            )
        )
        is_db_admin = (await self.session.execute(admin_role_stmt)).scalar() is not None
        if is_db_admin:
            return None

        # 2. Check if actor is a department / sales manager
        reports_stmt = select(User.id).where(User.manager_id == actor.id, User.deleted_at.is_(None))
        direct_reports = set((await self.session.execute(reports_stmt)).scalars().all())

        leadership_stmt = select(DepartmentLeadershipAssignment.department_id).where(
            DepartmentLeadershipAssignment.employee_id == actor.id,
            DepartmentLeadershipAssignment.status == OrgRecordStatus.ACTIVE,
        )
        led_dept_ids = set((await self.session.execute(leadership_stmt)).scalars().all())

        user_roles_stmt = (
            select(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(
                UserRole.user_id == actor.id,
                UserRole.status == RoleAssignmentStatus.ACTIVE,
                Role.deleted_at.is_(None),
            )
        )
        roles = list((await self.session.execute(user_roles_stmt)).scalars().all())
        role_names = [r.name.lower() for r in roles]

        has_explicit_manager_role = bool(
            "department_manager" in role_names
            or any("manager" in r for r in role_names)
        )
        is_manager = bool(
            has_explicit_manager_role
            or len(direct_reports) > 0
            or len(led_dept_ids) > 0
        )

        if not is_manager:
            # Salesperson importing for themselves
            return {actor.id}

        managed_dept_ids: set[uuid.UUID] = set(led_dept_ids)
        if has_explicit_manager_role and not managed_dept_ids:
            for r in roles:
                if r.name.lower() not in ("user", "super_admin", "admin", "department_manager", "employee"):
                    managed_dept_ids.add(r.id)
        elif has_explicit_manager_role:
            for r in roles:
                if "manager" in r.name.lower() and r.name.lower() != "department_manager":
                    managed_dept_ids.add(r.id)

        scoped_user_ids: set[uuid.UUID] = {actor.id}
        scoped_user_ids.update(direct_reports)

        if managed_dept_ids:
            dept_users_stmt = select(UserRole.user_id).where(
                UserRole.role_id.in_(list(managed_dept_ids)),
                UserRole.status == RoleAssignmentStatus.ACTIVE,
            )
            dept_uids = (await self.session.execute(dept_users_stmt)).scalars().all()
            scoped_user_ids.update(dept_uids)

        return scoped_user_ids


    # -------------------------------------------------------------------------
    # CSV Parsing & Template
    # -------------------------------------------------------------------------

    @staticmethod
    def generate_csv_template() -> str:
        """Generate a sample CSV template with required headers, optional Priority, optional Company, and example rows."""
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Name", "Number", "Campaign", "Priority", "Company"])
        writer.writerow(["Rajesh Kumar", "9876543210", "Google_Search_Q4", "High", "Apex Automation"])
        writer.writerow(["Priya Sharma", "+919123456780", "Facebook_Leads_Oct", "Medium", "Stayfine Supermart"])
        writer.writerow(["Amit Patel", "09811223344", "Trade_Show_2026", "Low", ""])
        return output.getvalue()


    @staticmethod
    def parse_csv_bytes(raw_bytes: bytes) -> tuple[dict[str, int], list[list[str]]]:
        """
        Decode and parse CSV content safely.
        Returns: (header_index_map, data_rows)
        """
        if not raw_bytes or len(raw_bytes.strip()) == 0:
            raise BadRequestException("The uploaded file is empty.")

        if len(raw_bytes) > MAX_CSV_FILE_SIZE_BYTES:
            raise BadRequestException(
                f"File size exceeds the {MAX_CSV_FILE_SIZE_BYTES // (1024 * 1024)}MB limit. Please upload a smaller file."
            )

        # Decoding with BOM and Latin-1 fallback
        content_str: str | None = None
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                content_str = raw_bytes.decode(enc)
                break
            except UnicodeDecodeError:
                continue

        if content_str is None:
            raise BadRequestException("Unable to decode CSV file. Please ensure it is saved in UTF-8 format.")

        reader = csv.reader(io.StringIO(content_str))
        rows = list(reader)

        if not rows:
            raise BadRequestException("The uploaded CSV file contains no rows.")

        raw_headers = rows[0]
        header_map: dict[str, int] = {}
        raw_header_names: dict[str, str] = {}
        for idx, col in enumerate(raw_headers):
            cleaned = re.sub(r"\s+", " ", col.strip().lower())
            if not cleaned:
                continue
            if cleaned in header_map:
                raise BadRequestException(
                    f"Duplicate CSV header detected: '{col.strip()}' conflicts with column "
                    f"'{raw_header_names[cleaned]}'. Please ensure all CSV column headers are unique."
                )
            header_map[cleaned] = idx
            raw_header_names[cleaned] = col.strip()

        # Normalize canonical aliases and reject conflicting alias duplicates (e.g., Name + Contact Name)
        canonical_alias_groups: dict[str, tuple[str, ...]] = {
            "name": ("name", "contact_name", "contact name", "prospect_name", "prospect name", "lead_name", "lead name"),
            "number": ("number", "phone", "mobile", "contact_number", "contact number", "phone_number", "phone number"),
            "campaign": ("campaign",),
            "priority": ("priority", "lead_priority", "lead priority"),
            "company": ("company", "company_name", "company name"),
            "email": ("email", "email_address", "email address", "contact_email", "contact email"),
            "gstin": ("gstin", "gst_number", "gst number", "gst", "tax_id", "tax id", "tax_id_number", "tax id / gst number"),
        }
        for canonical, aliases in canonical_alias_groups.items():
            matched_aliases = [alias for alias in aliases if alias in header_map]
            if len(matched_aliases) > 1:
                conflict_labels = ", ".join(f"'{raw_header_names[a]}'" for a in matched_aliases)
                raise BadRequestException(
                    f"Duplicate CSV header detected for '{canonical}': conflicting columns {conflict_labels}. "
                    "Please keep only one column per field."
                )
            if len(matched_aliases) == 1 and canonical not in header_map:
                header_map[canonical] = header_map[matched_aliases[0]]

        # Validate required columns
        required_cols = ("name", "number", "campaign")
        missing = [rc for rc in required_cols if rc not in header_map]
        if missing:
            raise BadRequestException(
                f"Missing required CSV column(s): {', '.join([c.capitalize() for c in missing])}. "
                "Required columns are: Name, Number (or Phone), Campaign."
            )

        data_rows = rows[1:]
        if not data_rows:
            raise BadRequestException("The uploaded CSV file contains no data rows.")

        if len(data_rows) > MAX_CSV_ROW_COUNT:
            raise BadRequestException(
                f"CSV file contains {len(data_rows)} data rows, exceeding the {MAX_CSV_ROW_COUNT} rows limit per batch."
            )

        return header_map, data_rows

    # -------------------------------------------------------------------------
    # Pipeline & Initial Stage Verification
    # -------------------------------------------------------------------------

    async def get_and_validate_pipeline(self, pipeline_id: uuid.UUID) -> tuple[CrmPipeline, CrmPipelineStage]:
        """
        Verify pipeline exists, is active, and has an active initial landing stage of type 'open'.
        """
        pipe_stmt = (
            select(CrmPipeline)
            .options(selectinload(CrmPipeline.stages))
            .where(CrmPipeline.id == pipeline_id, CrmPipeline.deleted_at.is_(None))
        )
        pipeline = (await self.session.execute(pipe_stmt)).scalar_one_or_none()
        if not pipeline:
            raise NotFoundException("Destination CRM pipeline not found.")

        if not pipeline.is_active:
            raise BadRequestException(
                f"Destination pipeline '{pipeline.name}' is inactive. "
                "Please activate the pipeline or select an active one."
            )

        # Look for active initial stage of type 'open'
        initial_stage: CrmPipelineStage | None = None
        for s in pipeline.stages:
            if s.deleted_at is None and s.is_active and s.is_initial and s.stage_type == "open":
                initial_stage = s
                break

        # Fallback: if no stage explicitly marked initial, check for order 0 open stage
        if not initial_stage:
            for s in sorted([st for st in pipeline.stages if st.deleted_at is None and st.is_active], key=lambda x: x.stage_order):
                if s.stage_type == "open":
                    initial_stage = s
                    break

        if not initial_stage:
            raise BadRequestException(
                f"Pipeline '{pipeline.name}' has no active initial open stage to receive new leads. "
                "Please configure an initial stage in Pipeline Setup first."
            )

        return pipeline, initial_stage

    # -------------------------------------------------------------------------
    # Preview
    # -------------------------------------------------------------------------

    async def preview_import(
        self,
        *,
        pipeline_id: uuid.UUID,
        raw_bytes: bytes,
        actor: CurrentUser,
    ) -> CrmImportPreviewResponse:
        """
        Validate CSV content, check duplicates and conflicting data, and return a preview without database writes.
        """
        pipeline, initial_stage = await self.get_and_validate_pipeline(pipeline_id)
        header_map, data_rows = self.parse_csv_bytes(raw_bytes)

        allowed_scope = await self.get_actor_scope(actor)

        name_idx = header_map["name"]
        number_idx = header_map["number"]
        campaign_idx = header_map["campaign"]
        priority_idx = header_map.get("priority")
        company_idx = header_map.get("company")
        email_idx = header_map.get("email")
        gstin_idx = header_map.get("gstin")

        # Pass 1 (in-memory only — zero per-row SQL): parse rows, validate fields, collect company/phone keys
        parsed_rows: list[dict[str, Any]] = []
        company_lookup_inputs: list[tuple[str | None, str | None]] = []

        for idx, row in enumerate(data_rows, start=2):  # row 1 is header
            name_val = _sanitize_formula_prefix(row[name_idx]) if len(row) > name_idx else ""
            number_val = row[number_idx].strip() if len(row) > number_idx else ""
            campaign_val = _sanitize_formula_prefix(row[campaign_idx]) if len(row) > campaign_idx else ""
            company_val = (
                _sanitize_formula_prefix(row[company_idx]).strip()
                if company_idx is not None and len(row) > company_idx
                else ""
            )
            raw_email = row[email_idx].strip() if email_idx is not None and len(row) > email_idx else ""
            raw_gstin = row[gstin_idx].strip() if gstin_idx is not None and len(row) > gstin_idx else ""

            # Check blank errors
            row_errors: list[str] = []
            if not name_val:
                row_errors.append("Name cannot be blank.")
            if not number_val:
                row_errors.append("Phone number cannot be blank.")
            if not campaign_val:
                row_errors.append("Campaign cannot be blank.")

            norm_phone: str | None = None
            if number_val:
                norm_phone, phone_err = normalize_phone_number(number_val)
                if phone_err:
                    row_errors.append(phone_err)

            # Optional Email validation (LM-DEF-025)
            norm_email: str | None = None
            if raw_email:
                try:
                    norm_email = validate_crm_email(raw_email)
                except ValueError as ve:
                    row_errors.append(str(ve))

            # Optional GSTIN validation (LM-DEF-023)
            norm_gstin: str | None = None
            if raw_gstin:
                norm_gstin, gst_err = validate_gstin(raw_gstin)
                if gst_err:
                    row_errors.append(gst_err)

            # Optional Priority column validation with documented fallback to 'medium'
            priority_val = "medium"
            if priority_idx is not None and len(row) > priority_idx:
                raw_p = row[priority_idx].strip()
                if raw_p:
                    p_lower = raw_p.lower()
                    if p_lower in ("low", "medium", "high", "urgent"):
                        priority_val = p_lower
                    else:
                        row_errors.append(f"Invalid priority '{raw_p}'. Allowed values are: low, medium, high, urgent.")
                else:
                    priority_val = "medium"

            is_malformed = len(row) < max(name_idx, number_idx, campaign_idx) + 1
            if is_malformed:
                row_errors.append("Malformed record: row has fewer columns than required.")

            if not row_errors and (company_val or norm_gstin):
                company_lookup_inputs.append((company_val or None, norm_gstin))

            parsed_rows.append({
                "row_number": idx,
                "name": name_val,
                "original_phone": number_val,
                "normalized_phone": norm_phone,
                "campaign": campaign_val,
                "email": norm_email,
                "gstin": norm_gstin,
                "company": company_val if company_val else None,
                "company_id": None,
                "matched_company_name": None,
                "company_action": None,
                "company_resolution_note": None,
                "priority": priority_val,
                "errors": row_errors,
            })

        # Single bounded batched DB resolution across all unique (company_name, gstin) inputs (LM-DEF-022 & LM-DEF-023)
        batch_company_matches = (
            await batch_resolve_companies(self.session, company_lookup_inputs)
            if company_lookup_inputs
            else {}
        )

        valid_normalized_phones: set[str] = set()
        proposed_new_companies: dict[str, int] = {}

        for r in parsed_rows:
            idx = r["row_number"]
            company_val = r["company"] or ""
            norm_gstin = r["gstin"]
            row_errors = r["errors"]
            norm_phone = r["normalized_phone"]

            if not company_val and not norm_gstin:
                r["company_action"] = "NONE"
                r["company_resolution_note"] = "No company provided (lead will not be linked to a company)"
            elif not row_errors:
                lookup_key = (normalize_company_name(company_val).lower(), norm_gstin or "")
                match_res = batch_company_matches.get(lookup_key)
                if match_res and match_res.status == "EXISTING" and match_res.company_id is not None:
                    r["company_id"] = match_res.company_id
                    r["matched_company_name"] = match_res.company_name
                    r["company_action"] = "EXISTING"
                    r["company_resolution_note"] = match_res.message or (
                        f"Existing company '{match_res.company_name}' matched (will be reused)"
                    )
                elif match_res and match_res.status in ("AMBIGUOUS", "CONFLICT"):
                    r["company_action"] = "AMBIGUOUS"
                    msg = match_res.message or f"Ambiguous company match: multiple existing companies match '{company_val}'"
                    r["company_resolution_note"] = msg
                    row_errors.append(
                        f"{msg} Please specify the full company name/GSTIN or link manually."
                    )
                else:
                    effective_label = company_val or r["name"]
                    norm_cname = normalize_company_name(effective_label)
                    dedup_key = f"gst:{norm_gstin}" if norm_gstin else f"name:{norm_cname.lower()}"
                    if dedup_key in proposed_new_companies:
                        first_row = proposed_new_companies[dedup_key]
                        r["company_action"] = "NEW"
                        r["matched_company_name"] = effective_label
                        r["company_resolution_note"] = (
                            f"Reuses proposed new company '{effective_label}' (from row {first_row})"
                        )
                    else:
                        proposed_new_companies[dedup_key] = idx
                        r["company_action"] = "NEW"
                        r["matched_company_name"] = effective_label
                        r["company_resolution_note"] = (
                            f"New company '{effective_label}' will be created upon confirmation"
                        )

            if norm_phone and not row_errors:
                valid_normalized_phones.add(norm_phone)

        # Query existing CRM leads by normalized phone (chunked to stay bounded on max-size batches)
        existing_crm_leads: dict[str, CrmLead] = {}
        if valid_normalized_phones:
            phone_list = list(valid_normalized_phones)
            for i in range(0, len(phone_list), 1000):
                phone_chunk = phone_list[i : i + 1000]
                lead_stmt = (
                    select(CrmLead)
                    .where(
                        CrmLead.normalized_phone.in_(phone_chunk),
                        CrmLead.deleted_at.is_(None),
                    )
                )
                leads = (await self.session.execute(lead_stmt)).scalars().all()
                for l in leads:
                    existing_crm_leads[l.normalized_phone] = l

        unassigned_dup_ids = [
            l.id for l in existing_crm_leads.values() if l.assigned_to is None
        ]
        unassigned_owners_map: dict[uuid.UUID, tuple[bool, uuid.UUID | None]] = {}
        if unassigned_dup_ids and allowed_scope is not None:
            from app.crm.lead_service import resolve_unassigned_leads_effective_owners

            unassigned_owners_map = await resolve_unassigned_leads_effective_owners(
                self.session, unassigned_dup_ids
            )

        # Second pass: evaluate duplicates, conflicts, and outcomes
        file_seen_phones: dict[str, dict[str, Any]] = {}
        preview_rows: list[CrmImportRowPreview] = []

        valid_candidate_count = 0
        duplicate_crm_count = 0
        duplicate_file_count = 0
        invalid_count = 0
        conflict_count = 0

        for r in parsed_rows:
            row_num = r["row_number"]
            name = r["name"]
            orig_phone = r["original_phone"]
            norm_phone = r["normalized_phone"]
            camp = r["campaign"]
            errors = r["errors"]

            p_val = r.get("priority", "medium")
            if errors:
                invalid_count += 1
                preview_rows.append(
                    CrmImportRowPreview(
                        row_number=row_num,
                        name=name,
                        original_phone=orig_phone,
                        normalized_phone=norm_phone,
                        campaign=camp,
                        priority=p_val,
                        status="INVALID",
                        validation_message="; ".join(errors),
                        is_valid_candidate=False,
                        matched_lead_code=None,
                        email=r.get("email"),
                        gstin=r.get("gstin"),
                        company=r.get("company"),
                        company_id=r.get("company_id"),
                        matched_company_name=r.get("matched_company_name"),
                        company_action=r.get("company_action"),
                        company_resolution_note=r.get("company_resolution_note"),
                    )
                )
                continue

            # Check intra-file duplicates
            if norm_phone in file_seen_phones:
                first_data = file_seen_phones[norm_phone]
                first_row = first_data["row_number"]
                conflicts: list[str] = []
                if name.lower() != first_data["name"].lower():
                    conflicts.append(f"Name '{name}' vs '{first_data['name']}'")
                if camp.lower() != first_data["campaign"].lower():
                    conflicts.append(f"Campaign '{camp}' vs '{first_data['campaign']}'")

                if conflicts:
                    conflict_count += 1
                    duplicate_file_count += 1
                    preview_rows.append(
                        CrmImportRowPreview(
                            row_number=row_num,
                            name=name,
                            original_phone=orig_phone,
                            normalized_phone=norm_phone,
                            campaign=camp,
                            priority=p_val,
                            status="CONFLICT_IN_FILE",
                            validation_message=(
                                f"Repeated contact in file with conflicting data (matches row {first_row}: {', '.join(conflicts)})."
                            ),
                            is_valid_candidate=False,
                            matched_lead_code=None,
                            company=r.get("company"),
                            company_id=r.get("company_id"),
                            matched_company_name=r.get("matched_company_name"),
                            company_action=r.get("company_action"),
                            company_resolution_note=r.get("company_resolution_note"),
                        )
                    )
                else:
                    duplicate_file_count += 1
                    preview_rows.append(
                        CrmImportRowPreview(
                            row_number=row_num,
                            name=name,
                            original_phone=orig_phone,
                            normalized_phone=norm_phone,
                            campaign=camp,
                            priority=p_val,
                            status="FILE_DUPLICATE",
                            validation_message=f"Repeated contact within this CSV file (matches row {first_row}).",
                            is_valid_candidate=False,
                            matched_lead_code=None,
                            company=r.get("company"),
                            company_id=r.get("company_id"),
                            matched_company_name=r.get("matched_company_name"),
                            company_action=r.get("company_action"),
                            company_resolution_note=r.get("company_resolution_note"),
                        )
                    )
                continue

            # First occurrence in file: register in file_seen_phones
            file_seen_phones[norm_phone] = {
                "row_number": row_num,
                "name": name,
                "campaign": camp,
                "priority": p_val,
            }

            # Check against CRM database duplicates
            if norm_phone in existing_crm_leads:
                lead = existing_crm_leads[norm_phone]
                duplicate_crm_count += 1

                # Check caller scope for privacy (consistent with reassignment ownership rules)
                is_within_scope = self._is_lead_in_actor_scope(
                    lead,
                    allowed_scope,
                    is_salesperson=(
                        allowed_scope is not None
                        and len(allowed_scope) == 1
                        and actor.id in allowed_scope
                    ),
                    unassigned_owners_map=unassigned_owners_map,
                )

                if is_within_scope:
                    msg = f"Contact already exists in CRM (Lead Code: {lead.lead_code}). New campaign will be attributed."
                    matched_code = lead.lead_code
                    row_priority = lead.priority or p_val
                    row_company_id = r.get("company_id")
                    row_matched_company_name = r.get("matched_company_name")
                    row_company_action = r.get("company_action")
                    row_company_resolution_note = r.get("company_resolution_note")
                else:
                    msg = "Contact already exists in CRM. New campaign will be attributed."
                    matched_code = None
                    row_priority = p_val
                    row_company_id = None
                    row_matched_company_name = None
                    row_company_action = None
                    row_company_resolution_note = None

                preview_rows.append(
                    CrmImportRowPreview(
                        row_number=row_num,
                        name=name,
                        original_phone=orig_phone,
                        normalized_phone=norm_phone,
                        campaign=camp,
                        priority=row_priority,
                        status="CRM_DUPLICATE",
                        validation_message=msg,
                        is_valid_candidate=False,
                        matched_lead_code=matched_code,
                        email=r.get("email"),
                        gstin=r.get("gstin"),
                        company=r.get("company"),
                        company_id=row_company_id,
                        matched_company_name=row_matched_company_name,
                        company_action=row_company_action,
                        company_resolution_note=row_company_resolution_note,
                    )
                )
                continue

            # Valid new lead candidate
            valid_candidate_count += 1
            preview_rows.append(
                CrmImportRowPreview(
                    row_number=row_num,
                    name=name,
                    original_phone=orig_phone,
                    normalized_phone=norm_phone,
                    campaign=camp,
                    priority=p_val,
                    status="VALID",
                    validation_message="Valid lead candidate ready for import.",
                    is_valid_candidate=True,
                    matched_lead_code=None,
                    email=r.get("email"),
                    gstin=r.get("gstin"),
                    company=r.get("company"),
                    company_id=r.get("company_id"),
                    matched_company_name=r.get("matched_company_name"),
                    company_action=r.get("company_action"),
                    company_resolution_note=r.get("company_resolution_note"),
                )
            )

        return CrmImportPreviewResponse(
            total_rows=len(data_rows),
            valid_candidate_count=valid_candidate_count,
            duplicate_crm_count=duplicate_crm_count,
            duplicate_file_count=duplicate_file_count,
            invalid_count=invalid_count,
            conflict_count=conflict_count,
            pipeline_id=pipeline.id,
            pipeline_name=pipeline.name,
            initial_stage_id=initial_stage.id,
            initial_stage_name=initial_stage.name,
            rows=preview_rows,
            can_import=(valid_candidate_count > 0 or duplicate_crm_count > 0),
        )

    # -------------------------------------------------------------------------
    # Confirm & Commit Import
    # -------------------------------------------------------------------------

    async def confirm_import(
        self,
        *,
        pipeline_id: uuid.UUID,
        raw_bytes: bytes,
        actor: CurrentUser,
        batch_name: str | None = None,
        auto_assign: bool = True,
        distribution_mode: str = "default_rules",
        distribution_strategy: str | None = "round_robin",
        selected_salesperson_ids: list[uuid.UUID] | None = None,
        target_salesperson_id: uuid.UUID | None = None,
    ) -> CrmImportConfirmResponse:
        """
        Execute validated CRM Lead import transactionally:
        - Creates valid new leads and distributes eligible leads according to chosen distribution mode.
        - Preserves existing leads and updates their campaign history.
        - Records batch metrics, touchpoint activities, and assignment history.
        """
        # Backward compatibility: auto_assign=False overrides distribution_mode to "none"
        if not auto_assign:
            distribution_mode = "none"

        # Normalize and validate distribution mode
        allowed_modes = {"default_rules", "selected_reps", "single_salesperson", "manual_single", "none", "automatic", "unassigned"}
        if distribution_mode not in allowed_modes:
            raise BadRequestException(f"Unsupported distribution mode '{distribution_mode}'.")

        if distribution_mode == "automatic":
            distribution_mode = "default_rules"
        elif distribution_mode in ("unassigned", "none"):
            distribution_mode = "none"
        elif distribution_mode == "manual_single":
            distribution_mode = "single_salesperson"

        # Validate selections on the backend
        allowed_scope = await self.get_actor_scope(actor)

        # Salespeople must import leads for themselves only. Force assignment to the logged-in
        # salesperson on the backend, and reject attempts to assign outside self.
        is_salesperson = (allowed_scope is not None and len(allowed_scope) == 1 and actor.id in allowed_scope)
        if is_salesperson:
            if target_salesperson_id is not None and target_salesperson_id != actor.id:
                raise ForbiddenException(f"Target salesperson {target_salesperson_id} is outside your authorized scope.")
            distribution_mode = "single_salesperson"
            target_salesperson_id = actor.id
            selected_salesperson_ids = None
            auto_assign = True

            # Ensure salesperson config exists and is active for the actor so self-import succeeds
            sp_cfg_stmt = select(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id == actor.id)
            sp_cfg = (await self.session.execute(sp_cfg_stmt)).scalar_one_or_none()
            if not sp_cfg:
                sp_cfg = CrmSalespersonConfig(
                    user_id=actor.id,
                    is_eligible=True,
                    is_active=True,
                )
                self.session.add(sp_cfg)
                await self.session.flush()
            else:
                if not sp_cfg.is_eligible or not sp_cfg.is_active:
                    sp_cfg.is_eligible = True
                    sp_cfg.is_active = True
                    await self.session.flush()

        if distribution_mode == "selected_reps":
            if not selected_salesperson_ids:
                raise BadRequestException("Please select at least one salesperson for distribution.")
            for uid in selected_salesperson_ids:
                if allowed_scope is not None and uid not in allowed_scope:
                    raise ForbiddenException(f"Salesperson {uid} is outside your authorized scope.")
                user_check = await self.session.execute(
                    select(User, CrmSalespersonConfig)
                    .join(CrmSalespersonConfig, CrmSalespersonConfig.user_id == User.id)
                    .where(
                        User.id == uid,
                        User.deleted_at.is_(None),
                        User.is_active.is_(True),
                        User.has_login.is_(True),
                        User.status == UserStatus.ACTIVE,
                        CrmSalespersonConfig.is_eligible.is_(True),
                        CrmSalespersonConfig.is_active.is_(True),
                    )
                )
                if not user_check.first():
                    raise BadRequestException(f"Selected salesperson {uid} is not active or eligible for distribution.")

        elif distribution_mode == "single_salesperson":
            if not target_salesperson_id:
                raise BadRequestException("Target salesperson must be specified for single salesperson mode.")
            if allowed_scope is not None and target_salesperson_id not in allowed_scope:
                raise ForbiddenException(f"Target salesperson {target_salesperson_id} is outside your authorized scope.")

            # Verify target salesperson is active and eligible
            if not (is_salesperson and target_salesperson_id == actor.id):
                user_check = await self.session.execute(
                    select(User, CrmSalespersonConfig)
                    .join(CrmSalespersonConfig, CrmSalespersonConfig.user_id == User.id)
                    .where(
                        User.id == target_salesperson_id,
                        User.deleted_at.is_(None),
                        User.is_active.is_(True),
                        User.has_login.is_(True),
                        User.status == UserStatus.ACTIVE,
                        CrmSalespersonConfig.is_eligible.is_(True),
                        CrmSalespersonConfig.is_active.is_(True),
                    )
                )
                if not user_check.first():
                    raise BadRequestException("Target salesperson is not active or eligible for assignment.")
            else:
                user_check = await self.session.execute(
                    select(User).where(
                        User.id == target_salesperson_id,
                        User.deleted_at.is_(None),
                        User.is_active.is_(True),
                        User.has_login.is_(True),
                        User.status == UserStatus.ACTIVE,
                    )
                )
                if not user_check.first():
                    raise BadRequestException("Target salesperson is not active or eligible for assignment.")


        preview = await self.preview_import(
            pipeline_id=pipeline_id,
            raw_bytes=raw_bytes,
            actor=actor,
        )

        pipeline, initial_stage = await self.get_and_validate_pipeline(pipeline_id)

        clean_batch_name = (
            batch_name.strip()
            if batch_name and batch_name.strip()
            else f"CSV Import - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
        )
        if len(clean_batch_name) > 200:
            clean_batch_name = clean_batch_name[:200]

        # Create CrmImportBatch
        batch = CrmImportBatch(
            batch_name=clean_batch_name,
            import_source="csv",
            selected_pipeline_id=pipeline.id,
            initiated_by=actor.id,
            status="processing",
            total_count=preview.total_rows,
            success_count=0,
            failed_count=0,
            skipped_count=0,
        )
        self.session.add(batch)
        await self.session.flush()

        # Deduplicate & deterministically sort candidate normalized phones BEFORE locking
        # so concurrent multi-row CSV imports with overlapping phones in opposite row orders
        # always acquire transaction-scoped advisory locks in the exact same order (deadlock-free)
        # and share the identical lock namespace (`crm_lead_phone:<phone>`) with manual lead creation.
        candidate_phones = sorted(
            {
                r.normalized_phone
                for r in preview.rows
                if r.normalized_phone and r.status in ("VALID", "CRM_DUPLICATE")
            }
        )
        bind = self.session.get_bind()
        is_pg = bind is not None and bind.dialect.name == "postgresql"
        if is_pg and candidate_phones:
            # Single batched advisory lock query preserving exact sorted ascending acquisition order
            # and identical lock namespace (`crm_lead_phone:<phone>`) with manual lead creation.
            await self.session.execute(
                text(
                    "SELECT pg_advisory_xact_lock(hashtext('crm_lead_phone:' || p)) "
                    "FROM unnest(CAST(:phones AS text[])) WITH ORDINALITY AS t(p, ord) "
                    "ORDER BY ord"
                ),
                {"phones": candidate_phones},
            )

        # Re-fetch existing CRM leads AFTER acquiring advisory locks (fresh READ COMMITTED view)
        existing_crm_leads: dict[str, CrmLead] = {}
        if candidate_phones:
            lead_stmt = (
                select(CrmLead)
                .where(
                    CrmLead.normalized_phone.in_(candidate_phones),
                    CrmLead.deleted_at.is_(None),
                )
                .order_by(CrmLead.id.asc())
                .with_for_update()
            )
            leads = (await self.session.execute(lead_stmt)).scalars().all()
            for l in leads:
                existing_crm_leads[l.normalized_phone] = l

        confirm_unassigned_dup_ids = [
            l.id for l in existing_crm_leads.values() if l.assigned_to is None
        ]
        confirm_unassigned_owners_map: dict[uuid.UUID, tuple[bool, uuid.UUID | None]] = {}
        if confirm_unassigned_dup_ids and allowed_scope is not None:
            from app.crm.lead_service import resolve_unassigned_leads_effective_owners

            confirm_unassigned_owners_map = await resolve_unassigned_leads_effective_owners(
                self.session, confirm_unassigned_dup_ids
            )

        def _handle_existing_crm_duplicate(
            existing_lead: CrmLead,
            row: CrmImportRowPreview,
            norm_phone: str,
        ) -> CrmImportRowPreview:
            """
            Non-destructively attribute a new campaign touchpoint onto an existing lead
            while preserving its owner, pipeline, stage, status, and Wave 1 privacy masking.
            """
            cf = dict(existing_lead.custom_fields or {})
            camp_hist = list(cf.get("campaign_history") or [])
            existing_camps = {
                c.get("campaign", "").strip().lower()
                for c in camp_hist
                if isinstance(c, dict) and c.get("campaign")
            }
            if existing_lead.campaign:
                existing_camps.add(existing_lead.campaign.strip().lower())

            clean_campaign = (row.campaign or "").strip()
            is_new_campaign = bool(clean_campaign and clean_campaign.lower() not in existing_camps)

            if is_new_campaign:
                camp_hist.append({
                    "campaign": clean_campaign,
                    "observed_at": datetime.now(timezone.utc).isoformat(),
                    "batch_id": str(batch.id),
                })
                cf["campaign_history"] = camp_hist
                existing_lead.custom_fields = cf
                flag_modified(existing_lead, "custom_fields")

                activity = CrmActivity(
                    lead_id=existing_lead.id,
                    activity_type="campaign",
                    subject=f"Campaign Touchpoint: {clean_campaign}",
                    description=f"Duplicate contact observed in CSV batch '{batch.batch_name}'",
                    performed_by=actor.id,
                )
                self.session.add(activity)

            is_within_scope = self._is_lead_in_actor_scope(
                existing_lead,
                allowed_scope,
                is_salesperson=is_salesperson,
                unassigned_owners_map=confirm_unassigned_owners_map,
            )
            row_input_priority = getattr(row, "priority", None) or "medium"
            if is_within_scope:
                matched_code = existing_lead.lead_code
                res_priority = existing_lead.priority or row_input_priority
                res_company_id = existing_lead.company_id or row.company_id
                res_matched_company_name = existing_lead.company_name or row.matched_company_name
                res_company_action = row.company_action or ("EXISTING" if existing_lead.company_id else "NONE")
                res_company_resolution_note = row.company_resolution_note
            else:
                matched_code = None
                res_priority = row_input_priority
                res_company_id = None
                res_matched_company_name = None
                res_company_action = None
                res_company_resolution_note = None

            return CrmImportRowPreview(
                row_number=row.row_number,
                name=row.name,
                original_phone=row.original_phone,
                normalized_phone=norm_phone,
                campaign=row.campaign,
                priority=res_priority,
                status="CRM_DUPLICATE",
                validation_message=(
                    f"Duplicate contact preserved. Attributed campaign '{clean_campaign}'."
                    if is_new_campaign
                    else f"Duplicate contact preserved. Campaign '{clean_campaign}' already recorded."
                ),
                is_valid_candidate=False,
                matched_lead_code=matched_code,
                company=row.company,
                company_id=res_company_id,
                matched_company_name=res_matched_company_name,
                company_action=res_company_action,
                company_resolution_note=res_company_resolution_note,
            )

        success_count = 0
        skipped_count = 0
        failed_count = 0
        assigned_count = 0
        unassigned_count = 0
        row_errors: list[dict[str, Any]] = []
        final_row_results: list[CrmImportRowPreview] = []
        batch_companies: dict[str, tuple[uuid.UUID | None, str | None, bool]] = {}

        seen_in_transaction: set[str] = set()

        for row in preview.rows:
            if row.status == "INVALID":
                failed_count += 1
                outcome_label = _get_failure_outcome(row.validation_message)
                row_errors.append({
                    "row": row.row_number,
                    "outcome": outcome_label,
                    "reason": row.validation_message,
                    "action": _get_remediation_guidance(row.validation_message),
                })
                final_row_results.append(row)
                continue

            if row.status in ("FILE_DUPLICATE", "CONFLICT_IN_FILE"):
                skipped_count += 1
                final_row_results.append(row)
                continue

            norm_phone = row.normalized_phone
            if not norm_phone:
                failed_count += 1
                row_errors.append({
                    "row": row.row_number,
                    "outcome": "Invalid Phone",
                    "reason": row.validation_message or "Missing or invalid phone number.",
                    "action": "Provide a 10-digit Indian mobile number or valid E.164 phone number.",
                })
                final_row_results.append(row)
                continue

            # Protection against concurrency/repetition
            if norm_phone in seen_in_transaction:
                skipped_count += 1
                dup_row = CrmImportRowPreview(
                    row_number=row.row_number,
                    name=row.name,
                    original_phone=row.original_phone,
                    normalized_phone=norm_phone,
                    campaign=row.campaign,
                    priority=getattr(row, "priority", "medium") or "medium",
                    status="FILE_DUPLICATE",
                    validation_message="Repeated contact within this batch.",
                    is_valid_candidate=False,
                    matched_lead_code=row.matched_lead_code,
                    company=row.company,
                    company_id=row.company_id,
                    matched_company_name=row.matched_company_name,
                    company_action=row.company_action,
                    company_resolution_note=row.company_resolution_note,
                )
                final_row_results.append(dup_row)
                continue

            seen_in_transaction.add(norm_phone)

            # Check if exists in CRM
            if norm_phone in existing_crm_leads:
                existing_lead = existing_crm_leads[norm_phone]
                skipped_count += 1
                final_row_results.append(
                    _handle_existing_crm_duplicate(existing_lead, row, norm_phone)
                )
            else:
                # Resolve or reuse company record (reuse preview's batched EXISTING match with zero redundant SQL)
                cand_comp = getattr(row, "company", None)
                row_gstin = normalize_gstin(getattr(row, "gstin", None))
                comp_id: uuid.UUID | None = None
                comp_name: str | None = None
                created_new_comp: bool = False
                if (cand_comp and cand_comp.strip()) or row_gstin:
                    effective_comp_name = cand_comp.strip() if (cand_comp and cand_comp.strip()) else row.name
                    norm_cname = normalize_company_name(effective_comp_name)
                    cache_key = f"gst:{row_gstin}" if row_gstin else f"name:{norm_cname.lower()}"
                    if row.company_action == "EXISTING" and row.company_id is not None:
                        comp_id = row.company_id
                        comp_name = row.matched_company_name or effective_comp_name
                        created_new_comp = False
                        batch_companies[cache_key] = (comp_id, comp_name, False)
                    elif cache_key in batch_companies:
                        comp_id, comp_name, created_new_comp = batch_companies[cache_key]
                    else:
                        comp_id, comp_name, created_new_comp = await resolve_or_create_company(
                            self.session,
                            company_name=effective_comp_name,
                            tax_id=row_gstin,
                            contact_name=row.name,
                            contact_phone=norm_phone,
                            actor_id=actor.id,
                            auto_create=True,
                            skip_partial_match=(row.company_action == "NEW"),
                        )
                        batch_companies[cache_key] = (comp_id, comp_name, created_new_comp)

                # Valid new lead creation with savepoint fallback for normalized-phone uniqueness
                row_priority = getattr(row, "priority", None) or "medium"
                lead_custom_fields: dict[str, Any] = {
                    "batch_id": str(batch.id),
                    "batch_name": batch.batch_name,
                    "campaign_history": [
                        {
                            "campaign": row.campaign,
                            "observed_at": datetime.now(timezone.utc).isoformat(),
                            "batch_id": str(batch.id),
                        }
                    ],
                }
                if row_gstin:
                    lead_custom_fields["gstin"] = row_gstin

                new_lead = CrmLead(
                    name=row.name,
                    original_phone=row.original_phone,
                    normalized_phone=norm_phone,
                    email=getattr(row, "email", None),
                    company_name=comp_name,
                    company_id=comp_id,
                    campaign=row.campaign,
                    source_type="company_campaign",
                    source_detail=f"CSV Import: {batch.batch_name}",
                    created_by=actor.id,
                    assigned_to=None,  # No assignment engine in Phase 4
                    pipeline_id=pipeline.id,
                    stage_id=initial_stage.id,
                    status="new",
                    priority=row_priority,
                    custom_fields=lead_custom_fields,
                )
                try:
                    async with self.session.begin_nested():
                        self.session.add(new_lead)
                        await self.session.flush()
                except IntegrityError as exc:
                    err_str = str(exc).lower()
                    orig_code = getattr(getattr(exc, "orig", None), "sqlstate", None)
                    is_phone_unique_conflict = (
                        "uq_crm_leads_active_normalized_phone" in err_str
                        or (
                            orig_code == "23505"
                            and "normalized_phone" in err_str
                        )
                    )
                    if not is_phone_unique_conflict:
                        raise

                    # Concurrent writer won the phone uniqueness race; recover safely as CRM_DUPLICATE
                    dup_winner = (
                        await self.session.execute(
                            select(CrmLead)
                            .where(
                                CrmLead.normalized_phone == norm_phone,
                                CrmLead.deleted_at.is_(None),
                            )
                            .with_for_update()
                        )
                    ).scalar_one_or_none()
                    if dup_winner is None:
                        raise
                    existing_crm_leads[norm_phone] = dup_winner
                    if (
                        dup_winner.assigned_to is None
                        and allowed_scope is not None
                        and dup_winner.id not in confirm_unassigned_owners_map
                    ):
                        from app.crm.lead_service import resolve_unassigned_leads_effective_owners

                        confirm_unassigned_owners_map.update(
                            await resolve_unassigned_leads_effective_owners(
                                self.session, [dup_winner.id]
                            )
                        )
                    skipped_count += 1
                    final_row_results.append(
                        _handle_existing_crm_duplicate(dup_winner, row, norm_phone)
                    )
                    continue

                success_count += 1

                # Add creation touchpoint activity
                activity = CrmActivity(
                    lead_id=new_lead.id,
                    activity_type="campaign",
                    subject=f"Campaign: {row.campaign}",
                    description=f"Lead created from CSV batch '{batch.batch_name}'",
                    performed_by=actor.id,
                )
                self.session.add(activity)

                # Lead Distribution by Mode
                assignment_engine = CrmAssignmentEngineService(self.session)
                if distribution_mode == "default_rules":
                    assign_res = await assignment_engine.assign_lead(
                        new_lead,
                        actor=actor,
                        batch_id=batch.id,
                        commit=False,
                    )
                    if assign_res.assigned:
                        assigned_count += 1
                        val_msg = (
                            f"Lead successfully created with code {new_lead.lead_code} "
                            f"and assigned to sales representative."
                        )
                    else:
                        unassigned_count += 1
                        val_msg = (
                            f"Lead successfully created with code {new_lead.lead_code} "
                            f"(Unassigned: {assign_res.reason})."
                        )
                        cf = dict(new_lead.custom_fields or {})
                        cf["assignment_status"] = "unassigned"
                        cf["unassigned_reason"] = assign_res.reason
                        new_lead.custom_fields = cf

                elif distribution_mode == "selected_reps":
                    assert selected_salesperson_ids is not None
                    assign_res = await assignment_engine.assign_lead_to_candidates(
                        new_lead,
                        candidate_user_ids=selected_salesperson_ids,
                        strategy=distribution_strategy or "round_robin",
                        actor=actor,
                        batch_id=batch.id,
                        commit=False,
                    )
                    if assign_res.assigned:
                        assigned_count += 1
                        val_msg = (
                            f"Lead successfully created with code {new_lead.lead_code} "
                            f"and assigned to sales representative."
                        )
                    else:
                        unassigned_count += 1
                        val_msg = (
                            f"Lead successfully created with code {new_lead.lead_code} "
                            f"(Unassigned: {assign_res.reason})."
                        )
                        cf = dict(new_lead.custom_fields or {})
                        cf["assignment_status"] = "unassigned"
                        cf["unassigned_reason"] = assign_res.reason
                        new_lead.custom_fields = cf

                elif distribution_mode == "single_salesperson":
                    assert target_salesperson_id is not None
                    assign_res = await assignment_engine.assign_lead_to_single_salesperson(
                        new_lead,
                        target_salesperson_id=target_salesperson_id,
                        actor=actor,
                        batch_id=batch.id,
                        commit=False,
                    )
                    if assign_res.assigned:
                        assigned_count += 1
                        val_msg = (
                            f"Lead successfully created with code {new_lead.lead_code} "
                            f"and assigned to sales representative."
                        )
                    elif is_salesperson and target_salesperson_id == actor.id:
                        # Forced self-assignment for salesperson personal import
                        new_lead.assigned_to = actor.id
                        assigned_count += 1
                        val_msg = (
                            f"Lead successfully created with code {new_lead.lead_code} "
                            f"and assigned to you."
                        )
                        history = CrmAssignmentHistory(
                            lead_id=new_lead.id,
                            previous_owner_id=None,
                            new_owner_id=actor.id,
                            assignment_method="personal_import",
                            assigned_by=actor.id,
                            reason=f"Forced self-assignment for salesperson import batch '{batch.batch_name}'",
                            batch_id=batch.id,
                            created_at=datetime.now(timezone.utc),
                        )
                        self.session.add(history)
                    else:
                        unassigned_count += 1
                        val_msg = (
                            f"Lead successfully created with code {new_lead.lead_code} "
                            f"(Unassigned: {assign_res.reason})."
                        )
                        cf = dict(new_lead.custom_fields or {})
                        cf["assignment_status"] = "unassigned"
                        cf["unassigned_reason"] = assign_res.reason
                        new_lead.custom_fields = cf

                else:
                    # Mode "none" (unassigned)
                    unassigned_count += 1
                    cf = dict(new_lead.custom_fields or {})
                    cf["assignment_status"] = "unassigned"
                    cf["unassigned_reason"] = "import_without_assignment"
                    new_lead.custom_fields = cf
                    val_msg = f"Lead successfully created with code {new_lead.lead_code} (Unassigned)."

                # Keep in local dict in case subsequent rows match
                existing_crm_leads[norm_phone] = new_lead

                resolved_company_action = (
                    ("NEW" if created_new_comp else "EXISTING")
                    if comp_id
                    else (row.company_action or "NONE")
                )
                resolved_company_note = (
                    f"New company '{comp_name}' created and linked"
                    if created_new_comp and comp_name
                    else (
                        f"Existing company '{comp_name}' matched and linked"
                        if comp_id and comp_name
                        else row.company_resolution_note
                    )
                )

                final_row_results.append(
                    CrmImportRowPreview(
                        row_number=row.row_number,
                        name=row.name,
                        original_phone=row.original_phone,
                        normalized_phone=norm_phone,
                        campaign=row.campaign,
                        priority=row_priority,
                        status="VALID",
                        validation_message=val_msg,
                        is_valid_candidate=True,
                        matched_lead_code=new_lead.lead_code,
                        company=row.company,
                        company_id=comp_id,
                        matched_company_name=comp_name,
                        company_action=resolved_company_action,
                        company_resolution_note=resolved_company_note,
                    )
                )

        # Update batch completion status
        batch.success_count = success_count
        batch.skipped_count = skipped_count
        batch.failed_count = failed_count
        batch.completed_at = datetime.now(timezone.utc)

        # Determine status according to Phase 4 business rule:
        # SUCCESS if at least one new lead was successfully committed (success_count > 0)
        # OR all rows were safely processed as duplicates (skipped_count > 0 and failed_count == 0)
        # OR some leads were created or duplicates were safely processed and other rows failed.
        # FAILURE only when no new lead was committed, no duplicate was processed, and all attempted rows failed
        # (success_count == 0 and skipped_count == 0), or when the import operation failed and could not be committed.
        is_success = (success_count > 0 or skipped_count > 0)
        batch.status = "completed" if is_success else "failed"
        disp_status = "Success" if is_success else "Failure"

        if row_errors:
            batch.sanitized_error_summary = json.dumps(row_errors[:100])  # limit summary size
        else:
            batch.sanitized_error_summary = None

        try:
            await self.session.commit()
            await self.session.refresh(batch)
        except Exception:
            await self.session.rollback()
            raise

        logger.info(
            "CRM CSV import committed successfully.",
            extra={
                "batch_id": str(batch.id),
                "total": batch.total_count,
                "success": batch.success_count,
                "skipped": batch.skipped_count,
                "failed": batch.failed_count,
            },
        )

        return CrmImportConfirmResponse(
            batch_id=batch.id,
            batch_name=batch.batch_name,
            status=batch.status,
            display_status=disp_status,
            total_rows=batch.total_count,
            success_count=batch.success_count,
            duplicate_skipped_count=batch.skipped_count,
            failed_count=batch.failed_count,
            pipeline_id=pipeline.id,
            pipeline_name=pipeline.name,
            sanitized_error_summary=batch.sanitized_error_summary,
            row_results=final_row_results,
            assigned_count=assigned_count,
            unassigned_count=unassigned_count,
        )

    # -------------------------------------------------------------------------
    # Batch History
    # -------------------------------------------------------------------------

    async def list_batches(
        self,
        *,
        actor: CurrentUser,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CrmImportBatchRead]:
        """List import batches within actor's permission scope."""
        allowed_scope = await self.get_actor_scope(actor)

        stmt = (
            select(CrmImportBatch)
            .options(
                selectinload(CrmImportBatch.pipeline),
                selectinload(CrmImportBatch.initiator),
            )
            .order_by(CrmImportBatch.created_at.desc())
            .limit(min(limit, 100))
            .offset(max(offset, 0))
        )

        if allowed_scope is not None:
            stmt = stmt.where(CrmImportBatch.initiated_by.in_(list(allowed_scope)))

        batches = (await self.session.execute(stmt)).scalars().all()
        batch_ids = [b.id for b in batches]
        assigned_counts: dict[uuid.UUID, int] = {}
        if batch_ids:
            stmt_assign = (
                select(CrmAssignmentHistory.batch_id, func.count(CrmAssignmentHistory.id))
                .where(
                    CrmAssignmentHistory.batch_id.in_(batch_ids),
                    CrmAssignmentHistory.new_owner_id.is_not(None),
                )
                .group_by(CrmAssignmentHistory.batch_id)
            )
            assigned_rows = (await self.session.execute(stmt_assign)).all()
            assigned_counts = {r[0]: r[1] for r in assigned_rows}

        results: list[CrmImportBatchRead] = []
        for b in batches:
            p_name = b.pipeline.name if b.pipeline else None
            u_name = b.initiator.display_name or b.initiator.username if b.initiator else None
            is_success = (b.success_count > 0 or b.skipped_count > 0) and b.status != "failed"
            if b.status == "completed":
                is_success = True
            elif b.success_count == 0 and b.skipped_count == 0:
                is_success = False
            effective_status = "completed" if is_success else "failed"
            disp_status = "Success" if is_success else "Failure"
            assigned_cnt = assigned_counts.get(b.id, 0)
            unassigned_cnt = max(0, b.success_count - assigned_cnt)

            results.append(
                CrmImportBatchRead(
                    id=b.id,
                    batch_name=b.batch_name,
                    import_source=b.import_source,
                    selected_pipeline_id=b.selected_pipeline_id,
                    pipeline_name=p_name,
                    initiated_by=b.initiated_by,
                    initiator_name=u_name,
                    status=effective_status,
                    display_status=disp_status,
                    total_count=b.total_count,
                    success_count=b.success_count,
                    failed_count=b.failed_count,
                    skipped_count=b.skipped_count,
                    assigned_count=assigned_cnt,
                    unassigned_count=unassigned_cnt,
                    created_at=b.created_at,
                    completed_at=b.completed_at,
                    sanitized_error_summary=b.sanitized_error_summary,
                )
            )
        return results

    async def get_batch_by_id(
        self,
        batch_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> CrmImportBatchRead:
        """Fetch individual import batch by ID with scope validation."""
        allowed_scope = await self.get_actor_scope(actor)

        stmt = (
            select(CrmImportBatch)
            .options(
                selectinload(CrmImportBatch.pipeline),
                selectinload(CrmImportBatch.initiator),
            )
            .where(CrmImportBatch.id == batch_id)
        )
        batch = (await self.session.execute(stmt)).scalar_one_or_none()
        if not batch:
            raise NotFoundException("Import batch not found.")

        if allowed_scope is not None and batch.initiated_by not in allowed_scope:
            raise ForbiddenException("You do not have permission to view this import batch.")

        p_name = batch.pipeline.name if batch.pipeline else None
        u_name = batch.initiator.display_name or batch.initiator.username if batch.initiator else None
        is_success = (batch.success_count > 0 or batch.skipped_count > 0) and batch.status != "failed"
        if batch.status == "completed":
            is_success = True
        elif batch.success_count == 0 and batch.skipped_count == 0:
            is_success = False
        effective_status = "completed" if is_success else "failed"
        disp_status = "Success" if is_success else "Failure"

        stmt_assign = (
            select(func.count(CrmAssignmentHistory.id))
            .where(
                CrmAssignmentHistory.batch_id == batch.id,
                CrmAssignmentHistory.new_owner_id.is_not(None),
            )
        )
        assigned_cnt = (await self.session.execute(stmt_assign)).scalar() or 0
        unassigned_cnt = max(0, batch.success_count - assigned_cnt)

        return CrmImportBatchRead(
            id=batch.id,
            batch_name=batch.batch_name,
            import_source=batch.import_source,
            selected_pipeline_id=batch.selected_pipeline_id,
            pipeline_name=p_name,
            initiated_by=batch.initiated_by,
            initiator_name=u_name,
            status=effective_status,
            display_status=disp_status,
            total_count=batch.total_count,
            success_count=batch.success_count,
            failed_count=batch.failed_count,
            skipped_count=batch.skipped_count,
            assigned_count=assigned_cnt,
            unassigned_count=unassigned_cnt,
            created_at=batch.created_at,
            completed_at=batch.completed_at,
            sanitized_error_summary=batch.sanitized_error_summary,
        )
