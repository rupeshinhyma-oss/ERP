"""
Wave 6 Remediation Regression Tests — BUG-010, BUG-015, BUG-019, BUG-020.

Validates strictly with synthetic data in an isolated SQLite database:
1. BUG-015: /api/v1/organizations/public omits raw base64 logo_data by default (<1 KB payload)
   while serving versioned logo_url (/api/v1/organizations/logo?v=...), preserving ?include_logo_data=true
   opt-in compatibility, and eliminating duplicate route registration in api_router.
2. BUG-010: /api/v1/organizations/logo emits Vary: Origin alongside Cache-Control: public, max-age=86400.
3. BUG-019: /api/v1/health/integration and /api/v1/health/federation return minimal readiness status
   anonymously (0 outbound probes, 0 internal URLs/queue counts) and full diagnostics when authorized
   with valid service credential.
4. BUG-020: /uploads/private/{subfolder}/{filename} enforces auth (401 without token), preserves
   existing token compatibility, emits Cache-Control: private, no-store + Referrer-Policy: no-referrer,
   and never logs query-string tokens.
"""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.health import router as health_router
from app.api.v1.router import api_router
from app.auth.dependencies import get_auth_service
from app.core.config import settings
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.main import create_application
from app.organizations.dependencies import get_organization_service
from app.organizations.routes import router as org_router

pytestmark = pytest.mark.asyncio

# 1x1 transparent PNG
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


async def test_organizations_public_route_is_not_duplicated_in_api_router() -> None:
    import app.api.v1.router as router_mod

    assert not hasattr(router_mod, "get_public_org_info")
    # api_router includes organizations_router once, so /organizations/public must appear exactly once
    api_router_matches = [
        r for r in api_router.routes if getattr(r, "path", None) == "/organizations/public"
    ]
    assert len(api_router_matches) == 1
    assert api_router_matches[0].endpoint.__name__ == "get_public_organization_branding"

    org_router_matches = [
        r for r in org_router.routes if getattr(r, "path", None) == "/organizations/public"
    ]
    assert len(org_router_matches) == 1
    assert org_router_matches[0].endpoint.__name__ == "get_public_organization_branding"

    app = create_application()
    openapi = app.openapi()
    op_id = openapi["paths"]["/api/v1/organizations/public"]["get"]["operationId"]
    assert op_id.startswith("get_public_organization_branding")


async def test_bug010_and_bug015_public_org_payload_lightweight_and_logo_vary_origin() -> None:
    fake_org = SimpleNamespace(
        company_name="Synthetic Inhyma Org",
        legal_name="Synthetic Inhyma Org LLP",
        logo_url="/uploads/branding/legacy.png",
        logo_data=f"data:image/png;base64,{_TINY_PNG_B64}",
    )
    fake_service = SimpleNamespace(get_or_raise=AsyncMock(return_value=fake_org))

    app = FastAPI()

    @app.middleware("http")
    async def _req_id(request: Request, call_next):
        request.state.request_id = "test-wave6-org"
        return await call_next(request)

    register_exception_handlers(app)
    app.include_router(org_router, prefix="/api/v1")
    app.dependency_overrides[get_organization_service] = lambda: fake_service

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Default /organizations/public excludes base64 logo_data and returns versioned /organizations/logo URL
        r_pub = await client.get("/api/v1/organizations/public")
        assert r_pub.status_code == 200
        assert len(r_pub.content) < 1024
        data = r_pub.json()["data"]
        assert data["company_name"] == "Synthetic Inhyma Org"
        assert data["logo_url"].startswith("/api/v1/organizations/logo?v=")
        assert data["logo_data"] is None

        # Explicit opt-in query param remains backward-compatible
        r_opt_in = await client.get("/api/v1/organizations/public?include_logo_data=true")
        assert r_opt_in.status_code == 200
        assert r_opt_in.json()["data"]["logo_data"].startswith("data:image/png;base64,")

        # Direct /organizations/logo streams binary PNG with Vary: Origin
        r_logo = await client.get("/api/v1/organizations/logo")
        assert r_logo.status_code == 200
        assert r_logo.headers["content-type"].startswith("image/png")
        assert "max-age=86400" in r_logo.headers.get("cache-control", "")
        assert "Origin" in r_logo.headers.get("vary", "")
        assert r_logo.content == base64.b64decode(_TINY_PNG_B64)


async def test_bug019_health_endpoints_minimize_public_metadata_and_preserve_operator_diagnostics() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        app = FastAPI()

        @app.middleware("http")
        async def _req_id(request: Request, call_next):
            request.state.request_id = "test-wave6-health"
            return await call_next(request)

        app.include_router(health_router, prefix="/api/v1")

        async def _override_db():
            yield db

        app.dependency_overrides[get_db_session] = _override_db
        svc_cred = settings.get_outbound_service_credential()
        op_headers = {"Authorization": f"Bearer {svc_cred}"}

        mock_http_client = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(status_code=200)))
        mock_cm = SimpleNamespace(
            __aenter__=AsyncMock(return_value=mock_http_client),
            __aexit__=AsyncMock(return_value=None),
        )

        with patch("app.federation.erp_main_client._client_for_erp_main", return_value=mock_cm):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                # 1. Anonymous /health/integration -> minimal payload only
                r_int_anon = await client.get("/api/v1/health/integration")
                assert r_int_anon.status_code == 200
                anon_int_data = r_int_anon.json()["data"]
                assert set(anon_int_data.keys()) == {"status", "liveness"}
                assert "peer_circuits" not in anon_int_data
                assert "deliveries" not in anon_int_data

                # 2. Authorized operator /health/integration -> full diagnostics
                r_int_op = await client.get("/api/v1/health/integration", headers=op_headers)
                assert r_int_op.status_code == 200
                op_int_data = r_int_op.json()["data"]
                assert "peer_circuits" in op_int_data
                assert "deliveries" in op_int_data

                # 3. Anonymous /health/federation -> minimal payload, ZERO live outbound probes triggered
                r_fed_anon = await client.get("/api/v1/health/federation")
                assert r_fed_anon.status_code == 200
                anon_fed_data = r_fed_anon.json()["data"]
                assert set(anon_fed_data.keys()) == {"status", "sso_enabled"}
                assert "erp_main_probes" not in anon_fed_data
                assert "config_problems" not in anon_fed_data
                mock_http_client.get.assert_not_awaited()

                # 4. Authorized operator /health/federation -> full diagnostic payload
                r_fed_op = await client.get("/api/v1/health/federation", headers=op_headers)
                assert r_fed_op.status_code == 200
                op_fed_data = r_fed_op.json()["data"]
                assert "erp_main_probes" in op_fed_data
                assert "config_problems" in op_fed_data

    await engine.dispose()


async def test_bug020_private_upload_headers_auth_and_zero_token_logging(caplog) -> None:
    app = create_application()
    fake_auth = SimpleNamespace(verify_access_token=AsyncMock(return_value=SimpleNamespace(id="syn-user")))
    app.dependency_overrides[get_auth_service] = lambda: fake_auth

    priv_dir = Path("uploads") / "private" / "sales_po"
    priv_dir.mkdir(parents=True, exist_ok=True)
    syn_file = priv_dir / "synthetic_wave6_test_doc.pdf"
    syn_file.write_bytes(b"%PDF-1.4 synthetic test pdf")

    synthetic_token = "SYNTHETIC_ACCESS_TOKEN_DO_NOT_LOG_998877"
    try:
        with caplog.at_level(logging.INFO):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                # Unauthenticated -> 401
                r_unauth = await client.get("/uploads/private/sales_po/synthetic_wave6_test_doc.pdf")
                assert r_unauth.status_code == 401

                # Authenticated (backward-compatible query param + headers check) -> 200 with no-store & no-referrer
                r_ok = await client.get(
                    f"/uploads/private/sales_po/synthetic_wave6_test_doc.pdf?token={synthetic_token}"
                )
                assert r_ok.status_code == 200
                assert r_ok.headers.get("cache-control") == "private, no-store"
                assert r_ok.headers.get("referrer-policy") == "no-referrer"
                assert r_ok.headers.get("x-content-type-options") == "nosniff"

        app_records = [rec for rec in caplog.records if rec.name.startswith("app")]
        assert len(app_records) >= 2
        for rec in app_records:
            assert synthetic_token not in rec.getMessage()
            assert synthetic_token not in str(getattr(rec, "__dict__", {}))
    finally:
        syn_file.unlink(missing_ok=True)
