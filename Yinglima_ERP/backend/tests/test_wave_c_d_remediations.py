"""Wave C & Wave D regression tests for Yinglima_ERP (BUG-026, BUG-029)."""

from __future__ import annotations

import time
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event

from app.audit.models import AuditAction, AuditLog
from app.audit.repository import AuditRepository
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common.filtering import FilterParams
from app.common.list_query import ListQueryParams
from app.common.pagination import PageParams
from app.common.search import SearchParams
from app.common.sorting import SortParams
from app.database.engine import get_engine, get_sessionmaker
from app.main import create_application


@pytest.mark.asyncio
async def test_bug026_audit_repository_avoids_window_count_over_wide_rows():
    """BUG-026: AuditRepository.paginated_list must use separated page + narrow COUNT(id) query (no OVER())."""
    engine = get_engine()
    executed_sql: list[str] = []

    def _capture_sql(_conn, _cursor, statement, _params, _context, _executemany):
        executed_sql.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _capture_sql)
    try:
        sm = get_sessionmaker()
        async with sm() as session:
            session.add(
                AuditLog(
                    action=AuditAction.CREATE,
                    module="audit",
                    description="Yinglima BUG-026 regression probe",
                )
            )
            await session.flush()

            executed_sql.clear()
            repo = AuditRepository(session)
            query = ListQueryParams(
                page=PageParams(page=1, page_size=20),
                sort=SortParams(),
                search=SearchParams(),
                filters=FilterParams(),
            )
            rows, total = await repo.paginated_list(query)
            assert total >= 1
            assert len(rows) >= 1
            assert len(executed_sql) == 2
            assert all("OVER" not in sql.upper() for sql in executed_sql), (
                f"Expected no WindowAgg OVER() in AuditRepository.paginated_list, got: {executed_sql}"
            )
            await session.rollback()
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _capture_sql)


@pytest.mark.asyncio
async def test_bug026_federation_health_anonymous_is_fast_minimal_and_no_outbound_probes():
    """BUG-026: Anonymous GET /health/federation must return minimal payload immediately with 0 outbound probes."""
    app = create_application()
    transport = ASGITransport(app=app)
    with patch("httpx.AsyncClient", side_effect=AssertionError("Anonymous federation health must not probe peers")):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            t0 = time.perf_counter()
            resp = await client.get("/api/v1/health/federation")
            elapsed_ms = (time.perf_counter() - t0) * 1000
            assert resp.status_code == 200
            data = resp.json()["data"]
            assert data["status"] in {"healthy", "degraded"}
            assert "sso_enabled" in data
            assert "probes" not in data
            assert "erp_main_probes" not in data
            assert elapsed_ms < 500


@pytest.mark.asyncio
async def test_bug029_currency_rates_requires_authentication():
    """BUG-029: GET /masters/currencies/rates must reject unauthenticated callers (401) and allow authenticated users."""
    app = create_application()
    transport = ASGITransport(app=app)

    # 1. Anonymous request rejected (401/403); invalid bearer rejected with 401
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        unauth = await client.get("/api/v1/masters/currencies/rates")
        assert unauth.status_code in (401, 403)
        bad_tok = await client.get(
            "/api/v1/masters/currencies/rates",
            headers={"Authorization": "Bearer invalid.jwt.token"},
        )
        assert bad_tok.status_code == 401

    # 2. Authenticated user succeeds with 200
    user = CurrentUser(id=uuid.uuid4(), username="rates_viewer", permissions=set())
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with patch("app.common.currency.get_active_rates", new_callable=AsyncMock) as mock_rates:
            mock_rates.return_value = {"USD": 1.0, "CNY": 7.2, "INR": 83.5}
            async with AsyncClient(transport=transport, base_url="http://testserver") as client:
                authed = await client.get("/api/v1/masters/currencies/rates")
                assert authed.status_code == 200
                body = authed.json()
                assert body["success"] is True
                assert body["data"]["base"] == "USD"
                assert body["data"]["rates"]["CNY"] == 7.2
    finally:
        app.dependency_overrides.clear()
