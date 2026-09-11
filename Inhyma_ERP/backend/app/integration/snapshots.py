"""
Snapshot & Resumable Synchronization Service (Phase 8E & Phase 8F).

Provides resumable, batched snapshot export and ingestion with cursor-based
checkpointing (SnapshotJob) and OCC version race protection.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.buyers.models import Buyer
from app.core.config import settings
from app.core.logging import get_logger
from app.integration.models import SnapshotJob
from app.integration.sync_engine import GenericSyncEngine

logger = get_logger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SnapshotService:
    """Handles entity snapshot generation and bulk ingestion with cursor checkpointing."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def start_snapshot_job(
        self,
        entity_type: str,
        target_erp: str,
        batch_size: int = 100,
    ) -> SnapshotJob:
        """Initialize a tracked, resumable snapshot export job."""
        norm_type = entity_type.strip().lower()
        if norm_type == "buyer":
            count_stmt = select(func.count(Buyer.id)).where(Buyer.deleted_at.is_(None))
            total_count = (await self.db.execute(count_stmt)).scalar_one()
        else:
            raise ValueError(f"Snapshot not supported for entity type '{entity_type}'.")

        job = SnapshotJob(
            id=uuid.uuid4(),
            entity_type=norm_type,
            source_erp=settings.ERP_KEY,
            target_erp=target_erp.lower().strip(),
            cursor_offset=0,
            batch_size=batch_size,
            total_records=total_count,
            records_processed=0,
            records_failed=0,
            status="IN_PROGRESS",
        )
        self.db.add(job)
        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def get_snapshot_job(self, job_id: uuid.UUID) -> SnapshotJob | None:
        """Fetch a snapshot job by its ID."""
        stmt = select(SnapshotJob).where(SnapshotJob.id == job_id)
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def export_snapshot_chunk(self, job_id: uuid.UUID) -> dict[str, Any]:
        """
        Export the next chunk for job_id, advancing the checkpoint cursor.
        """
        job = await self.get_snapshot_job(job_id)
        if job is None:
            raise ValueError(f"Snapshot job '{job_id}' not found.")

        if job.status == "COMPLETED":
            return {
                "job_id": str(job.id),
                "entity_type": job.entity_type,
                "cursor_offset": job.cursor_offset,
                "total_records": job.total_records,
                "records": [],
                "is_complete": True,
                "status": job.status,
            }

        norm_type = job.entity_type.lower()
        if norm_type == "buyer":
            query = (
                select(Buyer)
                .where(Buyer.deleted_at.is_(None))
                .order_by(Buyer.created_at.asc())
                .limit(job.batch_size)
                .offset(job.cursor_offset)
            )
            rows = (await self.db.execute(query)).scalars().all()

            records = [
                {
                    "entity_id": str(b.id),
                    "version": getattr(b, "version", 1),
                    "company_name": b.company_name,
                    "city": b.city,
                    "address": b.address,
                    "tax_id_number": b.tax_id_number,
                    "website": b.website,
                    "is_active": b.is_active,
                    "created_at": b.created_at.isoformat() if b.created_at else None,
                    "updated_at": b.updated_at.isoformat() if b.updated_at else None,
                }
                for b in rows
            ]
        else:
            raise ValueError(f"Export not supported for entity type '{job.entity_type}'.")

        fetched_count = len(records)
        job.cursor_offset += fetched_count
        job.records_processed += fetched_count

        if job.cursor_offset >= job.total_records or fetched_count == 0:
            job.status = "COMPLETED"
            job.completed_at = _utcnow()

        await self.db.commit()
        await self.db.refresh(job)

        return {
            "job_id": str(job.id),
            "entity_type": job.entity_type,
            "cursor_offset": job.cursor_offset,
            "total_records": job.total_records,
            "records": records,
            "is_complete": job.status == "COMPLETED",
            "status": job.status,
        }

    async def ingest_snapshot(
        self, engine: GenericSyncEngine, snapshot_payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Ingest a batch snapshot through the generic synchronization engine."""
        source_erp = snapshot_payload.get("source_erp", "")
        entity_type = snapshot_payload.get("entity_type", "")
        records = snapshot_payload.get("records", [])

        if not source_erp or not entity_type:
            raise ValueError("Invalid snapshot payload: missing source_erp or entity_type.")

        processed = 0
        skipped = 0
        conflicts = 0

        for record in records:
            entity_id = record.get("entity_id") or record.get("id")
            if not entity_id:
                continue

            envelope = {
                "event_id": str(uuid.uuid4()),
                "event_type": f"{entity_type}.created",
                "event_version": 1,
                "occurred_at": _utcnow().isoformat(),
                "source_erp": source_erp,
                "entity_type": entity_type,
                "source_entity_id": str(entity_id),
                "entity_version": record.get("version", 1),
                "payload": record,
            }

            try:
                result = await engine.process_event(self.db, envelope)
                if result.status == "PROCESSED":
                    processed += 1
                elif result.status == "CONFLICT_RECORDED":
                    conflicts += 1
                else:
                    skipped += 1
            except Exception as exc:
                logger.warning("Error ingesting snapshot record %s: %s", entity_id, exc)
                skipped += 1

        await self.db.commit()

        return {
            "entity_type": entity_type,
            "source_erp": source_erp,
            "total_records": len(records),
            "processed": processed,
            "skipped": skipped,
            "conflicts": conflicts,
        }

    async def export_snapshot(
        self, entity_type: str, limit: int = 100, offset: int = 0
    ) -> dict[str, Any]:
        """Backward-compatible one-shot snapshot export."""
        norm_type = entity_type.strip().lower()
        if norm_type == "buyer":
            count_stmt = select(func.count(Buyer.id)).where(Buyer.deleted_at.is_(None))
            total_count = (await self.db.execute(count_stmt)).scalar_one()

            query = (
                select(Buyer)
                .where(Buyer.deleted_at.is_(None))
                .order_by(Buyer.created_at.asc())
                .limit(limit)
                .offset(offset)
            )
            rows = (await self.db.execute(query)).scalars().all()

            records = [
                {
                    "entity_id": str(b.id),
                    "version": getattr(b, "version", 1),
                    "company_name": b.company_name,
                    "city": b.city,
                    "address": b.address,
                    "tax_id_number": b.tax_id_number,
                    "website": b.website,
                    "is_active": b.is_active,
                    "created_at": b.created_at.isoformat() if b.created_at else None,
                    "updated_at": b.updated_at.isoformat() if b.updated_at else None,
                }
                for b in rows
            ]
        else:
            raise ValueError(f"Snapshot export not implemented for entity type '{entity_type}'.")

        return {
            "source_erp": settings.ERP_KEY,
            "entity_type": norm_type,
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "records": records,
            "exported_at": _utcnow().isoformat(),
        }
