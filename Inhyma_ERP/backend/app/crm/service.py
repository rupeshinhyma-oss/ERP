"""
CRM Pipeline and Stage Service.

Business logic enforcing pipeline and stage integrity rules:
- Trimmed names and unique pipeline/stage name validation.
- Exactly one valid default pipeline with concurrency and transactional safety.
- A pipeline must have at least one valid initial stage before it can be activated or made default.
- Exactly one initial stage per pipeline; initial stage must be of type 'open'.
- Valid stage types: 'open', 'won', 'lost'.
- Safe deactivation/deletion: prevent deactivating/deleting pipeline or stage if active leads or stage history exist.
- Stage reordering within pipeline maintaining order uniqueness.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, ForbiddenException, NotFoundException
from app.core.logging import get_logger

from app.crm.models import (
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmSalespersonConfig,
    CrmSalespersonTerritory,
    CrmStageHistory,
)
from app.crm.schemas import (
    CrmPipelineCreate,
    CrmPipelineDetailRead,
    CrmPipelineListItemRead,
    CrmPipelineUpdate,
    CrmStageCreate,
    CrmStageRead,
    CrmStageReorderRequest,
    CrmStageUpdate,
    SalespersonBulkEligibilityUpdate,
    SalespersonDistributionItem,
    SalespersonDistributionUpdate,
    SalespersonTerritoryRead,
)
from app.masters.states.models import State
from app.org_structure.models import DepartmentLeadershipAssignment, OrgRecordStatus
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus


logger = get_logger(__name__)


class CrmPipelineService:
    """Service layer for CRM Pipelines and Stages."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # -------------------------------------------------------------------------
    # Pipelines
    # -------------------------------------------------------------------------

    async def list_pipelines(self, *, is_active: bool | None = None) -> list[CrmPipelineListItemRead]:
        """List all non-deleted pipelines with summary counts."""
        stmt = (
            select(
                CrmPipeline,
                func.count(func.distinct(CrmPipelineStage.id)).label("stage_count"),
                func.count(func.distinct(CrmLead.id)).label("lead_count"),
            )
            .outerjoin(
                CrmPipelineStage,
                (CrmPipelineStage.pipeline_id == CrmPipeline.id) & (CrmPipelineStage.deleted_at.is_(None)),
            )
            .outerjoin(
                CrmLead,
                (CrmLead.pipeline_id == CrmPipeline.id) & (CrmLead.deleted_at.is_(None)),
            )
            .where(CrmPipeline.deleted_at.is_(None))
            .group_by(CrmPipeline.id)
            .order_by(CrmPipeline.is_default.desc(), CrmPipeline.name.asc())
        )

        if is_active is not None:
            stmt = stmt.where(CrmPipeline.is_active == is_active)

        result = await self.session.execute(stmt)
        items: list[CrmPipelineListItemRead] = []
        for row in result.all():
            p: CrmPipeline = row[0]
            stage_cnt: int = row[1]
            lead_cnt: int = row[2]
            items.append(
                CrmPipelineListItemRead(
                    id=p.id,
                    name=p.name,
                    description=p.description,
                    is_default=p.is_default,
                    is_active=p.is_active,
                    stage_count=stage_cnt,
                    lead_count=lead_cnt,
                    created_by=p.created_by,
                    created_at=p.created_at,
                    updated_at=p.updated_at,
                )
            )
        return items

    async def get_pipeline_by_id(self, pipeline_id: uuid.UUID) -> CrmPipeline:
        """Fetch pipeline entity or raise NotFoundException."""
        stmt = (
            select(CrmPipeline)
            .options(
                selectinload(CrmPipeline.stages),
            )
            .where(CrmPipeline.id == pipeline_id, CrmPipeline.deleted_at.is_(None))
        )
        res = await self.session.execute(stmt)
        pipeline = res.scalar_one_or_none()
        if not pipeline:
            raise NotFoundException("Pipeline not found.")
        return pipeline

    async def get_pipeline_detail(self, pipeline_id: uuid.UUID) -> CrmPipelineDetailRead:
        """Get full pipeline detail with ordered stages and lead counts."""
        pipeline = await self.get_pipeline_by_id(pipeline_id)

        # Get lead count per stage
        stage_lead_counts_stmt = (
            select(CrmLead.stage_id, func.count(CrmLead.id))
            .where(CrmLead.pipeline_id == pipeline_id, CrmLead.deleted_at.is_(None))
            .group_by(CrmLead.stage_id)
        )
        stage_lead_res = await self.session.execute(stage_lead_counts_stmt)
        counts_by_stage: dict[uuid.UUID, int] = {row[0]: row[1] for row in stage_lead_res.all() if row[0]}

        ordered_stages = sorted(
            [s for s in pipeline.stages if s.deleted_at is None],
            key=lambda s: s.stage_order,
        )

        stage_reads: list[CrmStageRead] = [
            CrmStageRead(
                id=s.id,
                pipeline_id=s.pipeline_id,
                name=s.name,
                stage_order=s.stage_order,
                stage_type=s.stage_type,
                is_initial=s.is_initial,
                is_active=s.is_active,
                lead_count=counts_by_stage.get(s.id, 0),
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
            for s in ordered_stages
        ]

        return CrmPipelineDetailRead(
            id=pipeline.id,
            name=pipeline.name,
            description=pipeline.description,
            is_default=pipeline.is_default,
            is_active=pipeline.is_active,
            created_by=pipeline.created_by,
            created_at=pipeline.created_at,
            updated_at=pipeline.updated_at,
            stages=stage_reads,
        )

    async def create_pipeline(
        self, data: CrmPipelineCreate, creator_id: uuid.UUID | None = None
    ) -> CrmPipelineDetailRead:
        """Create a new CRM pipeline with optional initial stages."""
        name = data.name.strip()

        # Check name uniqueness among active/non-deleted pipelines
        name_check = await self.session.execute(
            select(CrmPipeline.id).where(
                func.lower(CrmPipeline.name) == func.lower(name),
                CrmPipeline.deleted_at.is_(None),
            )
        )
        if name_check.scalar_one_or_none() is not None:
            raise ConflictException(f"A pipeline named '{name}' already exists.")

        # Stage validation:
        # Every pipeline being created must have at least one stage and exactly one initial stage.
        stages_payload = data.stages or []
        if not stages_payload:
            raise BadRequestException(
                "Every pipeline being created must have at least one stage and exactly one initial stage."
            )

        initial_stages_count = sum(1 for s in stages_payload if s.is_initial)
        if initial_stages_count == 0:
            raise BadRequestException(
                "A pipeline must have at least one valid initial stage."
            )
        if initial_stages_count > 1:
            raise BadRequestException("A pipeline cannot have multiple initial stages.")

        # Validate stage names, orders, types and initial stage restrictions
        stage_names_seen: set[str] = set()
        stage_orders_seen: set[int] = set()
        for idx, s in enumerate(stages_payload):
            s_name = s.name.strip()
            if not s_name:
                raise BadRequestException("Stage name is required and cannot be blank.")
            if s_name.lower() in stage_names_seen:
                raise BadRequestException(f"Duplicate stage name '{s_name}' in pipeline configuration.")
            stage_names_seen.add(s_name.lower())

            order = s.stage_order if s.stage_order > 0 else idx + 1
            if order in stage_orders_seen:
                raise BadRequestException(f"Duplicate stage order {order} in pipeline configuration.")
            stage_orders_seen.add(order)

            if s.is_initial and s.stage_type != "open":
                raise BadRequestException(
                    f"Initial stage '{s_name}' must be of type 'open'. Terminal stages ('won' or 'lost') cannot be initial."
                )

        # If making this pipeline default, safely unset existing defaults inside transaction
        if data.is_default:
            await self.session.execute(
                update(CrmPipeline)
                .where(CrmPipeline.is_default.is_(True), CrmPipeline.deleted_at.is_(None))
                .values(is_default=False)
            )

        pipeline = CrmPipeline(
            name=name,
            description=data.description.strip() if data.description else None,
            is_default=data.is_default,
            is_active=data.is_active,
            created_by=creator_id,
        )
        try:
            self.session.add(pipeline)
            await self.session.flush()

            # Add stages if provided
            for idx, s in enumerate(stages_payload):
                order = s.stage_order if s.stage_order > 0 else idx + 1
                stage_entity = CrmPipelineStage(
                    pipeline_id=pipeline.id,
                    name=s.name.strip(),
                    stage_order=order,
                    stage_type=s.stage_type,
                    is_initial=s.is_initial,
                    is_active=s.is_active,
                )
                self.session.add(stage_entity)

            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            logger.warning("IntegrityError during pipeline creation: %s", exc)
            err_str = str(exc).lower()
            if "crm_pipelines_name" in err_str or "key (name)=" in err_str:
                raise ConflictException(f"A pipeline named '{name}' already exists.") from exc
            if "crm_pipeline_stage_order" in err_str or "stage_order" in err_str:
                raise BadRequestException("Stage order conflict detected in pipeline configuration.") from exc
            if "crm_pipeline_stage_name" in err_str or "stage_name" in err_str:
                raise ConflictException("Duplicate stage name detected in pipeline configuration.") from exc
            raise ConflictException(f"Database constraint conflict: could not create pipeline '{name}'.") from exc

        return await self.get_pipeline_detail(pipeline.id)

    async def update_pipeline(
        self, pipeline_id: uuid.UUID, data: CrmPipelineUpdate
    ) -> CrmPipelineDetailRead:
        """Update pipeline metadata and active/default state."""
        # Lock row for concurrency safety
        stmt = (
            select(CrmPipeline)
            .options(selectinload(CrmPipeline.stages))
            .where(CrmPipeline.id == pipeline_id, CrmPipeline.deleted_at.is_(None))
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        pipeline = res.scalar_one_or_none()
        if not pipeline:
            raise NotFoundException("Pipeline not found.")

        # Update name if provided
        if data.name is not None:
            new_name = data.name.strip()
            if new_name.lower() != pipeline.name.lower():
                dup_check = await self.session.execute(
                    select(CrmPipeline.id).where(
                        func.lower(CrmPipeline.name) == func.lower(new_name),
                        CrmPipeline.id != pipeline_id,
                        CrmPipeline.deleted_at.is_(None),
                    )
                )
                if dup_check.scalar_one_or_none() is not None:
                    raise ConflictException(f"A pipeline named '{new_name}' already exists.")
                pipeline.name = new_name

        if data.description is not None:
            pipeline.description = data.description.strip() if data.description else None

        active_stages = [s for s in pipeline.stages if s.deleted_at is None and s.is_active]
        has_active_initial_stage = any(s.is_initial for s in active_stages)

        # Handling is_default changes
        if data.is_default is not None:
            if data.is_default is True and not pipeline.is_default:
                # Must be active and have an active initial stage
                target_is_active = data.is_active if data.is_active is not None else pipeline.is_active
                if not target_is_active:
                    raise BadRequestException("A default pipeline must be active.")
                if not has_active_initial_stage:
                    raise BadRequestException(
                        "Cannot set pipeline as default because it does not have an active initial stage."
                    )
                # Atomically clear other defaults
                await self.session.execute(
                    update(CrmPipeline)
                    .where(CrmPipeline.id != pipeline_id, CrmPipeline.is_default.is_(True), CrmPipeline.deleted_at.is_(None))
                    .values(is_default=False)
                )
                pipeline.is_default = True
            elif data.is_default is False and pipeline.is_default:
                # Disallow unsetting default directly
                raise BadRequestException(
                    "Cannot remove default status from the default pipeline. Designate another active pipeline as default instead."
                )

        # Handling is_active changes
        if data.is_active is not None:
            if data.is_active is False and pipeline.is_active:
                if pipeline.is_default:
                    raise BadRequestException(
                        "Cannot deactivate the default pipeline. Please set another active pipeline as default first."
                    )
                # Check for active leads
                leads_cnt_stmt = select(func.count(CrmLead.id)).where(
                    CrmLead.pipeline_id == pipeline_id,
                    CrmLead.deleted_at.is_(None),
                    CrmLead.status == "open",
                )
                leads_cnt = (await self.session.execute(leads_cnt_stmt)).scalar_one()
                if leads_cnt > 0:
                    raise BadRequestException(
                        f"Cannot deactivate pipeline because it contains {leads_cnt} open CRM lead(s). "
                        "Reassign or close existing leads before deactivating this pipeline."
                    )
                pipeline.is_active = False
            elif data.is_active is True and not pipeline.is_active:
                if not has_active_initial_stage:
                    raise BadRequestException(
                        "Cannot activate pipeline because it does not have at least one active initial stage."
                    )
                pipeline.is_active = True

        pipeline.updated_at = datetime.now(timezone.utc)
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            logger.warning("IntegrityError during pipeline update: %s", exc)
            err_str = str(exc).lower()
            if "crm_pipelines_name" in err_str or "key (name)=" in err_str:
                target_name = data.name or pipeline.name
                raise ConflictException(f"A pipeline named '{target_name}' already exists.") from exc
            raise ConflictException("Database constraint conflict updating pipeline.") from exc

        return await self.get_pipeline_detail(pipeline_id)

    async def set_default_pipeline(self, pipeline_id: uuid.UUID) -> CrmPipelineDetailRead:
        """Safely switch the default pipeline to the designated one."""
        stmt = (
            select(CrmPipeline)
            .options(selectinload(CrmPipeline.stages))
            .where(CrmPipeline.id == pipeline_id, CrmPipeline.deleted_at.is_(None))
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        pipeline = res.scalar_one_or_none()
        if not pipeline:
            raise NotFoundException("Pipeline not found.")

        # Ensure pipeline has at least one active initial stage
        active_initial = [
            s for s in pipeline.stages
            if s.deleted_at is None and s.is_active and s.is_initial
        ]
        if not active_initial:
            raise BadRequestException(
                "Cannot set pipeline as default because it has no active initial stage."
            )

        # Ensure it is active
        pipeline.is_active = True
        pipeline.is_default = True
        pipeline.updated_at = datetime.now(timezone.utc)

        # Clear other defaults transactionally
        await self.session.execute(
            update(CrmPipeline)
            .where(CrmPipeline.id != pipeline_id, CrmPipeline.is_default.is_(True), CrmPipeline.deleted_at.is_(None))
            .values(is_default=False)
        )

        await self.session.commit()
        return await self.get_pipeline_detail(pipeline_id)

    async def toggle_active_pipeline(self, pipeline_id: uuid.UUID) -> CrmPipelineDetailRead:
        """Toggle active/inactive state of a pipeline."""
        stmt = (
            select(CrmPipeline)
            .options(selectinload(CrmPipeline.stages))
            .where(CrmPipeline.id == pipeline_id, CrmPipeline.deleted_at.is_(None))
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        pipeline = res.scalar_one_or_none()
        if not pipeline:
            raise NotFoundException("Pipeline not found.")

        target_active = not pipeline.is_active
        return await self.update_pipeline(pipeline_id, CrmPipelineUpdate(is_active=target_active))

    async def delete_pipeline(self, pipeline_id: uuid.UUID) -> None:
        """Safely soft-delete a pipeline if not default and no leads exist."""
        stmt = (
            select(CrmPipeline)
            .options(selectinload(CrmPipeline.stages))
            .where(CrmPipeline.id == pipeline_id, CrmPipeline.deleted_at.is_(None))
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        pipeline = res.scalar_one_or_none()
        if not pipeline:
            raise NotFoundException("Pipeline not found.")

        if pipeline.is_default:
            raise BadRequestException(
                "Cannot delete the default pipeline. Designate another active pipeline as default first."
            )

        # Check if leads exist
        leads_cnt_stmt = select(func.count(CrmLead.id)).where(
            CrmLead.pipeline_id == pipeline_id,
            CrmLead.deleted_at.is_(None),
        )
        leads_cnt = (await self.session.execute(leads_cnt_stmt)).scalar_one()
        if leads_cnt > 0:
            raise BadRequestException(
                f"Cannot delete pipeline because {leads_cnt} CRM lead(s) are associated with it. "
                "Deactivate the pipeline instead or reassign the leads."
            )

        now = datetime.now(timezone.utc)
        pipeline.deleted_at = now
        pipeline.name = f"{pipeline.name}__deleted_{pipeline.id.hex[:8]}"
        for idx, s in enumerate(pipeline.stages):
            if s.deleted_at is None:
                s.deleted_at = now
                s.name = f"{s.name}__deleted_{s.id.hex[:8]}"
                s.stage_order = -1000 - (idx + 1)

        await self.session.commit()

    # -------------------------------------------------------------------------
    # Stages
    # -------------------------------------------------------------------------

    async def create_stage(self, pipeline_id: uuid.UUID, data: CrmStageCreate) -> CrmStageRead:
        """Create a new stage within a pipeline."""
        pipeline = await self.get_pipeline_by_id(pipeline_id)
        name = data.name.strip()

        # Check name uniqueness within pipeline
        dup_check = await self.session.execute(
            select(CrmPipelineStage.id).where(
                CrmPipelineStage.pipeline_id == pipeline_id,
                func.lower(CrmPipelineStage.name) == func.lower(name),
                CrmPipelineStage.deleted_at.is_(None),
            )
        )
        if dup_check.scalar_one_or_none() is not None:
            raise ConflictException(f"A stage named '{name}' already exists in this pipeline.")

        if data.is_initial and data.stage_type != "open":
            raise BadRequestException("An initial stage must have stage_type 'open'.")

        # Determine stage order if not specified
        order = data.stage_order
        if order <= 0:
            max_order_stmt = select(func.coalesce(func.max(CrmPipelineStage.stage_order), 0)).where(
                CrmPipelineStage.pipeline_id == pipeline_id,
                CrmPipelineStage.deleted_at.is_(None),
            )
            order = (await self.session.execute(max_order_stmt)).scalar_one() + 1

        # Check order conflict
        order_check = await self.session.execute(
            select(CrmPipelineStage.id).where(
                CrmPipelineStage.pipeline_id == pipeline_id,
                CrmPipelineStage.stage_order == order,
                CrmPipelineStage.deleted_at.is_(None),
            )
        )
        if order_check.scalar_one_or_none() is not None:
            # Shift existing stages at or above this order up by 1
            await self.session.execute(
                update(CrmPipelineStage)
                .where(
                    CrmPipelineStage.pipeline_id == pipeline_id,
                    CrmPipelineStage.stage_order >= order,
                    CrmPipelineStage.deleted_at.is_(None),
                )
                .values(stage_order=CrmPipelineStage.stage_order + 1000)
            )
            await self.session.flush()
            # Then shift cleanly
            stages_to_shift = (
                await self.session.execute(
                    select(CrmPipelineStage)
                    .where(
                        CrmPipelineStage.pipeline_id == pipeline_id,
                        CrmPipelineStage.stage_order >= 1000,
                        CrmPipelineStage.deleted_at.is_(None),
                    )
                    .order_by(CrmPipelineStage.stage_order.asc())
                )
            ).scalars().all()
            for s_to_shift in stages_to_shift:
                s_to_shift.stage_order = (s_to_shift.stage_order - 1000) + 1
            await self.session.flush()

        # If setting as initial, clear other initial stages
        if data.is_initial:
            await self.session.execute(
                update(CrmPipelineStage)
                .where(
                    CrmPipelineStage.pipeline_id == pipeline_id,
                    CrmPipelineStage.is_initial.is_(True),
                    CrmPipelineStage.deleted_at.is_(None),
                )
                .values(is_initial=False)
            )

        stage = CrmPipelineStage(
            pipeline_id=pipeline_id,
            name=name,
            stage_order=order,
            stage_type=data.stage_type,
            is_initial=data.is_initial,
            is_active=data.is_active,
        )
        try:
            self.session.add(stage)
            await self.session.commit()
            await self.session.refresh(stage)
        except IntegrityError as exc:
            await self.session.rollback()
            logger.warning("IntegrityError during stage creation: %s", exc)
            err_str = str(exc).lower()
            if "crm_pipeline_stage_name" in err_str or "key (pipeline_id, name)=" in err_str:
                raise ConflictException(f"A stage named '{name}' already exists in this pipeline.") from exc
            if "crm_pipeline_stage_order" in err_str or "key (pipeline_id, stage_order)=" in err_str:
                raise BadRequestException(f"Stage order {order} conflicts with an existing stage.") from exc
            raise ConflictException("Database constraint conflict during stage creation.") from exc

        return CrmStageRead(
            id=stage.id,
            pipeline_id=stage.pipeline_id,
            name=stage.name,
            stage_order=stage.stage_order,
            stage_type=stage.stage_type,
            is_initial=stage.is_initial,
            is_active=stage.is_active,
            lead_count=0,
            created_at=stage.created_at,
            updated_at=stage.updated_at,
        )

    async def update_stage(
        self, pipeline_id: uuid.UUID, stage_id: uuid.UUID, data: CrmStageUpdate
    ) -> CrmStageRead:
        """Update an existing stage in a pipeline."""
        stmt = (
            select(CrmPipelineStage)
            .where(
                CrmPipelineStage.id == stage_id,
                CrmPipelineStage.pipeline_id == pipeline_id,
                CrmPipelineStage.deleted_at.is_(None),
            )
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        stage = res.scalar_one_or_none()
        if not stage:
            raise NotFoundException("Pipeline stage not found.")

        pipeline = await self.get_pipeline_by_id(pipeline_id)

        # Name update
        if data.name is not None:
            new_name = data.name.strip()
            if new_name.lower() != stage.name.lower():
                dup = await self.session.execute(
                    select(CrmPipelineStage.id).where(
                        CrmPipelineStage.pipeline_id == pipeline_id,
                        func.lower(CrmPipelineStage.name) == func.lower(new_name),
                        CrmPipelineStage.id != stage_id,
                        CrmPipelineStage.deleted_at.is_(None),
                    )
                )
                if dup.scalar_one_or_none() is not None:
                    raise ConflictException(f"A stage named '{new_name}' already exists in this pipeline.")
                stage.name = new_name

        # Stage type update
        target_stage_type = data.stage_type if data.stage_type is not None else stage.stage_type
        target_is_initial = data.is_initial if data.is_initial is not None else stage.is_initial

        if target_is_initial and target_stage_type != "open":
            raise BadRequestException("An initial stage must have stage_type 'open'.")

        if data.stage_type is not None:
            stage.stage_type = data.stage_type

        # Initial stage flag update
        if data.is_initial is not None:
            if data.is_initial is True and not stage.is_initial:
                # Safely clear previous initial stage in this pipeline
                await self.session.execute(
                    update(CrmPipelineStage)
                    .where(
                        CrmPipelineStage.pipeline_id == pipeline_id,
                        CrmPipelineStage.id != stage_id,
                        CrmPipelineStage.is_initial.is_(True),
                        CrmPipelineStage.deleted_at.is_(None),
                    )
                    .values(is_initial=False)
                )
                stage.is_initial = True
            elif data.is_initial is False and stage.is_initial:
                # If pipeline is active or default, it MUST have at least one initial stage!
                if pipeline.is_active or pipeline.is_default:
                    other_initial_stmt = select(func.count(CrmPipelineStage.id)).where(
                        CrmPipelineStage.pipeline_id == pipeline_id,
                        CrmPipelineStage.id != stage_id,
                        CrmPipelineStage.is_initial.is_(True),
                        CrmPipelineStage.deleted_at.is_(None),
                    )
                    other_cnt = (await self.session.execute(other_initial_stmt)).scalar_one()
                    if other_cnt == 0:
                        raise BadRequestException(
                            "Cannot remove initial stage status: an active or default pipeline must have an initial stage. "
                            "Designate another initial stage first."
                        )
                stage.is_initial = False

        # Active state update
        if data.is_active is not None:
            if data.is_active is False and stage.is_active:
                # Check if it has active leads
                leads_cnt_stmt = select(func.count(CrmLead.id)).where(
                    CrmLead.stage_id == stage_id,
                    CrmLead.deleted_at.is_(None),
                    CrmLead.status == "open",
                )
                leads_cnt = (await self.session.execute(leads_cnt_stmt)).scalar_one()
                if leads_cnt > 0:
                    raise BadRequestException(
                        f"Cannot deactivate stage because {leads_cnt} open CRM lead(s) are currently in this stage."
                    )

                # Check if it's the initial stage of an active/default pipeline
                if stage.is_initial and (pipeline.is_active or pipeline.is_default):
                    other_active_initial_stmt = select(func.count(CrmPipelineStage.id)).where(
                        CrmPipelineStage.pipeline_id == pipeline_id,
                        CrmPipelineStage.id != stage_id,
                        CrmPipelineStage.is_initial.is_(True),
                        CrmPipelineStage.is_active.is_(True),
                        CrmPipelineStage.deleted_at.is_(None),
                    )
                    other_active_cnt = (await self.session.execute(other_active_initial_stmt)).scalar_one()
                    if other_active_cnt == 0:
                        raise BadRequestException(
                            "Cannot deactivate the initial stage of an active pipeline. "
                            "Designate another active initial stage first or deactivate the pipeline."
                        )
                stage.is_active = False
            elif data.is_active is True and not stage.is_active:
                stage.is_active = True

        stage.updated_at = datetime.now(timezone.utc)
        try:
            await self.session.commit()
            await self.session.refresh(stage)
        except IntegrityError as exc:
            await self.session.rollback()
            logger.warning("IntegrityError during stage update: %s", exc)
            err_str = str(exc).lower()
            if "crm_pipeline_stage_name" in err_str or "key (pipeline_id, name)=" in err_str:
                raise ConflictException("A stage with this name already exists in this pipeline.") from exc
            if "crm_pipeline_stage_order" in err_str or "key (pipeline_id, stage_order)=" in err_str:
                raise BadRequestException("Stage order conflicts with an existing stage in this pipeline.") from exc
            raise ConflictException("Database constraint conflict during stage update.") from exc

        # Get lead count for response
        lead_cnt_stmt = select(func.count(CrmLead.id)).where(
            CrmLead.stage_id == stage_id,
            CrmLead.deleted_at.is_(None),
        )
        lead_cnt = (await self.session.execute(lead_cnt_stmt)).scalar_one()

        return CrmStageRead(
            id=stage.id,
            pipeline_id=stage.pipeline_id,
            name=stage.name,
            stage_order=stage.stage_order,
            stage_type=stage.stage_type,
            is_initial=stage.is_initial,
            is_active=stage.is_active,
            lead_count=lead_cnt,
            created_at=stage.created_at,
            updated_at=stage.updated_at,
        )

    async def toggle_active_stage(self, pipeline_id: uuid.UUID, stage_id: uuid.UUID) -> CrmStageRead:
        """Toggle stage active status subject to integrity rules."""
        stmt = (
            select(CrmPipelineStage)
            .where(
                CrmPipelineStage.id == stage_id,
                CrmPipelineStage.pipeline_id == pipeline_id,
                CrmPipelineStage.deleted_at.is_(None),
            )
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        stage = res.scalar_one_or_none()
        if not stage:
            raise NotFoundException("Pipeline stage not found.")

        target_active = not stage.is_active
        return await self.update_stage(pipeline_id, stage_id, CrmStageUpdate(is_active=target_active))

    async def delete_stage(self, pipeline_id: uuid.UUID, stage_id: uuid.UUID) -> None:
        """Safely soft-delete a stage if not referenced by leads or stage history."""
        stmt = (
            select(CrmPipelineStage)
            .where(
                CrmPipelineStage.id == stage_id,
                CrmPipelineStage.pipeline_id == pipeline_id,
                CrmPipelineStage.deleted_at.is_(None),
            )
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        stage = res.scalar_one_or_none()
        if not stage:
            raise NotFoundException("Pipeline stage not found.")

        pipeline = await self.get_pipeline_by_id(pipeline_id)

        # Check if leads exist in this stage
        leads_cnt_stmt = select(func.count(CrmLead.id)).where(
            CrmLead.stage_id == stage_id,
            CrmLead.deleted_at.is_(None),
        )
        leads_cnt = (await self.session.execute(leads_cnt_stmt)).scalar_one()
        if leads_cnt > 0:
            raise BadRequestException(
                f"Cannot delete stage because {leads_cnt} CRM lead(s) are currently assigned to it. "
                "Reassign the leads to another stage or deactivate the stage instead."
            )

        # Check if referenced in stage history
        history_cnt_stmt = select(func.count(CrmStageHistory.id)).where(
            (CrmStageHistory.from_stage_id == stage_id) | (CrmStageHistory.to_stage_id == stage_id)
        )
        history_cnt = (await self.session.execute(history_cnt_stmt)).scalar_one()
        if history_cnt > 0:
            raise BadRequestException(
                f"Cannot delete stage because it is referenced in {history_cnt} lead stage transition history record(s). "
                "Deactivate the stage instead to preserve audit history."
            )

        # Check if it's the initial stage of an active/default pipeline
        if stage.is_initial and (pipeline.is_active or pipeline.is_default):
            other_initial_stmt = select(func.count(CrmPipelineStage.id)).where(
                CrmPipelineStage.pipeline_id == pipeline_id,
                CrmPipelineStage.id != stage_id,
                CrmPipelineStage.is_initial.is_(True),
                CrmPipelineStage.is_active.is_(True),
                CrmPipelineStage.deleted_at.is_(None),
            )
            other_cnt = (await self.session.execute(other_initial_stmt)).scalar_one()
            if other_cnt == 0:
                raise BadRequestException(
                    "Cannot delete the initial stage of an active pipeline. "
                    "Designate another initial stage first or deactivate the pipeline."
                )

        # Soft delete with tombstoning to free unique constraints
        now = datetime.now(timezone.utc)
        stage.deleted_at = now
        stage.name = f"{stage.name}__deleted_{stage.id.hex[:8]}"
        stage.stage_order = -1000 - abs(stage.stage_order)
        await self.session.flush()

        # Re-compact remaining stage orders so they remain contiguous
        remaining_stages = (
            await self.session.execute(
                select(CrmPipelineStage)
                .where(
                    CrmPipelineStage.pipeline_id == pipeline_id,
                    CrmPipelineStage.deleted_at.is_(None),
                )
                .order_by(CrmPipelineStage.stage_order.asc())
            )
        ).scalars().all()

        for idx, s in enumerate(remaining_stages):
            s.stage_order = idx + 1

        await self.session.commit()

    async def reorder_stages(
        self, pipeline_id: uuid.UUID, data: CrmStageReorderRequest
    ) -> list[CrmStageRead]:
        """Atomically reorder stages in a pipeline without constraint violations."""
        await self.get_pipeline_by_id(pipeline_id)

        input_stage_ids = {item.id for item in data.stages}
        orders = [item.stage_order for item in data.stages]
        if len(orders) != len(set(orders)):
            raise BadRequestException("Stage orders in the reorder request must be unique.")

        # Fetch existing stages
        stmt = (
            select(CrmPipelineStage)
            .where(
                CrmPipelineStage.pipeline_id == pipeline_id,
                CrmPipelineStage.id.in_(input_stage_ids),
                CrmPipelineStage.deleted_at.is_(None),
            )
            .with_for_update()
        )
        existing_stages = (await self.session.execute(stmt)).scalars().all()
        if len(existing_stages) != len(input_stage_ids):
            raise BadRequestException("One or more stage IDs do not belong to this pipeline.")

        stage_map = {s.id: s for s in existing_stages}

        # Step 1: Shift existing stages to temporary high orders to avoid UniqueConstraint violations
        for s in existing_stages:
            s.stage_order = s.stage_order + 100000
        await self.session.flush()

        # Step 2: Assign final desired orders
        for item in data.stages:
            stage_map[item.id].stage_order = item.stage_order
            stage_map[item.id].updated_at = datetime.now(timezone.utc)

        await self.session.commit()

        # Fetch and return ordered stages
        detail = await self.get_pipeline_detail(pipeline_id)
        return detail.stages


# -----------------------------------------------------------------------------
# Salesperson Distribution Service
# -----------------------------------------------------------------------------


class CrmSalespersonDistributionService:
    """
    Service layer for CRM Salesperson Distribution configuration.

    Handles lead assignment eligibility, territory assignments, priority settings,
    and RBAC/department-scoping rules.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_actor_scope(self, actor: CurrentUser) -> set[uuid.UUID] | None:
        """
        Evaluate actor permissions and organizational placement.

        Returns:
            - None: Actor has company-wide admin authority (Admin, super_admin, wildcard '*').
            - set[uuid.UUID]: Actor is a department manager scoped to their team/department members.
        Raises:
            - ForbiddenException: Actor is a regular salesperson or has no managing authority.
        """
        # 1. Company-wide admin check
        if (
            actor.is_super_admin
            or actor.username == "admin"
            or "*" in actor.permissions
            or "super_admin" in actor.permissions
        ):
            return None

        # Check if actor has super_admin role in DB
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
        # Collect direct reports
        reports_stmt = select(User.id).where(User.manager_id == actor.id, User.deleted_at.is_(None))
        direct_reports = set((await self.session.execute(reports_stmt)).scalars().all())

        # Collect leadership assignment departments
        leadership_stmt = select(DepartmentLeadershipAssignment.department_id).where(
            DepartmentLeadershipAssignment.employee_id == actor.id,
            DepartmentLeadershipAssignment.status == OrgRecordStatus.ACTIVE,
        )
        led_dept_ids = set((await self.session.execute(leadership_stmt)).scalars().all())

        # Collect user's assigned roles
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
            raise ForbiddenException("You do not have permission to view or manage salesperson distribution.")

        # Resolve departments managed by this manager
        managed_dept_ids: set[uuid.UUID] = set(led_dept_ids)
        for r in roles:
            if r.name.lower() not in ("user", "super_admin", "admin", "department_manager", "employee"):
                managed_dept_ids.add(r.id)

        # Build scope of user IDs: direct reports + members of managed departments + self
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

    async def list_salespeople(
        self,
        *,
        actor: CurrentUser,
        search: str | None = None,
        department: str | None = None,
        is_eligible: bool | None = None,
        state_id: uuid.UUID | None = None,
    ) -> list[SalespersonDistributionItem]:
        """
        List users eligible to act as salesperson configuration subjects with distribution settings.
        Enforces manager department scoping.
        """
        allowed_scope = await self.get_actor_scope(actor)

        # 1. Fetch users
        users_stmt = select(User).where(User.deleted_at.is_(None))
        if allowed_scope is not None:
            users_stmt = users_stmt.where(User.id.in_(list(allowed_scope)))
        users_stmt = users_stmt.order_by(User.display_name.asc(), User.username.asc())
        users = list((await self.session.execute(users_stmt)).scalars().all())

        if not users:
            return []

        user_ids = [u.id for u in users]

        # 2. Fetch department mappings for these users
        dept_stmt = (
            select(UserRole.user_id, Role.name, UserRole.is_primary)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                UserRole.user_id.in_(user_ids),
                UserRole.status == RoleAssignmentStatus.ACTIVE,
                Role.deleted_at.is_(None),
            )
        )
        dept_rows = (await self.session.execute(dept_stmt)).all()
        user_dept_map: dict[uuid.UUID, str] = {}
        for uid, rname, is_pri in dept_rows:
            if uid not in user_dept_map or is_pri:
                # prioritize primary organizational department
                if rname.lower() not in ("user", "employee", "super_admin", "admin", "department_manager"):
                    user_dept_map[uid] = rname
                elif uid not in user_dept_map:
                    user_dept_map[uid] = rname

        # 3. Fetch salesperson configs and territories
        cfg_stmt = (
            select(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id.in_(user_ids))
            .options(
                selectinload(CrmSalespersonConfig.territories).selectinload(
                    CrmSalespersonTerritory.state
                )
            )
        )
        configs = list((await self.session.execute(cfg_stmt)).scalars().all())
        config_map: dict[uuid.UUID, CrmSalespersonConfig] = {c.user_id: c for c in configs}

        # 4. Fetch reliable active CRM lead counts and total assigned history
        lead_metrics_stmt = (
            select(
                CrmLead.assigned_to,
                func.count(CrmLead.id).label("total_assigned"),
                func.sum(
                    case((CrmLead.status.notin_(["won", "lost"]), 1), else_=0)
                ).label("active_count"),
                func.max(CrmLead.created_at).label("last_assigned"),
            )
            .where(
                CrmLead.assigned_to.in_(user_ids),
                CrmLead.deleted_at.is_(None),
            )
            .group_by(CrmLead.assigned_to)
        )

        lead_rows = (await self.session.execute(lead_metrics_stmt)).all()
        lead_metrics_map: dict[uuid.UUID, dict[str, Any]] = {
            r[0]: {
                "total_assigned": r[1] or 0,
                "active_count": r[2] or 0,
                "last_assigned": r[3],
            }
            for r in lead_rows
        }

        # 5. Assemble and filter
        results: list[SalespersonDistributionItem] = []
        search_lower = search.strip().lower() if search else None
        dept_lower = department.strip().lower() if department else None

        for u in users:
            dept_name = user_dept_map.get(u.id)
            cfg = config_map.get(u.id)

            # Territory list
            territories_read: list[SalespersonTerritoryRead] = []
            territory_state_ids: set[uuid.UUID] = set()
            if cfg and cfg.territories:
                for t in cfg.territories:
                    territory_state_ids.add(t.state_id)
                    s_name = t.state.name if t.state else "Unknown State"
                    s_code = t.state.code if t.state else None
                    territories_read.append(
                        SalespersonTerritoryRead(
                            id=t.id,
                            state_id=t.state_id,
                            state_name=s_name,
                            state_code=s_code,
                        )
                    )

            # Lead metrics
            metrics = lead_metrics_map.get(u.id, {})
            active_count = metrics.get("active_count", 0)
            total_count = metrics.get("total_assigned", 0)
            last_assigned = metrics.get("last_assigned")

            # Check eligibility & config flags
            item_is_eligible = cfg.is_eligible if cfg else False
            item_priority = cfg.priority if cfg else 1
            item_capacity = cfg.max_lead_capacity if cfg else None
            item_active_cfg = cfg.is_active if cfg else True
            item_notes = cfg.notes if cfg else None
            item_updated_at = cfg.updated_at if cfg else None

            # Filters:
            # Eligibility filter
            if is_eligible is not None and item_is_eligible != is_eligible:
                continue

            # State/territory filter
            if state_id is not None and state_id not in territory_state_ids:
                continue

            # Department filter
            if dept_lower:
                if not dept_name or dept_lower not in dept_name.lower():
                    continue

            # Search filter
            if search_lower:
                match_name = (u.display_name or "").lower()
                match_user = (u.username or "").lower()
                match_code = (u.employee_code or "").lower()
                match_email = (u.email or "").lower()
                if not (
                    search_lower in match_name
                    or search_lower in match_user
                    or search_lower in match_code
                    or search_lower in match_email
                ):
                    continue

            # Remaining capacity calculation
            rem_capacity = None
            if item_capacity is not None:
                rem_capacity = max(0, item_capacity - active_count)

            # Ineligibility reasons
            reasons: list[str] = []
            if not (u.is_active and u.deleted_at is None):
                reasons.append("User account is inactive or disabled")
            if u.status != UserStatus.ACTIVE:
                status_str = u.status.value if hasattr(u.status, "value") else str(u.status)
                reasons.append(f"Account status is {status_str}")
            if not u.has_login:
                reasons.append("User does not have ERP login credentials")
            if not item_active_cfg:
                reasons.append("Distribution configuration is paused")
            if not item_is_eligible:
                reasons.append("Distribution eligibility is disabled")
            if item_capacity is not None and active_count >= item_capacity:
                reasons.append(f"At capacity cap ({active_count}/{item_capacity})")

            results.append(
                SalespersonDistributionItem(
                    user_id=u.id,
                    username=u.username or "",
                    display_name=u.display_name or u.full_name,
                    employee_code=u.employee_code,
                    email=u.email,
                    is_active_user=bool(u.is_active and u.deleted_at is None),
                    user_status=u.status.value if hasattr(u.status, "value") else str(u.status),
                    department=dept_name,
                    is_eligible=item_is_eligible,
                    priority=item_priority,
                    max_lead_capacity=item_capacity,
                    is_active_config=item_active_cfg,
                    notes=item_notes,
                    territories=territories_read,
                    active_lead_count=active_count,
                    total_assigned_lead_count=total_count,
                    remaining_capacity=rem_capacity,
                    ineligibility_reasons=reasons,
                    last_assigned_at=last_assigned,
                    updated_at=item_updated_at,
                )
            )

        # Sort: eligible first, then by priority (ascending 1..100), then name
        results.sort(key=lambda x: (not x.is_eligible, x.priority, (x.display_name or "").lower()))
        return results

    async def get_salesperson(
        self,
        user_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> SalespersonDistributionItem:
        """Fetch distribution configuration and metrics for a single salesperson."""
        allowed_scope = await self.get_actor_scope(actor)
        if allowed_scope is not None and user_id not in allowed_scope:
            raise ForbiddenException("Cannot access salesperson distribution outside your authorized department/team scope.")

        user = await self.session.get(User, user_id)
        if not user or user.deleted_at is not None:
            raise NotFoundException("User not found.")

        items = await self.list_salespeople(actor=actor)
        for item in items:
            if item.user_id == user_id:
                return item

        raise NotFoundException("Salesperson record not found in accessible scope.")

    async def update_salesperson(
        self,
        user_id: uuid.UUID,
        payload: SalespersonDistributionUpdate,
        *,
        actor: CurrentUser,
    ) -> SalespersonDistributionItem:
        """
        Update an individual salesperson's distribution settings.
        Validates user status, territory existence, and manager scope.
        """
        allowed_scope = await self.get_actor_scope(actor)
        if allowed_scope is not None and user_id not in allowed_scope:
            raise ForbiddenException("Cannot configure salesperson outside your authorized department/team scope.")

        user = await self.session.get(User, user_id)
        if not user or user.deleted_at is not None:
            raise NotFoundException("User not found.")

        # Inactive or ineligible check
        if payload.is_eligible is True:
            if (
                not user.is_active
                or user.deleted_at is not None
                or user.status != UserStatus.ACTIVE
                or not user.has_login
            ):
                raise BadRequestException("Inactive or ineligible ERP user accounts cannot be enabled for lead assignment.")

        # Territory validation
        deduped_state_ids: list[uuid.UUID] | None = None
        if payload.territory_state_ids is not None:
            seen: set[uuid.UUID] = set()
            deduped_state_ids = []
            for sid in payload.territory_state_ids:
                if sid not in seen:
                    seen.add(sid)
                    deduped_state_ids.append(sid)

            if deduped_state_ids:
                states_stmt = select(State.id).where(
                    State.id.in_(deduped_state_ids),
                    State.deleted_at.is_(None),
                    State.status == RecordStatus.ACTIVE,
                )
                valid_state_ids = set((await self.session.execute(states_stmt)).scalars().all())
                if len(valid_state_ids) != len(deduped_state_ids):
                    raise BadRequestException("One or more selected territories (states) do not exist or are inactive.")

        # Upsert CrmSalespersonConfig
        cfg_stmt = (
            select(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id == user_id)
            .with_for_update()
        )
        config = (await self.session.execute(cfg_stmt)).scalar_one_or_none()

        if config is None:
            config = CrmSalespersonConfig(
                user_id=user_id,
                is_eligible=payload.is_eligible if payload.is_eligible is not None else False,
                priority=payload.priority if payload.priority is not None else 1,
                max_lead_capacity=payload.max_lead_capacity,
                is_active=payload.is_active if payload.is_active is not None else True,
                notes=payload.notes,
            )
            self.session.add(config)
            await self.session.flush()
        else:
            if payload.is_eligible is not None:
                config.is_eligible = payload.is_eligible
            if payload.priority is not None:
                config.priority = payload.priority
            if payload.max_lead_capacity is not None:
                config.max_lead_capacity = payload.max_lead_capacity
            if payload.is_active is not None:
                config.is_active = payload.is_active
            if payload.notes is not None:
                config.notes = payload.notes
            config.updated_at = datetime.now(timezone.utc)
            await self.session.flush()

        # Update territories
        if deduped_state_ids is not None:
            del_stmt = delete(CrmSalespersonTerritory).where(
                CrmSalespersonTerritory.salesperson_config_id == config.id
            )
            await self.session.execute(del_stmt)
            for sid in deduped_state_ids:
                terr = CrmSalespersonTerritory(
                    salesperson_config_id=config.id,
                    state_id=sid,
                )
                self.session.add(terr)
            await self.session.flush()

        await self.session.commit()
        return await self.get_salesperson(user_id, actor=actor)

    async def bulk_update_eligibility(
        self,
        payload: SalespersonBulkEligibilityUpdate,
        *,
        actor: CurrentUser,
    ) -> int:
        """Bulk update assignment eligibility for multiple users with confirmation."""
        allowed_scope = await self.get_actor_scope(actor)
        for uid in payload.user_ids:
            if allowed_scope is not None and uid not in allowed_scope:
                raise ForbiddenException("Cannot configure salespeople outside your authorized department/team scope.")

        users_stmt = select(User).where(User.id.in_(payload.user_ids), User.deleted_at.is_(None))
        users = list((await self.session.execute(users_stmt)).scalars().all())

        if len(users) != len(payload.user_ids):
            raise NotFoundException("One or more user IDs were not found.")

        if payload.is_eligible:
            for u in users:
                if (
                    not u.is_active
                    or u.deleted_at is not None
                    or u.status != UserStatus.ACTIVE
                    or not u.has_login
                ):
                    raise BadRequestException(f"User {u.username} is inactive or ineligible and cannot be enabled.")

        for uid in payload.user_ids:
            cfg = (
                await self.session.execute(
                    select(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id == uid)
                )
            ).scalar_one_or_none()
            if cfg is None:
                cfg = CrmSalespersonConfig(user_id=uid, is_eligible=payload.is_eligible)
                self.session.add(cfg)
            else:
                cfg.is_eligible = payload.is_eligible
                cfg.updated_at = datetime.now(timezone.utc)

        await self.session.commit()
        return len(payload.user_ids)
