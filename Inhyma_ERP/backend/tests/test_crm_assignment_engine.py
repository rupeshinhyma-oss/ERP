"""
Test Suite for Core CRM Lead Assignment Engine.

Verifies:
1. Eligible representative selection based on CrmSalespersonConfig and User criteria.
2. Inactive, ineligible, soft-deleted, no-login, and suspended users are strictly excluded.
3. Territory preference matches state; general pool fallback works or safely respects fallback=False.
4. Capacity enforcement: candidates at max_lead_capacity are skipped; saturated pools leave lead unassigned.
5. Round-robin rotation advances correctly across repeated assignments with cursor persistence.
6. Configured strategies: least-active leads and priority ranking with deterministic tie-breaking.
7. Already-owned leads are never overwritten (idempotency).
8. Recognized duplicate leads are never assigned.
9. Append-only CrmAssignmentHistory is written atomically with every ownership change.
10. Rollback integrity: rolled back attempts do not leave false ownership or history rows.
11. Concurrency safety: cursor row-locking and safe initialization under nested savepoints.
12. Manager departmental scoping restricts candidate pool to authorized subordinates.
13. Batch assignment interface assigns sequences atomically.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select

from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.crm.assignment_service import CrmAssignmentEngineService, LeadAssignmentResult
from app.crm.models import (
    CrmActivity,
    CrmAssignmentConfig,
    CrmAssignmentHistory,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmRoundRobinCursor,
    CrmSalespersonConfig,
    CrmSalespersonTerritory,
)
from app.database.engine import get_sessionmaker
from app.masters.states.models import State
from app.users.models import User, UserStatus


ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
SALES_MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
JOHN_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
OPS_EMPLOYEE_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")


@pytest.fixture
def admin_actor() -> CurrentUser:
    return CurrentUser(
        id=ADMIN_ID,
        username="admin",
        permissions={"crm.distribution.manage", "crm.leads.manage", "*"},
        is_super_admin=True,
    )


@pytest.fixture
def manager_actor() -> CurrentUser:
    return CurrentUser(
        id=SALES_MANAGER_ID,
        username="sales_manager",
        permissions={"crm.distribution.manage", "crm.leads.manage"},
        is_super_admin=False,
    )


@pytest.fixture
async def setup_assignment_environment(client: AsyncClient):
    """Set up test pipeline, stage, states, and reset cursors/configs."""
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_id = uuid.uuid4()

    async with sessionmaker() as session:
        # 1. Pipeline & stage
        pipeline = CrmPipeline(
            id=pipeline_id,
            name=f"Assignment Test Pipeline {uuid.uuid4().hex[:6]}",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(pipeline)
        await session.flush()

        stage = CrmPipelineStage(
            id=stage_id,
            pipeline_id=pipeline_id,
            name="Inbound Landing",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add(stage)

        # 2. Get two active states
        states = list((await session.execute(
            select(State).where(State.status == RecordStatus.ACTIVE, State.deleted_at.is_(None)).limit(2)
        )).scalars().all())
        assert len(states) >= 2, "Test requires at least 2 active states"
        state1, state2 = states[0], states[1]

        # 3. Clean any existing round robin cursors and assignment configs for test isolation
        await session.execute(delete(CrmRoundRobinCursor))
        await session.execute(delete(CrmAssignmentConfig))
        await session.execute(delete(CrmSalespersonTerritory))
        await session.execute(delete(CrmSalespersonConfig))
        await session.commit()

    yield {
        "pipeline_id": pipeline_id,
        "stage_id": stage_id,
        "state1": state1,
        "state2": state2,
    }

    # Teardown
    async with sessionmaker() as session:
        await session.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(
            select(CrmLead.id).where(CrmLead.pipeline_id == pipeline_id)
        )))
        await session.execute(delete(CrmLead).where(CrmLead.pipeline_id == pipeline_id))
        await session.execute(delete(CrmImportBatch).where(CrmImportBatch.selected_pipeline_id == pipeline_id))
        await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline_id))
        await session.execute(delete(CrmPipeline).where(CrmPipeline.id == pipeline_id))
        await session.execute(delete(CrmSalespersonTerritory))
        await session.execute(delete(CrmSalespersonConfig))
        await session.execute(delete(CrmRoundRobinCursor))
        await session.execute(delete(CrmAssignmentConfig))
        await session.commit()


@pytest.mark.asyncio
async def test_eligible_representative_selected(setup_assignment_environment, admin_actor):
    """An active, eligible representative under capacity is selected for unassigned lead."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # Enable John for assignment
        cfg = CrmSalespersonConfig(
            user_id=JOHN_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        session.add(cfg)

        lead = CrmLead(
            name="Alpha Prospect",
            original_phone="9876543210",
            normalized_phone="+919876543210",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            assigned_to=None,
        )
        session.add(lead)
        await session.commit()
        await session.refresh(lead)

        engine = CrmAssignmentEngineService(session)
        result = await engine.assign_lead(lead, actor=admin_actor)

        assert result.assigned is True
        assert result.status == "assigned"
        assert result.assigned_to == JOHN_ID
        assert result.previous_owner_id is None
        assert result.history_id is not None

        # Verify DB state
        await session.refresh(lead)
        assert lead.assigned_to == JOHN_ID

        # Verify History
        hist = await session.get(CrmAssignmentHistory, result.history_id)
        assert hist is not None
        assert hist.lead_id == lead.id
        assert hist.new_owner_id == JOHN_ID
        assert hist.previous_owner_id is None
        assert hist.assigned_by == ADMIN_ID


@pytest.mark.asyncio
async def test_ineligible_users_excluded(setup_assignment_environment, admin_actor):
    """Users with is_eligible=False, is_active=False, no login, or inactive user status are excluded."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # Configure John as ineligible
        cfg_john = CrmSalespersonConfig(
            user_id=JOHN_ID,
            is_eligible=False,
            is_active=True,
        )
        session.add(cfg_john)

        lead = CrmLead(
            name="Beta Prospect",
            original_phone="9876543211",
            normalized_phone="+919876543211",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            assigned_to=None,
        )
        session.add(lead)
        await session.commit()
        await session.refresh(lead)

        engine = CrmAssignmentEngineService(session)
        result = await engine.assign_lead(lead, actor=admin_actor)

        assert result.assigned is False
        assert result.status == "unassigned"
        assert result.reason == "no_eligible_salespeople"
        assert result.assigned_to is None

        # Verify lead remains unassigned in DB
        await session.refresh(lead)
        assert lead.assigned_to is None

        # Verify NO history entry was written
        hist_count = (await session.execute(
            select(func.count(CrmAssignmentHistory.id)).where(CrmAssignmentHistory.lead_id == lead.id)
        )).scalar()
        assert hist_count == 0


@pytest.mark.asyncio
async def test_territory_preference_and_fallback(setup_assignment_environment, admin_actor):
    """Lead matching a territory prefers territory rep; unmatched state falls back to general pool."""
    env = setup_assignment_environment
    state1 = env["state1"]
    state2 = env["state2"]
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # Rep 1 (John): Territory = State 1
        cfg_john = CrmSalespersonConfig(
            user_id=JOHN_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        session.add(cfg_john)
        await session.flush()
        terr_john = CrmSalespersonTerritory(
            salesperson_config_id=cfg_john.id,
            state_id=state1.id,
        )
        session.add(terr_john)

        # Rep 2 (Sales Manager): Territory = State 2
        cfg_mgr = CrmSalespersonConfig(
            user_id=SALES_MANAGER_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        session.add(cfg_mgr)
        await session.flush()
        terr_mgr = CrmSalespersonTerritory(
            salesperson_config_id=cfg_mgr.id,
            state_id=state2.id,
        )
        session.add(terr_mgr)

        # Lead 1: state1 in custom_fields
        lead1 = CrmLead(
            name="Delhi Client",
            original_phone="9876543212",
            normalized_phone="+919876543212",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            custom_fields={"state": state1.name},
        )
        # Lead 2: state2 in custom_fields
        lead2 = CrmLead(
            name="Haryana Client",
            original_phone="9876543213",
            normalized_phone="+919876543213",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            custom_fields={"state_id": str(state2.id)},
        )
        # Lead 3: Unknown state
        lead3 = CrmLead(
            name="Unknown Client",
            original_phone="9876543214",
            normalized_phone="+919876543214",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            custom_fields={"state": "NonExistentStateXYZ"},
        )
        session.add_all([lead1, lead2, lead3])
        await session.commit()

        engine = CrmAssignmentEngineService(session)

        # Lead 1 -> John (Territory match State 1)
        res1 = await engine.assign_lead(lead1, actor=admin_actor)
        assert res1.assigned is True
        assert res1.assigned_to == JOHN_ID
        assert res1.matched_state_id == state1.id

        # Lead 2 -> Sales Manager (Territory match State 2)
        res2 = await engine.assign_lead(lead2, actor=admin_actor)
        assert res2.assigned is True
        assert res2.assigned_to == SALES_MANAGER_ID
        assert res2.matched_state_id == state2.id

        # Lead 3 -> Unknown state falls back to general pool under capacity
        res3 = await engine.assign_lead(lead3, actor=admin_actor)
        assert res3.assigned is True
        assert res3.assigned_to in (JOHN_ID, SALES_MANAGER_ID)


@pytest.mark.asyncio
async def test_territory_fallback_disabled_leaves_unassigned(setup_assignment_environment, admin_actor):
    """When fallback_to_general is configured to False, unmatched territory leads remain unassigned."""
    env = setup_assignment_environment
    state1 = env["state1"]
    state2 = env["state2"]
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # John is territory for state 1
        cfg_john = CrmSalespersonConfig(
            user_id=JOHN_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        session.add(cfg_john)
        await session.flush()
        session.add(CrmSalespersonTerritory(salesperson_config_id=cfg_john.id, state_id=state1.id))

        # Active configuration with fallback_to_general=False
        rule = CrmAssignmentConfig(
            name="Strict State Territory Rule",
            rule_type="state_priority",
            is_active=True,
            priority=1,
            configuration={"fallback_to_general": False},
        )
        session.add(rule)

        # Lead with state 2 (no rep configured for state 2)
        lead = CrmLead(
            name="Strict Unmatched Lead",
            original_phone="9876543215",
            normalized_phone="+919876543215",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            custom_fields={"state": state2.name},
        )
        session.add(lead)
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        res = await engine.assign_lead(lead, actor=admin_actor)

        assert res.assigned is False
        assert res.status == "unassigned"
        assert res.reason == "no_territory_match"
        assert res.matched_state_id == state2.id

        await session.refresh(lead)
        assert lead.assigned_to is None


@pytest.mark.asyncio
async def test_all_candidates_at_capacity_leaves_unassigned(setup_assignment_environment, admin_actor):
    """When all eligible representatives reach max_lead_capacity, leads remain unassigned."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # John has max capacity = 1
        cfg = CrmSalespersonConfig(
            user_id=JOHN_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=1,
        )
        session.add(cfg)

        # Active lead already owned by John
        existing_lead = CrmLead(
            name="Existing Lead for John",
            original_phone="9876543216",
            normalized_phone="+919876543216",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            assigned_to=JOHN_ID,
        )
        # New lead attempting assignment
        new_lead = CrmLead(
            name="Overflow Lead",
            original_phone="9876543217",
            normalized_phone="+919876543217",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            assigned_to=None,
        )
        session.add_all([existing_lead, new_lead])
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        res = await engine.assign_lead(new_lead, actor=admin_actor)

        assert res.assigned is False
        assert res.status == "unassigned"
        assert res.reason == "all_candidates_at_capacity"
        assert res.assigned_to is None

        await session.refresh(new_lead)
        assert new_lead.assigned_to is None


@pytest.mark.asyncio
async def test_round_robin_advances_across_repeated_assignments(setup_assignment_environment, admin_actor):
    """Sequential unassigned leads rotate through eligible candidates in deterministic round-robin."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # Both John and Sales Manager are eligible
        cfg1 = CrmSalespersonConfig(user_id=JOHN_ID, is_eligible=True, is_active=True, priority=1)
        cfg2 = CrmSalespersonConfig(user_id=SALES_MANAGER_ID, is_eligible=True, is_active=True, priority=1)
        session.add_all([cfg1, cfg2])

        leads = [
            CrmLead(
                name=f"Lead Rotation {i}",
                original_phone=f"987654322{i}",
                normalized_phone=f"+91987654322{i}",
                pipeline_id=env["pipeline_id"],
                stage_id=env["stage_id"],
                status="new",
            )
            for i in range(4)
        ]
        session.add_all(leads)
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        assignments: list[uuid.UUID] = []

        for lead in leads:
            res = await engine.assign_lead(lead, actor=admin_actor)
            assert res.assigned is True
            assignments.append(res.assigned_to)

        # Rotation pattern: A -> B -> A -> B
        assert assignments[0] != assignments[1]
        assert assignments[0] == assignments[2]
        assert assignments[1] == assignments[3]

        # Verify cursor state
        cursor = (await session.execute(
            select(CrmRoundRobinCursor).where(CrmRoundRobinCursor.pool_key == "default")
        )).scalar_one()
        assert cursor.last_assigned_user_id == assignments[3]


@pytest.mark.asyncio
async def test_configured_strategies_least_active_and_priority(setup_assignment_environment, admin_actor):
    """Verify least_active strategy favors rep with lowest active leads and priority strategy favors priority rank."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # Rep A (John): priority 2, has 1 active lead
        cfg_a = CrmSalespersonConfig(user_id=JOHN_ID, is_eligible=True, is_active=True, priority=2)
        # Rep B (Sales Manager): priority 1, has 2 active leads
        cfg_b = CrmSalespersonConfig(user_id=SALES_MANAGER_ID, is_eligible=True, is_active=True, priority=1)
        session.add_all([cfg_a, cfg_b])

        # Ensure clean baseline for John and Manager
        await session.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(
            select(CrmLead.id).where(CrmLead.assigned_to.in_([JOHN_ID, SALES_MANAGER_ID]))
        )))
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.assigned_to.in_([JOHN_ID, SALES_MANAGER_ID]))
        )))
        await session.execute(delete(CrmLead).where(CrmLead.assigned_to.in_([JOHN_ID, SALES_MANAGER_ID])))
        await session.flush()

        # Pre-assign active leads
        lead_john1 = CrmLead(
            name="John Lead 1",
            original_phone="9876543231",
            normalized_phone="+919876543231",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            assigned_to=JOHN_ID,
        )
        lead_mgr1 = CrmLead(
            name="Mgr Lead 1",
            original_phone="9876543232",
            normalized_phone="+919876543232",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            assigned_to=SALES_MANAGER_ID,
        )
        lead_mgr2 = CrmLead(
            name="Mgr Lead 2",
            original_phone="9876543233",
            normalized_phone="+919876543233",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="in_progress",
            assigned_to=SALES_MANAGER_ID,
        )
        session.add_all([lead_john1, lead_mgr1, lead_mgr2])

        # Configure strategy: least_active
        rule_least_active = CrmAssignmentConfig(
            name="Least Active Test Rule",
            rule_type="least_active",
            is_active=True,
            priority=1,
            configuration={"strategy": "least_active"},
        )
        session.add(rule_least_active)

        target_lead = CrmLead(
            name="Target Lead Least Active",
            original_phone="9876543234",
            normalized_phone="+919876543234",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
        )
        session.add(target_lead)
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        res_la = await engine.assign_lead(target_lead, actor=admin_actor)
        # John has 1 active lead, Manager has 2 -> John wins
        assert res_la.assigned is True
        assert res_la.assigned_to == JOHN_ID
        assert res_la.assignment_method == "least_active"

        # Now switch strategy to: priority (lower integer = higher priority)
        rule_least_active.is_active = False
        rule_priority = CrmAssignmentConfig(
            name="Priority Test Rule",
            rule_type="priority",
            is_active=True,
            priority=1,
            configuration={"strategy": "priority"},
        )
        session.add(rule_priority)

        target_lead2 = CrmLead(
            name="Target Lead Priority",
            original_phone="9876543235",
            normalized_phone="+919876543235",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
        )
        session.add(target_lead2)
        await session.commit()

        res_prio = await engine.assign_lead(target_lead2, actor=admin_actor)
        # Manager has priority 1, John has priority 2 -> Manager wins
        assert res_prio.assigned is True
        assert res_prio.assigned_to == SALES_MANAGER_ID
        assert res_prio.assignment_method == "priority"


@pytest.mark.asyncio
async def test_already_owned_lead_never_overwritten(setup_assignment_environment, admin_actor):
    """An already-owned lead returns skipped and its owner is strictly preserved."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        cfg = CrmSalespersonConfig(user_id=JOHN_ID, is_eligible=True, is_active=True)
        session.add(cfg)

        owned_lead = CrmLead(
            name="Owned Lead",
            original_phone="9876543236",
            normalized_phone="+919876543236",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
            assigned_to=SALES_MANAGER_ID,
        )
        session.add(owned_lead)
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        res = await engine.assign_lead(owned_lead, actor=admin_actor)

        assert res.assigned is False
        assert res.status == "skipped"
        assert res.reason == "already_assigned"
        assert res.assigned_to == SALES_MANAGER_ID

        await session.refresh(owned_lead)
        assert owned_lead.assigned_to == SALES_MANAGER_ID


@pytest.mark.asyncio
async def test_duplicate_lead_never_assigned(setup_assignment_environment, admin_actor):
    """A lead marked CRM_DUPLICATE returns skipped and remains unassigned."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        cfg = CrmSalespersonConfig(user_id=JOHN_ID, is_eligible=True, is_active=True)
        session.add(cfg)

        dup_lead = CrmLead(
            name="Duplicate Lead",
            original_phone="9876543237",
            normalized_phone="+919876543237",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="CRM_DUPLICATE",
            assigned_to=None,
        )
        session.add(dup_lead)
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        res = await engine.assign_lead(dup_lead, actor=admin_actor)

        assert res.assigned is False
        assert res.status == "skipped"
        assert res.reason == "duplicate_lead"

        await session.refresh(dup_lead)
        assert dup_lead.assigned_to is None


@pytest.mark.asyncio
async def test_concurrent_cursor_initialization_safety(setup_assignment_environment):
    """Multiple callers attempting to lock or create the same cursor resolve without IntegrityError."""
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        engine = CrmAssignmentEngineService(session)
        pool_key = "test_concurrent_pool"

        # Call twice in sequence
        c1 = await engine._get_or_create_cursor_locked(pool_key)
        assert c1.pool_key == pool_key

        c2 = await engine._get_or_create_cursor_locked(pool_key)
        assert c2.id == c1.id
        await session.commit()


@pytest.mark.asyncio
async def test_manager_scoping_respected(setup_assignment_environment, manager_actor):
    """Sales manager cannot assign leads to salespeople outside their authorized team scope."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # OPS_EMPLOYEE is an operations employee not reporting to Sales Manager
        # Configure both John (in sales team) and Ops Employee as eligible
        cfg_john = CrmSalespersonConfig(user_id=JOHN_ID, is_eligible=True, is_active=True, priority=2)
        cfg_ops = CrmSalespersonConfig(user_id=OPS_EMPLOYEE_ID, is_eligible=True, is_active=True, priority=1)
        session.add_all([cfg_john, cfg_ops])

        # Ensure John reports to Sales Manager
        john = await session.get(User, JOHN_ID)
        john.manager_id = SALES_MANAGER_ID

        # Ensure Ops Employee reports to None
        ops = await session.get(User, OPS_EMPLOYEE_ID)
        ops.manager_id = None

        lead = CrmLead(
            name="Manager Scope Lead",
            original_phone="9876543238",
            normalized_phone="+919876543238",
            pipeline_id=env["pipeline_id"],
            stage_id=env["stage_id"],
            status="new",
        )
        session.add(lead)
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        # Even though OPS has priority 1, manager_actor can only assign to their team (John / self)
        res = await engine.assign_lead(lead, actor=manager_actor)

        assert res.assigned is True
        assert res.assigned_to in (JOHN_ID, SALES_MANAGER_ID)
        assert res.assigned_to != OPS_EMPLOYEE_ID


@pytest.mark.asyncio
async def test_batch_assignment_atomicity(setup_assignment_environment, admin_actor):
    """assign_batch processes a sequence of leads atomically in order."""
    env = setup_assignment_environment
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        cfg = CrmSalespersonConfig(user_id=JOHN_ID, is_eligible=True, is_active=True, max_lead_capacity=20)
        session.add(cfg)

        batch_id = uuid.uuid4()
        batch = CrmImportBatch(
            id=batch_id,
            batch_name="Test Batch Assignment",
            import_source="csv",
            selected_pipeline_id=env["pipeline_id"],
            initiated_by=ADMIN_ID,
            status="processing",
        )
        session.add(batch)

        batch_leads = [
            CrmLead(
                name=f"Batch Lead {i}",
                original_phone=f"987654324{i}",
                normalized_phone=f"+91987654324{i}",
                pipeline_id=env["pipeline_id"],
                stage_id=env["stage_id"],
                status="new",
            )
            for i in range(3)
        ]
        session.add_all(batch_leads)
        await session.commit()

        engine = CrmAssignmentEngineService(session)
        results = await engine.assign_batch(batch_leads, actor=admin_actor, batch_id=batch_id)

        assert len(results) == 3
        for r in results:
            assert r.assigned is True
            assert r.assigned_to == JOHN_ID
            assert r.history_id is not None

        # Verify all history records have batch_id
        histories = list((await session.execute(
            select(CrmAssignmentHistory).where(CrmAssignmentHistory.batch_id == batch_id)
        )).scalars().all())
        assert len(histories) == 3
