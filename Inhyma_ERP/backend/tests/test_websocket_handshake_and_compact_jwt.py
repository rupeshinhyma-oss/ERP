"""
Regression tests for WebSocket 400 Bad Request prevention, compact JWT claims,
and single-flight central session state checks.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import uvicorn
import websockets
from starlette.testclient import TestClient

import app.main as app_main
from app.auth.dependencies import verify_websocket_token
from app.auth.security import create_access_token
from app.auth.service import AdminPermissionSet, AuthService, CurrentUser, LoginContext
from scripts.seed import BOOTSTRAP_PERMISSIONS
from app.federation import erp_main_client


def test_websockets_max_line_length_default_raised() -> None:
    assert int(os.environ.get("WEBSOCKETS_MAX_LINE_LENGTH", "0")) >= 65536


@pytest.mark.asyncio
async def test_issue_token_pair_emits_compact_jwt_under_400_bytes() -> None:
    user_id = uuid.uuid4()
    fake_user = MagicMock()
    fake_user.id = user_id

    service = AuthService.__new__(AuthService)
    all_codes = AdminPermissionSet([row[0] for row in BOOTSTRAP_PERMISSIONS] + ["*"])
    service.get_user_effective_permissions = AsyncMock(return_value=all_codes)
    service.session_repository = MagicMock()
    service.session_repository.create = AsyncMock()

    access_token, _refresh_token = await service._issue_token_pair(
        fake_user,
        LoginContext(ip_address="127.0.0.1", user_agent="pytest", device_info="pytest"),
        session_id="central-sid-123",
    )

    assert len(access_token) < 400, f"Expected compact JWT < 400 bytes, got {len(access_token)}"


@pytest.mark.asyncio
async def test_live_uvicorn_websocket_accepts_legacy_8500_byte_token_and_first_frame_auth() -> None:
    """
    Prove on a real TCP Uvicorn + websockets server that:
      1. A legacy 8,544-byte JWT in `?token=...` is accepted (no 400 Bad Request).
      2. An omitted query token + first-frame `{"action": "auth", "token": ...}` is accepted.
      3. An invalid/missing token closes cleanly with 4401.
    """
    user_id = uuid.uuid4()
    legacy_codes = [row[0] for row in BOOTSTRAP_PERMISSIONS]
    oversized_jwt = create_access_token(user_id, permissions=legacy_codes, session_id="sid-legacy").token
    assert len(oversized_jwt) > 8200  # Exceeds websockets' old 8,192-byte default line limit

    fake_current_user = CurrentUser(
        id=user_id,
        username="admin",
        permissions=AdminPermissionSet(["*"]),
        access_token_jti="jti-test",
        is_super_admin=True,
        session_id="sid-legacy",
    )

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    config = uvicorn.Config(app_main.app, host="127.0.0.1", port=port, log_level="warning", lifespan="off")
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)

    async def _fake_verify(_ws, tok: str) -> CurrentUser:
        if tok == oversized_jwt:
            return fake_current_user
        from app.core.exceptions import UnauthorizedException

        raise UnauthorizedException("Invalid or expired token.")

    try:
        with patch("app.events.routes.verify_websocket_token", side_effect=_fake_verify):
            # 1) Legacy 8.5 KB token in query string -> 101 Switching Protocols (NOT 400 Bad Request)
            ws_url_query = f"ws://127.0.0.1:{port}/api/v1/events/live?token={oversized_jwt}"
            async with websockets.connect(ws_url_query) as ws:
                await ws.send(json.dumps({"action": "ping", "timestamp": 123}))
                reply = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
                assert reply == {"type": "pong", "timestamp": 123}

            # 2) Oversized token via first-frame auth -> 101 Switching Protocols + subscribe ack
            ws_url_bare = f"ws://127.0.0.1:{port}/api/v1/events/live"
            async with websockets.connect(ws_url_bare) as ws:
                await ws.send(json.dumps({"action": "auth", "token": oversized_jwt}))
                await ws.send(json.dumps({"action": "subscribe", "channel": f"user:{user_id}"}))
                reply = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
                assert reply == {"type": "subscribed", "channel": f"user:{user_id}"}

            # 3) Bad auth frame -> closes cleanly with 4401
            async with websockets.connect(ws_url_bare) as ws:
                await ws.send(json.dumps({"action": "auth", "token": "bad-token"}))
                with pytest.raises(websockets.exceptions.ConnectionClosed) as exc_info:
                    await asyncio.wait_for(ws.recv(), timeout=5.0)
                assert exc_info.value.rcvd is not None
                assert exc_info.value.rcvd.code == 4401
    finally:
        server.should_exit = True
        await server_task


@pytest.mark.asyncio
async def test_central_session_state_single_flight_deduplicates_concurrent_calls() -> None:
    sid = f"central-test-{uuid.uuid4()}"
    erp_main_client._SESSION_STATE_CACHE.pop(sid, None)

    call_count = 0

    async def _slow_verify(_sid: str, **_kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.08)
        return {"active": True, "revoked": False}

    with (
        patch.object(erp_main_client, "_central_configured", return_value=True),
        patch.object(erp_main_client, "verify_ecosystem_session", side_effect=_slow_verify),
    ):
        results = await asyncio.gather(*(erp_main_client.central_session_state(sid) for _ in range(7)))

    assert results == ["active"] * 7
    assert call_count == 1, f"Expected single-flight deduplication (1 call), got {call_count}"
