"""
Integration Control-Plane Tests (Phase 6).

Covers: event ingestion + deduplication (Section 15/16), capability-
aware routing (Section 25), subscriptions (Section 48), dead-letter +
authorized replay (Section 18/19), and the mandatory security tests
(Section 75): unauthenticated publish, spoofed source_erp, cross-ERP
credential reuse, unauthorized replay.

Uses `admin_client` (PlatformAdmin) for administrative setup
(registering ERPs, declaring capabilities, creating subscriptions) and
real issued service credentials (via `POST /global/erps/{id}/credentials`,
the same Phase 3 mechanism `test_service_identity.py` already exercises)
to authenticate as a producer ERP when calling the internal ingest
endpoint.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

pytestmark = pytest.mark.asyncio


async def _create_erp(admin_client, *, key: str, status: str = "ACTIVE"):
    """Create an ERP instance with the given status and return its id."""
    resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": status}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


async def _issue_credential(admin_client, erp_id: str) -> str:
    """Issue a service credential for an ERP and return its plaintext bearer_token."""
    resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["bearer_token"]


async def _declare_capability(admin_client, erp_id: str, module_key: str) -> None:
    """Declare a capability/module for an ERP."""
    resp = await admin_client.post(
        f"/api/v1/global/erps/{erp_id}/modules", json={"module_key": module_key, "module_name": module_key}
    )
    assert resp.status_code == 201, resp.text


def _build_envelope(*, source_erp: str, event_type: str = "buyer.created", **overrides) -> dict:
    """Build a valid event envelope, with overridable fields."""
    envelope = {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": source_erp,
        "source_entity_type": "buyer",
        "source_entity_id": str(uuid.uuid4()),
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {"buyer_id": "x", "company_name": "Acme"},
        "metadata": {},
    }
    envelope.update(overrides)
    return envelope


async def test_ingest_new_event_succeeds(admin_client, client):
    """A well-formed event from an authenticated producer is ingested successfully."""
    erp_id = await _create_erp(admin_client, key="ing_erp1")
    token = await _issue_credential(admin_client, erp_id)
    client.headers["Authorization"] = f"Bearer {token}"

    envelope = _build_envelope(source_erp="ing_erp1")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201, resp.text
    data = resp.json()["data"]
    assert data["duplicate"] is False
    assert data["event_id"] == envelope["event_id"]


async def test_duplicate_event_id_is_deduplicated(admin_client, client):
    """Resending the identical event_id is recognized as a duplicate, not routed twice."""
    erp_id = await _create_erp(admin_client, key="ing_erp2")
    token = await _issue_credential(admin_client, erp_id)
    client.headers["Authorization"] = f"Bearer {token}"

    envelope = _build_envelope(source_erp="ing_erp2")
    first = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert first.status_code == 201
    second = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert second.status_code == 201
    assert second.json()["data"]["duplicate"] is True
    assert second.json()["data"]["inbox_event_id"] == first.json()["data"]["inbox_event_id"]


async def test_event_with_no_matching_subscription_is_ignored(admin_client, client):
    """An event matching zero subscriptions is recorded as IGNORED, not an error."""
    erp_id = await _create_erp(admin_client, key="ing_erp3")
    token = await _issue_credential(admin_client, erp_id)
    client.headers["Authorization"] = f"Bearer {token}"

    envelope = _build_envelope(source_erp="ing_erp3", event_type="nothing.subscribes_to_this")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201
    assert resp.json()["data"]["status"] == "IGNORED"
    assert resp.json()["data"]["routed_to"] == []


async def test_unauthenticated_publish_rejected(client):
    """A request with no credentials at all is rejected."""
    envelope = _build_envelope(source_erp="whatever")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code in (401, 403)


async def test_spoofed_source_erp_rejected(admin_client, client):
    """A producer authenticated as ERP A cannot claim source_erp=B in the envelope (Section 22)."""
    erp_a_id = await _create_erp(admin_client, key="spoof_erp_a")
    await _create_erp(admin_client, key="spoof_erp_b")
    token_a = await _issue_credential(admin_client, erp_a_id)

    client.headers["Authorization"] = f"Bearer {token_a}"
    envelope = _build_envelope(source_erp="spoof_erp_b")  # claims to be B while authenticated as A
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 403


async def test_cross_erp_credential_reuse_rejected(admin_client, client):
    """ERP A's credential cannot be used to claim identity as a different, nonexistent ERP key."""
    erp_a_id = await _create_erp(admin_client, key="reuse_erp_a")
    token_a = await _issue_credential(admin_client, erp_a_id)

    client.headers["Authorization"] = f"Bearer {token_a}"
    envelope = _build_envelope(source_erp="nonexistent_erp_key")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 403


async def test_revoked_credential_rejected_for_publish(admin_client, client):
    """A revoked service credential cannot publish events."""
    erp_id = await _create_erp(admin_client, key="revoked_pub_erp")
    issue_resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    credential_id = issue_resp.json()["data"]["id"]
    token = issue_resp.json()["data"]["bearer_token"]
    await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials/{credential_id}/revoke")

    client.headers["Authorization"] = f"Bearer {token}"
    envelope = _build_envelope(source_erp="revoked_pub_erp")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code in (401, 403)


async def test_admin_routes_require_platform_permission(client):
    """The admin API (subscriptions, inbox, dead-letters) rejects unauthenticated requests."""
    resp = await client.get("/api/v1/global/integration/subscriptions")
    assert resp.status_code in (401, 403)


async def test_specific_erp_subscription_routes_when_capability_matches(admin_client, client):
    """A SPECIFIC_ERP subscription with a required_capability routes only when the target declares that capability."""
    source_id = await _create_erp(admin_client, key="route_source1")
    target_id = await _create_erp(admin_client, key="route_target1")
    await _declare_capability(admin_client, target_id, "buyers")

    sub_resp = await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "SPECIFIC_ERP",
            "target_erp_id": target_id,
            "required_capability": "buyers",
        },
    )
    assert sub_resp.status_code == 201, sub_resp.text

    token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {token}"
    envelope = _build_envelope(source_erp="route_source1")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201
    assert resp.json()["data"]["status"] == "ROUTED"
    assert "route_target1" in resp.json()["data"]["routed_to"]


async def test_specific_erp_subscription_skips_when_capability_missing(admin_client, client):
    """A subscription requiring a capability the target hasn't declared is skipped, not an error."""
    source_id = await _create_erp(admin_client, key="route_source2")
    target_id = await _create_erp(admin_client, key="route_target2")

    await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "SPECIFIC_ERP",
            "target_erp_id": target_id,
            "required_capability": "buyers",
        },
    )

    token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {token}"
    envelope = _build_envelope(source_erp="route_source2")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201
    assert resp.json()["data"]["status"] == "IGNORED"


async def test_broadcast_subscription_routes_to_every_active_capable_erp(admin_client, client):
    """A BROADCAST subscription routes to every ACTIVE ERP with the required capability, except the source."""
    source_id = await _create_erp(admin_client, key="bcast_source1")
    target_a_id = await _create_erp(admin_client, key="bcast_target_a")
    target_b_id = await _create_erp(admin_client, key="bcast_target_b")
    await _declare_capability(admin_client, target_a_id, "buyers")
    await _declare_capability(admin_client, target_b_id, "buyers")

    await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "BROADCAST",
            "required_capability": "buyers",
        },
    )

    token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {token}"
    envelope = _build_envelope(source_erp="bcast_source1")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201
    routed_to = resp.json()["data"]["routed_to"]
    assert "bcast_target_a" in routed_to
    assert "bcast_target_b" in routed_to
    assert "bcast_source1" not in routed_to


async def test_inactive_target_erp_skipped(admin_client, client):
    """A SPECIFIC_ERP subscription targeting a non-ACTIVE ERP is skipped, not an error."""
    source_id = await _create_erp(admin_client, key="route_source3")
    target_id = await _create_erp(admin_client, key="route_target3", status="SUSPENDED")

    await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "SPECIFIC_ERP",
            "target_erp_id": target_id,
        },
    )

    token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {token}"
    envelope = _build_envelope(source_erp="route_source3")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201
    assert resp.json()["data"]["status"] == "IGNORED"


async def test_duplicate_subscription_rejected(admin_client):
    """Creating an identical (event_type, source, target) subscription twice returns 409."""
    source_id = await _create_erp(admin_client, key="dup_sub_source")
    target_id = await _create_erp(admin_client, key="dup_sub_target")
    payload = {
        "event_type": "buyer.created",
        "source_erp_id": source_id,
        "target_kind": "SPECIFIC_ERP",
        "target_erp_id": target_id,
    }
    first = await admin_client.post("/api/v1/global/integration/subscriptions", json=payload)
    assert first.status_code == 201
    second = await admin_client.post("/api/v1/global/integration/subscriptions", json=payload)
    assert second.status_code == 409


async def test_specific_erp_target_requires_target_erp_id(admin_client):
    """target_kind=SPECIFIC_ERP without target_erp_id is rejected at the schema layer."""
    source_id = await _create_erp(admin_client, key="badsub_source1")
    resp = await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={"event_type": "buyer.created", "source_erp_id": source_id, "target_kind": "SPECIFIC_ERP"},
    )
    assert resp.status_code == 422


async def test_broadcast_target_forbids_target_erp_id(admin_client):
    """target_kind=BROADCAST with target_erp_id set is rejected at the schema layer."""
    source_id = await _create_erp(admin_client, key="badsub_source2")
    target_id = await _create_erp(admin_client, key="badsub_target2")
    resp = await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "BROADCAST",
            "target_erp_id": target_id,
        },
    )
    assert resp.status_code == 422


async def test_disabling_subscription_stops_routing(admin_client, client):
    """Disabling a subscription means subsequent events no longer route through it."""
    source_id = await _create_erp(admin_client, key="disable_sub_source")
    target_id = await _create_erp(admin_client, key="disable_sub_target")
    sub_resp = await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "SPECIFIC_ERP",
            "target_erp_id": target_id,
        },
    )
    subscription_id = sub_resp.json()["data"]["id"]
    await admin_client.patch(f"/api/v1/global/integration/subscriptions/{subscription_id}", json={"enabled": False})

    token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {token}"
    envelope = _build_envelope(source_erp="disable_sub_source")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.json()["data"]["status"] == "IGNORED"


async def test_create_and_list_entity_mapping(admin_client):
    """An explicit cross-ERP entity mapping can be created and looked up."""
    source_id = await _create_erp(admin_client, key="map_source1")
    target_id = await _create_erp(admin_client, key="map_target1")
    source_entity_id = str(uuid.uuid4())
    target_entity_id = str(uuid.uuid4())

    create_resp = await admin_client.post(
        "/api/v1/global/integration/mappings",
        json={
            "source_erp_id": source_id,
            "source_entity_type": "buyer",
            "source_entity_id": source_entity_id,
            "target_erp_id": target_id,
            "target_entity_type": "buyer",
            "target_entity_id": target_entity_id,
        },
    )
    assert create_resp.status_code == 201, create_resp.text

    list_resp = await admin_client.get(f"/api/v1/global/integration/mappings/{source_id}/buyer/{source_entity_id}")
    assert list_resp.status_code == 200
    data = list_resp.json()["data"]
    assert len(data) == 1
    assert data[0]["target_entity_id"] == target_entity_id


async def test_creating_identical_mapping_twice_is_idempotent(admin_client):
    """Re-creating an identical mapping does not create a duplicate row."""
    source_id = await _create_erp(admin_client, key="map_source2")
    target_id = await _create_erp(admin_client, key="map_target2")
    source_entity_id = str(uuid.uuid4())
    payload = {
        "source_erp_id": source_id,
        "source_entity_type": "buyer",
        "source_entity_id": source_entity_id,
        "target_erp_id": target_id,
        "target_entity_type": "buyer",
        "target_entity_id": str(uuid.uuid4()),
    }
    await admin_client.post("/api/v1/global/integration/mappings", json=payload)
    await admin_client.post("/api/v1/global/integration/mappings", json=payload)

    list_resp = await admin_client.get(f"/api/v1/global/integration/mappings/{source_id}/buyer/{source_entity_id}")
    assert len(list_resp.json()["data"]) == 1


async def test_replay_nonexistent_dead_letter_returns_404(admin_client):
    """Replaying a dead-letter id that doesn't exist returns 404."""
    resp = await admin_client.post(f"/api/v1/global/integration/dead-letters/{uuid.uuid4()}/replay")
    assert resp.status_code == 404


async def test_replay_requires_authorization(client):
    """An unauthenticated caller cannot replay a dead letter."""
    resp = await client.post(f"/api/v1/global/integration/dead-letters/{uuid.uuid4()}/replay")
    assert resp.status_code in (401, 403)


async def test_dead_letters_list_starts_empty_for_fresh_setup(admin_client):
    """Listing dead letters succeeds and returns a list (empty or not), never an error, for a fresh setup."""
    resp = await admin_client.get("/api/v1/global/integration/dead-letters")
    assert resp.status_code == 200
    assert isinstance(resp.json()["data"], list)


async def test_subscription_for_one_source_does_not_affect_another(admin_client, client):
    """A subscription registered for source ERP A must not route events whose real source is ERP B."""
    erp_a_id = await _create_erp(admin_client, key="iso_erp_a")
    erp_b_id = await _create_erp(admin_client, key="iso_erp_b")
    target_id = await _create_erp(admin_client, key="iso_target")

    await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": erp_a_id,
            "target_kind": "SPECIFIC_ERP",
            "target_erp_id": target_id,
        },
    )

    token_b = await _issue_credential(admin_client, erp_b_id)
    client.headers["Authorization"] = f"Bearer {token_b}"
    envelope = _build_envelope(source_erp="iso_erp_b")
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201
    assert resp.json()["data"]["status"] == "IGNORED"


async def test_poll_inbox_returns_events_routed_to_calling_erp(admin_client, client):
    """A target ERP polling its own inbox sees events routed to it, using only its own credential's identity."""
    source_id = await _create_erp(admin_client, key="poll_source1")
    target_id = await _create_erp(admin_client, key="poll_target1")

    await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "SPECIFIC_ERP",
            "target_erp_id": target_id,
        },
    )

    source_token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {source_token}"
    envelope = _build_envelope(source_erp="poll_source1")
    ingest_resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert ingest_resp.json()["data"]["status"] == "ROUTED"

    target_token = await _issue_credential(admin_client, target_id)
    client.headers["Authorization"] = f"Bearer {target_token}"
    poll_resp = await client.get("/api/v1/internal/integration/inbox")
    assert poll_resp.status_code == 200
    event_ids = [e["event_id"] for e in poll_resp.json()["data"]]
    assert envelope["event_id"] in event_ids


async def test_poll_inbox_does_not_return_events_routed_to_a_different_erp(admin_client, client):
    """A target ERP's poll never returns events routed to some OTHER ERP (cross-ERP isolation on the read side)."""
    source_id = await _create_erp(admin_client, key="poll_source2")
    target_a_id = await _create_erp(admin_client, key="poll_target_a")
    target_b_id = await _create_erp(admin_client, key="poll_target_b")

    await admin_client.post(
        "/api/v1/global/integration/subscriptions",
        json={
            "event_type": "buyer.created",
            "source_erp_id": source_id,
            "target_kind": "SPECIFIC_ERP",
            "target_erp_id": target_a_id,
        },
    )

    source_token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {source_token}"
    envelope = _build_envelope(source_erp="poll_source2")
    await client.post("/api/v1/internal/integration/events", json=envelope)

    target_b_token = await _issue_credential(admin_client, target_b_id)
    client.headers["Authorization"] = f"Bearer {target_b_token}"
    poll_resp = await client.get("/api/v1/internal/integration/inbox")
    event_ids = [e["event_id"] for e in poll_resp.json()["data"]]
    assert envelope["event_id"] not in event_ids


async def test_poll_inbox_requires_authentication(client):
    """Polling the inbox with no credentials at all is rejected."""
    resp = await client.get("/api/v1/internal/integration/inbox")
    assert resp.status_code in (401, 403)


async def test_get_inbox_event_with_sanitized_payload(admin_client, client):
    """Operators can inspect inbox events with sensitive payload fields redacted."""
    source_id = await _create_erp(admin_client, key="safe_payload_erp")
    source_token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {source_token}"

    envelope = _build_envelope(source_erp="safe_payload_erp")
    envelope["payload"] = {
        "company_name": "SecureCorp",
        "password": "ClearTextPassword123",
        "api_key": "secret_api_key_abc",
        "nested": {
            "token": "bearer-xyz",
            "safe_counter": 42,
        },
    }
    ingest_resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert ingest_resp.status_code == 201

    # Fetch by producer event_id
    detail_resp = await admin_client.get(f"/api/v1/global/integration/inbox/{envelope['event_id']}")
    assert detail_resp.status_code == 200
    data = detail_resp.json()["data"]
    assert data["event_id"] == envelope["event_id"]
    payload = data["payload"]
    assert payload["company_name"] == "SecureCorp"
    assert payload["password"] == "[REDACTED]"
    assert payload["api_key"] == "[REDACTED]"
    assert payload["nested"]["token"] == "[REDACTED]"
    assert payload["nested"]["safe_counter"] == 42


async def test_list_inbox_filter_by_correlation_id(admin_client, client):
    """Operators can filter the inbox event list by correlation_id to trace related events."""
    source_id = await _create_erp(admin_client, key="trace_erp")
    source_token = await _issue_credential(admin_client, source_id)
    client.headers["Authorization"] = f"Bearer {source_token}"

    target_corr_id = str(uuid.uuid4())
    other_corr_id = str(uuid.uuid4())

    env1 = _build_envelope(source_erp="trace_erp")
    env1["correlation_id"] = target_corr_id
    await client.post("/api/v1/internal/integration/events", json=env1)

    env2 = _build_envelope(source_erp="trace_erp")
    env2["correlation_id"] = other_corr_id
    await client.post("/api/v1/internal/integration/events", json=env2)

    resp = await admin_client.get(f"/api/v1/global/integration/inbox?correlation_id={target_corr_id}")
    assert resp.status_code == 200
    events = resp.json()["data"]
    assert len(events) >= 1
    for ev in events:
        assert ev["correlation_id"] == target_corr_id


async def test_entity_mapping_with_metadata_and_version(admin_client):
    """Phase 8E: IntegrationEntityMapping stores status, source_version, target_version, and timestamps."""
    source_id = await _create_erp(admin_client, key="meta_source")
    target_id = await _create_erp(admin_client, key="meta_target")
    source_entity_id = str(uuid.uuid4())
    target_entity_id = str(uuid.uuid4())
    correlation_id = str(uuid.uuid4())

    payload = {
        "source_erp_id": source_id,
        "source_entity_type": "buyer",
        "source_entity_id": source_entity_id,
        "target_erp_id": target_id,
        "target_entity_type": "buyer",
        "target_entity_id": target_entity_id,
        "status": "ACTIVE",
        "source_version": 1,
        "target_version": 1,
        "correlation_id": correlation_id,
    }
    create_resp = await admin_client.post("/api/v1/global/integration/mappings", json=payload)
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()["data"]
    assert created["status"] == "ACTIVE"
    assert created["source_version"] == 1
    assert created["target_version"] == 1
    assert created["correlation_id"] == correlation_id

    # Update with newer version
    payload["source_version"] = 2
    payload["target_version"] = 2
    update_resp = await admin_client.post("/api/v1/global/integration/mappings", json=payload)
    assert update_resp.status_code == 201
    updated = update_resp.json()["data"]
    assert updated["source_version"] == 2
    assert updated["target_version"] == 2


async def test_migration_0009_upgrade_downgrade(tmp_path):
    """Test Alembic migration 0009 upgrade and downgrade."""
    import asyncio
    from pathlib import Path
    from alembic import command
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parent.parent
    ini_path = backend_dir / "alembic.ini"
    alembic_cfg = Config(str(ini_path))
    test_db_path = tmp_path / "alembic_test_0009.db"
    db_url = f"sqlite+aiosqlite:///{test_db_path.as_posix()}"

    alembic_cfg.set_main_option("sqlalchemy.url", db_url)
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    # Upgrade to 0009 in separate thread so alembic's asyncio.run() works
    await asyncio.to_thread(command.upgrade, alembic_cfg, "0009")

    # Downgrade to 0008
    await asyncio.to_thread(command.downgrade, alembic_cfg, "0008")

    # Re-upgrade to 0009
    await asyncio.to_thread(command.upgrade, alembic_cfg, "0009")

    # Clean downgrade
    await asyncio.to_thread(command.downgrade, alembic_cfg, "base")


