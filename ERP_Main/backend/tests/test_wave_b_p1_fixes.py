"""
Wave B P1 Regression Tests for ERP_Main (BUG-010, BUG-012).
"""

from __future__ import annotations

import pytest

from app.core.config import Settings
from app.platform_auth.security import create_platform_access_token, decode_platform_access_token
from app.global_auth.security import create_global_access_token, decode_global_access_token
import uuid

pytestmark = pytest.mark.asyncio


async def test_bug010_mesh_status_returns_200_with_registered_erps(super_admin_client):
    # Register two ERPs
    for key in ("yinglima", "inhyma"):
        r = await super_admin_client.post(
            "/api/v1/global/erps",
            json={
                "key": key,
                "name": key,
                "display_name": key.title() + " ERP",
                "status": "ACTIVE",
                "base_url": f"https://{key}.example.internal",
            },
        )
        assert r.status_code in (200, 201), r.text

    resp = await super_admin_client.get("/api/v1/global/integration/mesh-status")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["node_count"] >= 2
    keys = {n["erp_key"] for n in data["nodes"]}
    assert {"yinglima", "inhyma"} <= keys
    assert "active_subscriptions" in data
    assert "total_unreplayed_dead_letters" in data


async def test_bug012_access_tokens_are_short_lived():
    cfg = Settings(_env_file=None)
    assert cfg.PLATFORM_ACCESS_TOKEN_EXPIRE_MINUTES == 30
    assert cfg.GLOBAL_ACCESS_TOKEN_EXPIRE_MINUTES == 30
    assert cfg.GLOBAL_SESSION_MAX_LIFETIME_HOURS == 168

    # Legacy 10-year value in env is clamped to 30 min
    clamped = Settings(_env_file=None, PLATFORM_ACCESS_TOKEN_EXPIRE_MINUTES=5256000, GLOBAL_ACCESS_TOKEN_EXPIRE_MINUTES=5256000)
    assert clamped.PLATFORM_ACCESS_TOKEN_EXPIRE_MINUTES == 30
    assert clamped.GLOBAL_ACCESS_TOKEN_EXPIRE_MINUTES == 30

    p_tok = create_platform_access_token(uuid.uuid4(), role="SUPER_ADMIN")
    p_claims = decode_platform_access_token(p_tok.token)
    assert 60 <= (p_claims["exp"] - p_claims["iat"]) <= 7200

    g_tok = create_global_access_token(global_user_id=uuid.uuid4(), session_id=uuid.uuid4())
    g_claims = decode_global_access_token(g_tok.token)
    assert 60 <= (g_claims["exp"] - g_claims["iat"]) <= 7200
