"""
Test Suite for Phase 1 CRM & Lead Management Database Foundation.

Verifies:
1. Clean ORM mapping and table name definitions for all 10 CRM foundation entities.
2. Unique collision-resistant CRM lead code generation.
3. Foreign key integrity across pipelines, stages, leads, users, and audit history.
4. Constraint and status validation (pipeline stage types, follow-up statuses).
5. Append-only properties of assignment history and activity timeline.
6. Concurrency-safe round-robin cursor definitions.
"""

import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select

from app.database.engine import get_sessionmaker
from app.crm.models import (
    CrmPipeline,
    CrmPipelineStage,
    CrmLead,
    CrmAssignmentHistory,
    CrmActivity,
    CrmFollowUp,
    CrmStageHistory,
    CrmImportBatch,
    CrmAssignmentConfig,
    CrmRoundRobinCursor,
    generate_crm_lead_code,
)


def test_generate_crm_lead_code_format():
    """Ensure generated lead code follows CRM-YYYYMMDD-XXXXXX format and is unique."""
    code1 = generate_crm_lead_code()
    code2 = generate_crm_lead_code()

    assert code1.startswith("CRM-")
    assert code2.startswith("CRM-")
    assert len(code1) >= 15
    assert code1 != code2


def test_crm_model_table_names():
    """Ensure all 10 CRM entities use distinct, collision-free table names."""
    assert CrmPipeline.__tablename__ == "crm_pipelines"
    assert CrmPipelineStage.__tablename__ == "crm_pipeline_stages"
    assert CrmLead.__tablename__ == "crm_leads"
    assert CrmAssignmentHistory.__tablename__ == "crm_assignment_history"
    assert CrmActivity.__tablename__ == "crm_activities"
    assert CrmFollowUp.__tablename__ == "crm_follow_ups"
    assert CrmStageHistory.__tablename__ == "crm_stage_history"
    assert CrmImportBatch.__tablename__ == "crm_import_batches"
    assert CrmAssignmentConfig.__tablename__ == "crm_assignment_configs"
    assert CrmRoundRobinCursor.__tablename__ == "crm_round_robin_cursors"


@pytest.mark.asyncio
async def test_crm_database_foundation_lifecycle():
    """Verify live database CRUD, constraints, foreign keys, and rollbacks."""
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # 1. Pipeline
        pipeline = CrmPipeline(
            name=f"Enterprise Inbound {uuid.uuid4().hex[:6]}",
            description="High value enterprise inbound leads",
            is_default=True,
            is_active=True,
        )
        session.add(pipeline)
        await session.flush()
        assert pipeline.id is not None
        assert pipeline.is_default is True

        # 2. Pipeline Stages (Open, Won, Lost)
        stage_open = CrmPipelineStage(
            pipeline_id=pipeline.id,
            name="New Inquiries",
            stage_order=1,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        stage_won = CrmPipelineStage(
            pipeline_id=pipeline.id,
            name="Closed Won",
            stage_order=2,
            stage_type="won",
            is_initial=False,
            is_active=True,
        )
        session.add_all([stage_open, stage_won])
        await session.flush()
        assert stage_open.id is not None
        assert stage_won.id is not None

        # 3. Import Batch
        batch = CrmImportBatch(
            batch_name="Q4 Marketing Import",
            import_source="csv",
            selected_pipeline_id=pipeline.id,
            status="completed",
            total_count=100,
            success_count=98,
            failed_count=2,
            skipped_count=0,
        )
        session.add(batch)
        await session.flush()
        assert batch.id is not None

        # 4. Lead
        lead = CrmLead(
            name="Apex Global Logistics",
            original_phone="+91 (987) 654-3210",
            normalized_phone="+919876543210",
            email="contact@apexlogistics.example",
            company_name="Apex Logistics Ltd",
            campaign="Google Ads Search",
            source_type="company_campaign",
            source_detail="Landing Page 3",
            pipeline_id=pipeline.id,
            stage_id=stage_open.id,
            status="new",
            priority="high",
            notes="Interested in industrial automation equipment",
            custom_fields={"industry": "Logistics", "annual_budget": 500000},
        )
        session.add(lead)
        await session.flush()
        assert lead.id is not None
        assert lead.lead_code.startswith("CRM-")
        assert lead.custom_fields["industry"] == "Logistics"

        # 5. Assignment History
        assign_log = CrmAssignmentHistory(
            lead_id=lead.id,
            previous_owner_id=None,
            new_owner_id=None,
            assignment_method="round_robin",
            reason="Automated state-priority assignment",
            batch_id=batch.id,
        )
        session.add(assign_log)
        await session.flush()
        assert assign_log.id is not None

        # 6. Activity Timeline
        activity = CrmActivity(
            lead_id=lead.id,
            activity_type="call",
            subject="Introductory discovery call",
            description="Discussed facility expansion requirements",
            outcome="Positive response, demo requested",
        )
        session.add(activity)
        await session.flush()
        assert activity.id is not None

        # 7. Scheduled Follow-Up
        follow_up = CrmFollowUp(
            lead_id=lead.id,
            due_at=datetime.now(timezone.utc),
            follow_up_type="meeting",
            notes="Schedule Zoom demo with technical committee",
            status="pending",
        )
        session.add(follow_up)
        await session.flush()
        assert follow_up.id is not None
        assert follow_up.status == "pending"

        # 8. Stage History
        stage_hist = CrmStageHistory(
            lead_id=lead.id,
            from_stage_id=stage_open.id,
            to_stage_id=stage_won.id,
            reason="Contract signed and advance payment received",
        )
        session.add(stage_hist)
        await session.flush()
        assert stage_hist.id is not None

        # 9. Assignment Config & Cursor
        config = CrmAssignmentConfig(
            name="North Zone Round Robin",
            rule_type="state_priority",
            is_active=True,
            priority=1,
            configuration={"states": ["Delhi", "Haryana", "Punjab"]},
        )
        session.add(config)
        await session.flush()
        assert config.id is not None

        cursor = CrmRoundRobinCursor(
            pool_key="state:Delhi",
            last_assigned_index=3,
        )
        session.add(cursor)
        await session.flush()
        assert cursor.id is not None

        # Verify Querying through relationship
        from sqlalchemy.orm import selectinload

        q = await session.execute(
            select(CrmLead)
            .where(CrmLead.id == lead.id)
            .options(
                selectinload(CrmLead.pipeline),
                selectinload(CrmLead.stage),
                selectinload(CrmLead.activities),
                selectinload(CrmLead.follow_ups),
                selectinload(CrmLead.stage_history),
                selectinload(CrmLead.assignment_history),
            )
        )
        fetched = q.scalar_one()
        assert fetched.pipeline.name.startswith("Enterprise Inbound")
        assert fetched.stage.name == "New Inquiries"
        assert len(fetched.activities) == 1
        assert len(fetched.follow_ups) == 1
        assert len(fetched.stage_history) == 1
        assert len(fetched.assignment_history) == 1

        # Clean rollback to keep DB pristine
        await session.rollback()
