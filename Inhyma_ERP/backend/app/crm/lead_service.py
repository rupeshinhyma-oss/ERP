"""
CRM Lead and Assignment Visibility Service.

Provides secure, scoped querying of CRM leads and persisted assignment audit history.
Strictly adheres to CRM RBAC and departmental scoping rules.
"""

from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone
import math
import uuid
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.auth.service import CurrentUser
from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.core.logging import get_logger
from app.crm.company_linking import AmbiguousCompanyMatchException, resolve_or_create_company
from app.crm.import_service import normalize_phone_number
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmFollowUp,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmSalespersonConfig,
    CrmStageHistory,
)
from app.crm.schemas import (
    CrmActivityCreate,
    CrmActivityPaginationResponse,
    CrmActivityRead,
    CrmAssignmentHistoryItem,
    CrmAssignmentHistoryPaginationResponse,
    CrmDailyWorkSummary,
    CrmFollowUpCreate,
    CrmFollowUpPaginationResponse,
    CrmFollowUpRead,
    CrmFollowUpStatusUpdate,
    CrmFollowUpSummary,
    CrmFollowUpUpdate,
    CrmLeadCreate,
    CrmLeadListItem,
    CrmLeadPaginationResponse,
    CrmLeadStageTransitionRequest,
    CrmLeadUpdate,
    CrmRepOversightItem,
    CrmStageCountItem,
    CrmStageHistoryListResponse,
    CrmStageHistoryRead,
    CrmTeamOversightResponse,
    CrmTimelineItem,
    CrmTimelineResponse,
    VALID_ACTIVITY_TYPES,
)
from app.crm.follow_up_task_sync import (
    cancel_follow_up_task,
    complete_follow_up_task,
    sync_follow_up_to_task,
)
from app.database.base import _utcnow
from app.org_structure.models import DepartmentLeadershipAssignment, OrgRecordStatus
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus

logger = get_logger(__name__)


try:
    BUSINESS_TZ = ZoneInfo("Asia/Kolkata")
except Exception:
    BUSINESS_TZ = timezone(timedelta(hours=5, minutes=30))


SYSTEM_ACTIVITY_TYPES = {
    "lead_created",
    "lead_updated",
    "company_changed",
    "stage_change",
    "stage_changed",
    "assignment_changed",
    "reassignment",
    "campaign",
    "follow_up_created",
    "follow_up_completed",
    "follow_up_cancelled",
    "import_touchpoint",
}


def _is_system_activity(activity_type: str, subject: str | None) -> bool:
    """Classify whether an activity record is system-generated or user-entered."""
    if activity_type in SYSTEM_ACTIVITY_TYPES:
        return True
    if subject:
        lower_subj = subject.lower()
        if any(lower_subj.startswith(p) for p in (
            "lead created",
            "lead updated",
            "lead details updated",
            "company changed",
            "company linked",
            "priority changed",
            "lead reassigned",
            "stage changed",
            "follow-up scheduled",
            "follow-up completed",
            "follow-up cancelled",
            "campaign touchpoint",
            "campaign:",
        )):
            return True
    return False


class CrmLeadService:
    """Service for CRM lead database visibility and assignment history."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_actor_role_and_scope(
        self, actor: CurrentUser
    ) -> tuple[str, set[uuid.UUID] | None]:
        """
        Determine actor authority:
        - ("admin", None): Unrestricted company-wide lead visibility.
        - ("manager", scoped_user_ids): Scoped to department/team members + direct reports + self.
        - ("salesperson", {actor.id}): Scoped strictly to leads assigned to or created by self.
        """
        # 1. Company-wide admin check
        if (
            actor.is_super_admin
            or actor.username == "admin"
            or "*" in actor.permissions
            or "super_admin" in actor.permissions
        ):
            return "admin", None

        # Check DB role for admin / super_admin
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
        if (await self.session.execute(admin_role_stmt)).scalar() is not None:
            return "admin", None

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

        if is_manager:
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
            return "manager", scoped_user_ids

        return "salesperson", {actor.id}

    async def list_leads(
        self,
        *,
        actor: CurrentUser,
        search: str | None = None,
        pipeline_id: uuid.UUID | None = None,
        stage_id: uuid.UUID | None = None,
        assigned_to: uuid.UUID | None = None,
        unassigned_only: bool = False,
        campaign: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> CrmLeadPaginationResponse:
        """
        List CRM leads with server-side filters, search, pagination, and RBAC team scoping.
        """
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)

        # Base conditions
        conditions = []

        # Scope enforcement
        if role_type == "manager":
            assert scoped_user_ids is not None
            if assigned_to is not None:
                if assigned_to not in scoped_user_ids:
                    # Manager requested leads for someone outside their scope
                    return CrmLeadPaginationResponse(
                        items=[],
                        total=0,
                        page=page,
                        page_size=page_size,
                        total_pages=0,
                    )
                conditions.append(CrmLead.assigned_to == assigned_to)
            elif unassigned_only:
                conditions.append(CrmLead.assigned_to.is_(None))
            else:
                conditions.append(
                    or_(
                        CrmLead.assigned_to.in_(scoped_user_ids),
                        CrmLead.created_by.in_(scoped_user_ids),
                        CrmLead.assigned_to.is_(None),
                    )
                )
        elif role_type == "salesperson":
            if unassigned_only:
                raise ForbiddenException("Salespeople are not authorized to access unassigned lead queues.")
            assert scoped_user_ids is not None
            if assigned_to is not None and assigned_to != actor.id:
                return CrmLeadPaginationResponse(items=[], total=0, page=page, page_size=page_size, total_pages=0)
            if assigned_to is not None:
                conditions.append(CrmLead.assigned_to == actor.id)
            else:
                conditions.append(or_(CrmLead.assigned_to == actor.id, CrmLead.created_by == actor.id))
        else:
            # Admin: unrestricted
            if unassigned_only:
                conditions.append(CrmLead.assigned_to.is_(None))
            elif assigned_to is not None:
                conditions.append(CrmLead.assigned_to == assigned_to)

        # Common filters
        if pipeline_id is not None:
            conditions.append(CrmLead.pipeline_id == pipeline_id)
        if stage_id is not None:
            conditions.append(CrmLead.stage_id == stage_id)
        if campaign:
            conditions.append(CrmLead.campaign.ilike(f"%{campaign.strip()}%"))
        if status:
            if status.lower() == "active":
                conditions.append(CrmLead.status.notin_(["won", "lost"]))
            else:
                conditions.append(CrmLead.status == status)

        if search:
            term = f"%{search.strip()}%"
            conditions.append(
                or_(
                    CrmLead.name.ilike(term),
                    CrmLead.original_phone.ilike(term),
                    CrmLead.normalized_phone.ilike(term),
                    CrmLead.email.ilike(term),
                    CrmLead.company_name.ilike(term),
                    CrmLead.lead_code.ilike(term),
                )
            )

        # Count total
        count_stmt = select(func.count(CrmLead.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        total_count = (await self.session.execute(count_stmt)).scalar() or 0

        # Query items
        limit = min(max(page_size, 1), 100)
        offset = (max(page, 1) - 1) * limit

        stmt = (
            select(CrmLead)
            .options(
                selectinload(CrmLead.pipeline),
                selectinload(CrmLead.stage),
                selectinload(CrmLead.assignee),
            )
            .order_by(desc(CrmLead.created_at))
            .offset(offset)
            .limit(limit)
        )
        if conditions:
            stmt = stmt.where(and_(*conditions))

        leads = (await self.session.execute(stmt)).scalars().all()

        items: list[CrmLeadListItem] = []
        for lead in leads:
            p_name = lead.pipeline.name if lead.pipeline else None
            s_name = lead.stage.name if lead.stage else None
            s_type = lead.stage.stage_type if lead.stage else None

            assignee_name = None
            assignee_email = None
            if lead.assignee:
                assignee_name = (
                    lead.assignee.display_name
                    or lead.assignee.full_name
                    or lead.assignee.username
                )
                assignee_email = lead.assignee.email

            custom_fields = lead.custom_fields or {}
            is_unassigned = lead.assigned_to is None
            assignment_status = "unassigned" if is_unassigned else "assigned"
            unassigned_reason = (
                custom_fields.get("unassigned_reason")
                if is_unassigned
                else None
            )

            items.append(
                CrmLeadListItem(
                    id=lead.id,
                    lead_code=lead.lead_code,
                    name=lead.name,
                    original_phone=lead.original_phone,
                    normalized_phone=lead.normalized_phone,
                    email=lead.email,
                    company_name=lead.company_name,
                    company_id=lead.company_id,
                    campaign=lead.campaign,
                    source_type=lead.source_type,
                    source_detail=lead.source_detail,
                    pipeline_id=lead.pipeline_id,
                    pipeline_name=p_name,
                    stage_id=lead.stage_id,
                    stage_name=s_name,
                    stage_type=s_type,
                    created_by=lead.created_by,
                    assigned_to=lead.assigned_to,
                    assigned_salesperson_name=assignee_name,
                    assigned_salesperson_email=assignee_email,
                    status=lead.status,
                    priority=lead.priority,
                    assignment_status=assignment_status,
                    unassigned_reason=unassigned_reason,
                    last_contacted_at=lead.last_contacted_at,
                    next_follow_up_at=lead.next_follow_up_at,
                    won_at=lead.won_at,
                    lost_at=lead.lost_at,
                    lost_reason=lead.lost_reason,
                    created_at=lead.created_at,
                    updated_at=lead.updated_at,
                    custom_fields=custom_fields,
                )
            )

        total_pages = math.ceil(total_count / limit) if total_count > 0 else 0

        return CrmLeadPaginationResponse(
            items=items,
            total=total_count,
            page=page,
            page_size=limit,
            total_pages=total_pages,
        )

    async def get_lead(
        self,
        lead_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> CrmLeadListItem:
        """Get single lead with full ownership & assignment visibility, checking RBAC scope."""
        stmt = (
            select(CrmLead)
            .options(
                selectinload(CrmLead.pipeline),
                selectinload(CrmLead.stage),
                selectinload(CrmLead.assignee),
                selectinload(CrmLead.company),
            )
            .where(CrmLead.id == lead_id)
        )
        lead = (await self.session.execute(stmt)).scalar_one_or_none()
        if not lead:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        # Scope enforcement
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        if role_type == "manager":
            assert scoped_user_ids is not None
            is_scoped = (
                (lead.assigned_to is not None and lead.assigned_to in scoped_user_ids)
                or (lead.created_by is not None and lead.created_by in scoped_user_ids)
                or lead.assigned_to is None
            )
            if not is_scoped:
                raise ForbiddenException("You do not have permission to view this lead.")
        elif role_type == "salesperson":
            is_scoped = lead.assigned_to == actor.id or lead.created_by == actor.id
            if not is_scoped:
                raise ForbiddenException("You do not have permission to view this lead.")

        p_name = lead.pipeline.name if lead.pipeline else None
        s_name = lead.stage.name if lead.stage else None
        s_type = lead.stage.stage_type if lead.stage else None

        assignee_name = None
        assignee_email = None
        if lead.assignee:
            assignee_name = (
                lead.assignee.display_name
                or lead.assignee.full_name
                or lead.assignee.username
            )
            assignee_email = lead.assignee.email

        company_city = (lead.company.town or lead.company.district or lead.company.area) if lead.company else None
        company_gstin = lead.company.tax_id_number if lead.company else None

        # Next pending follow-up summary
        next_fu_stmt = (
            select(CrmFollowUp, User)
            .outerjoin(User, CrmFollowUp.assigned_to == User.id)
            .where(
                CrmFollowUp.lead_id == lead.id,
                CrmFollowUp.status == "pending",
                CrmFollowUp.deleted_at.is_(None),
            )
            .order_by(CrmFollowUp.due_at.asc())
            .limit(1)
        )
        fu_row = (await self.session.execute(next_fu_stmt)).first()
        next_fu_summary: CrmFollowUpSummary | None = None
        if fu_row:
            fu, fu_user = fu_row
            fu_uname = (fu_user.display_name or fu_user.full_name or fu_user.username) if fu_user else None
            is_ov = fu.due_at < datetime.now(timezone.utc)
            next_fu_summary = CrmFollowUpSummary(
                id=fu.id,
                due_at=fu.due_at,
                follow_up_type=fu.follow_up_type,
                notes=fu.notes,
                assigned_to=fu.assigned_to,
                assignee_name=fu_uname,
                is_overdue=is_ov,
            )

        custom_fields = lead.custom_fields or {}
        is_unassigned = lead.assigned_to is None
        assignment_status = "unassigned" if is_unassigned else "assigned"
        unassigned_reason = custom_fields.get("unassigned_reason") if is_unassigned else None

        return CrmLeadListItem(
            id=lead.id,
            lead_code=lead.lead_code,
            name=lead.name,
            original_phone=lead.original_phone,
            normalized_phone=lead.normalized_phone,
            email=lead.email,
            company_name=lead.company_name,
            company_id=lead.company_id,
            company_city=company_city,
            company_gstin=company_gstin,
            next_pending_follow_up=next_fu_summary,
            campaign=lead.campaign,
            source_type=lead.source_type,
            source_detail=lead.source_detail,
            pipeline_id=lead.pipeline_id,
            pipeline_name=p_name,
            stage_id=lead.stage_id,
            stage_name=s_name,
            stage_type=s_type,
            created_by=lead.created_by,
            assigned_to=lead.assigned_to,
            assigned_salesperson_name=assignee_name,
            assigned_salesperson_email=assignee_email,
            status=lead.status,
            priority=lead.priority,
            assignment_status=assignment_status,
            unassigned_reason=unassigned_reason,
            last_contacted_at=lead.last_contacted_at,
            next_follow_up_at=lead.next_follow_up_at,
            won_at=lead.won_at,
            lost_at=lead.lost_at,
            lost_reason=lead.lost_reason,
            created_at=lead.created_at,
            updated_at=lead.updated_at,
            custom_fields=custom_fields,
        )

    async def create_lead(
        self,
        payload: CrmLeadCreate,
        *,
        actor: CurrentUser,
    ) -> CrmLeadListItem:
        """
        Manually create a new CRM lead with role-based scoping, phone normalization,
        duplicate protection, pipeline/stage resolution, and audit logging.
        """
        # 1. Normalize phone
        norm_phone, phone_err = normalize_phone_number(payload.phone)
        if phone_err or not norm_phone:
            raise BadRequestException(phone_err or "Invalid phone number format.")

        # 2. Duplicate protection against active CRM leads
        dup_stmt = (
            select(CrmLead)
            .where(
                CrmLead.normalized_phone == norm_phone,
                CrmLead.deleted_at.is_(None),
            )
        )
        existing_lead = (await self.session.execute(dup_stmt)).scalar_one_or_none()
        if existing_lead:
            role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
            is_in_scope = (
                role_type == "admin"
                or (scoped_user_ids is not None and (
                    existing_lead.assigned_to in scoped_user_ids
                    or existing_lead.created_by in scoped_user_ids
                ))
            )
            if is_in_scope:
                raise ConflictException(
                    f"A lead with phone '{norm_phone}' already exists (Lead Code: {existing_lead.lead_code}). "
                    "Duplicate lead creation prevented."
                )
            else:
                raise ConflictException(
                    f"A lead with phone '{norm_phone}' already exists in CRM. Duplicate lead creation prevented."
                )

        # 3. Pipeline and Stage resolution
        pipeline: CrmPipeline | None = None
        if payload.pipeline_id:
            pipe_stmt = (
                select(CrmPipeline)
                .options(selectinload(CrmPipeline.stages))
                .where(CrmPipeline.id == payload.pipeline_id, CrmPipeline.deleted_at.is_(None))
            )
            pipeline = (await self.session.execute(pipe_stmt)).scalar_one_or_none()
            if not pipeline or not pipeline.is_active:
                raise BadRequestException("Selected pipeline is invalid or inactive.")
        else:
            # Default or first active pipeline
            def_stmt = (
                select(CrmPipeline)
                .options(selectinload(CrmPipeline.stages))
                .where(CrmPipeline.is_default.is_(True), CrmPipeline.is_active.is_(True), CrmPipeline.deleted_at.is_(None))
                .order_by(CrmPipeline.created_at)
            )
            pipeline = (await self.session.execute(def_stmt)).scalars().first()
            if not pipeline:
                any_stmt = (
                    select(CrmPipeline)
                    .options(selectinload(CrmPipeline.stages))
                    .where(CrmPipeline.is_active.is_(True), CrmPipeline.deleted_at.is_(None))
                    .order_by(CrmPipeline.created_at)
                )
                pipeline = (await self.session.execute(any_stmt)).scalars().first()

        if not pipeline:
            raise BadRequestException("No active CRM pipeline configured. Please configure an active pipeline first.")

        # Resolve stage
        active_stages = sorted(
            [s for s in pipeline.stages if s.deleted_at is None and s.is_active],
            key=lambda x: x.stage_order,
        )
        if not active_stages:
            raise BadRequestException(f"Pipeline '{pipeline.name}' has no active stages configured.")

        stage: CrmPipelineStage | None = None
        if payload.stage_id:
            matched_stage = next((s for s in pipeline.stages if s.id == payload.stage_id), None)
            if not matched_stage or matched_stage.deleted_at is not None:
                raise BadRequestException(f"Selected stage does not belong to pipeline '{pipeline.name}'.")
            if not matched_stage.is_active:
                raise BadRequestException(f"Selected stage '{matched_stage.name}' is inactive.")
            stage = matched_stage
        else:
            # Look for initial stage of type open
            for s in active_stages:
                if s.is_initial and s.stage_type == "open":
                    stage = s
                    break
            if not stage:
                stage = active_stages[0]

        # 4. Role & Assignment Scope Enforcement
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        target_assigned_to: uuid.UUID | None = None
        assignment_method: str = "manual"

        if role_type == "salesperson":
            if payload.assigned_to and payload.assigned_to != actor.id:
                raise ForbiddenException("Salespeople can only assign leads to themselves.")
            target_assigned_to = actor.id
            assignment_method = "personal_lead"
        elif role_type == "manager":
            assert scoped_user_ids is not None
            if payload.assigned_to:
                if payload.assigned_to not in scoped_user_ids:
                    raise ForbiddenException("Selected salesperson is outside your authorized team scope.")
                target_assigned_to = payload.assigned_to
            else:
                target_assigned_to = None
            assignment_method = "manual"
        else:
            # Admin: unrestricted
            if payload.assigned_to:
                target_assigned_to = payload.assigned_to
            else:
                target_assigned_to = None
            assignment_method = "manual"

        # Verify assignee is active if specified
        assignee_user: User | None = None
        if target_assigned_to:
            u_stmt = select(User).where(User.id == target_assigned_to, User.deleted_at.is_(None))
            assignee_user = (await self.session.execute(u_stmt)).scalar_one_or_none()
            if not assignee_user or not assignee_user.is_active or not assignee_user.has_login:
                raise BadRequestException("Assigned user is not an active system user with login credentials.")

        # Priority handling (default 'medium' if omitted)
        clean_priority = (payload.priority or "medium").strip().lower()
        if clean_priority not in ("low", "medium", "high", "urgent"):
            clean_priority = "medium"

        # Determine initial lifecycle status and timestamps based on stage
        lead_status = "new"
        won_at = None
        lost_at = None
        if stage.stage_type == "won":
            lead_status = "won"
            won_at = _utcnow()
        elif stage.stage_type == "lost":
            lead_status = "lost"
            lost_at = _utcnow()

        custom_fields = dict(payload.custom_fields or {})
        if not target_assigned_to:
            custom_fields.setdefault("unassigned_reason", "manual_creation_unassigned")

        # 4b. Company resolution / matching in existing companies master
        comp_id, comp_name, _ = await resolve_or_create_company(
            self.session,
            company_id=payload.company_id,
            company_name=payload.company_name,
            contact_name=payload.name,
            contact_phone=norm_phone,
            actor_id=actor.id,
            auto_create=True,
        )

        # 5. Create CrmLead
        new_lead = CrmLead(
            name=payload.name.strip(),
            original_phone=payload.phone.strip(),
            normalized_phone=norm_phone,
            email=payload.email.strip().lower() if payload.email and payload.email.strip() else None,
            company_name=comp_name,
            company_id=comp_id,
            campaign=payload.campaign.strip() if payload.campaign and payload.campaign.strip() else None,
            source_type=payload.source_type or ("personal_lead" if role_type == "salesperson" else "manual_entry"),
            source_detail=payload.source_detail or "Manual Creation",
            created_by=actor.id,
            assigned_to=target_assigned_to,
            pipeline_id=pipeline.id,
            stage_id=stage.id,
            status=lead_status,
            won_at=won_at,
            lost_at=lost_at,
            priority=clean_priority,
            notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
            custom_fields=custom_fields,
        )
        self.session.add(new_lead)
        await self.session.flush()

        # 6. Record Activity touchpoint
        activity = CrmActivity(
            lead_id=new_lead.id,
            activity_type="lead_created",
            subject=f"Lead Created: {new_lead.name}",
            description=f"Lead manually created by {actor.username}",
            performed_by=actor.id,
        )
        self.session.add(activity)

        # 7. Record Assignment History if assigned
        if target_assigned_to:
            hist = CrmAssignmentHistory(
                lead_id=new_lead.id,
                previous_owner_id=None,
                new_owner_id=target_assigned_to,
                assignment_method=assignment_method,
                assigned_by=actor.id,
                reason="Initial assignment during manual lead creation",
            )
            self.session.add(hist)

        # 8. Record Initial Stage History
        stage_hist = CrmStageHistory(
            lead_id=new_lead.id,
            from_stage_id=None,
            to_stage_id=stage.id,
            changed_by=actor.id,
            reason="Initial stage during manual lead creation",
        )
        self.session.add(stage_hist)

        await self.session.commit()

        return await self.get_lead(lead_id=new_lead.id, actor=actor)

    async def update_lead(
        self,
        lead_id: uuid.UUID,
        payload: CrmLeadUpdate,
        *,
        actor: CurrentUser,
    ) -> CrmLeadListItem:
        """
        Update an existing lead's priority, notes, and profile fields with RBAC check.
        Preserves existing priority if omitted.
        """
        stmt = (
            select(CrmLead)
            .options(
                selectinload(CrmLead.pipeline),
                selectinload(CrmLead.stage),
                selectinload(CrmLead.assignee),
            )
            .where(CrmLead.id == lead_id, CrmLead.deleted_at.is_(None))
        )
        lead = (await self.session.execute(stmt)).scalar_one_or_none()
        if not lead:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        # Scope enforcement
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        if role_type == "manager":
            assert scoped_user_ids is not None
            is_scoped = (
                (lead.assigned_to is not None and lead.assigned_to in scoped_user_ids)
                or (lead.created_by is not None and lead.created_by in scoped_user_ids)
                or lead.assigned_to is None
            )
            if not is_scoped:
                raise ForbiddenException("You do not have permission to modify this lead.")
        elif role_type == "salesperson":
            is_scoped = lead.assigned_to == actor.id or lead.created_by == actor.id
            if not is_scoped:
                raise ForbiddenException("You do not have permission to modify this lead.")

        # Update provided fields & track material changes
        material_changes = []
        if payload.name is not None and payload.name.strip() and payload.name.strip() != lead.name:
            material_changes.append(f"Name changed from '{lead.name}' to '{payload.name.strip()}'")
            lead.name = payload.name.strip()
        if payload.email is not None:
            new_email = payload.email.strip().lower() if payload.email.strip() else None
            if new_email != lead.email:
                material_changes.append(f"Email changed to '{new_email or 'None'}'")
                lead.email = new_email
        if payload.campaign is not None:
            new_camp = payload.campaign.strip() if payload.campaign.strip() else None
            if new_camp != lead.campaign:
                material_changes.append(f"Campaign changed to '{new_camp or 'None'}'")
                lead.campaign = new_camp
        if payload.source_type is not None and payload.source_type != lead.source_type:
            material_changes.append(f"Source type changed to '{payload.source_type}'")
            lead.source_type = payload.source_type
        if payload.source_detail is not None and payload.source_detail != lead.source_detail:
            material_changes.append("Source detail updated")
            lead.source_detail = payload.source_detail
        if payload.notes is not None and payload.notes != lead.notes:
            material_changes.append("Notes updated")
            lead.notes = payload.notes
        if payload.custom_fields is not None:
            lead.custom_fields = payload.custom_fields
            flag_modified(lead, "custom_fields")

        if material_changes:
            activity = CrmActivity(
                lead_id=lead.id,
                activity_type="lead_updated",
                subject="Lead Details Updated",
                description="; ".join(material_changes) + f" by {actor.username}",
                performed_by=actor.id,
            )
            self.session.add(activity)

        # Company matching / update
        if payload.company_id is not None or payload.company_name is not None:
            old_comp_name = lead.company_name
            target_comp_name = payload.company_name if payload.company_name is not None else lead.company_name
            new_comp_id, new_comp_name, _ = await resolve_or_create_company(
                self.session,
                company_id=payload.company_id,
                company_name=target_comp_name,
                contact_name=payload.name or lead.name,
                contact_phone=lead.normalized_phone,
                actor_id=actor.id,
                auto_create=True,
            )
            if new_comp_id != lead.company_id or new_comp_name != lead.company_name:
                lead.company_id = new_comp_id
                lead.company_name = new_comp_name
                activity = CrmActivity(
                    lead_id=lead.id,
                    activity_type="company_changed",
                    subject=f"Company Changed: {old_comp_name or 'None'} -> {new_comp_name}",
                    description=f"Company updated from '{old_comp_name}' to '{new_comp_name}' by {actor.username}",
                    performed_by=actor.id,
                )
                self.session.add(activity)

        # Priority update (only if explicitly provided, else strictly preserved)
        if payload.priority is not None and payload.priority.strip():
            new_p = payload.priority.strip().lower()
            if new_p in ("low", "medium", "high", "urgent") and new_p != lead.priority:
                old_p = lead.priority
                lead.priority = new_p
                # Record priority change activity
                activity = CrmActivity(
                    lead_id=lead.id,
                    activity_type="lead_updated",
                    subject=f"Priority Changed: {old_p.capitalize()} -> {new_p.capitalize()}",
                    description=f"Priority updated from '{old_p}' to '{new_p}' by {actor.username}",
                    performed_by=actor.id,
                )
                self.session.add(activity)

        lead.updated_at = _utcnow()
        await self.session.commit()

        return await self.get_lead(lead_id=lead.id, actor=actor)

    async def list_assignment_history(
        self,
        *,
        actor: CurrentUser,
        lead_id: uuid.UUID | None = None,
        salesperson_id: uuid.UUID | None = None,
        batch_id: uuid.UUID | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> CrmAssignmentHistoryPaginationResponse:
        """
        List persisted assignment audit log records with scoping.
        """
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)

        conditions = []

        # Scope enforcement
        if role_type == "manager":
            assert scoped_user_ids is not None
            if salesperson_id is not None and salesperson_id not in scoped_user_ids:
                return CrmAssignmentHistoryPaginationResponse(
                    items=[],
                    total=0,
                    page=page,
                    page_size=page_size,
                    total_pages=0,
                )
            conditions.append(
                or_(
                    CrmAssignmentHistory.new_owner_id.in_(scoped_user_ids),
                    CrmAssignmentHistory.previous_owner_id.in_(scoped_user_ids),
                    CrmAssignmentHistory.assigned_by.in_(scoped_user_ids),
                    CrmAssignmentHistory.new_owner_id.is_(None),
                )
            )
        elif role_type == "salesperson":
            if salesperson_id is not None and salesperson_id != actor.id:
                return CrmAssignmentHistoryPaginationResponse(
                    items=[],
                    total=0,
                    page=page,
                    page_size=page_size,
                    total_pages=0,
                )
            conditions.append(
                or_(
                    CrmAssignmentHistory.new_owner_id == actor.id,
                    CrmAssignmentHistory.previous_owner_id == actor.id,
                    CrmAssignmentHistory.assigned_by == actor.id,
                )
            )

        if lead_id is not None:
            # If lead_id provided, ensure actor is authorized to see that lead
            lead = await self.session.get(CrmLead, lead_id)
            if not lead or lead.deleted_at is not None:
                raise NotFoundException(f"Lead {lead_id} not found.")
            await self._check_lead_scope(lead, actor, action="view")
            conditions.append(CrmAssignmentHistory.lead_id == lead_id)

        if salesperson_id is not None:
            conditions.append(
                or_(
                    CrmAssignmentHistory.new_owner_id == salesperson_id,
                    CrmAssignmentHistory.previous_owner_id == salesperson_id,
                )
            )

        if batch_id is not None:
            conditions.append(CrmAssignmentHistory.batch_id == batch_id)

        # Total count
        count_stmt = select(func.count(CrmAssignmentHistory.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        total_count = (await self.session.execute(count_stmt)).scalar() or 0

        # Query records
        limit = min(max(page_size, 1), 100)
        offset = (max(page, 1) - 1) * limit

        stmt = (
            select(CrmAssignmentHistory, CrmImportBatch.batch_name)
            .outerjoin(CrmImportBatch, CrmAssignmentHistory.batch_id == CrmImportBatch.id)
            .options(
                selectinload(CrmAssignmentHistory.lead),
                selectinload(CrmAssignmentHistory.previous_owner),
                selectinload(CrmAssignmentHistory.new_owner),
                selectinload(CrmAssignmentHistory.assigner),
            )
            .order_by(desc(CrmAssignmentHistory.created_at))
            .offset(offset)
            .limit(limit)
        )
        if conditions:
            stmt = stmt.where(and_(*conditions))

        results = (await self.session.execute(stmt)).all()

        items: list[CrmAssignmentHistoryItem] = []
        for hist, b_name in results:
            lead_code = hist.lead.lead_code if hist.lead else None
            lead_name = hist.lead.name if hist.lead else None

            prev_name = None
            if hist.previous_owner:
                prev_name = (
                    hist.previous_owner.display_name
                    or hist.previous_owner.full_name
                    or hist.previous_owner.username
                )

            new_name = None
            if hist.new_owner:
                new_name = (
                    hist.new_owner.display_name
                    or hist.new_owner.full_name
                    or hist.new_owner.username
                )

            assigner_name = None
            if hist.assigner:
                assigner_name = (
                    hist.assigner.display_name
                    or hist.assigner.full_name
                    or hist.assigner.username
                )

            items.append(
                CrmAssignmentHistoryItem(
                    id=hist.id,
                    lead_id=hist.lead_id,
                    lead_code=lead_code,
                    lead_name=lead_name,
                    previous_owner_id=hist.previous_owner_id,
                    previous_owner_name=prev_name,
                    new_owner_id=hist.new_owner_id,
                    new_owner_name=new_name,
                    assignment_method=hist.assignment_method,
                    assigned_by=hist.assigned_by,
                    assigned_by_name=assigner_name,
                    reason=hist.reason,
                    batch_id=hist.batch_id,
                    batch_name=b_name,
                    created_at=hist.created_at,
                )
            )

        total_pages = math.ceil(total_count / limit) if total_count > 0 else 0

        return CrmAssignmentHistoryPaginationResponse(
            items=items,
            total=total_count,
            page=page,
            page_size=limit,
            total_pages=total_pages,
        )

    async def reassign_lead(
        self,
        lead_id: uuid.UUID,
        *,
        new_salesperson_id: uuid.UUID,
        reason: str,
        actor: CurrentUser,
    ) -> CrmLeadListItem:
        """
        Manually reassign one CRM lead to a selected eligible salesperson.
        Enforces admin/manager scope, mandatory reason (min 5 chars), salesperson eligibility & capacity.
        Locks lead and salesperson records with SELECT ... FOR UPDATE to avoid concurrency races.
        """
        # 1. Validate reason
        clean_reason = reason.strip() if reason else ""
        if len(clean_reason) < 5:
            raise BadRequestException("Reassignment reason is mandatory and must be at least 5 characters.")

        # 2. Scope & role authorization
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        if role_type == "salesperson":
            raise ForbiddenException("Salespersons are not authorized to reassign leads.")

        # 3. Lock lead row
        lead_stmt = (
            select(CrmLead)
            .where(CrmLead.id == lead_id, CrmLead.deleted_at.is_(None))
            .with_for_update()
        )
        lead = (await self.session.execute(lead_stmt)).scalar_one_or_none()
        if not lead:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        # If manager, enforce that lead is within their departmental scope
        if role_type == "manager":
            assert scoped_user_ids is not None
            is_lead_in_scope = (
                (lead.assigned_to is not None and lead.assigned_to in scoped_user_ids)
                or (lead.created_by is not None and lead.created_by in scoped_user_ids)
                or lead.assigned_to is None
            )
            if not is_lead_in_scope:
                raise ForbiddenException("You do not have permission to reassign leads outside your department.")

            # Target salesperson must also be in manager's scope
            if new_salesperson_id not in scoped_user_ids:
                raise ForbiddenException("Cannot reassign lead to a salesperson outside your department.")

        # Cannot reassign to the same salesperson
        if lead.assigned_to == new_salesperson_id:
            raise BadRequestException("Lead is already assigned to this salesperson.")

        # 4. Lock & validate target salesperson
        sp_stmt = (
            select(User, CrmSalespersonConfig)
            .join(CrmSalespersonConfig, CrmSalespersonConfig.user_id == User.id)
            .where(User.id == new_salesperson_id)
            .with_for_update()
        )
        sp_row = (await self.session.execute(sp_stmt)).first()
        if not sp_row:
            u_check = (await self.session.execute(select(User).where(User.id == new_salesperson_id))).scalar_one_or_none()
            if not u_check:
                raise NotFoundException("Target salesperson not found.")
            raise BadRequestException("Target user is not configured as a CRM salesperson.")

        target_user, target_cfg = sp_row

        # Check account status
        if (
            target_user.deleted_at is not None
            or not target_user.is_active
            or not target_user.has_login
            or target_user.status != UserStatus.ACTIVE
        ):
            raise BadRequestException("Target salesperson account is inactive, disabled, or lacks login credentials.")

        # Check CRM eligibility
        if not target_cfg.is_active or not target_cfg.is_eligible:
            raise BadRequestException("Target salesperson is not marked active and eligible for lead assignment.")

        # Check capacity under lock
        active_counts_stmt = (
            select(func.count(CrmLead.id))
            .where(
                CrmLead.assigned_to == new_salesperson_id,
                CrmLead.deleted_at.is_(None),
                CrmLead.status.notin_(["won", "lost"]),
            )
        )
        current_active = (await self.session.execute(active_counts_stmt)).scalar() or 0
        if target_cfg.max_lead_capacity is not None and current_active >= target_cfg.max_lead_capacity:
            raise BadRequestException(
                f"Target salesperson has reached maximum lead capacity ({current_active}/{target_cfg.max_lead_capacity})."
            )

        # 5. Atomically update ownership & append history
        previous_owner_id = lead.assigned_to
        lead.assigned_to = new_salesperson_id

        cf = dict(lead.custom_fields or {})
        cf["assignment_status"] = "assigned"
        cf.pop("unassigned_reason", None)
        lead.custom_fields = cf
        flag_modified(lead, "custom_fields")

        history = CrmAssignmentHistory(
            lead_id=lead.id,
            previous_owner_id=previous_owner_id,
            new_owner_id=new_salesperson_id,
            assignment_method="manual",
            assigned_by=actor.id,
            reason=clean_reason,
            batch_id=None,
            created_at=_utcnow(),
        )
        self.session.add(history)

        activity = CrmActivity(
            lead_id=lead.id,
            activity_type="note",
            subject="Lead Reassigned",
            description=f"Reassigned to {target_user.display_name or target_user.full_name or target_user.username}. Reason: {clean_reason}",
            performed_by=actor.id,
        )
        self.session.add(activity)

        await self.session.commit()

        # Return updated lead representation
        return await self.get_lead(lead_id=lead.id, actor=actor)

    # -------------------------------------------------------------------------
    # Phase 6: Lifecycle, Follow-Up, Stage Transition & Timeline Implementations
    # -------------------------------------------------------------------------

    async def _check_lead_scope(
        self, lead: CrmLead, actor: CurrentUser, action: str = "view"
    ) -> None:
        """Verify actor has authority to view or mutate this lead."""
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        if role_type == "admin":
            return
        if role_type == "manager":
            assert scoped_user_ids is not None
            is_scoped = (
                (lead.assigned_to is not None and lead.assigned_to in scoped_user_ids)
                or (lead.created_by is not None and lead.created_by in scoped_user_ids)
                or (action == "view" and lead.assigned_to is None)
            )
            if not is_scoped:
                raise ForbiddenException(f"You do not have permission to {action} this lead.")
        elif role_type == "salesperson":
            is_scoped = (lead.assigned_to == actor.id) or (lead.created_by == actor.id)
            if not is_scoped:
                raise ForbiddenException(f"You do not have permission to {action} this lead.")

    async def _recalculate_next_follow_up(self, lead: CrmLead) -> None:
        """Denormalize earliest remaining pending follow_up.due_at onto lead."""
        await self.session.flush()
        next_due_stmt = (
            select(func.min(CrmFollowUp.due_at))
            .where(
                CrmFollowUp.lead_id == lead.id,
                CrmFollowUp.status == "pending",
                CrmFollowUp.deleted_at.is_(None),
            )
        )
        earliest_due = (await self.session.execute(next_due_stmt)).scalar()
        lead.next_follow_up_at = earliest_due


    async def create_activity(
        self,
        lead_id: uuid.UUID,
        data: CrmActivityCreate,
        actor: CurrentUser,
    ) -> CrmActivityRead:
        """Log an activity/touchpoint on a lead with last_contacted_at update."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self._check_lead_scope(lead, actor, action="mutate")

        activity_time = data.activity_at or _utcnow()
        if activity_time.tzinfo is None:
            activity_time = activity_time.replace(tzinfo=timezone.utc)

        activity = CrmActivity(
            lead_id=lead.id,
            activity_type=data.activity_type,
            subject=data.subject.strip() if data.subject else None,
            description=data.description.strip() if data.description else None,
            outcome=data.outcome.strip() if data.outcome else None,
            performed_by=actor.id,
            activity_at=activity_time,
            created_at=_utcnow(),
        )
        self.session.add(activity)

        contact_types = {"call", "meeting", "whatsapp", "email", "demo"}
        if data.activity_type.lower() in contact_types:
            lead.last_contacted_at = activity_time
            if lead.status == "new":
                lead.status = "contacted"

        lead.updated_at = _utcnow()
        await self.session.commit()
        await self.session.refresh(activity)

        actor_user = await self.session.get(User, actor.id)
        performer_name = (actor_user.display_name or actor_user.full_name or actor.username) if actor_user else actor.username
        performer_email = actor_user.email if actor_user else None

        return CrmActivityRead(
            id=activity.id,
            lead_id=activity.lead_id,
            activity_type=activity.activity_type,
            subject=activity.subject,
            description=activity.description,
            outcome=activity.outcome,
            performed_by=activity.performed_by,
            performer_name=performer_name,
            performer_email=performer_email,
            activity_at=activity.activity_at,
            created_at=activity.created_at,
            is_system_event=_is_system_activity(activity.activity_type, activity.subject),
        )

    async def list_activities(
        self,
        lead_id: uuid.UUID,
        actor: CurrentUser,
        page: int = 1,
        page_size: int = 50,
    ) -> CrmActivityPaginationResponse:
        """List activities for a lead in reverse chronological order."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self._check_lead_scope(lead, actor, action="view")

        count_stmt = select(func.count(CrmActivity.id)).where(CrmActivity.lead_id == lead_id)
        total = (await self.session.execute(count_stmt)).scalar() or 0

        total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 1
        offset = (page - 1) * page_size

        stmt = (
            select(CrmActivity, User)
            .outerjoin(User, CrmActivity.performed_by == User.id)
            .where(CrmActivity.lead_id == lead_id)
            .order_by(desc(CrmActivity.activity_at))
            .offset(offset)
            .limit(page_size)
        )
        rows = (await self.session.execute(stmt)).all()

        items: list[CrmActivityRead] = []
        for act, performer in rows:
            p_name = (performer.display_name or performer.full_name or performer.username) if performer else None
            p_email = performer.email if performer else None
            items.append(
                CrmActivityRead(
                    id=act.id,
                    lead_id=act.lead_id,
                    activity_type=act.activity_type,
                    subject=act.subject,
                    description=act.description,
                    outcome=act.outcome,
                    performed_by=act.performed_by,
                    performer_name=p_name,
                    performer_email=p_email,
                    activity_at=act.activity_at,
                    created_at=act.created_at,
                    is_system_event=_is_system_activity(act.activity_type, act.subject),
                )
            )

        return CrmActivityPaginationResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    async def create_follow_up(
        self,
        lead_id: uuid.UUID,
        data: CrmFollowUpCreate,
        actor: CurrentUser,
    ) -> CrmFollowUpRead:
        """Schedule a follow-up commitment and recalculate lead.next_follow_up_at."""
        stmt = (
            select(CrmLead)
            .options(
                selectinload(CrmLead.stage),
                selectinload(CrmLead.pipeline),
            )
            .where(CrmLead.id == lead_id, CrmLead.deleted_at.is_(None))
        )
        lead = (await self.session.execute(stmt)).scalar_one_or_none()
        if not lead:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self._check_lead_scope(lead, actor, action="mutate")

        target_assignee_id = data.assigned_to or lead.assigned_to or actor.id

        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        if role_type == "salesperson":
            if target_assignee_id != actor.id:
                raise ForbiddenException("Salespeople can only assign follow-ups to themselves.")
        elif role_type == "manager":
            assert scoped_user_ids is not None
            if target_assignee_id not in scoped_user_ids:
                raise ForbiddenException("Managers can only assign follow-ups within their departmental scope.")

        assignee = await self.session.get(User, target_assignee_id)
        if not assignee or assignee.deleted_at is not None or not assignee.is_active:
            raise BadRequestException("Target assignee is not an active ERP user.")

        due_time = data.due_at
        if due_time.tzinfo is None:
            due_time = due_time.replace(tzinfo=timezone.utc)

        follow_up = CrmFollowUp(
            lead_id=lead.id,
            assigned_to=target_assignee_id,
            due_at=due_time,
            follow_up_type=data.follow_up_type,
            notes=data.notes.strip() if data.notes else None,
            status="pending",
            created_by=actor.id,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        self.session.add(follow_up)
        await self.session.flush()

        # Synchronize corresponding Workforce & Agile Task
        await sync_follow_up_to_task(self.session, follow_up, lead, actor.id)

        # Record activity for scheduled follow-up
        sched_act = CrmActivity(
            lead_id=lead.id,
            activity_type="follow_up_created",
            subject=f"Follow-up Scheduled: {follow_up.follow_up_type.capitalize()}",
            description=f"Scheduled for {follow_up.due_at.strftime('%Y-%m-%d %H:%M UTC')}. Notes: {follow_up.notes or 'None'}",
            performed_by=actor.id,
            activity_at=_utcnow(),
            created_at=_utcnow(),
        )
        self.session.add(sched_act)

        await self._recalculate_next_follow_up(lead)
        lead.updated_at = _utcnow()

        await self.session.commit()
        await self.session.refresh(follow_up)

        now_utc = datetime.now(timezone.utc)
        is_overdue = follow_up.status == "pending" and follow_up.due_at < now_utc

        return CrmFollowUpRead(
            id=follow_up.id,
            lead_id=lead.id,
            lead_code=lead.lead_code,
            lead_name=lead.name,
            lead_phone=lead.normalized_phone or lead.original_phone,
            lead_company=lead.company_name,
            lead_priority=lead.priority,
            lead_stage_name=lead.stage.name if lead.stage else None,
            lead_pipeline_name=lead.pipeline.name if lead.pipeline else None,
            assigned_to=follow_up.assigned_to,
            assignee_name=assignee.display_name or assignee.full_name or assignee.username,
            assignee_email=assignee.email,
            due_at=follow_up.due_at,
            follow_up_type=follow_up.follow_up_type,
            notes=follow_up.notes,
            status=follow_up.status,
            completed_at=follow_up.completed_at,
            created_by=follow_up.created_by,
            creator_name=actor.username,
            task_id=follow_up.task_id,
            created_at=follow_up.created_at,
            updated_at=follow_up.updated_at,
            is_overdue=is_overdue,
        )

    async def update_follow_up_status(
        self,
        follow_up_id: uuid.UUID,
        data: CrmFollowUpStatusUpdate,
        actor: CurrentUser,
    ) -> CrmFollowUpRead:
        """Complete or cancel a scheduled follow-up, logging activity and recalculating next_follow_up_at."""
        stmt = (
            select(CrmFollowUp)
            .options(
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.stage),
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.pipeline),
                selectinload(CrmFollowUp.assignee),
                selectinload(CrmFollowUp.creator),
            )
            .where(CrmFollowUp.id == follow_up_id, CrmFollowUp.deleted_at.is_(None))
        )
        follow_up = (await self.session.execute(stmt)).scalar_one_or_none()
        if not follow_up:
            raise NotFoundException(f"Follow-up with id {follow_up_id} not found.")

        lead = follow_up.lead
        if not lead or lead.deleted_at is not None:
            raise NotFoundException("Associated lead not found.")

        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        if role_type == "salesperson":
            if follow_up.assigned_to != actor.id and lead.assigned_to != actor.id and follow_up.created_by != actor.id:
                raise ForbiddenException("You cannot mutate follow-ups assigned to other salespeople.")
        elif role_type == "manager":
            assert scoped_user_ids is not None
            is_in_scope = (
                (follow_up.assigned_to is not None and follow_up.assigned_to in scoped_user_ids)
                or (lead.assigned_to is not None and lead.assigned_to in scoped_user_ids)
                or (follow_up.created_by is not None and follow_up.created_by in scoped_user_ids)
            )
            if not is_in_scope:
                raise ForbiddenException("Follow-up is outside your departmental scope.")

        new_status = data.status.lower()
        follow_up.status = new_status
        now_dt = _utcnow()
        follow_up.updated_at = now_dt

        if new_status == "completed":
            follow_up.completed_at = now_dt

            c_notes = (data.completion_notes or "").strip()
            orig_notes = (follow_up.notes or "").strip()
            full_desc = c_notes if c_notes else orig_notes or "Follow-up marked completed."
            if c_notes and orig_notes:
                full_desc = f"{c_notes} (Scheduled context: {orig_notes})"

            activity = CrmActivity(
                lead_id=lead.id,
                activity_type="follow_up_completed",
                subject=f"Follow-up Completed: {follow_up.follow_up_type.capitalize()}",
                description=full_desc,
                outcome=data.outcome.strip() if data.outcome else "completed",
                performed_by=actor.id,
                activity_at=now_dt,
                created_at=now_dt,
            )
            self.session.add(activity)

            # Update linked Workforce Task to DONE
            await complete_follow_up_task(
                self.session,
                follow_up,
                actor.id,
                actor.username,
                completion_notes=data.completion_notes,
                outcome=data.outcome,
            )

            if follow_up.follow_up_type in {"call", "meeting", "whatsapp", "email", "demo"}:
                lead.last_contacted_at = now_dt
                if lead.status == "new":
                    lead.status = "contacted"
        elif new_status == "cancelled":
            follow_up.completed_at = None
            activity = CrmActivity(
                lead_id=lead.id,
                activity_type="follow_up_cancelled",
                subject=f"Follow-up Cancelled: {follow_up.follow_up_type.capitalize()}",
                description=f"Scheduled follow-up was cancelled by {actor.username}",
                performed_by=actor.id,
                activity_at=now_dt,
                created_at=now_dt,
            )
            self.session.add(activity)

            # Cancel linked Workforce Task (soft-delete / on hold)
            await cancel_follow_up_task(
                self.session,
                follow_up,
                actor.id,
                actor.username,
            )

        await self._recalculate_next_follow_up(lead)
        lead.updated_at = now_dt

        await self.session.commit()
        await self.session.refresh(follow_up)

        assignee = follow_up.assignee
        assignee_name = (assignee.display_name or assignee.full_name or assignee.username) if assignee else None
        assignee_email = assignee.email if assignee else None

        creator = follow_up.creator
        creator_name = (creator.display_name or creator.full_name or creator.username) if creator else None

        is_overdue = follow_up.status == "pending" and follow_up.due_at < datetime.now(timezone.utc)

        return CrmFollowUpRead(
            id=follow_up.id,
            lead_id=lead.id,
            lead_code=lead.lead_code,
            lead_name=lead.name,
            lead_phone=lead.normalized_phone or lead.original_phone,
            lead_company=lead.company_name,
            lead_priority=lead.priority,
            lead_stage_name=lead.stage.name if lead.stage else None,
            lead_pipeline_name=lead.pipeline.name if lead.pipeline else None,
            assigned_to=follow_up.assigned_to,
            assignee_name=assignee_name,
            assignee_email=assignee_email,
            due_at=follow_up.due_at,
            follow_up_type=follow_up.follow_up_type,
            notes=follow_up.notes,
            status=follow_up.status,
            completed_at=follow_up.completed_at,
            created_by=follow_up.created_by,
            creator_name=creator_name,
            task_id=follow_up.task_id,
            created_at=follow_up.created_at,
            updated_at=follow_up.updated_at,
            is_overdue=is_overdue,
        )

    async def update_follow_up(
        self,
        follow_up_id: uuid.UUID,
        data: CrmFollowUpUpdate,
        actor: CurrentUser,
    ) -> CrmFollowUpRead:
        """Update scheduled follow-up details (due_at, notes, type, assigned_to) and synchronize linked task."""
        stmt = (
            select(CrmFollowUp)
            .options(
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.stage),
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.pipeline),
                selectinload(CrmFollowUp.assignee),
                selectinload(CrmFollowUp.creator),
            )
            .where(CrmFollowUp.id == follow_up_id, CrmFollowUp.deleted_at.is_(None))
        )
        follow_up = (await self.session.execute(stmt)).scalar_one_or_none()
        if not follow_up:
            raise NotFoundException(f"Follow-up with id {follow_up_id} not found.")

        lead = follow_up.lead
        if not lead or lead.deleted_at is not None:
            raise NotFoundException("Associated lead not found.")

        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)
        if role_type == "salesperson":
            if follow_up.assigned_to != actor.id and lead.assigned_to != actor.id and follow_up.created_by != actor.id:
                raise ForbiddenException("You cannot mutate follow-ups assigned to other salespeople.")
            if data.assigned_to and data.assigned_to != actor.id:
                raise ForbiddenException("Salespeople can only assign follow-ups to themselves.")
        elif role_type == "manager":
            assert scoped_user_ids is not None
            is_in_scope = (
                (follow_up.assigned_to is not None and follow_up.assigned_to in scoped_user_ids)
                or (lead.assigned_to is not None and lead.assigned_to in scoped_user_ids)
                or (follow_up.created_by is not None and follow_up.created_by in scoped_user_ids)
            )
            if not is_in_scope:
                raise ForbiddenException("Follow-up is outside your departmental scope.")
            if data.assigned_to and data.assigned_to not in scoped_user_ids:
                raise ForbiddenException("Managers can only assign follow-ups within their departmental scope.")

        if data.assigned_to is not None:
            assignee = await self.session.get(User, data.assigned_to)
            if not assignee or assignee.deleted_at is not None or not assignee.is_active:
                raise BadRequestException("Target assignee is not an active ERP user.")
            follow_up.assigned_to = data.assigned_to

        if data.due_at is not None:
            due_time = data.due_at
            if due_time.tzinfo is None:
                due_time = due_time.replace(tzinfo=timezone.utc)
            follow_up.due_at = due_time

        if data.follow_up_type is not None:
            follow_up.follow_up_type = data.follow_up_type

        if data.notes is not None:
            follow_up.notes = data.notes.strip() if data.notes else None

        now_dt = _utcnow()
        follow_up.updated_at = now_dt

        # Synchronize updates to linked task
        await sync_follow_up_to_task(self.session, follow_up, lead, actor.id)

        await self._recalculate_next_follow_up(lead)
        lead.updated_at = now_dt

        await self.session.commit()
        await self.session.refresh(follow_up)

        assignee = follow_up.assignee
        assignee_name = (assignee.display_name or assignee.full_name or assignee.username) if assignee else None
        assignee_email = assignee.email if assignee else None

        creator = follow_up.creator
        creator_name = (creator.display_name or creator.full_name or creator.username) if creator else None

        is_overdue = follow_up.status == "pending" and follow_up.due_at < datetime.now(timezone.utc)

        return CrmFollowUpRead(
            id=follow_up.id,
            lead_id=lead.id,
            lead_code=lead.lead_code,
            lead_name=lead.name,
            lead_phone=lead.normalized_phone or lead.original_phone,
            lead_company=lead.company_name,
            lead_priority=lead.priority,
            lead_stage_name=lead.stage.name if lead.stage else None,
            lead_pipeline_name=lead.pipeline.name if lead.pipeline else None,
            assigned_to=follow_up.assigned_to,
            assignee_name=assignee_name,
            assignee_email=assignee_email,
            due_at=follow_up.due_at,
            follow_up_type=follow_up.follow_up_type,
            notes=follow_up.notes,
            status=follow_up.status,
            completed_at=follow_up.completed_at,
            created_by=follow_up.created_by,
            creator_name=creator_name,
            task_id=follow_up.task_id,
            created_at=follow_up.created_at,
            updated_at=follow_up.updated_at,
            is_overdue=is_overdue,
        )

    async def sync_missing_follow_up_task(
        self,
        follow_up_id: uuid.UUID,
        actor: CurrentUser,
    ) -> CrmFollowUpRead:
        """Retry or manually synchronize a follow-up to its workforce task without duplicate creation."""
        stmt = (
            select(CrmFollowUp)
            .options(
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.stage),
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.pipeline),
                selectinload(CrmFollowUp.assignee),
                selectinload(CrmFollowUp.creator),
            )
            .where(CrmFollowUp.id == follow_up_id, CrmFollowUp.deleted_at.is_(None))
        )
        follow_up = (await self.session.execute(stmt)).scalar_one_or_none()
        if not follow_up:
            raise NotFoundException(f"Follow-up with id {follow_up_id} not found.")

        lead = follow_up.lead
        if not lead or lead.deleted_at is not None:
            raise NotFoundException("Associated lead not found.")

        await self._check_lead_scope(lead, actor, action="mutate")

        await sync_follow_up_to_task(self.session, follow_up, lead, actor.id)
        if follow_up.status == "completed":
            await complete_follow_up_task(self.session, follow_up, actor.id, actor.username)
        elif follow_up.status == "cancelled":
            await cancel_follow_up_task(self.session, follow_up, actor.id, actor.username)

        await self.session.commit()
        await self.session.refresh(follow_up)

        assignee = follow_up.assignee
        assignee_name = (assignee.display_name or assignee.full_name or assignee.username) if assignee else None
        assignee_email = assignee.email if assignee else None

        creator = follow_up.creator
        creator_name = (creator.display_name or creator.full_name or creator.username) if creator else None

        is_overdue = follow_up.status == "pending" and follow_up.due_at < datetime.now(timezone.utc)

        return CrmFollowUpRead(
            id=follow_up.id,
            lead_id=lead.id,
            lead_code=lead.lead_code,
            lead_name=lead.name,
            lead_phone=lead.normalized_phone or lead.original_phone,
            lead_company=lead.company_name,
            lead_priority=lead.priority,
            lead_stage_name=lead.stage.name if lead.stage else None,
            lead_pipeline_name=lead.pipeline.name if lead.pipeline else None,
            assigned_to=follow_up.assigned_to,
            assignee_name=assignee_name,
            assignee_email=assignee_email,
            due_at=follow_up.due_at,
            follow_up_type=follow_up.follow_up_type,
            notes=follow_up.notes,
            status=follow_up.status,
            completed_at=follow_up.completed_at,
            created_by=follow_up.created_by,
            creator_name=creator_name,
            task_id=follow_up.task_id,
            created_at=follow_up.created_at,
            updated_at=follow_up.updated_at,
            is_overdue=is_overdue,
        )

    async def list_follow_ups(
        self,
        actor: CurrentUser,
        lead_id: uuid.UUID | None = None,
        assigned_to: uuid.UUID | None = None,
        status: str | None = "pending",
        due_filter: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> CrmFollowUpPaginationResponse:
        """Query and paginate follow-ups with RBAC scoping and business-local date boundary filtering."""
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)

        stmt = (
            select(CrmFollowUp)
            .join(CrmLead, CrmFollowUp.lead_id == CrmLead.id)
            .outerjoin(User, CrmFollowUp.assigned_to == User.id)
            .options(
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.stage),
                selectinload(CrmFollowUp.lead).selectinload(CrmLead.pipeline),
                selectinload(CrmFollowUp.assignee),
                selectinload(CrmFollowUp.creator),
            )
            .where(CrmFollowUp.deleted_at.is_(None), CrmLead.deleted_at.is_(None))
        )

        if role_type == "salesperson":
            if assigned_to and assigned_to != actor.id:
                raise ForbiddenException("Salespeople can only query their own follow-ups.")
            stmt = stmt.where(or_(CrmFollowUp.assigned_to == actor.id, CrmFollowUp.created_by == actor.id))
        elif role_type == "manager":
            assert scoped_user_ids is not None
            if assigned_to:
                if assigned_to not in scoped_user_ids:
                    raise ForbiddenException("Requested salesperson is outside your departmental scope.")
                stmt = stmt.where(CrmFollowUp.assigned_to == assigned_to)
            else:
                stmt = stmt.where(
                    or_(
                        CrmFollowUp.assigned_to.in_(list(scoped_user_ids)),
                        CrmFollowUp.created_by.in_(list(scoped_user_ids)),
                        CrmLead.assigned_to.in_(list(scoped_user_ids)),
                    )
                )
        elif role_type == "admin":
            if assigned_to:
                stmt = stmt.where(CrmFollowUp.assigned_to == assigned_to)

        if lead_id:
            lead = await self.session.get(CrmLead, lead_id)
            if not lead or lead.deleted_at is not None:
                raise NotFoundException(f"Lead with id {lead_id} not found.")
            await self._check_lead_scope(lead, actor, action="view")
            stmt = stmt.where(CrmFollowUp.lead_id == lead_id)

        if status and status.lower() != "all":
            stmt = stmt.where(CrmFollowUp.status == status.lower())

        now_utc = datetime.now(timezone.utc)
        local_now = now_utc.astimezone(BUSINESS_TZ)
        local_today = local_now.date()
        local_today_start = datetime(
            local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)
        local_today_end = datetime(
            local_today.year, local_today.month, local_today.day, 23, 59, 59, 999999, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)

        if due_filter:
            df = due_filter.lower()
            if df == "overdue":
                stmt = stmt.where(CrmFollowUp.due_at < local_today_start, CrmFollowUp.status == "pending")
            elif df == "today":
                stmt = stmt.where(CrmFollowUp.due_at >= local_today_start, CrmFollowUp.due_at <= local_today_end)
            elif df == "upcoming":
                stmt = stmt.where(CrmFollowUp.due_at > local_today_end)
            elif df == "past_due":
                stmt = stmt.where(CrmFollowUp.due_at < now_utc, CrmFollowUp.status == "pending")

        if search:
            term = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(CrmLead.name).like(term),
                    func.lower(CrmLead.lead_code).like(term),
                    func.lower(CrmLead.normalized_phone).like(term),
                    func.lower(CrmFollowUp.notes).like(term),
                )
            )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self.session.execute(count_stmt)).scalar() or 0

        total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 1
        offset = (page - 1) * page_size

        stmt = stmt.order_by(CrmFollowUp.due_at.asc()).offset(offset).limit(page_size)
        rows = (await self.session.execute(stmt)).scalars().all()

        items: list[CrmFollowUpRead] = []
        for f in rows:
            l = f.lead
            assignee = f.assignee
            assignee_name = (assignee.display_name or assignee.full_name or assignee.username) if assignee else None
            assignee_email = assignee.email if assignee else None
            creator = f.creator
            creator_name = (creator.display_name or creator.full_name or creator.username) if creator else None

            is_overdue = f.status == "pending" and f.due_at < local_today_start

            items.append(
                CrmFollowUpRead(
                    id=f.id,
                    lead_id=f.lead_id,
                    lead_code=l.lead_code if l else None,
                    lead_name=l.name if l else None,
                    lead_phone=(l.normalized_phone or l.original_phone) if l else None,
                    lead_company=l.company_name if l else None,
                    lead_priority=l.priority if l else None,
                    lead_stage_name=l.stage.name if (l and l.stage) else None,
                    lead_pipeline_name=l.pipeline.name if (l and l.pipeline) else None,
                    assigned_to=f.assigned_to,
                    assignee_name=assignee_name,
                    assignee_email=assignee_email,
                    due_at=f.due_at,
                    follow_up_type=f.follow_up_type,
                    notes=f.notes,
                    status=f.status,
                    completed_at=f.completed_at,
                    created_by=f.created_by,
                    creator_name=creator_name,
                    task_id=f.task_id,
                    created_at=f.created_at,
                    updated_at=f.updated_at,
                    is_overdue=is_overdue,
                )
            )

        return CrmFollowUpPaginationResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    async def transition_lead_stage(
        self,
        lead_id: uuid.UUID,
        data: CrmLeadStageTransitionRequest,
        actor: CurrentUser,
    ) -> CrmLeadListItem:
        """Move a lead to a new valid stage in its pipeline, enforcing won/lost lifecycle rules."""
        stmt = (
            select(CrmLead)
            .options(
                selectinload(CrmLead.pipeline),
                selectinload(CrmLead.stage),
                selectinload(CrmLead.assignee),
            )
            .where(CrmLead.id == lead_id, CrmLead.deleted_at.is_(None))
            .with_for_update()
        )
        lead = (await self.session.execute(stmt)).scalar_one_or_none()
        if not lead:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self._check_lead_scope(lead, actor, action="mutate")

        target_stage = await self.session.get(CrmPipelineStage, data.stage_id)
        if not target_stage or target_stage.deleted_at is not None:
            raise NotFoundException(f"Target stage {data.stage_id} not found.")
        if not target_stage.is_active:
            raise BadRequestException("Target stage is inactive.")

        if lead.pipeline_id is not None and target_stage.pipeline_id != lead.pipeline_id:
            raise BadRequestException("Cross-pipeline stage transitions are not allowed.")

        if lead.stage_id == target_stage.id:
            raise BadRequestException("Lead is already in the specified stage.")

        prev_stage_id = lead.stage_id
        prev_stage_name = lead.stage.name if lead.stage else None
        now_dt = _utcnow()

        clean_lost_reason = None
        if target_stage.stage_type == "won":
            lead.status = "won"
            lead.won_at = now_dt
            lead.lost_at = None
            lead.lost_reason = None
        elif target_stage.stage_type == "lost":
            clean_lost_reason = (data.lost_reason or data.reason or "").strip()
            if not clean_lost_reason or len(clean_lost_reason) < 3:
                raise BadRequestException("A meaningful lost_reason (minimum 3 characters) is required when transitioning to a lost stage.")
            lead.status = "lost"
            lead.lost_at = now_dt
            lead.lost_reason = clean_lost_reason
            lead.won_at = None
        else:
            if lead.status in ("won", "lost"):
                lead.status = "in_progress"
                lead.won_at = None
                lead.lost_at = None
                lead.lost_reason = None

        lead.stage_id = target_stage.id
        lead.stage = target_stage
        lead.updated_at = now_dt

        history_reason = clean_lost_reason if target_stage.stage_type == "lost" else (data.reason.strip() if data.reason else f"Moved to {target_stage.name}")
        stage_history = CrmStageHistory(
            lead_id=lead.id,
            from_stage_id=prev_stage_id,
            to_stage_id=target_stage.id,
            changed_by=actor.id,
            reason=history_reason,
            created_at=now_dt,
        )
        self.session.add(stage_history)

        stage_activity = CrmActivity(
            lead_id=lead.id,
            activity_type="stage_change",
            subject=f"Stage changed to {target_stage.name}",
            description=f"Transitioned from '{prev_stage_name or 'None'}' to '{target_stage.name}'. Reason: {history_reason}",
            outcome=target_stage.stage_type,
            performed_by=actor.id,
            activity_at=now_dt,
            created_at=now_dt,
        )
        self.session.add(stage_activity)

        lead_id = lead.id
        await self.session.commit()

        return await self.get_lead(lead_id=lead_id, actor=actor)

    async def list_stage_history(
        self,
        lead_id: uuid.UUID,
        actor: CurrentUser,
    ) -> CrmStageHistoryListResponse:
        """List stage transition history for a lead with authorization check."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self._check_lead_scope(lead, actor, action="view")

        stmt = (
            select(CrmStageHistory, User, CrmPipelineStage)
            .outerjoin(User, CrmStageHistory.changed_by == User.id)
            .outerjoin(CrmPipelineStage, CrmStageHistory.to_stage_id == CrmPipelineStage.id)
            .where(CrmStageHistory.lead_id == lead.id)
            .order_by(desc(CrmStageHistory.created_at))
        )
        rows = (await self.session.execute(stmt)).all()

        from_stage_ids = {sh.from_stage_id for sh, _, _ in rows if sh.from_stage_id}
        stage_name_map: dict[uuid.UUID, str] = {}
        if from_stage_ids:
            stg_rows = (await self.session.execute(
                select(CrmPipelineStage.id, CrmPipelineStage.name).where(CrmPipelineStage.id.in_(from_stage_ids))
            )).all()
            stage_name_map = {sid: sname for sid, sname in stg_rows}

        items: list[CrmStageHistoryRead] = []
        for sh, changer, to_stage in rows:
            c_name = (changer.display_name or changer.full_name or changer.username) if changer else None
            items.append(
                CrmStageHistoryRead(
                    id=sh.id,
                    lead_id=sh.lead_id,
                    from_stage_id=sh.from_stage_id,
                    from_stage_name=stage_name_map.get(sh.from_stage_id),
                    to_stage_id=sh.to_stage_id,
                    to_stage_name=to_stage.name if to_stage else None,
                    changed_by=sh.changed_by,
                    changed_by_name=c_name,
                    reason=sh.reason,
                    created_at=sh.created_at,
                )
            )

        return CrmStageHistoryListResponse(items=items, total=len(items))

    async def get_lead_timeline(
        self,
        lead_id: uuid.UUID,
        actor: CurrentUser,
    ) -> CrmTimelineResponse:
        """Retrieve unified chronological lifecycle timeline of a lead."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self._check_lead_scope(lead, actor, action="view")

        items: list[CrmTimelineItem] = []

        # 1. Activities (skip activities that duplicate dedicated stage, follow-up, or assignment history)
        dedup_activity_types = {
            "stage_change",
            "stage_changed",
            "follow_up_completed",
            "follow_up_created",
            "follow_up_cancelled",
            "assignment_changed",
            "reassignment",
        }

        act_stmt = (
            select(CrmActivity, User)
            .outerjoin(User, CrmActivity.performed_by == User.id)
            .where(CrmActivity.lead_id == lead.id)
            .order_by(desc(CrmActivity.activity_at))
        )
        act_rows = (await self.session.execute(act_stmt)).all()
        for act, performer in act_rows:
            if act.activity_type in dedup_activity_types:
                continue
            p_name = (performer.display_name or performer.full_name or performer.username) if performer else None
            p_email = performer.email if performer else None
            title = act.subject or f"{act.activity_type.capitalize()} Logged"
            items.append(
                CrmTimelineItem(
                    id=act.id,
                    timeline_type="activity",
                    title=title,
                    description=act.description,
                    timestamp=act.activity_at,
                    actor_id=act.performed_by,
                    actor_name=p_name,
                    actor_email=p_email,
                    metadata={
                        "activity_type": act.activity_type,
                        "outcome": act.outcome,
                    },
                )
            )

        # 2. Follow-Ups
        fu_stmt = (
            select(CrmFollowUp, User)
            .outerjoin(User, CrmFollowUp.assigned_to == User.id)
            .where(CrmFollowUp.lead_id == lead.id, CrmFollowUp.deleted_at.is_(None))
            .order_by(desc(CrmFollowUp.due_at))
        )
        fu_rows = (await self.session.execute(fu_stmt)).all()
        for fu, assignee in fu_rows:
            a_name = (assignee.display_name or assignee.full_name or assignee.username) if assignee else None
            a_email = assignee.email if assignee else None
            ts = fu.completed_at if fu.status == "completed" and fu.completed_at else fu.created_at
            items.append(
                CrmTimelineItem(
                    id=fu.id,
                    timeline_type="follow_up",
                    title=f"Follow-Up ({fu.follow_up_type.capitalize()}): {fu.status.capitalize()}",
                    description=fu.notes,
                    timestamp=ts,
                    actor_id=fu.created_by,
                    actor_name=a_name,
                    actor_email=a_email,
                    metadata={
                        "status": fu.status,
                        "due_at": fu.due_at.isoformat(),
                        "follow_up_type": fu.follow_up_type,
                        "assigned_to": str(fu.assigned_to) if fu.assigned_to else None,
                    },
                )
            )

        # 3. Stage History
        sh_stmt = (
            select(
                CrmStageHistory,
                User,
                CrmPipelineStage,
            )
            .outerjoin(User, CrmStageHistory.changed_by == User.id)
            .outerjoin(CrmPipelineStage, CrmStageHistory.to_stage_id == CrmPipelineStage.id)
            .where(CrmStageHistory.lead_id == lead.id)
            .order_by(desc(CrmStageHistory.created_at))
        )
        sh_rows = (await self.session.execute(sh_stmt)).all()
        for sh, changer, to_stage in sh_rows:
            c_name = (changer.display_name or changer.full_name or changer.username) if changer else None
            c_email = changer.email if changer else None
            stage_name = to_stage.name if to_stage else "Unknown Stage"
            items.append(
                CrmTimelineItem(
                    id=sh.id,
                    timeline_type="stage_history",
                    title=f"Pipeline Stage Changed: {stage_name}",
                    description=sh.reason,
                    timestamp=sh.created_at,
                    actor_id=sh.changed_by,
                    actor_name=c_name,
                    actor_email=c_email,
                    metadata={
                        "from_stage_id": str(sh.from_stage_id) if sh.from_stage_id else None,
                        "to_stage_id": str(sh.to_stage_id) if sh.to_stage_id else None,
                    },
                )
            )

        # 4. Assignment History
        ah_stmt = (
            select(
                CrmAssignmentHistory,
                User,
            )
            .outerjoin(User, CrmAssignmentHistory.assigned_by == User.id)
            .where(CrmAssignmentHistory.lead_id == lead.id)
            .order_by(desc(CrmAssignmentHistory.created_at))
        )
        ah_rows = (await self.session.execute(ah_stmt)).all()
        for ah, assigner in ah_rows:
            as_name = (assigner.display_name or assigner.full_name or assigner.username) if assigner else None
            as_email = assigner.email if assigner else None
            title = f"Lead Ownership: {ah.assignment_method.capitalize()}"
            items.append(
                CrmTimelineItem(
                    id=ah.id,
                    timeline_type="assignment_history",
                    title=title,
                    description=ah.reason,
                    timestamp=ah.created_at,
                    actor_id=ah.assigned_by,
                    actor_name=as_name,
                    actor_email=as_email,
                    metadata={
                        "assignment_method": ah.assignment_method,
                        "previous_owner_id": str(ah.previous_owner_id) if ah.previous_owner_id else None,
                        "new_owner_id": str(ah.new_owner_id) if ah.new_owner_id else None,
                    },
                )
            )

        items.sort(key=lambda x: x.timestamp, reverse=True)

        return CrmTimelineResponse(
            lead_id=lead.id,
            lead_code=lead.lead_code,
            lead_name=lead.name,
            items=items,
            total=len(items),
        )

    # -------------------------------------------------------------------------
    # Phase 6, Step 3: Daily Work & Manager Team Oversight Services
    # -------------------------------------------------------------------------

    async def get_daily_work_summary(
        self,
        actor: CurrentUser,
        salesperson_id: uuid.UUID | None = None,
    ) -> CrmDailyWorkSummary:
        """
        Compute real metric counts for a salesperson's daily work view using Asia/Kolkata date boundaries.
        Enforces strict RBAC: salespeople can only view their own summary.
        """
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)

        target_id: uuid.UUID
        if role_type == "salesperson":
            if salesperson_id is not None and salesperson_id != actor.id:
                raise ForbiddenException("Salespeople can only view their own daily work summary.")
            target_id = actor.id
        elif role_type == "manager":
            assert scoped_user_ids is not None
            if salesperson_id is not None:
                if salesperson_id not in scoped_user_ids:
                    raise ForbiddenException("Requested salesperson is outside your departmental scope.")
                target_id = salesperson_id
            else:
                target_id = actor.id
        else:
            # admin: company-wide
            target_id = salesperson_id or actor.id

        target_user = await self.session.get(User, target_id)
        if not target_user or target_user.deleted_at is not None:
            raise NotFoundException(f"Salesperson with id {target_id} not found.")

        target_name = target_user.display_name or target_user.full_name or target_user.username

        # Local business boundaries (Asia/Kolkata)
        now_utc = datetime.now(timezone.utc)
        local_now = now_utc.astimezone(BUSINESS_TZ)
        local_today = local_now.date()
        local_today_start = datetime(
            local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)
        local_today_end = datetime(
            local_today.year, local_today.month, local_today.day, 23, 59, 59, 999999, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)

        # 1. Overdue Follow-ups (pending, due before today start)
        overdue_stmt = (
            select(func.count(CrmFollowUp.id))
            .where(
                CrmFollowUp.assigned_to == target_id,
                CrmFollowUp.deleted_at.is_(None),
                CrmFollowUp.status == "pending",
                CrmFollowUp.due_at < local_today_start,
            )
        )
        overdue_count = (await self.session.execute(overdue_stmt)).scalar() or 0

        # 2. Due Today Follow-ups (pending, due within today)
        due_today_stmt = (
            select(func.count(CrmFollowUp.id))
            .where(
                CrmFollowUp.assigned_to == target_id,
                CrmFollowUp.deleted_at.is_(None),
                CrmFollowUp.status == "pending",
                CrmFollowUp.due_at >= local_today_start,
                CrmFollowUp.due_at <= local_today_end,
            )
        )
        due_today_count = (await self.session.execute(due_today_stmt)).scalar() or 0

        # 3. Upcoming Follow-ups (pending, due after today end)
        upcoming_stmt = (
            select(func.count(CrmFollowUp.id))
            .where(
                CrmFollowUp.assigned_to == target_id,
                CrmFollowUp.deleted_at.is_(None),
                CrmFollowUp.status == "pending",
                CrmFollowUp.due_at > local_today_end,
            )
        )
        upcoming_count = (await self.session.execute(upcoming_stmt)).scalar() or 0

        # 4. Active Leads (assigned to target user, not deleted, not won, not lost)
        active_leads_stmt = (
            select(func.count(CrmLead.id))
            .where(
                CrmLead.assigned_to == target_id,
                CrmLead.deleted_at.is_(None),
                CrmLead.status.notin_(["won", "lost"]),
            )
        )
        active_leads_count = (await self.session.execute(active_leads_stmt)).scalar() or 0

        return CrmDailyWorkSummary(
            salesperson_id=target_id,
            salesperson_name=target_name,
            overdue_follow_ups=overdue_count,
            due_today_follow_ups=due_today_count,
            upcoming_follow_ups=upcoming_count,
            active_leads=active_leads_count,
        )

    async def get_team_oversight(
        self,
        actor: CurrentUser,
        department_id: uuid.UUID | None = None,
    ) -> CrmTeamOversightResponse:
        """
        Manager and Admin Team Oversight endpoint.
        Shows rep-by-rep active leads, overdue/due-today follow-ups, current calendar month won/lost counts,
        and pipeline stage distribution.
        Strictly forbids regular salespeople from querying team metrics.
        """
        role_type, scoped_user_ids = await self.get_actor_role_and_scope(actor)

        if role_type == "salesperson":
            raise ForbiddenException("Salespeople are not authorized to view team oversight metrics.")

        scope_type: str
        target_reps: list[User] = []

        if role_type == "manager":
            scope_type = "team"
            assert scoped_user_ids is not None
            reps_stmt = (
                select(User)
                .where(
                    User.id.in_(list(scoped_user_ids)),
                    User.deleted_at.is_(None),
                )
                .order_by(User.display_name.asc(), User.username.asc())
            )
            target_reps = list((await self.session.execute(reps_stmt)).scalars().all())
        else:
            # admin: company-wide
            scope_type = "company_wide"
            reps_stmt = (
                select(User)
                .where(
                    User.deleted_at.is_(None),
                    User.status == UserStatus.ACTIVE,
                    or_(
                        User.id.in_(select(CrmSalespersonConfig.user_id)),
                        User.id.in_(
                            select(CrmLead.assigned_to).where(
                                CrmLead.assigned_to.is_not(None), CrmLead.deleted_at.is_(None)
                            )
                        ),
                        User.id.in_(
                            select(CrmFollowUp.assigned_to).where(
                                CrmFollowUp.assigned_to.is_not(None), CrmFollowUp.deleted_at.is_(None)
                            )
                        ),
                        User.manager_id.is_not(None),
                        User.id == actor.id,
                    ),
                )
                .order_by(User.display_name.asc(), User.username.asc())
            )
            target_reps = list((await self.session.execute(reps_stmt)).scalars().all())

        if not target_reps:
            return CrmTeamOversightResponse(
                scope_type=scope_type,
                department_id=department_id,
                department_name=None,
                reps=[],
                total_active_leads=0,
                total_overdue_follow_ups=0,
                total_due_today_follow_ups=0,
                total_month_won=0,
                total_month_lost=0,
            )

        rep_ids = [u.id for u in target_reps]

        # Calculate Asia/Kolkata date boundaries
        now_utc = datetime.now(timezone.utc)
        local_now = now_utc.astimezone(BUSINESS_TZ)
        local_today = local_now.date()
        local_today_start = datetime(
            local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)
        local_today_end = datetime(
            local_today.year, local_today.month, local_today.day, 23, 59, 59, 999999, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)

        # Calendar month boundaries
        local_month_start = datetime(
            local_now.year, local_now.month, 1, 0, 0, 0, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)
        _, last_day = calendar.monthrange(local_now.year, local_now.month)
        local_month_end = datetime(
            local_now.year, local_now.month, last_day, 23, 59, 59, 999999, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)

        # Bulk Query 1: Active leads per rep
        active_leads_stmt = (
            select(CrmLead.assigned_to, func.count(CrmLead.id))
            .where(
                CrmLead.assigned_to.in_(rep_ids),
                CrmLead.deleted_at.is_(None),
                CrmLead.status.notin_(["won", "lost"]),
            )
            .group_by(CrmLead.assigned_to)
        )
        active_leads_rows = (await self.session.execute(active_leads_stmt)).all()
        active_leads_map = {r[0]: int(r[1]) for r in active_leads_rows if r[0] is not None}

        # Bulk Query 2: Overdue and Due Today follow-ups per rep
        follow_ups_stmt = (
            select(
                CrmFollowUp.assigned_to,
                func.sum(case((CrmFollowUp.due_at < local_today_start, 1), else_=0)).label("overdue_count"),
                func.sum(
                    case(
                        (
                            and_(
                                CrmFollowUp.due_at >= local_today_start,
                                CrmFollowUp.due_at <= local_today_end,
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("due_today_count"),
            )
            .where(
                CrmFollowUp.assigned_to.in_(rep_ids),
                CrmFollowUp.deleted_at.is_(None),
                CrmFollowUp.status == "pending",
            )
            .group_by(CrmFollowUp.assigned_to)
        )
        follow_ups_rows = (await self.session.execute(follow_ups_stmt)).all()
        follow_ups_map = {
            r[0]: {
                "overdue": int(r[1] or 0),
                "due_today": int(r[2] or 0),
            }
            for r in follow_ups_rows
            if r[0] is not None
        }

        # Bulk Query 3: Calendar month won and lost counts per rep
        won_condition = and_(
            CrmLead.status == "won",
            or_(
                and_(CrmLead.won_at >= local_month_start, CrmLead.won_at <= local_month_end),
                and_(CrmLead.won_at.is_(None), CrmLead.updated_at >= local_month_start, CrmLead.updated_at <= local_month_end),
            ),
        )
        lost_condition = and_(
            CrmLead.status == "lost",
            or_(
                and_(CrmLead.lost_at >= local_month_start, CrmLead.lost_at <= local_month_end),
                and_(CrmLead.lost_at.is_(None), CrmLead.updated_at >= local_month_start, CrmLead.updated_at <= local_month_end),
            ),
        )

        monthly_outcomes_stmt = (
            select(
                CrmLead.assigned_to,
                func.sum(case((won_condition, 1), else_=0)).label("month_won"),
                func.sum(case((lost_condition, 1), else_=0)).label("month_lost"),
            )
            .where(
                CrmLead.assigned_to.in_(rep_ids),
                CrmLead.deleted_at.is_(None),
                or_(won_condition, lost_condition),
            )
            .group_by(CrmLead.assigned_to)
        )
        monthly_rows = (await self.session.execute(monthly_outcomes_stmt)).all()
        monthly_map = {
            r[0]: {
                "won": int(r[1] or 0),
                "lost": int(r[2] or 0),
            }
            for r in monthly_rows
            if r[0] is not None
        }

        # Bulk Query 4: Pipeline stage distribution per rep
        stage_dist_stmt = (
            select(
                CrmLead.assigned_to,
                CrmPipelineStage.id.label("stage_id"),
                CrmPipelineStage.name.label("stage_name"),
                CrmPipelineStage.stage_type.label("stage_type"),
                func.count(CrmLead.id).label("lead_count"),
            )
            .join(CrmPipelineStage, CrmLead.stage_id == CrmPipelineStage.id)
            .where(
                CrmLead.assigned_to.in_(rep_ids),
                CrmLead.deleted_at.is_(None),
                CrmLead.status.notin_(["won", "lost"]),
            )
            .group_by(
                CrmLead.assigned_to,
                CrmPipelineStage.id,
                CrmPipelineStage.name,
                CrmPipelineStage.stage_type,
                CrmPipelineStage.stage_order,
            )
            .order_by(CrmPipelineStage.stage_order.asc())
        )
        stage_rows = (await self.session.execute(stage_dist_stmt)).all()
        stage_dist_map: dict[uuid.UUID, list[CrmStageCountItem]] = {}
        for r in stage_rows:
            u_id = r[0]
            if u_id not in stage_dist_map:
                stage_dist_map[u_id] = []
            stage_dist_map[u_id].append(
                CrmStageCountItem(
                    stage_id=r[1],
                    stage_name=r[2],
                    stage_type=r[3],
                    count=int(r[4]),
                )
            )

        # Assemble rep items & totals
        rep_items: list[CrmRepOversightItem] = []
        tot_active = 0
        tot_overdue = 0
        tot_due_today = 0
        tot_won = 0
        tot_lost = 0

        for u in target_reps:
            u_name = u.display_name or u.full_name or u.username
            active_cnt = active_leads_map.get(u.id, 0)
            fu_metrics = follow_ups_map.get(u.id, {})
            overdue_cnt = fu_metrics.get("overdue", 0)
            due_today_cnt = fu_metrics.get("due_today", 0)
            m_metrics = monthly_map.get(u.id, {})
            month_won = m_metrics.get("won", 0)
            month_lost = m_metrics.get("lost", 0)
            stages = stage_dist_map.get(u.id, [])

            tot_active += active_cnt
            tot_overdue += overdue_cnt
            tot_due_today += due_today_cnt
            tot_won += month_won
            tot_lost += month_lost

            rep_items.append(
                CrmRepOversightItem(
                    salesperson_id=u.id,
                    salesperson_name=u_name,
                    salesperson_email=u.email,
                    active_lead_count=active_cnt,
                    overdue_follow_up_count=overdue_cnt,
                    due_today_follow_up_count=due_today_cnt,
                    month_won_count=month_won,
                    month_lost_count=month_lost,
                    stage_distribution=stages,
                )
            )

        return CrmTeamOversightResponse(
            scope_type=scope_type,
            department_id=department_id,
            department_name=None,
            reps=rep_items,
            total_active_leads=tot_active,
            total_overdue_follow_ups=tot_overdue,
            total_due_today_follow_ups=tot_due_today,
            total_month_won=tot_won,
            total_month_lost=tot_lost,
        )


