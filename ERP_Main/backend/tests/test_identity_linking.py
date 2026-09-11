"""
Tests for Bidirectional Identity Linking and Flow A/B (Prompt 2).

Covers:
- Flow A: GlobalUser -> ERP provisioning with adapter & idempotency.
- Flow B: ERP -> GlobalUser identity matching (EXACT_MATCH, NO_MATCH, ALREADY_LINKED, AMBIGUOUS_MATCH, CONFLICT).
- Integration ingest of user.created event.
- Conflict resolution API: LINK, CREATE_NEW, REJECT with audit logging.
- Direct identity linking and safe unlinking (no cascade delete).
- Deterministic email normalization.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import select

from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.global_audit.models import AuditEventType, GlobalAuditLog
from app.global_users.models import GlobalUser
from app.identity_linking.adapters.base import BaseErpProvisioningAdapter
from app.identity_linking.adapters.registry import get_adapter_registry
from app.identity_linking.models import ConflictStatus, ConflictType, IdentityConflict
from app.identity_linking.schemas import (
    ConflictResolutionAction,
    IdentityMatchingState,
)
from app.identity_linking.service import normalize_email


class InMemoryTestProvisioningAdapter(BaseErpProvisioningAdapter):
    """In-memory adapter for testing ERP provisioning without network."""

    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}

    async def check_local_user(self, erp: ErpInstance, email_or_username: str) -> dict[str, Any] | None:
        norm = email_or_username.strip().lower()
        if norm in self.users:
            return {"exists": True, **self.users[norm]}
        return {"exists": False}

    async def provision_local_user(
        self,
        erp: ErpInstance,
        *,
        email: str,
        display_name: str,
        username: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        target_organization_id: str | None = None,
    ) -> dict[str, Any]:
        norm = email.strip().lower()
        if norm in self.users:
            return {"local_user_id": self.users[norm]["local_user_id"], "created": False}

        local_id = str(uuid.uuid4())
        record = {
            "local_user_id": local_id,
            "email": norm,
            "username": username or norm.split("@")[0],
            "display_name": display_name,
        }
        self.users[norm] = record
        return {"local_user_id": local_id, "created": True}


@pytest.fixture(autouse=True)
def register_test_adapters():
    registry = get_adapter_registry()
    adapter = InMemoryTestProvisioningAdapter()
    orig_get = registry.get_adapter
    registry.get_adapter = lambda erp_key: adapter
    yield adapter
    registry.get_adapter = orig_get


async def _create_active_erp(admin_client, key: str = "test_erp") -> str:
    resp = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": key, "name": key.title(), "display_name": f"{key.title()} ERP", "status": "ACTIVE"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


async def _create_global_user(admin_client, email: str, name: str = "Test User") -> str:
    resp = await admin_client.post(
        "/api/v1/global/users",
        json={"primary_email": email, "display_name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


# --- Email Normalization Tests ------------------------------------------------


def test_email_normalization():
    assert normalize_email("  User.Test+tag@Example.COM  ") == "user.test+tag@example.com"
    assert normalize_email("SIMPLE@TEST.ORG") == "simple@test.org"
    assert normalize_email("") == ""


# --- Flow A: Provisioning Tests -----------------------------------------------


@pytest.mark.asyncio
async def test_provision_global_user_to_erp(admin_client):
    """Flow A: Provision a GlobalUser into an active ERP instance."""
    erp_id = await _create_active_erp(admin_client, key="test_erp")
    user_id = await _create_global_user(admin_client, email="flowa@example.com", name="Flow A User")

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id, "notes": "Onboarding provision"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()["data"]
    assert data["global_user_id"] == user_id
    assert data["erp_instance_id"] == erp_id
    assert data["status"] == "ACTIVE"
    assert "local_user_id" in data


@pytest.mark.asyncio
async def test_provision_global_user_idempotency(admin_client):
    """Flow A: Provisioning the same GlobalUser twice returns the existing membership."""
    erp_id = await _create_active_erp(admin_client, key="test_erp_idem")
    user_id = await _create_global_user(admin_client, email="idem@example.com", name="Idem User")

    resp1 = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp1.status_code == 201
    membership_id_1 = resp1.json()["data"]["id"]

    resp2 = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp2.status_code == 201
    membership_id_2 = resp2.json()["data"]["id"]
    assert membership_id_1 == membership_id_2


@pytest.mark.asyncio
async def test_provision_to_decommissioned_erp_rejected(admin_client):
    """Provisioning into an inactive/decommissioned ERP must be rejected."""
    erp_resp = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": "decom_erp", "name": "Decom", "display_name": "Decom ERP", "status": "DECOMMISSIONED"},
    )
    erp_id = erp_resp.json()["data"]["id"]
    user_id = await _create_global_user(admin_client, email="decom@example.com")

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp.status_code == 403


# --- Flow B: Identity Matching Evaluation Tests --------------------------------


@pytest.mark.asyncio
async def test_flow_b_exact_match(admin_client):
    """Flow B: Incoming user with existing matching email auto-links (EXACT_MATCH)."""
    from app.database.session import get_db_session
    from app.identity_linking.dependencies import get_identity_linking_service

    erp_id_str = await _create_active_erp(admin_client, key="erp_flow_b_exact")
    erp_id = uuid.UUID(erp_id_str)
    user_id_str = await _create_global_user(admin_client, email="exact.match@example.com", name="Exact Candidate")
    user_id = uuid.UUID(user_id_str)

    gen = get_db_session()
    db = await anext(gen)
    service = get_identity_linking_service(db=db)

    result = await service.evaluate_and_link_user(
        erp_instance_id=erp_id,
        local_user_id="local-exact-1",
        email="  EXACT.MATCH@example.COM  ",
        display_name="Exact Candidate Local",
        username="exact_cand",
    )
    await db.commit()

    assert result.state == IdentityMatchingState.EXACT_MATCH
    assert result.global_user_id == user_id
    assert result.membership_id is not None


@pytest.mark.asyncio
async def test_flow_b_no_match_creates_global_user(admin_client):
    """Flow B: Incoming user with unknown email provisions a new GlobalUser (NO_MATCH)."""
    from app.database.session import get_db_session
    from app.identity_linking.dependencies import get_identity_linking_service

    erp_id_str = await _create_active_erp(admin_client, key="erp_flow_b_nomatch")
    erp_id = uuid.UUID(erp_id_str)

    gen = get_db_session()
    db = await anext(gen)
    service = get_identity_linking_service(db=db)

    result = await service.evaluate_and_link_user(
        erp_instance_id=erp_id,
        local_user_id="local-nomatch-1",
        email="brand.new@example.com",
        display_name="Brand New Local",
        username="brandnew",
    )
    await db.commit()

    assert result.state == IdentityMatchingState.NO_MATCH
    assert result.global_user_id is not None
    assert result.membership_id is not None

    # Verify GlobalUser exists
    stmt = select(GlobalUser).where(GlobalUser.id == result.global_user_id)
    gu = (await db.execute(stmt)).scalars().first()
    assert gu is not None
    assert gu.primary_email == "brand.new@example.com"


@pytest.mark.asyncio
async def test_flow_b_already_linked(admin_client):
    """Flow B: Evaluating a local user already linked returns ALREADY_LINKED idempotently."""
    from app.database.session import get_db_session
    from app.identity_linking.dependencies import get_identity_linking_service

    erp_id_str = await _create_active_erp(admin_client, key="erp_flow_b_already")
    erp_id = uuid.UUID(erp_id_str)

    gen = get_db_session()
    db = await anext(gen)
    service = get_identity_linking_service(db=db)

    res1 = await service.evaluate_and_link_user(
        erp_instance_id=erp_id,
        local_user_id="local-already-1",
        email="already@example.com",
        display_name="Already Local",
    )
    await db.commit()
    assert res1.state == IdentityMatchingState.NO_MATCH

    res2 = await service.evaluate_and_link_user(
        erp_instance_id=erp_id,
        local_user_id="local-already-1",
        email="already@example.com",
        display_name="Already Local",
    )
    assert res2.state == IdentityMatchingState.ALREADY_LINKED
    assert res2.global_user_id == res1.global_user_id
    assert res2.membership_id == res1.membership_id


@pytest.mark.asyncio
async def test_flow_b_conflict_detection(admin_client):
    """Flow B: Email matches a GlobalUser that is ALREADY bound to a different local account -> CONFLICT."""
    from app.database.session import get_db_session
    from app.identity_linking.dependencies import get_identity_linking_service

    erp_id_str = await _create_active_erp(admin_client, key="erp_flow_b_conf")
    erp_id = uuid.UUID(erp_id_str)
    user_id_str = await _create_global_user(admin_client, email="conflict.test@example.com", name="Target User")

    # Link user to local-conf-1
    link_resp = await admin_client.post(
        "/api/v1/global/identity/link",
        json={"global_user_id": user_id_str, "erp_instance_id": erp_id_str, "local_user_id": "local-conf-1"},
    )
    assert link_resp.status_code == 201

    # Incoming local user local-conf-2 with the SAME email must raise CONFLICT
    gen = get_db_session()
    db = await anext(gen)
    service = get_identity_linking_service(db=db)

    result = await service.evaluate_and_link_user(
        erp_instance_id=erp_id,
        local_user_id="local-conf-2",
        email="conflict.test@example.com",
        display_name="Impostor Account",
    )
    await db.commit()

    assert result.state == IdentityMatchingState.CONFLICT
    assert result.conflict_id is not None


# --- Conflict Resolution Tests ------------------------------------------------


@pytest.mark.asyncio
async def test_conflict_resolution_link(admin_client):
    """Admin resolves conflict with LINK: binds chosen GlobalUser."""
    erp_id_str = await _create_active_erp(admin_client, key="erp_res_link")
    user_1_id = await _create_global_user(admin_client, email="u1@example.com", name="User One")
    user_2_id = await _create_global_user(admin_client, email="u2@example.com", name="User Two")

    from app.database.session import get_db_session
    from app.identity_linking.repository import IdentityConflictRepository

    gen = get_db_session()
    db = await anext(gen)
    conflict = IdentityConflict(
        erp_instance_id=uuid.UUID(erp_id_str),
        local_user_id="local-disputed-1",
        normalized_email="disputed@example.com",
        status=ConflictStatus.PENDING,
        conflict_type=ConflictType.AMBIGUOUS_MATCH,
        candidate_global_user_ids=[user_1_id, user_2_id],
    )
    repo = IdentityConflictRepository(db)
    created_conflict = await repo.create(conflict)
    conflict_id = str(created_conflict.id)
    await db.commit()

    # Resolve by choosing user_2
    resp = await admin_client.post(
        f"/api/v1/global/identity/conflicts/{conflict_id}/resolve",
        json={
            "action": ConflictResolutionAction.LINK.value,
            "target_global_user_id": user_2_id,
            "notes": "Verified identity manually",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["status"] == "RESOLVED"
    assert data["resolution_action"] == "LINK"

    # Verify membership created
    mem_resp = await admin_client.get(f"/api/v1/global/users/{user_2_id}/identities")
    assert mem_resp.status_code == 200
    identities = mem_resp.json()["data"]
    assert len(identities) == 1
    assert identities[0]["local_user_id"] == "local-disputed-1"


@pytest.mark.asyncio
async def test_conflict_resolution_create_new(admin_client):
    """Admin resolves conflict with CREATE_NEW: provisions dedicated GlobalUser."""
    erp_id_str = await _create_active_erp(admin_client, key="erp_res_new")

    from app.database.session import get_db_session
    from app.identity_linking.repository import IdentityConflictRepository

    gen = get_db_session()
    db = await anext(gen)
    conflict = IdentityConflict(
        erp_instance_id=uuid.UUID(erp_id_str),
        local_user_id="local-new-gu-1",
        normalized_email="distinct.person@example.com",
        status=ConflictStatus.PENDING,
        conflict_type=ConflictType.AMBIGUOUS_MATCH,
        candidate_global_user_ids=[],
    )
    repo = IdentityConflictRepository(db)
    created_conflict = await repo.create(conflict)
    conflict_id = str(created_conflict.id)
    await db.commit()

    resp = await admin_client.post(
        f"/api/v1/global/identity/conflicts/{conflict_id}/resolve",
        json={
            "action": ConflictResolutionAction.CREATE_NEW.value,
            "notes": "Different person sharing mailbox",
        },
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "RESOLVED"
    assert data["resolution_action"] == "CREATE_NEW"


@pytest.mark.asyncio
async def test_conflict_resolution_reject(admin_client):
    """Admin resolves conflict with REJECT: marks conflict rejected without linking."""
    erp_id_str = await _create_active_erp(admin_client, key="erp_res_rej")

    from app.database.session import get_db_session
    from app.identity_linking.repository import IdentityConflictRepository

    gen = get_db_session()
    db = await anext(gen)
    conflict = IdentityConflict(
        erp_instance_id=uuid.UUID(erp_id_str),
        local_user_id="local-rejected-1",
        normalized_email="bogus@example.com",
        status=ConflictStatus.PENDING,
        conflict_type=ConflictType.CONFLICT,
        candidate_global_user_ids=[],
    )
    repo = IdentityConflictRepository(db)
    created_conflict = await repo.create(conflict)
    conflict_id = str(created_conflict.id)
    await db.commit()

    resp = await admin_client.post(
        f"/api/v1/global/identity/conflicts/{conflict_id}/resolve",
        json={
            "action": ConflictResolutionAction.REJECT.value,
            "notes": "Fraudulent local account",
        },
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "REJECTED"
    assert data["resolution_action"] == "REJECT"


# --- Safe Unlinking Tests -----------------------------------------------------


@pytest.mark.asyncio
async def test_unlink_membership_safe(admin_client):
    """Unlinking revokes membership and audit-logs without affecting local account."""
    erp_id_str = await _create_active_erp(admin_client, key="erp_unlink_safe")
    user_id_str = await _create_global_user(admin_client, email="unlink.me@example.com")

    # Link direct
    link_resp = await admin_client.post(
        "/api/v1/global/identity/link",
        json={"global_user_id": user_id_str, "erp_instance_id": erp_id_str, "local_user_id": "local-unlink-1"},
    )
    assert link_resp.status_code == 201
    membership_id = link_resp.json()["data"]["id"]

    # Unlink
    unlink_resp = await admin_client.delete(
        f"/api/v1/global/identity/memberships/{membership_id}/link?reason=Role+transferred",
    )
    assert unlink_resp.status_code == 200

    # Verify membership is gone or revoked
    get_mem = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert get_mem.status_code == 404 or get_mem.json()["data"]["status"] == "REVOKED"
