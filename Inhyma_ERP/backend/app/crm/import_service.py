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

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.core.logging import get_logger
from app.crm.assignment_service import CrmAssignmentEngineService
from app.crm.company_linking import (
    AmbiguousCompanyMatchException,
    normalize_company_name,
    resolve_or_create_company,
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
)
from app.org_structure.models import DepartmentLeadershipAssignment, OrgRecordStatus
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus

logger = get_logger(__name__)

# Configurable limits per repository conventions
MAX_CSV_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_CSV_ROW_COUNT = 5000


def sanitize_csv_cell(val: Any) -> str:
    """Protect exported CSV text from formula injection attacks."""
    s = str(val or "")
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{s}"
    return s


def _get_failure_outcome(reason: str) -> str:
    """Categorize row-level failure outcome concisely."""
    r_lower = reason.lower()
    if "phone" in r_lower or "digit" in r_lower:
        return "Invalid Phone"
    if "name" in r_lower:
        return "Invalid Name"
    if "campaign" in r_lower:
        return "Invalid Campaign"
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
    cleaned = val.strip()
    if cleaned and cleaned[0] in ("=", "@", "+", "-", "\t", "\r"):
        if cleaned.startswith(("+", "-")) and any(c.isdigit() for c in cleaned):
            return cleaned
        return f"'{cleaned}"
    return cleaned


class CrmImportService:
    """Service layer for CRM CSV Lead Import and Duplicate Detection."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

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

        is_manager = bool(
            "department_manager" in role_names
            or any("manager" in r for r in role_names)
            or len(direct_reports) > 0
            or len(led_dept_ids) > 0
        )

        if not is_manager:
            # Salesperson importing for themselves
            return {actor.id}

        managed_dept_ids: set[uuid.UUID] = set(led_dept_ids)
        for r in roles:
            if r.name.lower() not in ("user", "super_admin", "admin", "department_manager", "employee"):
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
        for idx, col in enumerate(raw_headers):
            cleaned = col.strip().lower()
            if cleaned:
                header_map[cleaned] = idx

        # Allow flexible aliases for required columns
        if "number" not in header_map:
            for alt in ("phone", "mobile", "contact_number", "contact number", "phone_number", "phone number"):
                if alt in header_map:
                    header_map["number"] = header_map[alt]
                    break

        if "name" not in header_map:
            for alt in ("contact_name", "contact name", "prospect_name", "prospect name", "lead_name", "lead name"):
                if alt in header_map:
                    header_map["name"] = header_map[alt]
                    break

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
        if priority_idx is None:
            priority_idx = header_map.get("lead_priority")
        if priority_idx is None:
            priority_idx = header_map.get("lead priority")

        company_idx = header_map.get("company")
        if company_idx is None:
            company_idx = header_map.get("company_name")
        if company_idx is None:
            company_idx = header_map.get("company name")

        # First pass: parse rows and collect candidate normalized phones
        parsed_rows: list[dict[str, Any]] = []
        valid_normalized_phones: set[str] = set()
        proposed_new_companies: dict[str, int] = {}

        for idx, row in enumerate(data_rows, start=2):  # row 1 is header
            name_val = _sanitize_formula_prefix(row[name_idx]) if len(row) > name_idx else ""
            number_val = row[number_idx].strip() if len(row) > number_idx else ""
            campaign_val = _sanitize_formula_prefix(row[campaign_idx]) if len(row) > campaign_idx else ""
            company_val = (
                _sanitize_formula_prefix(row[company_idx]).strip()
                if company_idx is not None and len(row) > company_idx
                else ""
            )

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

            # Validate company matching / ambiguity in preview
            matched_company_id: uuid.UUID | None = None
            matched_company_name: str | None = None
            company_action: str | None = None
            company_resolution_note: str | None = None

            if not company_val:
                company_action = "NONE"
                company_resolution_note = "No company provided (lead will not be linked to a company)"
            elif not row_errors:
                try:
                    c_id, c_name, _ = await resolve_or_create_company(
                        self.session,
                        company_name=company_val,
                        contact_name=name_val,
                        auto_create=False,
                    )
                    if c_id:
                        matched_company_id = c_id
                        matched_company_name = c_name
                        company_action = "EXISTING"
                        company_resolution_note = f"Existing company '{c_name}' matched (will be reused)"
                    else:
                        norm_cname = normalize_company_name(company_val)
                        if norm_cname in proposed_new_companies:
                            first_row = proposed_new_companies[norm_cname]
                            company_action = "NEW"
                            matched_company_name = company_val
                            company_resolution_note = f"Reuses proposed new company '{company_val}' (from row {first_row})"
                        else:
                            proposed_new_companies[norm_cname] = idx
                            company_action = "NEW"
                            matched_company_name = company_val
                            company_resolution_note = f"New company '{company_val}' will be created upon confirmation"
                except AmbiguousCompanyMatchException:
                    company_action = "AMBIGUOUS"
                    company_resolution_note = f"Ambiguous company match: multiple existing companies match '{company_val}'"
                    row_errors.append(
                        f"Ambiguous company match: multiple existing companies match '{company_val}'. "
                        "Please specify the full company name or link manually."
                    )

            if norm_phone and not row_errors:
                valid_normalized_phones.add(norm_phone)

            parsed_rows.append({
                "row_number": idx,
                "name": name_val,
                "original_phone": number_val,
                "normalized_phone": norm_phone,
                "campaign": campaign_val,
                "company": company_val if company_val else None,
                "company_id": matched_company_id,
                "matched_company_name": matched_company_name,
                "company_action": company_action,
                "company_resolution_note": company_resolution_note,
                "priority": priority_val,
                "errors": row_errors,
            })


        # Query existing CRM leads by normalized phone
        existing_crm_leads: dict[str, CrmLead] = {}
        if valid_normalized_phones:
            lead_stmt = (
                select(CrmLead)
                .where(
                    CrmLead.normalized_phone.in_(list(valid_normalized_phones)),
                    CrmLead.deleted_at.is_(None),
                )
            )
            leads = (await self.session.execute(lead_stmt)).scalars().all()
            for l in leads:
                existing_crm_leads[l.normalized_phone] = l

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

                # Check caller scope for privacy
                is_within_scope = (
                    allowed_scope is None
                    or lead.assigned_to in allowed_scope
                    or lead.created_by in allowed_scope
                )

                if is_within_scope:
                    msg = f"Contact already exists in CRM (Lead Code: {lead.lead_code}). New campaign will be attributed."
                    matched_code = lead.lead_code
                else:
                    msg = "Contact already exists in CRM. New campaign will be attributed."
                    matched_code = None

                preview_rows.append(
                    CrmImportRowPreview(
                        row_number=row_num,
                        name=name,
                        original_phone=orig_phone,
                        normalized_phone=norm_phone,
                        campaign=camp,
                        priority=lead.priority or p_val,
                        status="CRM_DUPLICATE",
                        validation_message=msg,
                        is_valid_candidate=False,
                        matched_lead_code=matched_code,
                        company=r.get("company"),
                        company_id=r.get("company_id"),
                        matched_company_name=r.get("matched_company_name"),
                        company_action=r.get("company_action"),
                        company_resolution_note=r.get("company_resolution_note"),
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

        # Re-fetch existing CRM leads with lock inside transaction
        candidate_phones = [
            r.normalized_phone for r in preview.rows if r.normalized_phone and r.status in ("VALID", "CRM_DUPLICATE")
        ]
        existing_crm_leads: dict[str, CrmLead] = {}
        if candidate_phones:
            lead_stmt = (
                select(CrmLead)
                .where(
                    CrmLead.normalized_phone.in_(candidate_phones),
                    CrmLead.deleted_at.is_(None),
                )
                .with_for_update()
            )
            leads = (await self.session.execute(lead_stmt)).scalars().all()
            for l in leads:
                existing_crm_leads[l.normalized_phone] = l

        success_count = 0
        skipped_count = 0
        failed_count = 0
        assigned_count = 0
        unassigned_count = 0
        row_errors: list[dict[str, Any]] = []
        final_row_results: list[CrmImportRowPreview] = []
        batch_companies: dict[str, tuple[uuid.UUID, str]] = {}

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
                    status="FILE_DUPLICATE",
                    validation_message="Repeated contact within this batch.",
                    is_valid_candidate=False,
                    matched_lead_code=row.matched_lead_code,
                )
                final_row_results.append(dup_row)
                continue

            seen_in_transaction.add(norm_phone)

            # Check if exists in CRM
            if norm_phone in existing_crm_leads:
                existing_lead = existing_crm_leads[norm_phone]
                skipped_count += 1

                # Preserve original campaign, owner, pipeline, stage, name!
                # Record newly observed campaign attribution in custom_fields
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

                    # Record touchpoint activity for the duplicate encounter only for new campaigns
                    activity = CrmActivity(
                        lead_id=existing_lead.id,
                        activity_type="campaign",
                        subject=f"Campaign Touchpoint: {clean_campaign}",
                        description=f"Duplicate contact observed in CSV batch '{batch.batch_name}'",
                        performed_by=actor.id,
                    )
                    self.session.add(activity)

                final_row_results.append(
                    CrmImportRowPreview(
                        row_number=row.row_number,
                        name=row.name,
                        original_phone=row.original_phone,
                        normalized_phone=norm_phone,
                        campaign=row.campaign,
                        priority=existing_lead.priority,
                        status="CRM_DUPLICATE",
                        validation_message=(
                            f"Duplicate contact preserved. Attributed campaign '{clean_campaign}'."
                            if is_new_campaign
                            else f"Duplicate contact preserved. Campaign '{clean_campaign}' already recorded."
                        ),
                        is_valid_candidate=False,
                        matched_lead_code=existing_lead.lead_code,
                    )
                )
            else:
                # Resolve or reuse company record
                cand_comp = getattr(row, "company", None)
                comp_id: uuid.UUID | None = None
                comp_name: str | None = None
                if cand_comp and cand_comp.strip():
                    norm_cname = normalize_company_name(cand_comp)
                    if norm_cname in batch_companies:
                        comp_id, comp_name = batch_companies[norm_cname]
                    else:
                        comp_id, comp_name, _ = await resolve_or_create_company(
                            self.session,
                            company_name=cand_comp.strip(),
                            contact_name=row.name,
                            contact_phone=norm_phone,
                            actor_id=actor.id,
                            auto_create=True,
                        )
                        batch_companies[norm_cname] = (comp_id, comp_name)

                # Valid new lead creation
                success_count += 1
                row_priority = getattr(row, "priority", None) or "medium"
                new_lead = CrmLead(
                    name=row.name,
                    original_phone=row.original_phone,
                    normalized_phone=norm_phone,
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
                    custom_fields={
                        "batch_id": str(batch.id),
                        "batch_name": batch.batch_name,
                        "campaign_history": [
                            {
                                "campaign": row.campaign,
                                "observed_at": datetime.now(timezone.utc).isoformat(),
                                "batch_id": str(batch.id),
                            }
                        ],
                    },
                )
                self.session.add(new_lead)
                await self.session.flush()

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

                final_row_results.append(
                    CrmImportRowPreview(
                        row_number=row.row_number,
                        name=row.name,
                        original_phone=row.original_phone,
                        normalized_phone=norm_phone,
                        campaign=row.campaign,
                        status="VALID",
                        validation_message=val_msg,
                        is_valid_candidate=True,
                        matched_lead_code=new_lead.lead_code,
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
