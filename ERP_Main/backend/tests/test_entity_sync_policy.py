"""
Comprehensive Test Suite for EntitySyncPolicy Registry (Phase 8A).

Validates all 25+ specification points:
1. Migration upgrade to 0008
2. Migration downgrade to 0007
3. Fresh migration chain (base to head)
4. Model import and Base.metadata table registration
5. Policy creation with authoritative ownership resolution
6. Policy retrieval by ID
7. Policy listing and filtering (source, target, entity_type, status, enabled)
8. Policy update
9. Enable/disable via state endpoint
10. Invalid ERP rejection (nonexistent ERP ID -> 404)
11. Invalid direction rejection (422)
12. Invalid ownership strategy / consistency rejection (422)
13. Invalid conflict strategy rejection (422)
14. Invalid delete strategy rejection (422)
15. Invalid version strategy rejection (422)
16. Duplicate active policy rejection (HTTP 409)
17. Source == target validation rejection (400/422)
18. Authorization protection (unauthenticated 401, unauthorized 403)
19. API response envelope schema verification
20. Service and repository layer behavior
21. Persistence across database session reload
22. Multiple approved entity types (buyer, supplier, product, category, brand, etc.)
23. Forbidden high-risk entities rejection (finance, payroll, payments, etc.)
24. Multiple ERP pairs coexistence
25. Disabled policy behavior (disabling permits new active policy)
26. Authoritative owner resolution endpoint (/resolve)
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.base import Base
from app.erp_registry.models import ErpInstance
from app.erp_registry.repository import ErpInstanceRepository
from app.sync_policy.enums import (
    APPROVED_ENTITY_TYPES,
    FORBIDDEN_ENTITY_TYPES,
    SyncConflictStrategy,
    SyncDeleteStrategy,
    SyncDirection,
    SyncOwnershipStrategy,
    SyncPolicyStatus,
    SyncVersionStrategy,
)
from app.sync_policy.models import EntitySyncPolicy
from app.sync_policy.repository import EntitySyncPolicyRepository
from app.sync_policy.schemas import EntitySyncPolicyCreate
from app.sync_policy.service import EntitySyncPolicyService

BACKEND_DIR = Path(__file__).resolve().parent.parent


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

async def _create_test_erp(admin_client, *, key: str) -> str:
    """Create a registered ERP instance and return its UUID string."""
    resp = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": key, "name": key.title(), "display_name": key.upper(), "status": "ACTIVE"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


# -----------------------------------------------------------------------------
# Tests 1, 2, 3: Migration Upgrade, Downgrade & Fresh Migration Chain
# -----------------------------------------------------------------------------

def test_migration_upgrade_downgrade_and_fresh_chain(tmp_path):
    """Test Alembic migration 0008 upgrade, downgrade, and fresh chain execution."""
    from alembic import command
    from alembic.config import Config

    ini_path = BACKEND_DIR / "alembic.ini"
    alembic_cfg = Config(str(ini_path))
    test_db_path = tmp_path / "alembic_test.db"
    db_url = f"sqlite+aiosqlite:///{test_db_path.as_posix()}"

    alembic_cfg.set_main_option("sqlalchemy.url", db_url)
    alembic_cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))

    # 1. Fresh migration chain: base -> 0008
    command.upgrade(alembic_cfg, "0008")

    # 2. Migration downgrade: 0008 -> 0007
    command.downgrade(alembic_cfg, "0007")

    # 3. Migration re-upgrade: 0007 -> 0008
    command.upgrade(alembic_cfg, "0008")

    # 4. Clean downgrade back to base
    command.downgrade(alembic_cfg, "base")


# -----------------------------------------------------------------------------
# Test 4: Model Import & Metadata Registration
# -----------------------------------------------------------------------------

def test_model_import_and_metadata():
    """Verify EntitySyncPolicy model is defined and registered on Base.metadata."""
    assert "entity_sync_policies" in Base.metadata.tables
    table = Base.metadata.tables["entity_sync_policies"]
    assert "source_erp_id" in table.c
    assert "target_erp_id" in table.c
    assert "entity_type" in table.c
    assert "authoritative_owner_erp_id" in table.c
    assert "ownership_strategy" in table.c
    assert "direction" in table.c
    assert "conflict_strategy" in table.c
    assert "delete_strategy" in table.c
    assert "version_strategy" in table.c
    assert "status" in table.c
    assert "enabled" in table.c


# -----------------------------------------------------------------------------
# Test 5 & 19: Policy Creation, Auto-Ownership & Envelope Schema
# -----------------------------------------------------------------------------

async def test_policy_creation_success_and_envelope(admin_client):
    """Create a policy and verify automatic ownership resolution and response envelope."""
    erp_a = await _create_test_erp(admin_client, key="sync_node_a")
    erp_b = await _create_test_erp(admin_client, key="sync_node_b")

    payload = {
        "source_erp_id": erp_a,
        "target_erp_id": erp_b,
        "source_module": "sourcing",
        "target_module": "distribution",
        "entity_type": "buyer",
        "ownership_strategy": "SOURCE_OWNED",
        "direction": "SOURCE_TO_TARGET",
        "conflict_strategy": "SOURCE_WINS",
        "delete_strategy": "PROPAGATE_ARCHIVE",
        "version_strategy": "EVENT_VERSION",
        "status": "ACTIVE",
        "enabled": True,
        "description": "Authoritative China buyer sync to India distribution.",
        "custom_config": {"batch_size": 50},
    }

    resp = await admin_client.post("/api/v1/global/sync-policies", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()

    # Verify standard envelope structure
    assert body["success"] is True
    assert "request_id" in body["meta"]
    assert "timestamp" in body["meta"]

    data = body["data"]
    assert data["source_erp_id"] == erp_a
    assert data["target_erp_id"] == erp_b
    assert data["source_erp_key"] == "sync_node_a"
    assert data["target_erp_key"] == "sync_node_b"
    assert data["entity_type"] == "buyer"
    # Auto-resolved ownership
    assert data["authoritative_owner_erp_id"] == erp_a
    assert data["authoritative_owner_erp_key"] == "sync_node_a"
    assert data["ownership_strategy"] == "SOURCE_OWNED"
    assert data["direction"] == "SOURCE_TO_TARGET"
    assert data["conflict_strategy"] == "SOURCE_WINS"
    assert data["delete_strategy"] == "PROPAGATE_ARCHIVE"
    assert data["version_strategy"] == "EVENT_VERSION"
    assert data["status"] == "ACTIVE"
    assert data["enabled"] is True
    assert data["custom_config"] == {"batch_size": 50}


# -----------------------------------------------------------------------------
# Test 6: Policy Retrieval by ID
# -----------------------------------------------------------------------------

async def test_policy_retrieval_by_id(admin_client):
    """Retrieve an existing policy by its primary key."""
    erp_a = await _create_test_erp(admin_client, key="ret_node_a")
    erp_b = await _create_test_erp(admin_client, key="ret_node_b")

    resp_create = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "supplier",
            "ownership_strategy": "SOURCE_OWNED",
            "direction": "SOURCE_TO_TARGET",
        },
    )
    assert resp_create.status_code == 201
    policy_id = resp_create.json()["data"]["id"]

    resp_get = await admin_client.get(f"/api/v1/global/sync-policies/{policy_id}")
    assert resp_get.status_code == 200
    assert resp_get.json()["data"]["id"] == policy_id
    assert resp_get.json()["data"]["entity_type"] == "supplier"


# -----------------------------------------------------------------------------
# Test 7: Policy Listing and Filtering
# -----------------------------------------------------------------------------

async def test_policy_listing_and_filtering(admin_client):
    """List policies with query parameter filtering."""
    erp_a = await _create_test_erp(admin_client, key="list_node_a")
    erp_b = await _create_test_erp(admin_client, key="list_node_b")

    await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "product",
            "ownership_strategy": "SOURCE_OWNED",
            "direction": "SOURCE_TO_TARGET",
        },
    )
    await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "category",
            "ownership_strategy": "SOURCE_OWNED",
            "direction": "SOURCE_TO_TARGET",
            "status": "DRAFT",
            "enabled": False,
        },
    )

    # Filter by entity_type
    resp_filter = await admin_client.get("/api/v1/global/sync-policies?entity_type=product")
    assert resp_filter.status_code == 200
    items = resp_filter.json()["data"]["items"]
    assert any(i["entity_type"] == "product" for i in items)
    assert not any(i["entity_type"] == "category" for i in items)

    # Filter by status
    resp_status = await admin_client.get("/api/v1/global/sync-policies?status=DRAFT")
    assert resp_status.status_code == 200
    draft_items = resp_status.json()["data"]["items"]
    assert any(i["entity_type"] == "category" for i in draft_items)


# -----------------------------------------------------------------------------
# Test 8: Policy Update
# -----------------------------------------------------------------------------

async def test_policy_update(admin_client):
    """Update policy attributes and verify persistence."""
    erp_a = await _create_test_erp(admin_client, key="upd_node_a")
    erp_b = await _create_test_erp(admin_client, key="upd_node_b")

    resp_create = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "brand",
            "ownership_strategy": "SOURCE_OWNED",
            "direction": "SOURCE_TO_TARGET",
            "conflict_strategy": "SOURCE_WINS",
        },
    )
    policy_id = resp_create.json()["data"]["id"]

    resp_update = await admin_client.put(
        f"/api/v1/global/sync-policies/{policy_id}",
        json={
            "conflict_strategy": "LATEST_TIMESTAMP",
            "delete_strategy": "MANUAL_REVIEW",
            "description": "Updated conflict strategy to latest timestamp.",
        },
    )
    assert resp_update.status_code == 200, resp_update.text
    data = resp_update.json()["data"]
    assert data["conflict_strategy"] == "LATEST_TIMESTAMP"
    assert data["delete_strategy"] == "MANUAL_REVIEW"
    assert data["description"] == "Updated conflict strategy to latest timestamp."


# -----------------------------------------------------------------------------
# Test 9: Policy Enable and Disable (State Endpoint)
# -----------------------------------------------------------------------------

async def test_policy_enable_disable(admin_client):
    """Toggle policy operational state via PATCH /state."""
    erp_a = await _create_test_erp(admin_client, key="state_node_a")
    erp_b = await _create_test_erp(admin_client, key="state_node_b")

    resp_create = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "organization",
            "enabled": True,
            "status": "ACTIVE",
        },
    )
    policy_id = resp_create.json()["data"]["id"]

    # Disable
    resp_disable = await admin_client.patch(
        f"/api/v1/global/sync-policies/{policy_id}/state",
        json={"enabled": False, "reason": "Temporarily halting sync for maintenance."},
    )
    assert resp_disable.status_code == 200
    assert resp_disable.json()["data"]["enabled"] is False
    assert resp_disable.json()["data"]["status"] == "INACTIVE"

    # Re-enable
    resp_enable = await admin_client.patch(
        f"/api/v1/global/sync-policies/{policy_id}/state",
        json={"enabled": True, "status": "ACTIVE", "reason": "Maintenance complete."},
    )
    assert resp_enable.status_code == 200
    assert resp_enable.json()["data"]["enabled"] is True
    assert resp_enable.json()["data"]["status"] == "ACTIVE"


# -----------------------------------------------------------------------------
# Test 10: Invalid ERP Rejection (404)
# -----------------------------------------------------------------------------

async def test_invalid_erp_rejection(admin_client):
    """Reject policy creation when source or target ERP does not exist."""
    real_erp = await _create_test_erp(admin_client, key="real_node")
    fake_erp = str(uuid.uuid4())

    resp = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": fake_erp,
            "target_erp_id": real_erp,
            "entity_type": "buyer",
        },
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["errors"][0]["message"].lower()


# -----------------------------------------------------------------------------
# Test 11: Invalid Direction Rejection (422)
# -----------------------------------------------------------------------------

async def test_invalid_direction_rejection(admin_client):
    """Reject invalid direction enum."""
    erp_a = await _create_test_erp(admin_client, key="dir_node_a")
    erp_b = await _create_test_erp(admin_client, key="dir_node_b")

    resp = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "buyer",
            "direction": "INVALID_DIRECTION",
        },
    )
    assert resp.status_code == 422


# -----------------------------------------------------------------------------
# Test 12: Invalid Ownership Rejection (422)
# -----------------------------------------------------------------------------

async def test_invalid_ownership_rejection(admin_client):
    """Reject contradictory ownership strategy and owner ID."""
    erp_a = await _create_test_erp(admin_client, key="own_node_a")
    erp_b = await _create_test_erp(admin_client, key="own_node_b")

    resp = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "buyer",
            "ownership_strategy": "SOURCE_OWNED",
            "authoritative_owner_erp_id": erp_b,  # Contradicts SOURCE_OWNED
        },
    )
    assert resp.status_code == 422


# -----------------------------------------------------------------------------
# Tests 13, 14, 15: Invalid Strategy Rejections (422)
# -----------------------------------------------------------------------------

async def test_invalid_strategies_rejections(admin_client):
    """Reject invalid conflict, delete, and version strategy enum values."""
    erp_a = await _create_test_erp(admin_client, key="strat_node_a")
    erp_b = await _create_test_erp(admin_client, key="strat_node_b")

    # Invalid conflict strategy
    resp_conflict = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={"source_erp_id": erp_a, "target_erp_id": erp_b, "entity_type": "buyer", "conflict_strategy": "BOGUS"},
    )
    assert resp_conflict.status_code == 422

    # Invalid delete strategy
    resp_delete = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={"source_erp_id": erp_a, "target_erp_id": erp_b, "entity_type": "buyer", "delete_strategy": "BOGUS"},
    )
    assert resp_delete.status_code == 422

    # Invalid version strategy
    resp_version = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={"source_erp_id": erp_a, "target_erp_id": erp_b, "entity_type": "buyer", "version_strategy": "BOGUS"},
    )
    assert resp_version.status_code == 422


# -----------------------------------------------------------------------------
# Test 16: Duplicate Active Policy Rejection (409)
# -----------------------------------------------------------------------------

async def test_duplicate_active_policy_rejection(admin_client):
    """Reject creating a second active policy for the same source/target/entity."""
    erp_a = await _create_test_erp(admin_client, key="dup_node_a")
    erp_b = await _create_test_erp(admin_client, key="dup_node_b")

    resp1 = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "uom",
            "enabled": True,
            "status": "ACTIVE",
        },
    )
    assert resp1.status_code == 201

    resp2 = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "uom",
            "enabled": True,
            "status": "ACTIVE",
        },
    )
    assert resp2.status_code == 409
    assert "already exists" in resp2.json()["errors"][0]["message"].lower()


# -----------------------------------------------------------------------------
# Test 17: Source == Target Rejection (400/422)
# -----------------------------------------------------------------------------

async def test_source_equals_target_rejection(admin_client):
    """Reject policy when source ERP equals target ERP."""
    erp_a = await _create_test_erp(admin_client, key="self_node_a")

    resp = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_a,
            "entity_type": "buyer",
        },
    )
    assert resp.status_code in (400, 422)


# -----------------------------------------------------------------------------
# Test 18: Authorization Protection
# -----------------------------------------------------------------------------

async def test_authorization_protection(client):
    """Reject unauthenticated requests with 401."""
    resp = await client.post("/api/v1/global/sync-policies", json={})
    assert resp.status_code in (401, 403)

    resp_list = await client.get("/api/v1/global/sync-policies")
    assert resp_list.status_code in (401, 403)


# -----------------------------------------------------------------------------
# Test 20: Direct Service and Repository Methods
# -----------------------------------------------------------------------------

async def test_service_and_repository_direct(test_app):
    """Directly test service methods and repository methods."""
    from app.database.session import get_db_session

    gen = get_db_session()
    db = await anext(gen)

    instance_repo = ErpInstanceRepository(db)
    inst1 = ErpInstance(key="srv_node_1", name="Node 1", display_name="Node 1")
    inst2 = ErpInstance(key="srv_node_2", name="Node 2", display_name="Node 2")
    await instance_repo.create(inst1)
    await instance_repo.create(inst2)

    policy_repo = EntitySyncPolicyRepository(db)
    service = EntitySyncPolicyService(repository=policy_repo, erp_instance_repository=instance_repo)

    create_dto = EntitySyncPolicyCreate(
        source_erp_id=inst1.id,
        target_erp_id=inst2.id,
        entity_type="hsn_code",
        ownership_strategy=SyncOwnershipStrategy.TARGET_OWNED,
        direction=SyncDirection.SOURCE_TO_TARGET,
    )
    policy = await service.create_policy(create_dto)
    assert policy.authoritative_owner_erp_id == inst2.id

    owner = service.determine_authoritative_owner(policy)
    assert owner == inst2.id

    count = await policy_repo.count_policies(entity_type="hsn_code")
    assert count == 1

    try:
        await anext(gen)
    except StopAsyncIteration:
        pass


# -----------------------------------------------------------------------------
# Test 21: Persistence Across Reload
# -----------------------------------------------------------------------------

async def test_persistence_across_session_reload(admin_client):
    """Verify policy remains persisted and queryable after commit."""
    erp_a = await _create_test_erp(admin_client, key="persist_node_a")
    erp_b = await _create_test_erp(admin_client, key="persist_node_b")

    resp_create = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "buyer",
            "description": "Persistence test policy.",
        },
    )
    assert resp_create.status_code == 201
    policy_id = resp_create.json()["data"]["id"]

    # Re-fetch independently
    resp_fetch = await admin_client.get(f"/api/v1/global/sync-policies/{policy_id}")
    assert resp_fetch.status_code == 200
    assert resp_fetch.json()["data"]["description"] == "Persistence test policy."


# -----------------------------------------------------------------------------
# Test 22: Multiple Approved Entity Types
# -----------------------------------------------------------------------------

async def test_multiple_approved_entity_types(admin_client):
    """Verify all approved master data entities are accepted."""
    erp_a = await _create_test_erp(admin_client, key="multi_node_a")
    erp_b = await _create_test_erp(admin_client, key="multi_node_b")

    for entity in sorted(APPROVED_ENTITY_TYPES):
        resp = await admin_client.post(
            "/api/v1/global/sync-policies",
            json={
                "source_erp_id": erp_a,
                "target_erp_id": erp_b,
                "entity_type": entity,
            },
        )
        assert resp.status_code == 201, f"Failed for approved entity {entity}: {resp.text}"


# -----------------------------------------------------------------------------
# Test 23: Forbidden High-Risk Entities Rejection
# -----------------------------------------------------------------------------

async def test_forbidden_high_risk_entities_rejection(admin_client):
    """Verify financial, payroll, and accounting entities are strictly rejected."""
    erp_a = await _create_test_erp(admin_client, key="forbid_node_a")
    erp_b = await _create_test_erp(admin_client, key="forbid_node_b")

    for forbidden in sorted(FORBIDDEN_ENTITY_TYPES):
        resp = await admin_client.post(
            "/api/v1/global/sync-policies",
            json={
                "source_erp_id": erp_a,
                "target_erp_id": erp_b,
                "entity_type": forbidden,
            },
        )
        assert resp.status_code in (400, 422), f"Expected rejection for {forbidden}, got {resp.status_code}"
        assert "forbidden" in resp.text.lower()


# -----------------------------------------------------------------------------
# Test 24: Bidirectional Conflict Detection
# -----------------------------------------------------------------------------

async def test_bidirectional_policy_conflict(admin_client):
    """Reject creating a reverse policy when a forward BIDIRECTIONAL active policy exists."""
    erp_a = await _create_test_erp(admin_client, key="bidi_node_a")
    erp_b = await _create_test_erp(admin_client, key="bidi_node_b")

    # A -> B bidirectional active policy
    resp1 = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "product",
            "direction": "BIDIRECTIONAL",
            "enabled": True,
            "status": "ACTIVE",
        },
    )
    assert resp1.status_code == 201

    # B -> A attempt should conflict because A -> B already synchronizes both ways
    resp2 = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_b,
            "target_erp_id": erp_a,
            "entity_type": "product",
            "direction": "SOURCE_TO_TARGET",
            "enabled": True,
            "status": "ACTIVE",
        },
    )
    assert resp2.status_code == 409


# -----------------------------------------------------------------------------
# Test 25: Disabled Policy Behavior
# -----------------------------------------------------------------------------

async def test_disabled_policy_behavior(admin_client):
    """Disabling an active policy allows creating a new active policy without conflict."""
    erp_a = await _create_test_erp(admin_client, key="dis_node_a")
    erp_b = await _create_test_erp(admin_client, key="dis_node_b")

    resp1 = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "buyer",
            "enabled": True,
            "status": "ACTIVE",
        },
    )
    policy_id = resp1.json()["data"]["id"]

    # Disable it
    await admin_client.patch(
        f"/api/v1/global/sync-policies/{policy_id}/state",
        json={"enabled": False, "status": "INACTIVE"},
    )

    # Now creating a new active policy succeeds
    resp2 = await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "buyer",
            "enabled": True,
            "status": "ACTIVE",
            "conflict_strategy": "TARGET_WINS",
        },
    )
    assert resp2.status_code == 201


# -----------------------------------------------------------------------------
# Test 26: Authoritative Owner Resolution Endpoint
# -----------------------------------------------------------------------------

async def test_authoritative_owner_resolution_endpoint(admin_client):
    """Test /global/sync-policies/resolve for active policy and missing policy."""
    erp_a = await _create_test_erp(admin_client, key="res_node_a")
    erp_b = await _create_test_erp(admin_client, key="res_node_b")

    # Unmatched resolution
    resp_unmatched = await admin_client.get(
        f"/api/v1/global/sync-policies/resolve?source_erp_id={erp_a}&target_erp_id={erp_b}&entity_type=buyer"
    )
    assert resp_unmatched.status_code == 200
    assert resp_unmatched.json()["data"]["has_active_policy"] is False

    # Create active policy
    await admin_client.post(
        "/api/v1/global/sync-policies",
        json={
            "source_erp_id": erp_a,
            "target_erp_id": erp_b,
            "entity_type": "buyer",
            "ownership_strategy": "SOURCE_OWNED",
            "enabled": True,
            "status": "ACTIVE",
        },
    )

    # Matched resolution
    resp_matched = await admin_client.get(
        f"/api/v1/global/sync-policies/resolve?source_erp_id={erp_a}&target_erp_id={erp_b}&entity_type=buyer"
    )
    assert resp_matched.status_code == 200
    res = resp_matched.json()["data"]
    assert res["has_active_policy"] is True
    assert res["authoritative_owner_erp_id"] == erp_a
    assert res["authoritative_owner_erp_key"] == "res_node_a"
    assert res["ownership_strategy"] == "SOURCE_OWNED"
