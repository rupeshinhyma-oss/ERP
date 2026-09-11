"""Reporting Repository -- pure DB access, no business rules (Phase 7)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.reporting.models import (
    GlobalBuyerProjection,
    GlobalInquiryProjection,
    GlobalProductProjection,
    GlobalSupplierProjection,
    ProjectionCheckpoint,
    ReportExportJob,
)


class GlobalBuyerProjectionRepository:
    """Data access for the `global_buyer_projections` table."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, projection_id: uuid.UUID) -> GlobalBuyerProjection | None:
        result = await self.db.execute(
            select(GlobalBuyerProjection).where(GlobalBuyerProjection.id == projection_id)
        )
        return result.scalar_one_or_none()

    async def get_by_source(
        self, source_erp_id: uuid.UUID, source_entity_type: str, source_entity_id: uuid.UUID
    ) -> GlobalBuyerProjection | None:
        result = await self.db.execute(
            select(GlobalBuyerProjection).where(
                GlobalBuyerProjection.source_erp_id == source_erp_id,
                GlobalBuyerProjection.source_entity_type == source_entity_type,
                GlobalBuyerProjection.source_entity_id == source_entity_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert(self, projection: GlobalBuyerProjection) -> GlobalBuyerProjection:
        self.db.add(projection)
        await self.db.flush()
        await self.db.refresh(projection)
        return projection

    async def search(
        self,
        *,
        allowed_erp_ids: list[uuid.UUID],
        query: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalBuyerProjection], int]:
        if not allowed_erp_ids:
            return [], 0

        base_query = select(GlobalBuyerProjection).where(GlobalBuyerProjection.source_erp_id.in_(allowed_erp_ids))
        count_query = (
            select(func.count())
            .select_from(GlobalBuyerProjection)
            .where(GlobalBuyerProjection.source_erp_id.in_(allowed_erp_ids))
        )

        if query:
            like_pattern = f"%{query}%"
            base_query = base_query.where(GlobalBuyerProjection.company_name.ilike(like_pattern))
            count_query = count_query.where(GlobalBuyerProjection.company_name.ilike(like_pattern))
        if status:
            base_query = base_query.where(GlobalBuyerProjection.status == status)
            count_query = count_query.where(GlobalBuyerProjection.status == status)

        total = (await self.db.execute(count_query)).scalar_one()
        result = await self.db.execute(
            base_query.order_by(GlobalBuyerProjection.company_name.asc()).limit(limit).offset(offset)
        )
        return list(result.scalars().all()), total

    async def count_for_erp(self, erp_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count())
            .select_from(GlobalBuyerProjection)
            .where(GlobalBuyerProjection.source_erp_id == erp_id)
        )
        return result.scalar_one()

    async def list_all_for_reconciliation(self, erp_id: uuid.UUID) -> list[GlobalBuyerProjection]:
        result = await self.db.execute(
            select(GlobalBuyerProjection).where(GlobalBuyerProjection.source_erp_id == erp_id)
        )
        return list(result.scalars().all())


class GlobalSupplierProjectionRepository:
    """Data access for the `global_supplier_projections` table."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, projection_id: uuid.UUID) -> GlobalSupplierProjection | None:
        result = await self.db.execute(
            select(GlobalSupplierProjection).where(GlobalSupplierProjection.id == projection_id)
        )
        return result.scalar_one_or_none()

    async def get_by_source(
        self, source_erp_id: uuid.UUID, source_entity_type: str, source_entity_id: uuid.UUID
    ) -> GlobalSupplierProjection | None:
        result = await self.db.execute(
            select(GlobalSupplierProjection).where(
                GlobalSupplierProjection.source_erp_id == source_erp_id,
                GlobalSupplierProjection.source_entity_type == source_entity_type,
                GlobalSupplierProjection.source_entity_id == source_entity_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert(self, projection: GlobalSupplierProjection) -> GlobalSupplierProjection:
        self.db.add(projection)
        await self.db.flush()
        await self.db.refresh(projection)
        return projection

    async def search(
        self,
        *,
        allowed_erp_ids: list[uuid.UUID],
        query: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalSupplierProjection], int]:
        if not allowed_erp_ids:
            return [], 0

        base_query = select(GlobalSupplierProjection).where(GlobalSupplierProjection.source_erp_id.in_(allowed_erp_ids))
        count_query = (
            select(func.count())
            .select_from(GlobalSupplierProjection)
            .where(GlobalSupplierProjection.source_erp_id.in_(allowed_erp_ids))
        )

        if query:
            like_pattern = f"%{query}%"
            name_cond = GlobalSupplierProjection.name.ilike(like_pattern)
            code_cond = GlobalSupplierProjection.supplier_code.ilike(like_pattern)
            base_query = base_query.where(or_(name_cond, code_cond))
            count_query = count_query.where(or_(name_cond, code_cond))
        if status:
            base_query = base_query.where(GlobalSupplierProjection.status == status)
            count_query = count_query.where(GlobalSupplierProjection.status == status)

        total = (await self.db.execute(count_query)).scalar_one()
        result = await self.db.execute(
            base_query.order_by(GlobalSupplierProjection.name.asc()).limit(limit).offset(offset)
        )
        return list(result.scalars().all()), total

    async def count_for_erp(self, erp_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count())
            .select_from(GlobalSupplierProjection)
            .where(GlobalSupplierProjection.source_erp_id == erp_id)
        )
        return result.scalar_one()

    async def list_all_for_reconciliation(self, erp_id: uuid.UUID) -> list[GlobalSupplierProjection]:
        result = await self.db.execute(
            select(GlobalSupplierProjection).where(GlobalSupplierProjection.source_erp_id == erp_id)
        )
        return list(result.scalars().all())


class GlobalProductProjectionRepository:
    """Data access for the `global_product_projections` table."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, projection_id: uuid.UUID) -> GlobalProductProjection | None:
        result = await self.db.execute(
            select(GlobalProductProjection).where(GlobalProductProjection.id == projection_id)
        )
        return result.scalar_one_or_none()

    async def get_by_source(
        self, source_erp_id: uuid.UUID, source_entity_type: str, source_entity_id: uuid.UUID
    ) -> GlobalProductProjection | None:
        result = await self.db.execute(
            select(GlobalProductProjection).where(
                GlobalProductProjection.source_erp_id == source_erp_id,
                GlobalProductProjection.source_entity_type == source_entity_type,
                GlobalProductProjection.source_entity_id == source_entity_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert(self, projection: GlobalProductProjection) -> GlobalProductProjection:
        self.db.add(projection)
        await self.db.flush()
        await self.db.refresh(projection)
        return projection

    async def search(
        self,
        *,
        allowed_erp_ids: list[uuid.UUID],
        query: str | None = None,
        category: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalProductProjection], int]:
        if not allowed_erp_ids:
            return [], 0

        base_query = select(GlobalProductProjection).where(GlobalProductProjection.source_erp_id.in_(allowed_erp_ids))
        count_query = (
            select(func.count())
            .select_from(GlobalProductProjection)
            .where(GlobalProductProjection.source_erp_id.in_(allowed_erp_ids))
        )

        if query:
            like_pattern = f"%{query}%"
            name_cond = GlobalProductProjection.name.ilike(like_pattern)
            code_cond = GlobalProductProjection.product_code.ilike(like_pattern)
            base_query = base_query.where(or_(name_cond, code_cond))
            count_query = count_query.where(or_(name_cond, code_cond))
        if category:
            base_query = base_query.where(GlobalProductProjection.category == category)
            count_query = count_query.where(GlobalProductProjection.category == category)

        total = (await self.db.execute(count_query)).scalar_one()
        result = await self.db.execute(
            base_query.order_by(GlobalProductProjection.name.asc()).limit(limit).offset(offset)
        )
        return list(result.scalars().all()), total

    async def count_for_erp(self, erp_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count())
            .select_from(GlobalProductProjection)
            .where(GlobalProductProjection.source_erp_id == erp_id)
        )
        return result.scalar_one()

    async def list_all_for_reconciliation(self, erp_id: uuid.UUID) -> list[GlobalProductProjection]:
        result = await self.db.execute(
            select(GlobalProductProjection).where(GlobalProductProjection.source_erp_id == erp_id)
        )
        return list(result.scalars().all())


class GlobalInquiryProjectionRepository:
    """Data access for the `global_inquiry_projections` table."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, projection_id: uuid.UUID) -> GlobalInquiryProjection | None:
        result = await self.db.execute(
            select(GlobalInquiryProjection).where(GlobalInquiryProjection.id == projection_id)
        )
        return result.scalar_one_or_none()

    async def get_by_source(
        self, source_erp_id: uuid.UUID, source_entity_type: str, source_entity_id: uuid.UUID
    ) -> GlobalInquiryProjection | None:
        result = await self.db.execute(
            select(GlobalInquiryProjection).where(
                GlobalInquiryProjection.source_erp_id == source_erp_id,
                GlobalInquiryProjection.source_entity_type == source_entity_type,
                GlobalInquiryProjection.source_entity_id == source_entity_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert(self, projection: GlobalInquiryProjection) -> GlobalInquiryProjection:
        self.db.add(projection)
        await self.db.flush()
        await self.db.refresh(projection)
        return projection

    async def search(
        self,
        *,
        allowed_erp_ids: list[uuid.UUID],
        query: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GlobalInquiryProjection], int]:
        if not allowed_erp_ids:
            return [], 0

        base_query = select(GlobalInquiryProjection).where(GlobalInquiryProjection.source_erp_id.in_(allowed_erp_ids))
        count_query = (
            select(func.count())
            .select_from(GlobalInquiryProjection)
            .where(GlobalInquiryProjection.source_erp_id.in_(allowed_erp_ids))
        )

        if query:
            like_pattern = f"%{query}%"
            num_cond = GlobalInquiryProjection.inquiry_number.ilike(like_pattern)
            buyer_cond = GlobalInquiryProjection.buyer_name.ilike(like_pattern)
            base_query = base_query.where(or_(num_cond, buyer_cond))
            count_query = count_query.where(or_(num_cond, buyer_cond))
        if status:
            base_query = base_query.where(GlobalInquiryProjection.status == status)
            count_query = count_query.where(GlobalInquiryProjection.status == status)

        total = (await self.db.execute(count_query)).scalar_one()
        result = await self.db.execute(
            base_query.order_by(GlobalInquiryProjection.inquiry_number.asc()).limit(limit).offset(offset)
        )
        return list(result.scalars().all()), total

    async def count_for_erp(self, erp_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count())
            .select_from(GlobalInquiryProjection)
            .where(GlobalInquiryProjection.source_erp_id == erp_id)
        )
        return result.scalar_one()

    async def list_all_for_reconciliation(self, erp_id: uuid.UUID) -> list[GlobalInquiryProjection]:
        result = await self.db.execute(
            select(GlobalInquiryProjection).where(GlobalInquiryProjection.source_erp_id == erp_id)
        )
        return list(result.scalars().all())


class ProjectionCheckpointRepository:
    """Data access for the `projection_checkpoints` table."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_type(self, projection_type: str) -> ProjectionCheckpoint | None:
        result = await self.db.execute(
            select(ProjectionCheckpoint).where(ProjectionCheckpoint.projection_type == projection_type)
        )
        return result.scalar_one_or_none()

    async def list_all(self) -> list[ProjectionCheckpoint]:
        result = await self.db.execute(select(ProjectionCheckpoint))
        return list(result.scalars().all())

    async def upsert(self, checkpoint: ProjectionCheckpoint) -> ProjectionCheckpoint:
        self.db.add(checkpoint)
        await self.db.flush()
        await self.db.refresh(checkpoint)
        return checkpoint


class ReportExportJobRepository:
    """Data access for the `report_export_jobs` table."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, job_id: uuid.UUID) -> ReportExportJob | None:
        result = await self.db.execute(select(ReportExportJob).where(ReportExportJob.id == job_id))
        return result.scalar_one_or_none()

    async def get_by_download_token(self, token: str) -> ReportExportJob | None:
        result = await self.db.execute(select(ReportExportJob).where(ReportExportJob.download_token == token))
        return result.scalar_one_or_none()

    async def list_for_user(self, requested_by: uuid.UUID, *, limit: int = 50) -> list[ReportExportJob]:
        result = await self.db.execute(
            select(ReportExportJob)
            .where(ReportExportJob.requested_by == requested_by)
            .order_by(ReportExportJob.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def create(self, job: ReportExportJob) -> ReportExportJob:
        self.db.add(job)
        await self.db.flush()
        await self.db.refresh(job)
        return job

    async def update(self, job: ReportExportJob) -> ReportExportJob:
        self.db.add(job)
        await self.db.flush()
        await self.db.refresh(job)
        return job

    async def list_expired(self, now: datetime) -> list[ReportExportJob]:
        result = await self.db.execute(
            select(ReportExportJob).where(
                ReportExportJob.expires_at <= now,
                ReportExportJob.file_path.isnot(None),
            )
        )
        return list(result.scalars().all())
