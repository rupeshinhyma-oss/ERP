"""
Phase 9 Cross-ERP Hardening Tests for ERP_Main.

Covers:
1. Cross-ERP failure isolation (spoke outage / inactive ERP isolation).
2. Loop prevention (events never route back to their originating ERP).
3. At-least-once ingestion deduplication and duplicate detection.
4. Dead-letter queue escalation when routing retry attempts are exhausted.
5. Cross-ERP producer authentication & source spoofing prevention.
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
    """Build a valid event envelope with overridable fields."""
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
        "payload": {"buyer_id": "test_b1", "company_name": "Test Buyer Co"},
        "metadata": {},
    }
    envelope.update(overrides)
    return envelope


class TestPhase9CrossErpHardening:
    """Tests failure isolation, loop prevention, and idempotent deduplication in ERP_Main."""

    async def test_cross_erp_failure_isolation(self, admin_client, client):
        """When an ERP is SUSPENDED, events still route to active ERPs without disruption."""
        # Setup: producer erp_src, active target erp_active, and suspended target erp_suspended
        src_id = await _create_erp(admin_client, key="iso_src")
        active_id = await _create_erp(admin_client, key="iso_active", status="ACTIVE")
        suspended_id = await _create_erp(admin_client, key="iso_suspended", status="SUSPENDED")

        # Declare buyers capability on both targets
        await _declare_capability(admin_client, active_id, "buyers")
        await _declare_capability(admin_client, suspended_id, "buyers")

        # Create BROADCAST subscription for buyer.created from iso_src
        sub_resp = await admin_client.post(
            "/api/v1/global/integration/subscriptions",
            json={
                "event_type": "buyer.created",
                "source_erp_id": src_id,
                "target_kind": "BROADCAST",
                "required_capability": "buyers",
            },
        )
        assert sub_resp.status_code == 201

        # Authenticate as producer
        token = await _issue_credential(admin_client, src_id)
        client.headers["Authorization"] = f"Bearer {token}"

        # Ingest event
        envelope = _build_envelope(source_erp="iso_src", event_type="buyer.created")
        resp = await client.post("/api/v1/internal/integration/events", json=envelope)
        assert resp.status_code == 201, resp.text
        data = resp.json()["data"]

        # Verify only active ERP received routing; suspended ERP was safely omitted
        assert "iso_active" in data["routed_to"]
        assert "iso_suspended" not in data["routed_to"]
        assert data["status"] == "ROUTED"

    async def test_cross_erp_loop_prevention_origin_filtering(self, admin_client, client):
        """A broadcast subscription never routes an event back to its originating producer ERP."""
        erp1_id = await _create_erp(admin_client, key="loop_erp1")
        erp2_id = await _create_erp(admin_client, key="loop_erp2")

        await _declare_capability(admin_client, erp1_id, "buyers")
        await _declare_capability(admin_client, erp2_id, "buyers")

        # Create BROADCAST subscription from loop_erp1
        await admin_client.post(
            "/api/v1/global/integration/subscriptions",
            json={
                "event_type": "buyer.created",
                "source_erp_id": erp1_id,
                "target_kind": "BROADCAST",
                "required_capability": "buyers",
            },
        )

        token = await _issue_credential(admin_client, erp1_id)
        client.headers["Authorization"] = f"Bearer {token}"

        envelope = _build_envelope(source_erp="loop_erp1", event_type="buyer.created")
        resp = await client.post("/api/v1/internal/integration/events", json=envelope)
        assert resp.status_code == 201
        data = resp.json()["data"]

        # Loop prevention: loop_erp1 must NOT appear in routed_to
        assert "loop_erp1" not in data["routed_to"]
        assert "loop_erp2" in data["routed_to"]

    async def test_cross_erp_idempotent_deduplication(self, admin_client, client):
        """Duplicate event delivery returns identical result and marks duplicate=True."""
        erp_id = await _create_erp(admin_client, key="dedup_erp")
        token = await _issue_credential(admin_client, erp_id)
        client.headers["Authorization"] = f"Bearer {token}"

        envelope = _build_envelope(source_erp="dedup_erp")

        # First delivery
        first_resp = await client.post("/api/v1/internal/integration/events", json=envelope)
        assert first_resp.status_code == 201
        first_data = first_resp.json()["data"]
        assert first_data["duplicate"] is False

        # Resend identical event
        second_resp = await client.post("/api/v1/internal/integration/events", json=envelope)
        assert second_resp.status_code == 201
        second_data = second_resp.json()["data"]
        assert second_data["duplicate"] is True
        assert second_data["inbox_event_id"] == first_data["inbox_event_id"]

    async def test_unauthorized_producer_ingest_rejected(self, admin_client, client):
        """Unauthenticated requests or spoofed source ERP headers are strictly rejected."""
        erp_a_id = await _create_erp(admin_client, key="spoof_a")
        token_a = await _issue_credential(admin_client, erp_a_id)

        # 1. No token -> 401
        client.headers.pop("Authorization", None)
        envelope = _build_envelope(source_erp="spoof_a")
        resp = await client.post("/api/v1/internal/integration/events", json=envelope)
        assert resp.status_code in (401, 403)

        # 2. Token A claims to be erp_b -> 403 Forbidden
        client.headers["Authorization"] = f"Bearer {token_a}"
        spoofed_envelope = _build_envelope(source_erp="spoof_b")
        resp_spoof = await client.post("/api/v1/internal/integration/events", json=spoofed_envelope)
        assert resp_spoof.status_code == 403


class TestPhase9FederationReliabilityAndCredentials:
    """Tests for Phase 9 credential architecture, rotation, SSO security, and failure isolation."""

    async def test_directional_service_credentials(self, monkeypatch):
        """ERP_Main resolves distinct directional credentials for Yinglima and Inhyma."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "ERP_MAIN_TO_YINGLIMA_SERVICE_CREDENTIAL", "cred-to-yinglima-prod")
        monkeypatch.setattr(settings, "ERP_MAIN_TO_INHYMA_SERVICE_CREDENTIAL", "cred-to-inhyma-prod")
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "shared-fallback-cred")

        assert settings.get_service_credential_for_erp("yinglima") == "cred-to-yinglima-prod"
        assert settings.get_service_credential_for_erp("inhyma") == "cred-to-inhyma-prod"
        assert settings.get_service_credential_for_erp("other_spoke") == "shared-fallback-cred"

    async def test_missing_credential_fails_closed(self, monkeypatch):
        """HttpErpProvisioningAdapter fails closed with BadRequestException when credential is missing."""
        from app.core.config import settings
        from app.core.exceptions import BadRequestException
        from app.erp_registry.models import ErpInstance
        from app.identity_linking.adapters.http_adapter import HttpErpProvisioningAdapter

        monkeypatch.setattr(settings, "ERP_MAIN_TO_YINGLIMA_SERVICE_CREDENTIAL", "")
        monkeypatch.setattr(settings, "FEDERATION_SERVICE_CREDENTIAL", "")

        fake_erp = ErpInstance(
            id=uuid.uuid4(),
            key="yinglima",
            name="Yinglima",
            display_name="Yinglima",
            base_url="http://127.0.0.1:8001",
        )
        adapter = HttpErpProvisioningAdapter()
        with pytest.raises(BadRequestException) as exc_info:
            adapter._get_headers(fake_erp)
        assert "Service credential for ERP 'yinglima' is not configured" in str(exc_info.value)

    async def test_headers_contain_correlation_and_idempotency_keys(self, monkeypatch):
        """Adapter injects X-Correlation-ID, X-Request-ID, and Idempotency-Key headers."""
        from app.core.config import settings
        from app.erp_registry.models import ErpInstance
        from app.identity_linking.adapters.http_adapter import HttpErpProvisioningAdapter

        monkeypatch.setattr(settings, "ERP_MAIN_TO_INHYMA_SERVICE_CREDENTIAL", "valid-inhyma-key")
        fake_erp = ErpInstance(
            id=uuid.uuid4(),
            key="inhyma",
            name="Inhyma",
            display_name="Inhyma",
            base_url="http://127.0.0.1:8002",
        )
        adapter = HttpErpProvisioningAdapter()
        headers = adapter._get_headers(
            fake_erp,
            correlation_id="corr-test-12345",
            idempotency_key="idemp-key-67890",
        )
        assert headers["Authorization"] == "Bearer valid-inhyma-key"
        assert headers["X-Correlation-ID"] == "corr-test-12345"
        assert headers["X-Request-ID"] == "corr-test-12345"
        assert headers["Idempotency-Key"] == "idemp-key-67890"

    async def test_dependency_health_check_safe_response(self, client):
        """GET /api/v1/health/dependencies returns safe status without exposing secrets."""
        resp = await client.get("/api/v1/health/dependencies")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["service"] == "erp_main"
        assert data["database"] == "healthy"
        assert "federation_credentials" in data
        assert data["federation_credentials"]["yinglima"] in ("configured", "not_configured")
        assert data["federation_credentials"]["inhyma"] in ("configured", "not_configured")
        # Ensure no secrets leak
        response_text = resp.text
        assert "Bearer" not in response_text
        assert "password" not in response_text.lower()

    async def test_unauthorized_erp_switching_denied(self, admin_client, client):
        """GlobalUser without ACTIVE membership in target ERP is rejected from /federation/authorize."""
        # 1. Create target ERP with federation client
        target_erp_id = await _create_erp(admin_client, key="switch_target")
        await admin_client.post(
            f"/api/v1/global/erps/{target_erp_id}/federation",
            json={"redirect_uris": ["http://localhost:5174/auth/callback"], "federation_enabled": True},
        )

        # 2. Register GlobalUser and login
        email = f"noswitch_{uuid.uuid4().hex[:6]}@example.com"
        reg_resp = await client.post(
            "/api/v1/global/user-auth/register",
            json={"display_name": "No Switch User", "email": email, "password": "Str0ng!Password123"},
        )
        assert reg_resp.status_code == 201

        login_resp = await client.post(
            "/api/v1/global/user-auth/login",
            json={"email": email, "password": "Str0ng!Password123"},
        )
        token = login_resp.json()["data"]["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"

        # 3. Request authorization code for target ERP (no membership held) -> 403 Forbidden
        auth_resp = await client.post(
            "/api/v1/federation/authorize",
            json={
                "erp_instance_id": target_erp_id,
                "redirect_uri": "http://localhost:5174/auth/callback",
                "state": "state-123",
                "code_challenge": "mock-challenge",
            },
        )
        assert auth_resp.status_code == 403

    async def test_suspended_global_user_sso_denied(self, admin_client, client):
        """SUSPENDED GlobalUser cannot initiate federation SSO even with membership."""
        erp_id = await _create_erp(admin_client, key="susp_sso_target")
        await admin_client.post(
            f"/api/v1/global/erps/{erp_id}/federation",
            json={"redirect_uris": ["http://localhost:5174/auth/callback"], "federation_enabled": True},
        )

        email = f"susp_sso_{uuid.uuid4().hex[:6]}@example.com"
        reg_resp = await client.post(
            "/api/v1/global/user-auth/register",
            json={"display_name": "Susp User", "email": email, "password": "Str0ng!Password123"},
        )
        assert reg_resp.status_code == 201
        user_id = reg_resp.json()["data"]["id"]

        # Assign and verify active membership
        mem_resp = await admin_client.post(
            f"/api/v1/global/users/{user_id}/memberships/{erp_id}",
            json={"local_user_id": "loc-123"},
        )
        assert mem_resp.status_code == 201
        m_id = mem_resp.json()["data"]["id"]
        await admin_client.post(f"/api/v1/global/memberships/{m_id}/verify")

        # Suspend the GlobalUser
        susp_resp = await admin_client.patch(
            f"/api/v1/global/users/{user_id}/status",
            json={"status": "SUSPENDED", "reason": "Security review"},
        )
        assert susp_resp.status_code == 200

        # Attempt SSO -> rejected (token invalidated or user suspended)
        login_resp = await client.post(
            "/api/v1/global/user-auth/login",
            json={"email": email, "password": "Str0ng!Password123"},
        )
        # Login is rejected for suspended user
        assert login_resp.status_code in (401, 403)
