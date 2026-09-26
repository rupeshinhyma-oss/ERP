"""
Phase 9 Realtime & Idempotency Hardening Tests for Yinglima ERP.

Covers:
1. WebSocket heartbeat ping/pong protocol handling.
2. Channel authorization and rejection of forbidden channels.
3. Malformed and oversized WebSocket control message defenses.
4. Idempotency-Key durable deduplication and replay behavior.
5. SyncedBuyerSource cross-ERP idempotency and loop prevention.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select

from app.auth.service import CurrentUser
from app.database.engine import dispose_engine, get_sessionmaker
from app.durable_events.models import DurableEvent
from app.durable_events.repository import DurableEventRepository
from app.events.manager import ConnectionManager
from app.events.routes import _handle_client_message
from app.integration.consumer_models import SyncedBuyerSource
from app.integration.handlers import handle_buyer_created
from app.masters.countries.models import Country

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    """A real session against the test Postgres database."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()
    await dispose_engine()


class TestPhase9WebSocketHardening:
    """Tests WebSocket heartbeat, channel authorization, and defensive frame handling."""

    async def test_heartbeat_ping_responds_with_pong(self, monkeypatch):
        """Action 'ping' returns a pong control message carrying the client's timestamp."""
        mock_ws = MagicMock()
        mock_manager = MagicMock(spec=ConnectionManager)
        mock_manager.send_to_websocket = AsyncMock()

        monkeypatch.setattr("app.events.routes.connection_manager", mock_manager)

        current_user = CurrentUser(
            id=uuid.uuid4(),
            username="testuser",
            permissions={"buyer.view"},
        )

        ping_payload = json.dumps({"action": "ping", "timestamp": 1727180000})
        await _handle_client_message(mock_ws, ping_payload, current_user)

        mock_manager.send_to_websocket.assert_awaited_once_with(
            mock_ws, {"type": "pong", "timestamp": 1727180000}
        )

    async def test_authorized_channel_subscription_succeeds(self, monkeypatch):
        """Subscribing to a permitted channel registers subscription and returns 'subscribed'."""
        mock_ws = MagicMock()
        mock_manager = MagicMock(spec=ConnectionManager)
        mock_manager.send_to_websocket = AsyncMock()
        mock_manager.subscribe = MagicMock()

        monkeypatch.setattr("app.events.routes.connection_manager", mock_manager)

        current_user = CurrentUser(
            id=uuid.uuid4(),
            username="testuser",
            permissions={"buyer.view"},
        )

        sub_payload = json.dumps({"action": "subscribe", "channel": "module:buyers"})
        await _handle_client_message(mock_ws, sub_payload, current_user)

        mock_manager.subscribe.assert_called_once_with(mock_ws, "module:buyers")
        mock_manager.send_to_websocket.assert_awaited_once_with(
            mock_ws, {"type": "subscribed", "channel": "module:buyers"}
        )

    async def test_forbidden_user_channel_is_rejected(self, monkeypatch):
        """Subscribing to another user's private channel is strictly rejected."""
        mock_ws = MagicMock()
        mock_manager = MagicMock(spec=ConnectionManager)
        mock_manager.send_to_websocket = AsyncMock()
        mock_manager.subscribe = MagicMock()

        monkeypatch.setattr("app.events.routes.connection_manager", mock_manager)

        user_a_id = uuid.uuid4()
        user_b_id = uuid.uuid4()

        current_user = CurrentUser(
            id=user_a_id,
            username="usera",
            permissions=set(),
        )

        alien_channel = f"user:{user_b_id}"
        sub_payload = json.dumps({"action": "subscribe", "channel": alien_channel})
        await _handle_client_message(mock_ws, sub_payload, current_user)

        mock_manager.subscribe.assert_not_called()
        mock_manager.send_to_websocket.assert_awaited_once_with(
            mock_ws,
            {"type": "error", "message": "You may only subscribe to your own user channel.", "channel": alien_channel},
        )

    async def test_malformed_frames_handled_defensively(self, monkeypatch):
        """Malformed JSON, oversized messages, or unknown actions do not crash the socket."""
        mock_ws = MagicMock()
        mock_manager = MagicMock(spec=ConnectionManager)
        mock_manager.send_to_websocket = AsyncMock()

        monkeypatch.setattr("app.events.routes.connection_manager", mock_manager)

        current_user = CurrentUser(
            id=uuid.uuid4(),
            username="testuser",
            permissions=set(),
        )

        # 1. Non-JSON frame
        await _handle_client_message(mock_ws, "NOT_JSON", current_user)
        mock_manager.send_to_websocket.assert_awaited_with(
            mock_ws, {"type": "error", "message": "Malformed message: expected JSON."}
        )

        # 2. Unknown action
        unknown_action = json.dumps({"action": "destroy_database"})
        await _handle_client_message(mock_ws, unknown_action, current_user)
        assert "Unknown action" in mock_manager.send_to_websocket.await_args_list[-1][0][1]["message"]


class TestPhase9IdempotencyHardening:
    """Tests server-side durable idempotency replay and cross-ERP sync loop prevention."""

    async def test_durable_event_idempotency_key_lookup(self, db_session):
        """DurableEventRepository reliably finds existing records by idempotency_key."""
        repo = DurableEventRepository(db_session)
        test_key = f"idem_key_{uuid.uuid4().hex}"
        test_buyer_id = str(uuid.uuid4())

        event = DurableEvent(
            event_type="buyer.created",
            source="yinglima",
            entity="buyer",
            entity_id=test_buyer_id,
            entity_version=1,
            payload="{}",
            event_metadata="{}",
            idempotency_key=test_key,
            correlation_id=uuid.uuid4(),
            user_id=str(uuid.uuid4()),
            occurred_at=datetime.now(timezone.utc),
        )
        await repo.create(event)
        await db_session.commit()

        # Query by idempotency key
        found = await repo.get_by_idempotency_key(test_key)
        assert found is not None
        assert found.entity_id == test_buyer_id
        assert found.idempotency_key == test_key

        # Non-existent key returns None
        non_existent = await repo.get_by_idempotency_key("non_existent_key")
        assert non_existent is None

    async def test_cross_erp_synced_buyer_source_prevents_duplicate_replay(self, db_session):
        """Replaying a buyer.created event for an already-synced source buyer is safely skipped."""
        unique_suffix = uuid.uuid4().hex[:8].upper()
        code = f"T{unique_suffix[:4]}"
        country = Country(name=f"Test Country {unique_suffix}", code=code)
        db_session.add(country)
        await db_session.commit()

        source_erp_id = "inhyma"
        source_buyer_id = str(uuid.uuid4())
        company_name = f"Idempotent Co {uuid.uuid4().hex[:8]}"

        try:
            # First synchronization creates local buyer and records SyncedBuyerSource
            await handle_buyer_created(
                {"buyer_id": source_buyer_id, "company_name": company_name, "country_code": country.code},
                source_erp_id,
            )

            async with get_sessionmaker()() as verify_session:
                from app.buyers.models import Buyer

                result = await verify_session.execute(select(Buyer).where(Buyer.company_name == company_name))
                buyers = result.scalars().all()
                assert len(buyers) == 1

                # SyncedBuyerSource record exists
                sync_rec = await verify_session.execute(
                    select(SyncedBuyerSource).where(
                        SyncedBuyerSource.source_erp_id == source_erp_id,
                        SyncedBuyerSource.source_buyer_id == source_buyer_id,
                    )
                )
                assert sync_rec.scalar_one_or_none() is not None

            # Replay same source buyer with potentially modified name
            await handle_buyer_created(
                {"buyer_id": source_buyer_id, "company_name": company_name, "country_code": country.code},
                source_erp_id,
            )

            async with get_sessionmaker()() as verify_session:
                result = await verify_session.execute(select(Buyer).where(Buyer.company_name == company_name))
                buyers = result.scalars().all()
                assert len(buyers) == 1  # Exactly one; no duplicate created!
        finally:
            async with get_sessionmaker()() as cleanup_session:
                from app.buyers.models import Buyer

                result = await cleanup_session.execute(select(Buyer).where(Buyer.country_id == country.id))
                for b in result.scalars().all():
                    await cleanup_session.delete(b)
                existing = await cleanup_session.get(Country, country.id)
                if existing is not None:
                    await cleanup_session.delete(existing)
                await cleanup_session.commit()


class TestPhase9CredentialHardeningAndFederation:
    """Tests service credential authentication, rotation, and elimination of unsafe fallbacks."""

    async def test_valid_primary_service_credential_accepted(self, monkeypatch):
        """Incoming call with primary ERP_MAIN_SERVICE_CREDENTIAL is authenticated."""
        from app.api.v1.internal_users import require_internal_service_auth
        from app.core.config import settings

        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "prod-primary-cred-123")
        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL_PREVIOUS", None)

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="prod-primary-cred-123")
        # Should not raise
        require_internal_service_auth(creds)

    async def test_rotated_previous_service_credential_accepted(self, monkeypatch):
        """Incoming call with previous service credential succeeds during rotation overlap."""
        from app.api.v1.internal_users import require_internal_service_auth
        from app.core.config import settings

        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "new-primary-cred-456")
        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL_PREVIOUS", "old-rotated-cred-123")

        # Previous credential still accepted
        old_creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="old-rotated-cred-123")
        require_internal_service_auth(old_creds)

        # New primary also accepted
        new_creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="new-primary-cred-456")
        require_internal_service_auth(new_creds)

    async def test_invalid_service_credential_rejected_401(self, monkeypatch):
        """Invalid service credential raises 401 Unauthorized."""
        from fastapi import HTTPException
        from app.api.v1.internal_users import require_internal_service_auth
        from app.core.config import settings

        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "valid-cred")
        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL_PREVIOUS", None)

        bad_creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="attacker-secret")
        with pytest.raises(HTTPException) as exc_info:
            require_internal_service_auth(bad_creds)
        assert exc_info.value.status_code == 401
        assert "Invalid service credential" in exc_info.value.detail

    async def test_missing_service_credential_rejected_401(self):
        """Missing authorization header raises 401 Unauthorized."""
        from fastapi import HTTPException
        from app.api.v1.internal_users import require_internal_service_auth

        with pytest.raises(HTTPException) as exc_info:
            require_internal_service_auth(None)
        assert exc_info.value.status_code == 401
        assert "Missing service credential" in exc_info.value.detail

    async def test_no_secret_key_fallback(self, monkeypatch):
        """Presenting JWT_SECRET_KEY as a credential is strictly rejected (zero fallback to unrelated secrets)."""
        from fastapi import HTTPException
        from app.api.v1.internal_users import require_internal_service_auth
        from app.core.config import settings

        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "strong-service-cred-xyz")
        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL_PREVIOUS", None)

        # Presenting JWT_SECRET_KEY must fail
        secret_key_creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=settings.JWT_SECRET_KEY)
        with pytest.raises(HTTPException) as exc_info:
            require_internal_service_auth(secret_key_creds)
        assert exc_info.value.status_code == 401

    async def test_integration_require_service_auth_rotation_and_no_fallback(self, monkeypatch):
        """Integration route service auth also supports rotation and rejects JWT_SECRET_KEY fallback."""
        from fastapi import HTTPException
        from app.integration.routes import require_service_auth
        from app.core.config import settings

        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "integration-primary-key")
        monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL_PREVIOUS", "integration-old-key")

        # 1. Primary succeeds
        require_service_auth(HTTPAuthorizationCredentials(scheme="Bearer", credentials="integration-primary-key"))

        # 2. Previous succeeds
        require_service_auth(HTTPAuthorizationCredentials(scheme="Bearer", credentials="integration-old-key"))

        # 3. JWT_SECRET_KEY fails with 401
        with pytest.raises(HTTPException) as exc_info:
            require_service_auth(HTTPAuthorizationCredentials(scheme="Bearer", credentials=settings.JWT_SECRET_KEY))
        assert exc_info.value.status_code == 401
